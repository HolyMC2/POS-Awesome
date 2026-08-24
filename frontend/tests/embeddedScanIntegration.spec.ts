// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";

import { useScanProcessor } from "../src/posapp/composables/pos/items/useScanProcessor";

/**
 * A labelling scale's sticker, from the wedge to the cart line.
 *
 * The parser and the arithmetic are unit-tested on their own; what is asserted
 * here is the WIRING, and specifically the two decisions that a mis-parse turns
 * into a mis-charge:
 *
 *   1. A register with no configured scheme behaves exactly as it did before —
 *      including for 20-25 codes, which without a declaration are barcodes.
 *   2. A code whose prefix claimed to be a label and then failed its own check
 *      digit is REFUSED out loud; it never silently falls back to the ordinary
 *      lookup, where it would either miss or resolve to a neighbouring item.
 */
const WEIGHT_LABEL = "2001234003124"; // item 01234 · 0.312 kg
const PRICE_LABEL = "2001234049924"; // item 01234 · $49.92
const CORRUPT_LABEL = "2001234003129"; // same, one digit wrong
const TEMPLATE = "2001234000000";

const JAMON = {
	item_code: "JAMON",
	item_name: "Jamón de pierna",
	uom: "Kg",
	rate: 160,
	price_list_rate: 160,
	must_be_whole_number: 0,
	barcode: TEMPLATE,
};

const CASE = {
	item_code: "CASE",
	item_name: "Case negro",
	uom: "Nos",
	rate: 200,
	must_be_whole_number: 1,
	barcode: TEMPLATE,
};

let added: any[];
let serverCalls: any[];
let catalogue: any[];

const buildContext = (overrides: Record<string, any> = {}) => {
	const scanErrorDialog = ref(false);
	const scanErrorMessage = ref("");
	const scanErrorCode = ref("");
	const scanErrorDetails = ref("");

	return {
		items: ref(catalogue),
		pos_profile: ref({
			name: "Abarrotes",
			currency: "MXN",
			warehouse: "Almacén",
			company: "Doco",
			posa_gr_embedded_barcode_scheme: "weight",
			...(overrides.profile || {}),
		}),
		active_price_list: ref("Venta"),
		customer_price_list: ref(null),
		itemDetailFetcher: { update_items_details: vi.fn(async () => undefined) },
		itemAddition: {
			addItem: vi.fn(async (item: any) => {
				added.push(item);
			}),
		},
		barcodeIndex: {
			ensureBarcodeIndex: () => new Map(),
			lookupItemByBarcode: (code: string) =>
				catalogue.find(
					(item: any) => item.barcode === code || item.item_code === code,
				) || null,
			replaceBarcodeIndex: vi.fn(),
			indexItem: vi.fn(),
			searchItemsByCode: vi.fn(() => []),
			resetBarcodeIndex: vi.fn(),
		},
		scannerInput: {
			scanErrorDialog,
			scanErrorMessage,
			scanErrorCode,
			scanErrorDetails,
			playScanTone: vi.fn(),
			scannerLocked: ref(false),
			setScanHandler: vi.fn(),
		},
		format_number: (value: any) => String(value),
		float_precision: computed(() => 3),
		hide_qty_decimals: computed(() => false),
		blockSaleBeyondAvailableQty: computed(() => false),
		currency_precision: computed(() => 2),
		exchange_rate: computed(() => 1),
		format_currency: (value: any) => `$${Number(value ?? 0).toFixed(2)}`,
		ratePrecision: () => 2,
		customer: ref("Público"),
		stock_settings: ref({ allow_negative_stock: 0 }),
		onItemNotFound: vi.fn(),
		_errors: { scanErrorMessage, scanErrorDetails, scanErrorCode },
	} as any;
};

const lastError = (context: any) => ({
	message: context._errors.scanErrorMessage.value,
	details: context._errors.scanErrorDetails.value,
});

beforeEach(() => {
	setActivePinia(createPinia());
	added = [];
	serverCalls = [];
	catalogue = [{ ...JAMON }];
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args?.length ? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m)) : text,
	);
	vi.stubGlobal("frappe", {
		call: vi.fn(async (payload: any) => {
			serverCalls.push(payload);
			return { message: null };
		}),
		show_alert: vi.fn(),
	});
});

