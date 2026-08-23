<template>
	<div
		class="catalog-drawer-layer"
		:class="[`catalog-drawer-layer--${presentation}`, { 'catalog-drawer-layer--closed': phase === 'closed' }]"
		data-testid="catalog-drawer"
		:data-drawer-state="phase"
		:data-open-reason="openReason ?? undefined"
	>
		<!--
			SINGLE ROOT ON PURPOSE, and this comment lives INSIDE it on purpose
			too: a top-level comment in a Vue template is itself a root node, so
			hoisting this above the div would quietly make the component a
			fragment — which is what makes `wrapper.attributes()` read the
			wrong element and `find().trigger()` hit a shared parent.

			The layer carries the GEOMETRY (anchored column vs absolute sheet)
			and the machine state the evidence lane reads; the panel inside it
			carries the CHROME. Keeping those apart is what lets the same panel
			serve both presentations without restyling itself.
		-->

		<!--
			Scrim: overlay presentation only. An anchored drawer sits beside the
			cart and must not dim the register the cashier is still using.
		-->
		<div
			v-if="showsScrim && phase !== 'closed'"
			class="catalog-drawer__scrim"
			:class="{ 'catalog-drawer__scrim--in': phase === 'open' || phase === 'opening' }"
			data-testid="catalog-drawer-scrim"
			@click="requestClose"
		></div>

		<!--
			`aside` when anchored, `dialog` when overlaid. The semantic follows the
			behaviour rather than the other way round: only the overlay traps focus,
			so only the overlay may claim `aria-modal`. Announcing an anchored panel
			as modal would tell a screen-reader user the cart is unreachable while
			it demonstrably is not.
		-->
		<!--
			NO `v-if` HERE, and that is the whole point. `useScannerInput` binds
			the keyboard wedge to the DOCUMENT behind a singleton flag, so
			unmounting the selector once takes the shop's barcode gun down until
			a reload — a cashier closing the catalogue would silently break
			scanning. Nothing inside this panel may unmount on open/close.

			So the panel is permanently mounted and the layer's `display: none`
			is the SINGLE hiding mechanism. That also makes the hidden panel
			genuinely inert: `display: none` removes it from the accessibility
			tree and from the tab order, which a `visibility`/`opacity` trick
			would not.
		-->
		<aside
			ref="rootEl"
			class="catalog-drawer"
			:class="{ 'catalog-drawer--in': phase === 'open' || phase === 'opening' }"
			:style="{ '--catalog-drawer-duration': `${transitionDurationMs}ms` }"
			:role="trapsFocus ? 'dialog' : undefined"
			:aria-modal="trapsFocus ? 'true' : undefined"
			:aria-label="__('Catalogue')"
			data-testid="catalog-drawer-panel"
			:data-presentation="presentation"
			@keydown="onKeydown"
		>
			<header class="catalog-drawer__header">
				<svg
					class="catalog-drawer__glyph"
					width="17"
					height="17"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<rect x="3" y="3" width="7" height="7" rx="2" />
					<rect x="14" y="3" width="7" height="7" rx="2" />
					<rect x="3" y="14" width="7" height="7" rx="2" />
					<rect x="14" y="14" width="7" height="7" rx="2" />
				</svg>
				<span class="catalog-drawer__title">{{ __("Catalogue") }}</span>
				<div class="catalog-drawer__spacer"></div>

				<!--
					The "Anclado" chip. Only offered where anchoring actually fits —
					below the two-column boundary there is no 400px to anchor into,
					so presenting the choice would be presenting a lie.
				-->
				<button
					v-if="canAnchor"
					type="button"
					class="catalog-drawer__chip catalog-drawer__chip--anchor"
					:class="{ 'catalog-drawer__chip--on': presentation === 'anchored' }"
					:aria-pressed="presentation === 'anchored' ? 'true' : 'false'"
					data-testid="catalog-drawer-anchor"
					@click="toggleAnchor"
				>
					{{ presentation === "anchored" ? __("Anchored") : __("Floating") }}
				</button>

				<button
					ref="closeEl"
					type="button"
					class="catalog-drawer__close"
					:aria-label="__('Close catalogue')"
					data-testid="catalog-drawer-close"
					@click="requestClose"
				>
					×
				</button>
			</header>

			<!--
				Contextual filter strip ("Compatible con iPhone 15 Pro"). A slot, not
				a prop: what qualifies as compatibility is the register's question,
				not the drawer's, and a carnicería has no answer to it at all.
			-->
			<div v-if="$slots.compat" class="catalog-drawer__compat">
				<slot name="compat"></slot>
			</div>

			<!--
				Category chips. Rendered only when the register feeds categories, so
				a shell that prefers the selector's own grouping simply passes none
				and gets no second row of chips.
			-->
			<div
				v-if="categories.length"
				class="catalog-drawer__chips"
				role="tablist"
				:aria-label="__('Categories')"
			>
				<button
					v-for="category in categories"
					:key="category.id"
					type="button"
					role="tab"
					class="catalog-drawer__chip"
					:class="{ 'catalog-drawer__chip--on': category.id === activeCategory }"
					:aria-selected="category.id === activeCategory ? 'true' : 'false'"
					:data-testid="`catalog-drawer-category-${category.id}`"
					@click="pickCategory(category.id)"
				>
					{{ category.label }}
					<span
						v-if="category.count !== null && category.count !== undefined"
						class="catalog-drawer__count mono"
						>{{ category.count }}</span
					>
				</button>
			</div>

			<!--
				The catalogue itself is SLOTTED, never re-implemented: the selector
				owns the search, the virtual scroller and the height chain that
				`useItemsSelectorPanelSizing` sets up, and none of that is this
				component's business. The drawer only supplies the frame.

				`persistent` is where the never-unmounting selector goes. It sits
				inside the panel body, so it inherits the panel's geometry in BOTH
				presentations for free — a 400px flex column when anchored, the
				same column inside an absolutely-positioned sheet when overlaid —
				without a single presentation-specific rule of its own. Anything
				placed here shares the panel's lifetime, which is the register's
				lifetime.

				Provide this slot UNCONDITIONALLY. A parent that toggles whether it
				passes the slot re-creates the remount this exists to prevent.
			-->
			<div class="catalog-drawer__body">
				<div v-if="$slots.persistent" class="catalog-drawer__persistent">
					<slot name="persistent"></slot>
				</div>
				<slot></slot>
			</div>

			<!--
				Always rendered: the "Esc closes" affordance is a promise the
				artboard footer makes on every state of this panel.
			-->
			<footer class="catalog-drawer__footer">
				<span v-if="footerHint" class="catalog-drawer__hint">{{ footerHint }}</span>
				<div class="catalog-drawer__spacer"></div>
				<span class="catalog-drawer__chip catalog-drawer__chip--muted mono">{{
					__("Esc closes")
				}}</span>
			</footer>
		</aside>
	</div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

