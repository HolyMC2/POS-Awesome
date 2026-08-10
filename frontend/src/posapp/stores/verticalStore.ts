import { defineStore } from "pinia";
import { computed } from "vue";
import { useUIStore } from "./uiStore";

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
	/** Structural layout of the sales screen. */
	items_view: { default: "list" | "card"; allow: Array<"list" | "card"> };
	cart_style: "table";
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
		cart_style: "table",
	},
	capabilities: ["serial_imei", "saldo", "offers", "coupons"],
};

export const useVerticalStore = defineStore("vertical", () => {
	const uiStore = useUIStore();

	const profile = computed<VerticalProfile>(() => RETAIL_PHONES);

	const capabilitySet = computed(() => new Set(profile.value.capabilities));

	const has = (capability: string): boolean => capabilitySet.value.has(capability);

	/**
	 * Layout resolution: preset defaults + per-register POS Profile
	 * overrides. `posa_lean_vertical_layout` is the first profile-driven
	 * layout flag with a real renderer (it shipped in a patch with no
	 * consumer — the plan's rehearsal slice).
	 */
	const layout = computed<VerticalLayout>(() => ({
		...profile.value.layout,
		lean_vertical: Boolean(uiStore.posProfile?.posa_lean_vertical_layout),
	}));

	const leanVerticalLayout = computed(() => layout.value.lean_vertical);

	return { profile, has, layout, leanVerticalLayout };
});
