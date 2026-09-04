/**
 * Offline sale drill — the claim on muelle.mx, run against the real register.
 *
 * «Sigue cobrando sin internet: si se cae la conexión la venta se guarda en la
 * caja y se sincroniza sola cuando vuelve. Nada se pierde ni se cobra dos
 * veces.» Four sentences, five tests, each read back from the two places
 * that cannot lie: the write queue in IndexedDB and the tenant's invoices.
 *
 *   A. the cable is out (navigator.onLine false) — the sale queues, survives a
 *      reload while still offline, and syncs itself once the network is back.
 *   B. the uplink is dead but Wi-Fi is up (navigator.onLine TRUE) — the shop's
 *      real outage. Goes through `CutProxy` so the server actually vanishes.
 *   C. the ack is lost on an online Cobrar (server booked it, response died) —
 *      the cashier's retry must find the same invoice, never mint a second.
 *   D. the ack is lost while the queue drains — the drain must reconcile by
 *      request id, not fall back to a duplicate draft.
 *   E. the ack is lost because the uplink died at that instant — the register
 *      cannot ask, so it parks the sale; the replay must find the booking.
 *
 * Before 2026-09-04 this file drove a stub page at posawesome.test with its
 * own IndexedDB, and never loaded the POS. Keep it honest: every assertion
 * here is against the tenant.
 *
 * Env: the same POSA_SMOKE_* / POSA_GOLDEN_* variables as the golden lane
 * (frontend/.env.golden.local for demo-abarrotes.lab).
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { CutProxy } from "./support/cutProxy";
import {
	BASE_URL,
	activeRows,
	addItem,
	connectivityLabel,
	openRegister,
	payCashAndSubmit,
	readInvoiceQueue,
	searchBox,
	serverInvoicesByRequestId,
	waitForQueueDrained,
	waitForServerInvoices,
} from "./support/registerDrill";

const ZERO_RATE_ITEM = "Tortilla de maíz (kg)";
const ZERO_RATE_ITEM_2 = "Leche entera 1 L";
const SUBMIT_URL = "**/api/method/posawesome.posawesome.api.invoices.submit_invoice";

test.skip(!BASE_URL, "POSA_SMOKE_BASE_URL not set — skipping offline drill.");
test.describe.configure({ mode: "serial" });

// The browser rides the cut-able proxy for the whole file so test B can pull
// the uplink without touching navigator.onLine. A and C/D are unaffected by
// a healthy proxy.
const PROXY_PORT = 18090 + (process.pid % 200);
test.use({ proxy: { server: `http://127.0.0.1:${PROXY_PORT}` } });
const proxy = new CutProxy(PROXY_PORT);
test.beforeAll(async () => proxy.listen());
test.afterAll(async () => proxy.close());
test.afterEach(() => proxy.restore());

/** Search once online so the catalogue is in the local cache before the cut. */
async function warmCatalogue(page: Page) {
	const box = searchBox(page);
	await box.click();
	await box.fill("Tortilla");
	await expect(page.getByText(ZERO_RATE_ITEM).first()).toBeVisible({ timeout: 20_000 });
	await box.fill("");
	await page.keyboard.press("Escape");
}

async function ringUpBasket(page: Page) {
	await addItem(page, "Tortilla", ZERO_RATE_ITEM);
	await addItem(page, "Leche entera", ZERO_RATE_ITEM_2);
}

/** The one queued sale, read from IndexedDB, with its request id. */
async function theQueuedSale(page: Page) {
	const queued = activeRows(await readInvoiceQueue(page));
	expect(queued, "exactly one sale should be waiting in the queue").toHaveLength(1);
	const sale = queued[0]!;
	expect(sale.client_request_id, "queued sale carries no request id").toMatch(/^inv-/);
	return sale;
}

/**
 * Let the server book the FIRST submit and then kill the response — the
 * ack-miss. Later calls pass. Returns the request id the register sent.
 */
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

test("A. network gone: the sale queues, survives a reload, and syncs itself once on reconnect", async ({
	context,
	page,
}) => {
	test.setTimeout(300_000);
	await openRegister(page);
	await warmCatalogue(page);

	await context.setOffline(true);
	await expect(connectivityLabel(page)).toHaveText(/offline/i, { timeout: 30_000 });

	await ringUpBasket(page);
	await payCashAndSubmit(page);
	await expect(page.getByText("Invoice saved offline")).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });

	const sale = await theQueuedSale(page);
	const requestId = sale.client_request_id!;
	// Nothing reached the server — the queue is the only copy of this sale.
	expect(await serverInvoicesByRequestId(page, requestId)).toHaveLength(0);

	// «se guarda en la caja»: a reload while STILL offline must bring the
	// register back with the sale still waiting.
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(searchBox(page)).toBeVisible({ timeout: 90_000 });
	expect(activeRows(await readInvoiceQueue(page)).map((row) => row.client_request_id)).toEqual([
		requestId,
	]);

	// «se sincroniza sola»: no button, no reload — the network comes back and
	// the queue has to leave on its own.
	await context.setOffline(false);
	const drained = await waitForQueueDrained(page);
	expect(drained.find((row) => row.client_request_id === requestId)?.status).toBe("synced");

	// «nada se pierde ni se cobra dos veces»
	const invoices = await waitForServerInvoices(page, requestId, 1);
	expect(invoices).toHaveLength(1);
	expect(invoices[0]!.docstatus).toBe(1);
	expect(Number(invoices[0]!.grand_total)).toBe(Number(sale.grand_total));
});

