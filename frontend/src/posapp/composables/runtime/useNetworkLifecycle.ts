import type { Ref } from "vue";
import { watch } from "vue";

type EventBusLike = {
	emit?: (event: string, ...args: any[]) => void;
};

type RealtimeLike = {
	on?: (event: string, handler: (...args: any[]) => void) => void;
	off?: (event: string, handler?: (...args: any[]) => void) => void;
};

type UseNetworkLifecycleOptions = {
	networkOnline: Ref<boolean>;
	serverOnline: Ref<boolean>;
	serverConnecting: Ref<boolean>;
	internetReachable: Ref<boolean>;
	isIpHost?: Ref<boolean>;
	eventBus?: EventBusLike | null;
	realtime?: RealtimeLike | null;
	isManualOffline: () => boolean;
	onSyncInvoices?: () => void | Promise<void>;
	onConnectivityRecovered?: () => void | Promise<void>;
	onEvaluateBootstrap?: (options?: { allowPrompt?: boolean }) => void;
	onRefreshTaxInclusive?: () => void | Promise<void>;
	checkNetworkConnectivity?: (options?: {
		forceImmediate?: boolean;
	}) => Promise<void>;
};

// How often to fall back to the HTTP prober while the realtime socket is not
// connected. The socket is the fast-path serverOnline signal, but it must not
// be the ONLY one: on the /posapp web mount (or any socket auth/transport
// failure) the socket never connects while HTTP is perfectly healthy — which
// left serverOnline false forever, the "Server Offline / Limited" badge stuck
// on, and the offline guard refusing cart adds (found live on demo.lab
// 2026-07-28; the pre-refactor useNetwork probe loop had been orphaned).
export const SOCKETLESS_HTTP_PROBE_INTERVAL_MS = 20_000;

