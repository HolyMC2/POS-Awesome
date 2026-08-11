<template>
	<div class="floor-view">
		<!-- Transfer is a modal gesture (spec §4): the banner is the mode, the
		     whole floor is the target picker, Esc is the way out. -->
		<div v-if="transferOrder" class="floor-view__banner" role="status">
			<v-icon icon="mdi-swap-horizontal" size="18" />
			<span class="floor-view__banner-text">{{ transferBannerText }}</span>
			<v-btn size="small" variant="text" @click="floorStore.cancelTransfer()">
				{{ __("Cancel") }}
			</v-btn>
		</div>

		<header class="floor-view__bar">
			<div class="floor-view__floors">
				<button
					v-for="floor in floors"
					:key="floor.name"
					type="button"
					class="floor-view__floor"
					:class="{ 'floor-view__floor--active': floor.name === activeFloor }"
					:data-test="`floor-tab-${floor.name}`"
					@click="floorStore.setActiveFloor(floor.name)"
				>
					{{ floor.floor_name }}
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

		<!-- The open ticket's own actions. Transfer starts here rather than from a
		     tile menu: the gesture is "this order, somewhere else", and the order
		     the waiter means is the one they have open. -->
		<div v-if="activeOrder && !transferOrder" class="floor-view__ticket">
			<span class="floor-view__ticket-name">{{ activeOrderLabel }}</span>
			<v-btn
				size="small"
				variant="text"
				prepend-icon="mdi-silverware-variant"
				:loading="firing"
				:disabled="firing"
				data-test="floor-fire"
				@click="fire"
			>
				{{ fireLabel }}
			</v-btn>
			<v-btn
				size="small"
				variant="text"
				prepend-icon="mdi-swap-horizontal"
				data-test="floor-transfer"
				@click="floorStore.beginTransfer(activeOrder)"
			>
				{{ transferLabel }}
			</v-btn>
		</div>

		<TabsRail show-new @open="openTabOrder" @new-tab="jumpOpen = true" />

		<p v-if="floorStore.error" class="floor-view__error" role="alert">{{ floorStore.error }}</p>

		<template v-if="!floors.length">
			<div class="floor-view__blank">
				<v-icon icon="mdi-table-furniture" size="32" />
				<p class="floor-view__blank-text">{{ noFloorsLabel }}</p>
			</div>
		</template>
		<FloorEditor v-else-if="editorMode" @done="floorStore.setEditorMode(false)" />
		<template v-else-if="!activeFloorTables.length">
			<div class="floor-view__blank">
				<v-icon icon="mdi-table-furniture" size="32" />
				<p class="floor-view__blank-text">{{ emptyFloorLabel }}</p>
				<v-btn color="primary" variant="flat" size="small" @click="floorStore.setEditorMode(true)">
					{{ editFloorLabel }}
				</v-btn>
			</div>
		</template>
		<FloorPlan v-else-if="viewMode === 'plan'" @open="openTable" />
		<FloorKanban v-else @open="openTable" />

		<JumpPad v-model="jumpOpen" @open-table="openTable" @open-tab="openNamedTab" />
	</div>
</template>

