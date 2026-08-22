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
 *
 * APPEND, never insert. The parity test pins ORDER as well as membership, and
 * a preset stores its tabs as a CSV of these ids — so inserting in the middle
 * silently reorders every dock already configured in the field. `serviceOrder`
 * is last for that reason, not because it matters least.
 *
 * Ids are English and stay English, even where the roadmap prose says «orden»:
 * they share one namespace with the rail's destination ids, and a single
 * Spanish identifier inside a tuple a Python parity test spans would be the odd
 * one out forever. Operator-facing wording is a separate concern — see `t()`.
 */
export const DOCK_TAB_IDS = [
	"browse",
	"offers",
	"cart",
	"coupons",
	"pay",
	"floor",
	"serviceOrder",
] as const;
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
	/** Tab is waiting on a round-trip it already started — draw it busy and
	 * refuse further taps. Absent means the tab is never busy. */
	busy?: () => boolean;
	/**
	 * The tab cannot do its job without the server, so it dims while offline
	 * (§7: every surface declares its offline availability). Absent means the
	 * tab works offline — which is the default here, because the register's
	 * whole point is that it keeps selling on a dead network.
	 *
	 * Only `coupons` sets it: a coupon is REDEEMED against the server, so an
	 * offline tap could only promise a discount the sale may not honour.
	 * Offers stay live beside it because they are cached rules the register
	 * already holds — the visual difference between the two is the honest one.
	 */
	needsSignal?: boolean;
	onTap: () => void;
}

/**
 * Should this tab render dimmed right now?
 *
 * Lives here rather than in the shell template so the rule is unit-testable
 * and stays next to the `needsSignal` flag it reads. The dock itself never
 * disappears offline and no tab is removed: the artboard's note is "el dock no
 * miente" — what needs signal dims, everything else stays exactly where the
 * cashier's thumb left it.
 */
export const isDockTabDimmedOffline = (
	tab: Pick<DockTabDef, "needsSignal">,
	isOnline: boolean,
): boolean => !isOnline && tab.needsSignal === true;

