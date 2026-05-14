import { ref, onUnmounted } from "vue";

declare const frappe: any;

export function useDatabaseStats(pollInterval = 10000, windowSize = 60) {
	const dbStats = ref<any>(null);
	const history = ref<any[]>([]);
	const loading = ref(true);
	const error = ref<string | null>(null);
	let timer: number | null = null;

	async function fetchDatabaseStats() {
		loading.value = true;
		error.value = null;
		try {
			const res = await frappe.call({
				method: "posawesome.posawesome.api.utilities.get_database_usage",
			});
			if (res && res.message) {
				dbStats.value = res.message;
				history.value.push(res.message);
				if (history.value.length > windowSize) history.value.shift();
			} else {
				error.value = "No data from server";
			}
		} catch (e: any) {
			error.value = e.message || e;
		} finally {
			loading.value = false;
		}
	}

	const start = () => {
		if (timer !== null) return;
		timer = window.setInterval(fetchDatabaseStats, pollInterval);
	};
	const stop = () => {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	};
	const onVisibility = () => {
		if (typeof document === "undefined") return;
		if (document.hidden) {
			stop();
		} else {
			void fetchDatabaseStats();
			start();
		}
	};

	void fetchDatabaseStats();
	if (typeof document === "undefined" || !document.hidden) {
		start();
	}
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", onVisibility);
	}

	onUnmounted(() => {
		stop();
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibility);
		}
	});

	return { dbStats, history, loading, error };
}
