import { createRouter, createWebHistory } from "vue-router";
import {
	startRouteLoading,
	stopRouteLoading,
} from "../composables/core/useLoading";
import {
	isDynamicImportFailure,
	recoverFromChunkLoadError,
} from "../utils/chunkLoadRecovery";
import { resolvePosAppRouteFullPath } from "../../loader-utils";
import { getDashboardAccessCached } from "../services/dashboardService";
import OfflineRouteUnavailable from "../components/system/OfflineRouteUnavailable.vue";
import { pinia } from "../stores";
import { useUIStore } from "../stores/uiStore";
import { useEmployeeStore } from "../stores/employeeStore";
import { useVerticalStore } from "../stores/verticalStore";
import {
	createDestinationGuard,
	type ActivationContext,
} from "../composables/pos/shell/useDestinationRouting";
import { DESTINATIONS } from "../composables/pos/shell/destinationRegistry";

const OFFLINE_ROUTE_UNAVAILABLE_NAME = "offline-route-unavailable";

/**
 * Capability gate for the floor route. The preset arrives with the shift-open
 * payload, so before a register has booted there is nothing to ask: let the
 * route through and let the shell drop back to Browse once the capability
 * resolves (Pos.vue watches `floorEnabled`). Refusing early would break a
 * cold-boot deep link into the floor on a genuine restaurant register.
 */
function allowsTableFeatures(): boolean {
	try {
		if (!useUIStore(pinia).capabilityPayload) {
			return true;
		}
		return useVerticalStore(pinia).has("tables");
	} catch {
		return true;
	}
}

/**
 * Has the register booted far enough to be asked a gating question?
 *
 * The capability preset and the shift both arrive with the shift-open payload.
 * Before that lands there is nothing to ask — and asking anyway would refuse
 * EVERY destination, because `shiftOpen` reads false on a register that simply
 * has not answered yet. That would break a cold-boot deep link into
 * `/cash-movement` or `/closing`, both of which work today. Same reasoning the
 * floor route's comment above already records; this is that rule generalised to
 * every destination.
 */
function registerHasBooted(): boolean {
	const ui = useUIStore(pinia);
	return Boolean(ui.capabilityPayload || ui.posOpeningShift);
}

/**
 * Server reachability, matching `useOnlineStatus`'s definition rather than
 * `navigator.onLine`: a captive portal reports "online" while every server call
 * hangs. Recomputed rather than subscribed — a guard runs once per navigation
 * and must not register listeners it can never remove.
 */
function serverReachable(): boolean {
	const navOnline = typeof navigator === "undefined" ? true : navigator.onLine;
	const serverOnline = (window as unknown as { serverOnline?: boolean })
		?.serverOnline;
	return navOnline && serverOnline !== false;
}

function buildActivationContext(): ActivationContext {
	const ui = useUIStore(pinia);
	const vertical = useVerticalStore(pinia);
	return {
		isOnline: serverReachable(),
		shiftOpen: Boolean(ui.posOpeningShift),
		hasCapability: (capability: string) => {
			try {
				return vertical.has(capability);
			} catch {
				return false;
			}
		},
		hasProfileFlag: (flag: string) =>
			Boolean((ui.posProfile as Record<string, unknown> | null)?.[flag]),
		// The synchronous half of the dashboard rule. The server probe
		// (`requiresSupervisor` below) still runs for the dashboard's own
		// route; this answers the rail and the guard without a round trip.
		isSupervisor: Boolean(useEmployeeStore(pinia).currentCashier?.is_supervisor),
	};
}

const destinationGuard = createDestinationGuard(buildActivationContext);

/**
 * Capability gate for rail destinations, applied to the URL.
 *
 * Hiding a rail item while leaving its URL reachable is a gate with a hole in
 * it, and a bookmark, a customer display or a support instruction finds that
 * hole first. Returns the path to redirect to, or null to allow.
 *
 * Two refusals are deliberately NOT made here. Before boot nothing is asked at
 * all (see `registerHasBooted`). And a redirect that lands back on the SAME
 * path is dropped: `/pos` is itself the `sale` destination, so a closed shift
 * would otherwise refuse `/pos`, redirect to `/pos`, and loop the router
 * forever. A register with no shift open belongs on `/pos` looking at the
 * opening dialog, which is exactly where that fallthrough leaves it.
 */
export function resolveDestinationRedirect(path: string): string | null {
	try {
		if (!registerHasBooted()) {
			return null;
		}
		const verdict = destinationGuard(path);
		if (verdict === true) {
			return null;
		}
		const clean = String(path || "").split("?")[0]?.replace(/\/+$/, "") || "/";
		return verdict === clean ? null : verdict;
	} catch {
		// A gate that throws must not strand the cashier on a blank router.
		return null;
	}
}

