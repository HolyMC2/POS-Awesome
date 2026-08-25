/**
 * Tablet evidence — the register on a touch slate (~1340 css px, the owner's
 * tablet in landscape, 08-24 screenshots).
 *
 * Records the three tablet promises: no mount-time autofocus (the on-screen
 * keyboard must not summon itself over half the register), the bar's chips
 * and actions both fit inside the viewport, and the cart's column header is
 * static. Captures `docs/design-evidence/after/tablet-1340/venta.png` and
 * `payments.png`. Diagnostic, not a gate.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_VISUAL_PATH || "/posapp";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = resolve(repoRoot, "docs/design-evidence/after/tablet-1340");

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set.");
test.use({ actionTimeout: 8_000, navigationTimeout: 45_000, hasTouch: true });

const activeTag = (page: import("@playwright/test").Page) =>
	page.evaluate(() => document.activeElement?.tagName ?? "BODY");

test("a touch register neither summons its keyboard nor overflows its bar", async ({ page }) => {
	test.setTimeout(180_000);
	// Force the coarse-pointer media query BEFORE the app boots — Playwright's
	// hasTouch alone does not flip `(pointer: coarse)` in headless Chromium.
	await page.addInitScript(() => {
		const native = window.matchMedia.bind(window);
		window.matchMedia = ((query: string) => {
			if (/pointer:\s*coarse/.test(query)) {
				return { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as MediaQueryList;
			}
			return native(query);
		}) as typeof window.matchMedia;
	});
	const login = await page.request.post("/api/method/login", {
		form: { usr: process.env.POSA_SMOKE_USER!, pwd: process.env.POSA_SMOKE_PASSWORD! },
	});
	expect(login.ok(), `login ${login.status()}`).toBeTruthy();

	await page.setViewportSize({ width: 1340, height: 800 });
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

	// ── Venta: nothing focused, header static, bar inside its box ───────
	const ventaFocus = await activeTag(page);
	const headerPosition = await page
		.locator(".posa-cart-table th")
		.first()
		.evaluate((el) => getComputedStyle(el).position)
		.catch(() => "absent");
	const chipsBox = await page
		.locator('[data-testid="register-status-line"] .register-status-line__chips')
		.boundingBox();
	const actionsBox = await page.locator(".pos-navbar-actions-section").boundingBox();
	const chipsOverlap =
		chipsBox && actionsBox ? Math.max(0, chipsBox.x + chipsBox.width - actionsBox.x) : null;
	const actionsClipped = actionsBox ? Math.max(0, actionsBox.x + actionsBox.width - 1340) : null;

	mkdirSync(outDir, { recursive: true });
	await page.screenshot({ path: resolve(outDir, "venta.png") });

	// ── Cobranza: the search must not grab focus on a slate ─────────────
	await page.locator('[data-rail-destination="payments"]').first().click();
	await page.waitForTimeout(3_000);
	const cobranzaFocus = await activeTag(page);
	await page.screenshot({ path: resolve(outDir, "payments.png") });

	const report = {
		capturedAt: new Date().toISOString(),
		ventaFocus,
		cobranzaFocus,
		headerPosition,
		chipsOverlap,
		actionsClipped,
	};
	writeFileSync(resolve(outDir, "tablet-register.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));

	expect(ventaFocus, "Venta grabs no field on a slate").not.toBe("INPUT");
	expect(cobranzaFocus, "Cobranza grabs no field on a slate").not.toBe("INPUT");
	expect(headerPosition, "the cart header is static").not.toBe("sticky");
	expect(chipsOverlap, "chips stay out of the actions cluster").toBeLessThanOrEqual(0);
	expect(actionsClipped, "the actions cluster stays inside the viewport").toBeLessThanOrEqual(0);
});
