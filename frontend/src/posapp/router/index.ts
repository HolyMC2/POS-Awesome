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
