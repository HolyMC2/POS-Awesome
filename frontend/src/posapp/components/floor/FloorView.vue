<template>
	<div ref="panelEl" class="floor-view" :class="{ 'floor-view--stage': stage }">
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
			<!-- Two verbs stay on the bar; the rest move behind a labelled menu.
			     Five icon-only buttons taught nobody what they did and left the
			     floor switcher so little width that "Salón Principal" rendered
			     as "Salón Pri…" — the one label on the bar that has to be read. -->
			<div class="floor-view__actions">
				<v-btn
					size="small"
					variant="text"
					icon="mdi-dialpad"
					:aria-label="jumpLabel"
					:title="jumpLabel"
					data-test="floor-jump"
					@click="jumpOpen = true"
				/>
				<v-btn
					size="small"
					variant="text"
					icon="mdi-refresh"
					:loading="floorStore.loading"
					:aria-label="__('Refresh')"
					:title="__('Refresh')"
					data-test="floor-refresh"
					@click="floorStore.refresh()"
				/>
				<v-menu location="bottom end">
					<template #activator="{ props: menuProps }">
						<v-btn
							v-bind="menuProps"
							size="small"
							variant="text"
							icon="mdi-dots-vertical"
							:aria-label="moreLabel"
							:title="moreLabel"
							data-test="floor-more"
						/>
					</template>
					<v-list density="compact" class="floor-view__menu">
						<v-list-item
							:prepend-icon="viewMode === 'plan' ? 'mdi-view-list-outline' : 'mdi-floor-plan'"
							:title="toggleLabel"
							data-test="floor-toggle-view"
							@click="toggleViewMode"
						/>
						<v-list-item
							v-if="viewMode === 'plan' && !editorMode"
							prepend-icon="mdi-fit-to-page-outline"
							:title="fitLabel"
							:active="fit"
							data-test="floor-fit"
							@click="fitOverride = !fit"
						/>
						<v-list-item
							:prepend-icon="editorMode ? 'mdi-check' : 'mdi-pencil-outline'"
							:title="editorMode ? doneEditingLabel : editLabel"
							:disabled="!floors.length"
							data-test="floor-edit"
							@click="floorStore.setEditorMode(!editorMode)"
						/>
					</v-list>
				</v-menu>
			</div>
		</header>

		<TabsRail show-new @open="openTabOrder" @new-tab="jumpOpen = true" />

		<p v-if="floorStore.error" class="floor-view__error" role="alert">{{ floorStore.error }}</p>

		<!-- The plan carries five encodings (fill, colour, ring, badge, broom)
		     and shipped with none of them written down, on the theory that one
		     visual variable per meaning needs no legend. It needs one line. The
		     line is cheap and it is the first thing a new waiter reads. It sits
		     OUTSIDE the stage: the stage turns into a row on a wide panel, and a
		     legend that became a column beside the plan would be worse than none. -->
		<p v-if="showLegend" class="floor-view__legend">{{ legendLabel }}</p>

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
				:selected-table="selectedTableName"
				@open="askTable"
			/>
			<FloorKanban v-else @open="askTable" />

			<!-- The mesa sheet: the whole answer for the table under the finger,
			     beside the room instead of over it. Only where the stage is the
			     floor's and there is width for a 352px column — everywhere else
			     the modal `TableActionSheet` is still what a tap raises. -->
			<MesaSheet
				v-if="mesaSheetTable && !transferOrder"
				class="floor-view__sheet"
				:table="mesaSheetTable"
				:orders="selectedTableOrders"
				:selected-uid="selectedAccountUid"
				:firing="firing"
				:releasing="releasing"
				@select="pickAccount"
				@add-items="sheetAddItems"
				@fire="sheetFire"
				@view="sheetView"
				@transfer="sheetTransfer"
				@release="sheetRelease"
				@open="sheetOpenTable"
				@clean="sheetClean"
			/>

			<!-- The open ticket's own detail. Transfer starts here rather than from
			     a tile menu: the gesture is "this order, somewhere else", and the
			     order the waiter means is the one they have open. -->
			<TableTicketPanel
				v-else-if="activeOrder && !transferOrder && wide"
				:order="activeOrder"
				:table-label="activeOrderTableLabel"
				variant="rail"
				:firing="firing"
				:releasing="releasing"
				@add-items="goToItems"
				@charge="chargeActiveOrder"
				@fire="fireWithCoursePrompt"
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
			@add-items="goToItems"
			@charge="chargeActiveOrder"
			@fire="fireWithCoursePrompt"
			@transfer="floorStore.beginTransfer(activeOrder)"
			@release="release"
		/>

		<!-- Per-course firing (critique B4): shown only when the unfired lines
		     span 2+ courses — a one-course round fires without a question, so
		     nothing changes for the register that never courses. -->
		<v-dialog v-model="courseChooserOpen" max-width="360" @update:model-value="onCourseChooserToggle">
			<v-card class="course-chooser" data-testid="course-chooser">
				<v-card-title>{{ __("Send to kitchen") }}</v-card-title>
				<v-card-text class="course-chooser__body">
					<button
						type="button"
						class="course-chooser__option course-chooser__option--all"
						data-testid="course-fire-all"
						@click="resolveCourseChoice('all')"
					>
						{{ __("Everything") }} · {{ unfiredCourseTotal }}
					</button>
					<button
						v-for="course in unfiredCourses"
						:key="course.idx"
						type="button"
						class="course-chooser__option"
						:data-testid="`course-fire-${course.idx}`"
						@click="resolveCourseChoice(course.idx)"
					>
						{{ __("Course") }} {{ course.idx }} · {{ course.count }}
					</button>
				</v-card-text>
			</v-card>
		</v-dialog>

		<JumpPad v-model="jumpOpen" @open-table="openTable" @open-tab="openNamedTab" />
		<TableActionSheet
			v-model="sheetOpen"
			:table="sheetTable"
			@action="onSheetAction"
			@order="openSelectedOrder"
		/>

		<!-- THE SALÓN'S OWN BAND (golden flow §2).
		     ────────────────────────────────────────────────────────────────
		     The band's two lanes are filled by whoever owns the figures, the
		     way `InvoiceSummary` fills them on the sale screen. Here that is
		     the floor: the cuenta beside the one selected, the table's
		     informative total, and the room's occupancy. `Pos.vue` gets the
		     NUMBER and the ACTION through `@band`; only the columns travel by
		     teleport, because the shell has neither the selection nor the
		     snapshot to compute them from.

		     `v-if` rather than `:disabled`, because with no band on screen
		     there is nothing to say — rendering these in place would put a
		     second copy of the room's stats inside the room. -->
		<Teleport v-if="ownsBand" defer to="[data-band-lane='breakdown']">
			<span class="floor-view__band-divider" aria-hidden="true"></span>
			<div class="floor-view__band-col" data-testid="floor-band-breakdown">
				<div v-for="row in bandBreakdownRows" :key="row.key" class="floor-view__band-row">
					<span class="floor-view__band-term">{{ row.term }}</span>
					<span class="floor-view__band-value">{{ row.value }}</span>
				</div>
			</div>
		</Teleport>
		<Teleport v-if="ownsBand" defer to="[data-band-lane='context']">
			<span class="floor-view__band-divider" aria-hidden="true"></span>
			<div class="floor-view__band-col" data-testid="floor-band-stats">
				<span class="floor-view__band-label">{{ salonNowLabel }}</span>
				<div v-for="row in bandStatRows" :key="row.key" class="floor-view__band-row">
					<span
						class="floor-view__band-term"
						:class="{ 'floor-view__band-term--warn': row.warn }"
						>{{ row.term }}</span
					>
					<span
						class="floor-view__band-value"
						:class="{ 'floor-view__band-value--warn': row.warn }"
						>{{ row.value }}</span
					>
				</div>
			</div>
		</Teleport>
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
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import FloorEditor from "./FloorEditor.vue";
import FloorKanban from "./FloorKanban.vue";
import FloorPlan from "./FloorPlan.vue";
import JumpPad from "./JumpPad.vue";
import MesaSheet from "./MesaSheet.vue";
import TableActionSheet, { type TableSheetAction } from "./TableActionSheet.vue";
import TableTicketPanel from "./TableTicketPanel.vue";
import TabsRail from "./TabsRail.vue";
import { resolveCanvas } from "./floorGeometry";
import { bus as importedBus } from "../../bus";
import * as restaurantApi from "../../api/restaurant";
import { useFloorStore, type OrderRow, type TableRow } from "../../stores/floorStore";
import { useInvoiceStore } from "../../stores/invoiceStore";
import { useVerticalStore } from "../../stores/verticalStore";
import { useFormat } from "../../format";
import { resolveBandState, type BandState } from "../../composables/pos/shell/bandState";
import { trackCustomMark } from "../../utils/telemetry";
import type { KotProjection } from "../../../offline/restaurantTypes";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);

