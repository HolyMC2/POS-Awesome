<template>
	<div class="floor-plan">
		<div class="floor-plan__scroller">
			<div class="floor-plan__stage" :style="stageStyleValue">
				<div class="floor-plan__canvas" :style="[canvasStyleValue, scaleStyle]">
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
								'floor-tile--dirty': tile.needsCleaning,
								'floor-tile--target': transferActive && !tile.occupied,
								'floor-tile--blocked': transferActive && tile.occupied,
							},
						]"
						:style="[
							tileStyleFor(tile.layout),
							{ '--floor-tile-color': tile.color, '--floor-ring-turn': tile.ringTurn },
						]"
						:disabled="transferActive && tile.occupied"
						:title="tile.hint"
						:aria-label="tile.hint"
						:data-test="`floor-tile-${tile.table.table_label}`"
						@click="onTap(tile)"
					>
						<!-- The age ring: a fourth channel, deliberately not a fourth
						     colour on the tile itself. Opacity still says free/occupied
						     and the border still says the operator's own section. -->
						<span
							v-if="tile.occupied && tile.age !== 'fresh'"
							class="floor-tile__ring"
							:class="`floor-tile__ring--${tile.age}`"
							aria-hidden="true"
						/>
						<span class="floor-tile__face" :style="labelStyleFor(tile.layout)">
							<span class="floor-tile__label">{{ tile.table.table_label }}</span>
							<span v-if="tile.total" class="floor-tile__total">{{ tile.total }}</span>
							<span v-else-if="tile.seats" class="floor-tile__seats">{{ tile.seats }}</span>
						</span>
						<span v-if="tile.unsent" class="floor-tile__badge">{{ tile.unsent }}</span>
						<span v-if="tile.pending" class="floor-tile__pending-dot" :title="pendingHint" />
						<!-- The broom is itself the "mark clean" control: tapping the
						     glyph clears the latch without opening the table, so a
						     busser never seats a phantom party. stop keeps the tile's
						     own tap-is-the-transition intact. -->
						<button
							v-if="tile.needsCleaning"
							type="button"
							class="floor-tile__glyph floor-tile__glyph--action"
							:aria-label="verticalStore.t('Mark clean')"
							:title="verticalStore.t('Mark clean')"
							@click.stop="floorStore.markClean(tile.table.name)"
						>
							<v-icon icon="mdi-broom" size="14" />
						</button>
					</button>
					<p v-if="!tiles.length" class="floor-plan__empty">
						{{ emptyMessage }}
					</p>
				</div>
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
 * meaning, so the plan needs no legend. Volatile numbers ride badges. The age
 * ring is the one addition, and it is a separate channel outside the tile's
 * own paint (see `floorClock.ts` for why idle time earns a channel at all).
 *
 * The whole canvas scales as ONE transform rather than re-laying-out, because
 * geometry is stored in grid units (§2.2): a plan authored at a desk lands on a
 * phone by multiplication.
 */
