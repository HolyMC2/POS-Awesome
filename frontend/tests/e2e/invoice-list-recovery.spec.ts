import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test.use({ serviceWorkers: "block", actionTimeout: 10000 });

const baseURL = process.env.POSA_SMOKE_BASE_URL;
test.skip(!baseURL?.includes(".lab.xoloitzcuintles.com"), "Lab-only recovery drill");

async function openCandidateRegister(page: Page) {
	page.on("pageerror", (error) => console.log("Browser error:", error.message));
	page.on("requestfailed", (request) => console.log("Failed request:", new URL(request.url()).pathname));
	// Exercise the current candidate bundle against real lab data, without publishing assets.
	const manifest = JSON.parse(readFileSync(resolve("../posawesome/public/dist/js/version.json"), "utf8"));
	const assetURLs: string[] = Object.values(manifest.assets).flat() as string[];
	const logicalName = (url: string) => url.split("?")[0].replace(/-[\w-]{8}(?=\.(?:js|css)$)/, "");
	await page.route("**/posapp**", async (route) => {
		if (route.request().resourceType() !== "document") return route.continue();
		const response = await route.fetch();
		const body = (await response.text()).replace(/\/assets\/posawesome\/dist\/js\/[^"'<>\s]+/g,
			(oldURL) => assetURLs.find((url) => logicalName(url) === logicalName(oldURL)) || oldURL);
		await route.fulfill({ response, body });
	});
	await page.route("**/assets/posawesome/dist/**", async (route) => {
		const relative = decodeURIComponent(new URL(route.request().url()).pathname.split("/dist/")[1]);
		const root = resolve("../posawesome/public/dist");
		const path = resolve(root, relative);
		if (!path.startsWith(`${root}/`) || !existsSync(path)) return route.continue();
		await route.fulfill({ path, contentType: path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : undefined });
	});
	const login = await page.request.post("/api/method/login", {
		form: { usr: process.env.POSA_SMOKE_USER!, pwd: process.env.POSA_SMOKE_PASSWORD! },
	});
	expect(login.ok(), `Lab login HTTP ${login.status()}`).toBe(true);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/posapp", { waitUntil: "domcontentloaded" });
	await expect(page.locator('[data-rail-destination="invoices"]').first()).toBeVisible({ timeout: 45000 });
	await page.waitForTimeout(5000);
	for (let pass = 0; pass < 3; pass++) {
		for (const label of [/^(close|cerrar)$/i, /^(set up later|configurar después)$/i, /^(dismiss|descartar)$/i]) {
			const button = page.getByRole("button", { name: label }).first();
			if (await button.isVisible()) {
				await button.click({ timeout: 1500 }).catch(() => {});
				await page.waitForTimeout(700);
			}
		}
		await page.waitForTimeout(500);
	}
}

test("catalogue controls leave space for products on desktop and laptop", async ({ page }) => {
	await openCandidateRegister(page);
	await page.setViewportSize({ width: 1724, height: 1025 });
	const catalog = page.getByTestId("catalog-drawer-panel");
	await page.getByRole("button", { name: /Browse catalogue|Explorar catálogo/i }).click();
	await page.waitForTimeout(800);
	await expect(catalog).toBeVisible();
	await expect(catalog.locator(".catalog-drawer__footer")).toHaveCount(0);
	const toolbar = catalog.locator(".catalog-toolbar");
	await expect(toolbar).toBeVisible();
	const dimensions = await toolbar.evaluate((element) => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, overflow: element.scrollWidth > element.clientWidth }));
	expect(dimensions.height).toBeLessThan(65);
	expect(dimensions.overflow).toBe(false);
	await toolbar.getByRole("button", { name: /^(Card|Tarjeta)$/i }).click();
	await page.waitForTimeout(700);
	await page.screenshot({ path: "/tmp/pos-closing-review/compact-catalog-desktop.png" });
	await page.setViewportSize({ width: 1195, height: 741 });
	await page.waitForTimeout(500);
	const narrow = await toolbar.evaluate((element) => ({ height: element.getBoundingClientRect().height, overflow: element.scrollWidth > element.clientWidth }));
	expect(narrow.height).toBeLessThan(110);
	expect(narrow.overflow).toBe(false);
});

test("invoice list explains a failed read and retries without losing its destination", async ({ page }) => {
	await openCandidateRegister(page);
	let fail = true;
	let failedReads = 0;
	await page.route("**/api/method/frappe.client.get_list", async (route) => {
		const body = route.request().postData() || "";
		if (fail && /Sales.?Invoice|POS.?Invoice|Sales%20Invoice|POS%20Invoice/.test(body)) {
			failedReads++;
			return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Lab connection interruption" }) });
		}
		return route.continue();
	});
	await page.locator('[data-rail-destination="invoices"]').first().click();
	const ledger = page.getByTestId("ledger-surface");
	await expect(ledger).toBeVisible();
	const alert = ledger.getByRole("alert");
	await expect(alert).toContainText(/saved work|trabajo guardado/, { timeout: 15000 });
	expect(failedReads).toBeGreaterThan(0);
	await page.screenshot({ path: "/tmp/pos-closing-review/invoice-read-error-desktop.png" });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: "/tmp/pos-closing-review/invoice-read-error-phone.png" });
	fail = false;
	await alert.getByRole("button").click();
	await expect(alert).toBeHidden({ timeout: 20000 });
	await expect(ledger).toBeVisible();
	await expect(page.locator('[data-destination="invoices"]')).toBeVisible();
	await page.screenshot({ path: "/tmp/pos-closing-review/invoice-read-recovered-phone.png" });
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.locator('[data-rail-destination="drafts"]').first().click();
	await ledger.getByTestId("ledger-row").first().click();
	const band = page.locator('[data-testid="action-band"][data-kind="selectedDraft"]');
	await expect(band).toHaveAttribute("data-band-action", "draft.loadSelected");
	await expect(band.getByTestId("band-primary")).toBeEnabled();
	await page.screenshot({ path: "/tmp/pos-closing-review/selected-draft-desktop.png" });
	await band.getByTestId("band-primary").click();
	await expect(ledger).toBeHidden({ timeout: 20000 });
	await expect(page.locator('[data-pos-keyboard-target="cart-row"]').first()).toBeVisible({ timeout: 20000 });
});
