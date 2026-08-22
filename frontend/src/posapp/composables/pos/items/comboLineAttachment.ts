/**
 * Attach a bundle's priced components to the cart line that sells it
 * (roadmap §17.6, docs/POS-RIEL-Y-CAJON-BUILD.md).
 *
 * Wave 1 built the combo arithmetic, the return semantics and the row
 * component; W25-A wired `ComboCartLine` into the cart and marked a line as a
 * combo by the presence of `posa_combo_components`. Nothing set that field, so
 * `isComboLine()` was false for every line in the product. This module is that
 * wire, and it is deliberately the smallest thing that closes it: it adds DATA
 * to a line that already exists.
 *
 * FOUR THINGS IT MUST NOT DO, each of them money:
 *
 * 1. **It must not create N lines.** The customer bought one combo at the
 *    combo price. Splitting it into component lines at allocated shares would
 *    reprice on the next edit and break `comboReturns.ts`, which allocates the
 *    refund from the parent. The substrate already models this correctly —
 *    `expandBundle` pushes components into `packed_items`, not into the cart —
 *    so this module only annotates the parent.
 * 2. **It must not price anything.** The combo's rate is the bundle item's own
 *    `Item Price`, already on the line before we arrive. `listPrice` and
 *    `saving` are DERIVED for display by `priceCombo()`; recomputing a rate
 *    from components would quietly overwrite what the shop actually charges.
 * 3. **It must not answer availability ITSELF.** The rule was decided on
 *    2026-08-22 (min over stock items; short stock obeys the register's
 *    existing `posa_block_sale_beyond_available_qty`) and lives in
 *    `comboAvailability.ts`. This module asks through the choke point and
 *    applies the answer; it does not compute one. A surface that decided for
 *    itself would oversell, and §11 treats that as a zero-tolerance incident.
 * 4. **It must not decrement stock.** `packed_item.py` already builds the
 *    packing list for a Product Bundle's `new_item_code`.
 */

import {
	ceilingFromResolution,
	resolveComboAvailability,
	type ComboAvailabilityComponent,
	type ComboAvailabilityContext,
} from "../combos/comboAvailability";

/**
 * Field names are W25-A's, which owns the reader (`ItemsTable.vue`). They are
 * named here rather than inlined so the two sides share one spelling — a
 * silent divergence renders the combo row for nobody, and the failure looks
 * like "combos don't work" rather than like a typo.
 */
export const COMBO_COMPONENTS_FIELD = "posa_combo_components" as const;
export const COMBO_BROKEN_FIELD = "posa_combo_broken" as const;

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/**
 * Normalise one component from the read model.
 *
 * `combos.get_combo_components` already returns the right shape; this exists
 * because the cart is also fed from an offline cache and a resumed draft, and
 * a component that arrives with a string `qty` would make `priceCombo()`
 * compute a list price by string concatenation.
 */
export const normalizeComboComponent = (raw: any): ComboAvailabilityComponent => ({
	item_code: String(raw?.item_code ?? ""),
	item_name: String(raw?.item_name ?? raw?.item_code ?? ""),
	qty: toNumber(raw?.qty) || 1,
	rate: toNumber(raw?.rate),
	uom: raw?.uom ?? null,
	actual_qty: toNumber(raw?.actual_qty),
	// Carried through, not dropped: this is the flag that keeps `Instalación`
	// from reporting the headline combo permanently out of stock. Preserved as
	// `undefined` when absent rather than coerced to 0 — `comboAvailability`
	// treats "unknown" as constraining, and coercing would silently turn every
	// unknown component into a service that never caps.
	is_stock_item: raw?.is_stock_item ?? undefined,
});

/**
 * Is this component list worth marking a line as a combo?
 *
 * A bundle with no components is a data error, not a combo, and marking it
 * would render a `COMBO · 0` badge over an ordinary item. A single-component
 * bundle IS legitimate (a "combo" of one installation service exists in the
 * repair giro), so the floor is one, not two.
 */
export const isAttachableComponentList = (components: unknown): boolean =>
	Array.isArray(components) && components.some((c) => String(c?.item_code ?? "").trim() !== "");

/**
 * Annotate a cart line as a combo. Returns whether it did.
 *
 * Mutates rather than returning a copy on purpose: the caller holds the
 * REACTIVE store line (`expandBundle` receives it after
 * `invoiceStore.addItems`), and replacing the object would detach it from the
 * cart the operator is looking at.
 */
export const attachComboComponents = (
	line: any,
	rawComponents: unknown,
	context: ComboAvailabilityContext = {},
): boolean => {
	if (!line || !isAttachableComponentList(rawComponents)) {
		return false;
	}

	const components = (rawComponents as any[])
		.filter((c) => String(c?.item_code ?? "").trim() !== "")
		.map(normalizeComboComponent);

	line[COMBO_COMPONENTS_FIELD] = components;
	// A freshly added combo is whole by definition. Set explicitly rather than
	// left undefined so a line RESUMED from a draft, where a partial return may
	// have broken it, cannot inherit staleness from a re-add.
	line[COMBO_BROKEN_FIELD] = 0;

	// The availability gate, now that the rule is decided.
	//
	// Two separate things happen here and they are not the same thing:
	//
	//   `_combo_available` / `_combo_limited_by` are DISPLAY. Underscore
	//   prefix is this repo's marker for a client-only field (`_base_actual_qty`,
	//   `_offer_constraints`) — they are not in `custom_field.json` and must
	//   not be, because a number computed against this register's warehouse at
	//   this instant has no business being persisted onto a document.
	//
	//   `max_qty` is POLICY, and only when the register asked for it.
	//   `ceilingFromResolution` returns null unless
	//   `posa_block_sale_beyond_available_qty` is on, so a shop that chose
	//   warn-and-sell gets no ceiling and keeps selling — which is the
	//   behaviour it already has for every plain line.
	//
	// The choke point is asked ONCE and the answer used twice. Two calls would
	// double its traffic count and read, in a test, as a surface that started
	// asking the availability question on its own.
	const resolution = resolveComboAvailability(components, context);
	line._combo_available = resolution.resolved ? resolution.value.available : null;
	line._combo_limited_by = resolution.resolved ? resolution.value.limitedBy : null;

	const ceiling = ceilingFromResolution(resolution, context);
	if (ceiling !== null) {
		line.max_qty = ceiling;
	}

	return true;
};
