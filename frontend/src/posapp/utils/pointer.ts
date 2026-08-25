/**
 * Whether this register is driven by touch.
 *
 * One rule, shared: a mount-time autofocus is a courtesy on a desk with a
 * keyboard — the cashier can type at once — and a punishment on a tablet,
 * where focusing a text field SUMMONS the on-screen keyboard over half the
 * register before anyone asked to type (owner tablet, 08-24). Every surface
 * that focuses its search on mount asks this first. A function, not a
 * module-level constant, so a spec can flip `matchMedia` per test.
 */
export const coarsePointer = (): boolean =>
	typeof window !== "undefined" &&
	window.matchMedia?.("(pointer: coarse)")?.matches === true;
