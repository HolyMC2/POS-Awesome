/**
 * Combo availability — DECIDED 2026-08-22. Roadmap §17.6.
 *
 * §17.6 left this open: "Availability shown as min(components) is the design's
 * claim and needs a back-end decision before build." The owner decided it:
 *
 *   1. min() over STOCK ITEMS ONLY. Services and labour never cap a combo.
 *   2. On short stock, behave exactly as a plain line does under the POS
 *      Profile's existing `posa_block_sale_beyond_available_qty` — no
 *      combo-specific toggle, no hardcoded policy.
 *
 * The reasoning below is kept rather than deleted, because it is WHY the rule
 * is what it is, and the next person to touch this will want the argument and
 * not just the conclusion.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A ONE-LINER
 *
 * The obvious rule is availability = min over components of
 * floor(free_qty / qty_per_combo). Three things break it:
 *
 * 1. SERVICE COMPONENTS HAVE NO STOCK. The reference combo in the design is
 *    "Case negro + Mica Cristal + Instalación" — and Instalación is labour
 *    with `actual_qty: 0`. A naive min() over every component reports the
 *    headline combo of the whole feature permanently unavailable.
 *    → RESOLVED: excluded. And this is not a combo special case — the plain
 *    cart already does exactly this. `update_qty_limits` in
 *    `invoice_utils/stock.ts` opens with "Clamp only KNOWN stock items" and
 *    sets `max_qty = undefined` for anything whose `is_stock_item` is falsy.
 *    A combo that ignored labour would be the odd one out, not the other way
 *    round. `combos.py` already carries `is_stock_item` per component for
 *    precisely this, so the exclusion costs no round trip.
 *
 * 2. STRICT BLOCKS SALES THE SHOP CAN ACTUALLY MAKE. A counter out of the
 *    black case but holding the same case in blue will sell the combo and
 *    swap the component. A POS that refuses money the shop can earn gets
 *    worked around — the cashier rings the parts up separately, the combo's
 *    reporting goes dark, and the discount gets applied by hand.
 *
 * 3. LOOSE OVERSELLS, AND OVERSELL IS NOT A ROUNDING ERROR. §11 treats it as
 *    a zero-tolerance incident, and negative stock corrupts valuation for
 *    every later sale of the same item.
 *
 *    → 2 and 3 RESOLVED TOGETHER, and deliberately not by us: this is the
 *    same tension every plain line already faces, and the shop already
 *    answered it per register with `posa_block_sale_beyond_available_qty`
 *    (Check, default 1). A combo obeys the register's existing answer. See
 *    `comboQtyCeiling()`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * STILL OPEN, AND SMALLER THAN IT LOOKS
 *
 * Sub-questions §17.6 raised that the decision did NOT settle: whether the
 * figure counts `actual_qty` or free qty net of other open carts; whether
 * batch and serial components constrain by batch under FEFO (§4.2); and
 * whether the answer is per-warehouse or company-wide. All three change the
 * NUMBER, none changes the SHAPE — they are answered by what the caller puts
 * in `actual_qty` / `stockByItem`, which is the read model's business, not
 * this module's. Today `combos.py` supplies `actual_qty` for the register's
 * warehouse, so the answer is per-warehouse and gross.
 *
 * THE SERVER REMAINS THE AUTHORITY. `_validate_stock_on_invoice` refuses at
 * submit regardless of what this computed. This rule exists so the cashier
 * learns before the customer pays, not so the client can permit something the
 * server will reject.
 */

import type { ComboComponent } from "./comboPricing";

/**
 * A component as the combos read model actually delivers it.
 *
 * `ComboComponent` (comboPricing.ts) models what PRICING needs and stops
 * there. `combos.py` also sends `is_stock_item`, and availability is the only
 * thing that reads it, so the widening lives here rather than pushing a field
 * into the pricing contract that pricing has no use for.
 */
