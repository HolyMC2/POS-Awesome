/**
 * What the payment screen can honestly say about this register's hardware.
 *
 * Gathers from state the app ALREADY holds and fetches nothing. The payment
 * screen opens on the hottest path in the product — once per sale, with a
 * customer waiting — and a readiness poll there would be new traffic bought
 * with the cashier's time. `usePrintHealthShared` is the singleton the navbar
 * dot already reads, started once at boot and re-checked on its own cadence;
 * this composable subscribes to it, it does not run it.
 *
 * The two values it CANNOT source are `null` rather than optimistic, and
 * `hardwareReadiness.ts` turns a null into silence:
 *
 *  - `drawerConnected` — no cash-drawer integration exists in this app at all.
 *  - `terminalsAvailable` — `mp_point.listEnabledTerminals()` would answer it,
 *    but nothing probes before a push and a probe is a network call. Wiring it
 *    is a decision with a cost, so it is in the report rather than taken here.
 */

import { computed, unref, type ComputedRef, type Ref } from "vue";

import { usePrintHealthShared } from "../../../composables/core/usePrintHealthShared";
import type { HardwareReadinessInput } from "./hardwareReadiness";

export interface HardwareReadinessSources {
	/** The active POS Profile — `posa_silent_print` is the only field read. */
	posProfile?: Ref<Record<string, unknown> | null | undefined> | Record<string, unknown> | null;
	/** Injected in tests; defaults to the app-wide print-health singleton. */
	printHealth?: { rollup: { value: "ok" | "warn" | "fail" | "unknown" } };
}

export const useHardwareReadiness = (
	sources: HardwareReadinessSources = {},
): ComputedRef<HardwareReadinessInput> => {
	const health = sources.printHealth ?? usePrintHealthShared();

	return computed<HardwareReadinessInput>(() => {
		const profile = (unref(sources.posProfile as never) ?? {}) as Record<string, unknown>;
		return {
			printerStatus: health?.rollup?.value ?? "unknown",
			usesSilentPrint: Boolean(profile?.posa_silent_print),
			// Both deliberately null — see the header. A `false` here would be
			// a different and equally wrong claim: "checked, and it is not
			// connected".
			drawerConnected: null,
			terminalsAvailable: null,
			terminalName: null,
		};
	});
};