/** What the defs below need from the shell's setup() scope. */
export interface DockTabContext {
	__: (key: string) => string;
	/**
	 * Vertical vocabulary resolver (`verticalStore.t`). Falls back to `__()`
	 * when the preset overrides nothing, so routing a label through it costs a
	 * retail register exactly nothing.
	 *
	 * Every dock label that names a DESTINATION goes through it, because the
	 * rail names the same destinations through the same resolver — and a
	 * register that says "Menú" on the rail and "Buscar" in the dock is one
	 * register telling the cashier two different things. The reference canvas
	 * renames three of them on the cafetería preset: Buscar → Menú,
	 * Carrito → Cuenta, Floor → Salón.
	 *
	 * `Offers`, `Coupons` and `Pay` deliberately stay on plain `__()`: they
	 * name MECHANISMS, not vertical nouns, and the canvas draws them
	 * identically on every preset — retail, cafetería and salón alike.
	 */
	t: (key: string) => string;
	offersCount: Ref<number>;
	couponsCount: Ref<number>;
	itemsCount: Ref<number>;
	/** Open table orders on the register's floors — the floor tab's badge. */
	floorOpenOrdersCount: Ref<number>;
	/**
	 * Service orders still owed to this register — the `serviceOrder` tab's
	 * badge. Same question as the floor badge ("is anything still owed to
	 * me?"), asked of the repair counter instead of the dining room.
	 *
	 * Declared required so any TypeScript caller is forced to supply it, but
	 * read defensively below: Pos.vue's `<script>` is plain JS, so an unwired
	 * shell would sail past `vue-tsc` and only fail at the counter, on the one
	 * preset that names this tab.
	 */
	serviceOrderOpenCount: Ref<number>;
	activeView: Ref<string>;
	compactPanel: Ref<string>;
	paymentPending: Ref<boolean>;
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
const warnedMissingCounts = new Set<string>();

/**
 * Read a count the shell may not have wired yet.
 *
 * `buildDockTabDefs` is called from Pos.vue, whose script block is plain JS, so
 * a missing context field is invisible to `vue-tsc` — the one hole in the
 * three-link chain. A bare `ctx.serviceOrderOpenCount.value` would then throw inside
 * a render, taking the whole dock down with it, and only for the preset that
 * names the tab. Degrade to 0 (a tab with no badge, still tappable) and shout
 * once in dev, matching the `[dock]` warning Pos.vue already emits for a
 * preset id with no def.
 */
const countOf = (source: Ref<number> | undefined, id: string): number => {
	if (source) return source.value;
	if (import.meta.env.DEV && !warnedMissingCounts.has(id)) {
		warnedMissingCounts.add(id);
		console.warn(
			`[dock] tab "${id}" has no count wired into DockTabContext — badge suppressed`,
		);
	}
	return 0;
};

export const buildDockTabDefs = (ctx: DockTabContext): Record<DockTabId, DockTabDef> => ({
	browse: {
		icon: "mdi-magnify",
		iconSize: 20,
		// Renameable: "Buscar" at a retail counter, "Menú" on a cafetería — the
		// same swap the rail makes, through the same resolver, so one register
		// never calls one destination two things.
		label: () => ctx.t("Browse"),
		ariaLabel: () => ctx.t("Browse"),
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
		// Renameable: a restaurant's cart is the diner's "Cuenta", which is the
		// motivating example in verticalStore's own doc comment. The unit
		// ("items") stays a plain translation — it is a count, not a noun the
		// giro owns.
		label: () => ctx.t("Cart"),
		ariaLabel: () =>
			ctx.itemsCount.value
				? `${ctx.t("Cart")} — ${ctx.itemsCount.value} ${ctx.__("items")}`
				: ctx.t("Cart"),
		isActive: () => ctx.compactPanel.value === "invoice",
		onTap: () => ctx.showInvoicePanel(),
	},
	coupons: {
		icon: "mdi-ticket-percent-outline",
		iconSize: 20,
		badgeSm: true,
		// Redeemed server-side, so it is the one dock tab that genuinely cannot
		// work on a dead network. See `needsSignal`.
		needsSignal: true,
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
		// The Pay round-trip is the one dock action with no instant local
		// effect, so it says out loud that it is working — otherwise the
		// silence reads as a dead button and invites a second tap.
		ariaLabel: () =>
			ctx.paymentPending.value ? `${ctx.__("Pay")} — ${ctx.__("Processing")}` : ctx.__("Pay"),
		isActive: () => ctx.activeView.value === "payment",
		busy: () => ctx.paymentPending.value,
		onTap: () => ctx.triggerInvoicePay(),
	},
	floor: {
		icon: "mdi-table-furniture",
		iconSize: 20,
		badgeSm: true,
		// Open orders across the register's floors, not the active floor: the
		// badge answers "is anything still owed to me?", which a floor switch
		// must not change.
		badge: () => ctx.floorOpenOrdersCount.value,
		label: () => ctx.t("Floor"),
		ariaLabel: () =>
			ctx.floorOpenOrdersCount.value
				? `${ctx.t("Floor")} — ${ctx.floorOpenOrdersCount.value}`
				: ctx.t("Floor"),
		isActive: () => ctx.activeView.value === "floor",
		onTap: () => ctx.setSelectorView("floor"),
	},
	serviceOrder: {
		icon: "mdi-wrench-outline",
		iconSize: 20,
		badgeSm: true,
		// Service orders still owed to this register, not the ones shown in the
		// current filter — same reasoning as the floor badge: the badge answers
		// "is anything still owed to me?", and a filter change must not move it.
		badge: () => countOf(ctx.serviceOrderOpenCount, "serviceOrder"),
		// Renameable like "Floor": a repair counter says "Órdenes de servicio",
		// and a retail register that never enables this tab has no word for it.
		label: () => ctx.t("Service Orders"),
		ariaLabel: () => {
			const count = countOf(ctx.serviceOrderOpenCount, "serviceOrder");
			return count
				? `${ctx.t("Service Orders")} — ${count}`
				: ctx.t("Service Orders");
		},
		isActive: () => ctx.activeView.value === "serviceOrder",
		onTap: () => ctx.setSelectorView("serviceOrder"),
	},
});
