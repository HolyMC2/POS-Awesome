/**
 * Price checker's load-bearing NEGATIVE property (roadmap §17.2): no path
 * from this surface to the sale exists. Source-scanned rather than mounted —
 * the guarantee is "no such code path", not "this path did not run today".
 * No jsdom: this reads real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	resolve(__dirname, "../src/posapp/components/pos/shell/PriceCheckDialog.vue"),
	"utf8",
);

describe("price check is read-only by construction", () => {
	it("never emits a cart or invoice mutation", () => {
		// A regex list beats a mounted-component assertion here: the guarantee
		// is "no such code path exists", not "this path did not run today".
		for (const forbidden of [
			"add_item",
			"add_to_cart",
			"addItem",
			"remove_item",
			"update_invoice",
			"submit_invoice",
		]) {
			expect(SOURCE, `price checker must not reference ${forbidden}`).not.toContain(forbidden);
		}
	});

	it("calls only lookup endpoints", () => {
		const calls = [...SOURCE.matchAll(/itemService\.(\w+)/g)].map((m) => m[1]);
		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) {
			expect(["getItemsData", "getItemsFromBarcodeData"]).toContain(call);
		}
	});
});
