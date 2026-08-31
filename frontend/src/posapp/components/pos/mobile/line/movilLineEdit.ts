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

import { isFractionEligible } from "../../../../utils/fractionalMath";
import { resolveSaleSummary, type SaleSummarySourceLine } from "../../payments/saleSummary";

/** A cart row, as `invoiceStore.items` holds it, plus the fields the gates read. */
export interface MovilLineEditSource extends SaleSummarySourceLine {
	discount_percentage?: number | string | null;
	discount_amount?: number | string | null;
	price_list_rate?: number | string | null;
	/** A free line, an applied offer, a replacement — each disables a control. */
	is_free_item?: number | boolean | null;
	posa_is_offer?: number | boolean | null;
	posa_offer_applied?: number | boolean | null;
	posa_is_replace?: number | boolean | null;
	/** Set by the stock guard when the shelf cannot pay for one more. */
	disable_increment?: number | boolean | null;
	/** The unit story: what it is sold in, what the shelf counts it in. */
	uom?: string | null;
	stock_uom?: string | null;
	item_uoms?: Array<{ uom?: string | null; conversion_factor?: number | string | null }> | null;
	conversion_factor?: number | string | null;
	stock_qty?: number | string | null;
	/** ERPNext's own "may this be fractional" answer, on the items wire. */
	must_be_whole_number?: unknown;
	sub_unit?: unknown;
	/** Stock the expanded row shows read-only. */
	_base_actual_qty?: number | string | null;
	warehouse?: string | null;
	item_group?: string | null;
	/** The numbered-unit story, exactly as the cart row carries it. */
	has_serial_no?: unknown;
	has_batch_no?: unknown;
	serial_no_selected?: unknown;
	batch_no?: string | null;
	batch_no_expiry_date?: string | null;
	/** Order / Quotation lines carry a promised date. */
	posa_delivery_date?: string | null;
}

/** The two POS Profile checkboxes the desk row reads before it draws an editor. */
export interface MovilLineEditProfile {
	posa_allow_user_to_edit_rate?: unknown;
	posa_allow_user_to_edit_item_discount?: unknown;
	posa_allow_price_list_rate_change?: unknown;
	posa_allow_sales_order?: unknown;
}

export interface MovilLineEditOptions {
	profile?: MovilLineEditProfile | null;
	/** A return invoice carries negative quantities and freezes free lines. */
	isReturn?: boolean;
	/** A return AGAINST a document also freezes the unit of measure. */
	returnAgainst?: boolean;
	/** `verticalStore.has("fractional")` — the register weighs, or it does not. */
	verticalHasFractional?: boolean;
	/** `invoiceStore.invoiceType` — the delivery date only exists on Order / Quotation. */
	invoiceType?: string | null;
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
	/** The peso twin of the % — `discount_amount`, sign dropped like the desk's. */
	discountAmount: number;
	isCombo: boolean;
	componentCount: number;
	/** The unit story. `uomOptions` empty means the item sells in one unit only. */
	uom: string;
	stockUom: string;
	uomOptions: string[];
	conversionFactor: number;
	/** What the line counts in shelf units — drawn only when the UOMs differ. */
	stockQty: number;
	/** Read-only stock facts the expanded row has always shown. */
	availableQty: number;
	warehouse: string;
	itemGroup: string;
	/** The list price behind the rate, and whether this register may move it. */
	priceListRate: number;
	/** The numbered-unit story: what is chosen now, and whether it can change. */
	hasLots: boolean;
	hasSerial: boolean;
	hasBatch: boolean;
	lotSerials: string[];
	lotBatchNo: string;
	lotBatchExpiry: string;
	/** `posa_delivery_date`, as the row stores it (dd-MM-yyyy). */
	deliveryDate: string;
	canStepUp: boolean;
	canStepDown: boolean;
	canTypeQty: boolean;
	canEditRate: boolean;
	canEditDiscount: boolean;
	canEditUom: boolean;
	/** The weighing pad's gate — the register weighs AND the unit divides. */
	canWeigh: boolean;
	canChangePriceListRate: boolean;
	canEditLots: boolean;
	canEditDeliveryDate: boolean;
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
	/** The peso discount field — `discount_amount` through the same calc pass. */
	| { kind: "discountAmount"; amount: number }
	/** The UOM select — `calc_uom` verbatim, which reprices the line. */
	| { kind: "uom"; uom: string }
	/** The Change Price flow without its prompt — apply + persist, one rate. */
	| { kind: "priceListRate"; rate: number }
	/** dd-MM-yyyy, exactly as `posa_delivery_date` stores it. */
	| { kind: "deliveryDate"; date: string }
	/** The weighing pad's note ride-along — only set where the line has none. */
	| { kind: "note"; note: string }
	/** A re-answered lot picker: the first add re-shapes THIS row, the rest add lines. */
	| { kind: "lots"; adds: Array<Record<string, any>> }
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

