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
					:class="[
						`floor-kanban__card--${row.age}`,
						{
							'floor-kanban__card--occupied': row.occupied,
							'floor-kanban__card--blocked': transferActive && row.occupied,
							'floor-kanban__card--target': transferActive && !row.occupied,
							'floor-kanban__card--pending': row.pending,
						},
					]"
					:disabled="transferActive && row.occupied"
					:data-test="`kanban-card-${row.table.table_label}`"
					@click="onTap(row)"
				>
					<span class="floor-kanban__card-top">
						<strong class="floor-kanban__label">{{ row.table.table_label }}</strong>
						<span v-if="row.occupied" class="floor-kanban__total">{{ row.totalLabel }}</span>
						<span v-if="row.unsent" class="floor-kanban__badge">
							<v-icon icon="mdi-silverware-variant" size="12" />
							{{ row.unsent }}
						</span>
					</span>
					<span class="floor-kanban__meta">
						<span v-for="chip in row.chips" :key="chip.key" class="floor-kanban__chip" :class="chip.tone ? `floor-kanban__chip--${chip.tone}` : ''">
							<v-icon :icon="chip.icon" size="13" />
							{{ chip.text }}
						</span>
						<!-- Bussing action lives ON the card in the cleaning column:
						     tapping the card body still opens the table (a busser may
						     seat the next party directly), the chip-button only clears
						     the latch. -->
						<button
							v-if="column.key === 'cleaning'"
							type="button"
							class="floor-kanban__chip floor-kanban__chip--action"
							@click.stop="floorStore.markClean(row.table.name)"
						>
							<v-icon icon="mdi-check" size="13" />
							{{ verticalStore.t("Mark clean") }}
						</button>
					</span>
				</button>
				<p v-if="!column.rows.length" class="floor-kanban__empty">{{ column.empty }}</p>
			</section>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Kanban fallback for small screens (spec §4). A drag-positioned plan is not
 * phone-usable; the same taps live here as lists grouped by derived state, so a
 * waiter on a phone never needs the canvas.
 *
 * Because this is the phone-first view, it spells out what the plan can only
 * imply: the plan's age RING becomes a written idle time here, since a ring
 * thinned by fit-to-width scaling is a hint and a waiter deciding who to walk
 * to next needs a number.
 */
