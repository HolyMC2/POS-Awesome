/**
 * Discount decision rules (roadmap §17.2).
 *
 * A discount is money leaving the till, so these are the guards that matter:
 * nothing negative, nothing over 100%, nothing larger than the sale, and a
 * total the operator can read back BEFORE committing. Pure module, no DOM —
 * DiscountDialog.vue is a thin shell over exactly this.
 */

import { describe, expect, it } from "vitest";

import {
	evaluateDiscount,
	seedDraft,
} from "../src/posapp/components/pos/invoice/discountIntent";

describe("preview total", () => {
	it("computes what a percentage discount leaves", () => {
		const intent = evaluateDiscount("percentage", 10, 200);
		expect(intent.discountAmount).toBe(20);
		expect(intent.newTotal).toBe(180);
		expect(intent.ok).toBe(true);
	});

	it("computes what an amount discount leaves", () => {
		expect(evaluateDiscount("amount", 25, 200).newTotal).toBe(175);
	});

	it("never previews a negative total", () => {
		expect(evaluateDiscount("amount", 500, 200).newTotal).toBe(0);
	});

	it("handles the strings a number input produces", () => {
		expect(evaluateDiscount("percentage", "10", "200").newTotal).toBe(180);
		expect(evaluateDiscount("percentage", "", 200).newTotal).toBe(200);
	});
});

describe("guards", () => {
	it("refuses a negative discount", () => {
		const intent = evaluateDiscount("percentage", -5, 200);
		expect(intent.ok).toBe(false);
		expect(intent.warning).toContain("negative");
	});

	it("refuses more than 100 percent", () => {
		expect(evaluateDiscount("percentage", 120, 200).ok).toBe(false);
	});

	it("refuses an amount larger than the sale", () => {
		// A negative total would be a refund the till has no record of.
		expect(evaluateDiscount("amount", 250, 200).ok).toBe(false);
	});

	it("allows exactly 100 percent — a full comp is a real decision", () => {
		const intent = evaluateDiscount("percentage", 100, 200);
		expect(intent.ok).toBe(true);
		expect(intent.newTotal).toBe(0);
	});

	it("allows a discount equal to the sale total", () => {
		expect(evaluateDiscount("amount", 200, 200).ok).toBe(true);
	});

	it("speaks the operator's language when given a translator", () => {
		const intent = evaluateDiscount("percentage", -1, 200, () => "traducido");
		expect(intent.warning).toBe("traducido");
	});
});

describe("reopening on an applied discount", () => {
	it("seeds the applied percentage rather than an empty box", () => {
		// An empty box over a live discount reads as "no discount" and invites
		// double-discounting.
		expect(seedDraft("percentage", 12, 0)).toBe(12);
	});

	it("seeds the applied amount in amount mode", () => {
		expect(seedDraft("amount", 0, 30)).toBe(30);
	});

	it("leaves the box empty when nothing is applied", () => {
		expect(seedDraft("percentage", 0, 0)).toBe("");
	});
});