	// The unit story. `item_uoms` is ERPNext's conversion table on the item
	// payload; a single entry means there is nothing to choose.
	const uom = text(row.uom) || text(row.stock_uom);
	const stockUom = text(row.stock_uom);
	const uomOptions = Array.isArray(row.item_uoms)
		? Array.from(new Set(row.item_uoms.map((entry) => text(entry?.uom)).filter(Boolean)))
		: [];

	// The serial list as the cart row carries it — an array after the picker,
	// a newline-joined string off a loaded draft. Both are the same selection.
	const rawSerials = row.serial_no_selected;
	const lotSerials = Array.isArray(rawSerials)
		? rawSerials.map(text).filter(Boolean)
		: text(rawSerials)
			? text(rawSerials).split("\n").map(text).filter(Boolean)
			: [];

	return {
		rowId,
		itemCode: summary.itemCode,
		itemName: summary.itemName,
		qty: summary.qty,
		rate: summary.rate,
		amount: summary.amount,
		discountPercentage: toNumber(row.discount_percentage),
		// `Math.abs` like the desk's field: a return line carries the sign in
		// the qty, and a negative discount would read as a surcharge.
		discountAmount: Math.abs(toNumber(row.discount_amount)),
		isCombo: summary.isCombo,
		componentCount: summary.componentCount,
		uom,
		stockUom,
		uomOptions,
		conversionFactor: toNumber(row.conversion_factor) || 1,
		stockQty: toNumber(row.stock_qty),
		availableQty: toNumber(row._base_actual_qty),
		warehouse: text(row.warehouse),
		itemGroup: text(row.item_group),
		priceListRate: toNumber(row.price_list_rate),
		hasLots: flag(row.has_serial_no) || flag(row.has_batch_no),
		hasSerial: flag(row.has_serial_no),
		hasBatch: flag(row.has_batch_no),
		lotSerials,
		lotBatchNo: text(row.batch_no),
		lotBatchExpiry: text(row.batch_no_expiry_date),
		deliveryDate: text(row.posa_delivery_date),
		// `disableIncrement` / `disableDecrement`, negated.
		canStepUp: !isReplace && !flag(row.disable_increment) && !frozenReturnLine,
		canStepDown: !isReplace && !frozenReturnLine,
		canTypeQty: !frozenReturnLine,
		canEditRate: flag(profile?.posa_allow_user_to_edit_rate) && !isReplace,
		canEditDiscount:
			flag(profile?.posa_allow_user_to_edit_item_discount) &&
			!isReplace &&
			!flag(row.posa_offer_applied),
		// The expanded row's UOM select: frozen on a replacement and on a
		// return that references a source document, and pointless with one UOM.
		canEditUom:
			uomOptions.length > 1 && !isReplace && !(isReturn && Boolean(options.returnAgainst)),
		// `offersFractionalPad`, restated: the REGISTER weighs (`fractional`
		// vertical) and ERPNext lets this unit divide. The frozen-line clause
		// is `disableInput`'s, same as the desk's declaration order.
		canWeigh:
			Boolean(options.verticalHasFractional) &&
			isFractionEligible({
				uom,
				mustBeWholeNumber: row.must_be_whole_number,
				precision: 3,
				subUnit: row.sub_unit,
			}) &&
			!frozenReturnLine,
		canChangePriceListRate: flag(profile?.posa_allow_price_list_rate_change) && !isReplace,
		// The expanded row's serial / batch editors carry no extra gate; a
		// combo parent has no lot of its own, its components do.
		canEditLots:
			(flag(row.has_serial_no) || flag(row.has_batch_no)) && !isReplace && !summary.isCombo,
		canEditDeliveryDate:
			flag(profile?.posa_allow_sales_order) &&
			["Order", "Quotation"].includes(text(options.invoiceType)),
		// The desk's delete button carries exactly this one condition.
		canRemove: !isReplace,
	};
};

export default resolveMovilLineEdit;
