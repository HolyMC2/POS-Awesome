/**
 * Destination registry — what the rail can reach (roadmap §17.7, canvas
 * direction E).
 *
 * The canvas promotes Drafts, Invoices, Returns, Service Orders, Expense and
 * Top-up from DIALOGS to rail destinations. That is a routing change, not a
 * styling one, and this file is where the routing facts live: what a rail id
 * means, what gates it, what it does offline, and which chord reaches it.
 *
 * Three things kept it honest:
 *
 * 1. `offline` is REQUIRED and has no default. Roadmap §7 says every surface
 *    declares whether it is local, queued, cached-read-only or blocked; a
 *    default would let a new destination inherit "fine offline" silently,
 *    which on the saldo path means promising airtime the register cannot buy.
 * 2. `kind` is explicit because the shell genuinely has three mechanisms, and
 *    pretending otherwise would mean forking working components. A `panel` is
 *    a column of the shell (uiStore.activeView); a `sheet` is one of the
 *    existing flows dialogs, hosted; a `route` already has a vue-router entry.
 * 3. Components are lazy. The floor route's comment in router/index.ts sets
 *    the precedent: a register that cannot reach a destination must not fetch
 *    its chunk.
 *
 * Labels are English source strings, resolved through `verticalStore.t()` at
 * render time — never `__()` here. `t()` rather than `__()` because a preset
 * renames these nouns: Explorar becomes Menú and Borradores becomes Cuentas on
 * a cafetería, exactly as Floor already becomes Salón.
 */

import type { RailDestinationId } from "./railDestinations";

/** Offline policy vocabulary — roadmap §7, verbatim. Do not invent a fifth. */
export type OfflinePolicy =
	| "offline_local"
	| "offline_queue"
	| "offline_read"
	| "online_required";

/**
 * How the shell reaches a destination.
 * - `panel` — a selector column already in Pos.vue (uiStore.activeView).
 * - `sheet` — an existing flows dialog or view, hosted full-surface by
 *   DestinationHost, INSIDE `.register-shell` so the rail stays on screen.
 * - `route` — the shell hands off to vue-router and stops owning the screen.
 *
 * `route` is still a real mechanism and still typed, but no destination uses
 * it any more, and `destinationRail.spec.ts` fails BY NAME if one starts to.
 * `expense` and `closing` did, and the owner found what that means: opening
 * Gasto from the rail replaced the whole shell with a standalone page — no
 * rail, no band, and the only way back is the browser. A rail item that
 * removes the rail is a navigation dead end, and §17.7's premise is that the
 * rail IS the desktop navigation.
 *
 * The deep links did NOT go away with the kind, and that was the point worth
 * arguing: `/cash-movement` and `/closing` still exist, are still bookmarkable
 * and still land on the same screen — they now mount the register shell and
 * ask it to open on that destination, exactly as `/floor` has always done for
 * the floor panel. The route keeps every reason it had to exist; it stops
 * being a different screen.
 */
export type DestinationKind = "panel" | "sheet" | "route";

/**
 * Destination ids — IMPORTED, never re-declared.
 *
 * `railDestinations.ts` owns this union. Two copies of an id list is the exact
 * drift the evidence lane cannot survive: the rail stamps `rail-<id>`, this
 * host stamps `destination-<id>`, and a lane that pairs them would still find a
 * selector after a rename and screenshot the wrong screen.
 *
 * They are English while every label is Spanish, and that is the point — the
 * same rule §2 states as "capabilities, not vertical-name conditionals". A
 * cafetería renames Browse to "Menú" through `t()` without any id moving, and
 * the cross-stack tuple (`DOCK_TAB_IDS`, checked against a Python backend) stays
 * one namespace.
 *
 * Note the roadmap §17.6 addendum writes this dock id as `orden`. That is prose
 * illustrating the change, not a code contract; the lead overrode it in favour
 * of `serviceOrder` and recorded the deviation.
 */
export type DestinationId = RailDestinationId;

/**
 * camelCase id → kebab URL segment, applied ONLY at the router boundary.
 *
 * One id namespace inside the app, a display form at the edge. This is not a
 * second id set: nothing looks a destination up by its slug, and `path` below
 * is the authority for routes that already existed (`/cash-movement`,
 * `/closing`, `/floor` all predate the rail and are not ours to rename).
 */
