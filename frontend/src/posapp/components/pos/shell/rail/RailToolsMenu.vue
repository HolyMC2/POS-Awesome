<template>
	<!-- The "More" pill and its flyout: the pages the hamburger drawer used to
	     hold, behind ONE rail item (canvas «Riel con herramientas», 2026-08-22).
	     Sixteen 66px pills do not fit a 900px register; this one opens a menu
	     and, while a tool is the active destination, wears that tool's icon and
	     label. It is its own tab stop — the rail's arrow keys walk around it and
	     the menu owns focus inside itself. Split out of RegisterRail.vue for the
	     500-line rule; it shares the rail's class vocabulary on purpose so the
	     evidence lane reads `data-rail-destination` the same way everywhere. -->
	<!-- The pill is a plain button in the DOM at all times; the menu hangs
	     off it through `activator` rather than wrapping it in a slot. That is
	     what lets a runtime-only mount (the specs) and the evidence lane see
	     the pill whether or not the overlay library is on the page. -->
	<button
		ref="pillEl"
		type="button"
		class="register-rail__item register-rail__item--tools"
		:class="{
			'register-rail__item--on': activeTool !== null,
			'register-rail__item--pressed': toolsOpen,
		}"
		data-testid="rail-tools"
		data-rail-tools
		data-offline="available"
		:tabindex="tabIndex"
		@focus="emit('focus-pill')"
		:data-active-tool="activeTool ? activeTool.id : undefined"
		aria-haspopup="menu"
		:aria-expanded="toolsOpen ? 'true' : 'false'"
		:aria-current="activeTool ? 'page' : undefined"
		:aria-label="toolsAriaLabel"
		:aria-disabled="disabled ? 'true' : undefined"
	>
		<v-icon :icon="activeTool ? activeTool.icon : 'mdi-dots-grid'" :size="21" aria-hidden="true" />
		<span class="register-rail__label">{{ activeTool ? activeTool.label : __("More") }}</span>
	</button>
	<v-menu
		v-model="toolsOpen"
		:activator="pillEl ?? undefined"
		location="end"
		:offset="8"
		:disabled="disabled"
		:close-on-content-click="true"
		transition="fade-transition"
		content-class="register-rail__flyout-overlay"
	>
		<div class="register-rail__flyout" role="menu" :aria-label="__('Register tools')">
			<div class="register-rail__flyout-title">{{ __("Register tools") }}</div>
			<button
				v-for="item in items"
				:key="item.id"
				type="button"
				role="menuitem"
				class="register-rail__tool"
				:class="{
					'register-rail__tool--on': item.active,
					'register-rail__tool--dimmed': item.dimmed,
				}"
				:data-rail-destination="item.id"
				:data-offline="item.offlineAvailability"
				:aria-current="item.active ? 'page' : undefined"
				:aria-label="item.ariaLabel"
				:aria-disabled="item.disabled ? 'true' : undefined"
				@click="activate(item.id)"
			>
				<span class="register-rail__tool-icon" aria-hidden="true">
					<v-icon :icon="item.icon" :size="20" />
				</span>
				<span class="register-rail__tool-copy">
					<span class="register-rail__tool-label">{{ item.label }}</span>
					<span v-if="item.dimmed" class="register-rail__tool-hint">{{ __("Needs connection") }}</span>
					<span v-else-if="item.hint" class="register-rail__tool-hint">{{ item.hint }}</span>
				</span>
				<span v-if="item.dimmed" class="register-rail__dot register-rail__dot--tool" aria-hidden="true"></span>
			</button>

			<!-- The settings the navbar's actions menu carries. The rail replaced
			     the hamburger drawer as the desktop navigation, so a cashier
			     standing at it should not have to go back up to the top bar to
			     change the language or check for an update. Rendered here rather
			     than reached: what is NOT here is a second copy of any dialog —
			     each entry names a NavbarMenu action id and that menu opens its
			     own (railSettings.ts). Separated by a rule because the group
			     above is pages and this one is dialogs. -->
			<template v-if="settings.length">
				<div class="register-rail__flyout-divider" role="separator"></div>
				<div class="register-rail__flyout-title">{{ __("Settings") }}</div>
				<button
					v-for="setting in settings"
					:key="setting.id"
					type="button"
					role="menuitem"
					class="register-rail__tool"
					:class="{ 'register-rail__tool--dimmed': setting.dimmed }"
					:data-rail-setting="setting.id"
					:aria-label="setting.ariaLabel"
					:aria-disabled="setting.disabled ? 'true' : undefined"
					@click="choose(setting.id)"
				>
					<span class="register-rail__tool-icon" aria-hidden="true">
						<v-icon :icon="setting.icon" :size="20" />
					</span>
					<span class="register-rail__tool-copy">
						<span class="register-rail__tool-label">{{ setting.label }}</span>
						<span class="register-rail__tool-hint">{{
							setting.dimmed ? __("Needs connection") : setting.hint
						}}</span>
					</span>
					<span
						v-if="setting.dimmed"
						class="register-rail__dot register-rail__dot--tool"
						aria-hidden="true"
					></span>
				</button>
			</template>
		</div>
	</v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const pillEl = ref<HTMLElement | null>(null);

import type { RailItem } from "../../../../composables/pos/shell/useRegisterRail";
import type { RailDestinationId } from "../../../../composables/pos/shell/railDestinations";
import type { RailSettingId, RailSettingItem } from "../../../../composables/pos/shell/railSettings";

