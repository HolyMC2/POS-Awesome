import { describe, expect, it } from "vitest";

import {
	clampReturnQty,
	defaultSelection,
	planReturnLines,
	selectedSourceItems,
	type ReturnableLine,
} from "../src/posapp/components/pos/flows/returns/returnLines";

/** Ticket B-04788, as `get_invoice_for_return` answers it. */
const SOLD: ReturnableLine[] = [
	{ name: "row-mica", item_code: "IPN003282", item_name: "Mica 9D Samsung A16", rate: 149, qty: 1 },
	{ name: "row-cable", item_code: "IPN004117", item_name: "Cable USB-C 1 m", rate: 189, qty: 1 },
	{ name: "row-case", item_code: "IPN000658", item_name: "Case Magsafe humo S24", rate: 220, qty: 1 },
];

describe("the picker cannot return more than was sold", () => {
	it("clamps a request above what the line has left", () => {
		// The invariant with money behind it: a register that accepts 5 back on
		// a line that sold 1 pays out four units it never took in.
		expect(clampReturnQty(5, 1)).toBe(1);
		expect(clampReturnQty(99, 3)).toBe(3);
	});

	it("clamps through the plan, not only through the helper", () => {
		const plan = planReturnLines(SOLD, { "row-mica": 7 });
		expect(plan.lines[0]?.qty).toBe(1);
		expect(plan.lines[0]?.clamped).toBe(true);
		expect(plan.anyClamped).toBe(true);
		expect(plan.selectedAmount).toBe(149);
	});

	it("clamps against what is LEFT after earlier returns, not the original sale", () => {
		// The endpoint subtracts previous returns before it answers, so `qty` is
		// already the remainder — one ledger, on the server.
		const partlyReturned: ReturnableLine[] = [
			{ name: "row-mica", item_code: "IPN003282", rate: 149, qty: 1 },
		];
		expect(planReturnLines(partlyReturned, { "row-mica": 3 }).lines[0]?.qty).toBe(1);
	});

	it("refuses a negative or nonsense quantity instead of crediting it", () => {
		expect(clampReturnQty(-4, 2)).toBe(0);
		expect(clampReturnQty("abc", 2)).toBe(0);
		expect(clampReturnQty(undefined, 2)).toBe(0);
		expect(clampReturnQty(2, -1)).toBe(0);
	});

	it("keeps a fractional quantity a weighed line genuinely returns", () => {
		// §4.2's scale: 0.740 kg comes back, and flooring it would silently
		// refuse the return.
		expect(clampReturnQty(0.74, 2)).toBe(0.74);
	});
});

describe("what the picker opens with", () => {
	it("selects every line at full quantity", () => {
		// Byte-identical to what the shipped flow does today: both entry points
		// hand the whole invoice to the cart. The artboard's "1 de 3" is a
		// cashier mid-task, not a default.
		expect(defaultSelection(SOLD)).toEqual({ "row-mica": 1, "row-cable": 1, "row-case": 1 });
		const plan = planReturnLines(SOLD, defaultSelection(SOLD));
		expect(plan.selectedLineCount).toBe(3);
		expect(plan.selectedAmount).toBe(558);
	});

	it("counts lines and pieces separately", () => {
		const twoOfOne: ReturnableLine[] = [{ name: "r", item_code: "X", rate: 10, qty: 4 }];
		const plan = planReturnLines(twoOfOne, { r: 3 });
		expect(plan.selectedLineCount).toBe(1);
		expect(plan.selectedPieceCount).toBe(3);
	});
});

describe("the amount on screen is a projection of the original prices", () => {
	it("adds up the artboard's own numbers", () => {
		const plan = planReturnLines(SOLD, { "row-mica": 1 });
		expect(plan.selectedAmount).toBe(149);
		expect(plan.selectedLineCount).toBe(1);
		expect(plan.totalLineCount).toBe(3);
	});

	it("rounds once over the sum, not once per line", () => {
		// Rounding each line and then adding drifts by a cent per line.
		const thirds: ReturnableLine[] = [
			{ name: "a", item_code: "A", rate: 0.335, qty: 1 },
			{ name: "b", item_code: "B", rate: 0.335, qty: 1 },
		];
		expect(planReturnLines(thirds, { a: 1, b: 1 }).selectedAmount).toBe(0.67);
	});

	it("shows nothing selected as nothing owed", () => {
		const plan = planReturnLines(SOLD, {});
		expect(plan.selectedAmount).toBe(0);
		expect(plan.selectedLineCount).toBe(0);
		expect(plan.lines.every((line) => !line.selected)).toBe(true);
	});
});

describe("what is handed onward", () => {
	const source = [
		{ name: "row-mica", item_code: "IPN003282", qty: 1, rate: 149, net_amount: 128.45, amount: 149 },
		{ name: "row-cable", item_code: "IPN004117", qty: 1, rate: 189, net_amount: 162.93, amount: 189 },
	];

	it("passes every money field through untouched, narrowing only the quantity", () => {
		// "Se conserva el precio, el IVA y la forma de pago originales": the
		// picker chooses ROWS, it does not reprice them.
		const plan = planReturnLines(
			source.map((row) => ({ ...row, item_name: row.item_code })),
			{ "row-mica": 1 },
		);
		const chosen = selectedSourceItems(source, plan);
		expect(chosen).toHaveLength(1);
		expect(chosen[0]).toMatchObject({
			name: "row-mica",
			qty: 1,
			rate: 149,
			net_amount: 128.45,
			amount: 149,
		});
	});

	it("drops a deselected row entirely rather than sending it at zero", () => {
		const plan = planReturnLines(
			source.map((row) => ({ ...row, item_name: row.item_code })),
			{ "row-mica": 0, "row-cable": 1 },
		);
		expect(selectedSourceItems(source, plan).map((row) => row.name)).toEqual(["row-cable"]);
	});

	it("hands back nothing when nothing is selected", () => {
		const plan = planReturnLines(
			source.map((row) => ({ ...row, item_name: row.item_code })),
			{},
		);
		expect(selectedSourceItems(source, plan)).toEqual([]);
	});

	it("survives a row with no name rather than keying the picker on undefined", () => {
		const plan = planReturnLines(
			[{ name: "", item_code: "X", rate: 1, qty: 1 } as ReturnableLine, ...SOLD],
			defaultSelection(SOLD),
		);
		expect(plan.totalLineCount).toBe(3);
	});
});
