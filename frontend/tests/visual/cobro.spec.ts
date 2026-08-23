/**
 * Cobro evidence — the payment screen hosted beside the rail (BUILD §14.5).
 *
 * Puts two demo items on the ticket, presses the band's PAGAR and captures
 * `docs/design-evidence/after/desktop-1440/cobro.png` — the one artboard the
 * AFTER set never had. Records what it could see so a blank frame cannot pass
 * for a capture. Diagnostic, not a gate — same posture as
 * `destination-audit.spec.ts`; the basket steps mirror `register-surfaces`.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_VISUAL_PATH || "/posapp";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = resolve(repoRoot, "docs/design-evidence/after/desktop-1440");

/** Demo SKUs that exist on the lab retail catalogue. */
const BASKET: Array<[string, string]> = [
	// The bare "Anillo Case" row is a MX$0 / no-stock template the register
	// refuses; the Honor 70 variants carry a price and a unit.
	["Anillo Case Honor", "Anillo Case Honor 70 Gris"],
	["Adaptador", "Adaptador"],
];

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set.");
test.use({ actionTimeout: 8_000, navigationTimeout: 45_000 });

test("PAGAR opens the Cobro surface beside the rail", async ({ page }) => {
	test.setTimeout(240_000);
	const login = await page.request.post("/api/method/login", {
		form: { usr: process.env.POSA_SMOKE_USER!, pwd: process.env.POSA_SMOKE_PASSWORD! },
	});
	expect(login.ok(), `login ${login.status()}`).toBeTruthy();

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);

	for (let pass = 0; pass < 3; pass++) {
		for (const name of [/^close$/i, /^set up later$/i, /^dismiss$/i]) {
			const btn = page.getByRole("button", { name }).first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click().catch(() => {});
				await page.waitForTimeout(800);
			}
		}
		const snack = page.locator(".v-snackbar").getByRole("button", { name: /close|cerrar/i }).first();
		if (await snack.isVisible().catch(() => false)) await snack.click().catch(() => {});
	}

	// Typing into the scan field opens the drawer on the matches
	// (`resolveSearchDrawerIntent`); `typedOnlyHits` records how many are
	// visible from typing alone. Browse is still pressed afterwards so the lane
	// does not depend on the debounce to find its row.
	const box = page.getByRole("textbox", { name: "Search, scan or browse item" }).first();
	await box.click({ timeout: 5_000 }).catch(() => {});
	await box.fill("Anillo").catch(() => {});
	await page.waitForTimeout(1_500);
	const typedOnlyHits = await page
		.getByText("Anillo Case", { exact: false })
		.locator("visible=true")
		.count()
		.catch(() => 0);
	await box.fill("").catch(() => {});
	const browse = page.locator('[data-testid="browse-catalog"]').first();
	if (await browse.isVisible().catch(() => false)) {
		await browse.click().catch(() => {});
		await page.waitForTimeout(1_200);
	}
	let added = 0;
	for (const [term, rowText] of BASKET) {
		try {
			await box.click({ timeout: 5_000 });
			await box.fill(term);
			await page.waitForTimeout(1_400);
			await page
				.getByText(rowText, { exact: false })
				.locator("visible=true")
				.first()
				.click({ timeout: 5_000 });
			await page.waitForTimeout(700);
			await box.fill("");
			added++;
		} catch {
			/* catalogue differs on this tenant — recorded via the count */
		}
	}

	const pay = page.locator('[data-testid="band-primary"]').first();
	const payEnabled = await pay.isEnabled().catch(() => false);
	if (payEnabled) {
		await pay.click().catch(() => {});
		await page.waitForTimeout(3_500);
	}

	const seen = await page.evaluate(() => {
		const host = document.querySelector('[data-testid="cobro-host"]');
		const band = document.querySelector('[data-testid="action-band"]');
		return {
			cobroHost: Boolean(host),
			cobroText: host ? (host.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : "",
			railVisible: Boolean(document.querySelector('[data-testid="register-rail"]')),
			bandAction: band?.getAttribute("data-band-action") ?? null,
			bandPrimaries: document.querySelectorAll('[data-testid="band-primary"]').length,
			dialogOpen: Boolean(document.querySelector(".payment-dialog .v-overlay__content")),
			tenderPad: Boolean(document.querySelector('[data-testid="cobro-tender-pad"]')),
		};
	});

	// The pad takes focus and scrolls itself into view; the capture wants the
	// surface from its top, the way a cashier first sees it.
	await page.evaluate(() => {
		document.querySelectorAll(".destination-host, .cobro-surface, .payment-scroll").forEach((el) => {
			(el as HTMLElement).scrollTop = 0;
		});
		window.scrollTo(0, 0);
	});
	await page.waitForTimeout(400);
	mkdirSync(outDir, { recursive: true });
	await page.screenshot({ path: resolve(outDir, "cobro.png") });
	const report = { capturedAt: new Date().toISOString(), added, typedOnlyHits, payEnabled, ...seen };
	writeFileSync(resolve(outDir, "cobro.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));

	// Leave the register as found: back to the sale and clear the ticket.
	await page.keyboard.press("Escape").catch(() => {});
	const cancel = page.getByRole("button", { name: /cancel sale|cancelar venta/i }).first();
	if (await cancel.isVisible().catch(() => false)) {
		await cancel.click().catch(() => {});
		await page.waitForTimeout(600);
		const confirm = page.getByRole("button", { name: /^(yes|sí|confirm|cancel sale)/i }).first();
		if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
	}

	expect(typedOnlyHits, "typing shows its matches without pressing Browse").toBeGreaterThan(0);
	expect(added, "at least one demo item on the ticket").toBeGreaterThan(0);
	expect(seen.cobroHost, "the Cobro surface is hosted").toBeTruthy();
	expect(seen.railVisible, "the rail stays on screen").toBeTruthy();
	expect(seen.dialogOpen, "no payment dialog on the rail layout").toBeFalsy();
});
