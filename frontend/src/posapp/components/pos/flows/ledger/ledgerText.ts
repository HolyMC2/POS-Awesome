/**
 * `__()` for the ledger's four children, written once.
 *
 * Bare `__` is a Frappe desk global that does not exist under vitest, and
 * `types/frappe.d.ts` types `window.__` as a one-argument function even though
 * the real one takes an interpolation array — so every component that wants
 * `__("{0} tickets", [n])` has been re-writing the same eight-line guard
 * (`MovilCorte.vue`, `CashMovementForm.vue`, `OfflineInvoices.vue`,
 * `NavbarInfoGadgets.vue`). Four more copies inside one directory would be
 * four places for the fallback to drift.
 *
 * The fallback interpolates rather than returning the raw key: a spec that
 * mounts a child without stubbing the global should read "3 refunds", not
 * "{0} refunds", or it is asserting on the harness instead of the component.
 */

type Interpolation = ReadonlyArray<string | number>;

export const translate = (text: string, args?: Interpolation): string => {
	const global = typeof window === "undefined" ? undefined : window.__;
	if (typeof global === "function") {
		return (global as (value: string, params?: Interpolation) => string)(text, args);
	}
	if (!args || !args.length) return text;
	return text.replace(/\{(\d+)\}/g, (match, index: string) => {
		const value = args[Number(index)];
		return value === undefined || value === null ? match : String(value);
	});
};

export default translate;
