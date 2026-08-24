/**
 * Rail destination registry — the desktop register's ONLY navigation
 * (roadmap §17.7, direction E: the rail replaces the hamburger drawer).
 *
 * Pure by construction: no Vue import, no store import, no `__()`. The rail
 * has to be reasoned about in tests today and resolved into a per-preset
 * §9.1 artifact later; neither is possible if the list can only be produced
 * by mounting a component.
 *
 * The shape deliberately mirrors `buildDockTabDefs` in
 * `vertical/viewContracts.ts`: the module owns the typed definitions, the
 * shell supplies a context of counts and resolvers. One pattern for both
 * navigations means a destination that exists on the rail AND in the dock is
 * described the same way twice, rather than two ways once.
 *
 * verticalStore's Rule #1 applies here too: an entry names a capability
 * GATE, never a vertical. "Cafetería drops Recarga" is not a branch — it is
 * a preset that does not grant `saldo`. Read `gate` as the question the
 * shell answers, not as a vertical's name.
 */

/**
 * Every destination the rail knows how to draw, in render order.
 *
 * The order is the artboard's and is not alphabetical or grouped by
 * frequency: it walks the sale forward (sell, find, service) and then
 * backward (money out, unfinished, finished, reversed), which is the order a
 * cashier reaches for them. `floor` sits after `browse` because on a
 * cafetería preset — the only preset that grants it — Salón is where the
 * operator goes straight after the menu.
 */
export const RAIL_DESTINATION_IDS = [
	"sale",
	"browse",
	"floor",
	"serviceOrder",
	"expense",
	// Cotizaciones sits with Borradores and Facturas, and BEFORE them, exactly
	// as `Cotizacion.dc.html` draws its rail: the three documents a counter
	// reaches for are ordered by how finished they are — a promise, an
	// unfinished sale, a finished one.
	"quotations",
	"drafts",
	"invoices",
	"return",
	"recharge",
	// The tools group (§17.7 addendum 2026-08-22): the pages the hamburger
	// drawer used to hold. They render behind ONE rail item, "More", because
	// sixteen 66px items do not fit a 900px register — see `RailGroup`.
	"payments",
	"purchase",
	"barcode",
	"giftCards",
	"dashboard",
	"closing",
] as const;

export type RailDestinationId = (typeof RAIL_DESTINATION_IDS)[number];

/**
 * Capability questions the shell answers for the rail. A destination with a
 * null gate is universal; every other destination is absent — not disabled,
 * ABSENT — when its gate is false, because a register that cannot do a thing
 * should not advertise it (§4.2: "what the giro does not use does not
 * appear").
 */
export type RailGate =
	| "floor"
	| "externalDocumentCheckout"
	| "saldo"
	| "closingShift"
	/** `posa_use_gift_cards` on the POS Profile. */
	| "giftCards"
	/** Supervisor access — the same probe the dashboard route already asks. */
	| "dashboard";

export type RailGateMap = Readonly<Record<RailGate, boolean>>;

/**
 * Counts the rail can pin to a badge. Names match the shell's existing count
 * refs where one already exists (`floorOpenOrdersCount` is the dock's), so
 * the two navigations cannot disagree about what a number means.
 */
export type RailBadgeSource =
	| "serviceOrderOpenCount"
	| "floorOpenOrdersCount"
	| "draftInvoicesCount";