import type {
	CatalogCategory,
	CatalogDrawerOpenReason,
	CatalogDrawerPhase,
	CatalogDrawerPresentation,
} from "../../../../composables/pos/shell/useCatalogDrawer";

const __ = window.__ || ((value: string) => value);

const props = withDefaults(
	defineProps<{
		phase: CatalogDrawerPhase;
		presentation: CatalogDrawerPresentation;
		/** See `CatalogCategory` — combos arrive here from the combos module. */
		categories?: CatalogCategory[];
		activeCategory?: string | null;
		/** Surfaced as `data-open-reason` for the evidence lane and for tests. */
		openReason?: CatalogDrawerOpenReason | null;
		trapsFocus?: boolean;
		showsScrim?: boolean;
		transitionDurationMs?: number;
		/** Whether the anchored/floating choice is offered at this width. */
		canAnchor?: boolean;
		footerHint?: string | null;
	}>(),
	{
		categories: () => [],
		activeCategory: null,
		openReason: null,
		trapsFocus: false,
		showsScrim: false,
		transitionDurationMs: 0,
		canAnchor: false,
		footerHint: null,
	},
);

const emit = defineEmits<{
	(event: "close"): void;
	(event: "update:activeCategory", categoryId: string | null): void;
	(event: "update:anchored", anchored: boolean): void;
	/**
	 * Fired once the panel has settled visible. A virtualised grid inside
	 * `persistent` measures ZERO height while the layer is `display: none`, so
	 * it can come back with no rows rendered until something tells it to
	 * re-measure. This is that moment, named, rather than every consumer
	 * guessing at a `setTimeout`.
	 */
	(event: "opened"): void;
}>();

/*
 * Named handlers rather than inline `emit(...)` expressions. Two reasons: the
 * selection rule ("clicking the active chip clears it") is logic and belongs
 * beside the other logic, not in an attribute; and the template resolves these
 * unambiguously, which inline `emit(...)` did not.
 */
function requestClose(): void {
	emit("close");
}

function pickCategory(categoryId: string): void {
	// Re-picking the active category clears the filter — the operator's second
	// click on the same chip means "show me everything again", not "confirm".
	emit("update:activeCategory", categoryId === props.activeCategory ? null : categoryId);
}

function toggleAnchor(): void {
	emit("update:anchored", props.presentation !== "anchored");
}

const rootEl = ref<HTMLElement | null>(null);
const closeEl = ref<HTMLElement | null>(null);

