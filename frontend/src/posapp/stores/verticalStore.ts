import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useUIStore } from "./uiStore";
import type { CartStyle, DockTabId, ItemsPanelStyle } from "../vertical/viewContracts";

/**
 * Capability resolution for vertical presets (VERTICAL_PROFILES_PLAN.md).
 *
 * M1 contract: this store is a PURE ADDITION. It answers capability and
 * layout questions that have no existing `posa_*` flag; the 267 existing
 * profile-flag reads stay where they are and migrate one at a time only
 * when a second vertical needs a flag to mean something different. Until
 * the `POS Capability Profile` doctype lands (M3), the profile below is
 * the hardcoded `retail-phones` preset, and per-register layout overrides
 * come from POS Profile flags — which is also the offline story for free:
 * the shift-open snapshot already persists POS Profile to Dexie, so
 * everything resolved here works on a cold offline boot.
 *
 * Rule #1: consumers ask `has("capability")` or read a resolved layout
 * value. They never ask "which vertical is this" — vertical names must not
 * appear in components.
 */

export interface VerticalLayout {
	/** Operator-facing list style INSIDE the standard items panel. */
	items_view: { default: "list" | "card"; allow: Array<"list" | "card"> };
	/** Registry key for the whole items panel (viewRegistry). */
	items_panel: ItemsPanelStyle;
	/** Registry key for the cart view (viewRegistry). */
	cart_style: CartStyle;
	/** Bottom-dock tabs, in render order (shell knows how to draw each id). */
	dock_tabs: readonly DockTabId[];
	/**
	 * Force the stacked single-panel layout (selector/cart panels switched
	 * via the bottom dock) regardless of viewport width. Off = width-based
	 * (< 1100px), the shipped behaviour.
	 */
	lean_vertical: boolean;
}

export interface VerticalProfile {
	name: string;
	layout: Omit<VerticalLayout, "lean_vertical">;
	capabilities: readonly string[];
}

/**
 * The only preset in M1. The capability list names behaviour the retail
 * app already has — it exists so consumers can start asking `has()`
 * instead of growing new `posa_*` checks.
 */
const RETAIL_PHONES: VerticalProfile = {
	name: "retail-phones",
	layout: {
		items_view: { default: "list", allow: ["list", "card"] },
		items_panel: "standard",
		cart_style: "table",
		dock_tabs: ["browse", "offers", "cart", "coupons", "pay"],
	},
	capabilities: ["serial_imei", "saldo", "offers", "coupons"],
};

/**
 * POS Profile loads async at boot — without a cache a lean register
 * paints the wide 2-column layout first and then snaps to stacked.
 * The last RESOLVED layout is persisted and applied optimistically
 * until the profile lands; the profile remains the source of truth
 * the moment it arrives.
 */
const LAYOUT_CACHE_KEY = "posa_vertical_layout_cache";

/**
 * Parse the capability JSON the backend denormalised onto POS Profile
 * (posa_capability_json — plan C7), merging it over the retail defaults so
 * a sparse preset only overrides what it names. Returns the built-in
 * retail-phones profile when the field is absent/blank/malformed — an
 * unresolvable preset must never blank the counter.
 */
const parseProfilePayload = (raw: unknown): VerticalProfile => {
	if (!raw || typeof raw !== "string") {
		return RETAIL_PHONES;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<VerticalProfile> & {
			layout?: Partial<VerticalLayout>;
		};
		const layout: Partial<VerticalLayout> = parsed.layout || {};
		return {
			name: parsed.name || RETAIL_PHONES.name,
			layout: {
				items_view: layout.items_view || RETAIL_PHONES.layout.items_view,
				items_panel: layout.items_panel || RETAIL_PHONES.layout.items_panel,
				cart_style: layout.cart_style || RETAIL_PHONES.layout.cart_style,
				dock_tabs:
					Array.isArray(layout.dock_tabs) && layout.dock_tabs.length
						? layout.dock_tabs
						: RETAIL_PHONES.layout.dock_tabs,
			},
			capabilities: Array.isArray(parsed.capabilities)
				? parsed.capabilities
				: RETAIL_PHONES.capabilities,
		};
	} catch {
		return RETAIL_PHONES;
	}
};

const readLayoutCache = (): { lean_vertical?: boolean } => {
	try {
		return JSON.parse(window.localStorage.getItem(LAYOUT_CACHE_KEY) || "{}") || {};
	} catch {
		return {};
	}
};

const writeLayoutCache = (value: { lean_vertical: boolean }) => {
	try {
		window.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(value));
	} catch {
		/* private mode / quota — optimistic boot just degrades to a flash */
	}
};

export const useVerticalStore = defineStore("vertical", () => {
	const uiStore = useUIStore();

	// The linked preset (posa_capability_json) if the profile carries one,
	// else retail-phones. Null link → retail defaults → zero data change for
	// existing tenants (plan C12).
	const profile = computed<VerticalProfile>(() =>
		parseProfilePayload(uiStore.posProfile?.posa_capability_json),
	);

	const capabilitySet = computed(() => new Set(profile.value.capabilities));

	const has = (capability: string): boolean => capabilitySet.value.has(capability);

	const cachedLayout = ref(readLayoutCache());

	/**
	 * Layout resolution: preset defaults + per-register POS Profile
	 * overrides. `posa_lean_vertical_layout` is the first profile-driven
	 * layout flag with a real renderer (it shipped in a patch with no
	 * consumer — the plan's rehearsal slice). Before the profile loads,
	 * the persisted last-resolved layout answers (boot-flash guard).
	 */
	const layout = computed<VerticalLayout>(() => ({
		...profile.value.layout,
		lean_vertical: uiStore.posProfile
			? Boolean(uiStore.posProfile.posa_lean_vertical_layout)
			: Boolean(cachedLayout.value.lean_vertical),
	}));

	watch(
		() => uiStore.posProfile?.posa_lean_vertical_layout,
		(flag) => {
			if (!uiStore.posProfile) {
				return;
			}
			const resolved = { lean_vertical: Boolean(flag) };
			cachedLayout.value = resolved;
			writeLayoutCache(resolved);
		},
	);

	const leanVerticalLayout = computed(() => layout.value.lean_vertical);

	/**
	 * External-document checkout — pull a finished cross-app document (a
	 * taller Repair Order, via the POS Charge Request pull-model already in
	 * prod) into the cart as billable lines. Resolved as capability OR the
	 * legacy `posa_use_charge_requests` flag: additive per plan C3, so
	 * existing charge-request tenants keep working while a vertical preset
	 * can now declare the capability instead of the raw flag (the taller-
	 * repair preset does). This is the Fowler "resolver, not a scattered
	 * flag" the research called for — consumers read one thing.
	 */
	const externalDocumentCheckout = computed(
		() => has("external_document_checkout") || Boolean(uiStore.posProfile?.posa_use_charge_requests),
	);

	return { profile, has, layout, leanVerticalLayout, externalDocumentCheckout };
});
