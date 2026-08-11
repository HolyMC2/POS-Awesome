<template>
	<div ref="panelEl" class="floor-view">
		<!-- Transfer is a modal gesture (spec §4): the banner is the mode, the
		     whole floor is the target picker, Esc is the way out. -->
		<div v-if="transferOrder" class="floor-view__banner" role="status">
			<v-icon icon="mdi-swap-horizontal" size="18" />
			<span class="floor-view__banner-text">{{ transferBannerText }}</span>
			<button type="button" class="floor-view__banner-cancel" @click="floorStore.cancelTransfer()">
				{{ __("Cancel") }}
			</button>
		</div>

		<header class="floor-view__bar">
			<div class="floor-view__floors">
				<button
					v-for="floor in floorTabs"
					:key="floor.name"
					type="button"
					class="floor-view__floor"
					:class="{ 'floor-view__floor--active': floor.name === activeFloor }"
					:data-test="`floor-tab-${floor.name}`"
					@click="floorStore.setActiveFloor(floor.name)"
				>
					<span class="floor-view__floor-name">{{ floor.floor_name }}</span>
					<span v-if="floor.total" class="floor-view__floor-count">{{ floor.busy }}/{{ floor.total }}</span>
				</button>
			</div>
			<div class="floor-view__actions">
				<v-btn
					size="small"
					variant="text"
					icon="mdi-dialpad"
					:aria-label="jumpLabel"
					:title="jumpLabel"
					@click="jumpOpen = true"
				/>
				<v-btn
					v-if="viewMode === 'plan' && !editorMode"
					size="small"
					variant="text"
					icon="mdi-fit-to-page-outline"
					:color="fit ? 'primary' : undefined"
					:aria-pressed="fit"
					:aria-label="fitLabel"
					:title="fitLabel"
					data-test="floor-fit"
					@click="fitOverride = !fit"
				/>
				<v-btn
					size="small"
					variant="text"
					:icon="viewMode === 'plan' ? 'mdi-view-list-outline' : 'mdi-floor-plan'"
					:aria-label="toggleLabel"
					:title="toggleLabel"
					@click="toggleViewMode"
				/>
				<v-btn
					size="small"
					variant="text"
					:icon="editorMode ? 'mdi-check' : 'mdi-pencil-outline'"
					:aria-label="editLabel"
					:title="editLabel"
					:disabled="!floors.length"
					@click="floorStore.setEditorMode(!editorMode)"
				/>
				<v-btn
					size="small"
					variant="text"
					icon="mdi-refresh"
					:loading="floorStore.loading"
					:aria-label="__('Refresh')"
					:title="__('Refresh')"
					@click="floorStore.refresh()"
				/>
			</div>
		</header>

		<TabsRail show-new @open="openTabOrder" @new-tab="jumpOpen = true" />

		<p v-if="floorStore.error" class="floor-view__error" role="alert">{{ floorStore.error }}</p>

		<div class="floor-view__stage" :class="{ 'floor-view__stage--wide': wide }">
			<template v-if="!floors.length">
				<div class="floor-view__blank">
					<v-icon icon="mdi-table-furniture" size="32" />
					<p class="floor-view__blank-text">{{ noFloorsLabel }}</p>
					<p class="floor-view__blank-hint">{{ noFloorsHint }}</p>
				</div>
			</template>
			<FloorEditor
				v-else-if="editorMode"
				:available-width="panelWidth"
				@done="floorStore.setEditorMode(false)"
			/>
			<template v-else-if="!activeFloorTables.length">
				<div class="floor-view__blank">
					<v-icon icon="mdi-table-furniture" size="32" />
					<p class="floor-view__blank-text">{{ emptyFloorLabel }}</p>
					<v-btn color="primary" variant="flat" size="small" @click="floorStore.setEditorMode(true)">
						{{ editFloorLabel }}
					</v-btn>
				</div>
			</template>
			<FloorPlan
				v-else-if="viewMode === 'plan'"
				:available-width="planWidth"
				:fit="fit"
				@open="openTable"
			/>
			<FloorKanban v-else @open="openTable" />

			<!-- The open ticket's own detail. Transfer starts here rather than from
			     a tile menu: the gesture is "this order, somewhere else", and the
			     order the waiter means is the one they have open. -->
			<TableTicketPanel
				v-if="activeOrder && !transferOrder && wide"
				:order="activeOrder"
				:table-label="activeOrderTableLabel"
				variant="rail"
				:firing="firing"
				:releasing="releasing"
				@fire="fire"
				@transfer="floorStore.beginTransfer(activeOrder)"
				@release="release"
			/>
		</div>

		<TableTicketPanel
			v-if="activeOrder && !transferOrder && !wide"
			:order="activeOrder"
			:table-label="activeOrderTableLabel"
			variant="strip"
			:firing="firing"
			:releasing="releasing"
			@fire="fire"
			@transfer="floorStore.beginTransfer(activeOrder)"
			@release="release"
		/>

		<JumpPad v-model="jumpOpen" @open-table="openTable" @open-tab="openNamedTab" />
	</div>
