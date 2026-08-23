import { computed, ref, type ComputedRef, type Ref } from "vue";

import {
	isOfflineBlocked,
	visibleRailDestinations,
	type RailBadgeSource,
	type RailDestination,
	type RailDestinationId,
	type RailGateMap,
	type RailGroup,
	type RailOfflineAvailability,
} from "./railDestinations";
import { resolveRailSettings, type RailSettingItem } from "./railSettings";

/**
 * Resolves the pure rail registry against this register's live state.
 *
 * Split from `railDestinations.ts` on purpose: WHAT the rail contains is a
 * fact about the product and belongs in a module a test can read without a
 * DOM, while WHICH ENTRY IS LIT is a fact about this shift and needs refs.
 * Keeping them in one file would drag Vue into the registry and make the
 * §9.1 server-side resolution of a keymap-style rail artifact impossible.
 *
 * The context mirrors `DockTabContext` (vertical/viewContracts.ts): the
 * shell hands over resolvers and counts, this module hands back defs. The
 * rail never imports a store, so it can be mounted in a test with four
 * plain refs.
 */
export interface RegisterRailContext {
	/** Frappe translation for nouns every giro calls the same thing. */
	__: (key: string) => string;
	/**
	 * Vertical vocabulary resolver (`verticalStore.t`). Only the two nouns a
	 * preset genuinely renames go through it — see `RailDestination.vocabulary`.
	 */
	t: (key: string) => string;
	/** Capability answers, one per `RailGate`. */
	gates: Ref<RailGateMap> | ComputedRef<RailGateMap>;
	/** The destination currently shown in the shell. */
	activeDestinationId: Ref<string> | ComputedRef<string>;
	/**
	 * Has the shift been opened? §5.1: until it has, the register genuinely
	 * cannot do anything, and the rail must look like it rather than
	 * offering eight destinations that all fail.
	 */
	shiftOpen: Ref<boolean> | ComputedRef<boolean>;
	/** Register has no usable connection right now. */
	offline: Ref<boolean> | ComputedRef<boolean>;
	/**
	 * `posa_silent_print` on the POS Profile. Not a `RailGate`: it gates no
	 * destination, only the printer entry in the tools flyout's settings group
	 * — and it has to answer the same way `NavbarMenu` does, or the rail
	 * advertises a certificate flow for a printer this register does not have.
	 */
	silentPrint?: Ref<boolean> | ComputedRef<boolean>;
	/** Live counts, keyed by the registry's badge sources. */
	counts: Partial<Record<RailBadgeSource, Ref<number> | ComputedRef<number>>>;
	/** Shell navigation. Called only for a destination that is not disabled. */
	navigate: (id: RailDestinationId) => void;
}

/** One rail entry, fully resolved for render. */
export interface RailItem {
	id: RailDestinationId;
	label: string;
	icon: string;
	group: RailGroup;
	/** `null` renders no pill at all; `0` is deliberately also no pill. */
	badge: number | null;
	active: boolean;
	/** Reachable but degraded — needs signal. Draws the amber dot. */
	dimmed: boolean;
	/** Not reachable at all right now (shift closed, or offline-blocked). */
	disabled: boolean;
	/**
	 * Full announcement: label, count and reason. Colour alone never carries
	 * the badge or the dimmed state — a dot is invisible to a screen reader
	 * and to roughly one cashier in twelve.
	 */
	ariaLabel: string;
	shortcutActionId: string | null;
	/** Tools flyout only — see `RailDestination.hint`. */
	hint: string | null;
	/**
	 * The destination's declared offline standing, passed through unchanged
	 * from the registry so the evidence lane and the wave-3 audit can read
	 * state off the DOM without knowing this component's CSS. Note this is
	 * the DECLARATION, not the current condition: it reads `blocked` whether
	 * or not the register happens to be offline right now. `dimmed` is the
	 * live one.
	 */
	offlineAvailability: RailOfflineAvailability;
}

