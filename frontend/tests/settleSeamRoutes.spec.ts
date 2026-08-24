import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";
import paymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import submissionSource from "../src/posapp/composables/pos/payments/usePaymentSubmission.ts?raw";
import storesIndexSource from "../src/posapp/stores/index.ts?raw";

/**
 * The mesa settle seam, and the routes that have to reach it.
 *
 * ## The bug this pins
 *
 * Charging a cuenta through Cobro submitted a Sales Invoice and left the POS
 * Table Order Open, then the post-submit cart clear pushed "remove every line"
 * at the still-attached order — a mesa reading occupied at 0.00.
 *
 * The seam existed. It never ran, and not for a reason any unit test could see:
 * the loader boots the SPA from `posawesome-<hash>.js?v=<build>`, while every
 * lazily imported chunk pulls the entry back by its RELATIVE specifier, which
 * carries no query. Two URLs are two module records, so `stores/index.ts`
 * evaluated twice and ran `createPinia()` twice. The app installed the stamped
 * copy's instance; `usePaymentSubmission`, living in `Payments-<hash>.js`, read
 * the bare copy's — a pinia with no register in it. `useFloorStore(pinia)` there
 * MINTED a fresh floor store, so `isRecordOnly` was false AND `activeOrder` was
 * null on every mesa charge. Verified in the browser on demo.lab: with Mesa 1
 * open the app's store read `{isRecordOnly: true, activeOrder: "5cef64ba…"}`
 * while the seam's store read `{isRecordOnly: false, activeOrder: null}`.
 *
 * Two things keep it fixed, and both are asserted here: the seam takes the
 * store from its caller, and `stores/index.ts` pins one pinia per document.
 */

vi.mock("../src/offline/index", () => ({
	isOffline: vi.fn(() => false),
	saveOfflineInvoice: vi.fn(),
	updateLocalStock: vi.fn(),
}));

vi.mock("../src/posapp/services/invoiceService", () => ({
	default: {
		submitInvoice: vi.fn(),
	},
}));

vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: {
		applyInvoiceConsumption: vi.fn(),
	},
}));

/** A cuenta-shaped floor store: only the slice the seam is allowed to touch. */
const makeFloorStore = (
	overrides: Record<string, any> = {},
	settleResult: any = {
		invoice: { name: "ACC-SINV-9001", doctype: "Sales Invoice", docstatus: 1 },
		queued: false,
		idempotent: false,
	},
) => {
	const store: any = {
		isRecordOnly: true,
		activeOrder: { order_uid: "ord-mesa-1" },
		settleActiveOrder: vi.fn(async () => {
			// The real action drops the order and detaches before it resolves.
			store.activeOrder = null;
			return settleResult;
		}),
		setActiveOrder: vi.fn((order: any) => {
			store.activeOrder = order;
		}),
		...overrides,
	};
	return store;
};

const buildSubmission = (floorStore: any | null) => {
	const invoiceDoc = ref<any>({
		name: "ACC-SINV-9001",
		doctype: "Sales Invoice",
		is_return: 0,
		items: [{ item_code: "CAPU-M", qty: 1, rate: 48 }],
		payments: [{ mode_of_payment: "Cash", amount: 48, type: "Cash" }],
		rounded_total: 48,
		grand_total: 48,
	});

	const { submitInvoice } = usePaymentSubmission({
		invoiceDoc,
		posProfile: ref({
			name: "Cafeteria Demo",
			create_pos_invoice_instead_of_sales_invoice: 0,
		}),
		stockSettings: ref({}),
		invoiceType: ref("Invoice"),
		formatFloat: (value) => Number(value || 0),
		stores: {
			toastStore: { show: vi.fn() },
			uiStore: {
				setLastInvoice: vi.fn(),
				setLastStockAdjustment: vi.fn(),
			},
			customersStore: { setSelectedCustomer: vi.fn() },
			invoiceStore: { invoiceDoc: invoiceDoc.value },
		},
		isCashback: ref(false),
		paidChange: ref(0),
		creditChange: ref(0),
		redeemedCustomerCredit: ref(0),
		customerCreditDict: ref([]),
		diff_payment: ref(0),
		restaurantTipAmount: ref(12),
		floorStore: floorStore ? () => floorStore : undefined,
	});

	return { submitInvoice, invoiceDoc };
};

