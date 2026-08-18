// @vitest-environment jsdom

/**
 * Price checker lookup behavior (roadmap §17.2). The read-only guarantee is
 * source-scanned in priceCheckReadOnly.spec.ts; this file covers what the
 * dialog DOES: query floors, barcode fallback, stale-response ordering and
 * the reset that stops one customer's price being quoted to the next.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import itemService from "../src/posapp/services/itemService";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { INVOICE_SHORTCUT_EFFECTS } from "../src/posapp/components/pos/invoice/invoiceShortcuts";

describe("price check shortcut effect", () => {
	it("the shortcut effect opens it without disturbing the ticket", () => {
		const emit = vi.fn();
		const vm: any = { eventBus: { emit } };
		const event = new KeyboardEvent("keydown", { cancelable: true });
		INVOICE_SHORTCUT_EFFECTS["items.priceCheck"]!.call(vm, event);

		expect(emit).toHaveBeenCalledWith("show_price_check");
		// set_compact_panel would move the operator off the cart mid-sale.
		expect(emit).not.toHaveBeenCalledWith("set_compact_panel", expect.anything());
		expect(event.defaultPrevented).toBe(true);
	});
});

describe("lookup behavior", () => {
	let dialog: any;

	beforeEach(async () => {
		setActivePinia(createPinia());
		const ui = useUIStore();
		ui.setPosProfile({
			name: "Test Register",
			selling_price_list: "Standard Selling",
			currency: "MXN",
		} as any);

		const { default: PriceCheckDialog } = await import(
			"../src/posapp/components/pos/shell/PriceCheckDialog.vue"
		);
		// setup() is exercised directly: mounting Vuetify's dialog needs a full
		// app harness that would test the framework, not this logic.
		dialog = (PriceCheckDialog as any).setup?.({}, { expose: vi.fn(), attrs: {}, slots: {}, emit: vi.fn() });
	});

	it("ignores a one-character query instead of hammering the server", async () => {
		const spy = vi.spyOn(itemService, "getItemsData").mockResolvedValue([]);
		await dialog.runLookup("a");
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("searches with the register's profile and price list", async () => {
		const spy = vi
			.spyOn(itemService, "getItemsData")
			.mockResolvedValue([{ item_code: "TORT", item_name: "Tortilla", rate: 25 }] as any);
		await dialog.runLookup("tort");
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				pos_profile: "Test Register",
				price_list: "Standard Selling",
				search_value: "tort",
			}),
		);
		expect(dialog.results.value).toHaveLength(1);
		spy.mockRestore();
	});

	it("falls back to a barcode lookup when the text search misses", async () => {
		const search = vi.spyOn(itemService, "getItemsData").mockResolvedValue([]);
		const barcode = vi
			.spyOn(itemService, "getItemsFromBarcodeData")
			.mockResolvedValue({ item_code: "LECHE", rate: 32 } as any);

		await dialog.runLookup("7501055300150");

		expect(barcode).toHaveBeenCalledWith(
			expect.objectContaining({ barcode: "7501055300150" }),
		);
		expect(dialog.results.value[0].item_code).toBe("LECHE");
		search.mockRestore();
		barcode.mockRestore();
	});

	it("does not try a barcode lookup for a short word", async () => {
		const search = vi.spyOn(itemService, "getItemsData").mockResolvedValue([]);
		const barcode = vi.spyOn(itemService, "getItemsFromBarcodeData").mockResolvedValue(null);
		await dialog.runLookup("pan");
		expect(barcode).not.toHaveBeenCalled();
		search.mockRestore();
		barcode.mockRestore();
	});

	it("a stale slow response cannot overwrite a newer one", async () => {
		let releaseFirst: (v: any) => void = () => {};
		const slow = new Promise((r) => {
			releaseFirst = r;
		});
		const spy = vi
			.spyOn(itemService, "getItemsData")
			.mockImplementationOnce(() => slow as any)
			.mockResolvedValueOnce([{ item_code: "NEW", rate: 1 }] as any);

		const first = dialog.runLookup("aaaa");
		const second = dialog.runLookup("bbbb");
		await second;
		releaseFirst([{ item_code: "OLD", rate: 9 }]);
		await first;

		expect(dialog.results.value[0].item_code).toBe("NEW");
		spy.mockRestore();
	});

	it("a failed lookup empties the list rather than showing a stale price", async () => {
		const spy = vi.spyOn(itemService, "getItemsData").mockRejectedValue(new Error("offline"));
		await dialog.runLookup("tort");
		expect(dialog.results.value).toEqual([]);
		spy.mockRestore();
	});

	it("opening clears the previous customer's lookup", async () => {
		const spy = vi
			.spyOn(itemService, "getItemsData")
			.mockResolvedValue([{ item_code: "TORT", rate: 25 }] as any);
		await dialog.runLookup("tort");
		expect(dialog.results.value).toHaveLength(1);

		dialog.open();

		expect(dialog.results.value).toEqual([]);
		expect(dialog.query.value).toBe("");
		expect(dialog.visible.value).toBe(true);
		spy.mockRestore();
	});
});
