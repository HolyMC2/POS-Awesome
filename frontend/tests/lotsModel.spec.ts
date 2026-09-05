import { describe, expect, it } from "vitest";

import {
	batchStatusKey,
	batchTone,
	buildBatchAdd,
	buildSerialAdd,
	describeBatchTabs,
	describeSerialTabs,
	describeSerialWhereabouts,
	emptyBatchCounts,
	emptySerialCounts,
	lotKindFromSearch,
	lotQueryFromSearch,
	matchesLotQuery,
	movementLabel,
	normalizeLotQuery,
	serialStatusLabel,
	serialTone,
	shortStamp,
	voucherDeskPath,
	type BatchRow,
	type SerialRow,
} from "../src/posapp/components/pos/lots/lotsModel";
import EsCsv from "../../posawesome/translations/es.csv?raw";

/**
 * SERIES Y LOTES — the pure half (owner ask 2026-09-05: «a sale blocked
 * because the phone's IMEI was sold two months ago… we need a way to search
 * inside the same app»).
 *
 * What is pinned here is the counter's reading: a sold unit says so in the
 * cashier's word, an in-stock unit names its shelf, and «Sell this one»
 * produces exactly the add the lot picker would — or nothing at all.
 */

const serial = (overrides: Partial<SerialRow> = {}): SerialRow => ({
	serial_no: "353150400443913",
	item_code: "IPN004625",
	item_name: "Samsung A17 Lte 128GB+4GB Negro",
	status: "Delivered",
	warehouse: null,
	customer: "ALEJANDRO VAZQUEZ",
	batch_no: null,
	purchase_document_no: null,
	warranty_expiry_date: null,
	posting_date: "2026-07-30",
	last_voucher_type: "Sales Invoice",
	last_voucher_no: "ACC-SINV-2026-02707",
	last_moved_at: "2026-08-04 14:09:36",
	last_outward: true,
	sellable_here: false,
	...overrides,
});

const batch = (overrides: Partial<BatchRow> = {}): BatchRow => ({
	batch_no: "LOTE-A",
	item_code: "PARA-500",
	item_name: "Paracetamol 500 mg",
	expiry_date: "2026-09-20",
	manufacturing_date: null,
	days_to_expiry: 15,
	tone: "soon",
	disabled: false,
	stock_uom: "Nos",
	supplier: null,
	total_qty: 10,
	qty_here: 4,
	stock: [
		{ warehouse: "Bodega", qty: 6 },
		{ warehouse: "Tienda", qty: 4 },
	],
	sellable_here: true,
	...overrides,
});

describe("lotsModel — reading a serial", () => {
	it("speaks the cashier's word for each ERPNext status", () => {
		expect(serialStatusLabel("Active")).toBe("In stock");
		expect(serialStatusLabel("Delivered")).toBe("Sold");
		expect(serialStatusLabel("Consumed")).toBe("Consumed");
		expect(serialStatusLabel("")).toBe("Unknown");
		expect(serialStatusLabel(undefined)).toBe("Unknown");
	});

	it("tones what can be sold as positive and what left as returned", () => {
		expect(serialTone("Active")).toBe("positive");
		expect(serialTone("Delivered")).toBe("returned");
		expect(serialTone("Expired")).toBe("warning");
		expect(serialTone("whatever")).toBe("muted");
	});

	it("says where a unit is, or where it went", () => {
		expect(describeSerialWhereabouts(serial({ status: "Active", warehouse: "Tienda - D" }))).toEqual({
			key: "{0}",
			args: ["Tienda - D"],
		});
		expect(describeSerialWhereabouts(serial())).toEqual({
			key: "{0} · {1} · {2}",
			args: ["ACC-SINV-2026-02707", "2026-08-04", "ALEJANDRO VAZQUEZ"],
		});
		expect(describeSerialWhereabouts(serial({ customer: null }))).toEqual({
			key: "{0} · {1}",
			args: ["ACC-SINV-2026-02707", "2026-08-04"],
		});
		expect(
			describeSerialWhereabouts(
				serial({ status: "Unknown", last_voucher_no: null, last_outward: null, customer: null }),
			),
		).toEqual({ key: "—", args: [] });
	});

	it("draws every tab even at zero, in the counter's order", () => {
		const tabs = describeSerialTabs(emptySerialCounts(), "Active");
		expect(tabs.map((t) => t.id)).toEqual(["all", "Active", "Delivered", "Consumed", "Inactive", "Expired"]);
		expect(tabs.find((t) => t.active)?.label).toBe("In stock");
		expect(tabs.every((t) => t.count === 0)).toBe(true);
	});
});

describe("lotsModel — reading a batch", () => {
	it("tones expiry over stock", () => {
		expect(batchTone(batch())).toBe("warning");
		expect(batchTone(batch({ tone: "expired" }))).toBe("negative");
		expect(batchTone(batch({ tone: "ok" }))).toBe("positive");
		expect(batchTone(batch({ tone: "ok", total_qty: 0 }))).toBe("muted");
		expect(batchTone(batch({ disabled: true }))).toBe("muted");
	});

	it("puts a countdown on a batch close to its date", () => {
		expect(batchStatusKey(batch())).toEqual({ key: "Expires in {0} days", count: 15 });
		expect(batchStatusKey(batch({ tone: "expired" }))).toEqual({ key: "Expired lot", count: null });
		expect(batchStatusKey(batch({ tone: "none", total_qty: 0 }))).toEqual({ key: "Empty", count: null });
		expect(batchStatusKey(batch({ tone: "ok" }))).toEqual({ key: "Available", count: null });
	});

	it("draws the batch tabs from the server's counts", () => {
		const tabs = describeBatchTabs({ ...emptyBatchCounts(), available: 3, all: 5 }, "all");
		expect(tabs.map((t) => [t.id, t.count])).toEqual([
			["available", 3],
			["all", 5],
			["expired", 0],
			["empty", 0],
		]);
	});
});

