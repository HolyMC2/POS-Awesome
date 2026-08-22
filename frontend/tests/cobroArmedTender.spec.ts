import { afterEach, describe, expect, it } from "vitest";

import { resolveArmedPaymentLine } from "../src/posapp/components/pos/payments/armedTenderPreselect";
import {
	armTender,
	peekArmedTender,
	resetTenderSelection,
} from "../src/posapp/components/pos/invoice/armedTender";
import { resolveTenderChips } from "../src/posapp/components/pos/invoice/tenderChips";

/**
 * Where the tender armed on the sale screen lands (§11 item E → §12 item B).
 *
 * The chip strip pre-arms a method; the payment screen should open on it. The
 * failure this guards against is the opposite of the strip's: there, silently
 * substituting the default for a withdrawn pick would deceive the cashier;
 * here, refusing to substitute would strand them on a screen with no method
 * selected. So the resolver returns `null` for "no opinion" and the payment
 * screen's existing default takes over — visibly, on the screen they have
 * always seen.
 */

const CASH = "Efectivo";
const CARD = "Tarjeta";

const PROFILE = {
	payments: [
		{ mode_of_payment: CASH, default: 1, type: "Cash" },
		{ mode_of_payment: CARD, default: 0, type: "Bank" },
	],
};

const DOC_PAYMENTS = [
	{ mode_of_payment: CASH, default: 1, amount: 0 },
	{ mode_of_payment: CARD, default: 0, amount: 0 },
];

const SELLING = { cartHasItems: true, isReturn: false };

afterEach(() => {
	resetTenderSelection();
});

describe("the payment screen opens on the armed method", () => {
	it("picks the armed line even when another one is the profile default", () => {
		const chips = resolveTenderChips(PROFILE);
		armTender(CARD, chips, SELLING);
		expect(peekArmedTender()).toBe(CARD);

		expect(resolveArmedPaymentLine(DOC_PAYMENTS, peekArmedTender())?.mode_of_payment).toBe(CARD);
	});

	it("has no opinion when the strip was never touched beyond the default", () => {
		// Untouched still ARMS the default — the strip lights it — and the
		// payment screen would have opened there anyway. Same answer, no
		// override needed, which keeps today's behaviour byte-for-byte.
		const chips = resolveTenderChips(PROFILE);
		armTender(undefined, chips, SELLING);
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, peekArmedTender())?.mode_of_payment).toBe(CASH);
	});

	it("has no opinion on MIXED", () => {
		const chips = resolveTenderChips(PROFILE);
		armTender(null, chips, SELLING);
		expect(peekArmedTender()).toBeNull();
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, peekArmedTender())).toBeNull();
	});
});

describe("a stale arm does not resurrect", () => {
	it("reads null once the sale has ended", () => {
		const chips = resolveTenderChips(PROFILE);
		armTender(CARD, chips, SELLING);
		resetTenderSelection();

		expect(peekArmedTender()).toBeNull();
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, peekArmedTender())).toBeNull();
	});

	it("does not pre-select a method the invoice does not carry", () => {
		// The profile reloaded between arming and paying. Opening on a line the
		// doc has no row for would leave the amount on nothing at all.
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, "Vale de despensa")).toBeNull();
	});

	it("matches the mode of payment exactly", () => {
		// `mode_of_payment` is a document name; a folded or padded match would
		// open on a Mode of Payment that does not exist.
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, "efectivo")).toBeNull();
		expect(resolveArmedPaymentLine(DOC_PAYMENTS, ` ${CASH}`)).toBeNull();
	});

	it("survives an invoice with no payment rows", () => {
		expect(resolveArmedPaymentLine([], CASH)).toBeNull();
		expect(resolveArmedPaymentLine(null, CASH)).toBeNull();
		expect(resolveArmedPaymentLine(undefined, CASH)).toBeNull();
		expect(resolveArmedPaymentLine([null, undefined, {}], CASH)).toBeNull();
	});

	it("only ever returns a row the invoice actually has", () => {
		// The property behind every case above, stated once: whatever comes out
		// is either null or one of the doc's own payment lines. Nothing else
		// can reach the amount pre-fill.
		for (const armed of [null, undefined, "", CASH, CARD, "efectivo", "Vale"]) {
			const line = resolveArmedPaymentLine(DOC_PAYMENTS, armed);
			if (line !== null) {
				expect(DOC_PAYMENTS).toContain(line);
			}
		}
	});
});