/**
 * What this destination is worth while the register is offline (roadmap §7:
 * every surface declares whether it is available, queued, cached-read-only
 * or blocked).
 *
 * - `available`      — works offline with no caveat.
 * - `queued`         — accepts the operator's work and reconciles on
 *                      reconnect through the submission ledger.
 * - `cachedReadOnly` — shows what Dexie already holds; cannot fetch more.
 * - `blocked`        — needs the server to be truthful at all, so the rail
 *                      dims it rather than letting a cashier walk into a
 *                      surface that will lie.
 *
 * VERIFIED 2026-08-22 (wave-3 audit, R4). These values began as design
 * claims — nothing in the app declared offline availability before this
 * module, so there was nothing to check them against. Every one has now been
 * read against the offline layer, and THREE of ten were wrong:
 *
 *   `floor`    blocked → queued   `restaurantQueue.ts` drains table orders,
 *                                 and `floorOrderActions.ts` says an offline
 *                                 order "MUST stay resumable, because a
 *                                 waiter with no signal still has to keep
 *                                 adding to the tab". Dimming Salón told that
 *                                 waiter to stop taking orders.
 *   `drafts`   cachedReadOnly → blocked   nothing caches drafts;
 *                                 `utils/draftInvoices.ts` is a bare
 *                                 `frappe.call`, so the surface opened empty.
 *   `closing`  queued → blocked   `usePosShift.get_closing_data` refuses
 *                                 outright when `isOffline()` — the app
 *                                 itself says "Offline — cannot close shift".
 *                                 Nothing queues a close; `OfflineEntityType`
 *                                 has no closing entity.
 *
 * The asymmetry that made the audit worth running: a wrong `blocked` HIDES a
 * surface that would have worked, and the operator never learns it was there;
 * a wrong `queued` merely fails when tapped, and teaches by disappointment.
 * `floor` was the first kind.
 *
 * KEEPING THEM HONEST: `backedBy` names the module that makes the claim
 * checkable, and `railOfflineClaimsAreBacked()` refuses any `queued` or
 * `cachedReadOnly` without one. A claim with a citation can be re-read
 * against its source in a minute; a claim without one is the state this
 * module shipped in.
 */
export type RailOfflineAvailability = "available" | "queued" | "cachedReadOnly" | "blocked";

/**
 * Where the destination sits in the rail's three groups.
 *
 * `tools` is the one the artboard did not draw (`Riel con herramientas`
 * canvas, 2026-08-22): it renders as a SINGLE rail item — "More" — that opens
 * a flyout listing its members, and while one of them is the active
 * destination that item wears the member's icon and label. The rail never
 * grows past ten items; the register never loses a page it had.
 */
export type RailGroup = "primary" | "tools" | "footer";

export interface RailDestination {
	id: RailDestinationId;
	/**
	 * English source string. The rail wraps it at render time — through the
	 * vertical vocabulary resolver when `vocabulary` is set, through plain
	 * `__()` otherwise. Never translated here: this module must stay free of
	 * the i18n global, the same rule `shortcuts/actions.ts` follows.
	 */
	label: string;
	/**
	 * Resolve the label through `verticalStore.t()` rather than `__()`.
	 * Set only where a preset genuinely renames the noun: "Browse" is "Menú"
	 * on a cafetería and "Floor" has no retail meaning at all. A noun every
	 * giro calls the same thing must NOT go through t(), or the preset label
	 * map becomes a second translation layer.
	 */
	vocabulary?: true;
	icon: string;
	badgeSource: RailBadgeSource | null;
	gate: RailGate | null;
	/**
	 * Action id from `shortcuts/actions.ts` (§17.3). `null` means the
	 * shortcuts engine has no action for this destination yet — an unbound
	 * destination is legal, an INVENTED action id is not, because the cheat
	 * sheet and conflict detection both resolve ids against that registry.
	 */
	shortcutActionId: string | null;
	offlineAvailability: RailOfflineAvailability;
	/**
	 * One line under the label in the tools flyout — what the page is FOR.
	 * English source, translated at render. Only the tools group carries one:
	 * a rail pill has no room for it and the primary destinations need none.
	 */
	hint?: string;
	/**
	 * The module that makes `offlineAvailability` checkable, as a repo path.
	 *
	 * Required for `queued` and `cachedReadOnly` — those two claim the
	 * register keeps working, and a claim of capability has to point at the
	 * code that provides it. `null` is correct for `available` (the sale
	 * queues at submit, not at the destination) and for `blocked` (there is
	 * nothing backing it; that IS the claim).
	 */
	backedBy: string | null;
	group: RailGroup;
}

