// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { close_payments, show_payment } from "../src/posapp/components/pos/invoice_utils/dialogs";

/** Stands in for the pinia uiStore, whose refs unwrap on property access. */
const createUiStoreStub = () => ({
	paymentRequestPending: false,
	beginPaymentRequest: vi.fn(function (this: any) {
		this.paymentRequestPending = true;
	}),
	endPaymentRequest: vi.fn(function (this: any) {
		this.paymentRequestPending = false;
	}),
	openPaymentDialog: vi.fn(),
	closePaymentDialog: vi.fn(),
	setActiveView: vi.fn(),
});

const createPaymentContext = () => ({
	_suppressClosePaymentsTimer: null,
	_suppressClosePayments: false,
	customer: "CUST-001",
	items: [{ item_code: "ITEM-001" }],
	validate: vi.fn(async () => true),
	ensure_auto_batch_selection: vi.fn(async () => {}),
	invoiceType: "Invoice",
	pos_profile: { currency: "USD" },
	invoice_doc: {},
	process_invoice: vi.fn(async () => ({
		doctype: "Sales Invoice",
		grand_total: 10,
		rounded_total: 10,
		total: 10,
		payments: [],
	})),
	process_invoice_from_order: vi.fn(),
	reload_current_invoice_from_backend: vi.fn(),
	selected_currency: "USD",
	conversion_rate: 1,
	_getPlcConversionRate: () => 1,
	flt: (value: unknown) => Number(value || 0),
	currency_precision: 2,
	float_precision: 2,
	isReturnInvoice: false,
	get_payments: () => [],
	$nextTick: async () => {},
	uiStore: createUiStoreStub(),
	eventBus: { emit: vi.fn() },
	toastStore: { show: vi.fn() },
});

describe("invoice payment dialogs", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { call: vi.fn() });
		Object.defineProperty(window, "innerWidth", {
			value: 500,
			writable: true,
			configurable: true,
		});
	});

	it("switches compact layout to the selector when opening payments", async () => {
		const context = createPaymentContext();

		await show_payment(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("payment");
		expect(context.eventBus.emit).toHaveBeenCalledWith("set_compact_panel", "selector");
		// "show_payment" was a dead emit (no listener ever) — removed.
		expect(context.eventBus.emit).not.toHaveBeenCalledWith("show_payment", "true");
	});

	/** Closing payments from the inline view — Alt+1, or a customer change. */
	const createClosePaymentsContext = () => ({
		_suppressClosePayments: false,
		paymentVisible: true,
		activeView: "payment",
		uiStore: {
			paymentDialogOpen: false,
			closePaymentDialog: vi.fn(),
			setActiveView: vi.fn(),
		},
		eventBus: { emit: vi.fn() },
	});

	it("asks the shell for the cart instead of setting the panel itself", () => {
		// Setting compactPanel and activeView from here is what used to land
		// Alt+1 on Browse: the shell's activeView watcher forced the selector
		// panel straight back. Only showInvoicePanel can move both at once.
		const context = createClosePaymentsContext();

		close_payments(context);

		expect(context.eventBus.emit).toHaveBeenCalledWith("show_invoice_panel");
		expect(context.eventBus.emit).not.toHaveBeenCalledWith("set_compact_panel", "invoice");
		// "show_payment" was a dead emit (no listener ever) — removed.
		expect(context.eventBus.emit).not.toHaveBeenCalledWith("show_payment", "false");
	});

	it("leaves the view alone once the shell has answered", () => {
		const context = createClosePaymentsContext();
		// mitt dispatches inline, so a live shell has already moved the view by
		// the time close_payments looks.
		context.eventBus.emit = vi.fn(() => {
			context.activeView = "items";
		});

		close_payments(context);

		expect(context.uiStore.setActiveView).not.toHaveBeenCalled();
	});

	it("falls back to the old exit when nothing answers the request", () => {
		// No shell listening (or a desk width where showInvoicePanel leaves
		// activeView alone) must not strand the operator on the payment view.
		const context = createClosePaymentsContext();

		close_payments(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("items");
	});
});

/**
 * Prod incident 2026-08-10: Pay is a ~1s update_invoice round-trip on 4G with
 * no feedback, so cashiers tapped it twice and the two saves raced each other
 * into MariaDB 1020 — an HTTP 500 toast mid-sale. Every Pay entry point funnels
 * through show_payment, so the latch is asserted here.
 */
describe("payment request in-flight guard", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { call: vi.fn() });
		Object.defineProperty(window, "innerWidth", {
			value: 500,
			writable: true,
			configurable: true,
		});
	});

	it("latches before the first await so the dock can paint busy on the same tick", () => {
		const context = createPaymentContext();
		// Deliberately not awaited: the latch has to be set by the time the tap
		// handler returns, not one microtask later.
		void show_payment(context);

		expect(context.uiStore.paymentRequestPending).toBe(true);
	});

	it("drops a second tap that lands while the round-trip is still open", async () => {
		const context = createPaymentContext();
		let releaseServer: () => void = () => {};
		context.process_invoice = vi.fn(
			() =>
				new Promise((resolve) => {
					releaseServer = () => resolve({ doctype: "Sales Invoice", payments: [] });
				}),
		);

		const firstTap = show_payment(context);
		// Let the first tap get past its local validation and out to the server,
		// which is the window the cashier actually taps into.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(context.process_invoice).toHaveBeenCalledTimes(1);

		await show_payment(context);

		expect(context.process_invoice).toHaveBeenCalledTimes(1);

		releaseServer();
		await firstTap;

		// Latch is released on settle, so the next sale can pay normally.
		expect(context.uiStore.paymentRequestPending).toBe(false);
	});

	it("releases the latch when the server round-trip throws", async () => {
		const context = createPaymentContext();
		context.process_invoice = vi.fn(async () => {
			throw new Error("Record has changed since last read");
		});

		await show_payment(context);

		expect(context.uiStore.paymentRequestPending).toBe(false);
		expect(context.toastStore.show).toHaveBeenCalled();
		// A latch that survived the failure would wedge Pay for the rest of
		// the shift — the whole till, not just this sale.
		await show_payment(context);
		expect(context.process_invoice).toHaveBeenCalledTimes(2);
	});

	it("releases the latch on the early returns that never reach the server", async () => {
		const context = createPaymentContext();
		context.customer = "";

		await show_payment(context);

		expect(context.process_invoice).not.toHaveBeenCalled();
		expect(context.uiStore.paymentRequestPending).toBe(false);
	});

	it("works on a context with no uiStore rather than throwing", async () => {
		const context = createPaymentContext();
		(context as any).uiStore = undefined;

		await expect(show_payment(context)).resolves.toBeUndefined();
	});
});
