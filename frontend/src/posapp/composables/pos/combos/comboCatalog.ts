/**
 * What combos contribute to the catalogue drawer and to the up-sell strip.
 *
 * Two surfaces, one module, because both answer the same question from
 * different ends: "which combos are relevant to what is on this ticket right
 * now?" The drawer answers it as a CATEGORY; the "se suele llevar junto"
 * strip answers it as a short ranked list.
 *
 * The drawer itself knows nothing about combos — `CatalogCategory` in
 * `composables/pos/shell/useCatalogDrawer.ts` is a plain
 * `{ id, label, count, featured }` contract and this module fills it in. That
 * separation is deliberate: the drawer renders whatever the register hands it,
 * so adding a future category costs nobody a change inside the drawer.
 */

import {
	describeLineStock,
	type CartLineStockSource,
} from "../../../components/pos/invoice/cartLineStock";
import type { CatalogCategory } from "../shell/useCatalogDrawer";
import type {
	ComboAvailabilityComponent,
	ComboAvailabilityContext,
} from "./comboAvailability";
import {
	availabilityForLine,
	describeAvailability,
	type ComboAvailabilityDisplay,
} from "./comboAvailabilityDisplay";
import { priceCombo } from "./comboPricing";

/** A sellable combo, as the POS read model delivers it. */
export interface ComboOffer {
	/** The Product Bundle's `new_item_code` — the item actually sold. */
	item_code: string;
	item_name: string;
	/** Price of the combo itself, from the active price list. */
	rate: number;
	/**
	 * `is_stock_item` rides every component (`combos.py` always sends it) and
	 * the availability rule is the only thing that reads it, so the widened
	 * shape is the honest one here — `normalizeComboOffer` has always produced
	 * it.
	 */
	components: ComboAvailabilityComponent[];
	image?: string | null;
	/**
	 * Item codes this combo is FOR — the phone a case+mica+instalación
	 * protects. Empty means universal (a charger combo fits anything), UNLESS
	 * `target_attribute_values` is set: see {@link eligibilityFor}.
	 */
	targets?: string[];
	/**
	 * The shop's entry attribute — the Item Attribute its Storefront Profile
	 * names, which is how the storefront has answered "which phone is this
	 * for?" since §32 («Modelos Celulares» on docomexico).
	 *
	 * `null`/absent means the tenant runs no storefront, so the register has
	 * no attribute facts on its cart lines either and this leg of the matcher
	 * is inert. It is carried rather than assumed because an OFFLINE cached
	 * payload can outlive the config that produced it.
	 */
	target_attribute?: string | null;
	/**
	 * Values of that attribute this combo is FOR — «Samsung A01», «iPhone 13».
	 *
	 * One value reaches every accessory the merchant tagged with it, which is
	 * why this exists beside `targets`: docomexico's catalogue carries 3 526
	 * cases and 622 micas already tagged by model, and naming them by code is
	 * a list that goes stale on the next colour.
	 */
	target_attribute_values?: string[];
	/** Ordering hint from `POS Combo`; lower sorts first. */
	priority?: number;
}

/**
 * A ticket line as the matcher needs to see it.
 *
 * `entry_attribute_value` rides every item row the register fetches
 * (`api/entry_attribute.py` writes it on all three item wire paths), so a cart
 * line built from the catalogue carries it without the shell doing anything.
 * Absent means the register does not know which device this item is for —
 * a tenant with no storefront, an untagged item, a template, or a line
 * restored from a cache written before the field shipped. All four are treated
 * as NO MATCH rather than as a wildcard, for the reason
 * `comboAvailability.ts` gives about unknowns: the loud failure is the safe one
 * and a wildcard would offer the wrong phone's case.
 */
export interface CartEntryLike {
	item_code?: unknown;
	entry_attribute_value?: unknown;
}

/** The ticket, as lines or as bare item codes. Both are accepted everywhere. */
export type CartEntry = string | CartEntryLike;

