import type { Component } from "vue";
import ItemsSelector from "../components/pos/items/ItemsSelector.vue";
import Invoice from "../components/pos/Invoice.vue";
import type { CartStyle, ItemsPanelStyle, PosViewContext } from "./viewContracts";

/**
 * View registry (VERTICAL_PROFILES_PLAN.md M2).
 *
 * Keyed on (layout, context) — NEVER layout alone: ItemsSelector mounts in
 * three contexts (sales register, purchase orders, barcode printing) and a
 * vertical preset must not swap the purchase-order item picker to a
 * restaurant tile menu (plan-critique finding 1).
 *
 * Entries are eager static imports on purpose: today's two views are the
 * app's main chunks either way, and eager registration keeps the chunk
 * graph identical to the pre-registry build. A future heavy vertical view
 * (tile-menu) registers with defineAsyncComponent instead — the registry
 * type takes any Component.
 *
 * The host owns this list (industry research: Shopify/Medusa slot rules —
 * extensions choose FROM it, they never invent keys). Unknown keys fail
 * loudly: resolve* throws instead of silently rendering nothing, so a
 * mistyped preset dies at boot, not at the counter.
 */

const cartViews: Record<string, Component> = {
	"table:pos": Invoice,
};

const itemsViews: Record<string, Component> = {
	"standard:pos": ItemsSelector,
	"standard:purchase": ItemsSelector,
	"standard:barcode": ItemsSelector,
};

const resolve = (
	table: Record<string, Component>,
	axis: string,
	layout: string,
	context: PosViewContext,
): Component => {
	const view = table[`${layout}:${context}`];
	if (!view) {
		throw new Error(
			`[viewRegistry] no ${axis} view registered for layout "${layout}" in context "${context}"`,
		);
	}
	return view;
};

export const resolveCartView = (style: CartStyle, context: PosViewContext): Component =>
	resolve(cartViews, "cart", style, context);

export const resolveItemsView = (style: ItemsPanelStyle, context: PosViewContext): Component =>
	resolve(itemsViews, "items", style, context);

/** Test/inventory hook — the registered keys, not the components. */
export const registeredViewKeys = () => ({
	cart: Object.keys(cartViews),
	items: Object.keys(itemsViews),
});
