/**
 * What the last scan RESOLVED to (Riel y Cajón §17.7, artboard node 21:
 * `último: IPN001902`).
 *
 * The artboard prints this beside the scan field, and its job is post-hoc
 * confirmation: on a counter with a fast gun, the row appearing somewhere in a
 * list is not proof that the RIGHT row appeared. The code the register
 * actually resolved is. It is the difference between catching a double-scan
 * now and finding it at the corte.
 *
 * Two properties the whole thing rests on:
 *
 * 1. **Resolved, never typed.** Only a scan that produced a cart line records
 *    here. A miss leaves the previous value alone rather than echoing the
 *    string that failed — echoing a failure as if it succeeded would teach a
 *    cashier to trust the signal, which is worse than having no signal.
 * 2. **It outlives the row.** Confirmation that arrives and vanishes has not
 *    confirmed anything, so this is not cleared when the cart changes.
 *
 * Module-scoped rather than per-instance on purpose: `ItemHeader` is TELEPORTED
 * to the sale screen while `useScanProcessor` lives inside `ItemsSelector`, and
 * the wedge itself is attached to the document. A ref that belonged to one
 * mount would be the third thing in this area to break the moment the DOM
 * moved — see `useScannerInput`'s document singleton for the first two.
 */
import { readonly, ref } from "vue";

const lastResolved = ref("");

/** Record a scan that produced a cart line. Called only from the success path. */
export const recordResolvedScan = (code: unknown): void => {
	const text = String(code ?? "").trim();
	if (!text) {
		return; // nothing resolved; leave the previous confirmation standing
	}
	lastResolved.value = text;
};

/** The last resolved code, or "" if nothing has resolved this session. */
export const lastResolvedScan = readonly(lastResolved);

/** Test seam. Not called by the app — a register never un-scans an item. */
export const resetLastScanEcho = (): void => {
	lastResolved.value = "";
};
