/**
 * The four figures the phone's payment screen carries, derived once and in
 * integers (artboard `MovilCobro.dc.html`).
 *
 *     Cambio a entregar $71.00
 *     Total $1,129.00 · Recibido $1,200.00 · Falta $0.00
 *
 * ⚠ THIS IS A RENDERER, NOT A SECOND MONEY PATH. The invoice total and what
 * has already been tendered both arrive as props from the register's own
 * arithmetic — `usePaymentCalculations`' `rounded_total || grand_total` and
 * `total_payments` — and this restates the relationship between them for the
 * screen. `change_due` there is `max(total_payments − invoice_total, 0)` and
 * `diff_payment` is the same subtraction the other way round; the two
 * functions below are those two, in minor units, plus the pad's live keying so
 * the figure moves under the cashier's thumb before anything is committed.
 * What is finally recorded on the invoice is still `paid_change`, written by
 * `Payments.vue`. Nothing here captures, splits, rounds, authorises or submits.
 *
 * **Shortfall and change are one subtraction, not two computations.** They are
 * derived from a single signed difference, so no input can make both non-zero
 * — a register that says "falta $40" and "cambio $71" at the same time is a
 * register nobody can act on, and the only way to guarantee that is to give
 * them one source rather than two agreeing rules.
 *
 * Pure: no Vue, no store, no `__()`.
 */

import { majorToMinor, minorToMajor } from "../../closing/denominations";
import { resolveChangeBreakdown, type ChangeBreakdown } from "./changeBreakdown";

export interface PayTotalsInput {
	/** The invoice total, in major units, as the register computes it. */
	total?: unknown;
	/** Already committed to payment lines, in major units. */
	tendered?: unknown;
	/** What the keypad currently holds, in MINOR units — already exact. */
	keyedMinor?: unknown;
	currency?: string | null;
}

export interface PayTotals {
	minorPerMajor: number;
	totalMinor: number;
	receivedMinor: number;
	shortfallMinor: number;
	/** Still to cover by the pad: the total less what is already committed. */
	remainingMinor: number;
	/** Major units, for the figures the screen renders. */
	total: number;
	received: number;
	shortfall: number;
	/** The change owed AND which notes make it up. */
	change: ChangeBreakdown;
}

const toMinor = (value: unknown, minorPerMajor: number): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return majorToMinor(parsed, minorPerMajor);
};

const toInteger = (value: unknown): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0;
	return Math.trunc(parsed);
};

/**
 * Every figure on the screen, from one subtraction.
 *
 * `resolveChangeBreakdown` is asked for the change in major units because that
 * is its published contract and it converts once itself; the round trip is
 * exact for the same reason `minorToMajor` is (both are integer operations on
 * a power of ten), and it keeps ONE module owning the major↔minor boundary.
 */
export const resolvePayTotals = (input: PayTotalsInput | null | undefined): PayTotals => {
	const source = input ?? {};
	const breakdownCurrency = source.currency ?? null;
	// Asking the change module for the currency's shape rather than importing
	// `denominationsFor` again: one lookup, one table, no second opinion about
	// what a peso is worth.
	const minorPerMajor = resolveChangeBreakdown(0, breakdownCurrency).denominations.minorPerMajor;

	const totalMinor = Math.max(0, toMinor(source.total, minorPerMajor));
	const tenderedMinor = Math.max(0, toMinor(source.tendered, minorPerMajor));
	const keyedMinor = Math.max(0, toInteger(source.keyedMinor));
	const receivedMinor = tenderedMinor + keyedMinor;

	// THE subtraction. Positive means the customer still owes, negative means
	// the drawer does. Everything below reads this one number.
	const difference = totalMinor - receivedMinor;
	const shortfallMinor = Math.max(difference, 0);
	const changeMinor = Math.max(-difference, 0);

	return {
		minorPerMajor,
		totalMinor,
		receivedMinor,
		shortfallMinor,
		remainingMinor: Math.max(totalMinor - tenderedMinor, 0),
		total: minorToMajor(totalMinor, minorPerMajor),
		received: minorToMajor(receivedMinor, minorPerMajor),
		shortfall: minorToMajor(shortfallMinor, minorPerMajor),
		change: resolveChangeBreakdown(minorToMajor(changeMinor, minorPerMajor), breakdownCurrency),
	};
};

export interface SplitAvailability {
	totals: PayTotals;
	keyedMinor: number;
	/** A tender must be armed for a part-payment to land somewhere. */
	hasArmedTender: boolean;
	/** `mixedIsAvailable(chips)` — a register with one tender cannot split. */
	multipleTenders: boolean;
}

/**
 * When `Dividir pago` is a real option.
 *
 * The key does not divide anything. It closes the CURRENT tender at the amount
 * on the pad and re-opens the pad for the next one, so it only means something
 * when there is an amount, a tender to put it on, another tender to move to,
 * and something left over afterwards. A part-payment that covers the whole
 * remainder is not a split — it is the sale — and offering the key there would
 * invite a cashier to open a second payment row for zero pesos.
 *
 * Enablement only. The rows themselves are written by the payment path.
 */
export const splitIsAvailable = ({
	totals,
	keyedMinor,
	hasArmedTender,
	multipleTenders,
}: SplitAvailability): boolean => {
	if (!hasArmedTender || !multipleTenders) return false;
	const keyed = Math.max(0, toInteger(keyedMinor));
	if (keyed <= 0) return false;
	return keyed < totals.remainingMinor;
};

export default resolvePayTotals;