test("B. uplink dead, Wi-Fi up: the register notices by itself, queues the sale, and drains when the server is back", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openRegister(page);
	await warmCatalogue(page);

	proxy.sever();
	// The browser still says online; the register has to work it out from the
	// dead socket / failed probe. «Offline» or «Limited» both mean it did.
	await expect(connectivityLabel(page)).toHaveText(/offline|limited/i, { timeout: 90_000 });

	await ringUpBasket(page);
	await payCashAndSubmit(page);
	await expect(page.getByText("Invoice saved offline")).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });
	const sale = await theQueuedSale(page);
	const requestId = sale.client_request_id!;

	proxy.restore();
	const drained = await waitForQueueDrained(page, 150_000);
	expect(drained.find((row) => row.client_request_id === requestId)?.status).toBe("synced");
	const invoices = await waitForServerInvoices(page, requestId, 1);
	expect(invoices).toHaveLength(1);
	expect(invoices[0]!.docstatus).toBe(1);
});

test("C. ack lost on an online Cobrar: the register finds the booked invoice by itself, never a second one", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openRegister(page);
	const ackMiss = loseFirstAck(page);
	await ackMiss.install();

	await ringUpBasket(page);
	await payCashAndSubmit(page);
	// The server booked it; the register only saw the call die. It must
	// resolve that alone — no second press, no cashier decision — and close
	// the sale as submitted.
	await expect(page.getByText(/was already submitted/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });
	await ackMiss.uninstall();

	expect(ackMiss.seen).toHaveLength(1);
	const requestId = ackMiss.seen[0]!;
	expect(requestId).toMatch(/^inv-/);
	const invoices = await serverInvoicesByRequestId(page, requestId);
	expect(invoices.map((row) => row.docstatus)).toEqual([1]);
	// And nothing was parked for a later replay.
	expect(activeRows(await readInvoiceQueue(page))).toEqual([]);
});

test("E. ack lost AND the server gone: the sale parks itself, and the replay finds the booked invoice", async ({
	page,
}) => {
	test.setTimeout(300_000);
	await openRegister(page);
	await warmCatalogue(page);
	// The worst version of C: the response is lost because the uplink died
	// right then, so the register cannot even ask whether it was booked.
	const ackMiss = loseFirstAck(page, () => proxy.sever());
	await ackMiss.install();

	await ringUpBasket(page);
	await payCashAndSubmit(page);
	await expect(page.getByText(/sale saved on this register/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });
	const sale = await theQueuedSale(page);
	expect(sale.client_request_id).toBe(ackMiss.seen[0]);

	proxy.restore();
	const drained = await waitForQueueDrained(page, 150_000);
	await ackMiss.uninstall();
	expect(drained.find((row) => row.client_request_id === sale.client_request_id)?.status).toBe(
		"synced",
	);
	// One booking: the replay returned the invoice the aborted call created.
	const invoices = await serverInvoicesByRequestId(page, sale.client_request_id!);
	expect(invoices.map((row) => row.docstatus)).toEqual([1]);
});

test("D. ack lost while the queue drains: the drain reconciles by request id instead of drafting a duplicate", async ({
	context,
	page,
}) => {
	test.setTimeout(300_000);
	await openRegister(page);
	await warmCatalogue(page);

	await context.setOffline(true);
	await expect(connectivityLabel(page)).toHaveText(/offline/i, { timeout: 30_000 });
	await ringUpBasket(page);
	await payCashAndSubmit(page);
	await expect(page.getByText("No items in cart")).toBeVisible({ timeout: 30_000 });
	const sale = await theQueuedSale(page);
	const requestId = sale.client_request_id!;

	const ackMiss = loseFirstAck(page);
	await ackMiss.install();
	await context.setOffline(false);

	const drained = await waitForQueueDrained(page, 150_000);
	await ackMiss.uninstall();
	const row = drained.find((entry) => entry.client_request_id === requestId);
	// `draft_review` here would mean a second document carrying the same
	// request id — submittable from Desk, i.e. the double charge.
	expect(row?.status, JSON.stringify(row)).toBe("synced");
	expect(ackMiss.seen[0]).toBe(requestId);

	const invoices = await serverInvoicesByRequestId(page, requestId);
	expect(invoices.map((entry) => entry.docstatus)).toEqual([1]);
});
