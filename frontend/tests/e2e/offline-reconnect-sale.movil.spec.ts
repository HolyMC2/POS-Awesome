/**
 * Offline sale drill — the PHONE shell (MOVIL, < 768px).
 *
 * The same five sentences as `offline-reconnect-sale.spec.ts`, rung up the way
 * a cashier does it on a phone: Browse card taps, the Cart's primary, the
 * Cobro keypad's COLLECT AND CLOSE. The phone has its own offline layer
 * (`MobileOfflineOverlay`, "Keep selling"), its own queue view and its own
 * collect handler, none of which the desktop drill exercises.
 *
 *   A. cable out → sale queues → survives a reload → syncs itself on reconnect
 *   B. uplink dead, Wi-Fi up → the phone notices by itself → queues → drains
 *   C. ack lost on an online collect → the register resolves it alone
 *   D. ack lost while the queue drains → reconciled, not re-drafted
 *   E. ack lost AND the server gone → parks itself → replay finds the booking
 *
 * Env: the same POSA_SMOKE_* / POSA_GOLDEN_* variables as the golden lane.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { CutProxy } from "./support/cutProxy";
import {
	BASE_URL,
	POS_PATH,
	activeRows,
	login,
	openShiftIfAsked,
	readInvoiceQueue,
	serverInvoicesByRequestId,
	waitForQueueDrained,
	waitForServerInvoices,
} from "./support/registerDrill";

const ZERO_RATE_ITEM = "Tortilla de maíz (kg)";
const ZERO_RATE_ITEM_2 = "Leche entera 1 L";
const SUBMIT_URL = "**/api/method/posawesome.posawesome.api.invoices.submit_invoice";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set — skipping the phone offline drill.");
test.describe.configure({ mode: "serial" });

const PROXY_PORT = 18300 + (process.pid % 200);
test.use({
	proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
	actionTimeout: 15_000,
});
const proxy = new CutProxy(PROXY_PORT);
test.beforeAll(async () => proxy.listen());
test.afterAll(async () => proxy.close());
test.afterEach(() => proxy.restore());

const dock = (page: Page, id: string) => page.locator(`[data-testid="dock-${id}"]`);
const card = (page: Page, code: string) => page.locator(`[data-testid="browse-card-${code}"]`);

