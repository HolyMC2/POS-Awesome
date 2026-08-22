<template>
	<!-- The rail is the ONLY desktop navigation (roadmap §17.7, direction E).
	     `<nav>` rather than a styled column of divs: it is the landmark a
	     screen-reader user jumps to, and the artboard's version — bare divs
	     with no roles — is a drawing, not a contract.

	     Unavailable items carry `aria-disabled` and NOT the native `disabled`
	     attribute. Native `disabled` drops an element from the tab order and
	     makes `.focus()` a no-op, which killed two things at once: the roving
	     tabindex in useRegisterRail deliberately does not skip disabled
	     entries (skipping reshapes the rail under the operator's fingers the
	     moment the connection drops), and an offline-blocked item's
	     `ariaLabel` — "Devolución — Needs connection" — is the ONLY non-colour
	     carrier of why it is unavailable, since the amber dot is aria-hidden.
	     Unfocusable meant the explanation built for screen-reader users was
	     the one thing they could not reach. Worse, before the shift opens
	     EVERY item is disabled, so the register's only desktop nav had zero
	     keyboard-reachable controls.

	     Activation stays guarded without the attribute: `activate()` refuses a
	     disabled item, and both the click handler and Enter/Space route
	     through it. -->
	<nav
		class="register-rail"
		:class="{ 'register-rail--disabled': railDisabled }"
		:aria-label="__('Register navigation')"
		data-testid="register-rail"
		:data-rail-state="railDisabled ? 'disabled' : 'enabled'"
		@keydown="handleKeydown"
	>
		<ul class="register-rail__group" role="list">
			<li v-for="item in primaryItems" :key="item.id">
				<button
					:ref="(el) => registerItemRef(el, item.id)"
					type="button"
					class="register-rail__item"
					:class="{
						'register-rail__item--on': item.active,
						'register-rail__item--dimmed': item.dimmed,
					}"
					:data-rail-destination="item.id"
					:data-icon="item.icon"
					:data-offline="item.offlineAvailability"
					:tabindex="tabIndexFor(item.id)"
					:aria-current="item.active ? 'page' : undefined"
					:aria-label="item.ariaLabel"
					:aria-disabled="item.disabled ? 'true' : undefined"
					@click="activate(item.id)"
					@focus="focusItem(item.id)"
				>
					<span v-if="item.badge !== null" class="register-rail__badge" aria-hidden="true">{{
						item.badge
					}}</span>
					<!-- The amber dot repeats what `ariaLabel` already says in
					     words. It is redundancy on purpose: colour is never the
					     only carrier of "needs connection". -->
					<span v-if="item.dimmed" class="register-rail__dot" aria-hidden="true"></span>
					<v-icon :icon="item.icon" :size="21" aria-hidden="true" />
					<span class="register-rail__label">{{ item.label }}</span>
				</button>
			</li>
		</ul>

		<div class="register-rail__spacer"></div>

		<ul class="register-rail__group" role="list">
			<li v-for="item in footerItems" :key="item.id">
				<button
					:ref="(el) => registerItemRef(el, item.id)"
					type="button"
					class="register-rail__item"
					:class="{
						'register-rail__item--on': item.active,
						'register-rail__item--dimmed': item.dimmed,
					}"
					:data-rail-destination="item.id"
					:data-icon="item.icon"
					:data-offline="item.offlineAvailability"
					:tabindex="tabIndexFor(item.id)"
					:aria-current="item.active ? 'page' : undefined"
					:aria-label="item.ariaLabel"
					:aria-disabled="item.disabled ? 'true' : undefined"
					@click="activate(item.id)"
					@focus="focusItem(item.id)"
				>
					<span v-if="item.dimmed" class="register-rail__dot" aria-hidden="true"></span>
					<v-icon :icon="item.icon" :size="21" aria-hidden="true" />
					<span class="register-rail__label">{{ item.label }}</span>
				</button>
			</li>
		</ul>

		<!-- The avatar is a slot, not a destination: whose shift this is has no
		     screen of its own, and the shell already owns the cashier menu. -->
		<div v-if="$slots.avatar" class="register-rail__avatar">
			<slot name="avatar"></slot>
		</div>
	</nav>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from "vue";