export const slugifyDestinationId = (id: string): string =>
	id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export interface DestinationDef {
	id: DestinationId;
	/** English source string; rendered through verticalStore.t(). */
	labelKey: string;
	kind: DestinationKind;
	/**
	 * Deep-link path, relative to the posapp router base. Every destination has
	 * one — a destination you cannot link to is a destination you cannot put on
	 * a customer display, a kiosk or a support instruction.
	 */
	path: string;
	/**
	 * `verticalStore.has()` key, or null when the destination is universal.
	 * Consumers ask for a capability; they never ask which vertical this is
	 * (verticalStore rule #1).
	 */
	capability: string | null;
	/**
	 * Legacy `posa_*` POS Profile flag OR-ed with the capability, for the
	 * paths that shipped before the capability profile existed. Additive per
	 * plan C3 — the same shape `externalDocumentCheckout` already uses.
	 */
	profileFlag: string | null;
	/** Roadmap §7 policy. Required: silence here is a bug, not a default. */
	offline: OfflinePolicy;
	/** Existing action id from shortcuts/actions.ts, or null if unbound. */
	shortcutActionId: string | null;
	/**
	 * Key on the badge-count context the rail reads, or null for no badge.
	 * Named rather than a closure so the registry stays Vue-free and testable.
	 */
	badgeSource: string | null;
	/** uiStore.activeView value — panels only. */
	panelView?: "items" | "offers" | "coupons" | "floor";
	/**
	 * Who may enter, beyond capability and profile flag. `supervisor` is the
	 * dashboard's existing rule (`requiresSupervisor` on its route, the same
	 * probe the navbar asked before listing it); it lives here so the rail,
	 * the URL and the chord refuse it the same way.
	 */
	access?: "supervisor";
	/**
	 * `page` — a full view that was a route of its own (Payments, Purchase
	 * Orders, Barcode Labels, Gift Cards, Dashboard). It sizes itself to a
	 * page and scrolls, so the host lets it, instead of clipping it to the
	 * flows-sheet discipline of one inner scrollport.
	 */
	surface?: "page";
}

/**
 * Rail order, top to bottom, exactly as the canvas draws it
 * (`design/register-hifi/Main.dc.html`). `corte` sits in the bottom group with
 * the avatar; it is last here because order in this tuple IS the render order.
 */
