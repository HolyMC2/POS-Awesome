import { expect, test } from "@playwright/test";

test.skip(
	process.env.POSA_FLOOR_FIXTURE !== "1",
	"Opt-in local restaurant layout fixture",
);
const sizes = [
	[320, 568],
	[390, 844],
	[844, 390],
	[768, 1024],
	[1024, 768],
	[1440, 900],
];
for (const [width, height] of sizes) {
	test(`Mesas remain readable and actionable at ${width}x${height}`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width, height });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(
			"/assets/posawesome/dist/js/tests/visual/fixtures/mesas.html",
		);
		await expect(page.locator(".floor-view")).toBeVisible();
		if (width < 640)
			await expect(
				page.locator('[data-test="floor-view-list"]'),
			).toHaveAttribute("aria-pressed", "true");
		await page.locator('[data-test="floor-view-list"]').click();
		const search = page.locator('[data-test="floor-search"]');
		await search.fill("sofia");
		await expect(page.locator(".floor-kanban__card")).toHaveCount(1);
		await page.locator('[data-test="kanban-card-Mesa 1"]').click();
		if (width < 900) {
			const sheet = page.locator('[data-test="table-action-sheet"]');
			await expect(sheet).toBeVisible();
			await expect(sheet).toContainText("charged separately");
			await expect(
				sheet.locator('[data-test="table-sheet-charge"]'),
			).toHaveCount(0);
			await page.getByTestId("table-sheet-close").click();
		} else {
			await expect(
				page.locator('[data-test="mesa-sheet"]'),
			).toBeVisible();
			await expect(
				page.locator('[data-test="mesa-sheet-new-account"]'),
			).toBeVisible();
		}
		await expect(search).toHaveValue("sofia");
		await search.fill("");
		await page.locator('[data-test="floor-filter-cleaning"]').click();
		await expect(page.locator(".floor-kanban__card")).toHaveCount(1);
		await expect(page.locator("button button")).toHaveCount(0);
		await page.locator('[data-test="floor-filter-all"]').click();
		const last = page.locator(".floor-kanban__card").last();
		await last.scrollIntoViewIfNeeded();
		await expect(last).toBeInViewport({ ratio: 1 });
		const overflow = await page.evaluate(() =>
			[
				...document.querySelectorAll<HTMLElement>(
					".floor-view, .floor-view *",
				),
			]
				.filter(
					(el) =>
						el.checkVisibility() &&
						el.clientWidth > 0 &&
						el.scrollWidth > el.clientWidth + 2 &&
						/auto|scroll/.test(getComputedStyle(el).overflowX),
				)
				.map((el) => el.className),
		);
		expect(overflow).toEqual([]);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth + 1,
			),
		).toBe(true);
		await page.evaluate(() => {
			const f = (window as any).__mesasFixture.floor;
			f.activeOrder = f.orders[0];
		});
		const ticket = page.locator('[data-test="floor-ticket-panel"]');
		if (width < 900) {
			await expect(ticket).toBeVisible();
			await expect(ticket).toContainText("Mesa 1");
			await expect(ticket).toContainText("Sofía");
			await page
				.locator('[data-test="floor-transfer"]')
				.scrollIntoViewIfNeeded();
			await expect(
				page.locator('[data-test="floor-transfer"]'),
			).toBeInViewport({ ratio: 1 });
		}
		await page.locator('[data-test="tabs-rail-new"]').click();
		const name = page.locator('[data-test="new-tab-name"]');
		await expect(name).toBeVisible();
		await name.pressSequentially("Sofía 12");
		await name.press("Enter");
		await expect
			.poll(() =>
				page.evaluate(() =>
					(window as any).__mesasFixture.intents.some(
						(intent: any) =>
							intent.type === "open-tab" &&
							intent.name === "Sofía 12",
					),
				),
			)
			.toBe(true);
		await expect(name).toBeHidden();
		await page
			.locator('[data-test="floor-view-list"]')
			.scrollIntoViewIfNeeded();
		await page.screenshot({ path: info.outputPath("mesas-list.png") });
		const plan = page.locator('[data-test="floor-view-plan"]');
		if (await plan.isEnabled()) {
			await plan.click();
			await expect(
				page.locator('[data-test="floor-tile-Mesa 1"]'),
			).toBeVisible();
			await expect(page.locator("button button")).toHaveCount(0);
		}
		if (width < 640) {
			await page.evaluate(() => {
				(window as any).__mesasFixture.floor.floors[0].layout = {
					cols: 24,
					rows: 16,
					cell: 44,
				};
			});
			await expect(plan).toBeDisabled();
			await expect(search).toBeVisible();
		}
		expect(errors).toEqual([]);
	});
}