/** Boot the phone register: coarse pointer, login, shift, dock visible. */
async function openPhoneRegister(page: Page) {
	// hasTouch alone does not flip `(pointer: coarse)` in headless Chromium,
	// and the shell picks the phone chrome by pointer as well as by width.
	await page.addInitScript(() => {
		const native = window.matchMedia.bind(window);
		window.matchMedia = ((query: string) => {
			if (/pointer:\s*coarse/.test(query)) {
				return {
					matches: true,
					media: query,
					addEventListener() {},
					removeEventListener() {},
					addListener() {},
					removeListener() {},
					onchange: null,
					dispatchEvent: () => false,
				} as unknown as MediaQueryList;
			}
			return native(query);
		}) as typeof window.matchMedia;
	});
	await login(page);
	await page.goto(POS_PATH, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(8_000);
	await openShiftIfAsked(page);
	await expect(page.locator('[data-testid="mobile-dock"]')).toBeVisible({ timeout: 30_000 });
}

/**
 * What actually receives a tap at the card's centre. The offline layer is
 * positioned over the whole screen above the dock; if it is what the finger
 * lands on, the phone cannot ring up a sale offline, whatever the card says.
 */
async function whatCoversTheCard(page: Page, code: string) {
	return page.evaluate((selector) => {
		const el = document.querySelector(selector);
		if (!el) return "card-not-in-dom";
		el.scrollIntoView({ block: "center", inline: "nearest" });
		const r = el.getBoundingClientRect();
		const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
		if (!hit) return `nothing (card at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)})`;
		if (el.contains(hit)) return null;
		const overlay = hit.closest("[data-testid]");
		return overlay?.getAttribute("data-testid") || hit.tagName.toLowerCase();
	}, `[data-testid="browse-card-${code}"]`);
}

async function showCard(page: Page, code: string, term: string) {
	await dock(page, "browse").click();
	const target = card(page, code);
	if (await target.isVisible().catch(() => false)) return target;
	await page.locator('[data-testid="browse-search"]').click();
	const query = page.locator('[data-testid="browse-query"]');
	await query.fill(term);
	await expect(target).toBeVisible({ timeout: 20_000 });
	return target;
}

/** Search once while online so the catalogue is in the local cache. */
async function warmCatalogue(page: Page) {
	await showCard(page, ZERO_RATE_ITEM, "Tortilla");
}

async function phoneAddItem(page: Page, code: string, term: string) {
	const target = await showCard(page, code, term);
	const covered = await whatCoversTheCard(page, code);
	expect(
		covered,
		`«${code}» cannot be tapped: «${covered}» sits over the catalogue — the phone cannot ring up a sale in this state`,
	).toBeNull();
	await target.click();
	await page.waitForTimeout(600);
}

async function ringUpBasket(page: Page) {
	await phoneAddItem(page, ZERO_RATE_ITEM, "Tortilla");
	await phoneAddItem(page, ZERO_RATE_ITEM_2, "Leche");
	// The band above the dock is the phone's running total.
	await expect(page.getByText(/\b2 lines \|/).first()).toBeVisible({ timeout: 10_000 });
}

/** Cart → primary → Cobro → COLLECT AND CLOSE (exact tender, print). */
async function collectAndClose(page: Page) {
	await dock(page, "cart").click();
	await expect(page.locator('[data-testid="movil-cart"]')).toBeVisible({ timeout: 15_000 });
	await page.locator('[data-testid="movil-primary"]').click();
	await expect(page.locator('[data-testid="movil-cobro"]')).toBeVisible({ timeout: 20_000 });
	const collect = page.locator('[data-testid="movil-collect"]');
	await expect(collect).toBeEnabled({ timeout: 30_000 });
	await collect.click();
}

/** The cart is empty again — the phone's «next customer» state. */
async function expectCartEmpty(page: Page) {
	await expect(page.getByText(/\b0 lines \|/).first()).toBeVisible({ timeout: 30_000 });
}

async function theQueuedSale(page: Page) {
	await expect.poll(async () => activeRows(await readInvoiceQueue(page)).length, { timeout: 20_000 }).toBe(1);
	const sale = activeRows(await readInvoiceQueue(page))[0]!;
	expect(sale.client_request_id, "queued sale carries no request id").toMatch(/^inv-/);
	return sale;
}

function loseFirstAck(page: Page, afterServerBooked?: () => void) {
	const seen: string[] = [];
	const handler = async (route: Route) => {
		const body = route.request().postDataJSON() as Record<string, string> | null;
		let requestId = "";
		try {
			requestId = JSON.parse(body?.invoice || "{}")?.posa_client_request_id || "";
		} catch {
			/* a body the register did not send as JSON is itself a finding */
		}
		seen.push(requestId);
		if (seen.length > 1) return route.continue();
		await route.fetch();
		afterServerBooked?.();
		await route.abort("connectionreset");
	};
	return {
		install: () => page.route(SUBMIT_URL, handler),
		uninstall: () => page.unroute(SUBMIT_URL, handler),
		seen,
	};
}

const overlay = (page: Page) => page.locator('[data-testid="offline-overlay"]');

/**
 * The cashier's move when the sheet appears: fold it into the strip so the
 * catalogue is theirs again. Asserts the fold, not just the tap.
 */
async function continueSelling(page: Page) {
	await expect(overlay(page)).toBeVisible({ timeout: 30_000 });
	await page.locator('[data-testid="offline-overlay-continue"]').click();
	await expect(page.locator('[data-testid="offline-overlay-strip"]')).toBeVisible({ timeout: 10_000 });
	await expect(overlay(page)).toHaveAttribute("data-offline-collapsed", "true");
}

test("A. phone, network gone: the sale queues, survives a reload, and syncs itself once on reconnect", async ({
	context,
	page,
}) => {
	test.setTimeout(300_000);
	await openPhoneRegister(page);
	await warmCatalogue(page);

	await context.setOffline(true);
	await expect(overlay(page)).toBeVisible({ timeout: 30_000 });
	await expect(overlay(page)).toContainText(/keep selling/i);
	await continueSelling(page);

	await ringUpBasket(page);
	await collectAndClose(page);
	await expect(page.getByText("Invoice saved offline")).toBeVisible({ timeout: 20_000 });
	const sale = await theQueuedSale(page);
	const requestId = sale.client_request_id!;
	await expectCartEmpty(page);
	// The strip's one number: what the shop has taken but not banked.
	await expect(page.locator('[data-testid="offline-overlay-strip"]')).toContainText(/1 ticket/i);
	expect(await serverInvoicesByRequestId(page, requestId)).toHaveLength(0);

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator('[data-testid="mobile-dock"]')).toBeVisible({ timeout: 90_000 });
	expect(activeRows(await readInvoiceQueue(page)).map((row) => row.client_request_id)).toEqual([
		requestId,
	]);

	await context.setOffline(false);
	const drained = await waitForQueueDrained(page);
	expect(drained.find((row) => row.client_request_id === requestId)?.status).toBe("synced");
	await expect(overlay(page)).toBeHidden({ timeout: 30_000 });

	const invoices = await waitForServerInvoices(page, requestId, 1);
	expect(invoices).toHaveLength(1);
	expect(invoices[0]!.docstatus).toBe(1);
	expect(Number(invoices[0]!.grand_total)).toBe(Number(sale.grand_total));
});

