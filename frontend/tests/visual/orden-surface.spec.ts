/**
 * Orden de servicio evidence — the queue on a live register.
 *
 * Captures `docs/design-evidence/after/desktop-1440/orden-listas.png` and
 * `orden-entregadas.png`, and records the facts the 08-24 fix promised:
 * «En trabajo» renders as a right-aligned FIGURE (a span, never a button),
 * «Entregadas» actually switches buckets, and — with Taller's
 * `use_pos_charge_requests` now ON in the lab — the ready queue holds real
 * cards. Diagnostic, not a gate — same posture as `rail-tools.spec.ts`.
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

test("«En trabajo» is a figure, «Entregadas» is a door that opens", async ({ page }) => {
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

	const dest = page.locator('[data-rail-destination="serviceOrder"]').first();
	expect(await dest.isVisible().catch(() => false), "Orden de servicio is on the rail").toBeTruthy();
	await dest.click();
	await page.locator('[data-testid="orden-surface"]').waitFor({ timeout: 20_000 });
	await page.waitForTimeout(2_500);

	const figure = page.locator('[data-testid="orden-working-figure"]').first();
	const figureVisible = await figure.isVisible().catch(() => false);
	const figureTag = figureVisible
		? await figure.evaluate((el) => el.tagName)
		: null;
	const figureTitle = figureVisible ? await figure.getAttribute("title") : null;
	const figureText = figureVisible ? (await figure.textContent())?.trim() : null;

	const readyCards = await page.locator('[data-testid^="orden-card-"]').count();
	const buckets = await page.evaluate(() =>
		Array.from(document.querySelectorAll("[data-bucket]")).map((el) => ({
			bucket: el.getAttribute("data-bucket"),
			tag: el.tagName,
			pressed: el.getAttribute("aria-pressed"),
		})),
	);

	mkdirSync(outDir, { recursive: true });
	await page.screenshot({ path: resolve(outDir, "orden-listas.png") });

	// The door that was reported dead: press it and watch the bucket move.
	await page.locator('button[data-bucket="delivered"]').click();
	await page.waitForTimeout(2_500);
	const deliveredPressed = await page
		.locator('button[data-bucket="delivered"]')
		.getAttribute("aria-pressed");
	const deliveredCards = await page.locator('[data-testid^="orden-card-"]').count();
	const deliveredEmpty = await page
		.locator('[data-testid="orden-empty"]')
		.textContent()
		.catch(() => null);
	await page.screenshot({ path: resolve(outDir, "orden-entregadas.png") });

	const report = {
		capturedAt: new Date().toISOString(),
		figureVisible,
		figureTag,
		figureTitle,
		figureText,
		buckets,
		readyCards,
		deliveredPressed,
		deliveredCards,
		deliveredEmpty: deliveredEmpty?.trim() ?? null,
	};
	writeFileSync(resolve(outDir, "orden-surface.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));

	expect(figureVisible, "the workshop figure is drawn").toBeTruthy();
	expect(figureTag, "the figure is not a button").not.toBe("BUTTON");
	expect(figureTitle ?? "", "the figure explains itself").toContain("Taller");
	expect(readyCards, "the ready bucket holds cards (flag on, Cobrar ran)").toBeGreaterThan(0);
	expect(deliveredPressed, "Entregadas takes the press").toBe("true");
});