export const DESTINATIONS: readonly DestinationDef[] = [
	{
		id: "sale",
		labelKey: "Sale",
		kind: "panel",
		path: "/pos",
		capability: null,
		profileFlag: null,
		// The cart is local operator intent until it is tendered — §7 class A.
		offline: "offline_local",
		shortcutActionId: "invoice.showInvoicePanel",
		badgeSource: null,
		panelView: "items",
	},
	{
		id: "browse",
		labelKey: "Browse",
		kind: "panel",
		path: "/pos/browse",
		capability: null,
		profileFlag: null,
		// The catalogue is cached with visible freshness; a register mid-shift
		// browses its Dexie copy without a round trip.
		offline: "offline_read",
		shortcutActionId: "items.focusSearch",
		badgeSource: null,
		panelView: "items",
	},
	{
		id: "floor",
		labelKey: "Floor",
		kind: "panel",
		// Predates the rail: router/index.ts already carries `/floor` with
		// `requiresTables` and `initialView: "floor"`. Not ours to rename.
		path: "/floor",
		capability: "tables",
		profileFlag: null,
		// T1's reading, adopted: offline this is a STALE seating chart, and a
		// stale chart is worse than no chart — it seats a table someone is
		// already sitting at.
		offline: "online_required",
		shortcutActionId: null,
		badgeSource: "floorOpenOrdersCount",
		panelView: "floor",
	},
	{
		id: "serviceOrder",
		labelKey: "Service Order",
		kind: "sheet",
		path: "/pos/service-order",
		// The taller/repair seam. Capability OR the legacy flag, because
		// charge-request tenants shipped before the preset existed.
		capability: "external_document_checkout",
		profileFlag: "posa_use_charge_requests",
		// The order is authored in Taller and pulled here; with no server there
		// is nothing to pull, and inventing one locally would bill work the
		// workshop never recorded.
		offline: "online_required",
		shortcutActionId: "charges.openRequests",
		badgeSource: "serviceOrderOpenCount",
	},
	{
		id: "expense",
		labelKey: "Expense",
		// Hosted, not navigated to. `/cash-movement` predates the rail and is
		// kept — it mounts the shell and opens this sheet.
		kind: "sheet",
		path: "/cash-movement",
		capability: null,
		profileFlag: null,
		// Cash physically left the drawer — §7 class C. The operator's act is
		// real whether or not the server heard about it, so it queues.
		offline: "offline_queue",
		shortcutActionId: "cash.openMovement",
		badgeSource: null,
	},
	{
		id: "drafts",
		labelKey: "Drafts",
		kind: "sheet",
		path: "/pos/drafts",
		capability: null,
		profileFlag: null,
		offline: "offline_read",
		shortcutActionId: "invoice.openDrafts",
		badgeSource: "draftInvoicesCount",
	},
	{
		id: "invoices",
		labelKey: "Invoices",
		kind: "sheet",
		path: "/pos/invoices",
		capability: null,
		profileFlag: null,
		offline: "offline_read",
		shortcutActionId: "invoice.openManagement",
		badgeSource: null,
	},
	{
		id: "return",
		labelKey: "Return",
		kind: "sheet",
		path: "/pos/returns",
		capability: null,
		profileFlag: null,
		// A return moves money back to the customer against a submitted
		// original. Both halves need the server: the original to be found and
		// the credit to be authorised.
		offline: "online_required",
		shortcutActionId: "returns.open",
		badgeSource: null,
	},
	{
		id: "recharge",
		labelKey: "Top-up",
		kind: "sheet",
		path: "/pos/top-up",
		capability: "saldo",
		profileFlag: null,
		// Roadmap §7 names this one explicitly: "saldo/top-up remains
		// online-required". Airtime is bought from a provider in real time;
		// queueing it would promise a customer a recharge nobody purchased.
		offline: "online_required",
		shortcutActionId: "saldo.openRecharge",
		badgeSource: null,
	},
	// ---- the tools group: the hamburger drawer's pages, hosted ------------
	// Each of these had a hand-written route that mounted the page ALONE —
	// no rail, no band, the browser's Back as the only way out — which is the
	// exact trap `route` kind describes above. They keep their paths.
	{
		id: "payments",
		labelKey: "Payments",
		kind: "sheet",
		path: "/payments",
		capability: null,
		profileFlag: null,
		offline: "online_required",
		shortcutActionId: null,
		badgeSource: null,
		surface: "page",
	},
	{
		id: "purchase",
		labelKey: "Purchase Orders",
		kind: "sheet",
		path: "/orders",
		capability: null,
		profileFlag: null,
		offline: "online_required",
		shortcutActionId: null,
		badgeSource: null,
		surface: "page",
	},
	{
		id: "barcode",
		labelKey: "Barcode Labels",
		kind: "sheet",
		path: "/barcode",
		capability: null,
		profileFlag: null,
		offline: "offline_read",
		shortcutActionId: null,
		badgeSource: null,
		surface: "page",
	},
	{
		id: "giftCards",
		labelKey: "Gift Cards",
		kind: "sheet",
		path: "/gift-cards",
		capability: null,
		profileFlag: "posa_use_gift_cards",
		offline: "online_required",
		shortcutActionId: null,
		badgeSource: null,
		surface: "page",
	},
	{
		id: "dashboard",
		labelKey: "Dashboard",
		kind: "sheet",
		path: "/dashboard",
		capability: null,
		profileFlag: null,
		access: "supervisor",
		offline: "online_required",
		shortcutActionId: null,
		badgeSource: null,
		surface: "page",
	},
	{
		id: "closing",
		labelKey: "Close Shift",
		// The canvas draws the corte WITH the rail (`Corte.dc.html` — nine rail
		// items, Corte lit). It is a destination, not a screen of its own, and
		// ClosingDialog was already written for that: it injects
		// DESTINATION_SURFACE to decide who owns the lane.
		kind: "sheet",
		path: "/closing",
		capability: null,
		profileFlag: null,
		// §7: "shift close accounts for all pending writes or blocks with a
		// resolution path". It cannot reconcile against a server it cannot see.
		offline: "online_required",
		shortcutActionId: "shift.close",
		badgeSource: null,
	},
] as const;

export const DESTINATION_IDS = DESTINATIONS.map((d) => d.id) as readonly DestinationId[];

/**
 * Test handles. Both sides of the rail↔destination pair derive their attribute
 * from these two functions, so a renamed id cannot leave the rail and the host
 * pointing at different things — the evidence lane would still find a selector
 * and screenshot the wrong screen, which is the failure mode worth engineering
 * against.
 */