const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableChildren(): HTMLElement[] {
	const root = rootEl.value;
	if (!root) {
		return [];
	}
	// Deliberately NOT filtered on `offsetParent`: that is a layout question,
	// and the only conditional content in this panel is already governed by
	// `v-if`, so nothing focusable is present-but-hidden. Filtering on layout
	// would also make this untestable under jsdom, which performs none.
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
	);
}

/**
 * Tab cycling, overlay only. The composable decides WHETHER to trap
 * (`trapsFocus`); this only implements it, so the anchored panel keeps normal
 * tab order into and out of the cart.
 */
function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		event.preventDefault();
		requestClose();
		return;
	}
	if (event.key !== "Tab" || !props.trapsFocus) {
		return;
	}

	const focusable = focusableChildren();
	if (focusable.length === 0) {
		return;
	}
	const first = focusable[0]!;
	const last = focusable[focusable.length - 1]!;
	const active = document.activeElement;

	if (event.shiftKey && (active === first || !rootEl.value?.contains(active))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active === last) {
		event.preventDefault();
		first.focus();
	}
}

/*
 * One `display: none` → visible transition costs one layout pass, which is the
 * same single reflow the anchored path already pays. What it can ALSO cost is a
 * virtual scroller that cached a zero height while hidden; `opened` is the hook
 * for re-measuring it, and it fires only on the settled state so nobody
 * re-measures against a mid-transition box.
 */
watch(
	() => props.phase,
	(phase, previous) => {
		if (phase === "open" && previous !== "open") {
			emit("opened");
		}
	},
);

// Moving focus in is the trap's other half: without it the operator's focus
// stays behind the scrim and Tab cycles a surface they cannot see.
watch(
	() => [props.phase, props.trapsFocus] as const,
	async ([phase, traps]) => {
		if (!traps || phase === "closed" || phase === "closing") {
			return;
		}
		await nextTick();
		if (rootEl.value?.contains(document.activeElement)) {
			return;
		}
		(focusableChildren()[0] ?? closeEl.value)?.focus();
	},
	{ immediate: true },
);

defineExpose({ focusableChildren });
</script>

<style scoped>
/*
 * ANIMATION CONTRACT — enforced by tests/catalogDrawerAnimation.spec.ts.
 * Only `transform` and `opacity` may ever appear in a `transition`. Anchored
 * open/close is instant by design (pushing the cart IS layout, so there is no
 * compositor-only way to animate it); animating `width` here would buy a
 * gesture and pay a reflow per frame for it.
 */

/*
 * GEOMETRY lives on the layer; CHROME lives on the panel. Keeping them apart is
 * what lets the same panel be a flex sibling of the cart in one presentation
 * and an absolutely-positioned sheet in the other, without restyling itself.
 */

/*
 * Closed still renders — the evidence lane and the shortcut layer both want a
 * stable element to read `data-drawer-state` off. `display: none` keeps that
 * promise without letting an empty 400px column into the row.
 */
.catalog-drawer-layer--closed {
	display: none;
}

/*
 * Anchored: a plain flex sibling of the cart, inside the content row. It is
 * deliberately NOT positioned — the band below is full width and the drawer
 * "never reaches it" (Cajon.dc.html), which is only true while the drawer
 * stays inside the row's flow.
 */
.catalog-drawer-layer--anchored {
	position: relative;
	width: 400px;
	flex: none;
	display: flex;
	min-height: 0;
}

/*
 * Overlay: absolute within the content row, not fixed to the viewport, for the
 * same reason — the band must stay visible and reachable underneath. The lead
 * gives the row `position: relative`; see the wiring note in the build report.
 */
.catalog-drawer-layer--overlay {
	position: absolute;
	inset: 0;
	z-index: 11;
	display: flex;
	justify-content: flex-end;
	min-height: 0;
}

/*
 * Inline: the compact shell's selector PANEL, in flow, taking the whole row.
 * Not a drawer over anything — below the two-column boundary the dock shows
 * one panel at a time and this is one of them, so it neither pushes a cart
 * that is off screen nor covers one. No `position`, no `z-index`, and nothing
 * animated at all — Browse has to flip exactly as fast as Cart and Cupones do.
 */
.catalog-drawer-layer--inline {
	flex: 1 1 100%;
	display: flex;
	min-width: 0;
	min-height: 0;
	padding: var(--dynamic-sm);
	margin-top: var(--dynamic-sm);
}

.catalog-drawer {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	width: 400px;
	max-width: 100%;
	flex: none;
	min-height: 0;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	border-radius: 14px;
	box-shadow: -8px 0 24px -18px rgba(16, 20, 30, 0.4);
}

.catalog-drawer-layer--anchored .catalog-drawer {
	flex: 1;
}

