import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Real lab reads, no invoice/payment/shift submission. Set
// POSA_RESPONSIVE_CANDIDATE=1 to serve the local build only to this browser.
// POSA_RESPONSIVE_CHECK=1 checks the deployed build after publication.
// Opt-in because normal pre-deploy CI still reaches the previous lab build.
test.skip(
	process.env.POSA_RESPONSIVE_CANDIDATE !== "1" &&
		process.env.POSA_RESPONSIVE_CHECK !== "1",
	"Opt-in responsive release check",
);
test.skip(
	!process.env.POSA_SMOKE_BASE_URL?.includes(".lab.xoloitzcuintles.com"),
	"Lab only",
);
test.use({ serviceWorkers: "block", actionTimeout: 15000, hasTouch: true });

async function openRegister(page: Page) {
	if (process.env.POSA_RESPONSIVE_CANDIDATE === "1") {
		const root = resolve("../posawesome/public/dist");
		const manifest = JSON.parse(
			readFileSync(`${root}/js/version.json`, "utf8"),
		);
		const assets = Object.values(manifest.assets).flat() as string[];
		const logical = (url: string) =>
			url.split("?")[0].replace(/-[\w-]{8}(?=\.(?:js|css)$)/, "");
		await page.route("**/posapp**", async (route) => {
			if (route.request().resourceType() !== "document")
				return route.continue();
			const response = await route.fetch();
			const body = (await response.text()).replace(
				/\/assets\/posawesome\/dist\/js\/[^"'<>\s]+/g,
				(old) =>
					assets.find((url) => logical(url) === logical(old)) || old,
			);
			await route.fulfill({ response, body });
		});
		await page.route("**/assets/posawesome/dist/**", async (route) => {
			const path = resolve(
				root,
				decodeURIComponent(
					new URL(route.request().url()).pathname.split("/dist/")[1],
				),
			);
			if (!path.startsWith(`${root}/`) || !existsSync(path))
				return route.continue();
			await route.fulfill({
				path,
				contentType: path.endsWith(".js")
					? "application/javascript"
					: path.endsWith(".css")
						? "text/css"
						: undefined,
			});
		});
	}
	const login = await page.request.post("/api/method/login", {
		form: {
			usr: process.env.POSA_SMOKE_USER!,
			pwd: process.env.POSA_SMOKE_PASSWORD!,
		},
	});
	expect(login.ok(), `Lab login HTTP ${login.status()}`).toBe(true);
	await page.goto("/posapp", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".pos-main-container")).toBeVisible({
		timeout: 60000,
	});
	await expect(page.locator(".loading-container")).toBeHidden({
		timeout: 60000,
	});
	// Printer setup is scheduled after boot. It is unrelated to layout and
	// must be deferred before the nav can receive a real click.
	await page.waitForTimeout(4000);
	for (let pass = 0; pass < 2; pass++) {
		for (const name of [
			/^(set up later|configurar después)$/i,
			/^(close|cerrar)$/i,
			/^(dismiss|descartar)$/i,
		]) {
			const button = page.getByRole("button", { name }).first();
			if (await button.isVisible())
				await button.click({ timeout: 1500 }).catch(async (error) => {
					// A startup snackbar may disappear between visibility and click.
					if (await button.isVisible()) throw error;
				});
		}
		await page.waitForTimeout(500);
	}
}

test("catalogue last row stays above the dock across compact sizes", async ({
	page,
}, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 390, height: 720 });
	await openRegister(page);
	for (const [width, height] of [
		[320, 568],
		[390, 720],
		[768, 1024],
		[1024, 768],
		[844, 390],
	]) {
		await page.setViewportSize({ width, height });
		const lastPrice = page.locator(".mbrowse-card__price").last();
		await expect(lastPrice).toBeVisible({ timeout: 30000 });
		await lastPrice.scrollIntoViewIfNeeded();
		await expect(lastPrice).toBeInViewport({ ratio: 0.99 });
		const priceBox = (await lastPrice.boundingBox())!;
		const dockBox = (await page.getByTestId("mobile-dock").boundingBox())!;
		expect(priceBox.y + priceBox.height).toBeLessThanOrEqual(dockBox.y);
		await assertScrollLayout(page);
		await page.screenshot({
			path: info.outputPath(`catalogue-${width}x${height}.png`),
		});
	}
});

async function navigate(page: Page, id: string) {
	const compact = page.viewportSize()!.width < 1100;
	if (compact) await page.locator(".nav-icon:visible").click();
	const item = page.locator(
		`[${compact ? "data-nav-destination" : "data-rail-destination"}="${id}"]:visible`,
	);
	if (!(await item.count()))
		await page
			.getByTestId(compact ? "mobile-nav-more" : "rail-tools")
			.click();
	await item.first().click();
	if (id === "dashboard")
		await expect(page.locator(".awesome-dashboard-view")).toBeVisible({
			timeout: 60000,
		});
	else if (id !== "sale")
		await expect(page.locator(`[data-destination="${id}"]`)).toBeVisible();
}