/** One tile in the "se suele llevar junto" strip. */
export interface ComboSuggestion {
	item_code: string;
	item_name: string;
	rate: number;
	image?: string | null;
	/** Set for combos; drives the green "ahorra $N" note. */
	saving?: number;
	/**
	 * Set for plain accessories; drives the muted "· N pzas" note.
	 *
	 * `null` means the register does not know — a service with no shelf, an
	 * offline tile, a payload with no figure — and the tile draws NOTHING.
	 * It is null rather than 0 because 0 is a claim: it tells the cashier the
	 * shop has none, and they will repeat that to the customer. Same rule and
	 * same vocabulary as `cartLineStock.describeLineStock`, which this is
	 * computed from, so the strip and the cart's `Existencia` column cannot
	 * disagree about what an absent figure means.
	 */
	availableQty?: number | null;
	/** Which of the two shapes above this tile is. */
	kind: "combo" | "item";
	/**
	 * What the tile may draw about stock. `show: false` means draw nothing —
	 * an all-labour combo is unbounded and an offline one is unknown, and both
	 * would otherwise render "Infinity" or a misleading 0.
	 */
	availability?: ComboAvailabilityDisplay;
	/** Why it was suggested — surfaced for telemetry, not for the operator. */
	reason: "targets-cart-item" | "universal";
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/** Default width of the strip in the artboard: four tiles across. */
export const SUGGESTION_LIMIT = 4;

/** Stable id for the combos category; persisted as a remembered category. */
export const COMBOS_CATEGORY_ID = "combos";

/**
 * The selector the evidence lane actually gets for the Combos chip.
 *
 * `CatalogDrawer.vue` builds every chip's hook as
 * `catalog-drawer-category-${category.id}`, so the id above decides the
 * suffix and the drawer decides the prefix. Exported as one constant rather
 * than written out in each spec, because a chip nobody can select is a
 * screenshot nobody can assert on.
 */
export const COMBOS_CATEGORY_TESTID = `catalog-drawer-category-${COMBOS_CATEGORY_ID}`;

/**
 * The Combos entry for the drawer's category chips.
 *
 * Returns null when the register sells no combos, because an empty category
 * chip is a promise of content that is not there. `featured` is set so an
 * `empty-cart` open lands here — a cashier starting a fresh ticket is exactly
 * who should see bundles first, which is the whole revenue argument in §17.6.
 *
 * `translate` takes Frappe's `__`; it defaults to identity so this module
 * stays testable with no globals, matching `discountIntent.ts`.
 */
export const buildCombosCategory = (
	combos: readonly ComboOffer[],
	translate: (_text: string) => string = (text) => text,
	cart: readonly CartEntry[] = [],
): CatalogCategory | null => {
	const total = (combos ?? []).length;
	if (!total) return null;
	// The count follows the customer's device, with two floors — and both of
	// them are about the chip continuing to EXIST:
	//
	//   - An EMPTY ticket is not a filter. There is no device to narrow by, and
	//     a fresh ticket is precisely who `featured` exists for: the cashier
	//     opening the drawer on a new sale should see the whole shelf of
	//     bundles, not the universal remainder.
	//   - A ticket that matches NOTHING keeps the whole shelf too. The count is
	//     a hint; the chip is the way in. This id is a REMEMBERED category, so
	//     a chip that vanished mid-ticket would strand a cashier who had left
	//     the drawer on Combos — on a register whose combos are all
	//     device-specific and whose cart happens to hold a charger, which is
	//     the exact ticket the 2026-08-23 report was written about.
	const narrowed = cartCodes(cart).length ? combosForCart(combos, cart).length : 0;
	return {
		id: COMBOS_CATEGORY_ID,
		label: translate("Combos"),
		count: narrowed || total,
		featured: true,
	};
};

/**
 * Why a combo is relevant to this ticket, or `null` for "it is not".
 *
 * ONE rule, in one place, because two surfaces used to ask it separately:
 * `combosForCart` filtered and `buildSuggestions` re-derived the same `.some()`
 * to label the tile. Two spellings of one rule is how a matcher and its own
 * explanation drift apart.
 *
 * The rule, in order:
 *
 *   1. A combo already on the ticket is never suggested back.
 *   2. A combo that declares NO targeting of either kind is universal — a
 *      charger combo fits anything — and is always eligible.
 *   3. Otherwise it must be FOR something in the cart, matched either by item
 *      code (`targets`) or by the shop's entry attribute
 *      (`target_attribute_values` against each line's `entry_attribute_value`).
 *      The two legs are an OR and neither outranks the other: a merchant who
 *      names both a handset and a model has said the same thing twice.
 *
 * Point 2 is what makes the attribute leg safe to add. A combo carrying only
 * attribute targets on a register that cannot resolve the attribute stays
 * TARGETED — it simply never matches — rather than falling back to universal
 * and appearing on every ticket in the shop. Silence is recoverable; offering
 * an iPhone bundle to someone buying eggs is not.
 */
export type ComboEligibility = "targets-cart-item" | "universal";

const eligibilityFor = (
	combo: ComboOffer,
	inCart: ReadonlySet<string>,
	deviceValues: ReadonlySet<string>,
): ComboEligibility | null => {
	if (inCart.has(String(combo?.item_code ?? ""))) return null;

	const targets = combo?.targets ?? [];
	const attributeTargets = combo?.target_attribute_values ?? [];
	if (!targets.length && !attributeTargets.length) return "universal";

	if (targets.some((code) => inCart.has(String(code)))) return "targets-cart-item";
	// Guarded on the attribute NAME, not just on the values: an offline payload
	// cached while a storefront was configured can outlive it, and matching its
	// stale values against a cart whose lines carry none would be comparing two
	// different questions' answers.
	if (
		combo?.target_attribute &&
		attributeTargets.some((value) => deviceValues.has(String(value)))
	) {
		return "targets-cart-item";
	}
	return null;
};

/**
 * The device values on this ticket — which phones the customer is buying for.
 *
 * Blank and absent entries are dropped rather than kept as `""`, so a combo
 * that somehow declared an empty target value cannot match an untagged line.
 */
const cartDeviceValues = (cart: readonly CartEntry[]): Set<string> => {
	const values = new Set<string>();
	for (const entry of cart ?? []) {
		if (typeof entry === "string") continue;
		const value = String(entry?.entry_attribute_value ?? "").trim();
		if (value) values.add(value);
	}
	return values;
};

/**
 * Combos relevant to what is already on the ticket.
 *
 * If the cart holds an Honor X8A case, the Honor protection combo is relevant
 * and the iPhone one is not — the "filtered by the customer's device" rule
 * §17.6 records for the design. See {@link eligibilityFor} for the whole rule.
 *
 * Accepts the ticket as lines or as bare item codes. Bare codes carry no
 * device value, so a caller that passes them gets code matching only — which
 * is exactly right for the specs and callers that only have codes to give.
 */
export const combosForCart = (
	combos: readonly ComboOffer[],
	cart: readonly CartEntry[],
): ComboOffer[] => {
	const inCart = new Set(cartCodes(cart));
	const deviceValues = cartDeviceValues(cart);
	return (combos ?? []).filter((combo) => eligibilityFor(combo, inCart, deviceValues) !== null);
};

/**
 * The cart payload for a tile the cashier accepted.
 *
 * A tile carries what the STRIP draws — code, name, price, an image — and that
 * is not what the cart needs. `useItemAddition.addItem` builds the line from
 * the object it is handed: no `stock_uom`, no `is_stock_item`, no
 * `has_batch_no`, no `_base_actual_qty` means a line that skips the stock gate,
 * cannot pick a batch, and — for a combo — gives `expandBundle` nothing to
 * build a packing list from, so the parent sells and no component decrements.
 * Fabricating those fields from the tile would be inventing stock data on the
 * money path.
 *
 * So the payload is the CATALOGUE's item, looked up by code, and `null` when
 * the register's catalogue does not carry it. Null is a real answer the caller
 * must handle — declining to add is honest, and a guessed line is not.
 *
 * `lookup` is `itemsStore.getItemByCode`, injected rather than imported so this
 * module stays pure and testable without a store.
 */
export const suggestionAddPayload = (
	suggestion: ComboSuggestion | null | undefined,
	lookup: (_itemCode: string) => any,
): Record<string, unknown> | null => {
	const code = String(suggestion?.item_code ?? "").trim();
	if (!code || typeof lookup !== "function") return null;
	const catalogItem = lookup(code);
	if (!catalogItem || !catalogItem.item_code) return null;
	// Copied, never handed over: `addItem` mutates what it is given (uom
	// defaulting, batch selection), and the catalogue's own row must not
	// acquire a qty because someone tapped a tile.
	return { ...catalogItem, qty: 1 };
};

/**
 * A plain, non-combo tile: an accessory offered beside the combos.
 *
 * NOTHING FEEDS THIS TODAY, and that is a statement about the read model
 * rather than about this module. The artboard mixes three accessories with one
 * combo, but the register has no authored "these go together" relation for
 * loose items: `api/combos.py` answers for bundles, and the only other
 * authored association in the product — a Promotional Scheme's `Give Product`
 * slab (`api/offers.py::_build_product_discount_offers`) — is a discount
 * mechanism that auto-applies and gives its item free or at a slab rate, so
 * drawing it here at list price would misquote it. Inferring accessories from
 * item groups or sales history would be a recommendation engine nobody asked
 * for and nobody could audit.
 *
 * So the parameter stays, typed and tested, and the strip ships the half that
 * has a source. When an accessory read model lands it plugs in here and the
 * ranking, the stock rule and the Enter binding already work.
 */
export interface SuggestionAccessory extends CartLineStockSource {
	item_code: string;
	item_name: string;
	rate: number;
	image?: string | null;
}

/**
 * The strip's inputs, NAMED.
 *
 * This was four positional arguments and it was called wrong in the one place
 * it was called: `Pos.vue` passed the cart's LINES where `accessories` goes
 * and nothing where the cart goes, which — had a combo ever loaded — would
 * have offered the cashier the four items they had just scanned. Positional
 * arguments of the same shape (arrays of item-ish objects) cannot be told
 * apart by the compiler or by a reader. Named ones can.
 */
export interface BuildSuggestionsInput {
	/** The register's combos, from `useComboOffers`. */
	combos?: readonly ComboOffer[];
	/** Loose accessories. See `SuggestionAccessory` — nothing supplies these. */
	accessories?: readonly SuggestionAccessory[];
	/** The ticket, as lines or as bare item codes. Both are accepted. */
	cart?: readonly CartEntry[];
	limit?: number;
	availabilityContext?: ComboAvailabilityContext;
	lowStockThreshold?: number;
}

/**
 * Item codes from the ticket, whether it arrived as lines or as codes.
 *
 * The shell holds `invoiceDoc.items` — full lines — while every spec here
 * holds codes, and demanding one shape of both is how a caller ends up
 * mapping at the call site and getting it wrong. Blank entries are dropped so
 * a half-built line cannot match a combo whose `targets` is also blank.
 */
const cartCodes = (cart: readonly CartEntry[]): string[] =>
	(cart ?? [])
		.map((entry) => String((typeof entry === "string" ? entry : entry?.item_code) ?? "").trim())
		.filter(Boolean);

/**
 * Rank the up-sell strip.
 *
 * Combos that target something already in the cart come first, because a
 * suggestion tied to what the customer is holding is the one that converts;
 * universal combos and plain accessories fill the rest. Within a group the
 * register's own `priority` wins, then the larger saving, then item_code so
 * the order is stable — an up-sell strip that reshuffles between renders is
 * one the cashier cannot build muscle memory against, and the artboard binds
 * Enter to "agregar el primero".
 */
export const buildSuggestions = (input: BuildSuggestionsInput): ComboSuggestion[] => {
	const {
		combos = [],
		accessories = [],
		cart = [],
		limit = SUGGESTION_LIMIT,
		availabilityContext,
		lowStockThreshold,
	} = input ?? {};
	const options = { availabilityContext, lowStockThreshold };

	const inCart = new Set(cartCodes(cart));
	const deviceValues = cartDeviceValues(cart);
	// Kept WITH its reason rather than re-deriving the reason per tile: the
	// label the strip reports and the rule that let the combo through are the
	// same decision, made once.
	const eligible = (combos ?? [])
		.map((combo) => ({ combo, reason: eligibilityFor(combo, inCart, deviceValues) }))
		.filter((entry): entry is { combo: ComboOffer; reason: ComboEligibility } =>
			entry.reason !== null,
		);

	const comboTiles: ComboSuggestion[] = eligible
		// A combo the shelves cannot cover even once is not a suggestion, it is
		// a dead end — and the strip binds Enter to its first tile, so an
		// unsellable leader costs the cashier the primary keyboard action.
		// Only a KNOWN, bounded zero is dropped: unknown and unbounded stay,
		// because absence of a reading is not absence of stock.
		.filter(({ combo }) => {
			const display = describeAvailability(
				availabilityForLine(null, combo.components ?? [], options.availabilityContext),
				{ lowStockThreshold: options.lowStockThreshold },
			);
			return !(display.show && display.value === 0);
		})
		.map(({ combo, reason }) => ({
			item_code: combo.item_code,
			item_name: combo.item_name,
			rate: toNumber(combo.rate),
			image: combo.image ?? null,
			saving: priceCombo(combo.components ?? [], combo.rate).saving,
			availability: describeAvailability(
				availabilityForLine(null, combo.components ?? [], options.availabilityContext),
				{ lowStockThreshold: options.lowStockThreshold },
			),
			kind: "combo" as const,
			reason,
			priority: toNumber(combo.priority),
		}))
		.sort((a, b) => {
			if (a.reason !== b.reason) return a.reason === "targets-cart-item" ? -1 : 1;
			if (a.priority !== b.priority) return a.priority - b.priority;
			if ((b.saving ?? 0) !== (a.saving ?? 0)) return (b.saving ?? 0) - (a.saving ?? 0);
			return a.item_code.localeCompare(b.item_code);
		})
		.map(({ priority: _priority, ...tile }) => tile);

	const itemTiles: ComboSuggestion[] = (accessories ?? [])
		.filter((item) => !inCart.has(String(item?.item_code ?? "")))
		.map((item) => ({ item, stock: describeLineStock(item, { lowStockThreshold }) }))
		// The same rule the combos above obey, for the same reason: a KNOWN
		// zero is a dead tile, and the strip binds Enter to whichever tile
		// leads. Only a known zero is dropped — a service or an offline tile
		// reads as unknown and stays, because not knowing is not being out.
		.filter(({ stock }) => !(stock.show && stock.value === 0))
		.map(({ item, stock }) => ({
			item_code: item.item_code,
			item_name: item.item_name,
			rate: toNumber(item.rate),
			image: item.image ?? null,
			availableQty: stock.show ? stock.value : null,
			kind: "item" as const,
			reason: "universal" as const,
		}));

	return [...comboTiles, ...itemTiles].slice(0, Math.max(0, limit));
};
