/**
 * What the phone is allowed to do to ONE cart line (movil round 10).
 *
 * Until now a tapped cart line on the phone fell back to the classic desktop
 * cart, because the line editor lived there and nowhere else. This module is
 * the half of that editor which is a DECISION rather than a widget: which
 * controls a given row may draw, for this profile, on this invoice.
 *
 * ⚠ IT DECIDES NOTHING NEW.
 *
 * Every gate below is `CartItemRow.vue`'s own, restated against the same
 * fields rather than re-invented — `disableInput`, `disableDecrement`,
 * `disableIncrement`, `disableRateEdit`, `disableDiscountEdit` and the delete
 * button's `:disabled`. A phone that let a cashier retype a rate the desk
 * refuses would not be a nicer register, it would be a second answer to "may
 * this price move", and the shop would find out which one the server believes
 * only after the ticket printed.
 *
 * The MONEY on the sheet is not restated at all: `resolveSaleSummary` already
 * shapes a cart row for a small surface (name, qty, rate, amount, combo) and
 * both the payment screen and the phone's cart read it, so the sheet is fed
 * from the same call. What this module adds is the row's own identity and the
 * gates — nothing that could disagree with a peso.
 *
 * Pure: no Vue, no store, no `__()`.
 */

import { resolveSaleSummary, type SaleSummarySourceLine } from "../../payments/saleSummary";

/** A cart row, as `invoiceStore.items` holds it, plus the fields the gates read. */
export interface MovilLineEditSource extends SaleSummarySourceLine {
	discount_percentage?: number | string | null;
	price_list_rate?: number | string | null;
	/** A free line, an applied offer, a replacement — each disables a control. */
	is_free_item?: number | boolean | null;
	posa_is_offer?: number | boolean | null;
	posa_offer_applied?: number | boolean | null;
	posa_is_replace?: number | boolean | null;
	/** Set by the stock guard when the shelf cannot pay for one more. */
	disable_increment?: number | boolean | null;
}

/** The two POS Profile checkboxes the desk row reads before it draws an editor. */
export interface MovilLineEditProfile {
	posa_allow_user_to_edit_rate?: unknown;
	posa_allow_user_to_edit_item_discount?: unknown;
}

export interface MovilLineEditOptions {
	profile?: MovilLineEditProfile | null;
	/** A return invoice carries negative quantities and freezes free lines. */
	isReturn?: boolean;
}

/** The sheet's whole model: what to draw, and whether it may be touched. */
export interface MovilLineEdit {
	/** `posa_row_id` — the identity every engine handler resolves a row by. */
	rowId: string;
	itemCode: string;
	itemName: string;
	qty: number;
	rate: number;
	/** What the line contributes to the ticket, straight off `resolveSaleSummary`. */
	amount: number;
	discountPercentage: number;
	isCombo: boolean;
	componentCount: number;
	canStepUp: boolean;
	canStepDown: boolean;
	canTypeQty: boolean;
	canEditRate: boolean;
	canEditDiscount: boolean;
	canRemove: boolean;
}

/**
 * What the sheet asks the register to do. A discriminated union rather than
 * four events: one bus entry, one handler, one place where a new verb has to
 * be answered — and `vue-tsc` refuses a payload that half-matches.
 */
export type MovilLineIntent =
	/** The − / + buttons. `delta` rides `subtract_one` / `add_one` VERBATIM,
	 *  which already mirror the sign on a return and remove the row at zero. */
	| { kind: "step"; delta: 1 | -1 }
	/** A typed quantity — the same `setFormatedQty` the desk's inline field uses. */
	| { kind: "qty"; qty: number }
	| { kind: "rate"; rate: number }
	| { kind: "discount"; discount: number }
	| { kind: "remove" };

/** The intent as it rides the bus: the sheet's verb plus the row it is about. */
export type MovilLineEditIntent = MovilLineIntent & {
	rowId: string;
	/** Second-chance identity, exactly as `focus_cart_item_qty` carries one. */
	itemCode?: string;
};

const toNumber = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * Plain JS truthiness, deliberately — that is what `CartItemRow.vue` applies to
 * these same fields (`!props.posProfile.posa_allow_user_to_edit_rate`,
 * `!!props.item.posa_is_replace`). A stricter predicate here would make the
 * phone and the desk disagree about a `"0"` that Frappe never actually sends.
 */
const flag = (value: unknown): boolean => Boolean(value);

/**
 * Shape one cart row into the phone's line sheet, or return `null` when there
 * is nothing a cashier can be shown.
 *
 * `null` for a row without a `posa_row_id`: the register writes one onto every
 * line it accepts (`invoiceStore`, `actions.ts`, `loader.ts`), so its absence
 * means the row is mid-flight — and an edit sent without an identity would be
 * resolved by item code onto whichever line matched first. The caller falls
 * back to the classic cart there, which owns the identity-free path already.
 */
export const resolveMovilLineEdit = (
	row: MovilLineEditSource | null | undefined,
	options: MovilLineEditOptions = {},
): MovilLineEdit | null => {
	if (!row) return null;

	const rowId = text(row.posa_row_id);
	if (!rowId) return null;

	// One row through the shared summary: the sheet's name, qty, rate and
	// amount are the payment screen's figures, not a second reading.
	const summary = resolveSaleSummary([row]).lines[0];
	if (!summary) return null;

	const profile = options.profile ?? null;
	const isReturn = Boolean(options.isReturn);

	const isReplace = flag(row.posa_is_replace);
	// `disableInput` on the desk: a returned free/offer/replacement line has a
	// quantity the register decided, not one the cashier may retype.
	const frozenReturnLine =
		isReturn && (flag(row.is_free_item) || flag(row.posa_is_offer) || isReplace);

	return {
		rowId,
		itemCode: summary.itemCode,
		itemName: summary.itemName,
		qty: summary.qty,
		rate: summary.rate,
		amount: summary.amount,
		discountPercentage: toNumber(row.discount_percentage),
		isCombo: summary.isCombo,
		componentCount: summary.componentCount,
		// `disableIncrement` / `disableDecrement`, negated.
		canStepUp: !isReplace && !flag(row.disable_increment) && !frozenReturnLine,
		canStepDown: !isReplace && !frozenReturnLine,
		canTypeQty: !frozenReturnLine,
		canEditRate: flag(profile?.posa_allow_user_to_edit_rate) && !isReplace,
		canEditDiscount:
			flag(profile?.posa_allow_user_to_edit_item_discount) &&
			!isReplace &&
			!flag(row.posa_offer_applied),
		// The desk's delete button carries exactly this one condition.
		canRemove: !isReplace,
	};
};

export default resolveMovilLineEdit;
