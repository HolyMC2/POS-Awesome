// @vitest-environment jsdom

/**
 * The LOT PICKER — which numbered box actually leaves the shelf.
 *
 * The hole this closes (owner ask 2026-08-30: «clicking on a sn item should
 * open a selector, and this improvement is for desk and mobile, general fix»,
 * then «extra data for the sn selector, make the ui good, so we can reuse on
 * batches, pharma uses these features extensively»): a `has_serial_no` /
 * `has_batch_no` item was added like any other and the choice of unit hid
 * inside the cart row's EXPANDED panel — which the desk has and the phone does
 * not, so on glass those items landed unusable.
 *
 * The file is suspicious of four things, in this order:
 *
 *   1. the GATE (`resolveLotRequirement`) — every existing bypass must survive
 *      the picker: a SCANNED serial/batch, a `posa_auto_set_batch` profile, a
 *      template (the variant picker's door), and the picker's own output
 *      coming back around;
 *   2. the VIEW (`resolveLotPicker`) — FEFO ordering, expiry tones and the
 *      "never selectable" rule for an expired lot, asserted on a FIXED today
 *      rather than on the day the suite happens to run;
 *   3. the ADDS (`resolveLotAdds`) — N serials become ONE line of qty N; a
 *      quantity split across batches becomes one line per batch; and nothing
 *      the view marked unselectable can be walked past by a synthetic confirm;
 *   4. the WIRING — the phone's `movil:pick-lot` doorbell and the desk's own
 *      add path, plus the confirm riding back to the ONE add path.
 *
 * jsdom because half of it mounts; the source pins ride `?raw`, which is a
 * Vite transform and therefore survives here where `node:fs` is shimmed away.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

// The shell statically imports the whole panel graph; none of it is under test
// here. Same leaf-stubbing as tests/movilLineSheet.spec.ts.
vi.mock("../src/posapp/components/pos/Invoice.vue", () => ({
	default: { name: "Invoice", render: () => null },
}));
vi.mock("../src/posapp/components/pos/items/ItemsSelector.vue", () => ({
	default: { name: "ItemsSelector", render: () => null },
}));
vi.mock("../src/posapp/components/pos/shift/OpeningDialog.vue", () => ({
	default: { name: "OpeningDialog", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosOffers.vue", () => ({
	default: { name: "PosOffers", render: () => null },
}));
vi.mock("../src/posapp/components/pos/offers/PosCoupons.vue", () => ({
	default: { name: "PosCoupons", render: () => null },
}));
vi.mock("../src/posapp/components/pos/Payments.vue", () => ({
	default: { name: "Payments", render: () => null },
}));
vi.mock("@saldo/SaldoReferenciaDialog.vue", () => ({
	default: { name: "SaldoReferenciaDialog", render: () => null },
}));
vi.mock("@saldo/SaldoStatusDialog.vue", () => ({
	default: { name: "SaldoStatusDialog", render: () => null },
}));
vi.mock("@saldo/SaldoCatalogPicker.vue", () => ({
	default: { name: "SaldoCatalogPicker", render: () => null },
}));

import Pos from "../src/posapp/components/pos/shell/Pos.vue";
import LotPicker from "../src/posapp/components/pos/items/lot/LotPicker.vue";
import {
	LOT_SEARCH_DEBOUNCE_MS,
	resolveLotAdds,
	resolveLotPicker,
	resolveLotRequirement,
	type LotPickerView,
} from "../src/posapp/components/pos/items/lot/lotPicker";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { useItemsStore } from "../src/posapp/stores/itemsStore";

import PickerSource from "../src/posapp/components/pos/items/lot/LotPicker.vue?raw";
import ModelSource from "../src/posapp/components/pos/items/lot/lotPicker.ts?raw";
import PosSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import SelectorSource from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";
import BusSource from "../src/posapp/bus.ts?raw";
import ScanSource from "../src/posapp/composables/pos/items/useScanProcessor.ts?raw";
import EsCsv from "../../posawesome/translations/es.csv?raw";

/** A fixed day, so «caduca en 16 días» means the same thing every morning. */
const TODAY = "2026-08-30";