export interface ComboAvailabilityComponent extends ComboComponent {
	/** From `combos.py`: 0 for services and labour, 1 for stock items. */
	is_stock_item?: number | boolean | null;
}

export interface ComboAvailabilityContext {
	/** Register warehouse the question is being asked about. */
	warehouse?: string | null;
	/** Component stock, keyed by item_code, as the read model supplied it. */
	stockByItem?: Record<string, number>;
	/** item_code -> is this a stock item at all (services are not). */
	stockItemFlags?: Record<string, boolean>;
	/**
	 * The register's POS Profile, read ONLY for
	 * `posa_block_sale_beyond_available_qty`. Passed whole rather than as a
	 * boolean so the call site does not have to know which field expresses the
	 * policy — that is this module's business, and it is the field that plain
	 * lines already obey.
	 */
	posProfile?: Record<string, unknown> | null;
	/**
	 * Escape hatch matching `invoice_utils/stock.ts`, which accepts
	 * `context.blockSaleBeyondAvailableQty` beside the profile field. Order and
	 * Quotation flows use it to disable blocking for document types that are
	 * not selling stock yet.
	 */
	blockSaleBeyondAvailableQty?: unknown;
}

export interface ComboAvailability {
	/**
	 * Combos sellable right now.
	 *
	 * `Number.POSITIVE_INFINITY` when nothing constrains — an all-labour combo
	 * is limited by the shop's time, not its shelves. Infinity rather than a
	 * large sentinel on purpose: a surface that renders it without checking
	 * shows "Infinity", which is visibly wrong and gets fixed, where 999999
	 * looks like a real answer and does not.
	 */
	available: number;
	/** Component that set the limit, for the operator-facing explanation. */
	limitedBy: string | null;
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

const truthy = (value: unknown): boolean => {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") {
		return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
	}
	if (typeof value === "number") return value === 1;
	return Boolean(value);
};

/**
 * Does this component constrain the combo at all?
 *
 * Prefers the component's own flag (`combos.py` always sends it), falls back
 * to the context map, and DEFAULTS TO TRUE when neither knows.
 *
 * The default is asymmetric on purpose. Wrongly treating a service as stock
 * reports a smaller number than reality — the cashier sees "quedan 0" on
 * something sellable, notices, and complains. Wrongly treating stock as a
 * service reports a larger number, oversells, and nobody notices until the
 * count is negative. §11 makes the second failure the one to design against.
 */
const constrains = (
	component: ComboAvailabilityComponent,
	context: ComboAvailabilityContext,
): boolean => {
	if (component?.is_stock_item !== undefined && component?.is_stock_item !== null) {
		return truthy(component.is_stock_item);
	}
	const flag = context?.stockItemFlags?.[String(component?.item_code ?? "")];
	if (flag !== undefined) return Boolean(flag);
	return true;
};

/**
 * Free stock for one component.
 *
 * `stockByItem` wins when it carries the key: it is the caller's fresher read,
 * and a caller that bothered to supply it means it to be used. Otherwise the
 * component's own `actual_qty`, which is what `combos.py` attached.
 */
const stockFor = (
	component: ComboAvailabilityComponent,
	context: ComboAvailabilityContext,
): number => {
	const code = String(component?.item_code ?? "");
	const fromContext = context?.stockByItem?.[code];
	if (fromContext !== undefined) return toNumber(fromContext);
	return toNumber(component?.actual_qty);
};

/** Is there any stock reading for this component at all? */
const stockIsKnown = (
	component: ComboAvailabilityComponent,
	context: ComboAvailabilityContext,
): boolean => {
	const code = String(component?.item_code ?? "");
	if (context?.stockByItem?.[code] !== undefined) return true;
	return component?.actual_qty !== undefined && component?.actual_qty !== null;
};

