import { describe, expect, it } from "vitest";

import {
	restaurantTipFromPercent,
	shouldShowRestaurantTips,
} from "../src/posapp/utils/restaurantTips";

describe("restaurant tips", () => {
	it("rounds percentage quick choices to whole pesos", () => {
		expect(restaurantTipFromPercent(333, 10)).toBe(33);
		expect(restaurantTipFromPercent(333, 15)).toBe(50);
		expect(restaurantTipFromPercent(333, 20)).toBe(67);
	});

	it("hides the row when the tips capability token is absent", () => {
		expect(shouldShowRestaurantTips(false, true, true)).toBe(false);
	});

	it("shows only for a live Record-Only restaurant ticket", () => {
		expect(shouldShowRestaurantTips(true, true, true)).toBe(true);
		expect(shouldShowRestaurantTips(true, false, true)).toBe(false);
		expect(shouldShowRestaurantTips(true, true, false)).toBe(false);
	});
});