/**
 * Deep-link routes for rail destinations, generated FROM the registry.
 *
 * Hand-written route entries are how `expense` and `closing` became bare pages
 * in the first place: the registry said "this destination has a path" and the
 * router answered that path with a component that was not the shell, so the
 * rail — the only desktop navigation there is — went with it. Generating them
 * removes the opportunity. A destination added to the registry tomorrow gets a
 * URL that mounts the shell, and there is no place to type the other thing.
 *
 * `/pos` and `/floor` stay hand-written above: `/pos` is the shell itself and
 * must not pay for a wrapper on the hottest route in the product, and `/floor`
 * carries `requiresTables` and the `initialView` the shell already honours.
 */
const HAND_WRITTEN_SHELL_PATHS = new Set(["/pos", "/floor"]);

/**
 * Titles these two routes already carried, kept verbatim. The route title is
 * user-facing (it is the document title), so the conversion moves the strings
 * rather than renaming them; the rest take their existing registry label.
 */
const LEGACY_DESTINATION_ROUTE_META: Record<
	string,
	{ title: string; loadingMessage: string; requiresSupervisor?: true }
> = {
	expense: { title: "Cash Movement", loadingMessage: "Loading cash movement..." },
	closing: { title: "Close Shift", loadingMessage: "Loading close shift..." },
	// The tools group (2026-08-22): five more pages that used to mount alone.
	// Renamed with the surface (COBRANZA_GOLDEN_FLOW): `/payments` opens the
	// collections panel now, and a document title still reading "Payments"
	// would be the one place in the register using the old word.
	payments: { title: "Receivables", loadingMessage: "Loading receivables..." },
	purchase: { title: "Orders", loadingMessage: "Loading orders..." },
	barcode: { title: "Barcode Printing", loadingMessage: "Loading barcode printing..." },
	giftCards: { title: "Gift Cards", loadingMessage: "Loading gift cards..." },
	// The probe-backed refusal the route already had; the rail's gate and the
	// destination guard add the synchronous half (`access: "supervisor"`).
	dashboard: {
		title: "Awesome Dashboard",
		loadingMessage: "Loading dashboard...",
		requiresSupervisor: true,
	},
};

function buildDestinationRoutes() {
	return DESTINATIONS.filter(
		(def) => !HAND_WRITTEN_SHELL_PATHS.has(def.path),
	).map((def) => ({
		path: def.path,
		component: () =>
			import(
				"../components/pos/shell/destinations/DestinationRouteShell.vue"
			),
		meta: {
			// No `loadingMessage` for the generated ones: the existing
			// `resolveRouteLoadingMessage` fallback derives one from the title
			// rather than this file inventing a string per destination.
			title: def.labelKey,
			...LEGACY_DESTINATION_ROUTE_META[def.id],
			layout: "default",
			registerShell: true,
			initialDestination: def.id,
		},
	}));
}

const routes = [
	{ path: "/", redirect: "/pos" },
	{
		path: "/pos",
		component: () => import("../components/pos/shell/Pos.vue"),
		meta: {
			title: "POS",
			layout: "default",
			loadingMessage: "Loading POS...",
			registerShell: true,
			initialDestination: "sale",
		},
	},
	{
		// The floor is a panel of the POS shell, not a screen of its own (spec
		// §1) — this route exists so it can be linked and bookmarked. It mounts
		// the same shell and asks it to open on the floor.
		path: "/floor",
		component: () => import("../components/pos/shell/Pos.vue"),
		meta: {
			title: "Floor",
			layout: "default",
			loadingMessage: "Loading floor...",
			requiresTables: true,
			initialView: "floor",
			registerShell: true,
			initialDestination: "floor",
		},
	},
	// Every other destination's deep link, built FROM the registry — see
	// `buildDestinationRoutes`.
	...buildDestinationRoutes(),
	{
		path: "/reports",
		component: () => import("@/posapp/components/reports/Reports.vue"),
		meta: {
			title: "Reports",
			layout: "default",
			loadingMessage: "Loading reports...",
			requiresSupervisor: true,
		},
	},
	{
		path: "/customer-display",
		component: () =>
			import("../components/customer_display/CustomerDisplay.vue"),
		meta: {
			title: "Customer Display",
			layout: "display",
			loadingMessage: "Loading customer display...",
		},
	},
	{
		// The pickup board (critique D4): the third display-family screen —
		// a wall screen customers READ (never touch) showing which order
		// numbers are ready at the counter. Projects the hub's own scoped
		// queue reads; no new data surface, same no-client-guard reasoning.
		path: "/tablero",
		component: () => import("../components/kiosk/OrderStatusBoard.vue"),
		meta: {
			title: "Tablero",
			layout: "display",
			loadingMessage: "Loading board...",
		},
	},
	{
		// Self-service kiosk (critique D2): a CUSTOMER-facing screen that
		// ends in a numbered «paga en caja» charge request (the D3 hub).
		// Same chrome-free layout and same no-client-guard reasoning as the
		// KDS: the server enforces the kiosk capability on every call, and
		// the view self-gates with its own boot read.
		path: "/kiosko",
		component: () => import("../components/kiosk/KioskView.vue"),
		meta: {
			title: "Kiosko",
			layout: "display",
			loadingMessage: "Loading kiosk...",
		},
	},
	{
		// The kitchen display (critique D1): a station-scoped screen on the
		// bump endpoint, not a register. Same chrome-free layout as the
		// customer display; deliberately NO `requiresTables` client guard —
		// a kitchen tablet boots with no shift and no vertical store, and
		// the server enforces the tables capability on every read and write
		// anyway. The view self-gates: an account with no table-service
		// profile is told so instead of shown an empty pass.
		path: "/kds",
		component: () => import("../components/kds/KdsView.vue"),
		meta: {
			title: "Kitchen Display",
			layout: "display",
			loadingMessage: "Loading kitchen display...",
		},
	},
	{
		path: "/offline-route-unavailable",
		name: OFFLINE_ROUTE_UNAVAILABLE_NAME,
		component: OfflineRouteUnavailable,
		meta: {
			title: "Route Unavailable",
			layout: "default",
			loadingMessage: "Loading route fallback...",
		},
	},
	{
		path: "/:pathMatch(.*)*",
		redirect: "/pos",
	},
];

