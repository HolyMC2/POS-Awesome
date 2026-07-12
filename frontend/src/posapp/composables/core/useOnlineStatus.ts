import { ref, onUnmounted, getCurrentInstance, warn } from "vue";
import type { Ref } from "vue";

// `isOnline` reflects whether the SERVER is actually reachable, not just the
// browser's raw navigator.onLine flag. Sale-critical components (Invoice,
// Customer) gate server writes on this, and raw navigator.onLine reports
// "online" on captive-portal / dead-WiFi where every server call hangs. We fold
// in the probed `window.serverOnline` (owned by useNetwork) and stay reactive
// via the `posa:network-status` event it emits on every transition.
function computeOnline(): boolean {
	const navOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
	// serverOnline is undefined until the first probe; treat only an explicit
	// false as offline so first paint doesn't read offline.
	const serverOnline = (window as any)?.serverOnline;
	return navOnline && serverOnline !== false;
}

// Singleton state
const isOnline: Ref<boolean> = ref(computeOnline());
let listenersCount = 0;

const updateOnlineStatus = () => {
	isOnline.value = computeOnline();
};

export function useOnlineStatus() {
	if (getCurrentInstance()) {
		if (listenersCount === 0) {
			window.addEventListener("online", updateOnlineStatus);
			window.addEventListener("offline", updateOnlineStatus);
			window.addEventListener("posa:network-status", updateOnlineStatus);
		}
		listenersCount++;

		onUnmounted(() => {
			listenersCount = Math.max(0, listenersCount - 1);
			if (listenersCount === 0) {
				window.removeEventListener("online", updateOnlineStatus);
				window.removeEventListener("offline", updateOnlineStatus);
				window.removeEventListener(
					"posa:network-status",
					updateOnlineStatus,
				);
			}
		});
	} else {
		warn(
			"useOnlineStatus must be called inside a component's setup function.",
		);
	}

	return {
		isOnline,
	};
}