/** Paracetamol: batch-tracked, four boxes, one of them past its date. */
const BATCH_ITEM = {
	item_code: "PARA-500",
	item_name: "Paracetamol 500 mg",
	warehouse: "Farmacia - D",
	stock_uom: "Nos",
	has_batch_no: 1,
	batch_no_data: [
		// Deliberately NOT in FEFO order on the wire.
		{ batch_no: "LOTE-C", batch_qty: 10, expiry_date: "2027-06-30", manufacturing_date: "2026-01-10" },
		{ batch_no: "LOTE-A", batch_qty: 4, expiry_date: "2026-09-15", manufacturing_date: "2025-09-15" },
		{ batch_no: "LOTE-VIEJO", batch_qty: 6, expiry_date: "2026-08-01" },
		{ batch_no: "LOTE-B", batch_qty: 7, expiry_date: "2026-12-01" },
	],
};

/** A phone: serial-numbered, no batches. */
const SERIAL_ITEM = {
	item_code: "IPH-16",
	item_name: "iPhone 16 Pro",
	warehouse: "Tienda - D",
	stock_uom: "Nos",
	has_serial_no: 1,
	serial_no_data: [
		{
			serial_no: "SN-001",
			warehouse: "Tienda - D",
			warranty_expiry_date: "2027-05-01",
			purchase_date: "2026-05-01",
		},
		{ serial_no: "SN-002" },
		{ serial_no: "SN-003" },
	],
};

/** Pharma's real shape: serialised vials that also live in dated batches. */
const BOTH_ITEM = {
	item_code: "VAC-01",
	item_name: "Vacuna Antigripal",
	warehouse: "Farmacia - D",
	stock_uom: "Nos",
	has_serial_no: 1,
	has_batch_no: 1,
	batch_no_data: [
		{ batch_no: "LOTE-B", batch_qty: 2, expiry_date: "2026-12-01" },
		{ batch_no: "LOTE-A", batch_qty: 2, expiry_date: "2026-09-15" },
		{ batch_no: "LOTE-VIEJO", batch_qty: 5, expiry_date: "2026-08-01" },
	],
	serial_no_data: [
		{ serial_no: "V-001", batch_no: "LOTE-A" },
		{ serial_no: "V-002", batch_no: "LOTE-A" },
		{ serial_no: "V-101", batch_no: "LOTE-B" },
		{ serial_no: "V-900", batch_no: "LOTE-VIEJO" },
	],
};

const view = (item: Record<string, unknown>, options: Record<string, unknown> = {}) =>
	resolveLotPicker(item as never, { today: TODAY, ...options } as never) as LotPickerView;

// ---------------------------------------------------------------------------
// 1. the gate
// ---------------------------------------------------------------------------

