<template>
	<section class="ticket-panel" :class="`ticket-panel--${variant}`" data-test="floor-ticket-panel">
		<header class="ticket-panel__head">
			<span class="ticket-panel__where">
				<v-icon :icon="order.table ? 'mdi-table-furniture' : 'mdi-receipt-text-outline'" size="16" />
				<span class="ticket-panel__title">{{ title }}</span>
			</span>
			<strong class="ticket-panel__total">{{ totalLabel }}</strong>
		</header>

		<dl class="ticket-panel__facts">
			<div v-for="fact in facts" :key="fact.key" class="ticket-panel__fact">
				<dt class="ticket-panel__fact-term">
					<v-icon :icon="fact.icon" size="14" />
					<span>{{ fact.term }}</span>
				</dt>
				<dd class="ticket-panel__fact-value" :class="fact.tone ? `ticket-panel__fact-value--${fact.tone}` : ''">
					{{ fact.value }}
				</dd>
			</div>
		</dl>

		<div class="ticket-panel__actions">
			<!-- Enabled even at zero unsent: lines typed in the last second are
			     still in the cart-sync debounce, and `fireActiveCourse` flushes
			     before it fires. Gating on the count would refuse the one press
			     that matters — the one right after the order was taken. -->
			<button
				type="button"
				class="ticket-panel__action ticket-panel__action--primary"
				:disabled="firing"
				data-test="floor-fire"
				@click="emit('fire')"
			>
				<v-icon icon="mdi-silverware-variant" size="18" />
				<span class="ticket-panel__action-text">{{ fireLabel }}</span>
				<span v-if="order.unsent_count" class="ticket-panel__action-badge">{{ order.unsent_count }}</span>
			</button>
			<button
				type="button"
				class="ticket-panel__action"
				data-test="floor-transfer"
				@click="emit('transfer')"
			>
				<v-icon icon="mdi-swap-horizontal" size="18" />
				<span class="ticket-panel__action-text">{{ transferLabel }}</span>
			</button>
			<!-- Spec §3: releasing a table is cancelling its EMPTY order. Offered
			     only when there is nothing to lose, so it never needs a confirm
			     and never eats someone's food. -->
			<button
				v-if="!order.items_count"
				type="button"
				class="ticket-panel__action ticket-panel__action--quiet"
				:disabled="releasing"
				data-test="floor-release"
				@click="emit('release')"
			>
				<v-icon icon="mdi-close-circle-outline" size="18" />
				<span class="ticket-panel__action-text">{{ releaseLabel }}</span>
			</button>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The open ticket, expanded — what the v1 shipped as a 4px-padded strip of two
 * text buttons above the plan.
 *
 * It deliberately shows the ACTIVE order rather than a "selected table". Tap IS
 * the transition (spec §4): a floor where tapping selects and a second control
 * opens is the "seat party" dialog the canon rejects, wearing a different hat.
 * So the panel is the ticket the waiter already has open, and the plan stays
 * one-tap.
 *
 * One component, two shapes. `variant` comes from the parent's MEASURED width —
 * the floor lives inside the shell's selector column, so window width says
 * nothing useful about how much room this panel actually has.
 */