test("B. phone, uplink dead with Wi-Fi up: the phone notices by itself, queues, and drains when the server is back", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openPhoneRegister(page);
	await warmCatalogue(page);

	proxy.sever();
	await expect(overlay(page)).toBeVisible({ timeout: 90_000 });
	await continueSelling(page);

	await ringUpBasket(page);
	await collectAndClose(page);
	await expect(page.getByText("Invoice saved offline")).toBeVisible({ timeout: 20_000 });
	const sale = await theQueuedSale(page);

	proxy.restore();
	const drained = await waitForQueueDrained(page, 150_000);
	expect(drained.find((row) => row.client_request_id === sale.client_request_id)?.status).toBe(
		"synced",
	);
	const invoices = await waitForServerInvoices(page, sale.client_request_id!, 1);
	expect(invoices.map((row) => row.docstatus)).toEqual([1]);
});

test("C. phone, ack lost on an online collect: the register finds the booked invoice by itself", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openPhoneRegister(page);
	const ackMiss = loseFirstAck(page);
	await ackMiss.install();

	await ringUpBasket(page);
	await collectAndClose(page);
	await expect(page.getByText(/was already submitted/i)).toBeVisible({ timeout: 30_000 });
	await expectCartEmpty(page);
	await ackMiss.uninstall();

	expect(ackMiss.seen).toHaveLength(1);
	const requestId = ackMiss.seen[0]!;
	expect(requestId).toMatch(/^inv-/);
	const invoices = await serverInvoicesByRequestId(page, requestId);
	expect(invoices.map((row) => row.docstatus)).toEqual([1]);
	expect(activeRows(await readInvoiceQueue(page))).toEqual([]);
});

test("E. phone, ack lost AND the server gone: the sale parks itself, and the replay finds the booked invoice", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openPhoneRegister(page);
	await warmCatalogue(page);
	const ackMiss = loseFirstAck(page, () => proxy.sever());
	await ackMiss.install();

	await ringUpBasket(page);
	await collectAndClose(page);
	await expect(page.getByText(/sale saved on this register/i)).toBeVisible({ timeout: 30_000 });
	const sale = await theQueuedSale(page);
	expect(sale.client_request_id).toBe(ackMiss.seen[0]);

	proxy.restore();
	const drained = await waitForQueueDrained(page, 150_000);
	await ackMiss.uninstall();
	expect(drained.find((row) => row.client_request_id === sale.client_request_id)?.status).toBe(
		"synced",
	);
	const invoices = await serverInvoicesByRequestId(page, sale.client_request_id!);
	expect(invoices.map((row) => row.docstatus)).toEqual([1]);
});

test("D. phone, ack lost while the queue drains: reconciled by request id, not re-drafted", async ({
	context,
	page,
}) => {
	test.setTimeout(300_000);
	await openPhoneRegister(page);
	await warmCatalogue(page);

	await context.setOffline(true);
	await continueSelling(page);
	await ringUpBasket(page);
	await collectAndClose(page);
	const sale = await theQueuedSale(page);

	const ackMiss = loseFirstAck(page);
	await ackMiss.install();
	await context.setOffline(false);

	const drained = await waitForQueueDrained(page, 150_000);
	await ackMiss.uninstall();
	const row = drained.find((entry) => entry.client_request_id === sale.client_request_id);
	expect(row?.status, JSON.stringify(row)).toBe("synced");
	expect(ackMiss.seen[0]).toBe(sale.client_request_id);
	const invoices = await serverInvoicesByRequestId(page, sale.client_request_id!);
	expect(invoices.map((entry) => entry.docstatus)).toEqual([1]);
});
