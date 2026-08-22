import { readonly, shallowRef } from "vue";

import {
	defaultTenderMode,
	resolveArmedTender,
	type TenderChip,
	type TenderContext,
	type TenderSelection,
} from "./tenderChips";

/**
 * Where the pre-armed tender lives between the chip strip and the payment
 * screen (Riel y Cajón §11 item E).
 *
 * ⚠ WHY A MODULE AND NOT A STORE. This belongs in `uiStore` beside the rest of
 * the register's transient UI state. `InvoiceSummary` hangs off `Invoice.vue`,
 * the payment screen is mounted from `Pos.vue`, and neither store nor either
 * component is inside this task's write scope — so the seam is a module both
 * ends can import, which keeps the consuming change to one line. The right fix
 * is a `uiStore` field with the same three functions; the exact change is in
 * this task's report and nothing else has to move when it lands.
 *
 * The holder is deliberately thin. It stores WHAT the cashier picked, never
 * an amount, an account or a payment row — the arm decides which method the
 * payment screen opens on and nothing else. Every peso is still recorded by
 * the payment screen exactly as before.
 */

/** Raw selection: `undefined` untouched · `null` mixed · string chosen. */
const selection = shallowRef<TenderSelection>(undefined);

/**
 * The armed mode as last validated by the chip strip, or null for "unarmed"
 * — which is today's behaviour, and what MIXED means.
 *
 * Read side is deliberately a plain value rather than a ref accessor so a
 * caller cannot hold a stale reference across a sale.
 */
const armed = shallowRef<string | null>(null);

/** For the chip strip: which chip renders lit. */
export const tenderSelection = readonly(selection);

/**
 * For the payment screen. Never throws, never mutates: a caller that reads it
 * twice gets the same answer, and a value that has gone stale reads null
 * because `armTender` re-validates on every write and `resetTenderSelection`
 * runs when the sale ends.
 */
export const peekArmedTender = (): string | null => armed.value;

/**
 * Record the cashier's pick and re-derive what is actually armed.
 *
 * The guard runs HERE rather than at the read side, so an invalid pick is
 * never published in the first place. The return value is what the strip
 * should render as lit — which is not always what was passed in, and that
 * difference is the point: a tender that has gone away lights nothing.
 */
export const armTender = (
	next: TenderSelection,
	chips: readonly TenderChip[],
	context: TenderContext,
): string | null => {
	selection.value = next;
	armed.value = resolveArmedTender(next, chips, context);
	return armed.value;
};

/**
 * Re-run the guard against a changed world — the profile reloaded, the cart
 * emptied, the sale turned into a return — without the cashier touching
 * anything. Same guard, so a pre-selection cannot outlive its context.
 */
export const revalidateArmedTender = (
	chips: readonly TenderChip[],
	context: TenderContext,
): string | null => {
	armed.value = resolveArmedTender(selection.value, chips, context);
	return armed.value;
};

/**
 * The sale ended. Back to untouched, so the next customer's ticket opens on
 * the register's own default rather than on the previous customer's tender —
 * a leak nobody would see until it was on a submitted invoice.
 */
export const resetTenderSelection = (): void => {
	selection.value = undefined;
	armed.value = null;
};

/** Re-exported so a consumer needs one import, not two. */
export { defaultTenderMode };