export const RAIL_DESTINATIONS: readonly RailDestination[] = [
	{
		id: "sale",
		label: "Sale",
		icon: "mdi-point-of-sale",
		badgeSource: null,
		gate: null,
		shortcutActionId: "invoice.showInvoicePanel",
		// The sale is the one surface that must never be dimmed: selling
		// offline is the product promise (§2 "offline is a normal state"),
		// and the queueing happens at submit, not at the destination.
		offlineAvailability: "available",
		backedBy: null,
		group: "primary",
	},
	{
		id: "browse",
		label: "Browse",
		vocabulary: true,
		icon: "mdi-view-grid-outline",
		badgeSource: null,
		gate: null,
		shortcutActionId: "items.focusSearch",
		// The catalogue is served from Dexie; what it cannot do offline is
		// reach past the cache for an item nobody has loaded yet.
		offlineAvailability: "cachedReadOnly",
		backedBy: "src/offline/cache.ts",
		group: "primary",
	},
	{
		id: "floor",
		label: "Floor",
		vocabulary: true,
		icon: "mdi-table-furniture",
		badgeSource: "floorOpenOrdersCount",
		gate: "floor",
		shortcutActionId: null,
		// CORRECTED 2026-08-22 (R4): was `blocked`, on the reasoning that a
		// stale seating chart is worse than no chart. The code disagrees, and
		// it is explicit about it — `floorOrderActions.ts` refuses only a
		// SETTLING order and says why: "an ordinary offline order carries
		// `pending_sync` too and MUST stay resumable, because a waiter with no
		// signal still has to keep adding to the tab." Dimming Salón told that
		// waiter table service was unavailable while the queue underneath was
		// ready to accept every order.
		offlineAvailability: "queued",
		backedBy: "src/offline/restaurantQueue.ts",
		group: "primary",
	},
	{
		id: "serviceOrder",
		label: "Service Order",
		icon: "mdi-wrench-outline",
		badgeSource: "serviceOrderOpenCount",
		gate: "externalDocumentCheckout",
		shortcutActionId: "charges.openRequests",
		// The order is created in Taller and pulled here as a Charge Request;
		// there is nothing local to pull from.
		//
		// NOT the same thing as `service_order_capture` in
		// `shell/mobile/offlineSurfaceManifest.ts`, which IS queued. That one
		// is Taller capturing a new order with photos; this one is the POS
		// READING an existing Charge Request off the server. Same words, two
		// directions of travel — see that file's note before "reconciling"
		// them, because both values are correct.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "primary",
	},
	{
		id: "expense",
		label: "Expense",
		icon: "mdi-cash-minus",
		badgeSource: null,
		gate: null,
		shortcutActionId: "cash.openMovement",
		// A cash movement is the operator's own statement about their own
		// drawer, so it can be taken now and reconciled later.
		offlineAvailability: "queued",
		backedBy: "src/offline/cash_movements.ts",
		group: "primary",
	},
	{
		id: "quotations",
		label: "Quotations",
		icon: "mdi-file-document-edit-outline",
		badgeSource: null,
		// NOT gated, and that is a deliberate deviation from the POS Profile
		// flag `custom_allow_create_quotation` which hides the old Drafts
		// «Quote» tab. A `RailGate` is answered by `Pos.vue`'s `railGates`
		// literal, and a gate the shell does not answer reads `undefined` —
		// i.e. the destination vanishes from every register. Adding the gate
		// and the shell's answer has to land in one commit; until it does, a
		// universal entry that refuses server-side (`_assert_quotation_flow_allowed`
		// on all four endpoints) is honest, while a hidden one would be dead.
		gate: null,
		// Unbound, like `floor`. An action id here would have to be bound in
		// `MUELLE_DEFAULT` *and* implemented in `invoiceShortcuts.ts`, which
		// `shortcutsEngine.spec.ts` checks by name — see the report's note on
		// `invoice.saveQuotation`.
		shortcutActionId: null,
		// A folio is a server fact: the list, the estado and the conversion
		// link all come from it, and a cached copy would show a quotation as
		// Vigente after someone else billed it.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "primary",
	},
	{
		id: "drafts",
		label: "Drafts",
		icon: "mdi-file-document-outline",
		badgeSource: "draftInvoicesCount",
		gate: null,
		shortcutActionId: "invoice.openDrafts",
		// CORRECTED 2026-08-22 (R4): was `cachedReadOnly`, which promises a
		// cache that does not exist. `utils/draftInvoices.ts` is a bare
		// `frappe.call` to `get_draft_invoices` with no Dexie fallback, and
		// Dexie holds no drafts table (`draft_review` is an unresolved SALE
		// payload, a different thing). Offline the surface opened empty, so
		// the rail stayed lit and the cashier learned by disappointment.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "primary",
	},
	{
		id: "invoices",
		label: "Invoices",
		icon: "mdi-receipt-text-outline",
		badgeSource: null,
		gate: null,
		shortcutActionId: "invoice.openManagement",
		// Submitted invoices live on the server; an offline list would be
		// missing exactly the ones a cashier is looking for.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "primary",
	},
	{
		id: "return",
		label: "Return",
		icon: "mdi-backup-restore",
		badgeSource: null,
		gate: null,
		shortcutActionId: "returns.open",
		// Every return route in §5.4 starts by finding an original — by
		// ticket, item, customer or serial — and that lookup is server-side.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "primary",
	},
	{
		id: "recharge",
		label: "Recharge",
		icon: "mdi-signal-variant",
		badgeSource: null,
		gate: "saldo",
		shortcutActionId: "saldo.openRecharge",
		// Air time is a live third-party authorisation. This is the same
		// language the mobile dock already uses when it dims Cupones.
		offlineAvailability: "blocked",
		backedBy: null,
		// Primary, not footer: the artboard's spacer sits BELOW Recarga.
		// Selling air time is selling; only the session controls go bottom.
		group: "primary",
	},
	{
		id: "payments",
		label: "Payments",
		icon: "mdi-credit-card-outline",
		badgeSource: null,
		gate: null,
		shortcutActionId: null,
		// Receiving a payment against an outstanding invoice needs the
		// invoice's live balance; there is nothing local to settle against.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "tools",
		hint: "Collect against open invoices",
	},
	{
		id: "purchase",
		label: "Purchase Orders",
		icon: "mdi-cart-plus",
		badgeSource: null,
		gate: null,
		shortcutActionId: null,
		// A purchase order is submitted to the server as it is built.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "tools",
		hint: "Orders to suppliers",
	},
	{
		id: "barcode",
		label: "Barcode Labels",
		icon: "mdi-barcode",
		badgeSource: null,
		gate: null,
		shortcutActionId: null,
		// Labels are laid out from the cached catalogue and printed through
		// QZ, which is local; what it cannot do offline is find an item the
		// cache never loaded.
		offlineAvailability: "cachedReadOnly",
		backedBy: "src/offline/cache.ts",
		group: "tools",
		hint: "Print labels from the catalogue",
	},
	{
		id: "giftCards",
		label: "Gift Cards",
		icon: "mdi-wallet-giftcard",
		badgeSource: null,
		gate: "giftCards",
		shortcutActionId: null,
		// A balance is a server fact; a card issued offline would be a card
		// nobody can redeem.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "tools",
		hint: "Balance, issue and top up",
	},
	{
		id: "dashboard",
		label: "Dashboard",
		icon: "mdi-view-dashboard-outline",
		badgeSource: null,
		gate: "dashboard",
		shortcutActionId: null,
		offlineAvailability: "blocked",
		backedBy: null,
		group: "tools",
		hint: "Today, the shift and each cashier",
	},
	{
		id: "closing",
		label: "Close Shift",
		icon: "mdi-finance",
		badgeSource: null,
		gate: "closingShift",
		shortcutActionId: "shift.close",
		// CORRECTED 2026-08-22 (R4): was `queued`, on the reasoning that
		// counting is local arithmetic and only the post waits. Neither half
		// survives contact with the code. `usePosShift.get_closing_data`
		// refuses BEFORE the count even opens — `if (isOffline())` shows
		// "Offline — cannot close shift · Reconnect before closing so every
		// sale is accounted for" — and nothing queues a close: the
		// `OfflineEntityType` union is invoice | customer | payment |
		// cash_movement | restaurant_order, with no closing entity.
		//
		// It refuses for a good reason worth keeping visible: unsynced offline
		// sales belong in THIS shift's corte, and the server rejects a post
		// into a closed shift, so closing early would dead-letter them.
		offlineAvailability: "blocked",
		backedBy: null,
		group: "footer",
	},
] as const;

