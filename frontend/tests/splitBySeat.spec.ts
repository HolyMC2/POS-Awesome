import { describe, expect, it } from "vitest";
import { seatSplitAvailable, seatSplitPlan } from "../src/posapp/utils/splitBySeat";

const line = (seat: number, amount: number) => ({ seat, qty: 1, rate: amount, amount });

describe("splitBySeat · por asiento (B4's payoff at cobro)", () => {
	it("proportional to what each seat ordered — the settle total, not the line sum", () => {
		// A1 ordered 300, A2 ordered 100; the register collects 440 (tax+tip).
		const lines = [line(1, 300), line(2, 100)];
		expect(seatSplitPlan(lines, 440)).toEqual([
			{ seat: 1, amount: 330 },
			{ seat: 2, amount: 110 },
		]);
	});

	it("shared lines (seat 0) split equally across the seats present", () => {
		// 100 shared + A1's 100: A1 weighs 150, A2 weighs 50.
		const lines = [line(0, 100), line(1, 100), line(2, 0)];
		expect(seatSplitPlan(lines, 200)).toEqual([
			{ seat: 1, amount: 150 },
			{ seat: 2, amount: 50 },
		]);
	});

	it("every plan sums back to the exact total, cent for cent", () => {
		const lines = [line(1, 33.33), line(2, 45.1), line(3, 12.99), line(0, 20)];
		for (const total of [111.42, 128.13, 0.05, 999.99]) {
			const plan = seatSplitPlan(lines, total);
			const sum = plan.reduce((acc, share) => acc + Math.round(share.amount * 100), 0);
			expect(sum).toBe(Math.round(total * 100));
			expect(plan).toHaveLength(3);
		}
	});

	it("the residue rides the last seat, floors everywhere else", () => {
		// Equal weights, 100 ÷ 3: 33.33 · 33.33 · 33.34.
		const lines = [line(1, 10), line(2, 10), line(3, 10)];
		expect(seatSplitPlan(lines, 100)).toEqual([
			{ seat: 1, amount: 33.33 },
			{ seat: 2, amount: 33.33 },
			{ seat: 3, amount: 33.34 },
		]);
	});

	it("skip drops the seats already collected and re-divides what is LEFT", () => {
		const lines = [line(1, 300), line(2, 100), line(3, 100)];
		// A1 paid; a 50 tip arrived after. The 250 left divides over A2/A3
		// by THEIR weights (equal) — A1's receipt is history.
		expect(seatSplitPlan(lines, 250, 1)).toEqual([
			{ seat: 2, amount: 125 },
			{ seat: 3, amount: 125 },
		]);
		expect(seatSplitPlan(lines, 250, 3)).toEqual([]);
	});

	it("a table of comps divides equally instead of dying on zero weights", () => {
		const lines = [line(1, 0), line(2, 0)];
		expect(seatSplitPlan(lines, 50)).toEqual([
			{ seat: 1, amount: 25 },
			{ seat: 2, amount: 25 },
		]);
	});

	it("remaining seats that ordered nothing still divide a late tip equally", () => {
		const lines = [line(1, 100), line(2, 0), line(3, 0)];
		expect(seatSplitPlan(lines, 30, 1)).toEqual([
			{ seat: 2, amount: 15 },
			{ seat: 3, amount: 15 },
		]);
	});

	it("a comped line with amount 0 stays a comp even though qty×rate says otherwise", () => {
		const lines = [
			{ seat: 1, qty: 1, rate: 100, amount: 0 },
			{ seat: 2, qty: 1, rate: 100, amount: 100 },
		];
		expect(seatSplitPlan(lines, 100)).toEqual([
			{ seat: 1, amount: 0 },
			{ seat: 2, amount: 100 },
		]);
	});

	it("availability takes two seats — one diner splitting with themselves is no split", () => {
		expect(seatSplitAvailable([line(1, 100), line(0, 50)])).toBe(false);
		expect(seatSplitAvailable([line(1, 100), line(2, 50)])).toBe(true);
		expect(seatSplitAvailable([line(0, 100)])).toBe(false);
	});

	it("survives junk rather than quoting NaN at the counter", () => {
		expect(seatSplitPlan([], 100)).toEqual([]);
		expect(seatSplitPlan([line(1, 100), line(2, 50)], undefined)).toEqual([
			{ seat: 1, amount: 0 },
			{ seat: 2, amount: 0 },
		]);
		expect(
			seatSplitPlan([{ seat: 1, qty: "x", rate: null }, line(2, 10)], 20),
		).toEqual([
			{ seat: 1, amount: 0 },
			{ seat: 2, amount: 20 },
		]);
	});
});
