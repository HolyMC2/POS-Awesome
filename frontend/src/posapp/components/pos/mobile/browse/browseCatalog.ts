/**
 * What the phone's browse screen draws — cards, category chips, footer.
 *
 * `MovilExplorar.dc.html` is a 390px screen showing a two-column grid of
 * cards over a chip row and under a header. The GRID is the only new idea; the
 * data behind it is the catalogue the register already loads and the combos
 * `api/combos.py` already answers for, so this module is a view model over
 * both and owns no fetching, no store and no currency.
 *
 * Three rules it inherits rather than restates, because a second opinion about
 * stock is how two surfaces end up disagreeing in front of a customer:
 *
 *   - Stock comes from `invoice/cartLineStock.ts::describeLineStock`, which
 *     already decided that an ABSENT figure renders nothing and that a real 0
 *     renders in the low tint. The register's `posa_low_stock_alert_threshold`
 *     is the same Int the cart column and the combo chip tint by.
 *   - A combo's saving comes from `comboPricing.ts::priceCombo`, so the phone
 *     and the desktop strip quote one number.
 *   - A combo the shelves cannot cover even once is dropped, exactly as
 *     `comboCatalog.ts::buildSuggestions` drops it — tapping it is a dead end,
 *     and the artboard's footer promises that tapping a card adds it.
 *
 * ITEMS ARE NOT DROPPED AT ZERO, and the difference from combos is deliberate.
 * The up-sell strip is a SUGGESTION: a dead tile there wastes the one Enter
 * binding. This screen is the catalogue: a cashier looking for a case needs to
 * learn that the shop has none, not to conclude the shop never carried it.
 * So a zero item renders, with its zero, in the low tint.
 */

import type { ComboAvailabilityContext } from "../../../../composables/pos/combos/comboAvailability";
import {
	availabilityForLine,
	describeAvailability,
} from "../../../../composables/pos/combos/comboAvailabilityDisplay";
import {
	COMBOS_CATEGORY_ID,
	type ComboOffer,
} from "../../../../composables/pos/combos/comboCatalog";
import { priceCombo } from "../../../../composables/pos/combos/comboPricing";
import type { CatalogCategory } from "../../../../composables/pos/shell/useCatalogDrawer";
import {
	describeLineStock,
	type CartLineStockSource,
} from "../../invoice/cartLineStock";
import { applyCompatibilityFilter, type CompatibilityScope } from "./browseCompatibility";

/**
 * A catalogue row as the items store holds it. Extends the cart's stock source
 * so `describeLineStock` reads the same fields off it that it reads off a line
 * — `_base_actual_qty / conversion_factor` preferred over `actual_qty`, which
 * is the figure `useItemAddition` clamps against.
 */
export interface BrowseCatalogItem extends CartLineStockSource {
	item_code: string;
	item_name?: string;
	item_group?: string;
	rate?: unknown;
	image?: string | null;
	/** Template flag: the card's tap opens the variant picker, not the cart. */
	has_variants?: boolean | number;
}

export type BrowseCardKind = "combo" | "item";

/**
 * The card's one chip, or nothing.
 *
 * `null` is a first-class value here rather than a `show: false` flag, because
 * the template then cannot draw a chip without a chip to draw — the absent
 * stock rule enforced by the type instead of by remembering to check.
 */
export type BrowseCardChip =
	| { kind: "saving"; amount: number }
	| { kind: "stock"; value: number; low: boolean }
	// A TEMPLATE (has_variants): the tap opens the variant picker, not the
	// cart, and the chip says so. It replaces the stock chip — a template's
	// own stock figure aggregates its variants and would mislead.
	| { kind: "variants" }
	| null;

export interface BrowseCard {
	item_code: string;
	item_name: string;
	kind: BrowseCardKind;
	/** Combo: `Case + Mica + Instalación`. Item: its code. */
	subtitle: string;
	/** Chip this card answers to. Empty means no chip can name it. */
	categoryId: string;
	rate: number;
	image: string | null;
	chip: BrowseCardChip;
	/** Set by `buildBrowseCards` from the scope; never guessed downstream. */
	compatible: boolean;
}

export type BrowseTranslate = (_text: string, _args?: readonly unknown[]) => string;

/**
 * Stand-in for Frappe's `__`, so every function here runs in a spec with no
 * globals — the same arrangement `comboCatalog.ts` and `discountIntent.ts` use.
 * It substitutes `{0}`-style placeholders because the real `__` does, and a
 * default that dropped them would make the untranslated path silently differ.
 */
export const defaultTranslate: BrowseTranslate = (text, args) =>
	(args ?? []).reduce<string>(
		(out, value, index) => out.split(`{${index}}`).join(String(value)),
		text,
	);

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(n) ? n : 0;
};

/** `1482` → `1,482`, matching the artboard's header and footer counts. */
export const formatCount = (value: number): string =>
	new Intl.NumberFormat().format(Math.max(0, Math.round(toNumber(value))));