export function resolveRouteLoadFailureAction({
	error,
	isOnline,
	pendingRouteFullPath,
}: {
	error: unknown;
	isOnline: boolean;
	pendingRouteFullPath?: string | null;
}):
	| { type: "unhandled" }
	| { type: "chunk-recovery" }
	| { type: "offline-fallback"; target: string } {
	if (!isDynamicImportFailure(error)) {
		return { type: "unhandled" };
	}

	if (!isOnline && pendingRouteFullPath) {
		return {
			type: "offline-fallback",
			target: pendingRouteFullPath,
		};
	}

	return { type: "chunk-recovery" };
}

export function resolveRouteLoadingMessage(
	route: { meta?: Record<string, unknown> } | null | undefined,
) {
	const explicitMessage = route?.meta?.loadingMessage;
	if (typeof explicitMessage === "string" && explicitMessage.trim()) {
		return explicitMessage;
	}

	const title = route?.meta?.title;
	if (typeof title === "string" && title.trim()) {
		return `Loading ${title}...`;
	}

	return "Loading view...";
}

// Phase 1 web route mounts the SPA at `/posapp` (no Desk shell).
// Detect from the current pathname so vue-router doesn't immediately
// redirect to its hard-coded `/app/posapp` base and bounce the user
// back into Desk.
function resolvePosAppRouterBase(): string {
	if (typeof window === "undefined") return "/app/posapp";
	const path = window.location.pathname || "";
	if (path === "/posapp" || path.startsWith("/posapp/")) return "/posapp";
	return "/app/posapp";
}

const createPosAppRouter = () => {
	const history = createWebHistory(resolvePosAppRouterBase());
	const router = createRouter({
		history,
		routes,
	});
	let pendingRouteFullPath: string | null = null;

	router.beforeEach((to, _from, next) => {
		pendingRouteFullPath = to.fullPath || "/";
		startRouteLoading({
			message: resolveRouteLoadingMessage(to),
		});
		if (to.meta?.requiresTables && !allowsTableFeatures()) {
			next("/pos");
			return;
		}
		const destinationRedirect = resolveDestinationRedirect(to.path);
		if (destinationRedirect) {
			next(destinationRedirect);
			return;
		}
		if (!to.meta?.requiresSupervisor) {
			next();
			return;
		}
		// Supervisor-only views never render for plain employees — not even
		// as a blocked shell. Probe unreachable (offline): let the view
		// through; the server still refuses the data.
		getDashboardAccessCached()
			.then((result) => {
				if (result?.allowed) {
					next();
				} else {
					next("/pos");
				}
			})
			.catch(() => next());
	});

	router.afterEach(() => {
		pendingRouteFullPath = null;
		stopRouteLoading();
		window.scrollTo(0, 0);
	});

	router.onError((error) => {
		stopRouteLoading();
		const currentWindowRoute =
			typeof window !== "undefined"
				? resolvePosAppRouteFullPath(window.location)
				: null;
		const failureAction = resolveRouteLoadFailureAction({
			error,
			isOnline:
				typeof navigator === "undefined" ? true : navigator.onLine,
			pendingRouteFullPath: pendingRouteFullPath || currentWindowRoute,
		});

		if (failureAction.type === "offline-fallback") {
			const target = failureAction.target;
			console.warn(
				"Route load failed offline; showing unavailable fallback",
				{
					target,
					error,
				},
			);
			void router.replace({
				name: OFFLINE_ROUTE_UNAVAILABLE_NAME,
				query: {
					target,
				},
			});
			return;
		}

		if (failureAction.type === "chunk-recovery") {
			void recoverFromChunkLoadError(error, "router");
		}
	});

	return { router, history };
};

export { createPosAppRouter };
export default createPosAppRouter;