import { computed } from "vue";
import { useFloorStore, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { ageStep, formatIdleShort, idleMinutes, useFloorClock, type AgeStep } from "./floorClock";

const emit = defineEmits<{ (event: "open", table: TableRow): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const transferActive = computed(() => Boolean(floorStore.transferOrder));

interface Chip {
	key: string;
	icon: string;
	text: string;
	tone?: "warm" | "late" | "pending";
}

interface KanbanRow {
	table: TableRow;
	occupied: boolean;
	unsent: number;
	pending: boolean;
	age: AgeStep;
	totalLabel: string;
	chips: Chip[];
}

const rows = computed<KanbanRow[]>(() =>
	floorStore.activeFloorTables.map((table) => {
		const tableOrders = floorStore.ordersForTable(table.name);
		const occupied = tableOrders.length > 0;
		const total = tableOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
		const lines = tableOrders.reduce((sum, order) => sum + (Number(order.items_count) || 0), 0);
		const guests = tableOrders.reduce((sum, order) => sum + (Number(order.guest_count) || 0), 0);
		// The oldest untouched ticket decides the card's urgency: on a split bill,
		// topping up one half must not make the other look freshly served.
		const idle = tableOrders.reduce<number | null>((oldest, order) => {
			const minutes = idleMinutes(order.modified, now.value);
			if (minutes === null) return oldest;
			return oldest === null || minutes > oldest ? minutes : oldest;
		}, null);
		// Queued locally, never confirmed by the server (spec §6.8).
		const pending = tableOrders.some((order) => order.pending_sync);

		const chips: Chip[] = [];
		if (occupied) {
			chips.push({
				key: "lines",
				icon: "mdi-receipt-text-outline",
				text: `${lines} ${verticalStore.t("lines")}`,
			});
			if (guests) {
				chips.push({
					key: "guests",
					icon: "mdi-account-group-outline",
					text: String(guests),
				});
			}
			if (idle !== null) {
				const step = ageStep(idle);
				chips.push({
					key: "idle",
					icon: "mdi-clock-outline",
					text: formatIdleShort(idle),
					tone: step === "fresh" ? undefined : step,
				});
			}
			if (pending) {
				chips.push({
					key: "pending",
					icon: "mdi-cloud-off-outline",
					text: verticalStore.t("Not sent"),
					tone: "pending",
				});
			}
		} else if (table.needs_cleaning) {
			chips.push({ key: "clean", icon: "mdi-broom", text: verticalStore.t("Needs cleaning") });
		} else if (table.seats) {
			chips.push({
				key: "seats",
				icon: "mdi-account-group-outline",
				text: `${table.seats} ${verticalStore.t("seats")}`,
			});
		}

		return {
			table,
			occupied,
			unsent: floorStore.unsentCountForTable(table.name),
			pending,
			age: occupied ? ageStep(idle) : "fresh",
			totalLabel: total ? formatCurrency(total) : "",
			chips,
		};
	}),
);

/**
 * Empty columns say what to do, not that there is nothing. "None" under three
 * headings teaches a new waiter nothing about a screen they have never seen.
 */
const columns = computed(() => [
	{
		key: "occupied",
		title: verticalStore.t("Occupied"),
		empty: verticalStore.t("Nobody seated yet — tap a free table to start a ticket"),
		rows: rows.value.filter((row) => row.occupied),
	},
	{
		key: "free",
		title: verticalStore.t("Free"),
		empty: verticalStore.t("Every table is busy"),
		rows: rows.value.filter((row) => !row.occupied && !row.table.needs_cleaning),
	},
	{
		key: "cleaning",
		title: verticalStore.t("Needs cleaning"),
		empty: verticalStore.t("Nothing waiting to be bussed"),
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
	letter-spacing: 0.05em;
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
	font-variant-numeric: tabular-nums;
	text-align: center;
}

.floor-kanban__card {
	display: flex;
	flex-direction: column;
	gap: 4px;
	width: 100%;
	min-height: 56px;
	margin-bottom: 6px;
	padding: 8px 10px;
	/* The urgency rail: a card's left edge carries the same escalation the
	   plan's ring does, so the two views agree at a glance. */
	border: 1px solid var(--pos-border);
	border-inline-start: 3px solid transparent;
	border-radius: 8px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	text-align: start;
	cursor: pointer;
	transition: border-color 120ms ease-out;
}

.floor-kanban__card:hover:not(:disabled) {
	border-color: var(--pos-primary);
}

.floor-kanban__card--occupied {
	border-inline-start-color: var(--pos-primary);
}

.floor-kanban__card--warm {
	border-inline-start-color: var(--pos-warning);
}

.floor-kanban__card--late {
	border-inline-start-color: var(--pos-error);
}

.floor-kanban__card--pending .floor-kanban__label {
	font-style: italic;
}

.floor-kanban__card--target {
	border-style: dashed;
	border-color: var(--pos-success);
	background: var(--pos-success-container);
	color: var(--pos-text-primary);
}

.floor-kanban__card--blocked {
	opacity: 0.4;
	cursor: not-allowed;
}

.floor-kanban__card-top {
	display: flex;
	align-items: center;
	gap: 8px;
}

.floor-kanban__label {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: -0.01em;
	color: var(--pos-text-primary);
}

.floor-kanban__total {
	flex: 0 0 auto;
	font-size: 14px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
}

.floor-kanban__badge {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	flex: 0 0 auto;
	padding: 1px 6px;
	border-radius: 9px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}

.floor-kanban__meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 10px;
}

.floor-kanban__chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	background: transparent;
	color: var(--pos-text-secondary);
}

.floor-kanban__chip--action {
	border: 1px solid var(--pos-border-light);
	border-radius: 999px;
	padding: 4px 10px;
	min-height: 28px;
	cursor: pointer;
	color: var(--pos-success, #059669);
	font-weight: 600;
	touch-action: manipulation;
}

.floor-kanban__chip--warm {
	color: var(--pos-button-warning-text);
	font-weight: 700;
}

.floor-kanban__chip--late {
	color: var(--pos-error);
	font-weight: 700;
}

.floor-kanban__chip--pending {
	color: var(--pos-warning);
	font-weight: 700;
}

.floor-kanban__empty {
	margin: 0;
	padding: 8px 2px;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 12px;
	line-height: 1.4;
}
</style>