import {
	useRegisterRail,
	type RegisterRailContext,
	type RailItem,
} from "../../../../composables/pos/shell/useRegisterRail";
import type { RailDestinationId } from "../../../../composables/pos/shell/railDestinations";

const props = defineProps<{ context: RegisterRailContext }>();

const __ = (key: string) => props.context.__(key);

const rail = useRegisterRail(props.context);
const { items, primaryItems, footerItems, railDisabled, focusedIndex } = rail;

const itemRefs = new Map<RailDestinationId, HTMLElement>();

const registerItemRef = (el: unknown, id: RailDestinationId) => {
	const element = (el as { $el?: HTMLElement } | HTMLElement | null) ?? null;
	const node =
		element && "$el" in (element as object)
			? ((element as { $el?: HTMLElement }).$el ?? null)
			: (element as HTMLElement | null);
	if (node) {
		itemRefs.set(id, node);
	} else {
		itemRefs.delete(id);
	}
};

/**
 * Roving tabindex: exactly one item is in the tab order at a time. Without
 * this the rail costs eight Tab presses to step past, which is the reason
 * keyboard users abandon a nav rail entirely.
 */
const focusedId = computed<RailDestinationId | null>(
	() => (items.value[focusedIndex.value] as RailItem | undefined)?.id ?? null,
);

const tabIndexFor = (id: RailDestinationId) => (focusedId.value === id ? 0 : -1);

const focusItem = (id: RailDestinationId) => {
	const index = items.value.findIndex((item) => item.id === id);
	if (index >= 0) {
		rail.focusIndex(index);
	}
};

const activate = (id: RailDestinationId) => {
	focusItem(id);
	rail.activate(id);
};

const handleKeydown = (event: KeyboardEvent) => {
	if (rail.onKeydown(event)) {
		// Arrows would scroll the shell and Space would page it; the rail
		// consumed them, so nothing else should also act on them.
		event.preventDefault();
		event.stopPropagation();
	}
};

/**
 * Move real DOM focus to follow the roving index. `nextTick` because the
 * tabindex flip and the focus call must not race: focusing an element that
 * is still `tabindex="-1"` works, but focusing one Vue is about to re-render
 * does not survive the patch.
 */
watch(focusedId, async (id) => {
	if (!id) {
		return;
	}
	await nextTick();
	const node = itemRefs.get(id);
	if (node && document.activeElement !== node && node.closest(".register-rail")?.contains(document.activeElement)) {
		node.focus();
	}
});

defineExpose({ items, railDisabled });
</script>

<style scoped>
/* Geometry is the artboard's, measured rather than eyeballed:
 * muelle-site/design/register-hifi/Main.dc.html — 96px column, 9px/8px
 * padding, 3px gap, 66px items on a 12px radius.
 *
 * COLOUR, by contrast, resolves through custom properties in every rule below.
 * theme.css ships a full dark palette and the rest of the POS follows it; a
 * literal here made the register's primary navigation render as a light column
 * beside a #121212 shell. `ActionBand.vue` is the pattern: forward a token,
 * keep the artboard value as the fallback so an unwired stylesheet still
 * renders the design rather than nothing.
 *
 * Two kinds of token appear here. Where theme.css already owns the semantic
 * (`--pos-surface-raised` for the active pill, `--pos-primary-variant` for the
 * focus ring) it is forwarded directly and the artboard value happens to
 * match. Where the artboard chose a colour theme.css has no equivalent for,
 * a `--reg-rail-*` name carries it, and the dark block below supplies the
 * counterpart. Those names are deliberately overridable: if
 * styles/register-tokens.css later hoists them, these rules pick the hoisted
 * value up with no edit here.
 */
