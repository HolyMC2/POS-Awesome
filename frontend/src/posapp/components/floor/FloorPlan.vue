<template>
	<div class="floor-plan">
		<div class="floor-plan__scroller">
			<div class="floor-plan__canvas" :style="canvasStyleValue">
				<button
					v-for="tile in tiles"
					:key="tile.table.name"
					type="button"
					class="floor-tile"
					:class="[
						`floor-tile--${tile.layout.shape || 'rect'}`,
						{
							'floor-tile--occupied': tile.occupied,
							'floor-tile--syncing': tile.syncing,
							'floor-tile--pending': tile.pending,
							'floor-tile--target': transferActive && !tile.occupied,
							'floor-tile--blocked': transferActive && tile.occupied,
						},
					]"
					:style="[tileStyleFor(tile.layout), { '--floor-tile-color': tile.color }]"
					:disabled="transferActive && tile.occupied"
					:title="tile.hint"
					:aria-label="tile.hint"
					@click="onTap(tile)"
				>
					<span class="floor-tile__face" :style="labelStyleFor(tile.layout)">
						<span class="floor-tile__label">{{ tile.table.table_label }}</span>
						<span v-if="tile.total" class="floor-tile__total">{{ tile.total }}</span>
						<span v-else-if="tile.seats" class="floor-tile__seats">{{ tile.seats }}</span>
					</span>
					<span v-if="tile.unsent" class="floor-tile__badge">{{ tile.unsent }}</span>
					<span v-if="tile.pending" class="floor-tile__pending-dot" :title="pendingHint" />
					<v-icon
						v-if="tile.needsCleaning"
						class="floor-tile__glyph"
						icon="mdi-broom"
						size="14"
					/>
				</button>
				<p v-if="!tiles.length" class="floor-plan__empty">
					{{ emptyMessage }}
				</p>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * The floor plan: plain DOM divs on a grid canvas (spec §4).
 *
 * Opacity carries free (0.3) vs occupied (1.0); colour carries the operator's
 * OWN semantic (section / station), never status — one visual variable per
 * meaning, so the plan needs no legend. Volatile numbers ride badges.
 */