const props = defineProps<{
	items: RailItem[];
	activeTool: RailItem | null;
	/** The navbar menu's settings entries, resolved — see `railSettings.ts`. */
	settings: RailSettingItem[];
	/** The whole rail is inert until the shift opens (§5.1). */
	disabled: boolean;
	/** The rail's roving tabindex for this pill (0 when it is the ring's stop). */
	tabIndex: number;
	__: (key: string) => string;
}>();

const emit = defineEmits<{
	activate: [RailDestinationId];
	setting: [RailSettingId];
	"focus-pill": [];
}>();

const __ = (key: string) => props.__(key);

const toolsOpen = ref(false);

const toolsAriaLabel = computed(() => {
	const base = props.activeTool ? `${__("More")} — ${props.activeTool.label}` : __("More");
	return props.disabled ? `${base} — ${__("Shift not open")}` : base;
});

const activate = (id: RailDestinationId) => {
	emit("activate", id);
	toolsOpen.value = false;
};

/**
 * A settings entry is refused HERE, unlike a destination.
 *
 * `activate` can emit freely because `useRegisterRail.activate` refuses a
 * disabled item before it reaches the shell. A setting has no such guard
 * downstream — the shell forwards the id straight onto the bus — so an
 * `aria-disabled` entry that still emitted would open the dialog it just told
 * the operator it could not open.
 */
const choose = (id: RailSettingId) => {
	const setting = props.settings.find((candidate) => candidate.id === id);
	if (!setting || setting.disabled) {
		return;
	}
	emit("setting", id);
	toolsOpen.value = false;
};

/** Keyboard entry from the rail ring: Enter or Space on the pill. */
const toggle = () => {
	if (!props.disabled) {
		toolsOpen.value = !toolsOpen.value;
	}
};

defineExpose({ pillEl, toggle, toolsOpen });
</script>

<style scoped>
/* Same geometry and tokens as the rail's pills (RegisterRail.vue). */
.register-rail__item {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 5px;
	width: 100%;
	height: 66px;
	padding: 0 4px;
	border: 0;
	border-radius: 12px;
	background: transparent;
	color: var(--reg-rail-label, #5c6673);
	font-size: 10.5px;
	font-weight: 500;
	line-height: 1.15;
	text-align: center;
	cursor: pointer;
}

.register-rail__item[aria-disabled="true"] {
	cursor: default;
	color: var(--pos-text-muted, #667085);
}

.register-rail__item--on {
	background: var(--pos-surface-raised, #ffffff);
	color: var(--reg-rail-label-active, #00646f);
	font-weight: 700;
	box-shadow: 0 1px 3px rgba(16, 20, 30, 0.09);
}

.register-rail__item:focus-visible {
	outline: 2px solid var(--pos-primary-variant, #00838f);
	outline-offset: -2px;
}

.register-rail__label {
	display: block;
	width: 100%;
	overflow-wrap: anywhere;
}

.register-rail__dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--reg-rail-badge-bg, #e9a13b);
}

/* Pressed = the flyout is open. Distinct from `--on` (a tool is the active
 * destination) so the rail never shows two lit pills. */
.register-rail__item--pressed:not(.register-rail__item--on) {
	background: var(--reg-rail-pressed, #e3e8ee);
	color: var(--pos-text-primary, #16222a);
}

.register-rail__flyout {
	display: flex;
	flex-direction: column;
	gap: 2px;
	width: 312px;
	padding: 8px;
	border: 1px solid var(--reg-rail-border, #e2e6ec);
	border-radius: 14px;
	background: var(--pos-surface-raised, #ffffff);
	box-shadow: 0 10px 28px rgba(16, 20, 30, 0.14);
}

/* The flyout holds two kinds of thing — pages above, dialogs below — and the
 * rule is what says so before the group titles name them. `--pos-border` and
 * not `--reg-rail-divider`: v-menu TELEPORTS this content to <body>, so it
 * lands outside `.register-rail` where the `--reg-rail-*` names are defined
 * and would fall back to their light literals in dark mode. */
.register-rail__flyout-divider {
	height: 1px;
	margin: 6px 6px 2px;
	background: var(--pos-border, #dfe4ea);
}

.register-rail__flyout-title {
	padding: 8px 10px 6px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--pos-text-muted, #8b93a0);
}

.register-rail__tool {
	position: relative;
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-height: 54px;
	padding: 9px 10px;
	border: 0;
	border-radius: 10px;
	background: transparent;
	color: var(--pos-text-primary, #16222a);
	text-align: left;
	cursor: pointer;
}

.register-rail__tool:hover,
.register-rail__tool:focus-visible {
	background: var(--reg-rail-pressed, #e3e8ee);
	outline: none;
}

.register-rail__tool:focus-visible {
	box-shadow: inset 0 0 0 2px var(--pos-primary-variant, #00838f);
}

.register-rail__tool--on {
	background: var(--reg-rail-tool-on, #eef7f8);
}

.register-rail__tool--dimmed {
	opacity: 0.55;
}

.register-rail__tool[aria-disabled="true"] {
	cursor: default;
}

.register-rail__tool-icon {
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	flex: none;
	border-radius: 9px;
	background: var(--reg-rail-surface, #f2f4f7);
	color: var(--reg-rail-label-active, #00646f);
}

.register-rail__tool-copy {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.register-rail__tool-label {
	font-size: 13.5px;
	font-weight: 700;
	line-height: 1.2;
}

.register-rail__tool-hint {
	font-size: 11.5px;
	line-height: 1.25;
	color: var(--pos-text-muted, #667085);
}

.register-rail__dot--tool {
	position: static;
	margin-left: auto;
	flex: none;
}

</style>
