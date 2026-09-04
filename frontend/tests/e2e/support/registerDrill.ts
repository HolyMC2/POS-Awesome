/**
 * Shared moves for e2e drills that operate the real register on a lab
 * tenant. Locators mirror `golden-flow-scan-retail.spec.ts` (the daily
 * certification lane) so a UI change breaks both in the same place.
 *
 * Env (see playwright.config.ts .env.local loader):
 *   POSA_SMOKE_BASE_URL      target site (specs skip when absent)
 *   POSA_SMOKE_USER/PASSWORD cashier credentials
 *   POSA_GOLDEN_PATH         POS entry (default /app/posapp)
 *   POSA_GOLDEN_COMPANY      default "Abarrotes La Demo"
 *   POSA_GOLDEN_PROFILE      default "Mostrador Abarrotes"
 */
import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.POSA_SMOKE_BASE_URL;
export const POS_PATH = process.env.POSA_GOLDEN_PATH || "/app/posapp";
const COMPANY = process.env.POSA_GOLDEN_COMPANY || "Abarrotes La Demo";
const PROFILE = process.env.POSA_GOLDEN_PROFILE || "Mostrador Abarrotes";

export async function login(page: Page) {
	const user = process.env.POSA_SMOKE_USER;
	const password = process.env.POSA_SMOKE_PASSWORD;
	if (!user || !password) {
		throw new Error("Register drills require POSA_SMOKE_USER and POSA_SMOKE_PASSWORD");
	}
	const response = await page.request.post("/api/method/login", {
		form: { usr: user, pwd: password },
	});
	expect(response.ok(), `login returned HTTP ${response.status()}`).toBeTruthy();
}

async function pickIfNeeded(page: Page, label: string, value: string) {
	const field = page.locator(`.v-input:has-text('${label}')`).first();
	const shown = await field.innerText().catch(() => "");
	if (shown.includes(value)) return;
	await field.locator("input").first().click();
	await page.locator(`.v-overlay-container .v-list-item:has-text('${value}')`).first().click();
	await page.waitForTimeout(800);
}

export async function openShiftIfAsked(page: Page) {
	const dialog = page.getByText("Create POS Opening Shift");
	try {
		await dialog.waitFor({ timeout: 15_000 });
	} catch {
		return;
	}
	await pickIfNeeded(page, "Company", COMPANY);
	await page.waitForTimeout(1_000);
	await pickIfNeeded(page, "POS Profile", PROFILE);
	await page.waitForTimeout(1_500);
	await page.locator(".v-table input, table input").last().fill("500").catch(() => {});
	await page.getByRole("button", { name: /submit/i }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
}

export function searchBox(page: Page) {
	return page
		.locator(".v-input:has-text('Search, scan or browse') input, input[placeholder*='scan']")
		.first();
}

/** Boot the register: login, open the POS, resume/open the shift. */
export async function openRegister(page: Page) {
	await login(page);
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);
	await openShiftIfAsked(page);
	await expect(searchBox(page)).toBeVisible({ timeout: 30_000 });
}

export async function addItem(page: Page, term: string, rowText: string) {
	const box = searchBox(page);
	await box.click();
	await box.fill(term);
	await page.waitForTimeout(1_500);
	const drawer = page.locator('[data-testid="catalog-drawer-panel"]');
	const scope = (await drawer.isVisible().catch(() => false)) ? drawer : page;
	await scope.getByText(rowText, { exact: false }).first().click();
	await page.waitForTimeout(800);
	await box.fill("");
}

/** Pay → primary submit, exactly as the certification lane does it. */
export async function payCashAndSubmit(page: Page) {
	await page.getByRole("button", { name: /^pay$/i }).first().click();
	const submit = page
		.getByRole("button", { name: /^submit$|charge and print|collect and close/i })
		.first();
	try {
		await submit.waitFor({ state: "visible", timeout: 20_000 });
	} catch {
		await page.getByRole("button", { name: /^pay$/i }).first().click();
		await submit.waitFor({ state: "visible", timeout: 30_000 });
	}
	await submit.click();
	return submit;
}

