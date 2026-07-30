/**
 * One print-health instance for the whole POS session.
 *
 * The navbar dot, the health dialog and the setup wizard must agree — a dot
 * that says green while the dialog it opens says red is worse than no dot at
 * all. `usePrintHealth` builds fresh reactive state per call (which is what
 * makes it testable), so the app-facing surfaces share this singleton
 * instead of each constructing their own.
 *
 * Also owns the run cadence: once after the QZ connect attempt on boot, then
 * a cheap re-check every 10 minutes. The re-check reads state only — it
 * never prints and never downloads.
 */
import { useUIStore } from "../../stores/uiStore";
import {
	RECHECK_INTERVAL_MS,
	usePrintHealth,
	type PrintHealth,
	type PrintHealthDeps,
} from "./usePrintHealth";

let instance: PrintHealth | null = null;
let recheckTimer: ReturnType<typeof setInterval> | null = null;

function profilePinnedPrinter(): string {
	try {
		const uiStore = useUIStore();
		const profile: any =
			uiStore?.posProfile && typeof uiStore.posProfile === "object" && "value" in uiStore.posProfile
				? (uiStore.posProfile as any).value
				: uiStore?.posProfile;
		const value = profile?.posa_qz_printer_name;
		return typeof value === "string" ? value.trim() : "";
	} catch {
		// Pinia not initialised outside an app context.
		return "";
	}
}

export function usePrintHealthShared(overrides: PrintHealthDeps = {}): PrintHealth {
	if (!instance) {
		instance = usePrintHealth({
			pinnedPrinter: profilePinnedPrinter,
			...overrides,
		});
	}
	return instance;
}

/**
 * Kick off the boot check and arm the periodic re-check. Idempotent — a
 * second call replaces the timer rather than stacking a second one.
 */
export function startPrintHealthMonitor(overrides: PrintHealthDeps = {}): PrintHealth {
	const health = usePrintHealthShared(overrides);
	stopPrintHealthMonitor();
	void health.refresh().catch(() => undefined);
	recheckTimer = setInterval(() => {
		void health.refresh().catch(() => undefined);
	}, RECHECK_INTERVAL_MS);
	return health;
}

export function stopPrintHealthMonitor(): void {
	if (recheckTimer) {
		clearInterval(recheckTimer);
		recheckTimer = null;
	}
}

/** Test-only — drops the singleton so each spec starts clean. */
export function __resetPrintHealthForTest(): void {
	stopPrintHealthMonitor();
	instance = null;
}
