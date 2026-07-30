/**
 * Single choke point for "the print window never opened".
 *
 * A blocked popup is the one print failure the operator cannot see: the
 * browser swallows `window.open` and returns null, the code path returns
 * normally, and the receipt simply never exists. Before this helper only
 * three of the eight print `window.open` sites reacted at all, and the
 * offline / new-tab / Payment-Entry paths returned silently — so a till
 * with popups blocked printed nothing all day while telemetry showed a
 * clean sheet.
 *
 * Routing every null result through here buys two things:
 *   - the cashier gets a toast naming the actual cause (pop-up blocker),
 *     instead of re-tapping print and assuming the printer is broken;
 *   - `warn:print_popup_blocked` lands for every path, which is what makes
 *     `attempted = qz ok + browser fallback + popup blocked` add up to a
 *     real print success rate on the fleet panel.
 *
 * The toast carries a fixed `key` so a burst of blocked prints merges into
 * one snackbar entry rather than queueing N identical warnings.
 */
import { useToastStore } from "../stores/toastStore";
import { track } from "./telemetry";

// Bare `__` is a Frappe desk global that does not exist under vitest;
// guard it (repo convention for helpers outside .vue files).
const translateMessage = (value: string) =>
	typeof window !== "undefined" && window.__ ? window.__(value) : value;

export const PRINT_POPUP_BLOCKED_EVENT = "warn:print_popup_blocked";

/**
 * Count a blocked print window without saying anything to the operator.
 *
 * For the paths that RECOVER — a blocked preview tab that falls through to
 * browser print, say — where the caller already explains the degradation in
 * its own words. The block still has to be counted or the success rate lies.
 *
 * @param context - Which print path was blocked; becomes the telemetry
 *   `context` dimension, so keep the values stable and coarse
 *   (`payment-print`, `reprint-last`, `payment-entry-print`, …).
 * @param meta - Extra telemetry dimensions. Must stay non-PII — no
 *   customer, invoice or payment identifiers.
 */
export function trackPrintPopupBlocked(
	context: string,
	meta: Record<string, unknown> = {},
): void {
	console.warn(`Print window blocked by the browser (${context})`);
	try {
		track(PRINT_POPUP_BLOCKED_EVENT, 1, { context, ...meta });
	} catch {
		// telemetry dispatch must never bubble
	}
}

/**
 * Report a blocked print window that ends the print attempt — telemetry
 * plus a toast, because nothing else is going to tell the cashier.
 */
export function reportPrintPopupBlocked(
	context: string,
	meta: Record<string, unknown> = {},
): void {
	trackPrintPopupBlocked(context, meta);
	try {
		useToastStore().show({
			key: "print-popup-blocked",
			title: translateMessage("The print window was blocked"),
			detail: translateMessage(
				"Allow pop-ups for this site, then reprint the ticket from the menu.",
			),
			color: "warning",
			timeout: 10000,
		});
	} catch {
		// Toast store may not be ready (boot, or outside an app context);
		// the telemetry row above still records the miss.
	}
}
