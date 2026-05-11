type UpdateStoreLike = {
	initializeFromStorage: () => void;
	setCurrentVersion: (version: string) => void;
	checkForUpdates: (force?: boolean) => unknown;
};

type UseUpdateChecksOptions = {
	updateStore: UpdateStoreLike;
	buildVersion?: string | null;
	intervalMs?: number;
};

const DEFAULT_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function useUpdateChecks({
	updateStore,
	buildVersion,
	intervalMs = DEFAULT_UPDATE_INTERVAL_MS,
}: UseUpdateChecksOptions) {
	let intervalHandle: number | ReturnType<typeof setInterval> | null = null;
	let started = false;

	const startTimer = () => {
		if (intervalHandle !== null) return;
		intervalHandle = window.setInterval(() => {
			void updateStore.checkForUpdates();
		}, intervalMs);
	};
	const stopTimer = () => {
		if (intervalHandle !== null) {
			window.clearInterval(intervalHandle);
			intervalHandle = null;
		}
	};
	const onVisibility = () => {
		if (typeof document === "undefined" || !started) return;
		if (document.hidden) {
			stopTimer();
		} else {
			void updateStore.checkForUpdates();
			startTimer();
		}
	};

	function start() {
		if (started) {
			return;
		}
		started = true;
		updateStore.initializeFromStorage();
		if (buildVersion) {
			updateStore.setCurrentVersion(buildVersion);
		}
		void updateStore.checkForUpdates(true);
		if (typeof document === "undefined" || !document.hidden) {
			startTimer();
		}
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", onVisibility);
		}
	}

	function stop() {
		if (!started) {
			return;
		}
		started = false;
		stopTimer();
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibility);
		}
	}

	return {
		start,
		stop,
	};
}
