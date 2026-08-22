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
 * - `sheet` — an existing flows dialog, hosted full-surface by DestinationHost.
 * - `route` — already has its own vue-router entry; navigate to it.
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
		kind: "route",
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
	{
		id: "closing",
		labelKey: "Close Shift",
		kind: "route",
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
	drafts: () => import("../../../components/pos/flows/Drafts.vue"),
	invoices: () => import("../../../components/pos/flows/InvoiceManagement.vue"),
	"return": () => import("../../../components/pos/flows/Returns.vue"),
	recharge: () => import("@saldo/SaldoCatalogPicker.vue"),
};