describe("mesa settle seam", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() } });
	});

	it("settles THROUGH the cuenta instead of submitting a bare invoice", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		const floorStore = makeFloorStore();
		const { submitInvoice } = buildSubmission(floorStore);

		await submitInvoice(true, {
			onPrint: vi.fn(),
			onFinishNavigation: vi.fn(),
		});

		expect(floorStore.settleActiveOrder).toHaveBeenCalledTimes(1);
		expect(invoiceService.submitInvoice).not.toHaveBeenCalled();

		const [payload, tip] = (floorStore.settleActiveOrder as any).mock.calls[0];
		// `settle_table_order` reads the payload AS the invoice document and the
		// submit metadata from a nested `data` — it splits them straight back
		// into `submit_invoice(invoice, data)`. The tendered payments must ride
		// at the TOP level: nested one key deeper, `update_invoice` re-derives
		// the payments table from the POS Profile and zeroes it, and the server
		// rejects the sale with "El total pagado 0.0 no coincide con el total de
		// la factura 48.0". That is what the settle answered the first time this
		// seam ever ran in a browser.
		expect(payload.payments).toEqual([
			{ mode_of_payment: "Cash", amount: 48, type: "Cash" },
		]);
		expect(payload.doctype).toBe("Sales Invoice");
		expect(payload.data).toEqual(
			expect.objectContaining({ total_change: expect.any(Number) }),
		);
		expect(payload.invoice_doc).toBeUndefined();
		// The tip rides beside the payload — the server stamps
		// `posa_rt_tip_amount` from this argument, never from the invoice.
		expect(tip).toBe(12);
	});

	it("takes the retail submit when no floor store is wired", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-9001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});
		const { submitInvoice } = buildSubmission(null);

		await submitInvoice(false, { onFinishNavigation: vi.fn() });

		expect(invoiceService.submitInvoice).toHaveBeenCalledTimes(1);
	});

	it("takes the retail submit on a Sales Invoice register with no cuenta", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-9001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});
		const floorStore = makeFloorStore({
			isRecordOnly: false,
			activeOrder: null,
		});
		const { submitInvoice } = buildSubmission(floorStore);

		await submitInvoice(false, { onFinishNavigation: vi.fn() });

		expect(floorStore.settleActiveOrder).not.toHaveBeenCalled();
		expect(invoiceService.submitInvoice).toHaveBeenCalledTimes(1);
	});

	it("survives an idempotent replay that answers with the name only", async () => {
		const floorStore = makeFloorStore(
			{},
			{ salesInvoice: "ACC-SINV-9001", queued: false, idempotent: true },
		);
		const { submitInvoice } = buildSubmission(floorStore);
		const onFinishNavigation = vi.fn();

		await submitInvoice(false, { onFinishNavigation });

		expect(floorStore.settleActiveOrder).toHaveBeenCalledTimes(1);
		expect(onFinishNavigation).toHaveBeenCalledWith(true);
	});

	it("frees the register without printing when the settle queues offline", async () => {
		const floorStore = makeFloorStore({}, { queued: true });
		const { submitInvoice } = buildSubmission(floorStore);
		const onPrint = vi.fn();
		const onFinishNavigation = vi.fn();

		const result = await submitInvoice(true, { onPrint, onFinishNavigation });

		expect(result).toEqual({ queued: true, orderUid: "ord-mesa-1" });
		expect(onPrint).not.toHaveBeenCalled();
		expect(onFinishNavigation).toHaveBeenCalledWith(true);
	});

	/**
	 * The secondary damage. The cart clear that follows a sale bumps the cart's
	 * change version, and on a Record-Only register the floor's line sync
	 * answers that by pushing the cart's lines at `activeOrder`. An empty cart
	 * against a still-attached cuenta is "remove every line".
	 */
	it("detaches the cuenta BEFORE the register is cleared, on every route", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-9001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});
		const order: any = [];
		// A cuenta that is somehow still attached at submit time — the shape the
		// broken seam left behind, and the one the guard has to survive.
		const floorStore = makeFloorStore({
			isRecordOnly: true,
			activeOrder: { order_uid: "ord-mesa-1" },
			settleActiveOrder: vi.fn(),
			setActiveOrder: vi.fn(() => order.push("detach")),
		});
		// Not Record-Only, so the seam declines to settle and the plain submit
		// runs with the cuenta still attached.
		floorStore.isRecordOnly = false;
		const { submitInvoice } = buildSubmission(floorStore);

		await submitInvoice(false, {
			onFinishNavigation: () => order.push("clear-cart"),
		});

		expect(order).toEqual(["detach", "clear-cart"]);
		expect(floorStore.setActiveOrder).toHaveBeenCalledWith(null);
	});

	it("leaves a retail register's floor store alone", async () => {
		const invoiceService = (
			await import("../src/posapp/services/invoiceService")
		).default;
		(invoiceService.submitInvoice as any).mockResolvedValue({
			name: "ACC-SINV-9001",
			doctype: "Sales Invoice",
			docstatus: 1,
		});
		const floorStore = makeFloorStore({
			isRecordOnly: false,
			activeOrder: null,
		});
		const { submitInvoice } = buildSubmission(floorStore);

		await submitInvoice(false, { onFinishNavigation: vi.fn() });

		expect(floorStore.setActiveOrder).not.toHaveBeenCalled();
	});
});

