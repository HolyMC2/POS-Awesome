import { computed, onBeforeUnmount, ref } from "vue";
import {
	loadItemSelectorSettings,
	ITEM_SETTINGS_CHANGED,
} from "../../../utils/itemSelectorSettings";

export type CategoryNavigation = "touch" | "categories" | "products";

export function normalizeCategoryNavigation(
	value: unknown,
): CategoryNavigation {
	return value === "categories" || value === "products" ? value : "touch";
}

/** Device preference shared by the compact catalogue and the persistent selector. */
export function useCategoryNavigation() {
	const mode = ref(
		normalizeCategoryNavigation(
			loadItemSelectorSettings()?.category_navigation,
		),
	);
	const media =
		typeof window !== "undefined"
			? window.matchMedia?.("(any-pointer: coarse)")
			: null;
	const touch = ref(media?.matches === true);
	const updatePointer = () => {
		touch.value = media?.matches === true;
	};
	const updateSettings = () => {
		const next = normalizeCategoryNavigation(
			loadItemSelectorSettings()?.category_navigation,
		);
		if (next !== mode.value) showProducts.value = false;
		mode.value = next;
	};
	const showProducts = ref(false);
	media?.addEventListener?.("change", updatePointer);
	window.addEventListener(ITEM_SETTINGS_CHANGED, updateSettings);
	window.addEventListener("storage", updateSettings);
	onBeforeUnmount(() => {
		media?.removeEventListener?.("change", updatePointer);
		window.removeEventListener(ITEM_SETTINGS_CHANGED, updateSettings);
		window.removeEventListener("storage", updateSettings);
	});
	const categoryFirst = computed(
		() =>
			mode.value === "categories" ||
			(mode.value === "touch" && touch.value),
	);
	return { mode, categoryFirst, showProducts };
}

/** Full profile group list, never inferred from a paginated product result. */
export function categoryChoices(groups: readonly string[]) {
	return [
		...new Set(
			groups.filter(
				(group) =>
					typeof group === "string" &&
					group.trim() &&
					group !== "ALL",
			),
		),
	].map((id) => ({ id, label: id }));
}

export interface CategoryRowFit {
	/** Inner width of the row; 0 when it has not been laid out (jsdom, hidden). */
	available: number;
	/** The row's column gap. */
	gap: number;
	/** Controls that never collapse (back, Compatible), gaps between them included. */
	fixedWidth: number;
	/** Width reserved for the trailing "+N" toggle. */
	moreWidth: number;
	/** Every category chip in display order, measured. */
	chips: readonly { id: string; width: number }[];
	/** The selected category, kept in the row even when its turn comes late. */
	activeId?: string | null;
	/**
	 * Lines a menu may use when that shows EVERY chip. A short menu reads best
	 * whole; a long one folds to one line and «+N». Default 1.
	 */
	maxLines?: number;
}

/** Lines a wrapping flex row needs for these widths, in order. */
function linesFor(widths: readonly number[], available: number, gap: number) {
	let lines = 0;
	let used = 0;
	for (const width of widths) {
		if (lines === 0 || used + gap + width > available) {
			lines += 1;
			used = width;
		} else {
			used += gap + width;
		}
	}
	return lines;
}

/**
 * Which category chips ONE row can show, or `null` for "all of them".
 *
 * The phone's category row may not scroll sideways (movil responsive rule,
 * 2026-09-22) and may not wrap into a wall above the grid either, so it shows
 * the chips that fit in display order and hands the rest to a "+N" toggle.
 * The selected chip is reserved first, so the answer to "which category am I
 * in?" is never behind that toggle.
 *
 * `null` when everything fits (within `maxLines`), and also when nothing was
 * measured — an unmeasured row shows every chip rather than guessing at a
 * layout.
 */
export function fitCategoryRow(fit: CategoryRowFit): Set<string> | null {
	const { available, gap, fixedWidth, moreWidth, chips, activeId } = fit;
	const maxLines = Math.max(1, fit.maxLines ?? 1);
	if (!(available > 0) || chips.some((chip) => !(chip.width > 0))) {
		return null;
	}
	const widths = [
		...(fixedWidth > 0 ? [fixedWidth] : []),
		...chips.map((chip) => chip.width),
	];
	if (linesFor(widths, available, gap) <= maxLines) return null;

	const fixed = fixedWidth > 0 ? fixedWidth + gap : 0;
	const shown = new Set<string>();
	let used = fixed + moreWidth;
	const active = chips.find((chip) => chip.id === activeId);
	if (active) {
		shown.add(active.id);
		used += active.width + gap;
	}
	for (const chip of chips) {
		if (shown.has(chip.id)) continue;
		// In order, and stop at the first that does not fit: skipping ahead to a
		// narrower chip would reshuffle the row every time the width changes.
		if (used + chip.width + gap > available) break;
		shown.add(chip.id);
		used += chip.width + gap;
	}
	return shown;
}