</template>

<script setup lang="ts">
/**
 * The floor screen: floor switcher, plan/kanban toggle, editor toggle, jump
 * pad, tabs rail, and the open ticket's detail. It is a fifth `activeView` in
 * the shell, not a route of its own and not an items panel — see spec §1 for
 * why the registry stays out of this.
 *
 * Layout branches on the panel's MEASURED width, not the window's. The floor
 * lives inside the shell's selector column, which is 5/12 of the window at
 * desk widths and 12/12 in the compact switcher — so window width is not a
 * usable proxy for the room this component actually has, and a media query
 * here would put a side rail on a 500px column.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import FloorEditor from "./FloorEditor.vue";
import FloorKanban from "./FloorKanban.vue";
import FloorPlan from "./FloorPlan.vue";
import JumpPad from "./JumpPad.vue";
import TableTicketPanel from "./TableTicketPanel.vue";
import TabsRail from "./TabsRail.vue";
import { resolveCanvas } from "./floorGeometry";
import { bus } from "../../bus";
import { useFloorStore, type OrderRow, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);

/**
 * Enough room for a 360px plan beside a 240px rail. Below it the ticket detail
 * becomes a strip under the board instead — the same component, laid out for a
 * thumb.
 */
const WIDE_PANEL = 640;
/** The rail's own width, subtracted before the plan computes its fit scale. */
const RAIL_WIDTH = 248;

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

const panelEl = ref<HTMLElement | null>(null);
const panelWidth = ref(0);
const jumpOpen = ref(false);
const firing = ref(false);
const releasing = ref(false);
/** null = follow the default (fit only when the room overflows the panel). */
const fitOverride = ref<boolean | null>(null);

const floors = computed(() => floorStore.floors);
const activeOrder = computed(() => floorStore.activeOrder);
const activeFloor = computed(() => floorStore.activeFloor);
const activeFloorTables = computed(() => floorStore.activeFloorTables);
const viewMode = computed(() => floorStore.viewMode);
const editorMode = computed(() => floorStore.editorMode);
const transferOrder = computed(() => floorStore.transferOrder);

const wide = computed(() => panelWidth.value >= WIDE_PANEL);
const planWidth = computed(() =>
	Math.max(0, panelWidth.value - (wide.value && activeOrder.value ? RAIL_WIDTH : 0)),
);

const canvasWidth = computed(() => {
	const canvas = resolveCanvas(floorStore.activeFloorRow);
	return canvas.cols * canvas.cell;
});

/**
 * Fit is the default whenever the authored room is wider than the space it has
 * to land in — which on a phone is always. A waiter who opens the floor should
 * see the whole floor, not its top-left corner.
 */
const fit = computed(() =>
	fitOverride.value === null ? canvasWidth.value > planWidth.value : fitOverride.value,
);

/** Occupancy per floor, so the switcher reports the room instead of naming it. */
const floorTabs = computed(() =>
	floors.value.map((floor) => {
		const tables = floorStore.tables.filter(
			(table) => table.floor === floor.name && table.is_active !== 0,
		);
		return {
			name: floor.name,
			floor_name: floor.floor_name,
			total: tables.length,
			busy: tables.filter((table) => floorStore.isOccupied(table.name)).length,
		};
	}),
);