import { computed } from "vue";
import { useFloorStore, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { ageStep, ageTurn, formatIdleShort, idleMinutes, useFloorClock } from "./floorClock";
import {
	canvasStyle,
	colorHex,
	fitScale,
	labelStyle,
	resolveCanvas,
	resolveTableLayout,
	scaledCanvasStyle,
	tileStyle,
	type PlacedLayout,
} from "./floorGeometry";

const props = defineProps<{
	/** Pixels the plan may use across. Measured by the parent, not the window:
	 *  the floor sits in the shell's selector column, so window width says
	 *  nothing about how wide this panel actually is. */
	availableWidth: number;
	/** Fit the whole room across `availableWidth` instead of drawing it 1:1. */
	fit: boolean;
}>();

const emit = defineEmits<{ (event: "open", table: TableRow): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();
const { now } = useFloorClock();

const canvas = computed(() => resolveCanvas(floorStore.activeFloorRow));
const canvasStyleValue = computed(() => canvasStyle(canvas.value));
const transferActive = computed(() => Boolean(floorStore.transferOrder));

const pendingHint = computed(() => verticalStore.t("Not sent to the server yet"));

const emptyMessage = computed(() =>
	verticalStore.t("No tables yet — edit your floor plan to add some"),
);

/** The smallest side any placed tile has, in pixels at 1:1. */
const smallestTilePx = computed(() => {
	const cell = canvas.value.cell;
	const sides = floorStore.activeFloorTables.map((table, index) => {
		const layout = resolveTableLayout(table, index, canvas.value);
		return Math.min(layout.w, layout.h) * cell;
	});
	return sides.length ? Math.min(...sides) : cell;
});

/**
 * The smallest a table may be drawn. 44px is the platform touch floor (iOS HIG
 * / WCAG 2.5.5); the 40px this used to allow measured as a real 40×40 tile on a
 * 390px phone, which is a mis-tap during service — and a mis-tap here opens the
 * wrong table's order.
 */
const MIN_TILE_PX = 44;

/**
 * Fit-to-width, floored so the smallest table stays tappable.
 *
 * A 24×16 default frame is 1056px wide; fitting it across a 390px phone would
 * shrink a 2-cell table to 33px — under the touch floor, i.e. a board you can
 * see but cannot use. When those two demands collide the touch floor wins and
 * the waiter pans, because a mis-tap during service costs more than a swipe
 * does.
 */
const scale = computed(() => {
	if (!props.fit) return 1;
	const fitted = fitScale(canvas.value, props.availableWidth);
	const tappable = Math.min(1, MIN_TILE_PX / Math.max(1, smallestTilePx.value));
	return Math.max(fitted, tappable);
});

/**
 * The scale is applied to the canvas, and `--floor-inv` undoes it for the
 * chrome that must keep a constant screen size: labels, badges, glyphs. Only
 * the GEOMETRY should shrink when the room is fitted.
 */
const scaleStyle = computed(() =>
	scale.value === 1
		? { "--floor-inv": "1" }
		: { transform: `scale(${scale.value})`, "--floor-inv": String(1 / scale.value) },
);

/** The scaled footprint, so the scrollport scrolls the right distance. */
const stageStyleValue = computed(() => scaledCanvasStyle(canvas.value, scale.value));

const tiles = computed(() =>
	floorStore.activeFloorTables.map((table, index) => {
		const layout = resolveTableLayout(table, index, canvas.value);
		const tableOrders = floorStore.ordersForTable(table.name);
		const occupied = tableOrders.length > 0;
		const total = tableOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
		// The oldest untouched ticket on the table is the one that needs a waiter;
		// a split bill where one half was just topped up must not reset the other.
		const idle = tableOrders.reduce<number | null>((oldest, order) => {
			const minutes = idleMinutes(order.modified, now.value);
			if (minutes === null) return oldest;
			return oldest === null || minutes > oldest ? minutes : oldest;
		}, null);
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
			age: occupied ? ageStep(idle) : "fresh",
			ringTurn: occupied ? ageTurn(idle) : 0,
			hint: hintFor(table, occupied, total, idle),
		};
	}),
);

/**
 * The hover/long-press tooltip. On a desk terminal this is the detail view for
 * every table that is not the open ticket, so it carries the numbers rather
 * than repeating the label that is already printed on the tile.
 */
function hintFor(
	table: TableRow,
	occupied: boolean,
	total: number,
	idle: number | null,
): string {
	if (transferActive.value) {
		return occupied
			? `${table.table_label} — ${verticalStore.t("Occupied")}`
			: `${verticalStore.t("Move here")}: ${table.table_label}`;
	}
	const parts: string[] = [table.table_label];
	if (occupied) {
		parts.push(verticalStore.t("Occupied"));
		if (total) parts.push(formatCurrency(total));
		if (idle !== null) parts.push(`${verticalStore.t("Idle")} ${formatIdleShort(idle)}`);
	} else if (table.needs_cleaning) {
		parts.push(verticalStore.t("Needs cleaning"));
	} else if (table.seats) {
		parts.push(`${table.seats} ${verticalStore.t("seats")}`);
	}
	return parts.join(" — ");
}

function tileStyleFor(layout: PlacedLayout) {
	return tileStyle(layout, canvas.value);
}

function labelStyleFor(layout: PlacedLayout) {
	return labelStyle(layout, 1 / scale.value);
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

<style scoped src="./floor-plan.css"></style>
