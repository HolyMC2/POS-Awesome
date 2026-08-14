/**
 * Live restaurant-floor acceptance journey.
 *
 * The lab fixture belongs to the Playwright bot's open `MCC ARQ Profile 2`
 * shift. `Mesa 1` intentionally carries an empty open account: this is the
 * regression shape where Charge must not be offered and the exact account
 * must still be resumable.
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_SMOKE_PATH || "/posapp";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set — skipping live floor E2E.");

async function login(page: Page) {
	const user = process.env.POSA_SMOKE_USER;
	const password = process.env.POSA_SMOKE_PASSWORD;
	if (!user || !password) {
		throw new Error("Restaurant E2E requires POSA_SMOKE_USER and POSA_SMOKE_PASSWORD");
	}
	const response = await page.request.post("/api/method/login", {
		form: { usr: user, pwd: password },
	});
	expect(response.ok(), `login returned HTTP ${response.status()}`).toBeTruthy();
}

async function openFloor(page: Page) {
	await login(page);
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => Boolean((window as any).__posawesomeWebEntry), {
		timeout: 60_000,
	});
	await expect(page.locator("#posa-app .v-application").first()).toBeVisible({
		timeout: 30_000,
	});
	// The shared bot may inherit the shift-closing review dialog left open by
	// an earlier smoke run. Dismiss it without submitting or mutating the shift.
	const shiftClose = page.getByRole("button", { name: /Close closing shift dialog/i });
	const shiftReviewAppeared = await shiftClose
		.waitFor({ state: "visible", timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	if (shiftReviewAppeared) {
		await shiftClose.click({ force: true });
		await expect(shiftClose).toBeHidden();
	}

	const floorDock = page.getByRole("button", { name: /^(Floor|Mesas)( — \d+)?$/i });
	await expect(floorDock).toBeVisible({ timeout: 30_000 });
	await floorDock.click();
	await expect(page.locator('[data-test="floor-tab-f6-salon-principal"]')).toBeVisible({
		timeout: 30_000,
	});
	await page.locator('[data-test="floor-tab-f6-salon-principal"]').click();
}

test.describe("restaurant floor live acceptance", () => {
	test("desktop: empty open account is resumable but cannot be charged", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await openFloor(page);

		await page.locator('[data-test="floor-tile-Mesa 1"]').click();
		const sheet = page.locator('[data-test="table-action-sheet"]');
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('[data-test="table-sheet-charge"]')).toHaveCount(0);
		await expect(sheet.locator('[data-test="table-sheet-view"]')).toBeVisible();

		await sheet.locator('[data-test="table-sheet-view"]').click();
		await expect(page.getByRole("button", { name: /^Cart$/i })).toHaveClass(/mobile-dock__tab--active/);
		await expect(page.getByRole("textbox", { name: /Tab Name/i })).toBeVisible();
	});

	test("phone: floor and table sheet remain reachable with touch-size controls", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openFloor(page);

		const tile = page.locator('[data-test="floor-tile-Mesa 1"]');
		await expect(tile).toBeVisible();
		const tileBox = await tile.boundingBox();
		expect(tileBox?.width).toBeGreaterThanOrEqual(44);
		expect(tileBox?.height).toBeGreaterThanOrEqual(44);
		await tile.click();

		const sheet = page.locator('[data-test="table-action-sheet"]');
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('[data-test="table-sheet-cancel"]')).toBeVisible();
		await expect(sheet.locator('[data-test="table-sheet-charge"]')).toHaveCount(0);
	});
});