const props = withDefaults(
	defineProps<{
		/**
		 * The floor is the whole screen, not a column in it (golden flow §2).
		 * Passed by the shell rather than measured here: whether the sale's
		 * column stood down is the shell's fact, and a panel that is merely
		 * wide is not the same thing.
		 */
		ownsStage?: boolean;
		/** The shell's band is showing what this component publishes. */
		ownsBand?: boolean;
	}>(),
	{ ownsStage: false, ownsBand: false },
);

const emit = defineEmits<{ (_event: "band", _state: BandState | null): void }>();

/**
 * Enough room for a 360px plan beside a 240px rail. Below it the ticket detail
 * becomes a strip under the board instead — the same component, laid out for a
 * thumb.
 */
const WIDE_PANEL = 640;
/** The rail's own width, subtracted before the plan computes its fit scale. */
const RAIL_WIDTH = 248;
/** `Salon.dc.html`'s mesa sheet. Wider than the rail because it carries every
 *  cuenta on the table with its own total, not just the open ticket's facts. */
const MESA_SHEET_WIDTH = 352;
/** Below this the 352px sheet would leave the room less than the ~616px it is
 *  authored at, so the stage falls back to the shipped 248px ticket rail. */
const STAGE_SHEET_MIN_PANEL = 900;
/** The stage's own gap between the plan and the sheet (see floor-view.css). */
const STAGE_GAP = 12;

