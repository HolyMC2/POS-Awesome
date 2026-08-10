import type { Events } from "../bus";

/**
 * View contracts for the vertical registry (VERTICAL_PROFILES_PLAN.md M2).
 *
 * A "view" is a whole panel the shell mounts by layout key — not a widget.
 * The shell talks to views ONLY through:
 *   1. pinia stores (invoiceStore/uiStore/itemsStore/verticalStore), and
 *   2. the typed event bus (bus.ts `Events`).
 * There is no template ref into a view instance — that was removed in
 * b7701f835 and must not come back: a missing member on a swapped view
 * fails silently through optional chaining.
 *
 * TypeScript cannot force an Options-API component to *handle* an event,
 * so the contract is expressed as typed EVENT LISTS checked against the
 * bus map: rename or remove an event and these constants stop compiling,
 * pointing at every view that must follow.
 */

/** Events every CART view must handle (shell → panel requests). */
export const CART_VIEW_REQUIRED_EVENTS = [
	"open_customer_details",
	"request_invoice_payment",
	"recalc_additional_discount",
	"add_item",
	"clear_invoice",
	"load_return_invoice",
	"set_new_line",
	"focus_cart_item_qty",
] as const satisfies readonly (keyof Events)[];

/**
 * Store state every CART view must publish while mounted
 * (invoiceStore.publishDerivedTotals) — the dock total and the return
 * discount display read these; a view that never publishes leaves the
 * shell on fallback totals.
 */
export const CART_VIEW_PUBLISHED_STATE = [
	"liveSubtotal",
	"returnDiscountMeta",
	"discountPercentageOfferName",
] as const;

/** Events every ITEMS view must handle. */
export const ITEMS_VIEW_REQUIRED_EVENTS = [
	"focus_item_search",
	"set_all_items",
	"update_currency",
	"update_customer_price_list",
	"cart_quantities_updated",
	"remote_stock_adjustment",
] as const satisfies readonly (keyof Events)[];

/** Mount contexts an items view can be registered for. */
export type PosViewContext = "pos" | "purchase" | "barcode";

/** Layout axes the registry is keyed on (values live in the capability profile). */
export type CartStyle = "table";
export type ItemsPanelStyle = "standard";

/** Dock tab identifiers the shell knows how to render. */
export type DockTabId = "browse" | "offers" | "cart" | "coupons" | "pay";
