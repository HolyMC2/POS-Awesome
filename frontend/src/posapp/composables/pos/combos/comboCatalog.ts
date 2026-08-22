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
import type { ComboAvailabilityContext } from "./comboAvailability";
import {
	availabilityForLine,
	describeAvailability,
	type ComboAvailabilityDisplay,
} from "./comboAvailabilityDisplay";
import { priceCombo, type ComboComponent } from "./comboPricing";

/** A sellable combo, as the POS read model delivers it. */
export interface ComboOffer {
	/** The Product Bundle's `new_item_code` — the item actually sold. */
	item_code: string;
	item_name: string;
	/** Price of the combo itself, from the active price list. */
	rate: number;
	components: ComboComponent[];
	image?: string | null;
	/**
	 * Item codes this combo is FOR — the phone a case+mica+instalación
	 * protects. Empty means universal (a charger combo fits anything).
	 */
	targets?: string[];
	/** Ordering hint from `POS Combo`; lower sorts first. */
	priority?: number;
}

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
): CatalogCategory | null => {
	const count = (combos ?? []).length;
	if (!count) return null;
	return {
		id: COMBOS_CATEGORY_ID,
		label: translate("Combos"),
		count,
		featured: true,
	};
};

/**
 * Combos relevant to what is already on the ticket.
 *
 * A combo `targets` the device it protects. If the cart holds an Honor X8A
 * case, the Honor protection combo is relevant and the iPhone one is not —
 * this is the "filtered by the customer's device" rule §17.6 records for the
 * design. Combos with no targets are universal and always eligible.
 */
export const combosForCart = (
	combos: readonly ComboOffer[],
	cartItemCodes: readonly string[],
): ComboOffer[] => {
	const inCart = new Set((cartItemCodes ?? []).map(String));
	return (combos ?? []).filter((combo) => {
		// Never suggest what is already on the ticket.
		if (inCart.has(String(combo?.item_code ?? ""))) return false;
		const targets = combo?.targets ?? [];
		if (!targets.length) return true;
		return targets.some((code) => inCart.has(String(code)));
	});
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
	cart?: readonly (string | { item_code?: unknown })[];
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
const cartCodes = (cart: readonly (string | { item_code?: unknown })[]): string[] =>
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

	const cartItemCodes = cartCodes(cart);
	const inCart = new Set(cartItemCodes);
	const eligible = combosForCart(combos, cartItemCodes);

	const comboTiles: ComboSuggestion[] = eligible
		// A combo the shelves cannot cover even once is not a suggestion, it is
		// a dead end — and the strip binds Enter to its first tile, so an
		// unsellable leader costs the cashier the primary keyboard action.
		// Only a KNOWN, bounded zero is dropped: unknown and unbounded stay,
		// because absence of a reading is not absence of stock.
		.filter((combo) => {
			const display = describeAvailability(
				availabilityForLine(null, combo.components ?? [], options.availabilityContext),
				{ lowStockThreshold: options.lowStockThreshold },
			);
			return !(display.show && display.value === 0);
		})
		.map((combo) => {
		const targeted = (combo.targets ?? []).some((code) => inCart.has(String(code)));
		return {
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
			reason: targeted ? ("targets-cart-item" as const) : ("universal" as const),
			priority: toNumber(combo.priority),
		};
	})
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