/**
 * The bus the SHELL is listening on, taken by injection like every other
 * component in this app — not the module import.
 *
 * The floor was the one screen that emitted on the imported `bus` singleton,
 * and its events never arrived: `floor_order_opened` has been landing nowhere,
 * which is why opening a table left the waiter staring at the plan instead of
 * the cart the handler was written to show. Injection binds to the instance the
 * plugin installed, so an emit here reaches Pos.vue by construction. The import
 * stays as the fallback for tests that mount this component with no app.
 */
const bus = inject<typeof importedBus>("eventBus", importedBus);

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();
const { formatCurrency } = useFormat();

const panelEl = ref<HTMLElement | null>(null);
const panelWidth = ref(0);
const jumpOpen = ref(false);
const sheetOpen = ref(false);
const sheetTable = ref<TableRow | null>(null);
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
/** The full-stage arrangement: the shell gave up the sale's column AND there
 *  is enough measured width to lay the room out beside a sheet. */
const stage = computed(() => props.ownsStage && wide.value);

// ---- the selected table and its cuentas ---------------------------------
//
// Selection is a state the shipped floor never had: a tap RAISED the modal and
// the floor forgot the table the moment it closed. The stage needs it to
// persist — the sheet is beside the room, not over it, and the band names the
// cuenta it would charge.
const selectedTableName = ref<string | null>(null);
const selectedAccountUid = ref<string | null>(null);

const selectedTable = computed(
	() => floorStore.tables.find((row) => row.name === selectedTableName.value) || null,
);
const selectedTableOrders = computed(() =>
	selectedTable.value ? floorStore.ordersForTable(selectedTable.value.name) : [],
);
/**
 * The cuenta the sheet's verbs and the band's number belong to. Falls back to
 * the table's first order so a single-account table needs no choosing, and
 * never invents one for a split bill the operator has already picked from.
 */
const selectedAccount = computed<OrderRow | null>(() => {
	const rows = selectedTableOrders.value;
	if (!rows.length) return null;
	return rows.find((row) => row.order_uid === selectedAccountUid.value) || rows[0] || null;
});

