import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	getTaxTemplate: vi.fn(() => null),
	getTaxInclusiveSetting: vi.fn(() => false),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_getPlcConversionRate: vi.fn(() => 1),
}));

import { get_invoice_doc } from "../src/posapp/components/pos/invoice_utils/document";

describe("get_invoice_doc", () => {
	beforeEach(() => {
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const number = Number(value || 0);
			return Number(number.toFixed(precision));
		};
	});

	it("updates customer title when draft customer changes", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-NEW",
				customer_name: "New Customer",
			},
			customer: "CUST-NEW",
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
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "SINV-DRAFT",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("New Customer");
	});

	it("clears stale party details when customer changes on a reused source doc", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-NEW",
				customer_name: "New Customer",
			},
			customer: "CUST-NEW",
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
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "ACC-SINV-0001",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address_name: "SHIP-OLD",
				contact_person: "CONT-OLD",
				address_display: "Old Address",
				contact_display: "Old Contact",
				contact_mobile: "0300",
				contact_email: "old@example.com",
				territory: "Old Territory",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("New Customer");
		expect(doc.customer_address).toBeNull();
		expect(doc.shipping_address_name).toBeNull();
		expect(doc.contact_person).toBeNull();
		expect(doc.address_display).toBeNull();
		expect(doc.contact_display).toBeNull();
		expect(doc.contact_mobile).toBeNull();
		expect(doc.contact_email).toBeNull();
		expect(doc.territory).toBeNull();
	});

	it("ignores mismatched cached customer info when resolving a different customer", () => {
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address: "SHIP-OLD",
				contact_person: "CONT-OLD",
				territory: "Old Territory",
			},
			customer: "CUST-NEW",
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
			posting_date_display: "2026-03-28",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				name: "ACC-SINV-0002",
				customer: "CUST-OLD",
				customer_name: "Old Customer",
				customer_address: "ADDR-OLD",
				shipping_address_name: "SHIP-OLD",
				contact_person: "CONT-OLD",
				territory: "Old Territory",
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.customer).toBe("CUST-NEW");
		expect(doc.customer_name).toBe("CUST-NEW");
		expect(doc.customer_address).toBeNull();
		expect(doc.shipping_address_name).toBeNull();
		expect(doc.contact_person).toBeNull();
		expect(doc.territory).toBeNull();
	});

	it("marks backdated invoices to preserve the selected posting date on submit", () => {
		(globalThis as any).frappe = {
			datetime: {
				nowdate: () => "2026-03-28",
			},
		};

		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {
				customer: "CUST-001",
				customer_name: "Walk-in Customer",
			},
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
			posting_date_display: "2026-03-20",
			posting_date: "2026-03-20",
			formatDateForBackend: (value: string) => value,
			invoice_doc: {
				payments: [],
				taxes: [],
			},
		};

		const doc = get_invoice_doc(context);

		expect(doc.posting_date).toBe("2026-03-20");
		expect(doc.set_posting_time).toBe(1);
	});

	it("round-trips a per-line warehouse and never invents one", () => {
		// Pull-model drafts (taller WIP flow) are born with the producer's
		// warehouse on part lines; the serializer dropping it made the server
		// refill from the POS profile and double-deduct sellable stock
		// (2026-08-29, RO-01090/91).
		const context: any = {
			invoiceType: "Invoice",
			pos_profile: {
				company: "Test Company",
				name: "Main POS",
				currency: "PKR",
				warehouse: "Store - TC",
				payments: [{ mode_of_payment: "Cash", account: "Cash", type: "Cash", default: 1 }],
			},
			selected_currency: "PKR",
			conversion_rate: 1,
			company: { default_currency: "PKR" },
			price_list_currency: "PKR",
			get_price_list: () => "Standard Selling",
			customer_info: {},
			customer: "CUST-1",
			isReturnInvoice: false,
			items: [
				{ item_code: "PART-A", qty: 1, rate: 150, warehouse: "Taller WIP - TC", is_stock_item: 1 },
				{ item_code: "LABOR", qty: 1, rate: 100, is_stock_item: 0 },
			],
			packed_items: [],
			Total: 250,
			subtotal: 250,
			additional_discount: 0,
			additional_discount_percentage: 0,
			roundAmount: (value: number) => value,
			pos_opening_shift: { name: "SHIFT-1" },
			posa_offers: [],
			posa_coupons: [],
			selected_delivery_charge: null,
			delivery_charges_rate: 0,
			posting_date_display: "2026-08-29",
			formatDateForBackend: (value: string) => value,
			invoice_doc: { name: "SINV-DRAFT", customer: "CUST-1" },
		};

		const doc = get_invoice_doc(context);
		const byCode = Object.fromEntries(doc.items.map((row: any) => [row.item_code, row]));
		expect(byCode["PART-A"].warehouse).toBe("Taller WIP - TC");
		// No warehouse on the cart item -> none sent; the server fills the
		// profile default at validate, exactly as before.
		expect("warehouse" in byCode["LABOR"]).toBe(false);
	});

});
