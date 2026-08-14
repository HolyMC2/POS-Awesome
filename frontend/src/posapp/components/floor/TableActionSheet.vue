<template>
	<v-dialog :model-value="modelValue" max-width="340" @update:model-value="close">
		<v-card class="table-sheet pos-themed-card" data-test="table-action-sheet">
			<header class="table-sheet__head">
				<span class="table-sheet__where">
					<v-icon icon="mdi-table-furniture" size="18" />
					<span class="table-sheet__title">{{ table?.table_label }}</span>
				</span>
				<span class="table-sheet__state" :class="`table-sheet__state--${stateTone}`">
					{{ stateLabel }}
				</span>
			</header>

			<p v-if="metaLine" class="table-sheet__meta">{{ metaLine }}</p>

			<div v-if="multipleOrders" class="table-sheet__actions" data-test="table-sheet-accounts">
				<p class="table-sheet__prompt">{{ chooseAccountLabel }}</p>
				<button
					v-for="order in orders"
					:key="order.order_uid"
					type="button"
					class="table-sheet__action table-sheet__account"
					:data-test="`table-sheet-order-${order.order_uid}`"
					@click="pickOrder(order)"
				>
					<v-icon icon="mdi-receipt-text-outline" size="20" />
					<span class="table-sheet__action-text">
						<strong>{{ order.tab_name || order.order_uid.slice(0, 6) }}</strong>
						<small>{{ orderSummary(order) }}</small>
					</span>
					<span v-if="order.unsent_count" class="table-sheet__action-badge">{{ order.unsent_count }}</span>
				</button>
			</div>

			<div v-else class="table-sheet__actions">
				<button
					v-for="action in actions"
					:key="action.id"
					type="button"
					class="table-sheet__action"
					:class="{ 'table-sheet__action--primary': action.primary }"
					:data-test="`table-sheet-${action.id}`"
					@click="pick(action.id)"
				>
					<v-icon :icon="action.icon" size="20" />
					<span class="table-sheet__action-text">{{ action.label }}</span>
					<span v-if="action.badge" class="table-sheet__action-badge">{{ action.badge }}</span>
				</button>
			</div>

			<button type="button" class="table-sheet__cancel" data-test="table-sheet-cancel" @click="close">
				{{ __("Cancel") }}
			</button>
		</v-card>
	</v-dialog>
</template>

<script lang="ts">
/**
 * The verbs a table can be asked for. Exported from a plain `<script>` block
 * because `<script setup>` may not carry ES exports — the parent needs the
 * union to type its handler.
 */
export type TableSheetAction = "open" | "view" | "add-items" | "charge" | "clean";
</script>

<script setup lang="ts">
/**
 * What a tap on a table offers.
 *
 * The v1 made tap ITSELF the transition — one tap on a free tile silently
 * created an open order. Fast for a waiter who already knows the system, and
 * unreadable for everyone else: nothing on the screen said what the tap had
 * done, and there was no visible route from a seated table to food or to a
 * bill. The sheet trades that one tap for a named list of the things a table
 * can be asked to do, which is also where "Agregar productos" and "Cobrar"
 * finally become reachable from the floor.
 *
 * Transfer mode does NOT come through here: there the whole floor is a target
 * picker and a tap means "move it here", so FloorPlan completes it directly.
 */
