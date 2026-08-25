/**
 * Facturas panel + navbar evidence, on a live register at 1920×1080 — the
 * owner's own viewport, where the 08-24 screenshots were taken.
 *
 * Records the three facts that round promised: the status chips no longer
 * slide under the actions cluster (container ladder), the cashier chip
 * carries a FIRST name with the full name on its tooltip, and the ticket
 * panel names its DAY — not just its hour. Captures
 * `docs/design-evidence/after/desktop-1440/facturas-panel.png` and
 * `navbar-1920.png`. Diagnostic, not a gate.
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

test("the bar fits at 1920 and the ticket panel names its day", async ({ page }) => {
	test.setTimeout(180_000);
	const login = await page.request.post("/api/method/login", {
		form: { usr: process.env.POSA_SMOKE_USER!, pwd: process.env.POSA_SMOKE_PASSWORD! },
	});
	expect(login.ok(), `login ${login.status()}`).toBeTruthy();

	await page.setViewportSize({ width: 1920, height: 1080 });
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
	}

	// ── The bar ─────────────────────────────────────────────────────────
	const chipsBox = await page
		.locator('[data-testid="register-status-line"] .register-status-line__chips')
		.boundingBox();
	const actionsBox = await page.locator(".pos-navbar-actions-section").boundingBox();
	const overlap =
		chipsBox && actionsBox ? Math.max(0, chipsBox.x + chipsBox.width - actionsBox.x) : null;
	const cashierChip = page.locator('[data-test="cashier-chip"]').first();
	const cashierText = (await cashierChip.textContent().catch(() => ""))?.trim() ?? "";
	const cashierTitle = await cashierChip.getAttribute("title").catch(() => null);

	mkdirSync(outDir, { recursive: true });
	await page.screenshot({ path: resolve(outDir, "navbar-1920.png"), clip: { x: 0, y: 0, width: 1920, height: 76 } });

	// ── The ticket panel ────────────────────────────────────────────────
	const dest = page.locator('[data-rail-destination="invoices"]').first();
	expect(await dest.isVisible().catch(() => false), "Facturas is on the rail").toBeTruthy();
	await dest.click();
	await page.locator('[data-testid="ledger-panel"]').waitFor({ timeout: 20_000 });
	await page.waitForTimeout(2_500);

	const firstRow = page.locator('[data-testid="ledger-table"] [role="row"], .ledger-row').first();
	if (await firstRow.isVisible().catch(() => false)) {
		await firstRow.click().catch(() => {});
		await page.keyboard.press("Enter");
		await page.waitForTimeout(2_000);
	}

	const panelText = (await page.locator('[data-testid="ledger-panel"]').textContent()) ?? "";
	const phone = await page
		.locator('[data-testid="ledger-panel-phone"]')
		.textContent()
		.catch(() => null);
	const crmRow = await page
		.locator('[data-testid="ledger-panel-crm"]')
		.textContent()
		.catch(() => null);
	await page.screenshot({ path: resolve(outDir, "facturas-panel.png") });

	const report = {
		capturedAt: new Date().toISOString(),
		overlapPx: overlap,
		cashierText,
		cashierTitle,
		panelNamesDay: /\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(
			panelText,
		),
		phone: phone?.trim() ?? null,
		crmRow: crmRow?.trim() ?? null,
	};
	writeFileSync(resolve(outDir, "facturas-navbar.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));

	expect(overlap, "chips stay out of the actions cluster").toBeLessThanOrEqual(0);
	expect(cashierText.split(/\s+/).length, "cashier chip is one word").toBeLessThanOrEqual(1);
	expect(report.panelNamesDay, "the panel names the ticket's day").toBe(true);
});