const showMesaSheet = computed(
	() => stage.value && panelWidth.value >= STAGE_SHEET_MIN_PANEL && Boolean(selectedTable.value),
);
/** Null unless the sheet is on: the prop is non-nullable, and this is what
 *  lets the template narrow it. */
const mesaSheetTable = computed(() => (showMesaSheet.value ? selectedTable.value : null));

const planWidth = computed(() => {
	if (showMesaSheet.value) {
		return Math.max(0, panelWidth.value - MESA_SHEET_WIDTH - STAGE_GAP);
	}
	return Math.max(0, panelWidth.value - (wide.value && activeOrder.value ? RAIL_WIDTH : 0));
});

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
const moreLabel = computed(() => verticalStore.t("More options"));
const doneEditingLabel = computed(() => verticalStore.t("Done editing"));
/** Only where the encodings it explains are on screen. */
const showLegend = computed(
	() =>
		viewMode.value === "plan" &&
		!editorMode.value &&
		floors.value.length > 0 &&
		activeFloorTables.value.length > 0,
);
const legendLabel = computed(() => verticalStore.t("Tap a table to open it · outline = free · filled = occupied · red number = waiting for the kitchen"));
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

// ---- the salón band ------------------------------------------------------

const salonNowLabel = computed(() => verticalStore.t("Floor now"));

const tableLabelFor = (name: string | null | undefined) =>
	(name && floorStore.tables.find((row) => row.name === name)?.table_label) || "";

const accountName = (order: OrderRow | null) =>
	order ? order.tab_name || order.order_uid.slice(0, 6) : "";

/** «Mesa 7 · Sofía» — the table first, because that is what the waiter walks
 *  back to, then who is sitting at it. */
const selectedAccountLabel = computed(() => {
	const account = selectedAccount.value;
	if (!account) return "";
	return [tableLabelFor(account.table), account.tab_name].filter(Boolean).join(" · ");
});

/**
 * The band's number is the SELECTED cuenta's own total, never the table's.
 * UX map §5: the combined total is not displayed beside an action that can
 * settle only one account, and Charge is not offered for an empty one.
 */
const floorBandState = computed<BandState>(() =>
	resolveBandState({
		kind: "floorAccount",
		total: Number(selectedAccount.value?.total) || 0,
		accountLabel: selectedAccountLabel.value,
		chargeable: Number(selectedAccount.value?.items_count) > 0,
	}),
);

watch(
	() => (props.ownsBand ? floorBandState.value : null),
	(state) => emit("band", state),
	{ immediate: true },
);

/** The other cuentas on this table, then the room's open money. */
const bandBreakdownRows = computed(() => {
	const rows: Array<{ key: string; term: string; value: string }> = [];
	const account = selectedAccount.value;
	const tableOrders = selectedTableOrders.value;
	if (account && tableOrders.length > 1) {
		for (const other of tableOrders.filter((row) => row.order_uid !== account.order_uid).slice(0, 2)) {
			rows.push({
				key: other.order_uid,
				term: `${accountName(other)} · ${verticalStore.t("separate")}`,
				value: formatCurrency(Number(other.total) || 0),
			});
		}
		rows.push({
			key: "table-total",
			term: `${tableLabelFor(account.table)} · ${verticalStore.t("informational")}`,
			value: formatCurrency(
				tableOrders.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
			),
		});
	}
	rows.push({
		key: "floor-open",
		term: verticalStore.t("Open in the floor"),
		value: formatCurrency(floorStore.floorStats.openTotal),
	});
	return rows;
});

const bandStatRows = computed(() => {
	const stats = floorStore.floorStats;
	return [
		{
			key: "occupied",
			term: verticalStore.t("Occupied"),
			value: `${stats.occupied} / ${stats.tables}`,
			warn: false,
		},
		{
			key: "accounts",
			term: verticalStore.t("Open accounts"),
			value: String(stats.openAccounts),
			warn: false,
		},
		{
			key: "cleaning",
			term: verticalStore.t("Needs cleaning"),
			value: String(stats.needsCleaning),
			warn: stats.needsCleaning > 0,
		},
	];
});