/**
 * Narrow an arbitrary string to a rail destination id.
 *
 * Exported for the destination router (T4): a URL segment, a persisted
 * preference or a shortcut payload arrives as `string` and has to be checked
 * against THIS list. Importing the guard is what keeps the id vocabulary in
 * one file instead of three hand-kept copies.
 */
export const isRailDestinationId = (value: string): value is RailDestinationId =>
	(RAIL_DESTINATION_IDS as readonly string[]).includes(value);

/**
 * The `data-offline` attribute vocabulary, for tests and audits that read
 * state without knowing the CSS. Emitted verbatim from
 * `RailOfflineAvailability` so the attribute and the type cannot drift.
 */
export const RAIL_OFFLINE_ATTR_VALUES: readonly RailOfflineAvailability[] = [
	"available",
	"queued",
	"cachedReadOnly",
	"blocked",
] as const;

// Keyed as plain string on purpose: `getRailDestination` takes whatever the
// shell has (a URL segment, a persisted preference) and must MISS cleanly
// rather than force every caller to prove the id is valid first.
const BY_ID = new Map<string, RailDestination>(
	RAIL_DESTINATIONS.map((destination) => [destination.id, destination]),
);

export const getRailDestination = (id: string): RailDestination | undefined => BY_ID.get(id);

