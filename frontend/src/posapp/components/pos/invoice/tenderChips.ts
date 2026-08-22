/**
 * Tender chips — the tender chosen BEFORE the primary action
 * (Riel y Cajón §11 item E, `Main.dc.html` nodes 127–131).
 *
 * The artboard puts a row of tenders immediately above PAGAR:
 *
 *     Cobrar con   [Efectivo] [Tarjeta] [Transfer.] [Mixto]
 *
 * so PAGAR completes a decision already made rather than opening a screen to
 * make it. On a cash sale — most sales at these counters — that is one step
 * off every transaction.
 *
 * What this module does NOT do, deliberately: it moves a CHOICE earlier, not
 * money. Tendered amount, change due, split payments and submission all stay
 * on the payment screen exactly where they were. The chip pre-arms; it never
 * pays.
 *
 * Pure: no Vue, no store, no `__()`. The armed value is held in
 * `armedTender.ts` and the component passes context in.
 */

/** A payment row as the POS Profile's `payments` child table carries it. */
export interface TenderProfilePayment {
	mode_of_payment?: string | null;
	default?: number | boolean | null;
	type?: string | null;
}

export interface TenderProfile {
	payments?: readonly (TenderProfilePayment | null | undefined)[] | null;
	/** Gift cards are redeemed by code, not chosen as a tender — see below. */
	posa_use_gift_cards?: number | boolean | null;
}

export interface TenderChip {
	/**
	 * `mode_of_payment`. It is both the identity and the visible text, which is
	 * why no chip carries a source string: `Efectivo` is what this register's
	 * profile is called, not something to translate. A register with
	 * `MercadoPago Point` or `Transferencia BBVA` renders exactly that.
	 */
	mode: string;
	/** The profile's default line — the chip the register opens on. */
	isDefault: boolean;
}

/**
 * `undefined` = untouched, so the register opens on its own default.
 * `null`      = explicitly MIXED — see `resolveArmedTender`.
 * `string`    = a chosen `mode_of_payment`.
 *
 * The three states are distinct on purpose: collapsing "untouched" into
 * "mixed" would re-light the default the moment anything re-rendered, undoing
 * a deselection the cashier just made.
 */
export type TenderSelection = string | null | undefined;

export interface TenderContext {
	/** False on an empty cart — there is no sale for a tender to belong to. */
	cartHasItems: boolean;
	/** A refund is not "cobrar con"; the strip does not arm one. */
	isReturn: boolean;
}

const truthy = (value: unknown): boolean =>
	value === 1 || value === "1" || value === true;

/**
 * Gift-card methods are excluded, matching `Payments.vue`'s
 * `visiblePaymentMethods`: a gift card is redeemed by scanning a code in its
 * own section, so pre-arming one would arm a method the payment screen does
 * not even list among its cards.
 */
const isGiftCardMode = (mode: string, profile: TenderProfile | null | undefined): boolean =>
	truthy(profile?.posa_use_gift_cards) && mode.toLowerCase().includes("gift");

/**
 * The register's tenders, in profile order.
 *
 * There is no hardcoded four. `Efectivo · Tarjeta · Transfer.` is what the
 * artboard's shop happens to have; a carnicería with cash only gets ONE chip
 * and no dead siblings, and a register with MercadoPago Point gets that.
 */
export const resolveTenderChips = (profile: TenderProfile | null | undefined): TenderChip[] => {
	const rows = Array.isArray(profile?.payments) ? profile.payments : [];
	const seen = new Set<string>();
	const chips: TenderChip[] = [];

	for (const row of rows) {
		const mode = String(row?.mode_of_payment ?? "").trim();
		if (!mode || seen.has(mode) || isGiftCardMode(mode, profile)) continue;
		seen.add(mode);
		chips.push({ mode, isDefault: truthy(row?.default) });
	}

	// No default flagged: the first row is what `get_payments` marks default
	// before the doc ever reaches the payment screen, so the strip has to open
	// on the same one or the lit chip would disagree with what PAY does.
	const first = chips[0];
	if (first && !chips.some((chip) => chip.isDefault)) {
		first.isDefault = true;
	}

	return chips;
};

/** The mode the register opens on, or null when it offers no tender at all. */
export const defaultTenderMode = (chips: readonly TenderChip[]): string | null =>
	chips.find((chip) => chip.isDefault)?.mode ?? chips[0]?.mode ?? null;

/**
 * MIXED is offered only where it is possible.
 *
 * `Mixto` is not a payment method and this module never makes it one: it is
 * the EMPTY selection. Deselecting arms nothing, and PAY then opens the
 * payment screen exactly as it does today — every method listed, every amount
 * open — which is already the split-payment surface. A register with a single
 * tender has nothing to mix, so its one chip does not deselect.
 */
export const mixedIsAvailable = (chips: readonly TenderChip[]): boolean => chips.length >= 2;

/**
 * THE GUARD. What is allowed to reach the payment screen as a pre-arm.
 *
 * Everything below either refuses to arm or arms something the register can
 * honour; there is no third outcome. A stale value resolves to null — NOT to
 * the register's default — because silently substituting a different tender
 * for the one the cashier picked is the one failure they would not notice.
 * Null means "unarmed", which is precisely today's behaviour, and the chip
 * strip then shows nothing lit so the cashier is told to choose again.
 *
 * Mutation-tested by `tests/tenderChips.spec.ts`; it is the only function here
 * with money behind it. That harness is also why there is no `!chips.length`
 * early return: an empty register falls out of the membership check below on
 * its own, and a guard line no case can distinguish is a line that will one
 * day be edited without anything going red.
 */
export const resolveArmedTender = (
	selection: TenderSelection,
	chips: readonly TenderChip[],
	context: TenderContext,
): string | null => {
	if (context.isReturn) return null;
	if (!context.cartHasItems) return null;
	if (selection === null) return null;
	if (selection === undefined) return defaultTenderMode(chips);
	// Exact match: `mode_of_payment` is a document name, and a case-folded or
	// trimmed comparison would arm a Mode of Payment that does not exist.
	return chips.some((chip) => chip.mode === selection) ? selection : null;
};
