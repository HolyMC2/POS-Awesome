<template>
	<section
		ref="listRoot"
		class="drafts-list"
		tabindex="-1"
		@keydown="handleKeydown"
	>
		<div class="drafts-list__header">
			<div>
				<p class="drafts-list__eyebrow">{{ eyebrow || __("Ready to resume") }}</p>
				<h4 class="drafts-list__title">{{ title || __("Drafts") }}</h4>
				<p v-if="subtitle" class="drafts-list__subtitle">{{ subtitle }}</p>
			</div>
			<div class="drafts-list__actions">
				<span class="drafts-list__count">{{ parkedOrders.length }}</span>
				<v-btn
					v-if="showManageAll"
					size="small"
					variant="text"
					color="primary"
					data-test="drafts-manage-all"
					@click="$emit('manage-all')"
				>
					{{ __("Manage all") }}
				</v-btn>
			</div>
		</div>

		<!--
			A SKELETON, not a spinner (native-feel round 2). A spinner says
			"something is happening"; these say "four records are on their way
			and this is the shape they will take", which is the only useful
			thing a loading state can say. The ghosts wear `.drafts-list__card`
			itself — the real class, not a copy of its numbers — so the border,
			the radius, the padding and the 8px inner gap cannot drift from the
			cards that replace them, and nothing jumps when they do.

			The wording survives for screen readers: `role="status"` on the
			list, the label unchanged.
		-->
		<div
			v-if="loading"
			class="drafts-list__cards"
			role="status"
			aria-busy="true"
			:aria-label="loadingTitle || __('Loading records...')"
			data-test="drafts-list-loading"
		>
			<div
				v-for="n in 4"
				:key="n"
				class="drafts-list__card drafts-list__card--ghost"
				aria-hidden="true"
			>
				<div class="drafts-list__card-top">
					<span class="drafts-ghost drafts-ghost--title shimmer"></span>
					<span class="drafts-ghost drafts-ghost--amount shimmer"></span>
				</div>
				<div class="drafts-list__meta">
					<span class="drafts-ghost drafts-ghost--meta shimmer"></span>
					<span class="drafts-ghost drafts-ghost--meta shimmer"></span>
				</div>
			</div>
		</div>
		<div v-else-if="parkedOrders.length" class="drafts-list__cards">
			<button
				v-for="(draft, index) in parkedOrders"
				:key="draft.name"
				:ref="(el) => setCardRef(el, index)"
				type="button"
				class="drafts-list__card"
				:class="{ 'drafts-list__card--selected': selectedIndex === index }"
				:tabindex="selectedIndex === index ? 0 : -1"
				:aria-current="selectedIndex === index ? 'true' : undefined"
				:data-test="`draft-list-card-${draft.name}`"
				@focus="selectedIndex = index"
				@mouseenter="selectedIndex = index"
				@keydown.stop="handleKeydown"
				@click="$emit('resume', draft)"
			>
				<div class="drafts-list__card-top">
					<strong>{{ draft.posa_rt_tab_name || draft.customer_name || __("Walk-in Customer") }}</strong>
					<span class="drafts-list__amount">
						{{ currencySymbol(draft.currency) }}{{ formatCurrency(draft.grand_total) }}
					</span>
				</div>
				<div class="drafts-list__meta">
					<span v-if="draft.posa_rt_guest_count">{{ draft.posa_rt_guest_count }} {{ __("guests") }}</span>
					<span v-if="draft.posa_rt_service_type">{{ verticalStore.t(draft.posa_rt_service_type) }}</span>
					<span>{{ draft.name }}</span>
					<span>{{ draft.posting_date }}</span>
					<span>{{ draft.posting_time?.split(".")[0] || "" }}</span>
				</div>
			</button>
		</div>
		<div v-else class="drafts-list__empty">
			<strong>{{ emptyTitle || __("No records found") }}</strong>
			<span>{{ emptySubtitle || __("Try another source or refresh the list.") }}</span>
		</div>
	</section>
</template>

<script setup>
import { nextTick, ref, watch } from "vue";
// The register's ONE skeleton shimmer — see `styles/shimmer.css`.
import "../../../styles/shimmer.css";
import { useVerticalStore } from "../../../stores/verticalStore";

// Service-type label through the vocabulary (matches the InvoiceSummary select),
// so a preset's "Dine In" → "Para aquí" shows the same word on both screens.
const verticalStore = useVerticalStore();

const props = defineProps({
	parkedOrders: {
		type: Array,
		default: () => [],
	},
	formatCurrency: {
		type: Function,
		required: true,
	},
	currencySymbol: {
		type: Function,
		required: true,
	},
	showManageAll: {
		type: Boolean,
		default: false,
	},
	title: {
		type: String,
		default: "",
	},
	eyebrow: {
		type: String,
		default: "",
	},
	subtitle: {
		type: String,
		default: "",
	},
	emptyTitle: {
		type: String,
		default: "",
	},
	emptySubtitle: {
		type: String,
		default: "",
	},
	loading: {
		type: Boolean,
		default: false,
	},
	loadingTitle: {
		type: String,
		default: "",
	},
});

const emit = defineEmits(["resume", "manage-all", "close"]);

const __ = window.__;
const listRoot = ref(null);
const cardRefs = ref([]);
const selectedIndex = ref(0);

function clampSelectedIndex() {
	const maxIndex = props.parkedOrders.length - 1;
	if (maxIndex < 0) {
		selectedIndex.value = 0;
		return;
	}
	selectedIndex.value = Math.min(Math.max(selectedIndex.value, 0), maxIndex);
}

