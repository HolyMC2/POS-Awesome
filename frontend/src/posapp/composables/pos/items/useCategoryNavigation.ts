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
