/**
 * Which payment row the Cobro surface is working on (build plan §14.2).
 *
 * ONE rule, in one module, because TWO columns of the surface draw it: the pad
 * commits its buffer to this row, and the method list lights it. Two copies of
 * the rule is how the highlighted method stops being the one that receives the
 * money — a defect nobody sees until a split payment lands on the wrong tender.
 *
 * The rule reads the INVOICE, never a second store: the row already carrying
 * money wins, then the row the register marked default, then whatever is first.
 * Pure — no Vue, no store, no `__()`.
 */

export interface TenderRow {
	mode_of_payment?: string;
	amount?: unknown;
	default?: unknown;
}

export const resolveTenderTarget = <T extends TenderRow>(
	rows: readonly (T | null | undefined)[] | null | undefined,
): T | null => {
	const present = (Array.isArray(rows) ? rows : []).filter(Boolean) as T[];
	const carrying = present.find((row) => Number(row.amount) !== 0);
	if (carrying) return carrying;
	return present.find((row) => Number(row.default) === 1) ?? present[0] ?? null;
};

export default resolveTenderTarget;