.catalog-drawer-layer--inline .catalog-drawer {
	width: 100%;
	flex: 1;
	/* The edge shadow draws a panel sliding in from the right. Inline nothing
	 * slid, so it would be a shadow cast by a movement that never happened. */
	box-shadow: none;
}

.catalog-drawer-layer--overlay .catalog-drawer {
	position: relative;
	z-index: 1;
	transform: translateX(100%);
	opacity: 0;
	will-change: transform, opacity;
	transition:
		transform var(--catalog-drawer-duration, 180ms) cubic-bezier(0.2, 0, 0, 1),
		opacity var(--catalog-drawer-duration, 180ms) linear;
}

.catalog-drawer-layer--overlay .catalog-drawer--in {
	transform: translateX(0);
	opacity: 1;
}

.catalog-drawer__scrim {
	position: absolute;
	inset: 0;
	z-index: 11;
	background: var(--reg-scrim, rgba(15, 23, 42, 0.32));
	opacity: 0;
	transition: opacity 180ms linear;
}

.catalog-drawer__scrim--in {
	opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
	.catalog-drawer-layer--overlay .catalog-drawer,
	.catalog-drawer__scrim {
		transition: none;
	}
}

.catalog-drawer__header {
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 0 14px;
	height: 48px;
	border-bottom: 1px solid var(--reg-divider, #eceff3);
	flex: none;
}

.catalog-drawer__glyph {
	color: var(--reg-accent, #0097a7);
	flex: none;
}

.catalog-drawer__title {
	font-size: 14.5px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.catalog-drawer__spacer {
	flex: 1;
}

/*
 * A1 (wave 3): 26px visual against the project's own 44px bar. It PASSES WCAG
 * 2.2 AA 2.5.8 (24x24), so this is a house-rule gap, not a conformance one —
 * and a 44px HIT area does not require a 44px visual. The pseudo-element below
 * gives the full target without inflating the drawer header, which the canvas
 * draws at 48px total.
 *
 * Deliberately NOT applied to the category chips: they sit in a dense
 * horizontally-scrolling row, so 44px hit areas would overlap their
 * neighbours and start stealing each other's taps — a worse outcome than a
 * 26px target that already clears 2.5.8. They keep their visual and their
 * spacing.
 */
.catalog-drawer__close {
	position: relative;
	width: 26px;
	height: 26px;
	border-radius: 8px;
	display: grid;
	place-items: center;
	color: var(--reg-text-muted, #9aa2ae);
	font-size: 16px;
	background: none;
	border: none;
	cursor: pointer;
	font-family: inherit;
}

.catalog-drawer__close::before {
	content: "";
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: var(--reg-touch-min, 44px);
	height: var(--reg-touch-min, 44px);
}

.catalog-drawer__compat {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 14px;
	background: var(--reg-surface-sunken, #fbfcfd);
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
	flex: none;
}

.catalog-drawer__chips {
	display: flex;
	gap: 6px;
	padding: 10px 14px 8px;
	flex: none;
	overflow-x: auto;
}

.catalog-drawer__chip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 6px 11px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 500;
	color: var(--reg-text-secondary, #56606e);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	white-space: nowrap;
	cursor: pointer;
	font-family: inherit;
}

.catalog-drawer__chip--on {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	border-color: var(--reg-accent-edge, #9fdde6);
	font-weight: 700;
}

.catalog-drawer__chip--muted {
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	border-color: transparent;
	cursor: default;
}

.catalog-drawer__count {
	opacity: 0.6;
}

/*
 * `min-height: 0` is load-bearing, the same way it is in the invoice column:
 * a flex child defaults to `min-height: auto` and refuses to shrink below its
 * content, which would push the footer off the panel instead of letting the
 * slotted selector scroll.
 */
.catalog-drawer__body {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

/*
 * Same height-chain rule commit 59c5fe1ad established for the invoice column,
 * for the same reason: `min-height: 0` is the load-bearing half, because a flex
 * child defaults to `min-height: auto` and refuses to shrink below its content.
 * Without it a tall catalogue grid pushes the footer off the panel instead of
 * scrolling inside it.
 */
.catalog-drawer__persistent {
	flex: 1 1 auto;
	min-height: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.catalog-drawer__footer {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 9px 14px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
	background: var(--reg-surface-sunken, #fcfdfe);
	flex: none;
}

.catalog-drawer__hint {
	font-size: 11px;
	color: var(--reg-text-muted, #9aa2ae);
}

/*
 * The footer promises "Esc cierra", and inline is the one presentation that
 * cannot keep it: a phone has no Esc key, and the row it costs comes straight
 * off the grid. Hidden rather than removed from the template — the panel is
 * the same panel in all three presentations, and only this promise changes.
 */
.catalog-drawer-layer--inline .catalog-drawer__footer {
	display: none;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
