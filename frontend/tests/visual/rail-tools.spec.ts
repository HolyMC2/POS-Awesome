/**
 * Rail tools evidence — the "More" pill and its flyout, on a live register.
 *
 * Captures `docs/design-evidence/after/desktop-1440/riel-herramientas.png`
 * (the flyout open beside the rail) and records two facts the canvas «Riel con
 * herramientas» promised: the hamburger is GONE on the rail layout, and every
 * tool the profile grants is listed in the flyout with a hint. Diagnostic, not
 * a gate — same posture as `destination-audit.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_VISUAL_PATH || "/posapp";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = resolve(repoRoot, "docs/design-evidence/after/desktop-1440");

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set.");
test.use({ actionTimeout: 8_000, navigationTimeout: 45_000 });

test("the More pill opens the tools flyout and the hamburger is gone", async ({ page }) => {
	test.setTimeout(180_000);
	const login = await page.request.post("/api/method/login", {
		form: { usr: process.env.POSA_SMOKE_USER!, pwd: process.env.POSA_SMOKE_PASSWORD! },
	});
	expect(login.ok(), `login ${login.status()}`).toBeTruthy();

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);

	// Same preamble as the destination audit: the SW update sheet and the
	// printer wizard sit over the register on a fresh browser.
	for (let pass = 0; pass < 3; pass++) {
		for (const name of [/^close$/i, /^set up later$/i, /^dismiss$/i]) {
			const btn = page.getByRole("button", { name }).first();
			if (await btn.isVisible().catch(() => false)) {
				await btn.click().catch(() => {});
				await page.waitForTimeout(800);
			}
		}
	}

	const hamburger = page.locator(".pos-navbar-brand-section .v-app-bar-nav-icon, .nav-icon").first();
	const hamburgerVisible = await hamburger.isVisible().catch(() => false);

	const more = page.locator('[data-testid="rail-tools"]').first();
	const moreVisible = await more.isVisible().catch(() => false);
	let tools: Array<{ id: string | null; label: string; hint: string }> = [];
	if (moreVisible) {
		await more.click();
		await page.waitForTimeout(700);
		tools = await page.evaluate(() =>
			Array.from(document.querySelectorAll('[role="menu"] [data-rail-destination]')).map((el) => ({
				id: el.getAttribute("data-rail-destination"),
				label: el.querySelector(".register-rail__tool-label")?.textContent?.trim() ?? "",
				hint: el.querySelector(".register-rail__tool-hint")?.textContent?.trim() ?? "",
			})),
		);
	}

	mkdirSync(outDir, { recursive: true });
	await page.screenshot({ path: resolve(outDir, "riel-herramientas.png") });
	const report = { capturedAt: new Date().toISOString(), hamburgerVisible, moreVisible, tools };
	writeFileSync(resolve(outDir, "riel-herramientas.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));

	expect(moreVisible, "the More pill is on the rail").toBeTruthy();
	expect(hamburgerVisible, "no hamburger on the rail layout").toBeFalsy();
});
