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
		<div class="tabs-rail__strip">
			<button
				v-for="order in tabOrders"
				:key="order.order_uid"
				type="button"
				class="tabs-rail__chip"
				:class="{
					'tabs-rail__chip--active': order.order_uid === activeUid,
					'tabs-rail__chip--pending': order.pending_sync,
				}"
				:data-test="`tab-chip-${order.order_uid}`"
				@click="emit('open', order)"
			>
				<span class="tabs-rail__name">{{ order.tab_name || order.order_uid.slice(0, 6) }}</span>
				<span class="tabs-rail__meta">
					<span v-if="order.items_count">{{ order.items_count }}</span>
					<span v-if="order.unsent_count" class="tabs-rail__unsent">{{ order.unsent_count }}</span>
				</span>
			</button>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Named tabs as a first-class peer of tables (spec §4). A table-less open order
 * is the cafetería "name on the cup"; this rail is what lets ONE build serve a
 * dining room and a coffee counter, so it renders in every mode — a counter
 * preset with no floor still gets its tabs.
 */
import { computed } from "vue";
import { useFloorStore, type OrderRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

defineProps<{ showNew?: boolean }>();
const emit = defineEmits<{
	(event: "open", order: OrderRow): void;
	(event: "new-tab"): void;
}>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

const tabOrders = computed(() => floorStore.tabOrders);
const activeUid = computed(() => floorStore.activeOrder?.order_uid || null);
const title = computed(() => verticalStore.t("Tabs"));
const newLabel = computed(() => verticalStore.t("New tab"));
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
	letter-spacing: 0.04em;
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
	align-items: flex-start;
	gap: 1px;
	flex: 0 0 auto;
	min-width: 88px;
	min-height: 44px;
	padding: 6px 10px;
	border: 1px solid var(--pos-border);
	border-radius: 8px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	text-align: start;
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

.tabs-rail__name {
	font-size: 13px;
	font-weight: 600;
	color: var(--pos-text-primary);
}

.tabs-rail__meta {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	color: var(--pos-text-secondary);
}

.tabs-rail__unsent {
	padding: 0 5px;
	border-radius: 8px;
	background: var(--pos-error);
	color: #ffffff;
	font-weight: 700;
}
</style>