export function useNetworkLifecycle(options: UseNetworkLifecycleOptions) {
	let started = false;
	let stopWatchers: Array<() => void> = [];
	let socketlessProbeTimer: ReturnType<typeof setInterval> | null = null;
	const realtimeHandlers: Array<[string, (...args: any[]) => void]> = [];

	const networkProxy = {
		get networkOnline() {
			return options.networkOnline.value;
		},
		set networkOnline(value) {
			options.networkOnline.value = Boolean(value);
		},
		get serverOnline() {
			return options.serverOnline.value;
		},
		set serverOnline(value) {
			options.serverOnline.value = Boolean(value);
		},
		get serverConnecting() {
			return options.serverConnecting.value;
		},
		set serverConnecting(value) {
			options.serverConnecting.value = Boolean(value);
		},
		get internetReachable() {
			return options.internetReachable.value;
		},
		set internetReachable(value) {
			options.internetReachable.value = Boolean(value);
		},
		get isIpHost() {
			return options.isIpHost?.value || false;
		},
		set isIpHost(value) {
			if (options.isIpHost) {
				options.isIpHost.value = Boolean(value);
			}
		},
		onConnectivityRecovered: async () => {
			await options.onConnectivityRecovered?.();
		},
		$forceUpdate: () => {},
		checkNetworkConnectivity: async (checkOptions = {}) => {
			if (options.checkNetworkConnectivity) {
				await options.checkNetworkConnectivity(checkOptions);
				return;
			}
			const { checkNetworkConnectivity: utilsCheckNetworkConnectivity } =
				await import("../core/useNetwork");
			await utilsCheckNetworkConnectivity.call(
				networkProxy as any,
				checkOptions,
			);
		},
	};

	const handleOnline = () => {
		if (options.isManualOffline()) {
			return;
		}
		const wasOnline = options.networkOnline.value;
		options.networkOnline.value = true;
		options.internetReachable.value = true;
		void networkProxy.checkNetworkConnectivity();
		if (!wasOnline) {
			void options.onConnectivityRecovered?.();
		}
	};

	const handleOffline = () => {
		if (options.isManualOffline()) {
			return;
		}
		options.networkOnline.value = false;
		options.internetReachable.value = false;
		options.serverOnline.value = false;
		(window as any).serverOnline = false;
	};

	const handleVisibilityChange = () => {
		if (
			!document.hidden &&
			navigator.onLine &&
			!options.isManualOffline()
		) {
			void networkProxy.checkNetworkConnectivity();
		}
	};

	function registerRealtime(
		event: string,
		handler: (...args: any[]) => void,
	) {
		options.realtime?.on?.(event, handler);
		realtimeHandlers.push([event, handler]);
	}

	function start() {
		if (started) {
			return;
		}
		started = true;
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		stopWatchers = [
			watch(options.networkOnline, (newVal, oldVal) => {
				if (newVal && !oldVal) {
					void options.onRefreshTaxInclusive?.();
					options.eventBus?.emit?.("network-online");
					void options.onSyncInvoices?.();
					options.onEvaluateBootstrap?.({ allowPrompt: false });
				}
			}),
			watch(options.serverOnline, (newVal, oldVal) => {
				if (newVal && !oldVal) {
					options.eventBus?.emit?.("server-online");
					void options.onSyncInvoices?.();
					options.onEvaluateBootstrap?.({ allowPrompt: false });
				}
			}),
		];

		// Seed from the underlying socket's current state. The realtime
		// transport often connects before this composable mounts (Frappe's
		// frappe.realtime is initialised by the desk shell, our SPA boots
		// after); a late `connect` listener never sees the initial event
		// and `serverOnline` stays undefined indefinitely, leaving the
		// "Limited connectivity" banner stuck on.
		const seedSocket = (options.realtime as any)?.socket;
		if (seedSocket?.connected) {
			options.serverOnline.value = true;
			(window as any).serverOnline = true;
			options.serverConnecting.value = false;
		} else if (!options.isManualOffline()) {
			// No connected socket at start — establish server reachability
			// over HTTP instead of waiting on a connect event that may never
			// fire (web mount, socket auth failure, proxy without websocket).
			void networkProxy.checkNetworkConnectivity({
				forceImmediate: true,
			});
		}

		socketlessProbeTimer = setInterval(() => {
			const sock = (options.realtime as any)?.socket;
			if (sock?.connected || options.isManualOffline()) {
				return;
			}
			void networkProxy.checkNetworkConnectivity();
		}, SOCKETLESS_HTTP_PROBE_INTERVAL_MS);

		registerRealtime("connect", () => {
			options.serverOnline.value = true;
			(window as any).serverOnline = true;
			options.serverConnecting.value = false;
		});
		registerRealtime("disconnect", () => {
			options.serverOnline.value = false;
			(window as any).serverOnline = false;
			options.serverConnecting.value = false;
			// The socket dying does not mean the server is down — re-verify
			// over HTTP so a healthy backend flips serverOnline right back.
			if (!options.isManualOffline()) {
				void networkProxy.checkNetworkConnectivity();
			}
		});
		registerRealtime("connecting", () => {
			options.serverConnecting.value = true;
		});
		registerRealtime("reconnect", () => {
			(window as any).serverOnline = true;
			void options.onConnectivityRecovered?.();
		});
	}

	function stop() {
		if (!started) {
			return;
		}
		started = false;
		if (socketlessProbeTimer) {
			clearInterval(socketlessProbeTimer);
			socketlessProbeTimer = null;
		}
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
		document.removeEventListener(
			"visibilitychange",
			handleVisibilityChange,
		);
		stopWatchers.forEach((stopWatcher) => stopWatcher());
		stopWatchers = [];
		realtimeHandlers.splice(0).forEach(([event, handler]) => {
			options.realtime?.off?.(event, handler);
		});
	}

	async function retry() {
		const { manualNetworkRetry } = await import("../core/useNetwork");
		await manualNetworkRetry(networkProxy as any);
	}

	return {
		start,
		stop,
		retry,
		networkProxy,
		options,
	};
}