/**
 * "Send" fires the whole ticket; explicit per-course firing is phase 2 (spec
 * §5), so no course index is passed. The printing itself belongs to the QZ
 * path — this only asks the server for the projection.
 */
async function fire(courseIdx?: number): Promise<KotProjection | null> {
	firing.value = true;
	const startedAt = floorActionStart();
	// Captured BEFORE the await: the sale-screen path returns to the salón
	// right after this resolves, and returnToSalon drops the active order.
	const firedTable = floorStore.activeOrder?.table || null;
	try {
		const projection = await floorStore.fireActiveCourse(courseIdx);
		if (projection) {
			floorActionEnd(startedAt);
			// The SEND succeeded — the server took the diff. Say so NOW
			// (critique B1): the print verdict below arrives seconds later
			// and, with no printing spine, may never arrive at all.
			bus.emit("show_message", {
				title: __("Comanda enviada a cocina"),
				color: "success",
				timeout: 3000,
			});
			// A re-fire is the recovery gesture for a failed print — the old
			// alert is stale the moment a new ticket is on its way.
			floorStore.setKitchenAlert(firedTable, false);
			bus.emit("floor_course_fired", projection);
			void watchKitchenBatchVerdict(projection, firedTable);
		}
		return projection;
	} finally {
		firing.value = false;
	}
}

/**
 * Per-course firing (critique B4). The line model always had `course_idx`
 * and the server always accepted a course filter — «phase 2» was only ever
 * this prompt. The cart is the pre-fire truth (order lines lag the debounce),
 * and only UNFIRED lines count: fired ones are the kitchen's history.
 */
const courseChooserOpen = ref(false);
let courseChoiceResolver: ((choice: number | "all" | null) => void) | null = null;

// Lazy + guarded, the CartItemRow pattern: the spec harnesses that mount
// this view mock the floor store and carry no invoice store; a bare cart
// means one course, which fires without a question — the right degrade.
let invoiceStoreInstance: any = null;
const cartItems = (): any[] => {
	if (invoiceStoreInstance === null) {
		try {
			invoiceStoreInstance = useInvoiceStore();
		} catch {
			invoiceStoreInstance = false;
		}
	}
	return invoiceStoreInstance ? (invoiceStoreInstance.items as any[]) : [];
};

const unfiredCourses = computed(() => {
	const counts = new Map<number, number>();
	for (const item of cartItems()) {
		if (Number(item?.posa_line_fired)) continue;
		const idx = Number(item?.posa_course_idx) || 1;
		counts.set(idx, (counts.get(idx) || 0) + 1);
	}
	return [...counts.entries()]
		.map(([idx, count]) => ({ idx, count }))
		.sort((a, b) => a.idx - b.idx);
});
const unfiredCourseTotal = computed(() =>
	unfiredCourses.value.reduce((sum, course) => sum + course.count, 0),
);

const resolveCourseChoice = (choice: number | "all" | null) => {
	courseChooserOpen.value = false;
	const resolver = courseChoiceResolver;
	courseChoiceResolver = null;
	resolver?.(choice);
};
// Dismissing the dialog (backdrop, Esc) is «no» — the round stays put.
const onCourseChooserToggle = (open: boolean) => {
	if (!open && courseChoiceResolver) resolveCourseChoice(null);
};

async function fireWithCoursePrompt(): Promise<KotProjection | null> {
	await floorStore.flushCartSync().catch(() => {});
	if (unfiredCourses.value.length < 2) return fire();
	const choice = await new Promise<number | "all" | null>((resolve) => {
		courseChoiceResolver = resolve;
		courseChooserOpen.value = true;
	});
	if (choice === null) return null;
	return fire(choice === "all" ? undefined : choice);
}

const KITCHEN_VERDICT_POLL_MS = 3000;
const KITCHEN_VERDICT_TIMEOUT_MS = 30000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Audit r2 A6: "Send" advanced `last_fired` with no in-app delivery verdict —
 * the ticket could die in the print queue while the waiter walked away. Poll
 * the durable batch until the kitchen verifiably got paper, and shout when it
 * didn't. Fire-and-forget: never blocks the register.
 */
