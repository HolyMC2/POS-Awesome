/**
 * The contract a flows sheet honours when the rail HOSTS it (roadmap §17.7).
 *
 * Every sheet the registry names — Drafts, Invoice Management, Returns, the
 * service-order list, Recargas — was written as a modal that waits for its own
 * trigger: a store flag flipped by a navbar button, or a bus event from a
 * chord. `DestinationHost` mounts the same component beside the rail and fires
 * none of those triggers, so the host rendered a component whose `v-dialog`
 * was closed: a surface with a lit rail item and nothing on it. The
 * destination audit measured it (`docs/design-evidence/destinations/audit.json`,
 * `hostText: ""` for drafts, invoices, return and recharge) and the build plan
 * still read "reaches a working surface today".
 *
 * `ClosingDialog` already does the three things a hosted sheet has to do, by
 * hand. This composable is those three things, named once:
 *
 *   1. OPEN ITSELF when mounted under a surface. The rail choosing a
 *      destination IS the open request; there is nobody else to send one.
 *   2. HAND `close` TO THE HOST when its own overlay closes. A sheet that only
 *      lowers its dialog leaves the host on screen, empty, with the rail beside
 *      it and no way out. The host turns `close` into `dismiss`, which returns
 *      to the previous destination rather than a hardcoded sale.
 *   3. LOWER ITS STORE FLAG ON UNMOUNT, silently. The flag outlives the hosted
 *      instance, and `Pos.vue` still mounts a floating copy behind `v-if` on
 *      that same flag for the narrow layout — so a flag left true would raise
 *      the modal the moment the rail moved on. Silent, because the host is
 *      already switching: emitting `close` here would dismiss the destination
 *      the operator just chose.
 *
 * A component that mounts with no surface injected gets `isHosted: false` and
 * NOTHING else happens — the floating modal behaves exactly as it did, which is
 * what keeps the narrow layout (no rail, the dock is the nav) on the old path.
 */

import { inject, onBeforeUnmount, onMounted, watch, type Ref } from "vue";

import {
	DESTINATION_SURFACE,
	type DestinationSurface,
} from "../../../components/pos/shell/destinations/surfaceContext";

export interface HostedSheetOptions {
	/** The sheet's own open state — a store flag or a local ref. */
	open: Ref<boolean>;
	/**
	 * Raise the sheet. Called once, on mount, only when hosted. Optional for
	 * components that prefer to open from their own `mounted()` because the
	 * open needs data that only exists on the instance.
	 */
	openSheet?: () => void;
	/**
	 * Lower the sheet's flag on unmount. Required for sheets whose open state
	 * lives in a STORE (a local ref dies with the instance; a store flag does
	 * not, and a floating copy may be waiting on it).
	 */
	closeSheet?: () => void;
	/** The component's `emit`; only `close` is ever sent. */
	emit: (event: "close") => void;
}

export interface HostedSheet {
	/** True when `DestinationHost` is rendering this instance. */
	isHosted: boolean;
	/** The destination this surface is showing, or null when not hosted. */
	destinationId: Ref<string> | null;
}

export function useHostedSheet(options: HostedSheetOptions): HostedSheet {
	const surface = inject<DestinationSurface | null>(DESTINATION_SURFACE, null);
	if (!surface) {
		return { isHosted: false, destinationId: null };
	}

	// Set before the flag is lowered on unmount, so the `open` watcher (which
	// may still flush once) cannot mistake the teardown for the operator
	// closing the sheet.
	let leaving = false;

	onMounted(() => {
		options.openSheet?.();
	});

	watch(options.open, (isOpen) => {
		if (!isOpen && !leaving) {
			options.emit("close");
		}
	});

	onBeforeUnmount(() => {
		leaving = true;
		options.closeSheet?.();
	});

	return { isHosted: true, destinationId: surface.destinationId };
}

export default useHostedSheet;