describe("who gets a picker, and who is left exactly as they were", () => {
	it("asks for the unit on a serialised item, a batch item, and one with both", () => {
		expect(resolveLotRequirement(SERIAL_ITEM)).toBe("serial");
		expect(resolveLotRequirement(BATCH_ITEM)).toBe("batch");
		expect(resolveLotRequirement(BOTH_ITEM)).toBe("both");
	});

	it("leaves an ordinary item alone", () => {
		expect(resolveLotRequirement({ item_code: "AGUA-1L" })).toBeNull();
		expect(resolveLotRequirement(null)).toBeNull();
	});

	it("leaves a TEMPLATE to the variant picker", () => {
		// `handleVariantItem` runs first in the same add path; a template has
		// no stock of its own to pick a lot from.
		expect(resolveLotRequirement({ ...SERIAL_ITEM, has_variants: 1 })).toBeNull();
	});

	it("stands down when the barcode already named the unit", () => {
		// `useScanProcessor` writes `to_set_serial_no` / `to_set_batch_no` from
		// the scanned code. Raising a dialog over a scan gun would replace one
		// keystroke with a tap on every scanned pharmaceutical.
		expect(resolveLotRequirement({ ...SERIAL_ITEM, to_set_serial_no: "SN-002" })).toBeNull();
		expect(resolveLotRequirement({ ...BATCH_ITEM, to_set_batch_no: "LOTE-A" })).toBeNull();
	});

	it("keeps posa_auto_set_batch exactly as it was", () => {
		// A shop that delegated the batch choice to FEFO is not asked for it…
		expect(resolveLotRequirement(BATCH_ITEM, { posa_auto_set_batch: 1 })).toBeNull();
		// …but the flag says nothing about SERIALS: which numbered unit left
		// the shelf is still a decision only a person can make.
		expect(resolveLotRequirement(SERIAL_ITEM, { posa_auto_set_batch: 1 })).toBe("serial");
		expect(resolveLotRequirement(BOTH_ITEM, { posa_auto_set_batch: 1 })).toBe("both");
	});

	it("does not reopen on its own output", () => {
		// The picker's payloads carry the resolved unit. If the gate did not
		// close on them, confirming would raise the picker again, forever.
		expect(resolveLotRequirement({ ...BATCH_ITEM, batch_no: "LOTE-A" })).toBeNull();
		expect(
			resolveLotRequirement({ ...SERIAL_ITEM, serial_no_selected: ["SN-001"] }),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. the view
// ---------------------------------------------------------------------------

describe("what the picker is allowed to show", () => {
	it("orders batches FEFO, expired last", () => {
		expect(view(BATCH_ITEM).batches.map((batch) => batch.batchNo)).toEqual([
			"LOTE-A",
			"LOTE-B",
			"LOTE-C",
			"LOTE-VIEJO",
		]);
	});

	it("refuses an expired lot and says why", () => {
		const expired = view(BATCH_ITEM).batches.find((batch) => batch.batchNo === "LOTE-VIEJO");
		expect(expired?.isExpired).toBe(true);
		expect(expired?.selectable).toBe(false);
		expect(expired?.blockedReason).toBe("expired");
		expect(expired?.tone).toBe("expired");
	});

	it("warns on a date within the month and stays quiet beyond it", () => {
		const batches = view(BATCH_ITEM).batches;
		const soon = batches.find((batch) => batch.batchNo === "LOTE-A");
		expect(soon?.daysToExpiry).toBe(16);
		expect(soon?.tone).toBe("soon");
		expect(batches.find((batch) => batch.batchNo === "LOTE-B")?.tone).toBe("ok");
	});

	it("refuses a batch with nothing left of it", () => {
		const empty = view({
			...BATCH_ITEM,
			batch_no_data: [{ batch_no: "LOTE-Z", batch_qty: 0, expiry_date: "2027-01-01" }],
		});
		expect(empty.batches[0].blockedReason).toBe("empty");
		expect(empty.isEmpty).toBe(true);
	});

	it("gives a serial the dates of the box it came in", () => {
		const serial = view(BOTH_ITEM).serials.find((row) => row.serialNo === "V-001");
		expect(serial?.batchNo).toBe("LOTE-A");
		expect(serial?.expiryDate).toBe("2026-09-15");
		expect(serial?.tone).toBe("soon");

		// …and a serial in an expired box is not sellable either.
		const stale = view(BOTH_ITEM).serials.find((row) => row.serialNo === "V-900");
		expect(stale?.selectable).toBe(false);
		expect(stale?.blockedReason).toBe("expired");
	});

	it("carries the serial's own extra data through", () => {
		const serial = view(SERIAL_ITEM).serials[0];
		expect(serial.warehouse).toBe("Tienda - D");
		expect(serial.warrantyExpiryDate).toBe("2027-05-01");
		expect(serial.purchaseDate).toBe("2026-05-01");
	});

	it("greys a serial this ticket already committed", () => {
		const busy = view(SERIAL_ITEM, { usedSerials: ["SN-002"] });
		expect(busy.serials.find((row) => row.serialNo === "SN-002")?.blockedReason).toBe("in-cart");
		expect(busy.isEmpty).toBe(false);
	});

	it("reports an empty shelf rather than pretending it can sell", () => {
		expect(view({ ...SERIAL_ITEM, serial_no_data: [] }).isEmpty).toBe(true);
		expect(
			view({ ...BATCH_ITEM, batch_no_data: [BATCH_ITEM.batch_no_data[2]] }).isEmpty,
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 3. the adds
// ---------------------------------------------------------------------------

describe("what a confirmed picker turns into", () => {
	it("makes N serials ONE line of qty N", () => {
		const adds = resolveLotAdds(view(SERIAL_ITEM), { serials: ["SN-001", "SN-003"] });

		expect(adds).toHaveLength(1);
		expect(adds[0].serial_no_selected).toEqual(["SN-001", "SN-003"]);
		expect(adds[0].serial_no_selected_count).toBe(2);
		// `serial_no` is the newline-joined field the cart row and the server
		// both read — `setSerialNo` keeps exactly this shape.
		expect(adds[0].serial_no).toBe("SN-001\nSN-003");
		expect(adds[0].qty).toBe(2);
		expect(adds[0].item_code).toBe("IPH-16");
	});

	it("splits a quantity across batches into one line per box", () => {
		const adds = resolveLotAdds(view(BATCH_ITEM), {
			batches: [
				{ batchNo: "LOTE-A", qty: 4 },
				{ batchNo: "LOTE-B", qty: 2 },
			],
		});

		expect(adds.map((add) => [add.batch_no, add.qty])).toEqual([
			["LOTE-A", 4],
			["LOTE-B", 2],
		]);
		// BOTH fields: `batch_no` is what the merge key is built from (so the
		// two lines stay two lines), `to_set_batch_no` is what makes `addItem`
		// run `setBatchQty` — the same pair a SCANNED batch produces.
		expect(adds[0].to_set_batch_no).toBe("LOTE-A");
	});

	it("never commits more than the shelf holds", () => {
		const adds = resolveLotAdds(view(BATCH_ITEM), { batches: [{ batchNo: "LOTE-A", qty: 99 }] });
		expect(adds[0].qty).toBe(4);
	});

	it("drops what the view refused, whatever the caller sends", () => {
		// Not merely disabled in the markup: a synthetic confirm — a stray
		// dispatch, an assistive tool, a test — cannot walk past an expired lot.
		expect(resolveLotAdds(view(BATCH_ITEM), { batches: [{ batchNo: "LOTE-VIEJO", qty: 2 }] })).toEqual(
			[],
		);
		expect(resolveLotAdds(view(BOTH_ITEM), { serials: ["V-900"] })).toEqual([]);
		expect(resolveLotAdds(view(BATCH_ITEM), { batches: [{ batchNo: "LOTE-A", qty: 0 }] })).toEqual(
			[],
		);
		expect(resolveLotAdds(view(SERIAL_ITEM), {})).toEqual([]);
	});

	it("groups serials by the box they actually came from", () => {
		const adds = resolveLotAdds(view(BOTH_ITEM), { serials: ["V-001", "V-101", "V-002"] });

		expect(adds).toHaveLength(2);
		expect(adds.map((add) => [add.batch_no, add.qty, add.serial_no_selected])).toEqual([
			["LOTE-A", 2, ["V-001", "V-002"]],
			["LOTE-B", 1, ["V-101"]],
		]);
	});

	it("hands back a payload the gate will not re-open", () => {
		const [add] = resolveLotAdds(view(BATCH_ITEM), { batches: [{ batchNo: "LOTE-A", qty: 1 }] });
		expect(resolveLotRequirement(add)).toBeNull();

		const [serialAdd] = resolveLotAdds(view(SERIAL_ITEM), { serials: ["SN-001"] });
		expect(resolveLotRequirement(serialAdd)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 4. the surface
// ---------------------------------------------------------------------------

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await nextTick();
};

/** Past the search debounce, using the picker's own interval — not a guess. */
const settleSearch = async () => {
	await new Promise((resolve) => setTimeout(resolve, LOT_SEARCH_DEBOUNCE_MS + 30));
	await nextTick();
};

const spy = () => ({ onConfirm: vi.fn(), onClose: vi.fn() });

const mountPicker = (
	item: Record<string, unknown>,
	options: Record<string, unknown> = {},
	listeners = spy(),
) => {
	const wrapper = mount(LotPicker, {
		props: { view: view(item, options), requestedQty: options.requestedQty ?? 1, ...listeners } as never,
		// In the document, so `document.activeElement` is a real answer rather
		// than always `<body>` — the focus rule below depends on it.
		attachTo: document.body,
	});
	return Object.assign(wrapper, listeners);
};

describe("the sheet a cashier actually touches", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string, args?: unknown[]) =>
			Array.isArray(args)
				? args.reduce<string>(
						(out, arg, index) => out.replace(`{${index}}`, String(arg)),
						value,
					)
				: value,
		);
	});

	it("names the item, the warehouse and the question", () => {
		const sheet = mountPicker(SERIAL_ITEM);
		expect(sheet.find('[data-testid="lot-name"]').text()).toBe("iPhone 16 Pro");
		expect(sheet.find('[data-testid="lot-code"]').text()).toContain("IPH-16");
		expect(sheet.find('[data-testid="lot-code"]').text()).toContain("Tienda - D");
		expect(sheet.find('[data-testid="lot-question"]').text()).toBe("Choose a serial number");
	});

	it("counts the selection out loud as it is built", async () => {
		const sheet = mountPicker(SERIAL_ITEM);
		expect(sheet.find('[data-testid="lot-summary"]').text()).toBe("0 selected · 0 pcs");

		await sheet.find('[data-testid="lot-serial-SN-001"]').trigger("click");
		await sheet.find('[data-testid="lot-serial-SN-003"]').trigger("click");

		expect(sheet.find('[data-testid="lot-summary"]').text()).toBe("2 selected · 2 pcs");
		expect(sheet.find('[data-testid="lot-add"]').text()).toBe("Add 2");
	});

	it("confirms N serials as one add of qty N", async () => {
		const sheet = mountPicker(SERIAL_ITEM);
		await sheet.find('[data-testid="lot-serial-SN-001"]').trigger("click");
		await sheet.find('[data-testid="lot-serial-SN-002"]').trigger("click");
		await sheet.find('[data-testid="lot-add"]').trigger("click");

		expect(sheet.onConfirm).toHaveBeenCalledTimes(1);
		const adds = sheet.onConfirm.mock.calls[0][0];
		expect(adds).toHaveLength(1);
		expect(adds[0].serial_no_selected).toHaveLength(2);
		expect(adds[0].qty).toBe(2);
	});

	it("will not let an expired lot be pressed", async () => {
		const sheet = mountPicker(BATCH_ITEM);
		const expired = sheet.find('[data-testid="lot-blocked-LOTE-VIEJO"]');

		expect(expired.text()).toBe("Expired lot");
		expect(sheet.find('[data-testid="lot-tone-LOTE-VIEJO"]').text()).toBe("Expired lot");
		// The row draws no stepper at all — there is no control to press.
		expect(sheet.find('[data-testid="lot-plus-LOTE-VIEJO"]').exists()).toBe(false);
	});

	it("opens on the FEFO allocation the engine would have made itself", () => {
		// `posa_auto_set_batch` would have taken LOTE-A unattended; the picker
		// starts from the same answer so the cashier's job is to DISAGREE.
		const sheet = mountPicker(BATCH_ITEM);
		expect((sheet.find('[data-testid="lot-qty-LOTE-A"]').element as HTMLInputElement).value).toBe(
			"1",
		);
		expect(sheet.find('[data-testid="lot-summary"]').text()).toBe("1 selected · 1 pcs");
	});

	it("caps a per-batch quantity at what the box holds", async () => {
		const sheet = mountPicker(BATCH_ITEM);
		const qty = sheet.find('[data-testid="lot-qty-LOTE-A"]');

		await qty.setValue("99");
		expect((qty.element as HTMLInputElement).value).toBe("4");
		expect(sheet.find('[data-testid="lot-plus-LOTE-A"]').attributes("disabled")).toBeDefined();

		await sheet.find('[data-testid="lot-add"]').trigger("click");
		expect(sheet.onConfirm.mock.calls[0][0][0].qty).toBe(4);
	});

	it("splits across boxes from the steppers", async () => {
		const sheet = mountPicker(BATCH_ITEM);
		await sheet.find('[data-testid="lot-plus-LOTE-B"]').trigger("click");
		await sheet.find('[data-testid="lot-plus-LOTE-B"]').trigger("click");

		expect(sheet.find('[data-testid="lot-summary"]').text()).toBe("2 selected · 3 pcs");
		await sheet.find('[data-testid="lot-add"]').trigger("click");
		expect(
			sheet.onConfirm.mock.calls[0][0].map((add: any) => [add.batch_no, add.qty]),
		).toEqual([
			["LOTE-A", 1],
			["LOTE-B", 2],
		]);
	});

	it("narrows the list from the search field", async () => {
		const sheet = mountPicker(BATCH_ITEM);
		expect(sheet.findAll('[data-batch]')).toHaveLength(4);

		await sheet.find('[data-testid="lot-search"]').setValue("lote-b");
		await settleSearch();

		const rows = sheet.findAll("[data-batch]");
		expect(rows).toHaveLength(1);
		expect(rows[0].attributes("data-batch")).toBe("LOTE-B");
	});

	it("narrows the serial list to a chosen batch", async () => {
		const sheet = mountPicker(BOTH_ITEM);
		expect(sheet.findAll("[data-serial]")).toHaveLength(4);

		await sheet.find('[data-testid="lot-batch-filters"] [data-batch="LOTE-A"]').trigger("click");

		expect(sheet.findAll("[data-serial]").map((row) => row.attributes("data-serial"))).toEqual([
			"V-001",
			"V-002",
		]);
	});

	it("blocks the add on an empty shelf and says why", () => {
		const sheet = mountPicker({ ...SERIAL_ITEM, serial_no_data: [] });

		expect(sheet.find('[data-testid="lot-add"]').attributes("disabled")).toBeDefined();
		expect(sheet.find('[data-testid="lot-empty"]').text()).toBe("No serial numbers available");
		expect(sheet.find('[data-testid="lot-hint"]').text()).toBe("No serial numbers available");
	});

	it("blocks the add until something is chosen, and refuses a synthetic press", async () => {
		const sheet = mountPicker(SERIAL_ITEM);
		expect(sheet.find('[data-testid="lot-add"]').attributes("disabled")).toBeDefined();
		expect(sheet.find('[data-testid="lot-hint"]').text()).toBe("Choose at least one unit");

		await sheet.find('[data-testid="lot-add"]').trigger("click");
		expect(sheet.onConfirm).not.toHaveBeenCalled();
	});

	it("closes from the ×, from a tap outside, and from Escape", async () => {
		const sheet = mountPicker(SERIAL_ITEM);

		await sheet.find('[data-testid="lot-close"]').trigger("click");
		await sheet.find('[data-testid="lot-scrim"]').trigger("click");
		document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
		await nextTick();

		expect(sheet.onClose).toHaveBeenCalledTimes(3);
	});

	it("drops the Escape listener with the sheet", async () => {
		const sheet = mountPicker(SERIAL_ITEM);
		sheet.unmount();
		document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
		await nextTick();
		expect(sheet.onClose).not.toHaveBeenCalled();
	});

	it("takes the cursor on a desk and never on glass", () => {
		// `focusItemSearch` refuses coarse pointers on purpose (movil round 5),
		// and the register's ONE scanner listens on the document. A sheet that
		// autofocused its search on a phone would swallow the next barcode AND
		// summon a soft keyboard over the list the cashier opened it to read.
		// On a mouse-and-keyboard counter the search IS the fastest way in, so
		// both halves are asserted — a rule that only ever answers "no" would
		// pass this file while doing nothing.
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
		const desk = mountPicker(SERIAL_ITEM);
		expect(document.activeElement).toBe(desk.find('[data-testid="lot-search"]').element);
		desk.unmount();

		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
		const glass = mountPicker(SERIAL_ITEM);
		expect(document.activeElement).not.toBe(glass.find('[data-testid="lot-search"]').element);
		glass.unmount();
		vi.unstubAllGlobals();
	});
});

// ---------------------------------------------------------------------------
// 5. the wiring
// ---------------------------------------------------------------------------

/** Minimal mitt stand-in — the shell registers real bus listeners on mount. */
const makeBus = () => {
	const seen: Array<{ event: string; payload: unknown }> = [];
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	return {
		seen,
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn: (payload?: unknown) => void) => {
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit: (event: string, payload?: unknown) => {
			seen.push({ event, payload });
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

describe("an edit opens on the line's own answer", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (value: string, args?: unknown[]) =>
			Array.isArray(args)
				? args.reduce<string>(
						(out, arg, index) => out.replace(`{${index}}`, String(arg)),
						value,
					)
				: value,
		);
	});

	const mountEdit = (
		item: Record<string, unknown>,
		initialSelection: Record<string, unknown>,
		listeners = spy(),
	) => {
		const wrapper = mount(LotPicker, {
			props: {
				view: view(item),
				requestedQty: 1,
				initialSelection,
				purpose: "edit",
				...listeners,
			} as never,
			attachTo: document.body,
		});
		return Object.assign(wrapper, listeners);
	};

	it("seeds the line's serials, drops the unknown, and says Apply", async () => {
		// `SN-999` is nobody: a serial the dataset cannot offer must not ride
		// a seed past the same filter a tap goes through.
		const sheet = mountEdit(SERIAL_ITEM, { serials: ["SN-002", "SN-999"] });
		expect(sheet.find('[data-testid="lot-add"]').text()).toContain("Apply");

		await sheet.find('[data-testid="lot-add"]').trigger("click");
		const adds = sheet.onConfirm.mock.calls[0][0];
		expect(adds).toHaveLength(1);
		expect(adds[0].serial_no_selected).toEqual(["SN-002"]);
		expect(adds[0].qty).toBe(1);
	});

	it("opens on the line's own batch, not on FEFO's opinion", async () => {
		const sheet = mountEdit(BATCH_ITEM, { batches: [{ batchNo: "LOTE-B", qty: 3 }] });
		await sheet.find('[data-testid="lot-add"]').trigger("click");
		const adds = sheet.onConfirm.mock.calls[0][0];
		expect(adds).toEqual([expect.objectContaining({ batch_no: "LOTE-B", qty: 3 })]);
	});

	it("re-seeds across the refresh wave instead of coming back empty", async () => {
		// The detail refresh re-publishes the view and the source-watch resets
		// local state; an edit must come back up showing what the line holds.
		const sheet = mountEdit(SERIAL_ITEM, { serials: ["SN-002"] });
		await sheet.setProps({ view: view({ ...SERIAL_ITEM }) } as never);

		await sheet.find('[data-testid="lot-add"]').trigger("click");
		const adds = sheet.onConfirm.mock.calls[0][0];
		expect(adds[0].serial_no_selected).toEqual(["SN-002"]);
	});

	it("keeps the add wording for an ordinary add", () => {
		const sheet = mountPicker(SERIAL_ITEM);
		expect(sheet.find('[data-testid="lot-add"]').text()).toContain("Add");
	});
});

describe("the phone rings the picker instead of adding a unit-less line", () => {
	let bus: ReturnType<typeof makeBus>;

	const mountShell = async (profile: Record<string, unknown> = {}) => {
		window.innerWidth = 390;
		const wrapper = mount(Pos, {
			shallow: true,
			global: { plugins: [createVuetify()], provide: { eventBus: bus } },
		});
		const vm = wrapper.vm as any;
		useUIStore().setPosProfile({ name: "Caja 2", ...profile } as any);
		await settle();
		return vm;
	};

	beforeEach(() => {
		setActivePinia(createPinia());
		bus = makeBus();
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: { user: "tester@example.com" },
			call: vi.fn().mockResolvedValue({ message: null }),
			db: { get_doc: vi.fn().mockResolvedValue({}) },
			realtime: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
			defaults: { get_default: () => 2 },
			datetime: {
				nowdate: () => TODAY,
				now_time: () => "10:00:00",
				get_today: () => TODAY,
			},
			boot: { user: { roles: [] }, sysdefaults: {} },
		});
	});

	const tap = async (vm: any, row: Record<string, unknown>) => {
		vm.movilBrowseRows = [row];
		await nextTick();
		vm.onMovilAdd({ item_code: row.item_code });
		await nextTick();
	};

	it("rings pick-lot for a serialised card and adds nothing", async () => {
		const vm = await mountShell();
		await tap(vm, SERIAL_ITEM);

		expect(bus.seen.map((entry) => entry.event)).toContain("movil:pick-lot");
		expect(bus.seen.some((entry) => entry.event === "add_item")).toBe(false);
	});

	it("rings pick-lot for a batch card when the profile does not auto-set", async () => {
		const vm = await mountShell();
		await tap(vm, BATCH_ITEM);
		expect(bus.seen.map((entry) => entry.event)).toContain("movil:pick-lot");
	});

	it("adds a batch card DIRECTLY when the profile auto-sets the batch", async () => {
		const vm = await mountShell({ posa_auto_set_batch: 1 });
		await tap(vm, BATCH_ITEM);

		expect(bus.seen.some((entry) => entry.event === "movil:pick-lot")).toBe(false);
		expect(bus.seen.map((entry) => entry.event)).toContain("add_item");
	});

	it("adds an ordinary card DIRECTLY, as it always did", async () => {
		const vm = await mountShell();
		await tap(vm, { item_code: "AGUA-1L", item_name: "Agua 1 L" });

		expect(bus.seen.some((entry) => entry.event === "movil:pick-lot")).toBe(false);
		expect(bus.seen.map((entry) => entry.event)).toContain("add_item");
	});

	it("adds a SCANNED unit directly — the barcode already answered", async () => {
		const vm = await mountShell();
		await tap(vm, { ...SERIAL_ITEM, to_set_serial_no: "SN-002" });

		expect(bus.seen.some((entry) => entry.event === "movil:pick-lot")).toBe(false);
		expect(bus.seen.map((entry) => entry.event)).toContain("add_item");
	});

	it("still routes a TEMPLATE to the variant picker", async () => {
		const vm = await mountShell();
		await tap(vm, { ...SERIAL_ITEM, has_variants: 1 });

		expect(bus.seen.map((entry) => entry.event)).toContain("movil:pick-variant");
		expect(bus.seen.some((entry) => entry.event === "movil:pick-lot")).toBe(false);
	});

	it("builds the picker's model from the store and sends the confirm on", async () => {
		const vm = await mountShell();
		const ui = useUIStore();
		ui.openLotPicker({ item: SERIAL_ITEM, profile: { name: "Caja 2" }, requestedQty: 1 });
		await nextTick();

		expect(vm.lotPickerView.mode).toBe("serial");
		expect(vm.lotPickerView.itemCode).toBe("IPH-16");

		vm.onLotConfirm([{ item_code: "IPH-16", qty: 1 }]);
		await nextTick();

		// The sheet closes BEFORE the adds land — it must not sit over the cart
		// while lines arrive behind it.
		expect(ui.lotPickerDialog).toBe(false);
		expect(bus.seen.at(-1)).toEqual({
			event: "lot:confirm",
			payload: { adds: [{ item_code: "IPH-16", qty: 1 }] },
		});
	});

	it("leaves the itemsStore fallback intact for a card outside the browse rows", async () => {
		// `onMovilAdd` reads the browse rows first and the store second; the
		// gate must see the row either way.
		const vm = await mountShell();
		const items = useItemsStore();
		(items as any).filteredItems = [SERIAL_ITEM];
		vm.movilBrowseRows = [];
		await nextTick();

		vm.onMovilAdd({ item_code: "IPH-16" });
		await nextTick();

		expect(bus.seen.map((entry) => entry.event)).toContain("movil:pick-lot");
	});
});

// ---------------------------------------------------------------------------
// 6. the seams, pinned
// ---------------------------------------------------------------------------

describe("the seams the picker hangs from", () => {
	it("types both lot events on the bus", () => {
		// bus.ts is the closed event map: an event that is not declared here
		// is an event `vue-tsc` cannot check a handler against.
		expect(BusSource).toContain('"movil:pick-lot": Item;');
		expect(BusSource).toContain('"lot:confirm": { adds: Array<Record<string, any>> };');
	});

	it("gates the DESK's own add path on the same resolver", () => {
		// The desk catalogue click does not ride the bus — it calls
		// `ItemsSelector.add_item` directly — so the gate has to live there too,
		// or the phone and the counter would disagree about the same item.
		expect(SelectorSource).toContain("!options.lotResolved &&");
		expect(SelectorSource).toContain("resolveLotRequirement(item, pos_profile.value)");
		expect(SelectorSource).toContain('eventBus.on("movil:pick-lot", movilPickLot);');
		expect(SelectorSource).toContain('eventBus.off("movil:pick-lot", movilPickLot);');
	});

	it("keeps the SCANNER out of the picker's door entirely", () => {
		// Two beeps a second is the flow the scanner exists for. When the
		// barcode names the unit it is already on the row; when it names only
		// the item, `autoAssignSerials` fills it FEFO exactly as before. A
		// modal in either case would be a throughput regression nobody asked
		// for — so the scan path marks itself and the gate steps aside.
		expect(ScanSource).toContain("fromScan: true,");
		expect(SelectorSource).toContain("!options.fromScan &&");
	});

	it("answers the confirm through the ONE add path, awaited line by line", () => {
		// `await` is load-bearing: three un-awaited adds for three batches race
		// each other through the merge cache.
		expect(SelectorSource).toContain(
			"await add_item({ ...payload }, { qty: payload.qty, lotResolved: true });",
		);
		expect(SelectorSource).toContain('eventBus.on("lot:confirm", onLotConfirm);');
		expect(SelectorSource).toContain('eventBus.off("lot:confirm", onLotConfirm);');
	});

	it("mounts the surface in the shell, not inside the hidden catalogue", () => {
		// ItemsSelector's column is `v-show`-hidden on phones, and an overlay
		// under `display: none` draws nothing — the same reason Variants is
		// mounted here.
		expect(PosSource).toContain("<LotPicker");
		expect(PosSource).toContain('eventBus.emit("movil:pick-lot", { ...row });');
		expect(PosSource).toContain('const LotPicker = defineAsyncComponent(() => import("../items/lot/LotPicker.vue"));');
	});

	it("reuses the register's own batch rules rather than restating them", () => {
		expect(ModelSource).toContain(
			'import { applySerialBatchFilter, isBatchExpired } from "../../../../composables/pos/shared/useBatchSerial";',
		);
	});

	it("draws on the register's tokens, with no naked hex", () => {
		// A bare hex cannot follow theme.css into dark — that is what left the
		// register's primary navigation rendering light beside a #121212 shell
		// (wave 3, A1). Strip the comments, then strip every `var(--x, #fff)`
		// FALLBACK, and nothing coloured may be left standing.
		const styles = (PickerSource.split("<style")[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
		const withoutFallbacks = styles.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, "var()");

		expect(withoutFallbacks.match(/#[0-9a-fA-F]{3,8}/g) ?? []).toEqual([]);
		expect(withoutFallbacks.match(/\brgba?\(/g) ?? []).toEqual([]);
		expect(styles).toContain("--reg-touch-min");
		expect(styles).toContain("prefers-reduced-motion");
	});

	it("ships the Spanish the surface asks for", () => {
		for (const row of [
			"Choose a serial number,Elige número de serie",
			"Choose a batch,Elige lote",
			"Expired lot,Caducado",
			"No batches available,Sin lotes disponibles",
			"No serial numbers available,Sin números de serie disponibles",
			"{0} selected · {1} pcs,{0} seleccionados · {1} pzas",
			"Add {0},Agregar {0}",
		]) {
			expect(EsCsv).toContain(row);
		}
	});
});
