/**
 * Single source of truth for which way money moves in a POS cash movement.
 *
 * The backend stores flow direction on the document (money goes
 * source_account -> target_account) but the create payload is ROLE-based:
 * `source_account` always names the drawer side and `target_account` the
 * back-office side, so one form shape serves every type. That indirection is
 * why the UI must state the direction out loud — a form that looks identical
 * for "Deposit" and "Cash In" is a form that posts 2500 the wrong way.
 *
 * Keep `drawerSign` in lockstep with `flow.py:drawer_delta` on the backend:
 * only Cash In adds to the drawer, everything else takes cash out of it.
 */

export type MovementType = "Expense" | "Deposit" | "Cash In";

export interface MovementContext {
	default_source_account?: string | null;
	default_expense_account?: string | null;
	back_office_cash_account?: string | null;
}

export interface MovementFields {
	/** Drawer side, as the form holds it (role-based, not stored direction). */
	sourceAccount?: string | null;
	expenseAccount?: string | null;
	/** Back-office side, as the form holds it. */
	targetAccount?: string | null;
}

export interface MovementDirection {
	/** Account the money leaves. */
	fromAccount: string;
	/** Account the money lands in. */
	toAccount: string;
	/** Effect of one unit on expected drawer cash: +1 in, -1 out. */
	drawerSign: 1 | -1;
	entersDrawer: boolean;
}

const CASH_IN_TYPES = new Set<string>(["Cash In"]);

const text = (value: unknown) => String(value ?? "").trim();

/** Mirrors backend `flow.drawer_delta` — Cash In is the only inflow. */
export function drawerSignFor(movementType: string | null | undefined): 1 | -1 {
	return CASH_IN_TYPES.has(text(movementType)) ? 1 : -1;
}

/** Signed effect of a movement on expected drawer cash. */
export function drawerDelta(movementType: string | null | undefined, amount: unknown): number {
	const magnitude = Math.abs(Number(amount) || 0);
	return drawerSignFor(movementType) * magnitude;
}

/**
 * Resolve the two concrete accounts a movement will touch, applying the same
 * fallbacks the backend resolvers use so the preview matches what gets posted.
 */
export function describeDirection(
	movementType: string | null | undefined,
	fields: MovementFields = {},
	context: MovementContext | null | undefined = {},
): MovementDirection {
	const type = text(movementType);
	const drawer = text(fields.sourceAccount) || text(context?.default_source_account);
	const backOffice = text(fields.targetAccount) || text(context?.back_office_cash_account);
	const expense = text(fields.expenseAccount) || text(context?.default_expense_account);

	if (CASH_IN_TYPES.has(type)) {
		// Back office funds the drawer (change fund): drawer is the DESTINATION.
		return { fromAccount: backOffice, toAccount: drawer, drawerSign: 1, entersDrawer: true };
	}
	if (type === "Expense") {
		return { fromAccount: drawer, toAccount: expense, drawerSign: -1, entersDrawer: false };
	}
	return { fromAccount: drawer, toAccount: backOffice, drawerSign: -1, entersDrawer: false };
}

/**
 * Turn a stored POS Cash Movement row back into ROLE-based form fields.
 *
 * Cash In rows are stored back-office -> drawer, so their source/target must be
 * swapped before they land in the form; feeding them through unswapped prefills
 * a form that posts the movement backwards. This mirrors the backend's
 * `duplicate_cash_movement`, which does the same flip server-side.
 */
export function prefillFieldsFromMovement(row: any): {
	movementType: MovementType | null;
	sourceAccount: string;
	targetAccount: string;
	expenseAccount: string;
} {
	const type = text(row?.movementType ?? row?.movement_type);
	const storedSource = text(row?.sourceAccount ?? row?.source_account);
	const storedTarget = text(row?.targetAccount ?? row?.target_account);
	const expenseAccount = text(row?.expenseAccount ?? row?.expense_account);

	if (CASH_IN_TYPES.has(type)) {
		return {
			movementType: "Cash In",
			sourceAccount: storedTarget,
			targetAccount: storedSource,
			expenseAccount: "",
		};
	}

	const movementType =
		type === "Expense" || type === "Deposit" ? (type as MovementType) : null;
	return {
		movementType,
		sourceAccount: storedSource,
		targetAccount: storedTarget,
		expenseAccount,
	};
}
