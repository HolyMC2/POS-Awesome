<template>
	<section v-if="tabOrders.length || showNew" class="tabs-rail">
		<header class="tabs-rail__header">
			<span class="tabs-rail__title">{{ title }}</span>
			<v-btn
				v-if="showNew"
				size="small"
				variant="text"
				color="primary"
				prepend-icon="mdi-plus"
				data-test="tabs-rail-new"
				@click="emit('new-tab')"
			>
				{{ newLabel }}
			</v-btn>
		</header>
		<div v-if="chips.length" class="tabs-rail__strip">
			<button
				v-for="chip in chips"
				:key="chip.order.order_uid"
				type="button"
				class="tabs-rail__chip"
				:class="[
					`tabs-rail__chip--${chip.age}`,
					{
						'tabs-rail__chip--active': chip.order.order_uid === activeUid,
						'tabs-rail__chip--pending': chip.order.pending_sync,
					},
				]"
				:data-test="`tab-chip-${chip.order.order_uid}`"
				@click="emit('open', chip.order)"
			>
				<span class="tabs-rail__top">
					<span class="tabs-rail__name">{{ chip.name }}</span>
					<span v-if="chip.unsent" class="tabs-rail__unsent">{{ chip.unsent }}</span>
				</span>
				<span class="tabs-rail__meta">
					<span class="tabs-rail__total">{{ chip.total }}</span>
					<span v-if="chip.idle" class="tabs-rail__idle">{{ chip.idle }}</span>
				</span>
			</button>
		</div>
		<p v-else class="tabs-rail__empty">{{ emptyLabel }}</p>
	</section>
</template>

<script setup lang="ts">
/**
 * Named tabs as a first-class peer of tables (spec §4). A table-less open order
 * is the cafetería "name on the cup"; this rail is what lets ONE build serve a
 * dining room and a coffee counter, so it renders in every mode — a counter
 * preset with no floor still gets its tabs.
 *
 * A chip is a ticket, so it carries what a ticket is judged on: what is owed,
 * how long it has sat, and how much of it the kitchen has not seen. The v1
 * showed two unlabelled integers.
 */
import { computed } from "vue";
import { useFloorStore, type OrderRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { ageStep, formatIdleShort, idleMinutes, useFloorClock } from "./floorClock";

defineProps<{ showNew?: boolean }>();
const emit = defineEmits<{
	(event: "open", order: OrderRow): void;
	(event: "new-tab"): void;
}>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const tabOrders = computed(() => floorStore.tabOrders);
const activeUid = computed(() => floorStore.activeOrder?.order_uid || null);
const title = computed(() => verticalStore.t("Tabs"));
const newLabel = computed(() => verticalStore.t("New tab"));
const emptyLabel = computed(() =>
	verticalStore.t("No open tabs — start one with a name on the cup"),
);

const chips = computed(() =>
	tabOrders.value.map((order) => {
		const idle = idleMinutes(order.modified, now.value);
		return {
			order,
			name: order.tab_name || order.order_uid.slice(0, 6),
			total: formatCurrency(Number(order.total) || 0),
			idle: idle === null ? "" : formatIdleShort(idle),
			unsent: Number(order.unsent_count) || 0,
			age: ageStep(idle),
		};
	}),
);
</script>

<style scoped>
.tabs-rail {
	flex: 0 0 auto;
	padding: 6px 8px;
	border-bottom: 1px solid var(--pos-border);
	background: var(--pos-surface);
}

.tabs-rail__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.tabs-rail__title {
	font-size: 12px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--pos-text-secondary);
}

/* Horizontal strip: the rail must never make the page scroll sideways, so the
   overflow lives here. */
.tabs-rail__strip {
	display: flex;
	gap: 6px;
	overflow-x: auto;
	padding-bottom: 2px;
}

.tabs-rail__chip {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 2px;
	flex: 0 0 auto;
	min-width: 104px;
	min-height: 48px;
	padding: 6px 10px;
	border: 1px solid var(--pos-border);
	border-inline-start: 3px solid var(--pos-primary);
	border-radius: 8px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	text-align: start;
	cursor: pointer;
}

.tabs-rail__chip:hover {
	border-color: var(--pos-primary);
}

.tabs-rail__chip--warm {
	border-inline-start-color: var(--pos-warning);
}

.tabs-rail__chip--late {
	border-inline-start-color: var(--pos-error);
}

.tabs-rail__chip--active {
	border-color: var(--pos-primary);
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

/* Queued locally, never confirmed by the server — offline each device sees
   only its own orders (spec §6.8). */
.tabs-rail__chip--pending .tabs-rail__name {
	font-style: italic;
}

.tabs-rail__top {
	display: flex;
	align-items: center;
	gap: 6px;
}

.tabs-rail__name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.tabs-rail__meta {
	display: flex;
	align-items: baseline;
	gap: 8px;
	font-size: 11px;
	color: var(--pos-text-secondary);
}

.tabs-rail__total {
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
}

.tabs-rail__idle {
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-secondary);
}

.tabs-rail__unsent {
	flex: 0 0 auto;
	min-width: 18px;
	padding: 0 5px;
	border-radius: 8px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	line-height: 18px;
	text-align: center;
}

.tabs-rail__empty {
	margin: 2px 0 0;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 12px;
}
</style>