/**
 * The destinations this register actually has, in render order.
 *
 * Absent, not disabled: a gate that is false removes the entry entirely, so
 * a carnicería's rail has no Recarga to explain and a retail register has no
 * Salón. The only thing that DISABLES the whole rail is a closed shift, and
 * that is the rail component's state, not this filter's.
 */
export const visibleRailDestinations = (gates: RailGateMap): readonly RailDestination[] =>
	RAIL_DESTINATIONS.filter((destination) => destination.gate === null || gates[destination.gate]);

/** Destinations in one group, in render order. */
export const railDestinationsInGroup = (
	destinations: readonly RailDestination[],
	group: RailGroup,
): readonly RailDestination[] => destinations.filter((destination) => destination.group === group);

/**
 * Whether the rail should dim this destination while the register is
 * offline. Only `blocked` dims: a queued or cached surface still does useful
 * work, and dimming it would teach cashiers that the amber dot means
 * "probably broken" rather than "needs signal".
 */
export const isOfflineBlocked = (destination: RailDestination): boolean =>
	destination.offlineAvailability === "blocked";

/**
 * Availability values that assert the register KEEPS WORKING offline, and
 * therefore have to name the code that makes that true.
 *
 * `available` and `blocked` are exempt for opposite reasons: `available` is
 * backed by the submit path rather than by the destination, and `blocked`
 * asserts that nothing backs it, which is not a claim anyone can check a
 * module against.
 */
const CLAIMS_NEEDING_EVIDENCE: readonly RailOfflineAvailability[] = ["queued", "cachedReadOnly"];

export interface UnbackedRailClaim {
	id: RailDestinationId;
	offlineAvailability: RailOfflineAvailability;
}

/**
 * Destinations claiming offline capability without naming the module behind
 * it — the exact state this registry shipped in, where three of ten values
 * were wrong and nothing could tell you which.
 *
 * A test asserts this is empty. That is deliberately a weak guarantee: it
 * proves a citation EXISTS, not that the citation is true. Checking the
 * second still takes a person reading the named module — but a wrong claim
 * with a citation is one file away from being caught, and a wrong claim
 * without one is invisible.
 */
export const unbackedRailOfflineClaims = (
	destinations: readonly RailDestination[] = RAIL_DESTINATIONS,
): UnbackedRailClaim[] =>
	destinations
		.filter(
			(destination) =>
				CLAIMS_NEEDING_EVIDENCE.includes(destination.offlineAvailability) &&
				!destination.backedBy,
		)
		.map(({ id, offlineAvailability }) => ({ id, offlineAvailability }));
