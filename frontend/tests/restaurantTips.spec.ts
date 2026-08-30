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

describe("the tip baseline arms on every fresh doc (live find 08-30)", () => {
	it("applyIncomingInvoiceDoc re-arms the fold — the open-watcher alone cannot", async () => {
		// The hosted Cobro surface mounts Payments with isPaymentOpen ALREADY
		// true, so `watch(isPaymentOpen, ...)` never fires its open branch
		// there. When the capture lived only in that watcher, the baseline
		// stayed null, applyRestaurantTipTotal early-returned forever, and a
		// picked propina showed its amount while the totals, the tender row
		// and the split quotes stayed pre-tip — the server then (correctly)
		// billed items+tip and refused the short collection.
		const source = (await import("../src/posapp/components/pos/Payments.vue?raw")).default;
		const start = source.indexOf("const applyIncomingInvoiceDoc");
		expect(start).toBeGreaterThan(-1);
		const body = source.slice(start, source.indexOf("\n};", start));
		expect(body).toContain("captureRestaurantTipBaseTotals()");
		expect(body).toContain("restaurantTipAmount.value = 0");
		expect(body).toContain("splitShares.value = []");
	});
});