export const railTestId = (id: DestinationId): string => `rail-${id}`;
export const destinationTestId = (id: DestinationId): string => `destination-${id}`;

/**
 * What a test can observe about a destination without knowing any CSS.
 * `offline-blocked` is kept separate from `gated` because they are different
 * problems with different fixes: one waits for the network, the other needs a
 * profile change. A shift that has not opened reports `gated` — it is a gate,
 * and the operator's next move is the same (it cannot be entered).
 */
export type DestinationState = "ready" | "gated" | "offline-blocked";

const BY_ID = new Map<string, DestinationDef>(DESTINATIONS.map((d) => [d.id, d]));
const BY_PATH = new Map<string, DestinationDef>(DESTINATIONS.map((d) => [d.path, d]));

export const getDestination = (id: string): DestinationDef | undefined => BY_ID.get(id);

export const isKnownDestination = (id: string): boolean => BY_ID.has(id);

/**
 * Resolve a URL path to a destination. Exact match first, then the longest
 * registered prefix, so `/pos/drafts/INV-0001` still lands on Borradores
 * rather than falling through to the shell.
 */
export function destinationForPath(path: string): DestinationDef | undefined {
	// Destructured with a default rather than indexed: `noUncheckedIndexedAccess`
	// types `split()[0]` as possibly undefined, and it is the honest reading —
	// nothing about the signature promises a first element.
	const [beforeQuery = ""] = String(path || "").split("?");
	const clean = beforeQuery.replace(/\/+$/, "") || "/";
	const exact = BY_PATH.get(clean);
	if (exact) {
		return exact;
	}
	let best: DestinationDef | undefined;
	for (const def of DESTINATIONS) {
		if (clean.startsWith(`${def.path}/`) && (!best || def.path.length > best.path.length)) {
			best = def;
		}
	}
	return best;
}

/**
 * Lazy component loaders for the `sheet` destinations. Separate from the defs
 * above so the registry itself stays free of dynamic imports and can be
 * imported by a plain node test without a bundler.
 */
export const SHEET_COMPONENTS: Record<string, () => Promise<unknown>> = {
	serviceOrder: () => import("../../../components/navbar/ChargeRequestsDialog.vue"),
	// Borradores and Facturas are ONE component on two tabs. `Drafts.vue` was
	// never a surface: its only act on opening is to close itself and open
	// Invoice Management on the drafts tab, so hosting it put a redirect on
	// screen — a redirect whose target was a floating modal the host could not
	// show. The host mounts the target directly and the surface's
	// `destinationId` picks the tab (see `useHostedSheet` in InvoiceManagement).
	drafts: () => import("../../../components/pos/flows/InvoiceManagement.vue"),
	invoices: () => import("../../../components/pos/flows/InvoiceManagement.vue"),
	"return": () => import("../../../components/pos/flows/Returns.vue"),
	// The designed destination (§12 F), not the catalogue picker. The picker
	// is a two-step modal the cart still opens below the two-column boundary;
	// hosted, it waited for a `modelValue` nobody set and the surface stayed
	// empty. `RecargasDestination` reads, arms the band and hands the line to
	// the cart through the picker's own event — the money path is unchanged.
	recharge: () => import("../../../components/pos/recargas/RecargasDestination.vue"),
	// Not a dialog: `CashMovementView` is a plain view, so it renders straight
	// into the surface with no overlay in between. That is also why it never
	// reached the `useDialogFullscreen` seam and kept its modal-body geometry.
	expense: () => import("../../../components/pos/cash/CashMovementView.vue"),
	closing: () => import("../../../components/pos/shell/ClosingDialog.vue"),
	// Tools: plain views, rendered straight into a scrolling page surface.
	payments: () => import("../../../components/pos/shell/PayView.vue"),
	purchase: () => import("../../../components/pos/purchase/PurchaseOrders.vue"),
	barcode: () => import("../../../components/pos/shell/BarcodePrinting.vue"),
	giftCards: () => import("../../../components/pos/wallet/GiftCardsView.vue"),
	dashboard: () => import("../../../components/reports/Reports.vue"),
};

/**
 * Destinations the shell HOSTS rather than navigates to — i.e. the ones that
 * keep the rail on screen. A `sheet` has a component in `SHEET_COMPONENTS` by
 * definition (the host has nothing to draw otherwise), and that pairing is
 * checked rather than assumed.
 */
export const isHostedDestination = (def: DestinationDef): boolean => def.kind === "sheet";