describe("settle seam route coverage", () => {
	/**
	 * `Payments.vue` cannot be mounted under vitest — it drags the whole payment
	 * stack through `.js` specifiers only the vite pipeline resolves, the same
	 * reason `cobroSurface.spec.ts` pins its contract at source level. So the
	 * routes are enumerated against the source: every gesture that finalises a
	 * sale must funnel into `submitInvoiceWrapper`, which is the ONE caller of
	 * the seam-bearing `submitInvoice`.
	 */
	const SUBMIT_ENTRYPOINTS: Array<[string, RegExp]> = [
		// Cobro's «Cobrar e imprimir» — the button the P1 was reproduced on.
		[
			"cobro charge-and-print button",
			/data-testid="cobro-charge-and-print"[\s\S]{0,200}@click="submit\(undefined, false, true\)"/,
		],
		// The hosted/compact payment sheet's own charge button.
		[
			"hosted sheet submit-and-print",
			/@submit-and-print="submit\(undefined, false, true\)"/,
		],
		// Alt+P / Alt+X, and the bus-queued shortcut the dock replays.
		["Alt+P print shortcut", /key === "p"[\s\S]{0,160}submit\(null, false, true\)/],
		["Alt+X submit shortcut", /key === "x"[\s\S]{0,160}submit\(null, false, false\)/],
		[
			"queued shortcut submit",
			/handleSubmitPaymentShortcut[\s\S]{0,320}submit\(null, false, print\)/,
		],
		// The M-Pesa / request-payment callback finalises the same sale.
		["payment-methods onSubmit", /onSubmit: \(args, submitPrint\) => \{[\s\S]{0,120}submitInvoiceWrapper\(submitPrint/],
	];

	it.each(SUBMIT_ENTRYPOINTS)("%s reaches the shared submit", (_name, pattern) => {
		expect(paymentsSource).toMatch(pattern);
	});

	it("routes every `submit(...)` gesture through the one wrapper", () => {
		expect(paymentsSource).toMatch(
			/const submit = async \(_event, payment_received = false, print = false\) => \{\s*await submitInvoiceWrapper\(/,
		);
		// Exactly one caller of the composable's submitInvoice, so there is no
		// second route that could skip the seam.
		const callers = paymentsSource.match(/\bawait submitInvoice\(/g) || [];
		expect(callers).toHaveLength(1);
	});

	it("hands the seam the component's own floor store", () => {
		expect(paymentsSource).toMatch(/const floorStore = useFloorStore\(\);/);
		expect(paymentsSource).toMatch(
			/usePaymentSubmission\(\{[\s\S]*?floorStore: \(\) => floorStore,[\s\S]*?\}\);/,
		);
	});

	it("never resolves a store from a module-level pinia inside the seam", () => {
		// The exact shape of the bug: a lazily-imported chunk reaching for the
		// entry bundle's `pinia` binding gets a SECOND instance.
		expect(submissionSource).not.toMatch(/useFloorStore\(/);
		expect(submissionSource).not.toMatch(/from "\.\.\/\.\.\/\.\.\/stores"/);
	});

	it("pins one pinia per document so the duplicate entry cannot mint a second", () => {
		expect(storesIndexSource).toMatch(/Symbol\.for\("posawesome\.pinia"\)/);
		expect(storesIndexSource).toMatch(/\|\|= createPinia\(\)/);
		// One call in the CODE — the doc comment names it too — so the memoised
		// branch is the only way an instance gets built.
		const code = storesIndexSource.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(code.match(/createPinia\(\)/g) || []).toHaveLength(1);
	});
});