async function assertScrollLayout(page: Page) {
	const geometry = await page.evaluate(() => {
		const visible = (el: Element) => {
			const box = el.getBoundingClientRect();
			return (
				el.checkVisibility({
					checkVisibilityCSS: true,
					checkOpacity: true,
				}) &&
				box.height > 0 &&
				box.width > 0 &&
				box.right > 0 &&
				box.left < innerWidth &&
				box.bottom > 0 &&
				box.top < innerHeight
			);
		};
		const elements = [
			...document.querySelectorAll<HTMLElement>(
				".page-content,.page-content *",
			),
		].filter(visible);
		const scrollers = elements.filter(
			(el) =>
				el.clientHeight > 0 &&
				el.scrollHeight > el.clientHeight + 3 &&
				/auto|scroll/.test(getComputedStyle(el).overflowY),
		);
		const horizontal = elements.filter(
			(el) =>
				el.clientWidth > 0 &&
				el.scrollWidth > el.clientWidth + 3 &&
				/auto|scroll/.test(getComputedStyle(el).overflowX),
		);
		return {
			horizontal: horizontal.map((el) => el.className),
			pageWidth: document.documentElement.scrollWidth,
			pageHeight: document.documentElement.scrollHeight,
			width: innerWidth,
			height: innerHeight,
			nested: scrollers
				.filter((el) =>
					scrollers.some(
						(parent) => parent !== el && parent.contains(el),
					),
				)
				.map((el) => el.className),
		};
	});
	expect(geometry.pageWidth, "page pans sideways").toBeLessThanOrEqual(
		geometry.width + 1,
	);
	expect(
		geometry.pageHeight,
		"page scrolls around its inner panel",
	).toBeLessThanOrEqual(geometry.height + 1);
	expect(geometry.nested, "nested vertical scrollports").toEqual([]);
	if (geometry.width < 1100)
		expect(geometry.horizontal, "mobile sideways scrollports").toEqual([]);
}

for (const [width, height] of [
	[320, 568],
	[390, 720],
	[430, 932],
	[768, 1024],
	[1024, 768],
	[844, 390],
	[1100, 700],
	[1280, 720],
	[1440, 900],
	[1920, 1080],
]) {
	test(`register controls remain reachable at ${width}×${height}`, async ({
		page,
	}, info) => {
		test.setTimeout(180000);
		await page.setViewportSize({ width, height });
		await page.addInitScript(
			(dark) =>
				localStorage.setItem(
					"posawesome_theme_preference",
					dark ? "dark" : "light",
				),
			width === 390 || width === 1024,
		);
		await openRegister(page);
		await assertScrollLayout(page);
		if (width === 390) {
			await page
				.getByRole("button", {
					name: /^(open actions menu|abrir menú de acciones)$/i,
				})
				.click();
			await page.getByTestId("pos-support-entry").click();
			await expect(page.locator(".muelle-support-dialog")).toBeVisible();
			await page.locator(".muelle-support-dialog [data-close]").click();
			await expect(page.locator("#muelle-support-workflow")).toBeHidden();
		}

		await navigate(page, "recharge");
		await expect(
			page.locator('[data-testid^="recargas-carrier-"]').first(),
		).toBeVisible({ timeout: 30000 });
		const telcel = page.getByTestId("recargas-carrier-TELCEL");
		const carrier = (await telcel.count())
			? telcel
			: page
					.locator('[data-testid^="recargas-carrier-"]')
					.filter({ hasText: /telcel/i })
					.first();
		await carrier.click();
		await page.getByTestId("recargas-reference").fill("5512345678");
		await page.locator("#recargas-reference-confirm").fill("5512345678");
		await page.locator('[data-testid^="recargas-amount-"]').first().click();
		const primary = page.getByTestId("band-primary");
		await expect(primary).toBeEnabled();
		await expect(primary).toBeInViewport();
		await assertScrollLayout(page);
		await page.screenshot({ path: info.outputPath("recharge.png") });
		if (width === 390) {
			// Emulate an iOS-style keyboard: only visualViewport changes.
			await page.evaluate(() => {
				Object.defineProperty(window.visualViewport!, "height", {
					configurable: true,
					value: 430,
				});
				window.visualViewport!.dispatchEvent(new Event("resize"));
			});
			await expect
				.poll(
					async () =>
						(await page.getByTestId("mobile-dock").boundingBox())!
							.y +
						(await page.getByTestId("mobile-dock").boundingBox())!
							.height,
				)
				.toBeLessThanOrEqual(431);
			await page
				.getByTestId("recargas-reference")
				.scrollIntoViewIfNeeded();
			await expect(
				page.getByTestId("recargas-reference"),
			).toBeInViewport();
			await expect(primary).toBeInViewport();
			await page.screenshot({
				path: info.outputPath("recharge-keyboard.png"),
			});
			await page.evaluate(() => {
				delete (window.visualViewport as any).height;
				window.visualViewport!.dispatchEvent(new Event("resize"));
			});
			for (const [rotatedWidth, rotatedHeight] of [
				[844, 390],
				[1280, 720],
				[width, height],
			]) {
				await page.setViewportSize({
					width: rotatedWidth,
					height: rotatedHeight,
				});
				await expect(
					page.getByTestId("recargas-reference"),
				).toHaveValue("5512345678");
				await expect(primary).toBeEnabled();
				await expect(primary).toBeInViewport();
				await assertScrollLayout(page);
			}
		}

		await navigate(page, "invoices");
		await page
			.locator('[data-testid="ledger-surface"] [role="tab"]')
			.filter({ hasText: /pending|pendiente/i })
			.click();
		await expect(page.getByTestId("ledger-row").first()).toBeVisible({
			timeout: 30000,
		});

		const last = page.getByTestId("ledger-row").last();
		await last.scrollIntoViewIfNeeded();
		await expect(last).toBeInViewport();
		await assertScrollLayout(page);
		await page.screenshot({ path: info.outputPath("invoices.png") });
		await last.click();
		const invoiceActions = page.getByTestId("ledger-panel-actions");
		await invoiceActions.scrollIntoViewIfNeeded();
		await expect(invoiceActions).toBeInViewport();
		await assertScrollLayout(page);
		await page.screenshot({ path: info.outputPath("invoice-detail.png") });
		if (width < 768) await page.getByTestId("ledger-sheet-close").click();

		await navigate(page, "payments");
		const search = page.getByTestId("cobranza-search");
		await search.fill("ACC");
		const searchBox = await search.boundingBox();
		expect(searchBox!.x).toBeGreaterThanOrEqual(0);
		expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(width + 1);
		await assertScrollLayout(page);
		await page.getByTestId("cobranza-manual-payment").click();
		await expect(page.locator(".pay-view")).toBeVisible();
		const submit = page.getByTestId("pay-submit-print");
		await submit.scrollIntoViewIfNeeded();
		await expect(submit).toBeInViewport({ ratio: 1 });
		const actionBox = await submit.boundingBox();
		expect(actionBox!.height).toBeGreaterThanOrEqual(48);
		expect(actionBox!.x).toBeGreaterThanOrEqual(0);
		expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(width + 1);
		await assertScrollLayout(page);
		await page.screenshot({ path: info.outputPath("payment-entry.png") });
	});
}

