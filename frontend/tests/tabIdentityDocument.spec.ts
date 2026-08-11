import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/offline/index", () => ({
	getTaxTemplate: vi.fn(() => null),
	getTaxInclusiveSetting: vi.fn(() => false),
	isOffline: vi.fn(() => false),
	getCachedCustomerBalance: vi.fn(() => null),
	saveCustomerBalance: vi.fn(),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_getPlcConversionRate: vi.fn(() => 1),
}));

vi.mock("../src/posapp/composables/pos/shared/useDiscounts", () => ({
	useDiscounts: () => ({ updateDiscountAmount: vi.fn() }),
}));

import { get_invoice_doc } from "../src/posapp/components/pos/invoice_utils/document";
import { load_invoice } from "../src/posapp/components/pos/invoice_utils/loader";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";

const docContext = (overrides: Record<string, any> = {}): any => ({
	invoiceType: "Invoice",
	pos_profile: {
		company: "Doco",
		name: "Main POS",
		currency: "MXN",
		payments: [
			{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 },
		],
	},
	selected_currency: "MXN",
	conversion_rate: 1,
	company: { default_currency: "MXN" },
	price_list_currency: "MXN",
	get_price_list: () => "Standard Selling",
	customer_info: { customer: "CUST-001", customer_name: "Walk-in Customer" },
	customer: "CUST-001",
	isReturnInvoice: false,
	items: [],
	packed_items: [],
	Total: 0,
	subtotal: 0,
	additional_discount: 0,
	additional_discount_percentage: 0,
	roundAmount: (value: number) => value,
	pos_opening_shift: { name: "SHIFT-1" },
	posa_offers: [],
	posa_coupons: [],
	selected_delivery_charge: null,
	delivery_charges_rate: 0,
	posting_date_display: "2026-08-10",
	formatDateForBackend: (value: string) => value,
	invoice_doc: {},
	...overrides,
});

// A resumed cafetería ticket as it comes back from the server.
const resumedTicket = () => ({
	name: "ACC-SINV-0007",
	customer: "CUST-001",
	payments: [],
	taxes: [],
	posa_rt_tab_name: "Marco (grande)",
	posa_rt_guest_count: 4,
	posa_rt_service_type: "Takeout",
});

describe("get_invoice_doc — cafetería identity", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const number = Number(value || 0);
			return Number(number.toFixed(precision));
		};
		(globalThis as any).frappe = {
			datetime: { nowdate: () => "2026-08-10" },
		};
	});

	it("emits null for identity fields the cashier cleared on a resumed ticket", () => {
		const store = useInvoiceStore();
		// load_invoice seeded the store from the ticket, then the cashier
		// cleared every field (the inputs are `clearable` → null).
		store.posaTabName = null;
		store.posaGuestCount = null;
		store.posaServiceType = null;

		const doc = get_invoice_doc(
			docContext({ invoiceStore: store, invoice_doc: resumedTicket() }),
		);

		expect(doc.posa_rt_tab_name).toBeNull();
		expect(doc.posa_rt_guest_count).toBeNull();
		expect(doc.posa_rt_service_type).toBeNull();
	});

	it("takes the live store values over the stale values on the resumed doc", () => {
		const store = useInvoiceStore();
		store.posaTabName = "Ana (para llevar)";
		store.posaGuestCount = 2;
		store.posaServiceType = "Dine In";

		const doc = get_invoice_doc(
			docContext({ invoiceStore: store, invoice_doc: resumedTicket() }),
		);

		expect(doc.posa_rt_tab_name).toBe("Ana (para llevar)");
		expect(doc.posa_rt_guest_count).toBe(2);
		expect(doc.posa_rt_service_type).toBe("Dine In");
	});

	it("falls back to the source doc when the context carries no store", () => {
		const doc = get_invoice_doc(docContext({ invoice_doc: resumedTicket() }));

		expect(doc.posa_rt_tab_name).toBe("Marco (grande)");
		expect(doc.posa_rt_guest_count).toBe(4);
		expect(doc.posa_rt_service_type).toBe("Takeout");
	});
});

describe("invoiceStore identity round-trip", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const number = Number(value || 0);
			return Number(number.toFixed(precision));
		};
		(globalThis as any).frappe = {
			datetime: { nowdate: () => "2026-08-10" },
		};
	});

	it("clear() resets the whole trio (identity is never a sticky)", () => {
		const store = useInvoiceStore();
		store.posaTabName = "Marco";
		store.posaGuestCount = 3;
		store.posaServiceType = "Delivery";

		// preserveStickies is what a resume passes — identity must reset anyway.
		store.clear({ preserveStickies: true });

		expect(store.posaTabName).toBeNull();
		expect(store.posaGuestCount).toBeNull();
		expect(store.posaServiceType).toBeNull();
	});

	it("load_invoice seeds the trio from the resumed ticket", async () => {
		const store = useInvoiceStore();
		const context: any = {
			pos_profile: {
				posa_use_percentage_discount: 0,
				posa_use_delivery_charges: 0,
			},
			invoiceStore: store,
			additional_discount_percentage: 0,
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			additional_discount: 0,
			discount_amount: 0,
			clear_invoice: (options: any) => store.clear(options),
			eventBus: { emit: vi.fn() },
			invoiceType: "Invoice",
			invoiceTypes: ["Invoice", "Order", "Quotation"],
			invoice_doc: null,
			posa_offers: [],
			items: [],
			packed_items: [],
			makeid: () => "ROW-1",
			set_batch_qty: vi.fn(),
			customer: "",
			set_delivery_charges: vi.fn().mockResolvedValue(undefined),
			formatDateForBackend: (value: string) => value,
			delivery_charges: [],
			Total: 0,
			subtotal: 0,
			return_doc: null,
			toastStore: { show: vi.fn() },
		};

		await load_invoice(context, { ...resumedTicket(), items: [] }, {
			preserveStickies: true,
		});

		expect(store.posaTabName).toBe("Marco (grande)");
		expect(store.posaGuestCount).toBe(4);
		expect(store.posaServiceType).toBe("Takeout");
	});

	it("does not leak identity from a held ticket into the next cart", () => {
		const store = useInvoiceStore();
		store.posaTabName = "Marco (grande)";
		store.posaGuestCount = 4;
		store.posaServiceType = "Takeout";

		const held = get_invoice_doc(
			docContext({ invoiceStore: store, invoice_doc: {} }),
		);
		expect(held.posa_rt_tab_name).toBe("Marco (grande)");

		// save_and_clear_invoice → clearInvoice: store reset, invoice_doc dropped.
		store.clear();
		const next = get_invoice_doc(
			docContext({ invoiceStore: store, invoice_doc: "" }),
		);

		expect(next.posa_rt_tab_name).toBeNull();
		expect(next.posa_rt_guest_count).toBeNull();
		expect(next.posa_rt_service_type).toBeNull();
	});
});
