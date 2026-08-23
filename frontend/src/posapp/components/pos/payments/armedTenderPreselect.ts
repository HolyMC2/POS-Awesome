/**
 * Where the tender armed on the sale screen lands (§11 item E → §12 item B).
 *
 * `InvoiceSummary`'s chip strip lets the cashier pick `Efectivo` BEFORE
 * pressing PAY; `armedTender.ts` holds that pick. This is the read side: which
 * of the invoice's payment lines the payment screen should open on.
 *
 * ⚠ WHERE THE CHANGE LANDS. `Payments.vue`'s `ensurePaymentLinesInitialized`
 * calls `applyArmedPaymentPreference` once, before
 * `initializePaymentLinesForDialog`; `utils/paymentInitialization.ts` is
 * untouched. The guard lives here rather than inline because the failure it
 * prevents — arming a tender the invoice does not carry — puts the full amount
 * on a Mode of Payment nobody chose, and a guard written inline in a
 * 3,000-line component is a guard nobody re-reads.
 *
 * What it decides: WHICH LINE, never how much. Amounts, splits, change and
 * submission are untouched; the pre-arm only moves the cursor.
 *
 * Pure: no Vue, no store, no `__()`.
 */

import type { PaymentLine } from "../../../utils/paymentInitialization";

/**
 * The armed line, or `null` for "no opinion" — which is today's behaviour and
 * lets `resolvePreferredPaymentLine` pick the profile default exactly as it
 * does now.
 *
 * `null` is returned, deliberately, in every doubtful case:
 *
 *  - nothing armed (the cashier never touched the strip, or chose MIXED);
 *  - the armed mode is not one of THIS invoice's payment lines — the profile
 *    reloaded, the sale became a return, the method was withdrawn. Falling
 *    back to the register's default is right here and wrong in
 *    `resolveArmedTender`: there the substitution would be silent and the
 *    cashier believed their own pick; here the payment screen visibly opens on
 *    the default, which is the screen they have always seen.
 *
 * Comparison is exact. `mode_of_payment` is a document name, and a folded or
 * trimmed match would open on a Mode of Payment that does not exist.
 */
export const resolveArmedPaymentLine = (
	payments: readonly (PaymentLine | null | undefined)[] | null | undefined,
	armed: string | null | undefined,
): PaymentLine | null => {
	if (!armed) return null;
	const rows = Array.isArray(payments) ? payments : [];
	return rows.find((row) => !!row?.mode_of_payment && row.mode_of_payment === armed) ?? null;
};

/** What can withdraw the arm's authority at the moment the screen opens. */
export interface ArmedPreferenceContext {
	/**
	 * A refund is not "cobrar con". The strip already refuses to arm one, and
	 * this refuses again in case the sale turned into a return after the arm.
	 */
	isReturn?: boolean | null;
	/**
	 * The cashier has entered an amount. From that moment the screen is theirs:
	 * re-opening it must not move the money off the line they typed on.
	 */
	paymentsTouched?: boolean | null;
}

/**
 * Make the armed tender the line the payment screen opens on.
 *
 * `default` is the register's OWN word for "the line the screen opens on":
 * the `Default` badge, the quick-cash denominations, `primaryPaymentMethod`
 * and `resolvePreferredPaymentLine` all read it. Moving the flag is therefore
 * the one change that keeps every one of them agreeing — and the reason it is
 * a flag move rather than four separate overrides.
 *
 * ⚠ WHICH LINE, NEVER HOW MUCH. Not one figure is computed here.
 * `initializePaymentLinesForDialog` still fills the amount, still rounds it,
 * still caps a refund, still splits the same way — on the line this function
 * pointed it at. Moving the badge WITHOUT moving the pre-fill would be the
 * worse bug: the total would sit on Efectivo behind a card labelled Tarjeta,
 * a split nobody asked for.
 *
 * Returns the armed line, or `null` for "no opinion" — unarmed, MIXED, stale,
 * a return, or a screen the cashier has already typed on. In every one of
 * those the payment lines are left exactly as they were and today's default
 * stands, which is the behaviour the register has always had.
 */
export const applyArmedPaymentPreference = (
	payments: (PaymentLine | null | undefined)[] | null | undefined,
	armed: string | null | undefined,
	context: ArmedPreferenceContext = {},
): PaymentLine | null => {
	if (context.isReturn || context.paymentsTouched) return null;

	const rows = Array.isArray(payments) ? payments : [];
	const line = resolveArmedPaymentLine(rows, armed);
	if (!line) return null;

	// Every row, not just the two that change: a second surviving `default`
	// would make `resolvePreferredPaymentLine` and `primaryPaymentMethod` pick
	// by array order, and they walk the array differently.
	for (const row of rows) {
		if (!row) continue;
		row.default = row === line ? 1 : 0;
	}
	return line;
};