/** What a cashier can recognise on screen. Codes are for the system. */
const displayName = (component: ComboAvailabilityComponent): string =>
	String(component?.item_name ?? component?.item_code ?? "").trim() ||
	String(component?.item_code ?? "");

/**
 * How many of this combo the shelves can cover.
 *
 * min over stock components of floor(free / per-combo). Integer by
 * construction: seven units of a component that appears twice is three
 * combos, not three and a half.
 *
 * TIES GO TO THE FIRST COMPONENT IN LIST ORDER. That order is Product Bundle
 * Item's `idx` — the order the shop typed the bundle in — so the answer is
 * stable across calls and matches how the operator thinks about the combo.
 * Picking by lowest stock or alphabetically would reshuffle `limitedBy`
 * between two identical answers and read as flapping.
 */
export const comboAvailability = (
	components: readonly ComboComponent[],
	context: ComboAvailabilityContext = {},
): ComboAvailability => {
	let available = Number.POSITIVE_INFINITY;
	let limitedBy: string | null = null;

	for (const raw of components ?? []) {
		const component = raw as ComboAvailabilityComponent;
		if (!component || !String(component.item_code ?? "").trim()) continue;

		// Labour and services never cap. See the header's point 1.
		if (!constrains(component, context)) continue;

		// A component needing zero units per combo cannot limit anything, and
		// dividing by it would yield Infinity — the same answer by accident.
		// Skipping says so on purpose, and keeps `limitedBy` truthful.
		const perCombo = toNumber(component.qty);
		if (perCombo <= 0) continue;

		const possible = Math.floor(stockFor(component, context) / perCombo);
		// Strict `<` is what makes ties first-wins.
		if (possible < available) {
			available = possible;
			limitedBy = displayName(component);
		}
	}

	if (!Number.isFinite(available)) {
		// Nothing on the shelves constrains this combo — all labour, or a
		// bundle whose every component needs zero units.
		return { available: Number.POSITIVE_INFINITY, limitedBy: null };
	}

	// A component already negative would otherwise report a negative number of
	// sellable combos. Floor at zero; `limitedBy` still names the culprit, so
	// the operator-facing explanation survives the clamp.
	return { available: Math.max(0, available), limitedBy };
};

/** True when `available` is not limited by stock at all. */
export const isUnboundedAvailability = (availability: ComboAvailability | null): boolean =>
	!!availability && !Number.isFinite(availability.available);

/**
 * Sentinel returned by `resolveComboAvailability` when the question cannot be
 * answered honestly.
 *
 * It survived the decision because it still has a job. Before, it meant "the
 * rule is undecided". Now it means "no stock reading reached us" — an offline
 * line, or a resumed draft whose components predate the field. Answering 0
 * there would be a lie in the dangerous direction: it reads as "out of stock"
 * on a combo the shop may have plenty of.
 */
export const COMBO_AVAILABILITY_UNRESOLVED = "combo-availability-unresolved" as const;

export type ComboAvailabilityResolution =
	| { resolved: true; value: ComboAvailability }
	| { resolved: false; reason: typeof COMBO_AVAILABILITY_UNRESOLVED };

/**
 * Every availability question in the POS funnels through here.
 *
 * One choke point, for a reason that outlived the open decision: the rule is
 * implemented in ONE place, and a test can prove no surface answers the
 * question by itself. A component that defaulted to "available" would
 * oversell, and §11 treats that as a zero-tolerance incident rather than a
 * tolerable default.
 */
export const resolveComboAvailability = (
	components: readonly ComboComponent[],
	context: ComboAvailabilityContext = {},
): ComboAvailabilityResolution => {
	probe.calls += 1;

	const constraining = (components ?? []).filter((raw) => {
		const component = raw as ComboAvailabilityComponent;
		return (
			component &&
			String(component.item_code ?? "").trim() !== "" &&
			constrains(component, context) &&
			toNumber(component.qty) > 0
		);
	});

	// At least one component constrains, and not one of them told us its
	// stock. That is ignorance, not scarcity, and they read differently to a
	// cashier.
	if (
		constraining.length > 0 &&
		!constraining.some((c) => stockIsKnown(c as ComboAvailabilityComponent, context))
	) {
		probe.unresolved += 1;
		return { resolved: false, reason: COMBO_AVAILABILITY_UNRESOLVED };
	}

	probe.resolved += 1;
	return { resolved: true, value: comboAvailability(components, context) };
};

