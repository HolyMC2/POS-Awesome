/**
 * Destination routing — one source of truth for "where am I" (roadmap §17.7).
 *
 * Three mechanisms reach a destination: the rail, a deep link, and a keyboard
 * chord through the shortcuts engine (§17.3). All three must converge on ONE
 * piece of state. Three mechanisms with three states is the bug this file
 * exists to prevent — it is how a rail highlights Borradores while the URL says
 * Facturas and Alt+B opens a third thing.
 *
 * The decision is a PURE function (`resolveActivation`), the way `itemPricing`,
 * `discountIntent` and `movementDirection` already split arithmetic away from
 * their dialogs. A gate that can only be exercised by mounting the shell is a
 * gate nobody tests properly.
 *
 * Gate order is deliberate and comes from the canvas annotation on page 1:
 * *el turno es el sobre de todo lo demás*. The shift is the outermost
 * envelope, so it is checked first — before capability, before network.
 * Reporting "needs a connection" to a cashier who has not opened the register
 * sends them to fix the wrong thing.
 */

import { computed, ref, type Ref } from "vue";

import {
	DESTINATIONS,
	destinationForPath,
	getDestination,
	type DestinationDef,
	type DestinationId,
} from "./destinationRegistry";

/** Everything the decision needs, and nothing Vue-shaped. */
export interface ActivationContext {
	/** Server reachability, not `navigator.onLine` — see useOnlineStatus. */
	isOnline: boolean;
	/** A POS Opening Shift exists for this register. */
	shiftOpen: boolean;
	/** verticalStore.has() */
	hasCapability: (capability: string) => boolean;
	/** Truthiness of a `posa_*` flag on the active POS Profile. */
	hasProfileFlag: (flag: string) => boolean;
}

export type RefusalReason = "unknown" | "shift_closed" | "gated" | "offline";

export type ActivationDecision =
	| { allowed: true; destination: DestinationDef }
	| { allowed: false; reason: RefusalReason; destination: DestinationDef | null };

/**
 * Is this destination configured on for this register?
 *
 * Capability OR legacy flag, additive per plan C3: a preset may declare
 * `saldo` while an older tenant still carries only `posa_use_charge_requests`,
 * and both must work. A destination naming neither is universal.
 */
export function isDestinationEnabled(
	def: DestinationDef,
	ctx: Pick<ActivationContext, "hasCapability" | "hasProfileFlag">,
): boolean {
	if (!def.capability && !def.profileFlag) {
		return true;
	}
	if (def.capability && ctx.hasCapability(def.capability)) {
		return true;
	}
	if (def.profileFlag && ctx.hasProfileFlag(def.profileFlag)) {
		return true;
	}
	return false;
}

/**
 * Can this destination be used right now, given the network?
 *
 * Only `online_required` is refused. `offline_queue` and `offline_local` are
 * reachable by definition — they exist to accept work with no server — and
 * `offline_read` serves its cached copy with visible freshness (§7).
 */
export function isReachableOffline(def: DestinationDef): boolean {
	return def.offline !== "online_required";
}

/**
 * The whole gate, in one testable place. Returns WHY, not just no: the rail
 * dims differently for "no connection" than for "not configured", and a
 * cashier who is told the wrong reason goes and fixes the wrong thing.
 */
export function resolveActivation(id: string, ctx: ActivationContext): ActivationDecision {
	const def = getDestination(id);
	if (!def) {
		return { allowed: false, reason: "unknown", destination: null };
	}
	if (!ctx.shiftOpen) {
		return { allowed: false, reason: "shift_closed", destination: def };
	}
	if (!isDestinationEnabled(def, ctx)) {
		return { allowed: false, reason: "gated", destination: def };
	}
	if (!ctx.isOnline && !isReachableOffline(def)) {
		return { allowed: false, reason: "offline", destination: def };
	}
	return { allowed: true, destination: def };
}

/** The destinations the rail should draw, with their current state. */
export interface RailEntry {
	def: DestinationDef;
	enabled: boolean;
	/** Configured on, but unusable right now because the register is offline. */
	blockedOffline: boolean;
}