/**
 * A combo's subtitle: its parts, in table order.
 *
 * The artboard writes `Case + Mica + Instalación` — the component NAMES, not a
 * count, because the whole reason a cashier taps a combo is knowing what is in
 * it. Falls back to the component code when the read model has no name, and to
 * an empty string when there are no components, so a malformed bundle draws a
 * blank line rather than a lone separator.
 */
export const comboSubtitle = (combo: ComboOffer): string =>
	(combo?.components ?? [])
		.map((component) => String(component?.item_name ?? component?.item_code ?? "").trim())
		.filter(Boolean)
		.join(" + ");

/**
 * An item's subtitle: its code.
 *
 * Deliberately NOT `cartLineStock.describeLineIdentity`, which appends the
 * item group. On a cart line the group is the only breadcrumb there is; here
 * the group is a chip directly above the grid, and repeating it under every
 * card spends the two lines a 190px-wide card has on something already on
 * screen. Same reasoning, opposite answer.
 */
export const itemSubtitle = (item: BrowseCatalogItem): string =>
	String(item?.item_code ?? "").trim();

export interface BuildBrowseCardsInput {
	items?: readonly BrowseCatalogItem[];
	combos?: readonly ComboOffer[];
	/** Decides `compatible` per card. Absent or unsupported ⇒ all false. */
	scope?: CompatibilityScope | null;
	/** `posa_low_stock_alert_threshold` off the POS Profile. */
	lowStockThreshold?: unknown;
	availabilityContext?: ComboAvailabilityContext;
}

/**
 * Every card the screen could draw, combos first.
 *
 * Combos lead because the artboard leads with one and because a bundle is the
 * higher-margin answer to "what goes with this phone" — the revenue argument
 * §17.6 makes. Within each kind the caller's order is preserved: the combos
 * arrive sorted by the register's own `priority`, and the items arrive in the
 * order the catalogue (or the search) ranked them, which is not this module's
 * opinion to override.
 */
export const buildBrowseCards = (input: BuildBrowseCardsInput = {}): BrowseCard[] => {
	const { items = [], combos = [], scope, lowStockThreshold, availabilityContext } = input ?? {};
	const compatibleCodes = scope?.supported ? scope.codes : null;
	const isCompatible = (code: string) => Boolean(compatibleCodes?.has(code));

	const comboCards: BrowseCard[] = (combos ?? [])
		// Same rule and same call as the up-sell strip: only a KNOWN, bounded
		// zero is dropped. Unbounded (all labour) and unknown (offline) stay,
		// because not being able to count is not being out.
		.filter((combo) => {
			const display = describeAvailability(
				availabilityForLine(null, combo?.components ?? [], availabilityContext),
				{ lowStockThreshold },
			);
			return !(display.show && display.value === 0);
		})
		.map((combo) => {
			const code = String(combo?.item_code ?? "").trim();
			const saving = priceCombo(combo?.components ?? [], combo?.rate).saving;
			return {
				item_code: code,
				item_name: String(combo?.item_name ?? "").trim() || code,
				kind: "combo" as const,
				subtitle: comboSubtitle(combo),
				categoryId: COMBOS_CATEGORY_ID,
				rate: toNumber(combo?.rate),
				image: combo?.image ?? null,
				// A combo priced at or above its parts is legitimate (a shop may
				// bundle for convenience) and draws no chip — `−$0` would claim a
				// discount that is not there.
				chip: saving > 0 ? { kind: "saving" as const, amount: saving } : null,
				compatible: isCompatible(code),
			};
		});

	const itemCards: BrowseCard[] = (items ?? []).map((item) => {
		const code = String(item?.item_code ?? "").trim();
		const stock = describeLineStock(item, { lowStockThreshold });
		return {
			item_code: code,
			item_name: String(item?.item_name ?? "").trim() || code,
			kind: "item" as const,
			subtitle: itemSubtitle(item),
			categoryId: String(item?.item_group ?? "").trim(),
			rate: toNumber(item?.rate),
			image: item?.image ?? null,
			chip: item?.has_variants
				? { kind: "variants" as const }
				: stock.show
					? {
							kind: "stock" as const,
							value: stock.value ?? 0,
							// Zero is drawn low whatever the threshold says. A threshold of
							// 0 means "never warn about a thin shelf"; it does not mean an
							// empty one reads as healthy, and the green tint would say
							// exactly that.
							low: stock.isLow || (stock.value ?? 0) === 0,
						}
					: null,
			compatible: isCompatible(code),
		};
	});

	return [...comboCards, ...itemCards];
};

export interface BrowseFilterInput {
	/** Honoured only when the scope supports it; the chip is gated the same way. */
	compatibleOnly?: boolean;
	scope?: CompatibilityScope | null;
	/** A `CatalogCategory` id, or null/empty for the whole scope. */
	categoryId?: string | null;
}