/**
 * The qty ceiling to apply to a combo line, or null when there is none.
 *
 * This is the whole of "extend the setting that already exists". The register
 * answered block-vs-warn once, for every line, in
 * `posa_block_sale_beyond_available_qty`; a combo obeys that answer rather
 * than carrying an opinion of its own.
 *
 * `invoice_utils/stock.ts` computes
 * `allowNegativeStock = !blockSale && (…)`, so on the blocking branch it is
 * false by construction — there is no allow-negative escape to re-check here,
 * and reproducing the dead half would only invite someone to "fix" it.
 *
 * Returns null — meaning "no ceiling" — when blocking is off (the shop chose
 * warn-and-sell), when nothing constrains, and when stock is unknown. A
 * ceiling of 0 is a real answer and is returned as 0, not as null.
 */
export const comboQtyCeiling = (
	components: readonly ComboComponent[],
	context: ComboAvailabilityContext = {},
): number | null => ceilingFromResolution(resolveComboAvailability(components, context), context);

/**
 * The same policy, applied to an answer already in hand.
 *
 * The add path needs the figure for display AND the ceiling for the clamp.
 * Asking the choke point twice would double the probe's traffic count and read
 * as two independent questions in a test, so the policy is expressed once here
 * and `comboQtyCeiling` is the convenience wrapper for callers that have only
 * the components.
 */
export const ceilingFromResolution = (
	resolution: ComboAvailabilityResolution,
	context: ComboAvailabilityContext = {},
): number | null => {
	const blockSale =
		truthy(context?.posProfile?.["posa_block_sale_beyond_available_qty"]) ||
		truthy(context?.blockSaleBeyondAvailableQty);
	if (!blockSale) return null;
	if (!resolution.resolved) return null;
	if (!Number.isFinite(resolution.value.available)) return null;
	return Math.max(0, resolution.value.available);
};

/**
 * Call counter for the choke point above.
 *
 * A rule that is mocked away in tests would let a regression ship, so the
 * specs assert on OBSERVED traffic: the cart line rendered, the resolver was
 * asked, and the answers came back the shape we expect. Test-only surface;
 * nothing in the app reads it.
 */
const probe = { calls: 0, unresolved: 0, resolved: 0 };

export const readAvailabilityProbe = (): Readonly<typeof probe> => ({ ...probe });

export const resetAvailabilityProbe = (): void => {
	probe.calls = 0;
	probe.unresolved = 0;
	probe.resolved = 0;
};

/**
 * The single predicate every combo surface asks before showing a stock figure.
 *
 * True since 2026-08-22. Kept as a function rather than deleted: it is the one
 * greppable place that says whether the POS is willing to state an
 * availability number at all, and a future giro that cannot answer honestly
 * (consignment stock, say) turns it off here rather than in ten templates.
 */
export const isAvailabilityKnown = (): boolean => true;

/**
 * What a surface should render for combo availability.
 *
 * Still returns null when the answer is unknown — a 0 renders as "quedan 0"
 * and would stop a cashier from selling a combo the shop can perfectly well
 * assemble. Callers must also handle an unbounded answer; see
 * `isUnboundedAvailability`.
 */
export const comboAvailabilityOrUnknown = (
	components: readonly ComboComponent[],
	context: ComboAvailabilityContext = {},
): ComboAvailability | null => {
	const resolution = resolveComboAvailability(components, context);
	return resolution.resolved ? resolution.value : null;
};