export function railEntries(ctx: ActivationContext): RailEntry[] {
	return DESTINATIONS.filter((def) => isDestinationEnabled(def, ctx)).map((def) => ({
		def,
		enabled: ctx.shiftOpen && (ctx.isOnline || isReachableOffline(def)),
		blockedOffline: !ctx.isOnline && !isReachableOffline(def),
	}));
}

/**
 * Navigation guard factory for the router.
 *
 * Hiding a rail item while leaving its URL open is not a gate — it is a gate
 * with a hole in it, and the hole is the one a bookmark, a customer display or
 * a support instruction finds first. Installed by the shell rather than
 * exported into `router/index.ts` directly, so the guard can be unit-tested
 * against a plain path string with no router instance at all.
 *
 * Returns `true` to allow, or the path to redirect to.
 */
export function createDestinationGuard(getContext: () => ActivationContext) {
	return (path: string): true | string => {
		const def = destinationForPath(path);
		if (!def) {
			// Not a destination path — not this guard's business.
			return true;
		}
		const decision = resolveActivation(def.id, getContext());
		return decision.allowed ? true : "/pos";
	};
}

export type ActivationSource = "rail" | "url" | "shortcut" | "restore";

export interface DestinationEffects {
	/** Panels: switch the shell's selector column. */
	setPanelView: (view: NonNullable<DestinationDef["panelView"]>) => void;
	/** Sheets: raise the hosted flow. */
	openSheet: (id: DestinationId) => void;
	/** Sheets: lower whichever is up. */
	closeSheet: () => void;
	/** Routes: hand off to vue-router. */
	navigate: (path: string) => void;
	/** Surface a refusal to the operator. */
	refuse?: (decision: Extract<ActivationDecision, { allowed: false }>) => void;
}

/**
 * The composable the shell mounts. `activeId` is the single state the rail,
 * the URL and the cheat sheet all read; `activate` is the single writer.
 */
export function useDestinationRouting(
	getContext: () => ActivationContext,
	effects: DestinationEffects,
) {
	const activeId: Ref<DestinationId> = ref<DestinationId>("sale");
	/** Where a sheet returns to when it closes — never assume the sale. */
	const previousId: Ref<DestinationId> = ref<DestinationId>("sale");

	const activeDestination = computed(() => getDestination(activeId.value) ?? null);

	function activate(id: string, source: ActivationSource = "rail"): ActivationDecision {
		const decision = resolveActivation(id, getContext());
		if (!decision.allowed) {
			effects.refuse?.(decision);
			return decision;
		}

		const def = decision.destination;
		if (def.id !== activeId.value) {
			previousId.value = activeId.value;
		}
		activeId.value = def.id;

		// A `restore` is the browser telling us where we already are (popstate,
		// or the initial URL). Re-navigating would push a duplicate entry and
		// make Back a no-op that the cashier has to press twice.
		if (def.kind === "sheet") {
			effects.openSheet(def.id);
		} else if (def.kind === "panel") {
			effects.closeSheet();
			effects.setPanelView(def.panelView ?? "items");
		} else if (source !== "restore") {
			effects.closeSheet();
			effects.navigate(def.path);
		}

		return decision;
	}

	/** Back out of a sheet to whatever was underneath it. */
	function dismiss(): void {
		effects.closeSheet();
		activate(previousId.value, "restore");
	}

	/** Resolve the destination a chord names, so the shortcut and the rail
	 * land on identical state rather than on two similar ones. */
	function activateByShortcut(actionId: string): ActivationDecision | null {
		const def = DESTINATIONS.find((d) => d.shortcutActionId === actionId);
		return def ? activate(def.id, "shortcut") : null;
	}

	/** Adopt the destination a URL names (initial load and popstate). */
	function syncFromPath(path: string): ActivationDecision | null {
		const def = destinationForPath(path);
		return def ? activate(def.id, "restore") : null;
	}

	return {
		activeId,
		activeDestination,
		previousId,
		activate,
		activateByShortcut,
		syncFromPath,
		dismiss,
		entries: computed(() => railEntries(getContext())),
	};
}