async function watchKitchenBatchVerdict(projection: KotProjection, firedTable: string | null = null) {
	const batchName = projection.batch?.name;
	const orderUid = projection.orderUid;
	const printedAnything =
		(projection.stations?.length || 0) + (projection.cancellations?.length || 0) > 0;
	if (!batchName || !orderUid || !printedAnything) return;

	const startedAt = Date.now();
	while (Date.now() - startedAt < KITCHEN_VERDICT_TIMEOUT_MS) {
		await sleep(KITCHEN_VERDICT_POLL_MS);
		let verdict;
		try {
			verdict = await restaurantApi.getFireBatchStatus(orderUid, batchName);
		} catch {
			continue; // transient — keep polling until the timeout speaks
		}
		if (verdict.status === "unavailable") return; // no printing spine
		if (verdict.status === "sent" || verdict.status === "confirmed") {
			floorStore.setKitchenAlert(firedTable, false);
			bus.emit("show_message", {
				title: __("Comanda impresa en cocina"),
				color: "success",
			});
			return;
		}
		if (
			verdict.status === "failed" ||
			verdict.status === "partial" ||
			verdict.status === "cancelled"
		) {
			// The tile wears the failure too (critique B1): the waiter who
			// fired and walked back to the salón never sees a toast — the
			// table card is what they are looking at.
			floorStore.setKitchenAlert(firedTable, true);
			bus.emit("show_message", {
				title: __("El ticket de cocina NO se imprimió completo — avisa a cocina"),
				color: "error",
				timeout: -1,
			});
			return;
		}
	}
	floorStore.setKitchenAlert(firedTable, true);
	bus.emit("show_message", {
		title: __("El ticket de cocina sigue sin imprimirse — revisa la impresora"),
		color: "warning",
		timeout: -1,
	});
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
	const startedAt = floorActionStart();
	try {
		await floorStore.flushCartSync();
		const order = floorStore.activeOrder;
		if (!order || order.items_count) return;
		await floorStore.cancelOrder(order);
		floorActionEnd(startedAt);
	} finally {
		releasing.value = false;
	}
}

function toggleViewMode() {
	floorStore.setViewMode(viewMode.value === "plan" ? "kanban" : "plan");
}

/**
 * A tap on a tile ASKS instead of acting (see TableActionSheet for why the
 * v1's silent one-tap open had to go). JumpPad still opens directly: typing a
 * table number is already the explicit choice the sheet exists to collect.
 */
