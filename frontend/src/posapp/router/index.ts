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
import { useVerticalStore } from "../stores/verticalStore";
import {
	createDestinationGuard,
	type ActivationContext,
} from "../composables/pos/shell/useDestinationRouting";

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

const routes = [
	{ path: "/", redirect: "/pos" },
	{
		path: "/pos",
		component: () => import("../components/pos/shell/Pos.vue"),
		meta: { title: "POS", layout: "default", loadingMessage: "Loading POS..." },
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
		},
	},
	{
		path: "/orders",
		component: () =>
			import("../components/pos/purchase/PurchaseOrders.vue"),
		meta: { title: "Orders", layout: "default", loadingMessage: "Loading orders..." },
	},
	{
		path: "/payments",
		component: () => import("../components/pos/shell/PayView.vue"),
		meta: { title: "Payments", layout: "default", loadingMessage: "Loading payments..." },
	},
	{
		path: "/gift-cards",
		component: () => import("../components/pos/wallet/GiftCardsView.vue"),
		meta: {
			title: "Gift Cards",
			layout: "default",
			loadingMessage: "Loading gift cards...",
		},
	},
	{
		path: "/dashboard",
		component: () => import("@/posapp/components/reports/Reports.vue"),
		meta: {
			title: "Awesome Dashboard",
			layout: "default",
			loadingMessage: "Loading dashboard...",
			requiresSupervisor: true,
		},
	},
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
		path: "/barcode",
		component: () => import("../components/pos/shell/BarcodePrinting.vue"),
		meta: {
			title: "Barcode Printing",
			layout: "default",
			loadingMessage: "Loading barcode printing...",
		},
	},
	{
		path: "/cash-movement",
		component: () => import("../components/pos/cash/CashMovementView.vue"),
		meta: {
			title: "Cash Movement",
			layout: "default",
			loadingMessage: "Loading cash movement...",
		},
	},
	{
		path: "/closing",
		component: () => import("../components/pos/shell/ClosingDialog.vue"),
		meta: {
			title: "Close Shift",
			layout: "default",
			loadingMessage: "Loading close shift...",
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