<script setup lang="ts">
/**
 * The floor screen: floor switcher, plan/kanban toggle, editor toggle, jump
 * pad, tabs rail. It is a fifth `activeView` in the shell, not a route of its
 * own and not an items panel — see spec §1 for why the registry stays out of
 * this.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import FloorEditor from "./FloorEditor.vue";
import FloorKanban from "./FloorKanban.vue";
import FloorPlan from "./FloorPlan.vue";
import JumpPad from "./JumpPad.vue";
import TabsRail from "./TabsRail.vue";
import { bus } from "../../bus";
import { useFloorStore, type OrderRow, type TableRow } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

const jumpOpen = ref(false);
const firing = ref(false);

const floors = computed(() => floorStore.floors);
const activeOrder = computed(() => floorStore.activeOrder);
const activeFloor = computed(() => floorStore.activeFloor);
const activeFloorTables = computed(() => floorStore.activeFloorTables);
const viewMode = computed(() => floorStore.viewMode);
const editorMode = computed(() => floorStore.editorMode);
const transferOrder = computed(() => floorStore.transferOrder);

const jumpLabel = computed(() => `${verticalStore.t("Go to")} ${verticalStore.t("Table")}`);
const editLabel = computed(() => verticalStore.t("Edit floor plan"));
const editFloorLabel = computed(() => verticalStore.t("Edit floor plan"));
const emptyFloorLabel = computed(() => verticalStore.t("No tables yet — edit your floor plan to add some"));
const noFloorsLabel = computed(() => verticalStore.t("No floors configured for this register"));
const toggleLabel = computed(() =>
	viewMode.value === "plan" ? verticalStore.t("List view") : verticalStore.t("Plan view"),
);
const transferBannerText = computed(() => {
	const order = transferOrder.value;
	const who = order?.tab_name || order?.order_uid.slice(0, 6) || "";
	return `${verticalStore.t("Pick a free table for")} ${who}`;
});

const fireLabel = computed(() => verticalStore.t("Send"));
const transferLabel = computed(() => verticalStore.t("Transfer"));
const activeOrderLabel = computed(() => {
	const order = activeOrder.value;
	if (!order) return "";
	if (order.tab_name) return order.tab_name;
	const table = floorStore.tables.find((row) => row.name === order.table);
	return table ? table.table_label : order.order_uid.slice(0, 6);
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

onMounted(() => {
	void floorStore.activate();
	window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
	window.removeEventListener("keydown", onKeydown);
	floorStore.deactivate();
});
</script>

<style scoped>
/* The whole screen is one bounded flex column: the plan/kanban child owns the
   only scrollport. An auto-height ancestor here is the height-chain bug that
   hides the bottom of the floor behind the mobile dock. */
.floor-view {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: calc(100dvh - var(--bottom-safe-space, 24px) - 92px);
	max-height: calc(100dvh - var(--bottom-safe-space, 24px) - 92px);
	overflow: hidden;
	margin-top: 12px;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
}

.floor-view__banner {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 0 0 auto;
	padding: 6px 10px;
	background: var(--pos-info-container);
	color: var(--pos-text-primary);
}

.floor-view__banner-text {
	flex: 1 1 auto;
	font-size: 13px;
	font-weight: 600;
	color: var(--pos-text-primary);
}

.floor-view__ticket {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 0 0 auto;
	padding: 4px 8px;
	border-bottom: 1px solid var(--pos-border);
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.floor-view__ticket-name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
}

.floor-view__bar {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 0 0 auto;
	padding: 6px 8px;
	border-bottom: 1px solid var(--pos-border);
	background: var(--pos-surface);
}

.floor-view__floors {
	display: flex;
	gap: 4px;
	flex: 1 1 auto;
	min-width: 0;
	overflow-x: auto;
}

.floor-view__floor {
	flex: 0 0 auto;
	min-height: 36px;
	padding: 4px 12px;
	border: 1px solid var(--pos-border);
	border-radius: 999px;
	background: var(--pos-surface-container);
	color: var(--pos-text-secondary);
	font-size: 13px;
	font-weight: 600;
}

.floor-view__floor--active {
	border-color: var(--pos-primary);
	background: var(--pos-primary-container);
	color: var(--pos-text-primary);
}

.floor-view__actions {
	display: flex;
	align-items: center;
	gap: 2px;
	flex: 0 0 auto;
}

.floor-view__error {
	flex: 0 0 auto;
	margin: 0;
	padding: 6px 10px;
	background: var(--pos-error-container);
	color: var(--pos-text-primary);
	font-size: 12px;
}

.floor-view__blank {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: 24px;
	text-align: center;
	background: var(--pos-bg-secondary);
	color: var(--pos-text-secondary);
}

.floor-view__blank-text {
	margin: 0;
	max-width: 280px;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 14px;
}
</style>
