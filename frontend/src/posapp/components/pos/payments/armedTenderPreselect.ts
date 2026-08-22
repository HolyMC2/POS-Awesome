/**
 * Where the tender armed on the sale screen lands (§11 item E → §12 item B).
 *
 * `InvoiceSummary`'s chip strip lets the cashier pick `Efectivo` BEFORE
 * pressing PAY; `armedTender.ts` holds that pick. This is the read side: which
 * of the invoice's payment lines the payment screen should open on.
 *
 * ⚠ THE CHANGE THIS ENABLES IS NOT MADE HERE. `Payments.vue` and
 * `utils/paymentInitialization.ts` are the money path and are outside this
 * task's write scope, so this module ships as the tested resolver and the
 * one-line call is in the report. It exists rather than being inlined because
 * the failure it guards against — arming a tender the invoice does not carry —
 * puts the full amount on a Mode of Payment nobody chose, and a guard written
 * inline in a 3,000-line component is a guard nobody re-reads.
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
