/**
 * The warranty window, and whether this return needs a supervisor
 * (`Devolucion.dc.html`: *"Dentro de los 30 días de garantía de accesorios.
 * No necesita autorización."*).
 *
 * The window is NOT invented here and no day count is hard-coded. The server
 * already stamps `posa_return_valid_upto` on the invoice and already decides
 * `posa_return_expired` against the profile's enforcement flag
 * (`api/invoice_processing/returns.py`). This module reads those two and says
 * what they mean for the person at the counter — how many days are left, and
 * whether the return can be taken on the cashier's own authority.
 *
 * Reading a date the server sent is safe; recomputing the RULE would not be.
 * A client that decided expiry for itself would disagree with the server the
 * moment a profile changed its window or a register's clock drifted, and the
 * disagreement would surface as a return the screen accepted and the server
 * refused.
 */

/** Just the two fields the verdict reads, from either returns endpoint. */
export interface ReturnValidityFields {
	posa_return_valid_upto?: string | null;
	posa_return_expired?: number | boolean | null;
}

export type WarrantyVerdict = "within" | "expired" | "unrecorded";

export interface WarrantyWindow {
	verdict: WarrantyVerdict;
	/**
	 * Whole days from today to the last valid day, inclusive of today.
	 * `null` when no window is recorded — not 0, which would read as
	 * "expires today" and is the opposite of what an absent window means.
	 */
	daysLeft: number | null;
	validUpto: string | null;
	/**
	 * An expired sale is still returnable — nothing in the app blocks it — but
	 * it stops being the cashier's call. §5.4: void, discount, price override
	 * and the rest "carry actor, reason and approval", and a return past its
	 * warranty is the same class of exception.
	 */
	requiresAuthorisation: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of a `YYYY-MM-DD` string, or null if it is not one. */
const parseDay = (value: string | null | undefined): number | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
	if (!match) return null;
	const [, year, month, day] = match;
	const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * `today` is injected rather than read from the clock so the verdict is a
 * function of its arguments — the same reason `bandState.ts` takes its
 * numbers instead of reaching into a store. Callers pass
 * `frappe.datetime.nowdate()`, which is the date the server's day rolls on.
 */
export const resolveWarrantyWindow = (
	invoice: ReturnValidityFields | null | undefined,
	today: string,
): WarrantyWindow => {
	const validUpto = invoice?.posa_return_valid_upto || null;
	const expiredFlag = Boolean(Number(invoice?.posa_return_expired ?? 0));
	const upto = parseDay(validUpto);
	const now = parseDay(today);

	if (!upto) {
		// No window recorded: either the profile does not enforce one or the
		// invoice predates the field. Neither is an exception, so neither
		// summons a supervisor.
		return { verdict: "unrecorded", daysLeft: null, validUpto: null, requiresAuthorisation: false };
	}

	const daysLeft = now === null ? null : Math.round((upto - now) / DAY_MS);

	// The SERVER's flag decides expiry, not the arithmetic above: it is the
	// half that knows whether this profile enforces the window at all. The day
	// count is for the sentence on screen.
	if (expiredFlag) {
		return { verdict: "expired", daysLeft, validUpto, requiresAuthorisation: true };
	}

	return { verdict: "within", daysLeft, validUpto, requiresAuthorisation: false };
};

/** English source strings; the view wraps them in `__()` and fills `{0}`. */
export const WARRANTY_MESSAGES: Readonly<Record<WarrantyVerdict, string>> = {
	within: "Within the return window — {0} days left. No authorisation needed.",
	expired: "The return window closed on {0}. A supervisor has to authorise this one.",
	unrecorded: "This sale has no return window recorded. No authorisation needed.",
};
