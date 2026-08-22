// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The source half of "the register says a fact once" — see
 * `registerSaysItOnce.spec.ts` for the mounted half and the reasoning.
 *
 * These two duplications span `Invoice.vue` and `InvoiceSummary.vue`, which
 * cannot be mounted together without dragging the whole POS into jsdom, so
 * they are scanned instead. Node environment on purpose: `node:fs` named
 * imports do not interop under jsdom (build plan §10), and this file exists
 * because that trap has already cost this repo time twice.
 */

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("the sale surface states a fact once", () => {
	const invoice = () => read("../src/posapp/components/pos/Invoice.vue");

	it("names the customer once", () => {
		// `CustomerStrip` states it; the Sale details disclosure used to echo it
		// on the same screen, one row below.
		const mentions = (invoice().match(/saleCustomerLabel/g) || []).length;
		expect(mentions, "the strip names the customer; nothing else needs to").toBe(2); // computed + strip binding
	});

	it("counts the cart lines once, and not above the cart", () => {
		// `Main.dc.html` puts "6 líneas · 9 piezas" BELOW the cart beside the
		// chips, which is where `InvoiceSummary.lineSummary` renders it. The
		// copy above the cart also disagreed on format ("0.00 pieces" vs
		// "0 pcs"), which is what two sources of one fact look like.
		expect(invoice()).not.toContain("cartCountLabel");
		expect(invoice()).not.toContain('data-testid="cart-line-count"');
		expect(read("../src/posapp/components/pos/invoice/InvoiceSummary.vue")).toContain(
			"lineSummary",
		);
	});
});
