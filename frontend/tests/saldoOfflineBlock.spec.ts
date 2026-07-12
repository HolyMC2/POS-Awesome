import { describe, expect, it } from "vitest";

import { shouldBlockSaldoOffline } from "../src/posapp/composables/pos/items/useItemAddition";

const saldoItem = { item_code: "RECARGA-100", saldo_enabled: 1 };
const normalItem = { item_code: "PART-001", saldo_enabled: 0 };
const legacyItem = { item_code: "PART-002" }; // saldo_enabled undefined (mumu/stale cache)

describe("shouldBlockSaldoOffline", () => {
	it("blocks a saldo item added offline", () => {
		expect(shouldBlockSaldoOffline(saldoItem, {}, true)).toBe(true);
	});

	it("allows a saldo item online (capture will run)", () => {
		expect(shouldBlockSaldoOffline(saldoItem, {}, false)).toBe(false);
	});

	it("never blocks a non-saldo item offline", () => {
		expect(shouldBlockSaldoOffline(normalItem, {}, true)).toBe(false);
		expect(shouldBlockSaldoOffline(legacyItem, {}, true)).toBe(false);
	});

	it("does not block a return line (refund of a prior recarga)", () => {
		expect(
			shouldBlockSaldoOffline(saldoItem, { isReturnInvoice: true }, true),
		).toBe(false);
	});

	it("does not re-block a saldo line that already carries a referencia", () => {
		// Captured online, being re-processed — its referencia is real.
		expect(
			shouldBlockSaldoOffline(
				{ ...saldoItem, saldo_referencia: "TAECEL-abc123" },
				{},
				true,
			),
		).toBe(false);
	});
});