import { computed } from "vue";
import { useFloorStore, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import {
	canvasStyle,
	colorHex,
	labelStyle,
	resolveCanvas,
	resolveTableLayout,
	tileStyle,
	type PlacedLayout,
} from "./floorGeometry";

const emit = defineEmits<{ (event: "open", table: TableRow): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();

const canvas = computed(() => resolveCanvas(floorStore.activeFloorRow));
const canvasStyleValue = computed(() => canvasStyle(canvas.value));
const transferActive = computed(() => Boolean(floorStore.transferOrder));

const pendingHint = computed(() => verticalStore.t("Not sent to the server yet"));

const emptyMessage = computed(() =>
	verticalStore.t("No tables yet — edit your floor plan to add some"),
);

const tiles = computed(() =>
	floorStore.activeFloorTables.map((table, index) => {
		const layout = resolveTableLayout(table, index, canvas.value);
		const tableOrders = floorStore.ordersForTable(table.name);
		const occupied = tableOrders.length > 0;
		const total = tableOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
		return {
			table,
			layout,
			occupied,
			seats: table.seats || 0,
			total: occupied && total ? formatCurrency(total) : "",
			unsent: floorStore.unsentCountForTable(table.name),
			needsCleaning: Boolean(table.needs_cleaning),
			syncing: floorStore.isSyncing(table.name),
			// Queued locally, never confirmed by the server. Offline each device
			// sees only its OWN orders (spec §6.8), so the operator has to be able
			// to tell "the kitchen has this" from "only this tablet has this".
			pending: tableOrders.some((order) => order.pending_sync),
			color: colorHex(layout.color),
			hint: hintFor(table, occupied),
		};
	}),
);

function hintFor(table: TableRow, occupied: boolean): string {
	if (transferActive.value) {
		return occupied
			? `${table.table_label} — ${verticalStore.t("Occupied")}`
			: `${verticalStore.t("Move here")}: ${table.table_label}`;
	}
	return `${table.table_label}${occupied ? ` — ${verticalStore.t("Occupied")}` : ""}`;
}

function tileStyleFor(layout: PlacedLayout) {
	return tileStyle(layout, canvas.value);
}

function labelStyleFor(layout: PlacedLayout) {
	return labelStyle(layout);
}

function onTap(tile: { table: TableRow; occupied: boolean }) {
	if (transferActive.value) {
		if (tile.occupied) return;
		void floorStore.completeTransfer(tile.table);
		return;
	}
	emit("open", tile.table);
}
</script>

<style scoped>
/* The canvas is a fixed-pixel plane, so it MUST live inside a bounded
   scrollport. The chain is flex all the way up (FloorView caps the height):
   an auto-height ancestor here would let the plane grow past the fold and
   hide the bottom row behind the mobile dock. */
.floor-plan {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

.floor-plan__scroller {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	padding: 8px;
	background: var(--pos-bg-secondary);
}

.floor-plan__canvas {
	position: relative;
	background-color: var(--pos-surface);
	background-image:
		linear-gradient(to right, var(--pos-border-light) 1px, transparent 1px),
		linear-gradient(to bottom, var(--pos-border-light) 1px, transparent 1px);
	border: 1px solid var(--pos-border);
	border-radius: 8px;
}

.floor-tile {
	position: absolute;
	top: 0;
	left: 0;
	transform-origin: top left;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2px;
	border: 2px solid var(--floor-tile-color, #94a3b8);
	border-radius: 10px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
	opacity: 0.3;
	transition: opacity 120ms ease-out;
	cursor: pointer;
}

.floor-tile--round {
	border-radius: 50%;
}

.floor-tile--occupied {
	opacity: 1;
	background: var(--pos-surface-variant);
	color: var(--pos-text-primary);
}

.floor-tile--syncing {
	animation: floor-tile-pulse 900ms ease-in-out infinite;
}

.floor-tile--target {
	opacity: 1;
	border-style: dashed;
	border-color: var(--pos-success);
	background: var(--pos-success-container);
	color: var(--pos-text-primary);
}

.floor-tile--pending .floor-tile__label {
	font-style: italic;
}

.floor-tile__pending-dot {
	position: absolute;
	top: -4px;
	inset-inline-start: -4px;
	width: 10px;
	height: 10px;
	border: 2px solid var(--pos-surface);
	border-radius: 50%;
	background: var(--pos-warning);
}

.floor-tile--blocked {
	cursor: not-allowed;
	opacity: 0.25;
}

.floor-tile__face {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1px;
	line-height: 1.1;
	pointer-events: none;
}

.floor-tile__label {
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.floor-tile__total {
	font-size: 10px;
	font-weight: 600;
	color: var(--pos-primary);
}

.floor-tile__seats {
	font-size: 10px;
	color: var(--pos-text-secondary);
}

.floor-tile__badge {
	position: absolute;
	top: -6px;
	inset-inline-end: -6px;
	min-width: 18px;
	padding: 0 4px;
	border-radius: 9px;
	background: var(--pos-error);
	color: #ffffff;
	font-size: 11px;
	font-weight: 700;
	line-height: 18px;
	text-align: center;
}

.floor-tile__glyph {
	position: absolute;
	bottom: 2px;
	inset-inline-start: 4px;
	color: var(--pos-warning);
}

.floor-plan__empty {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 16px;
	text-align: center;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 14px;
}

@keyframes floor-tile-pulse {
	0%,
	100% {
		box-shadow: 0 0 0 0 var(--pos-shadow);
	}
	50% {
		box-shadow: 0 0 0 4px var(--pos-shadow-light);
	}
}
</style>
