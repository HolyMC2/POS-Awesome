import { beforeEach, describe, expect, it, vi } from "vitest";

const toastShow = vi.fn();

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({
		show: toastShow,
	}),
}));

import { useDiscounts } from "../src/posapp/composables/pos/shared/useDiscounts";

const makeContext = () => ({
	pos_profile: { currency: "USD" },
	price_list_currency: "USD",
	selected_currency: "USD",
	conversion_rate: 1,
	currency_precision: 2,
	float_precision: 4,
	forceUpdate: vi.fn(),
	calc_stock_qty: vi.fn(),
	flt(value: unknown, precision = 2) {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			return 0;
		}
		return Number(numeric.toFixed(precision));
	},
});

const makeOfferItem = (overrides: Record<string, unknown> = {}) => ({
	rate: 100,
	base_rate: 100,
	price_list_rate: 100,
	base_price_list_rate: 100,
	discount_amount: 0,
	base_discount_amount: 0,
	discount_percentage: 0,
	qty: 1,
	_manual_rate_set: false,
	_manual_rate_set_from_uom: false,
	_offer_constraints: {},
	...overrides,
});

describe("a repriced line writes its own amount", () => {
	beforeEach(() => {
		toastShow.mockReset();
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const numeric = Number(value);
			if (!Number.isFinite(numeric)) {
				return 0;
			}
			return Number(numeric.toFixed(precision));
		};
	});

	it("writes amount and base_amount on every discount verb", () => {
		// The summary readers (`resolveSaleSummary` → the phone's line sheet,
		// the phone cart row, the payment screen) PREFER the written amount
		// over their own multiplication; a pass that only moved `rate` left
		// the old money standing on every one of those surfaces.
		const { calcPrices } = useDiscounts();
		const context = makeContext();
		const item = makeOfferItem({ qty: 2, amount: 200, base_amount: 200 });

		calcPrices(item, 10, { target: { id: "discount_percentage" } }, context);
		expect(item.rate).toBe(90);
		expect(item.amount).toBe(180);
		expect(item.base_amount).toBe(180);

		calcPrices(item, 50, { target: { id: "discount_amount" } }, context);
		expect(item.rate).toBe(50);
		expect(item.amount).toBe(100);

		calcPrices(item, 80, { target: { id: "rate" } }, context);
		expect(item.amount).toBe(160);
	});

	it("keeps the return sign: a negative qty writes a negative amount", () => {
		const { calcPrices } = useDiscounts();
		const context = makeContext();
		const item = makeOfferItem({ qty: -1, amount: -100, base_amount: -100 });

		calcPrices(item, 10, { target: { id: "discount_percentage" } }, context);
		expect(item.amount).toBe(-90);
	});
});

describe("useDiscounts offer price enforcement", () => {
	beforeEach(() => {
		toastShow.mockReset();
		(globalThis as any).__ = (text: string) => text;
		(globalThis as any).flt = (value: unknown, precision = 2) => {
			const numeric = Number(value);
			if (!Number.isFinite(numeric)) {
				return 0;
			}
			return Number(numeric.toFixed(precision));
		};
	});

	it("clamps rate edits to the floor derived from max discount amount", () => {
		const context = makeContext();
		const item = makeOfferItem({
			_offer_constraints: {
				max_base_discount_amount: 20,
			},
		});

		const { calcPrices } = useDiscounts();
		calcPrices(item, 60, { target: { id: "rate" } }, context);

		expect(item.base_rate).toBeCloseTo(80);
		expect(item.rate).toBeCloseTo(80);
		expect(item.base_discount_amount).toBeCloseTo(20);
		expect(item.discount_amount).toBeCloseTo(20);
		expect(item.discount_percentage).toBeCloseTo(20);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Rate adjusted to maximum allowed discount",
			}),
		);
	});

	it("restores previous values when discount amount exceeds offer criteria", () => {
		const context = makeContext();
		const item = makeOfferItem({
			_offer_constraints: {
				max_base_discount_amount: 20,
			},
		});

		const { calcPrices } = useDiscounts();
		calcPrices(item, 35, { target: { id: "discount_amount" } }, context);

		expect(item.base_rate).toBeCloseTo(100);
		expect(item.rate).toBeCloseTo(100);
		expect(item.base_discount_amount).toBeCloseTo(0);
		expect(item.discount_amount).toBeCloseTo(0);
		expect(toastShow).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Offer criteria exceeded",
			}),
		);
	});
});