/**
 * Narrow the cards to what the chips currently select.
 *
 * Compatible is applied FIRST and category second, so the two compose the way
 * the row reads left to right: Compatible + Fundas is "cases that fit this
 * phone", which is the question the screen exists to answer. The compatible
 * narrowing goes through `applyCompatibilityFilter` rather than reaching into
 * `scope.codes` here, so there is exactly one function in the app that can
 * decide what "compatible" contains — and exactly one to mutation-test.
 */
export const filterBrowseCards = (
	cards: readonly BrowseCard[],
	input: BrowseFilterInput = {},
): BrowseCard[] => {
	const { compatibleOnly = false, scope, categoryId } = input ?? {};

	const scoped =
		compatibleOnly && scope?.supported
			? applyCompatibilityFilter(cards ?? [], scope)
			: [...(cards ?? [])];

	const wanted = String(categoryId ?? "").trim();
	if (!wanted) return scoped;
	return scoped.filter((card) => card.categoryId === wanted);
};

/**
 * The chip row's categories, counted over the cards they will actually show.
 *
 * Counting over the SCOPED cards rather than over the whole catalogue is the
 * only self-consistent choice: a chip reading "Fundas 18" that opens onto three
 * cards has lied about the one thing a count is for. It is also why this does
 * not call `comboCatalog.ts::buildCombosCategory` — that counts the register's
 * whole combo catalogue, which is the right answer for the desktop drawer and
 * the wrong one here. The ID is imported from there regardless, so a chip
 * selected on the phone and a chip selected on the desktop mean the same thing.
 *
 * Item groups are NOT translated. They are the merchant's own words, typed into
 * their own Item Group tree, and running them through `__()` would leave them
 * untouched at best and swap in an unrelated string at worst.
 */
export const buildBrowseCategories = (
	cards: readonly BrowseCard[],
	translate: BrowseTranslate = defaultTranslate,
): CatalogCategory[] => {
	const combos = (cards ?? []).filter((card) => card.kind === "combo").length;
	const groups = new Map<string, number>();
	for (const card of cards ?? []) {
		if (card.kind !== "item") continue;
		// An item with no group gets no chip: there is no honest label for it,
		// and inventing an "Other" bucket would put a name on the register's
		// missing data. It still appears in the unfiltered grid.
		if (!card.categoryId) continue;
		groups.set(card.categoryId, (groups.get(card.categoryId) ?? 0) + 1);
	}

	const categories: CatalogCategory[] = [];
	if (combos > 0) {
		categories.push({
			id: COMBOS_CATEGORY_ID,
			label: translate("Combos"),
			count: combos,
			featured: true,
		});
	}

	categories.push(
		...[...groups.entries()]
			.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
			.map(([id, count]) => ({ id, label: id, count, featured: false })),
	);

	return categories;
};

export interface BrowseFooter {
	/** The claim, or the plain count when no claim can be made. */
	countLine: string;
	hint: string;
	/** Null when nothing is hidden — an escape hatch out of a full view is noise. */
	seeAllLabel: string | null;
	/** True only while the compatible filter narrows the grid (owner 08-31:
	 *  the plain «N items / tap a card» box is noise on a dock-navigated
	 *  phone; the footer draws only for a claim or an action). */
	claiming: boolean;
	shownCount: number;
	totalCount: number;
}

export interface BuildBrowseFooterInput {
	/** Cards currently on screen. */
	shownCount?: number;
	/** Cards before the chips narrowed anything — the artboard's "Ver los 128". */
	totalCount?: number;
	scope?: CompatibilityScope | null;
	compatibleOnly?: boolean;
	translate?: BrowseTranslate;
}

/**
 * The footer strip.
 *
 * `countLine` names the device ONLY when the compatible filter is both
 * supported and on. Any other state says "N items", because "18 compatibles con
 * Honor X8A" over an unfiltered grid is the sentence this whole screen is built
 * to avoid printing.
 */
export const buildBrowseFooter = (input: BuildBrowseFooterInput = {}): BrowseFooter => {
	const {
		shownCount = 0,
		totalCount = 0,
		scope,
		compatibleOnly = false,
		translate = defaultTranslate,
	} = input ?? {};

	const shown = Math.max(0, Math.round(toNumber(shownCount)));
	const total = Math.max(shown, Math.round(toNumber(totalCount)));
	const claiming = Boolean(compatibleOnly && scope?.supported);

	return {
		countLine: claiming
			? translate("{0} compatible with {1}", [formatCount(shown), scope?.deviceName ?? ""])
			: translate("{0} items", [formatCount(shown)]),
		hint: translate("Tap a card to add it"),
		seeAllLabel: total > shown ? translate("See all {0}", [formatCount(total)]) : null,
		/** True only while the compatible filter is narrowing the grid — the
		 *  one state where the footer's count is a CLAIM rather than noise. */
		claiming,
		shownCount: shown,
		totalCount: total,
	};
};
