import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	describeDirection,
	drawerDelta,
	drawerSignFor,
	prefillFieldsFromMovement,
} from "../src/posapp/composables/pos/cash/movementDirection";

const formSource = readFileSync(
	fileURLToPath(
		new URL("../src/posapp/components/pos/cash/CashMovementForm.vue", import.meta.url),
	),
	"utf8",
);

const flowSource = readFileSync(
	fileURLToPath(
		new URL("../../posawesome/posawesome/api/cash_movement/flow.py", import.meta.url),
	),
	"utf8",
);

const CONTEXT = {
	default_source_account: "Caja Tienda - GD",
	back_office_cash_account: "Caja Chica Hidalgo 1 - GD",
	default_expense_account: "Sueldos y salarios - GD",
};

describe("cash movement direction", () => {
	it("sends deposit money out of the drawer and cash in back into it", () => {
		const deposit = describeDirection("Deposit", {}, CONTEXT);
		expect(deposit.fromAccount).toBe("Caja Tienda - GD");
		expect(deposit.toAccount).toBe("Caja Chica Hidalgo 1 - GD");
		expect(deposit.entersDrawer).toBe(false);

		const cashIn = describeDirection("Cash In", {}, CONTEXT);
		expect(cashIn.fromAccount).toBe("Caja Chica Hidalgo 1 - GD");
		expect(cashIn.toAccount).toBe("Caja Tienda - GD");
		expect(cashIn.entersDrawer).toBe(true);
	});

	it("routes expenses from the drawer to the expense account", () => {
		const expense = describeDirection("Expense", {}, CONTEXT);
		expect(expense.fromAccount).toBe("Caja Tienda - GD");
		expect(expense.toAccount).toBe("Sueldos y salarios - GD");
		expect(expense.entersDrawer).toBe(false);
	});

	it("prefers explicit overrides over profile defaults", () => {
		const direction = describeDirection(
			"Cash In",
			{ sourceAccount: "Caja Mostrador - GD" },
			CONTEXT,
		);
		expect(direction.toAccount).toBe("Caja Mostrador - GD");
		expect(direction.fromAccount).toBe("Caja Chica Hidalgo 1 - GD");
	});

	it("reports unresolved accounts as empty instead of guessing", () => {
		const direction = describeDirection("Deposit", {}, {});
		expect(direction.fromAccount).toBe("");
		expect(direction.toAccount).toBe("");
	});

	// Must stay in lockstep with backend flow.py:drawer_delta.
	it("signs the drawer effect the same way the backend does", () => {
		expect(drawerSignFor("Cash In")).toBe(1);
		expect(drawerSignFor("Deposit")).toBe(-1);
		expect(drawerSignFor("Expense")).toBe(-1);
		expect(drawerSignFor(null)).toBe(-1);

		expect(drawerDelta("Cash In", 2500)).toBe(2500);
		expect(drawerDelta("Deposit", 2500)).toBe(-2500);
		// Magnitude only: a negative amount must not flip the direction.
		expect(drawerDelta("Cash In", -2500)).toBe(2500);
		expect(drawerDelta("Deposit", -2500)).toBe(-2500);
	});

	// The whole bug class here is the two sides disagreeing about direction.
	// If someone adds an inflow type to flow.py, this fails until the UI knows.
	it("agrees with flow.py about which types add cash to the drawer", () => {
		const declared = /CASH_IN_TYPES\s*=\s*frozenset\(\{([^}]*)\}\)/.exec(flowSource)?.[1];
		expect(declared, "CASH_IN_TYPES not found in flow.py").toBeDefined();

		const backendInflowTypes = [...(declared ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		expect(backendInflowTypes).toEqual(["Cash In"]);

		for (const type of backendInflowTypes) {
			expect(drawerSignFor(type as string)).toBe(1);
		}
		for (const type of ["Expense", "Deposit"]) {
			expect(backendInflowTypes).not.toContain(type);
			expect(drawerSignFor(type)).toBe(-1);
		}
	});
});

describe("cash movement prefill", () => {
	it("unswaps a stored Cash In row back into role-based form fields", () => {
		// Stored direction is back-office -> drawer.
		const prefill = prefillFieldsFromMovement({
			movement_type: "Cash In",
			source_account: "Caja Chica Hidalgo 1 - GD",
			target_account: "Caja Tienda - GD",
		});

		expect(prefill.movementType).toBe("Cash In");
		expect(prefill.sourceAccount).toBe("Caja Tienda - GD");
		expect(prefill.targetAccount).toBe("Caja Chica Hidalgo 1 - GD");
		expect(prefill.expenseAccount).toBe("");

		// Round-trip: the rebuilt form must describe the original direction.
		const direction = describeDirection(prefill.movementType, prefill, CONTEXT);
		expect(direction.fromAccount).toBe("Caja Chica Hidalgo 1 - GD");
		expect(direction.toAccount).toBe("Caja Tienda - GD");
		expect(direction.entersDrawer).toBe(true);
	});

	it("passes deposit and expense rows through untouched", () => {
		const deposit = prefillFieldsFromMovement({
			movement_type: "Deposit",
			source_account: "Caja Tienda - GD",
			target_account: "Caja Chica Hidalgo 1 - GD",
		});
		expect(deposit.movementType).toBe("Deposit");
		expect(deposit.sourceAccount).toBe("Caja Tienda - GD");
		expect(deposit.targetAccount).toBe("Caja Chica Hidalgo 1 - GD");

		const expense = prefillFieldsFromMovement({
			movement_type: "Expense",
			source_account: "Caja Tienda - GD",
			expense_account: "Sueldos y salarios - GD",
		});
		expect(expense.movementType).toBe("Expense");
		expect(expense.expenseAccount).toBe("Sueldos y salarios - GD");
	});

	it("leaves the type alone when the row carries an unknown one", () => {
		expect(prefillFieldsFromMovement({ movement_type: "Transfer" }).movementType).toBeNull();
		expect(prefillFieldsFromMovement({}).movementType).toBeNull();
	});
});

describe("cash movement form wiring", () => {
	it("offers exactly one submit button so the selected type is the action", () => {
		const submitHandlers = formSource.match(/@click="onSubmit\(/g) ?? [];
		expect(submitHandlers).toHaveLength(1);
		// The old form hard-coded the type at the button; that is what let a
		// Deposit go out while the cashier believed they were taking cash in.
		expect(formSource).not.toContain("onSubmit('Deposit')");
		expect(formSource).not.toContain("onSubmit('Cash In')");
		expect(formSource).not.toContain("onSubmit('Expense')");
	});

	it("always renders the direction strip alongside the type selector", () => {
		expect(formSource).toContain('data-testid="cash-movement-direction"');
		expect(formSource).toContain("fromAccountLabel");
		expect(formSource).toContain("toAccountLabel");
		expect(formSource).toContain("directionSummary");
	});

	it("names the direction in every movement type option", () => {
		expect(formSource).toContain('__("Expense — cash out")');
		expect(formSource).toContain('__("Deposit — drawer to back office")');
		expect(formSource).toContain('__("Cash In — back office to drawer")');
	});
});