// Benchmark row floor_table_action (perf:pos:floor-action): tap → the floor
// verb completed, INCLUDING its server round-trip — what the waiter stands
// there waiting through. Success-only, like pos:pay-open: an early return or
// a thrown call is not a response the manifest should score. Full-rate (no
// ambient sampling): floor verbs happen per table visit, not per keystroke.
function floorActionStart(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function floorActionEnd(startedAt: number) {
	try {
		trackCustomMark(
			"pos:floor-action",
			(typeof performance !== "undefined" ? performance.now() : Date.now()) -
				startedAt,
		);
	} catch {
		/* telemetry must never block the floor */
	}
}

/**
 * A tap still ASKS — it just asks in a different place depending on how much
 * room there is to ask in. With the stage and a 352px column to spare, the
 * question is the sheet BESIDE the room; otherwise it is the modal, unchanged.
 * Either way the tile creates nothing on its own.
 */
function askTable(table: TableRow) {
	if (stage.value && panelWidth.value >= STAGE_SHEET_MIN_PANEL) {
		selectTable(table);
		return;
	}
	sheetTable.value = table;
	sheetOpen.value = true;
}

function selectTable(table: TableRow) {
	// A different table means a different set of cuentas, so the account
	// choice cannot survive the move — it would name an order that is not on
	// the table any more.
	if (selectedTableName.value !== table.name) selectedAccountUid.value = null;
	selectedTableName.value = table.name;
}

function pickAccount(order: OrderRow) {
	selectedAccountUid.value = order.order_uid;
}

/**
 * Every sheet verb acts on the SELECTED cuenta, so every one of them hydrates
 * it first: the board's rows carry counts and no lines (§F9), and a verb that
 * ran against the row would fire an empty ticket or charge a bill missing
 * someone's food. Already-open is a no-op rather than a second round-trip.
 */
async function resumeSelected(): Promise<OrderRow | null> {
	const account = selectedAccount.value;
	if (!account) return null;
	if (floorStore.activeOrder?.order_uid === account.order_uid) return floorStore.activeOrder;
	const startedAt = floorActionStart();
	const order = await floorStore.resumeOrder(account);
	if (order) floorActionEnd(startedAt);
	return order;
}

async function sheetAddItems() {
	if (await resumeSelected()) goToItems();
}

async function sheetView() {
	const order = await resumeSelected();
	if (order) bus.emit("floor_order_opened", { order_uid: order.order_uid });
}

async function sheetFire() {
	if (await resumeSelected()) await fireWithCoursePrompt();
}

function sheetTransfer() {
	const account = selectedAccount.value;
	if (account) floorStore.beginTransfer(account);
}

async function sheetRelease() {
	if (await resumeSelected()) await release();
}

async function sheetOpenTable() {
	const table = selectedTable.value;
	if (table) await openTable(table, "items");
}

async function sheetClean() {
	const table = selectedTable.value;
	if (!table) return;
	const startedAt = floorActionStart();
	await floorStore.markClean(table.name);
	floorActionEnd(startedAt);
}

/** The band's COBRAR CUENTA. Hydrate, then hand off to the invoice panel's
 *  payment validator — the floor never submits money itself (UX map §9). */
async function chargeSelectedAccount() {
	const order = await resumeSelected();
	if (order) chargeActiveOrder();
}

async function onFireRequested() {
	// From the sale screen the ticket in the cart IS the one to fire — a named
	// cup tab has no table, so routing that press through the floor's selection
	// would silently do nothing.
	if (floorStore.activeOrder) {
		const projection = await fireWithCoursePrompt();
		// The round is in the kitchen; the service loop ends back in the room
		// (critique B1 — «Enviar» used to leave the waiter staring at the same
		// cart). Pos.vue answers with its flush → detach → clear discipline,
		// and the salón lands with this table under the sheet. On failure or
		// a dismissed course prompt the cart stays exactly where it was —
		// nothing to walk away from.
		if (projection) bus.emit("floor_return_to_salon");
		return;
	}
	void sheetFire();
}

function onChargeRequested() {
	void chargeSelectedAccount();
}

// Coming back from a mesa sale lands on the room with THAT table under the
// sheet — the waiter's next thought is about the table they just served.
watch(
	() => floorStore.activeOrder,
	(order) => {
		if (!order?.table) return;
		selectedTableName.value = order.table;
		selectedAccountUid.value = order.order_uid;
	},
	{ immediate: true },
);

// A selection on another floor is a sheet describing a table nobody can see.
watch(
	() => floorStore.activeFloor,
	() => {
		selectedTableName.value = null;
		selectedAccountUid.value = null;
	},
);

/**
 * Every verb resumes the same order; they differ only in where the operator is
 * left standing. Seating a party and adding a round both end at the item list,
 * because food is the next thing typed; asking for the bill ends at the cart.
 */
async function onSheetAction(action: TableSheetAction, table: TableRow) {
	if (action === "clean") {
		const startedAt = floorActionStart();
		await floorStore.markClean(table.name);
		floorActionEnd(startedAt);
		return;
	}
	// «Liberar mesa» from the modal.
	//
	// Unlike every other sheet verb this one does NOT hydrate first. Adopting a
	// cuenta just to cancel it would load a ticket the cashier never asked for
	// into their cart — and the ticket strip that mount raises then unmounts
	// again a moment later, while the sheet's own dialog is still leaving,
	// which threw a `parentNode` TypeError on demo.lab on every release. It is
	// also the wrong gesture: clearing a table is not taking over its bill.
	//
	// What each case can trust about the line count differs, so the check does
	// too. The cuenta THIS register is holding may have lines the cart-sync
	// debounce has not written yet — that is `release()`'s flush-then-recheck,
	// unchanged. A stray this device does not hold has no local cart state at
	// all; what can be stale there is the BOARD, whose rows carry counts from
	// the last snapshot, so it is the board that gets re-read before the
	// cancel. Same rule either way: never trust the row the button was drawn
	// from.
	if (action === "release") {
		const [row] = floorStore.ordersForTable(table.name);
		if (!row) return;
		if (floorStore.activeOrder?.order_uid === row.order_uid) {
			await release();
			return;
		}
		releasing.value = true;
		const startedAt = floorActionStart();
		try {
			await floorStore.refresh({ silent: true });
			const current = floorStore
				.ordersForTable(table.name)
				.find((candidate) => candidate.order_uid === row.order_uid);
			if (!current || current.items_count) return;
			await floorStore.cancelOrder(current);
			floorActionEnd(startedAt);
		} finally {
			releasing.value = false;
		}
		return;
	}
	// A second party at the same table: open THEIR cuenta (a fresh order, never
	// the table's existing one) and land on the item list to start ringing it.
	if (action === "new-account") {
		const startedAt = floorActionStart();
		const order = await floorStore.openNewAccount(table);
		floorActionEnd(startedAt);
		if (order) goToItems();
		return;
	}
	// openTable carries its own mark — every other entry point (plan tile,
	// jump pad, tabs rail) funnels through it too.
	const opened = await openTable(table, action === "view" ? "cart" : "items");
	if (!opened) return;
	if (action === "charge") chargeActiveOrder();
}

/** A table with split accounts never routes through openOrCreate: that server
 * helper deliberately chooses the oldest order, while the operator has just
 * named the exact account they mean. Hydrate and open that row directly. */
async function openSelectedOrder(row: OrderRow) {
	const startedAt = floorActionStart();
	const order = await floorStore.resumeOrder(row);
	if (order) {
		floorActionEnd(startedAt);
		bus.emit("floor_order_opened", { order_uid: order.order_uid });
	}
}

/**
 * Open (or resume) the table's order, then put the operator where that verb
 * meant to leave them.
 *
 * `floor_order_opened` is the shell's "show me the cart" — it stays the default
 * so the jump pad and the tabs rail keep their behaviour. Opening a table to
 * take an order goes to the item list instead: landing a waiter on an EMPTY
 * cart, one more tap from the catalog, was the detour that made this screen
 * feel like it did nothing.
 */
async function openTable(table: TableRow, land: "cart" | "items" = "cart"): Promise<boolean> {
	const startedAt = floorActionStart();
	const order = await floorStore.openOrCreate(table);
	if (!order) return false;
	floorActionEnd(startedAt);
	if (land === "items") goToItems();
	else bus.emit("floor_order_opened", { order_uid: order.order_uid });
	return true;
}

/** "Agregar productos": the shell moves the panel AND the view, in one pass. */
function goToItems() {
	bus.emit("set_selector_view", "items");
}

/**
 * "Cobrar": the same round trip the dock's Pay makes, so the settle path stays
 * the one the invoice panel validates — the floor never submits money itself.
 */
function chargeActiveOrder() {
	bus.emit("request_invoice_payment");
}

async function openNamedTab(tabName: string) {
	const startedAt = floorActionStart();
	const order = await floorStore.openTab(tabName);
	if (order) {
		floorActionEnd(startedAt);
		bus.emit("floor_order_opened", { order_uid: order.order_uid });
	}
}

/**
 * A row off the tabs rail comes from the floor SNAPSHOT, which carries counts
 * and no lines — so it has to be hydrated before it reaches the cart, or the
 * waiter resumes a ticket that looks empty.
 */
async function openTabOrder(row: OrderRow) {
	const startedAt = floorActionStart();
	const order = await floorStore.resumeOrder(row);
	if (order) {
		floorActionEnd(startedAt);
		bus.emit("floor_order_opened", { order_uid: order.order_uid });
	}
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
	// The band presses land here rather than in the shell: the kitchen verdict
	// poll and the floor-action benchmark mark both live in this component, and
	// a second call site onto either would be a second place to keep honest.
	bus.on("floor_fire_active_course", onFireRequested);
	bus.on("floor_charge_selected_account", onChargeRequested);
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
	bus.off("floor_fire_active_course", onFireRequested);
	bus.off("floor_charge_selected_account", onChargeRequested);
	observer?.disconnect();
	observer = null;
	floorStore.deactivate();
});
</script>

<style scoped src="./floor-view.css"></style>