function setCardRef(el, index) {
	if (el) {
		cardRefs.value[index] = el;
	}
}

function focusSelectedDraft() {
	return nextTick(() => {
		clampSelectedIndex();
		const button = cardRefs.value[selectedIndex.value];
		if (button?.focus) {
			button.focus({ preventScroll: true });
			button.scrollIntoView?.({ block: "nearest" });
			return;
		}
		listRoot.value?.focus?.({ preventScroll: true });
	});
}

function focusFirstDraft() {
	selectedIndex.value = 0;
	return focusSelectedDraft();
}

function selectOffset(offset) {
	const count = props.parkedOrders.length;
	if (!count) {
		return;
	}
	selectedIndex.value = (selectedIndex.value + offset + count) % count;
	focusSelectedDraft();
}

function resumeSelectedDraft() {
	const draft = props.parkedOrders[selectedIndex.value];
	if (draft) {
		emit("resume", draft);
	}
}

function isManageAllTarget(target) {
	return Boolean(target?.closest?.('[data-test="drafts-manage-all"]'));
}

function handleKeydown(event) {
	if (event.key === "Escape") {
		event.preventDefault();
		emit("close");
		return;
	}

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectOffset(1);
		return;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectOffset(-1);
		return;
	}

	if (event.key === "Home") {
		event.preventDefault();
		selectedIndex.value = 0;
		focusSelectedDraft();
		return;
	}

	if (event.key === "End") {
		event.preventDefault();
		selectedIndex.value = Math.max(0, props.parkedOrders.length - 1);
		focusSelectedDraft();
		return;
	}

	if ((event.key === "Enter" || event.key === " ") && !isManageAllTarget(event.target)) {
		event.preventDefault();
		resumeSelectedDraft();
	}
}

watch(
	() => props.parkedOrders.length,
	() => {
		cardRefs.value = [];
		clampSelectedIndex();
	},
);

defineExpose({
	focusFirstDraft,
	focusSelectedDraft,
});
</script>

<style scoped>
.drafts-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.drafts-list__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}

.drafts-list__eyebrow {
	margin: 0 0 2px;
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
}

.drafts-list__title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.drafts-list__subtitle {
	margin: 4px 0 0;
	font-size: 0.82rem;
	color: var(--pos-text-secondary);
}

.drafts-list__actions {
	display: flex;
	align-items: center;
	gap: 8px;
}

.drafts-list__count {
	min-width: 28px;
	height: 28px;
	padding: 0 8px;
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: rgba(var(--v-theme-primary), 0.14);
	color: rgb(var(--v-theme-primary));
	font-weight: 700;
}

.drafts-list__cards {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: calc(100vh - 180px);
	overflow: auto;
	padding-right: 2px;
}

.drafts-list__empty {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	padding: 18px 16px;
	border-radius: 18px;
	border: 1px dashed rgba(var(--v-theme-primary), 0.24);
	background: rgba(var(--v-theme-surface), 0.72);
	color: var(--pos-text-secondary);
}

/* The ghost card keeps the real card's box and drops only what it cannot
   promise: no hover lift, no pointer, no transition to run. */
.drafts-list__card--ghost {
	cursor: default;
	transition: none;
}

.drafts-ghost {
	display: block;
	position: relative;
	overflow: hidden;
	height: 12px;
	border-radius: 6px;
	background: rgba(var(--v-theme-on-surface), 0.09);
}

/* Widths, not content: each bar stands where the text it precedes will. */
.drafts-ghost--title {
	width: 46%;
	min-width: 96px;
}

.drafts-ghost--amount {
	width: 72px;
	flex: none;
}

.drafts-ghost--meta {
	width: 64px;
	height: 9px;
}

.drafts-list__empty strong {
	color: var(--pos-text-primary);
}

.drafts-list__card {
	border: 1px solid rgba(var(--v-theme-primary), 0.14);
	border-radius: 16px;
	background: rgba(var(--v-theme-surface), 0.92);
	padding: 12px;
	text-align: left;
	display: flex;
	flex-direction: column;
	gap: 8px;
	cursor: pointer;
	color: var(--pos-text-primary);
	transition:
		transform var(--motion-base) var(--ease-out),
		box-shadow var(--motion-base) var(--ease-out),
		border-color var(--motion-base) var(--ease-out);
}

.drafts-list__card:hover,
.drafts-list__card:focus-visible,
.drafts-list__card--selected {
	transform: translateY(-1px);
	box-shadow: 0 10px 18px rgba(15, 23, 42, 0.12);
	border-color: rgba(var(--v-theme-primary), 0.34);
}

.drafts-list__card:focus-visible,
.drafts-list__card--selected {
	outline: 2px solid rgba(var(--v-theme-primary), 0.62);
	outline-offset: 2px;
}

/* Press feedback (native-feel round 2). AFTER the hover/selected rules and at
   the same specificity, because the press has to win over the lift they
   apply: `transform` does not compose across rules, so this restates the
   resting position instead of adding a scale to a translate. */
.drafts-list__card:active {
	transform: translateY(0) scale(var(--press-scale, 0.98));
	transition: transform var(--motion-fast) var(--ease-out);
}

.drafts-list__card-top {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.drafts-list__amount {
	font-weight: 700;
	white-space: nowrap;
}

.drafts-list__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 10px;
	font-size: 0.8rem;
	color: var(--pos-text-secondary);
}
</style>
