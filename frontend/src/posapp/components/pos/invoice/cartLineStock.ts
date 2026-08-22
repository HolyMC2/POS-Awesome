/**
 * What the `Existencia` column draws for an ordinary cart line.
 *
 * The artboard (`Main.dc.html`, nodes 32–92) puts `quedan N` on EVERY line, not
 * only on combos — a cashier learns stock without leaving the sale. The combo
 * work already ships that figure, so this generalises a pattern rather than
 * inventing one, and it deliberately borrows
 * `comboAvailabilityDisplay.describeAvailability`'s vocabulary: the same
 * `show` / `value` / `isLow` / `reason` shape, so a reader who has met one has
 * met both.
 *
 * The rule that matters is the one about absence. There are three ways for this
 * to have no number and only one of them is "the shelves are empty":
 *
 *   1. NOT STOCKED. A service, labour, or any `is_stock_item = 0` line has no
 *      shelf to be counted on. `Instalación` is the standing example — the
 *      combo availability rule excludes exactly these, for exactly this reason.
 *   2. UNKNOWN. An offline line, or a draft resumed from before the field
 *      existed. The register genuinely does not know.
 *   3. NOT A NUMBER. A hand-edited draft or a bad payload.
 *
 * None of them renders `0`, because **0 is a claim**: it says the shop has none
 * of this, and a cashier who reads it will tell a customer so. Absence renders
 * nothing and lets them look. A real 0 — a line whose stock genuinely reads
 * zero — DOES render, in the low tint, because that is precisely the moment the
 * figure is worth having.
 */

export interface CartLineStockDisplay {
	/** False means: draw no figure at all. Never draw `value` when false. */
	show: boolean;
	/** Finite, non-negative number when `show`; null otherwise. */
	value: number | null;
	/** At or under the register's own low-stock threshold. */
	isLow: boolean;
	/** Why the figure is or is not drawn — asserted on directly by tests. */
	reason: "bounded" | "not-stocked" | "unknown";
}

const HIDDEN = (reason: "not-stocked" | "unknown"): CartLineStockDisplay => ({
	show: false,
	value: null,
	isLow: false,
	reason,
});

const toFiniteOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const n = typeof value === "number" ? value : parseFloat(String(value));
	return Number.isFinite(n) ? n : null;
};

/**
 * Mirrors `parseBooleanSetting`'s tolerance without importing it: Frappe Check
 * fields arrive as 1/0, "1"/"0" or true/false depending on the path, and a
 * strict truthiness test reads the string "0" as stocked.
 */
const isStocked = (value: unknown): boolean => {
	if (value === undefined || value === null) return true; // unset ⇒ assume stocked
	if (typeof value === "string") return value.trim() !== "" && value.trim() !== "0";
	return Boolean(value);
};

export interface CartLineStockSource {
	is_stock_item?: unknown;
	/** Available in the item's STOCK uom, as the read model supplied it. */
	_base_actual_qty?: unknown;
	/** Available in the line's CURRENT uom. */
	actual_qty?: unknown;
	conversion_factor?: unknown;
}

/**
 * Decide what the column draws for one line.
 *
 * `_base_actual_qty / conversion_factor` is preferred over `actual_qty` because
 * that is the figure `useItemAddition` already clamps against when it refuses a
 * quantity — so the number the cashier reads and the number the register
 * enforces are the same one. A line sold by the box must not be told it has
 * twelve when twelve is the count of singles.
 *
 * `lowStockThreshold` is the register's own `posa_low_stock_alert_threshold`
 * (Int, default 10) — the same setting the dashboard alerts on and the combo
 * chip tints by. A threshold of 0 or absent disables the tint rather than
 * making every line low, since 0 means "never warn", not "always warn".
 */
export const describeLineStock = (
	item: CartLineStockSource | null | undefined,
	options: { lowStockThreshold?: unknown } = {},
): CartLineStockDisplay => {
	if (!item) return HIDDEN("unknown");
	if (!isStocked(item.is_stock_item)) return HIDDEN("not-stocked");

	const base = toFiniteOrNull(item._base_actual_qty);
	const factor = toFiniteOrNull(item.conversion_factor);
	const direct = toFiniteOrNull(item.actual_qty);

	// Order matters: prefer the enforced figure, fall back to the line's own,
	// and only then give up. Asking `actual_qty` first would quietly disagree
	// with the stock gate on any multi-UOM line.
	const available =
		base !== null && factor !== null && factor > 0 ? base / factor : direct;

	if (available === null) return HIDDEN("unknown");

	const threshold = Math.max(0, Math.floor(toFiniteOrNull(options.lowStockThreshold) ?? 0));
	const value = Math.max(0, available);

	return {
		show: true,
		value,
		isLow: threshold > 0 && value <= threshold,
		reason: "bounded",
	};
};

/**
 * The line's identity subtitle — `IPN001545 · Accesorios`.
 *
 * The artboard draws a two-level breadcrumb (`Accesorios › Fundas y Carcasas`),
 * but the payload carries only the leaf `item_group`; the ancestry is not in
 * the read model. So this renders what exists and degrades rather than
 * inventing a parent, which on a mis-scan is the one thing that must not
 * happen: the subtitle's entire job is confirming WHICH variant was scanned,
 * and a fabricated category would confirm the wrong thing confidently.
 */
export const describeLineIdentity = (item: {
	item_code?: unknown;
	item_group?: unknown;
}): string => {
	const code = String(item?.item_code ?? "").trim();
	const group = String(item?.item_group ?? "").trim();
	if (code && group) return `${code} · ${group}`;
	return code || group || "";
};