import { computed } from "vue";
import { useFloorClock, formatIdleShort, idleMinutes, ageStep } from "./floorClock";
import type { OrderRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";

const props = defineProps<{
	order: OrderRow;
	/** Table label resolved by the parent — the order carries only the docname. */
	tableLabel: string;
	variant: "rail" | "strip";
	firing?: boolean;
	releasing?: boolean;
}>();

const emit = defineEmits<{
	(event: "fire"): void;
	(event: "transfer"): void;
	(event: "release"): void;
}>();

const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const fireLabel = computed(() => verticalStore.t("Send"));
const transferLabel = computed(() => verticalStore.t("Transfer"));
const releaseLabel = computed(() => verticalStore.t("Release"));

const title = computed(
	() => props.order.tab_name || props.tableLabel || props.order.order_uid.slice(0, 6),
);

const totalLabel = computed(() => formatCurrency(Number(props.order.total) || 0));

const idle = computed(() => idleMinutes(props.order.modified, now.value));

/**
 * The facts a waiter actually acts on, in the order they act on them. Guests
 * and who opened it settle "is this mine"; idle time settles "does it need me
 * now"; the line counts settle "what am I walking to the kitchen with".
 */
const facts = computed(() => {
	const rows: Array<{
		key: string;
		icon: string;
		term: string;
		value: string;
		tone?: "warm" | "late";
	}> = [];
	if (props.order.guest_count) {
		rows.push({
			key: "guests",
			icon: "mdi-account-group-outline",
			term: verticalStore.t("Guests"),
			value: String(props.order.guest_count),
		});
	}
	if (props.order.opened_by) {
		rows.push({
			key: "opened_by",
			icon: "mdi-account-circle-outline",
			term: verticalStore.t("Opened by"),
			value: props.order.opened_by,
		});
	}
	if (idle.value !== null) {
		const step = ageStep(idle.value);
		rows.push({
			key: "idle",
			icon: "mdi-clock-outline",
			term: verticalStore.t("Idle"),
			value: `${formatIdleShort(idle.value)}`,
			tone: step === "fresh" ? undefined : step,
		});
	}
	rows.push({
		key: "lines",
		icon: "mdi-receipt-text-outline",
		term: verticalStore.t("Lines"),
		value: String(props.order.items_count || 0),
	});
	return rows;
});
</script>

<style scoped>
.ticket-panel {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px 12px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
}

/* Rail: the panel owns a column beside the plan, so it can breathe vertically
   and scroll on its own if a venue ever adds more facts. */
.ticket-panel--rail {
	flex: 0 0 auto;
	min-height: 0;
	overflow-y: auto;
	border-inline-start: 1px solid var(--pos-border);
}

/* Strip: pinned under the plan on a phone. It must not steal height from the
   board, so the facts run as one wrapping line and the actions are the only
   thing guaranteed a full row. */
.ticket-panel--strip {
	flex: 0 0 auto;
	gap: 8px;
	padding: 8px 10px;
	border-top: 1px solid var(--pos-border);
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.ticket-panel__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	min-width: 0;
}

.ticket-panel__where {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	color: var(--pos-text-secondary);
}

.ticket-panel__title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: -0.01em;
	color: var(--pos-text-primary);
}

.ticket-panel__total {
	flex: 0 0 auto;
	font-size: 17px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
}

.ticket-panel__facts {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	margin: 0;
}

.ticket-panel--rail .ticket-panel__facts {
	flex-direction: column;
	gap: 6px;
}

.ticket-panel__fact {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	min-width: 0;
}

.ticket-panel__fact-term {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--pos-text-secondary);
}

.ticket-panel--strip .ticket-panel__fact-term span {
	/* On a phone the icon carries the meaning; the word is the first thing to
	   go when the row has to fit beside three others. */
	display: none;
}

.ticket-panel__fact-value {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	background: transparent;
	color: var(--pos-text-primary);
}

.ticket-panel__fact-value--warm {
	color: var(--pos-button-warning-text);
}

.ticket-panel__fact-value--late {
	color: var(--pos-error);
}

.ticket-panel__actions {
	display: flex;
	gap: 6px;
}

.ticket-panel--rail .ticket-panel__actions {
	flex-direction: column;
}

.ticket-panel__action {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	flex: 1 1 0;
	min-width: 0;
	min-height: 44px;
	padding: 0 12px;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	transition:
		background-color 120ms ease-out,
		border-color 120ms ease-out;
}

.ticket-panel__action:hover:not(:disabled) {
	background: var(--pos-hover-bg);
	border-color: var(--pos-primary);
}

.ticket-panel__action:disabled {
	opacity: 0.45;
	cursor: default;
}

.ticket-panel__action--primary:not(:disabled) {
	border-color: var(--pos-primary);
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.ticket-panel__action--quiet {
	flex: 0 1 auto;
	color: var(--pos-text-secondary);
}

.ticket-panel__action-text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ticket-panel__action-badge {
	min-width: 18px;
	padding: 0 5px;
	border-radius: 9px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	line-height: 18px;
	font-variant-numeric: tabular-nums;
	text-align: center;
}
</style>
