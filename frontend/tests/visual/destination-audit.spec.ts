/**
 * Destination integration audit — a DIAGNOSTIC, not a gate.
 *
 * The owner found that opening Gasto produced a page with no rail and content
 * clipped off the left edge. That turned out to be structural: two of the ten
 * rail destinations are `kind: "route"` and navigate away from the shell, so
 * the rail goes with them. This spec asks the same question of all ten, on a
 * live register, and records MEASUREMENTS rather than impressions — a
 * screenshot of a broken layout looks a lot like a screenshot of an intended
 * one until you check whether anything is outside its container.
 *
 * Writes `docs/design-evidence/destination-audit.json` plus one PNG each.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_VISUAL_PATH || "/posapp";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = resolve(repoRoot, "docs/design-evidence/destinations");

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set.");
test.use({ actionTimeout: 8_000, navigationTimeout: 45_000 });

/** Registry ids, in rail order. `floor` is gated off on a retail preset. */
const DESTINATIONS = [
	"sale", "browse", "floor", "serviceOrder", "expense",
	"drafts", "invoices", "return", "recharge",
	// The tools group lives behind the "More" pill; the loop opens it first.
	"payments", "purchase", "barcode", "giftCards", "dashboard",
	"closing",
];

test("every rail destination keeps the shell", async ({ page }) => {
	test.setTimeout(300_000);
	const user = process.env.POSA_SMOKE_USER;
	const password = process.env.POSA_SMOKE_PASSWORD;
	const login = await page.request.post("/api/method/login", {
		form: { usr: user!, pwd: password! },
	});
	expect(login.ok(), `login ${login.status()}`).toBeTruthy();

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);

	// A fresh browser meets the register behind TWO stacked modals before it can
	// touch anything: the service-worker "Update available" sheet, and the
	// Printer-setup wizard that opens because QZ Tray is not running. The first
	// version of this audit clicked straight into that scrim, so every
	// destination reported identical measurements and none of the clicks landed.
	// Named, in order, because the order matters — the wizard sits ON TOP.
	const preamble = [
		{ name: /^close$/i, what: "printer wizard" },
		{ name: /^set up later$/i, what: "printer wizard (defer)" },
		{ name: /^dismiss$/i, what: "service-worker update sheet" },
	];
	const cleared: string[] = [];
	for (let pass = 0; pass < 3; pass++) {
		for (const step of preamble) {
			const btn = page.getByRole("button", { name: step.name }).first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click().catch(() => {});
				cleared.push(step.what);
				await page.waitForTimeout(800);
			}
		}
		const snack = page.locator(".v-snackbar").getByRole("button", { name: /close|cerrar/i }).first();
		if (await snack.isVisible().catch(() => false)) await snack.click().catch(() => {});
		await page.waitForTimeout(400);
	}
	console.log("cleared before audit:", JSON.stringify(cleared));

	mkdirSync(outDir, { recursive: true });
	const findings: unknown[] = [];

	for (const id of DESTINATIONS) {
		let item = page.locator(`[data-rail-destination="${id}"]`).first();
		let onRail = await item.isVisible().catch(() => false);
		if (!onRail) {
			// A tool sits in the "More" flyout; open it and look again.
			const more = page.locator('[data-testid="rail-tools"]').first();
			if (await more.isVisible().catch(() => false)) {
				await more.click().catch(() => {});
				await page.waitForTimeout(600);
				item = page.locator(`[role="menu"] [data-rail-destination="${id}"]`).first();
				onRail = await item.isVisible().catch(() => false);
				if (!onRail) await page.keyboard.press("Escape").catch(() => {});
			}
		}
		if (!onRail) {
			findings.push({ id, onRail: false, note: "absent from this preset's rail" });
			continue;
		}
		const urlBefore = page.url();
		await item.click().catch(() => {});
		await page.waitForTimeout(2_500);

		const m = await page.evaluate(() => {
			const vw = window.innerWidth;
			const rail = document.querySelector('[data-testid="register-rail"]');
			const railBox = rail ? rail.getBoundingClientRect() : null;
			// Anything whose box starts left of 0 or ends right of the viewport
			// is overflowing its container — that is what clips a heading.
			// Count only what a person can actually SEE. A closed drawer parked
			// at translateX(100%) legitimately sits beyond the viewport, and
			// counting it reported 545 "overflows" on a perfectly fine screen —
			// the first version of this audit measured hidden geometry and made
			// every destination look identically broken.
			let overflowLeft = 0, overflowRight = 0, widest = 0;
			const visible = (el: Element) => {
				const cs = getComputedStyle(el as HTMLElement);
				if (cs.visibility === "hidden" || cs.display === "none") return false;
				return parseFloat(cs.opacity || "1") > 0.01;
			};
			document.querySelectorAll("body *").forEach((el) => {
				const r = (el as HTMLElement).getBoundingClientRect();
				if (r.width === 0 || r.height === 0) return;
				if (!visible(el)) return;
				if (r.left < -1) overflowLeft++;
				if (r.right > vw + 1) overflowRight++;
				widest = Math.max(widest, r.width);
			});
			// The DESTINATION HOST, not the navbar. The first version probed
			// `h1,h2,.text-h5` and kept finding the "MuellePOS" wordmark, so
			// every destination reported the same heading and the audit could
			// not tell whether a click had landed at all.
			const host = document.querySelector("[data-destination]");
			const hostBox = host ? host.getBoundingClientRect() : null;
			const band = document.querySelector('[data-testid="action-band"]');
			return {
				railVisible: !!railBox && railBox.width > 0,
				railWidth: railBox ? Math.round(railBox.width) : 0,
				bandPresent: !!band,
				overflowLeft, overflowRight,
				widestElement: Math.round(widest),
				viewportWidth: vw,
				docScrollWidth: document.documentElement.scrollWidth,
				hostedId: host ? host.getAttribute("data-destination") : null,
				hostedState: host ? host.getAttribute("data-destination-state") : null,
				hostLeft: hostBox ? Math.round(hostBox.left) : null,
				hostWidth: hostBox ? Math.round(hostBox.width) : null,
				hostText: host ? (host.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) : null,
				// WHAT overflows, not just how many. A count alone cannot tell a
				// benign off-screen panel from a clipped heading, and this audit
				// has already reported 545 "overflows" on a healthy screen once.
				overflowSample: (() => {
					const out: string[] = [];
					document.querySelectorAll("body *").forEach((el) => {
						if (out.length >= 4) return;
						const r = (el as HTMLElement).getBoundingClientRect();
						if (r.width === 0 || r.height === 0) return;
						if (!visible(el)) return;
						if (r.right <= vw + 1) return;
						const e = el as HTMLElement;
						out.push(`${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]} @${Math.round(r.left)}..${Math.round(r.right)}`);
					});
					return out;
				})(),
			};
		});

		await page.screenshot({ path: resolve(outDir, `${id}.png`) });
		findings.push({ id, onRail: true, urlBefore, urlAfter: page.url(), ...m });
	}

	writeFileSync(resolve(outDir, "audit.json"), JSON.stringify(findings, null, 2) + "\n");
	console.log(JSON.stringify(findings, null, 2));
	expect(findings.length).toBeGreaterThan(0);
});