const jumpLabel = computed(() => `${verticalStore.t("Go to")} ${verticalStore.t("Table")}`);
const editLabel = computed(() => verticalStore.t("Edit floor plan"));
const editFloorLabel = computed(() => verticalStore.t("Edit floor plan"));
const fitLabel = computed(() => verticalStore.t("Fit the whole floor"));
const emptyFloorLabel = computed(() =>
	verticalStore.t("No tables yet — edit your floor plan to add some"),
);
const noFloorsLabel = computed(() => verticalStore.t("No floors configured for this register"));
const noFloorsHint = computed(() =>
	verticalStore.t("Add a floor in the register's setup, then lay out its tables here."),
);
const toggleLabel = computed(() =>
	viewMode.value === "plan" ? verticalStore.t("List view") : verticalStore.t("Plan view"),
);
const transferBannerText = computed(() => {
	const order = transferOrder.value;
	const who = order?.tab_name || order?.order_uid.slice(0, 6) || "";
	return `${verticalStore.t("Pick a free table for")} ${who}`;
});

const activeOrderTableLabel = computed(() => {
	const order = activeOrder.value;
	if (!order?.table) return "";
	const table = floorStore.tables.find((row) => row.name === order.table);
	return table ? table.table_label : "";
});

/**
 * "Send" fires the whole ticket; explicit per-course firing is phase 2 (spec
 * §5), so no course index is passed. The printing itself belongs to the QZ
 * path — this only asks the server for the projection.
 */
async function fire() {
	firing.value = true;
	try {
		const projection = await floorStore.fireActiveCourse();
		if (projection) bus.emit("floor_course_fired", projection);
	} finally {
		firing.value = false;
	}
}

/**
 * Spec §3: "release table" is cancelling the table's EMPTY order.
 *
 * The emptiness has to be re-checked AFTER flushing, not just read off the row
 * the button was rendered from. `items_count` only catches up when the cart
 * sync debounce fires, so a waiter who types a line and immediately taps
 * Release would otherwise cancel a ticket that already has food on it.
 */
async function release() {
	if (!activeOrder.value) return;
	releasing.value = true;
	try {
		await floorStore.flushCartSync();
		const order = floorStore.activeOrder;
		if (!order || order.items_count) return;
		await floorStore.cancelOrder(order);
	} finally {
		releasing.value = false;
	}
}

function toggleViewMode() {
	floorStore.setViewMode(viewMode.value === "plan" ? "kanban" : "plan");
}

/**
 * Tap IS the transition (spec §3) — no "seat party" dialog. Once the order is
 * open the shell moves to the cart, because the next thing a waiter does is
 * add food.
 */
async function openTable(table: TableRow) {
	const order = await floorStore.openOrCreate(table);
	if (order) bus.emit("floor_order_opened", { order_uid: order.order_uid });
}

async function openNamedTab(tabName: string) {
	const order = await floorStore.openTab(tabName);
	if (order) bus.emit("floor_order_opened", { order_uid: order.order_uid });
}

/**
 * A row off the tabs rail comes from the floor SNAPSHOT, which carries counts
 * and no lines — so it has to be hydrated before it reaches the cart, or the
 * waiter resumes a ticket that looks empty.
 */
async function openTabOrder(row: OrderRow) {
	const order = await floorStore.resumeOrder(row);
	if (order) bus.emit("floor_order_opened", { order_uid: order.order_uid });
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "Escape" && floorStore.transferOrder) {
		floorStore.cancelTransfer();
	}
}

let observer: ResizeObserver | null = null;

onMounted(() => {
	void floorStore.activate();
	window.addEventListener("keydown", onKeydown);
	const element = panelEl.value;
	if (!element) return;
	panelWidth.value = element.clientWidth;
	if (typeof ResizeObserver === "undefined") return;
	observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry) panelWidth.value = entry.contentRect.width;
	});
	observer.observe(element);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
	observer?.disconnect();
	observer = null;
	floorStore.deactivate();
});
</script>

<style scoped src="./floor-view.css"></style>