test("mobile catalogue names, menu dismissal and invoice return stay usable", async ({
	page,
}, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 390, height: 720 });
	await openRegister(page);
	const names = page.locator(".mbrowse-card__name");
	await expect(names.first()).toBeVisible();
	expect(
		await names.evaluateAll((elements) =>
			elements.every(
				(el) =>
					el.scrollHeight <= el.clientHeight + 1 &&
					parseFloat(getComputedStyle(el).fontSize) >= 14,
			),
		),
	).toBe(true);
	await page.screenshot({ path: info.outputPath("readable-catalogue.png") });
	await page.locator(".nav-icon:visible").click();
	const navClose = page.getByTestId("mobile-nav-close");
	await expect(navClose).toBeInViewport();
	expect((await navClose.boundingBox())!.width).toBeGreaterThanOrEqual(44);
	await navClose.click();
	await expect(page.getByTestId("mobile-nav-panel")).not.toBeInViewport();
	await navigate(page, "invoices");
	await page
		.locator('[data-testid="ledger-surface"] [role="tab"]')
		.filter({ hasText: /pending|pendiente/i })
		.click();
	await expect(page.getByTestId("ledger-row").first()).toBeVisible();
	const query = page.getByTestId("ledger-finder-input");
	await query.fill("ACC-SINV");
	await page.waitForTimeout(800);
	for (const [width, height] of [
		[390, 720],
		[320, 568],
		[390, 430],
	]) {
		await page.setViewportSize({ width, height });
		expect(
			await query.evaluate((el) =>
				parseFloat(getComputedStyle(el).fontSize),
			),
		).toBeGreaterThanOrEqual(16);
		const row = page.getByTestId("ledger-row").last();
		await row.scrollIntoViewIfNeeded();
		const scroller = page.locator(".ledger-surface__scroll");
		const scrollTop = await scroller.evaluate((el) => el.scrollTop);
		await row.click();
		const panel = page.getByTestId("ledger-panel");
		await expect(panel).toBeVisible();
		await expect(scroller).toHaveAttribute("inert", "");
		const close = page.getByTestId("ledger-sheet-close");
		await close.scrollIntoViewIfNeeded();
		await expect(close).toBeInViewport({ ratio: 1 });
		expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
		await close.focus();
		await page.keyboard.press("Shift+Tab");
		await expect(
			panel
				.locator("button:enabled, a[href]")
				.filter({ visible: true })
				.last(),
		).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(close).toBeFocused();
		await assertScrollLayout(page);
		await page.screenshot({
			path: info.outputPath(`ticket-${width}x${height}.png`),
		});
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("ledger-sheet")).toBeHidden();
		await expect(row).toBeFocused();
		await expect(query).toHaveValue("ACC-SINV");
		expect(
			Math.abs(
				(await scroller.evaluate((el) => el.scrollTop)) - scrollTop,
			),
		).toBeLessThanOrEqual(2);
	}
});