.register-rail {
	width: 96px;
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 9px 8px;
	background: var(--reg-rail-surface, #eef1f4);
	border-right: 1px solid var(--reg-rail-border, #e2e6ec);
	overflow: hidden;
}

/* Shift closed (§5.1). The rail stays VISIBLE — a cashier needs to see that
 * the register has these destinations and that opening the shift is what
 * unlocks them — but nothing in it is reachable.
 *
 * No `opacity` here any more, and that is deliberate on two counts. It stacked
 * with the per-item disabled colour to render the ENTIRE navigation at 1.66:1,
 * and it dimmed the focus ring too — which the keyboard fix above depends on
 * being visible. The muted surface carries the state instead. */
.register-rail--disabled {
	background: var(--reg-rail-surface-idle, #f2f4f6);
}

.register-rail__group {
	display: flex;
	flex-direction: column;
	gap: 3px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.register-rail__spacer {
	flex: 1;
	min-height: 0;
}

.register-rail__item {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 5px;
	width: 100%;
	/* 66px clears the 44px minimum touch target with room for the two-line
	 * label ("Orden de servicio") the artboard wraps. */
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

/* `[aria-disabled]`, not `:disabled` — the element stays in the tab order on
 * purpose. `--pos-text-muted` measures 4.51:1 on the idle surface, so the
 * state passes AA outright rather than relying on WCAG's exemption for
 * inactive controls. It was 1.66:1 before, and this is the whole navigation
 * for as long as the shift is closed. */
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

/* Dimmed is NOT the same as disabled-by-closed-shift: this one is
 * destination-specific and pairs with the amber dot. */
.register-rail__item--dimmed {
	opacity: 0.55;
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

/* Amber is STATE, and state colours do NOT flip with the theme — a badge that
 * changed hue between light and dark would be teaching the cashier two
 * vocabularies for one signal. The pair measures 7.52:1 on its own fill, which
 * is unaffected by what sits behind it. */
.register-rail__badge {
	position: absolute;
	top: 8px;
	right: 12px;
	min-width: 17px;
	height: 17px;
	padding: 0 4px;
	border-radius: 9px;
	background: var(--reg-rail-badge-bg, #e9a13b);
	color: var(--reg-rail-badge-fg, #2b1d05);
	font-size: 10px;
	font-weight: 700;
	display: grid;
	place-items: center;
}

.register-rail__dot {
	position: absolute;
	top: 10px;
	right: 14px;
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--reg-rail-badge-bg, #e9a13b);
}

.register-rail__avatar {
	display: grid;
	place-items: center;
	height: 56px;
	flex: none;
}

/* ---- dark ------------------------------------------------------------
 * Only the four rail-specific names need a counterpart; everything else in
 * this file already forwards a `--pos-*` token that theme.css flips on its
 * own. Both selectors are needed: `[data-theme]` is the explicit choice and
 * `.v-theme--dark` is what Vuetify sets, and theme.css itself defines the
 * dark palette under both. */
:global([data-theme="dark"]) .register-rail,
:global([data-theme-mode="dark"]) .register-rail,
:global(.v-theme--dark) .register-rail {
	--reg-rail-surface: var(--pos-bg-secondary, #1e1e1e);
	--reg-rail-border: var(--pos-border, rgba(255, 255, 255, 0.12));
	--reg-rail-surface-idle: var(--pos-bg-primary, #121212);
	--reg-rail-label: var(--pos-text-muted, #b0b8c4);
	--reg-rail-label-active: var(--pos-primary, #00d4ff);
}

@media (prefers-color-scheme: dark) {
	:global(:root:not([data-theme="light"])) .register-rail {
		--reg-rail-surface: var(--pos-bg-secondary, #1e1e1e);
		--reg-rail-border: var(--pos-border, rgba(255, 255, 255, 0.12));
		--reg-rail-surface-idle: var(--pos-bg-primary, #121212);
		--reg-rail-label: var(--pos-text-muted, #b0b8c4);
		--reg-rail-label-active: var(--pos-primary, #00d4ff);
	}
}
</style>