import { computed } from "vue";
import { useFloorStore, type OrderRow, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { formatIdleShort, idleMinutes, useFloorClock } from "./floorClock";

const props = defineProps<{
	modelValue: boolean;
	table: TableRow | null;
}>();

const emit = defineEmits<{
	(event: "update:modelValue", value: boolean): void;
	(event: "action", action: TableSheetAction, table: TableRow): void;
	(event: "order", order: OrderRow): void;
}>();

const __ = window.__ || ((value: string) => value);

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const orders = computed(() => (props.table ? floorStore.ordersForTable(props.table.name) : []));
const occupied = computed(() => orders.value.length > 0);
const multipleOrders = computed(() => orders.value.length > 1);
const total = computed(() =>
	orders.value.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
);
const lines = computed(() =>
	orders.value.reduce((sum, order) => sum + (Number(order.items_count) || 0), 0),
);
const unsent = computed(() =>
	orders.value.reduce((sum, order) => sum + (Number(order.unsent_count) || 0), 0),
);
const needsCleaning = computed(() => Boolean(props.table?.needs_cleaning));
const chooseAccountLabel = computed(() => verticalStore.t("Choose the account to open"));

const stateLabel = computed(() => {
	if (occupied.value) return verticalStore.t("Occupied");
	if (needsCleaning.value) return verticalStore.t("Needs cleaning");
	// "Free table", not "Free": es.csv binds the bare key to "Gratis".
	return verticalStore.t("Free table");
});

const stateTone = computed(() => {
	if (occupied.value) return "busy";
	if (needsCleaning.value) return "dirty";
	return "free";
});

/** The numbers that decide which action the operator wants, on one line. */
const metaLine = computed(() => {
	const parts: string[] = [];
	if (multipleOrders.value) {
		parts.push(`${orders.value.length} ${verticalStore.t("open accounts")}`);
		return parts.join(" · ");
	}
	if (occupied.value) {
		parts.push(formatCurrency(total.value));
		parts.push(`${lines.value} ${verticalStore.t("Lines").toLowerCase()}`);
		const idle = orders.value.reduce<number | null>((oldest, order) => {
			const minutes = idleMinutes(order.modified, now.value);
			if (minutes === null) return oldest;
			return oldest === null || minutes > oldest ? minutes : oldest;
		}, null);
		if (idle !== null) parts.push(formatIdleShort(idle));
	} else if (props.table?.seats) {
		parts.push(`${props.table.seats} ${verticalStore.t("seats")}`);
	}
	return parts.join(" · ");
});

/**
 * Occupied and free tables get different verbs, not the same verb greyed out:
 * a list whose entries are all live is faster to read than one you have to
 * scan for what is enabled.
 */
type ActionRow = {
	id: TableSheetAction;
	icon: string;
	label: string;
	primary?: boolean;
	badge?: number;
};

const actions = computed<ActionRow[]>(() => {
	const rows: ActionRow[] = [];
	// A dirty free table is not seatable. Cleaning is the only honest next
	// action; offering "Open table" as primary let staff seat it accidentally.
	if (needsCleaning.value && !occupied.value) {
		return [{ id: "clean", icon: "mdi-broom", label: verticalStore.t("Mark clean"), primary: true }];
	}
	if (occupied.value) {
		rows.push({
			id: "add-items",
			icon: "mdi-plus-circle-outline",
			label: verticalStore.t("Add items"),
			primary: true,
		});
		// "view", not "open": both resume the same order, but the caller sends
		// this one to the CART (the bill is what was asked for) and the others
		// to the item list.
		rows.push({
			id: "view",
			icon: "mdi-receipt-text-outline",
			label: verticalStore.t("View order"),
			badge: unsent.value || undefined,
		});
		if (lines.value > 0) {
			rows.push({ id: "charge", icon: "mdi-cash-register", label: verticalStore.t("Charge") });
		}
	} else {
		rows.push({
			id: "open",
			icon: "mdi-account-multiple-plus-outline",
			label: verticalStore.t("Open table"),
			primary: true,
		});
	}
	if (needsCleaning.value && occupied.value) {
		rows.push({ id: "clean", icon: "mdi-broom", label: verticalStore.t("Mark clean") });
	}
	return rows;
});

function close() {
	emit("update:modelValue", false);
}

function pick(action: TableSheetAction) {
	if (props.table) emit("action", action, props.table);
	close();
}

function pickOrder(order: OrderRow) {
	emit("order", order);
	close();
}

function orderSummary(order: OrderRow) {
	const count = Number(order.items_count) || 0;
	return `${formatCurrency(Number(order.total) || 0)} · ${count} ${verticalStore.t("Lines").toLowerCase()}`;
}
</script>

<style scoped>
.table-sheet {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
}

.table-sheet__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
}

.table-sheet__where {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	color: var(--pos-text-secondary);
}

.table-sheet__title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 17px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.table-sheet__state {
	flex: 0 0 auto;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.table-sheet__state--free {
	background: var(--pos-surface-container);
	color: var(--pos-text-secondary);
}

.table-sheet__state--busy {
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.table-sheet__state--dirty {
	background: var(--pos-warning);
	color: #ffffff;
}

.table-sheet__meta {
	margin: 0;
	font-size: 13px;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-secondary);
}

.table-sheet__actions {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.table-sheet__prompt {
	margin: 0 0 2px;
	color: var(--pos-text-secondary);
	font-size: 12px;
}

.table-sheet__account .table-sheet__action-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.table-sheet__account small {
	color: var(--pos-text-secondary);
	font-size: 11px;
	font-weight: 500;
}

.table-sheet__action {
	display: flex;
	align-items: center;
	gap: 10px;
	/* 48px, not 44: this list is tapped mid-service with one thumb. */
	min-height: 48px;
	padding: 0 14px;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
	font-size: 14px;
	font-weight: 600;
	text-align: start;
	cursor: pointer;
}

.table-sheet__action:hover {
	border-color: var(--pos-primary);
	background: var(--pos-hover-bg);
}

.table-sheet__action--primary {
	border-color: var(--pos-primary);
	background: var(--pos-primary-container);
}

.table-sheet__action-text {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.table-sheet__action-badge {
	flex: 0 0 auto;
	min-width: 20px;
	padding: 0 6px;
	border-radius: 10px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	line-height: 20px;
	font-variant-numeric: tabular-nums;
	text-align: center;
}

.table-sheet__cancel {
	min-height: 40px;
	border: 0;
	border-radius: 10px;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.table-sheet__cancel:hover {
	background: var(--pos-hover-bg);
}
</style>