/** The navbar's connectivity word: Online / Offline / Limited / Checking. */
export function connectivityLabel(page: Page) {
	return page.locator(".status-title-inline").first();
}

export interface QueuedSale {
	queue_id: number;
	status: string;
	client_request_id: string | null;
	grand_total: number | null;
	last_error: string | null;
	draft_invoice_name: string | null;
	draft_reason: string | null;
}

/**
 * The invoice rows of the REAL write queue, read straight out of IndexedDB
 * (`posawesome_offline` / `write_queue`) — not through the app, so a UI that
 * lies about its queue cannot pass this.
 */
export async function readInvoiceQueue(page: Page): Promise<QueuedSale[]> {
	return page.evaluate(
		() =>
			new Promise<QueuedSale[]>((resolve, reject) => {
				const request = indexedDB.open("posawesome_offline");
				request.onerror = () => reject(request.error);
				request.onblocked = () => reject(new Error("posawesome_offline open blocked"));
				request.onsuccess = () => {
					const db = request.result;
					try {
						const tx = db.transaction("write_queue", "readonly");
						const all = tx.objectStore("write_queue").getAll();
						all.onerror = () => {
							db.close();
							reject(all.error);
						};
						all.onsuccess = () => {
							db.close();
							resolve(
								(all.result as any[])
									.filter((row) => row.entity_type === "invoice")
									.map((row) => ({
										queue_id: row.queue_id,
										status: row.status,
										client_request_id:
											row.payload?.invoice?.posa_client_request_id ?? null,
										grand_total: row.payload?.invoice?.grand_total ?? null,
										last_error: row.last_error ?? null,
										draft_invoice_name: row.draft_invoice_name ?? null,
										draft_reason: row.draft_reason ?? null,
									})),
							);
						};
					} catch (error) {
						db.close();
						reject(error);
					}
				};
			}),
	);
}

const ACTIVE = new Set(["pending", "syncing", "retrying", "failed"]);

export function activeRows(rows: QueuedSale[]) {
	return rows.filter((row) => ACTIVE.has(row.status));
}

/** Wait until the queue holds no active invoice — the drain has to happen by itself. */
export async function waitForQueueDrained(page: Page, timeoutMs = 90_000) {
	const startedAt = Date.now();
	let rows: QueuedSale[] = [];
	while (Date.now() - startedAt < timeoutMs) {
		rows = await readInvoiceQueue(page).catch(() => []);
		if (rows.length && activeRows(rows).length === 0) return rows;
		await page.waitForTimeout(1_000);
	}
	throw new Error(`offline queue did not drain in ${timeoutMs}ms: ${JSON.stringify(rows)}`);
}

export interface ServerInvoice {
	name: string;
	docstatus: number;
	grand_total: number;
	total_qty: number;
	posa_client_request_id: string;
}

/** Server truth for one sale: every invoice carrying this request id, any docstatus. */
export async function serverInvoicesByRequestId(page: Page, clientRequestId: string) {
	const list = await page.request.get(
		"/api/method/frappe.client.get_list?" +
			new URLSearchParams({
				doctype: "Sales Invoice",
				filters: JSON.stringify({ posa_client_request_id: clientRequestId }),
				fields: JSON.stringify([
					"name",
					"docstatus",
					"grand_total",
					"total_qty",
					"posa_client_request_id",
				]),
				limit_page_length: "10",
			}),
	);
	expect(list.ok(), `get_list returned HTTP ${list.status()}`).toBeTruthy();
	return ((await list.json()).message || []) as ServerInvoice[];
}

/** Poll the server until exactly `count` invoices carry the id, or time out. */
export async function waitForServerInvoices(
	page: Page,
	clientRequestId: string,
	count: number,
	timeoutMs = 60_000,
) {
	const startedAt = Date.now();
	let rows: ServerInvoice[] = [];
	while (Date.now() - startedAt < timeoutMs) {
		rows = await serverInvoicesByRequestId(page, clientRequestId);
		if (rows.length >= count) return rows;
		await page.waitForTimeout(1_000);
	}
	return rows;
}
