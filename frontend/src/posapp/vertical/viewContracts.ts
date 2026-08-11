import type { Ref } from "vue";
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

/**
 * Dock tab identifiers the shell knows how to render — the single frontend
 * source of truth. This tuple must equal backend `VALID_DOCK_TABS`
 * (pos_capability_profile.py) in membership AND order; a cross-stack parity
 * test asserts it. A backend-allowed id absent from here renders a blank tab.
 */
export const DOCK_TAB_IDS = ["browse", "offers", "cart", "coupons", "pay"] as const;
export type DockTabId = (typeof DOCK_TAB_IDS)[number];

/** How the shell draws one dock tab. */
export interface DockTabDef {
	icon: string;
	iconSize: number;
	/** Extra class on the tab button. */
	cls?: string;
	/** Render the count pill in its small variant. */
	badgeSm?: boolean;
	badge?: () => number;
	label: () => string;
	ariaLabel: () => string;
	isActive: () => boolean;
	onTap: () => void;
}

/** What the defs below need from the shell's setup() scope. */
export interface DockTabContext {
	__: (key: string) => string;
	offersCount: Ref<number>;
	couponsCount: Ref<number>;
	itemsCount: Ref<number>;
	activeView: Ref<string>;
	compactPanel: Ref<string>;
	isSelectorViewActive: (view: string) => boolean;
	setSelectorView: (view: string) => void;
	showInvoicePanel: () => void;
	triggerInvoicePay: () => void;
}

/**
 * The defs live here rather than in the shell because Pos.vue's `<script>` is
 * plain JS: a `Record<DockTabId, …>` annotation cannot be written there, so an
 * id added to DOCK_TAB_IDS (and to backend VALID_DOCK_TABS) with no def would
 * only surface as a dock tab that silently never renders. Typed here, the same
 * omission fails `vue-tsc` — the third link in the dock-tab chain.
 */
export const buildDockTabDefs = (ctx: DockTabContext): Record<DockTabId, DockTabDef> => ({
	browse: {
		icon: "mdi-magnify",
		iconSize: 20,
		label: () => ctx.__("Browse"),
		ariaLabel: () => ctx.__("Browse"),
		isActive: () => ctx.isSelectorViewActive("items"),
		onTap: () => ctx.setSelectorView("items"),
	},
	offers: {
		icon: "mdi-tag-outline",
		iconSize: 20,
		badgeSm: true,
		badge: () => ctx.offersCount.value,
		label: () => ctx.__("Offers"),
		ariaLabel: () =>
			ctx.offersCount.value ? `${ctx.__("Offers")} — ${ctx.offersCount.value}` : ctx.__("Offers"),
		isActive: () => ctx.activeView.value === "offers",
		onTap: () => ctx.setSelectorView("offers"),
	},
	cart: {
		icon: "mdi-cart-outline",
		iconSize: 22,
		cls: "mobile-dock__tab--cart",
		badge: () => ctx.itemsCount.value,
		label: () => ctx.__("Cart"),
		ariaLabel: () =>
			ctx.itemsCount.value
				? `${ctx.__("Cart")} — ${ctx.itemsCount.value} ${ctx.__("items")}`
				: ctx.__("Cart"),
		isActive: () => ctx.compactPanel.value === "invoice",
		onTap: () => ctx.showInvoicePanel(),
	},
	coupons: {
		icon: "mdi-ticket-percent-outline",
		iconSize: 20,
		badgeSm: true,
		badge: () => ctx.couponsCount.value,
		label: () => ctx.__("Coupons"),
		ariaLabel: () =>
			ctx.couponsCount.value
				? `${ctx.__("Coupons")} — ${ctx.couponsCount.value}`
				: ctx.__("Coupons"),
		isActive: () => ctx.activeView.value === "coupons",
		onTap: () => ctx.setSelectorView("coupons"),
	},
	pay: {
		icon: "mdi-credit-card-outline",
		iconSize: 20,
		cls: "mobile-dock__tab--pay",
		label: () => ctx.__("Pay"),
		ariaLabel: () => ctx.__("Pay"),
		isActive: () => ctx.activeView.value === "payment",
		onTap: () => ctx.triggerInvoicePay(),
	},
});
