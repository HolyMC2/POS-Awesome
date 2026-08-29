import { describe, expect, it } from "vitest";
import { nextShareAmount, previewShares } from "../src/posapp/utils/splitEvenly";

describe("splitEvenly · dividir entre N (critique C1, 08-29)", () => {
	it("353.00 ÷ 3 = 117.66 · 117.66 · 117.68 — residue rides the last payer", () => {
		expect(previewShares(353, 3)).toEqual([117.66, 117.66, 117.68]);
	});

	it("every preview sums back to the exact total, cent for cent", () => {
		for (const [total, count] of [
			[353, 3],
			[100, 3],
			[0.05, 4],
			[999.99, 7],
			[1129, 2],
			[45.5, 6],
		] as const) {
			const shares = previewShares(total, count);
			const sum = shares.reduce((acc, share) => acc + Math.round(share * 100), 0);
			expect(sum).toBe(Math.round(total * 100));
			expect(shares).toHaveLength(count);
		}
	});

	it("an exact division has no residue to place", () => {
		expect(previewShares(300, 3)).toEqual([100, 100, 100]);
	});

	it("the next share floors to cents until the last payer, who pays what is left", () => {
		expect(nextShareAmount(353, 3)).toBe(117.66);
		expect(nextShareAmount(353 - 117.66, 2)).toBe(117.67);
		expect(nextShareAmount(353 - 117.66 - 117.67, 1)).toBe(117.67);
	});

	it("one payer left is charged the exact remainder, never a floored one", () => {
		expect(nextShareAmount(0.05, 1)).toBe(0.05);
		expect(nextShareAmount(117.68, 1)).toBe(117.68);
	});

	it("survives junk rather than quoting NaN at the counter", () => {
		expect(previewShares(undefined, 3)).toEqual([]);
		expect(previewShares(100, 0)).toEqual([]);
		expect(previewShares(-50, 3)).toEqual([]);
		expect(nextShareAmount(null, 2)).toBe(0);
		expect(nextShareAmount(100, -1)).toBe(0);
	});
});
