import { describe, expect, it } from "vitest";
import { applyCreditLinePrices } from "../src/posapp/components/pos/invoice_utils/creditLinePrices";
import { snapshotLinePrice } from "../src/posapp/composables/pos/credit/creditMath";

const context = (items: any[]) => ({
	items,
	currency_precision: 2,
	pos_profile: { currency: "MXN" },
	selected_currency: "MXN",
	conversion_rate: 1,
	flt: (value: number, precision = 2) => Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision),
});

const phone = () => ({
	posa_row_id: "r-phone",
	item_code: "PHONE",
	qty: 1,
	rate: 3600,
	base_rate: 3600,
	price_list_rate: 4000,
	base_price_list_rate: 4000,
	discount_percentage: 10,
	discount_amount: 400,
	base_discount_amount: 400,
	amount: 3600,
	base_amount: 3600,
});

describe("the cart side of a credit sale", () => {
	it("pins a covered line at its credit price, without a discount", () => {
		const item = phone();
		const refetch = applyCreditLinePrices(context([item]), { set: [{ rowId: "r-phone", rate: 800 }], restore: [] });
		expect(refetch).toEqual([]);
		expect(item).toMatchObject({
			rate: 800,
			base_rate: 800,
			price_list_rate: 800,
			base_price_list_rate: 800,
			discount_percentage: 0,
			discount_amount: 0,
			base_discount_amount: 0,
			amount: 800,
			base_amount: 800,
			locked_price: true,
			_manual_rate_set: true,
			posa_px_skip_rate_band: 1,
		});
	});

	it("restores a line's own price from its snapshot, with the current quantity", () => {
		const item = phone();
		const snapshot = snapshotLinePrice(item);
		applyCreditLinePrices(context([item]), { set: [{ rowId: "r-phone", rate: 800 }], restore: [] });
		item.qty = 2;
		applyCreditLinePrices(context([item]), { set: [], restore: [{ rowId: "r-phone", price: snapshot }] });
		expect(item).toMatchObject({
			rate: 3600,
			price_list_rate: 4000,
			discount_percentage: 10,
			locked_price: false,
			posa_px_skip_rate_band: 0,
			amount: 7200,
		});
	});

	it("hands back a line restored without a snapshot so its price comes from the price list", () => {
		const item = { ...phone(), locked_price: true, _manual_rate_set: true, posa_px_skip_rate_band: 1 };
		const refetch = applyCreditLinePrices(context([item]), { set: [], restore: [{ rowId: "r-phone", price: null }] });
		expect(refetch).toEqual([item]);
		expect(item.locked_price).toBe(false);
		expect(item._manual_rate_set).toBe(false);
	});

	it("pins a line at the price it already carries, and ignores rows that are gone", () => {
		const item = phone();
		applyCreditLinePrices(context([item]), { set: [{ rowId: "missing", rate: 1 }], restore: [], lock: ["r-phone"] });
		expect(item).toMatchObject({ rate: 3600, locked_price: true, posa_px_skip_rate_band: 1 });
	});
});
