/**
 * The primary action's label ON A PHONE — and the seam it is waiting on.
 *
 * THE PROBLEM, stated once so nobody re-derives it.
 *
 * The desktop band draws the number and the verb as two things: a 60 px figure
 * in its own lane with `PAGAR` on the button beside it (`Main.dc.html`). The
 * phone has no 134 px lane to spend, so `MovilVenta.dc.html` inlines the money
 * INTO the button — `COBRAR $1,129.00` — and the totals card above carries the
 * figure at 30 px. Same action, same money, two different labels, decided by
 * viewport.
 *
 * `bandState.ts` cannot express that today. `BandAction` has exactly one
 * `labelKey`, and `resolveBandState` is deliberately viewport-blind — it is a
 * pure money module and handing it a `viewport` discriminant would make layout
 * a term in the arithmetic. So the phone label has to come from somewhere else,
 * and this module is that somewhere.
 *
 * WHAT THE MODULE ALREADY PROVES. `return.refund` returns
 * `{ labelKey: "REFUND {0}", labelParams: [amount] }`, and `ActionBand.vue`
 * formats a numeric param through the same `formatCurrency` as the figure
 * above. The amount-in-the-label PATTERN is therefore already supported and
 * already shipping; what is missing is a SECOND label slot so one action can
 * hold both renderings. The reported change is small:
 *
 *     export interface BandAction {
 *       id: BandActionId;
 *       labelKey: string;
 *       labelParams?: (string | number)[];
 *     + // The compact layout has no 60px lane, so the action carries the
 *     + // number. Absent means "the phone says what the desk says".
 *     + compactLabelKey?: string;
 *     + compactLabelParams?: (string | number)[];
 *     }
 *
 * …with `case "sale"` adding
 * `compactLabelKey: "CHARGE {0}", compactLabelParams: [total]`.
 * `composables/pos/shell/**` is T3's, so that is REPORTED, not made here.
 *
 * This module reads that field the moment it exists and falls back until then,
 * so the seam lands as a deletion rather than a rewrite.
 */

import type { BandActionId, BandState } from "../../../../composables/pos/shell/bandState";

/**
 * Compact label keys, per action.
 *
 * Only the actions the phone's SALE screen can reach are listed. Everything
 * else falls back to the band's own `labelKey`, which is already translated —
 * inventing a compact wording for an action no phone surface draws would put
 * untranslated strings in `es.csv` to cover a screen that does not exist.
 *
 * `"Charge"` rather than a new `"CHARGE {0}"` row: `es.csv` already carries
 * `Charge,Cobrar`, the amount is appended by the component (which owns the
 * tenant's currency and precision anyway), and uppercase is a CSS decision
 * — §7 forbids an agent writing to `es.csv`, six writers on one file.
 */
const COMPACT_LABEL_KEYS: Partial<Record<BandActionId, string>> = {
	"sale.pay": "Charge",
};

export interface CompactBandAction {
	id: BandActionId;
	/** Translation key; the component calls `__()` on it. */
	labelKey: string;
	/**
	 * Money the label names, raw — the component formats it, for the same
	 * reason `bandState.ts` never formats: a pure module that formats has to
	 * know the tenant's currency.
	 *
	 * `null` means the label names no money, and the component appends nothing.
	 */
	amount: number | null;
	/**
	 * Whether `amount` substitutes INTO `labelKey` (`"CHARGE {0}"`) or is
	 * appended after it (`"Charge"` + ` $1,129.00`).
	 *
	 * Both forms have to work at once: the appended form is what ships today
	 * against `es.csv`'s existing `Charge,Cobrar` row, and the interpolated one
	 * is what the reported `bandState.ts` change produces. Detecting the
	 * placeholder rather than branching on which source won means the component
	 * needs no edit on the day the seam closes.
	 */
	interpolates: boolean;
	/** Whether the button may be pressed. Straight from the band state. */
	enabled: boolean;
}

/** The shape `BandAction` gains once the reported change above lands. */
type BandActionWithCompact = BandState["primaryAction"] & {
	compactLabelKey?: string;
};

/**
 * What the phone's primary button says.
 *
 * Reads `compactLabelKey` first so this module needs no edit on the day
 * `bandState.ts` grows the field; falls back to the table above, and finally to
 * the desktop label. A phone that showed a blank button because a new action id
 * had no compact wording would be worse than one that said `PAGAR`.
 */
export const compactBandAction = (state: BandState): CompactBandAction => {
	const action = state.primaryAction as BandActionWithCompact;
	const compact = action.compactLabelKey || COMPACT_LABEL_KEYS[action.id];
	const labelKey = compact || action.labelKey;

	return {
		id: action.id,
		labelKey,
		// The band's `value` IS the money this action commits to — that is the
		// "one number, one action" invariant read from the action's side. Taking
		// it from anywhere else is how a button and the total above it come to
		// disagree on the same screen. No compact label means the phone says
		// what the desk says, and the desk does not put money on the button.
		amount: compact ? state.value : null,
		interpolates: /\{0\}/.test(labelKey),
		enabled: state.primaryEnabled,
	};
};

export default compactBandAction;
