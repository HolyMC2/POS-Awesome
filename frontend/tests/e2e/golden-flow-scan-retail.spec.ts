/**
 * Golden flow `abarrotes-scan-basket-v1` — the Scan Retail certification
 * journey (boat seed_manifests.py, manifest abarrotes-comercio-thin).
 *
 * Encodes the manual drill that first ran 2026-08-16 on a lab abarrotes
 * tenant converged from bare: open shift with an opening balance →
 * mixed-rate basket with duplicate-scan quantity → exact cash tender →
 * submit → next basket ready. The server-side assertion at the end is the
 * drill's hardest-won lesson: the submitted invoice MUST carry a tax row —
 * the first drill sold a 16% item untaxed because only the item-level
 * 0%/exento half of the fiscal contract was seeded.
 *
 * Env (see playwright.config.ts .env.local loader):
 *   POSA_SMOKE_BASE_URL      target site (skips when absent)
 *   POSA_SMOKE_USER/PASSWORD cashier credentials
 *   POSA_GOLDEN_PATH         POS entry (default /app/posapp)
 *   POSA_GOLDEN_COMPANY      default "Abarrotes La Demo"
 *   POSA_GOLDEN_PROFILE      default "Mostrador Abarrotes"
 *
 * The basket items are the thin-seed starter catalog's drill trio and need
 * Item Prices + stock on the target (the drill runbook in the roadmap's
 * Product 2 status covers converging a bare tenant).
 */
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
const POS_PATH = process.env.POSA_GOLDEN_PATH || "/app/posapp";
const COMPANY = process.env.POSA_GOLDEN_COMPANY || "Abarrotes La Demo";
const PROFILE = process.env.POSA_GOLDEN_PROFILE || "Mostrador Abarrotes";

// Mixed rates on purpose: two 0% alimento lines (one duplicate-scanned) and
// one 16% line, so the invoice-level tax assertion can never pass vacuously.
const ZERO_RATE_ITEM = "Tortilla de maíz (kg)";
const ZERO_RATE_ITEM_2 = "Leche entera 1 L";
const TAXED_ITEM = "Detergente en polvo (kg)";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set — skipping golden-flow E2E.");

async function login(page: Page) {
	const user = process.env.POSA_SMOKE_USER;
	const password = process.env.POSA_SMOKE_PASSWORD;
	if (!user || !password) {
		throw new Error("Golden-flow E2E requires POSA_SMOKE_USER and POSA_SMOKE_PASSWORD");
	}
	const response = await page.request.post("/api/method/login", {
		form: { usr: user, pwd: password },
	});
	expect(response.ok(), `login returned HTTP ${response.status()}`).toBeTruthy();
}

async function pickIfNeeded(page: Page, label: string, value: string) {
	const field = page.locator(`.v-input:has-text('${label}')`).first();
	const shown = await field.innerText().catch(() => "");
	if (shown.includes(value)) {
		return; // single-option fields arrive pre-selected for a plain cashier
	}
	await field.locator("input").first().click();
	await page
		.locator(`.v-overlay-container .v-list-item:has-text('${value}')`)
		.first()
		.click();
	await page.waitForTimeout(800);
}

async function openShiftIfAsked(page: Page) {
	const dialog = page.getByText("Create POS Opening Shift");
	try {
		await dialog.waitFor({ timeout: 15_000 });
	} catch {
		return; // shift already open — the register resumes it
	}
	// Company first: the profile list is keyed on it. Two cashier-reality
	// traps the Administrator-only first run never hit: (a) a single-option
	// autocomplete arrives PRE-SELECTED, so clicking for a dropdown stalls
	// on the field's own selection text; (b) the nav drawer renders the
	// company name too, so an unscoped getByText().first() resolves to an
	// invisible node. Skip pre-filled fields; pick real list items.
	await pickIfNeeded(page, "Company", COMPANY);
	await page.waitForTimeout(1_000);
	await pickIfNeeded(page, "POS Profile", PROFILE);
	await page.waitForTimeout(1_500);
	await page
		.locator(".v-table input, table input")
		.last()
		.fill("500")
		.catch(() => {});
	await page.getByRole("button", { name: /submit/i }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
}

async function addItem(page: Page, term: string, rowText: string) {
	const box = page
		.locator(".v-input:has-text('Search, scan or browse') input, input[placeholder*='scan']")
		.first();
	await box.click();
	await box.fill(term);
	await page.waitForTimeout(1_500);
	// Typing opens the catalogue drawer on the matches (a82e74b31) and the
	// rail layout renders the CART before the drawer in DOM order — so a
	// page-wide first() lands on the just-added cart row's name, which
	// expands the row editor over the register and wedges the flow. Pick
	// the match inside the drawer panel, like a cashier does.
	const drawer = page.locator('[data-testid="catalog-drawer-panel"]');
	const scope = (await drawer.isVisible().catch(() => false)) ? drawer : page;
	await scope.getByText(rowText, { exact: false }).first().click();
	await page.waitForTimeout(800);
	await box.fill("");
}

test("scan-retail golden flow: shift → mixed basket → cash → submitted taxed invoice", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await login(page);
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);
	await openShiftIfAsked(page);

	await addItem(page, "Tortilla", ZERO_RATE_ITEM);
	await addItem(page, "Tortilla", ZERO_RATE_ITEM); // duplicate scan → qty 2
	await addItem(page, "Leche entera", ZERO_RATE_ITEM_2);
	await addItem(page, "Detergente", TAXED_ITEM);

	// Duplicate-scan quantity behaviour (§4.1): one row, qty 2.
	await expect(page.getByText("2.00").first()).toBeVisible({ timeout: 10_000 });

	await page.getByRole("button", { name: /^pay$/i }).first().click();
	// Cash prefills the exact total (change 0) — completing the sale is the
	// legacy dialog's «Submit» below the two-column boundary, or the band's
	// «COLLECT AND CLOSE» when Cobro is hosted beside the rail (§14.2) —
	// same submit() either way, so the certification accepts either surface.
	// On a resumed shift (no opening dialog) the first Pay click occasionally
	// lands before the invoice round-trip arms the panel and nothing opens —
	// one measured re-click keeps the unattended job flake-free.
	const submit = page
		.getByRole("button", { name: /^submit$|collect and close/i })
		.first();
	try {
		await submit.waitFor({ state: "visible", timeout: 20_000 });
	} catch {
		await page.getByRole("button", { name: /^pay$/i }).first().click();
		await submit.waitFor({ state: "visible", timeout: 30_000 });
	}
	await submit.click();

	// Next basket ready: the cart empties without a reload.
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });

	// Server-side truth, not UI truth: the newest submitted POS invoice
	// carries the basket and a NON-ZERO tax total (the 16% line's IVA).
	const list = await page.request.get(
		"/api/method/frappe.client.get_list?" +
			new URLSearchParams({
				doctype: "Sales Invoice",
				filters: JSON.stringify({ docstatus: 1, is_pos: 1 }),
				fields: JSON.stringify([
					"name",
					"grand_total",
					"total_qty",
					"total_taxes_and_charges",
				]),
				order_by: "creation desc",
				limit_page_length: "1",
			}),
	);
	expect(list.ok()).toBeTruthy();
	const invoice = (await list.json()).message?.[0];
	expect(invoice, "no submitted POS invoice found after the flow").toBeTruthy();
	expect(Number(invoice.total_qty)).toBeGreaterThanOrEqual(4);
	expect(
		Number(invoice.total_taxes_and_charges),
		"16% line sold UNTAXED — the company sales-template half is missing " +
			"(assertion accounting.sales_taxes_template_default)",
	).toBeGreaterThan(0);
});
