/**
 * What the register may DO about a stale shift (critique E4).
 *
 * It used to seize: boot with an enforced stale shift called
 * `get_closing_data()` outright — a server round-trip that submits the
 * shift's printed drafts as a side effect, then a fullscreen corte fronted
 * over the register before the operator touched anything. Automation should
 * insist, not seize: the operator may need to look at yesterday's drafts,
 * check a ticket, or fetch a supervisor BEFORE counting the drawer, and the
 * server already blocks sales into a stale shift, so nothing is protected
 * by taking the screen hostage.
 *
 * This module is the contract, in the bandState tradition: pure, and shaped
 * so the old behavior is INEXPRESSIBLE — there is no field that means
 * "open the corte yourself". The strongest thing a stale shift can produce
 * is `insist: true`, which the shell renders as a sticky banner carrying a
 * «Hacer corte» button. The OPERATOR's tap opens the corte.
 *
 * Labels come out as translation keys and the caller applies `__()` — the
 * same contract registerStatusLine.ts and hardwareReadiness.ts keep.
 */

export interface StaleShiftNotice {
	/** Toast severity: enforced closure blocks sales, so it escalates. */
	tone: "warning" | "error";
	titleKey: string;
	messageKey: string;
	/**
	 * Show the persistent in-shell banner with the corte action. True only
	 * when the profile enforces closure — a shop that allows carrying a
	 * shift across midnight gets the toast and nothing more.
	 */
	insist: boolean;
}

export function resolveStaleShiftNotice(
	staleShift: boolean,
	enforced: boolean,
): StaleShiftNotice | null {
	if (!staleShift) return null;
	if (enforced) {
		return {
			tone: "error",
			titleKey: "Shift from a previous day is still open",
			messageKey:
				"Close it now to start today's shift. Sales are blocked until it is closed.",
			insist: true,
		};
	}
	return {
		tone: "warning",
		titleKey: "Shift from a previous day is still open",
		messageKey:
			"Close it and open a new shift to keep the day's cash reconciliation clean.",
		insist: false,
	};
}