export function useRegisterRail(ctx: RegisterRailContext) {
	const resolveLabel = (destination: RailDestination): string =>
		destination.vocabulary ? ctx.t(destination.label) : ctx.__(destination.label);

	const resolveBadge = (destination: RailDestination): number | null => {
		if (!destination.badgeSource) {
			return null;
		}
		const count = ctx.counts[destination.badgeSource]?.value ?? 0;
		// Zero is not a badge. A pill reading "0" is a pill a cashier learns
		// to stop reading.
		return count > 0 ? count : null;
	};

	/** The whole rail is inert until the shift opens (§5.1). */
	const railDisabled = computed(() => !ctx.shiftOpen.value);

	const items = computed<RailItem[]>(() =>
		visibleRailDestinations(ctx.gates.value).map((destination) => {
			const offlineBlocked = ctx.offline.value && isOfflineBlocked(destination);
			const disabled = railDisabled.value || offlineBlocked;
			const badge = resolveBadge(destination);
			const label = resolveLabel(destination);

			const notes: string[] = [];
			if (badge !== null) {
				notes.push(String(badge));
			}
			if (railDisabled.value) {
				notes.push(ctx.__("Shift not open"));
			} else if (offlineBlocked) {
				notes.push(ctx.__("Needs connection"));
			}

			return {
				id: destination.id,
				label,
				icon: destination.icon,
				group: destination.group,
				badge,
				active: !railDisabled.value && ctx.activeDestinationId.value === destination.id,
				dimmed: offlineBlocked,
				disabled,
				ariaLabel: notes.length ? `${label} — ${notes.join(" · ")}` : label,
				shortcutActionId: destination.shortcutActionId,
				hint: destination.hint ? ctx.__(destination.hint) : null,
				offlineAvailability: destination.offlineAvailability,
			};
		}),
	);

	const inGroup = (group: RailGroup) =>
		computed<RailItem[]>(() => items.value.filter((item) => item.group === group));

	const primaryItems = inGroup("primary");
	const toolsItems = inGroup("tools");
	const footerItems = inGroup("footer");

	/**
	 * The settings entries that share the tools flyout, resolved the same way
	 * the destinations are. They are the navbar menu's, reached by id — see
	 * `railSettings.ts` for why the rail names one instead of opening it.
	 */
	const settingsItems = computed<RailSettingItem[]>(() =>
		resolveRailSettings({
			__: ctx.__,
			silentPrint: ctx.silentPrint?.value === true,
			offline: ctx.offline.value,
			railDisabled: railDisabled.value,
		}),
	);

	/**
	 * The tool currently on screen, if any. The rail's "More" item wears its
	 * icon and label while it is active, so the rail shows where the operator
	 * IS without growing a pill per tool.
	 */
	const activeTool = computed<RailItem | null>(
		() => toolsItems.value.find((item) => item.active) ?? null,
	);

	/**
	 * What the arrow keys walk: the pills on the rail. Tool items live in the
	 * flyout and take the menu's own focus; the "More" pill is a tab stop of
	 * its own between the two groups.
	 */
	const keyboardItems = computed<RailItem[]>(() =>
		items.value.filter((item) => item.group !== "tools"),
	);

	/**
	 * Roving tabindex: the rail is ONE tab stop, and the arrows move inside
	 * it. Eight nav items that each take a Tab press is eight presses
	 * between the search field and the cart — the WAI-ARIA toolbar pattern
	 * exists for exactly this.
	 */
	const focusedIndex = ref(0);

	const clampFocus = () => {
		const last = keyboardItems.value.length - 1;
		if (last < 0) {
			focusedIndex.value = 0;
			return;
		}
		focusedIndex.value = Math.min(Math.max(focusedIndex.value, 0), last);
	};

	const focusIndex = (index: number) => {
		focusedIndex.value = index;
		clampFocus();
	};

	/**
	 * Focus moves over DISABLED entries too, on purpose. Skipping them
	 * silently makes a rail whose shape changes under the operator's fingers
	 * between online and offline; the entry stays reachable and announces
	 * why it cannot be used.
	 */
	const moveFocus = (delta: number) => {
		const count = keyboardItems.value.length;
		if (!count) {
			return;
		}
		focusedIndex.value = (focusedIndex.value + delta + count) % count;
	};

	const activate = (id: RailDestinationId) => {
		const item = items.value.find((candidate) => candidate.id === id);
		if (!item || item.disabled) {
			return false;
		}
		ctx.navigate(id);
		return true;
	};

	const activateFocused = () => {
		clampFocus();
		const item = keyboardItems.value[focusedIndex.value];
		return item ? activate(item.id) : false;
	};

	/** Returns true when the key was consumed, so the caller can preventDefault. */
	const onKeydown = (event: KeyboardEvent): boolean => {
		switch (event.key) {
			case "ArrowDown":
				moveFocus(1);
				return true;
			case "ArrowUp":
				moveFocus(-1);
				return true;
			case "Home":
				focusIndex(0);
				return true;
			case "End":
				focusIndex(keyboardItems.value.length - 1);
				return true;
			case "Enter":
			case " ":
				activateFocused();
				return true;
			default:
				return false;
		}
	};

	return {
		items,
		primaryItems,
		toolsItems,
		footerItems,
		settingsItems,
		activeTool,
		keyboardItems,
		railDisabled,
		focusedIndex,
		focusIndex,
		activate,
		activateFocused,
		onKeydown,
	};
}
