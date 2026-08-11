<template>
	<div class="floor-kanban">
		<div class="floor-kanban__scroller">
			<section v-for="column in columns" :key="column.key" class="floor-kanban__column">
				<header class="floor-kanban__header">
					<span class="floor-kanban__title">{{ column.title }}</span>
					<span class="floor-kanban__count">{{ column.rows.length }}</span>
				</header>
				<button
					v-for="row in column.rows"
					:key="row.table.name"
					type="button"
					class="floor-kanban__card"
					:class="{
						'floor-kanban__card--blocked': transferActive && row.occupied,
						'floor-kanban__card--pending': row.pending,
					}"
					:disabled="transferActive && row.occupied"
					@click="onTap(row)"
				>
					<span class="floor-kanban__card-top">
						<strong class="floor-kanban__label">{{ row.table.table_label }}</strong>
						<span v-if="row.unsent" class="floor-kanban__badge">{{ row.unsent }}</span>
					</span>
					<span class="floor-kanban__meta">
						<span v-if="row.occupied">{{ row.summary }}</span>
						<span v-else>{{ row.seats }} {{ seatsLabel }}</span>
					</span>
				</button>
				<p v-if="!column.rows.length" class="floor-kanban__empty">{{ noneLabel }}</p>
			</section>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Kanban fallback for small screens (spec §4). A drag-positioned plan is not
 * phone-usable; the same taps live here as lists grouped by derived state, so a
 * waiter on a phone never needs the canvas.
 */
import { computed } from "vue";
import { useFloorStore, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";

const emit = defineEmits<{ (event: "open", table: TableRow): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();

const transferActive = computed(() => Boolean(floorStore.transferOrder));
const seatsLabel = computed(() => verticalStore.t("seats"));
const noneLabel = computed(() => verticalStore.t("None"));

interface KanbanRow {
	table: TableRow;
	occupied: boolean;
	seats: number;
	unsent: number;
	pending: boolean;
	summary: string;
}

const rows = computed<KanbanRow[]>(() =>
	floorStore.activeFloorTables.map((table) => {
		const tableOrders = floorStore.ordersForTable(table.name);
		const total = tableOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
		const lines = tableOrders.reduce((sum, order) => sum + (Number(order.items_count) || 0), 0);
		return {
			table,
			occupied: tableOrders.length > 0,
			seats: table.seats || 0,
			unsent: floorStore.unsentCountForTable(table.name),
			// Queued locally, never confirmed by the server (spec §6.8).
			pending: tableOrders.some((order) => order.pending_sync),
			summary: `${lines} ${verticalStore.t("lines")} · ${formatCurrency(total)}`,
		};
	}),
);

const columns = computed(() => [
	{
		key: "occupied",
		title: verticalStore.t("Occupied"),
		rows: rows.value.filter((row) => row.occupied),
	},
	{
		key: "free",
		title: verticalStore.t("Free"),
		rows: rows.value.filter((row) => !row.occupied && !row.table.needs_cleaning),
	},
	{
		key: "cleaning",
		title: verticalStore.t("Needs cleaning"),
		rows: rows.value.filter((row) => !row.occupied && Boolean(row.table.needs_cleaning)),
	},
]);

function onTap(row: KanbanRow) {
	if (transferActive.value) {
		if (row.occupied) return;
		void floorStore.completeTransfer(row.table);
		return;
	}
	emit("open", row.table);
}
</script>

<style scoped>
.floor-kanban {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

.floor-kanban__scroller {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 8px;
	background: var(--pos-bg-secondary);
}

.floor-kanban__column {
	background: var(--pos-surface);
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	padding: 8px;
}

.floor-kanban__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
}

.floor-kanban__title {
	font-size: 12px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--pos-text-secondary);
}

.floor-kanban__count {
	min-width: 20px;
	padding: 0 6px;
	border-radius: 10px;
	background: var(--pos-surface-variant);
	color: var(--pos-text-primary);
	font-size: 11px;
	font-weight: 700;
	text-align: center;
}

.floor-kanban__card {
	display: flex;
	flex-direction: column;
	gap: 2px;
	width: 100%;
	min-height: 44px;
	margin-bottom: 6px;
	padding: 8px 10px;
	border: 1px solid var(--pos-border);
	border-radius: 8px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	text-align: start;
}

.floor-kanban__card--pending .floor-kanban__label {
	font-style: italic;
}

.floor-kanban__card--blocked {
	opacity: 0.4;
	cursor: not-allowed;
}

.floor-kanban__card-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.floor-kanban__label {
	font-size: 14px;
	color: var(--pos-text-primary);
}

.floor-kanban__badge {
	min-width: 18px;
	padding: 0 5px;
	border-radius: 9px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	line-height: 18px;
	text-align: center;
}

.floor-kanban__meta {
	font-size: 12px;
	color: var(--pos-text-secondary);
}

.floor-kanban__empty {
	margin: 0;
	padding: 6px 2px;
	color: var(--pos-text-hint);
	font-size: 12px;
	background: transparent;
}
</style>