describe("an embedded WEIGHT label", () => {
	it("resolves the item by its template and puts the weight on the line", async () => {
		const context = buildContext();
		const scanner = useScanProcessor(context);

		await scanner.processScannedItem(WEIGHT_LABEL);

		expect(added).toHaveLength(1);
		expect(added[0].item_code).toBe("JAMON");
		expect(added[0].qty).toBe(0.312);
	});

	it("marks the line «etiqueta de báscula» so the weight has a provenance", async () => {
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(added[0].posa_notes).toBe(`Scale label · ${WEIGHT_LABEL}`);
		expect(added[0]._is_scale_barcode).toBe(true);
	});

	it("floors the weight onto a register that keeps two decimals", async () => {
		const context = buildContext();
		context.float_precision = computed(() => 2);
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(added[0].qty).toBe(0.31);
	});

	it("never asks the server to parse it", async () => {
		// The legacy path spent a round trip on `parse_scale_barcode` for every
		// scan, on the hottest keystroke in the product.
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(serverCalls.map((call) => call.method)).not.toContain(
			"posawesome.posawesome.api.items.parse_scale_barcode",
		);
	});
});

describe("an embedded PRICE label", () => {
	it("derives the quantity from the amount, in the customer's favour", async () => {
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "price" } });
		await useScanProcessor(context).processScannedItem(PRICE_LABEL);

		expect(added[0].qty).toBe(0.312);
	});

	it("does NOT reprice the item to the amount on the label", async () => {
		// The fork's legacy scale path assigned an embedded price to the line's
		// rate: a $49.92 label on $160/kg ham would have sold a kilo for $49.92.
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "price" } });
		await useScanProcessor(context).processScannedItem(PRICE_LABEL);

		expect(added[0].rate).toBe(160);
	});

	it("states the charge on the line note", async () => {
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "price" } });
		await useScanProcessor(context).processScannedItem(PRICE_LABEL);

		expect(added[0].posa_notes).toBe(`Scale label · ${PRICE_LABEL} · $49.92`);
	});
});

describe("labels that must be refused", () => {
	it("refuses a corrupted label out loud, and adds nothing", async () => {
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(CORRUPT_LABEL);

		expect(added).toHaveLength(0);
		expect(lastError(context).message).toBe("Unreadable scale label");
		expect(lastError(context).details).toContain("did not verify");
	});

	it("does not fall back to the ordinary lookup for a corrupted label", async () => {
		// Falling through is the dangerous repair: the code would either miss
		// (confusing) or hit a real barcode that happens to match (a mis-sale).
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(CORRUPT_LABEL);

		expect(serverCalls).toHaveLength(0);
	});

	it("names the short code when no item carries it", async () => {
		catalogue = [];
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(added).toHaveLength(0);
		expect(lastError(context).message).toBe("Item not found: 01234");
		expect(lastError(context).details).toContain("01234");
	});

	it("refuses a weight label for an item sold by the piece", async () => {
		catalogue = [{ ...CASE }];
		const context = buildContext();
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(added).toHaveLength(0);
		expect(lastError(context).message).toBe("Case negro is not sold by weight");
		expect(lastError(context).details).toContain("Nos");
	});

	it("refuses a price label on an item with no rate", async () => {
		catalogue = [{ ...JAMON, rate: 0, price_list_rate: 0 }];
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "price" } });
		await useScanProcessor(context).processScannedItem(PRICE_LABEL);

		expect(added).toHaveLength(0);
		expect(lastError(context).details).toContain("no price on this register");
	});
});

describe("a register that declares no scheme", () => {
	it("treats a 20-25 code as an ordinary barcode, exactly as before", async () => {
		catalogue = [{ ...JAMON, barcode: WEIGHT_LABEL }];
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "" } });
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		// Added as one unit of the item the barcode names — no derived weight.
		expect(added).toHaveLength(1);
		expect(added[0].qty).toBeUndefined();
	});

	it("still consults the legacy scale settings, so nothing regresses", async () => {
		catalogue = [{ ...JAMON, barcode: WEIGHT_LABEL }];
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "" } });
		await useScanProcessor(context).processScannedItem(WEIGHT_LABEL);

		expect(serverCalls.map((call) => call.method)).toContain(
			"posawesome.posawesome.api.items.parse_scale_barcode",
		);
	});

	it("does not refuse a corrupted label it was never told to read", async () => {
		catalogue = [];
		const context = buildContext({ profile: { posa_gr_embedded_barcode_scheme: "" } });
		await useScanProcessor(context).processScannedItem(CORRUPT_LABEL);

		expect(lastError(context).message).not.toBe("Unreadable scale label");
	});
});