describe("lotsModel — the search box", () => {
	it("reads a dictated IMEI the way the server does", () => {
		expect(normalizeLotQuery(" 35 3150 4004-43913\n")).toBe("353150400443913");
		expect(normalizeLotQuery("  Samsung   A17 ")).toBe("Samsung A17");
		expect(normalizeLotQuery("")).toBe("");
	});

	it("matches a row on any of its names, locally", () => {
		const row = serial();
		expect(matchesLotQuery(row, "3531 5040")).toBe(true);
		expect(matchesLotQuery(row, "samsung")).toBe(true);
		expect(matchesLotQuery(row, "vazquez")).toBe(true);
		expect(matchesLotQuery(row, "iphone")).toBe(false);
		expect(matchesLotQuery(row, "")).toBe(true);
	});

	it("opens a deep link straight onto the record it names", () => {
		expect(lotQueryFromSearch("?q=35 3150 4004 43913")).toBe("353150400443913");
		expect(lotQueryFromSearch("?batch=LOTE-A")).toBe("LOTE-A");
		expect(lotKindFromSearch("?batch=LOTE-A")).toBe("batch");
		expect(lotKindFromSearch("?q=1&kind=batch")).toBe("batch");
		expect(lotKindFromSearch("?q=1")).toBe("serial");
		expect(lotKindFromSearch(undefined)).toBe("serial");
	});
});

describe("lotsModel — «Sell this one»", () => {
	const catalogue = {
		item_code: "IPN004625",
		item_name: "Samsung A17",
		warehouse: "Tienda - D",
		has_serial_no: 1,
		serial_no_data: [{ serial_no: "353207809426830" }],
		filtered_serial_no_data: [],
		to_set_serial_no: "stale",
	};

	it("shapes exactly the add the lot picker would", () => {
		const row = serial({ serial_no: "353207809426830", status: "Active", warehouse: "Tienda - D", sellable_here: true });
		const add = buildSerialAdd(catalogue, row);
		expect(add).toMatchObject({
			item_code: "IPN004625",
			code: "IPN004625",
			qty: 1,
			serial_no: "353207809426830",
			serial_no_selected: ["353207809426830"],
			serial_no_selected_count: 1,
		});
		// The picker's bookkeeping never rides into a cart row.
		expect(add).not.toHaveProperty("filtered_serial_no_data");
		expect(add).not.toHaveProperty("to_set_serial_no");
	});

	it("carries the unit's batch when it has one", () => {
		const row = serial({ status: "Active", warehouse: "Tienda - D", sellable_here: true, batch_no: "LOTE-A" });
		expect(buildSerialAdd(catalogue, row)).toMatchObject({ batch_no: "LOTE-A", to_set_batch_no: "LOTE-A" });
	});

	it("refuses what the server did not mark sellable here, and a mismatched catalogue row", () => {
		expect(buildSerialAdd(catalogue, serial())).toBeNull();
		expect(buildSerialAdd(null, serial({ sellable_here: true }))).toBeNull();
		expect(buildSerialAdd({ item_code: "OTHER" }, serial({ sellable_here: true }))).toBeNull();
	});

	it("sells from a batch one unit at a time, never past what is here", () => {
		const paracetamol = { item_code: "PARA-500", has_batch_no: 1 };
		expect(buildBatchAdd(paracetamol, batch())).toMatchObject({
			qty: 1,
			batch_no: "LOTE-A",
			to_set_batch_no: "LOTE-A",
		});
		expect(buildBatchAdd(paracetamol, batch(), 99)?.qty).toBe(4);
		expect(buildBatchAdd(paracetamol, batch({ sellable_here: false }))).toBeNull();
	});
});

describe("lotsModel — the story", () => {
	it("names what happened, not the doctype", () => {
		expect(movementLabel({ voucher_type: "Sales Invoice", outward: true, is_return: false })).toBe("Sale");
		expect(movementLabel({ voucher_type: "Sales Invoice", outward: false, is_return: true })).toBe("Return");
		expect(movementLabel({ voucher_type: "Purchase Invoice", outward: false, is_return: false })).toBe("Purchase");
		expect(movementLabel({ voucher_type: "Stock Entry", outward: true, is_return: false })).toBe("Issued");
		expect(movementLabel({ voucher_type: "Stock Reconciliation", outward: false, is_return: false })).toBe("Adjustment");
		expect(movementLabel({ voucher_type: "Asset Movement", outward: true, is_return: false })).toBe("Stock out");
	});

	it("links a voucher to its desk form", () => {
		expect(voucherDeskPath("Sales Invoice", "ACC-SINV-2026-02707")).toBe("/app/sales-invoice/ACC-SINV-2026-02707");
	});

	it("trims a stamp to the minute", () => {
		expect(shortStamp("2026-08-04T14:09:36.004213")).toBe("2026-08-04 14:09");
		expect(shortStamp(null)).toBe("—");
	});
});

describe("lotsModel — the Spanish it asks for", () => {
	it("ships every surface string", () => {
		for (const row of [
			"Serials & batches,Series y lotes",
			"In stock,En existencia",
			"Sold,Vendido",
			"Sell this unit,Vender esta unidad",
			"Same item in stock,Mismo artículo en existencia",
			"Sold on {0},Vendido el {0}",
			"Expires in {0} days,Caduca en {0} días",
			"Sell one from this batch,Vender una de este lote",
			"Stock out,Salida de inventario",
			"Change serial numbers,Cambiar números de serie",
		]) {
			expect(EsCsv).toContain(row);
		}
	});
});
