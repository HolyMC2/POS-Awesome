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
		expect(shouldShowRestaurantTips(false)).toBe(false);
	});

	it("shows for every sale on a tips-enabled register — mesa AND counter (C2)", () => {
		// Until 08-29 this required a live Record-Only mesa ticket, which is
		// why a counter register with the token never saw the row.
		expect(shouldShowRestaurantTips(true)).toBe(true);
	});

	it("never offers a tip on a return — nobody tips a refund", () => {
		expect(shouldShowRestaurantTips(true, true)).toBe(false);
	});
});
