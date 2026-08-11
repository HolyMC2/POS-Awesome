<template>
	<div class="floor-editor" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
		<div class="floor-editor__toolbar">
			<v-btn size="small" variant="tonal" prepend-icon="mdi-plus" data-test="editor-add" @click="addTable">
				{{ addLabel }}
			</v-btn>
			<span v-if="dirty" class="floor-editor__dirty">{{ unsavedLabel }}</span>
			<v-spacer />
			<v-btn size="small" variant="text" @click="emit('done')">{{ __("Close") }}</v-btn>
			<v-btn
				size="small"
				color="primary"
				variant="flat"
				:loading="saving"
				:disabled="!dirty || saving"
				data-test="editor-save"
				@click="save"
			>
				{{ __("Save") }}
			</v-btn>
		</div>

		<div class="floor-editor__body" :class="{ 'floor-editor__body--wide': wide }">
			<div class="floor-editor__scroller">
				<div class="floor-editor__stage" :style="stageStyleValue">
					<div
						class="floor-editor__canvas"
						:style="[canvasStyleValue, scaleStyle]"
						@pointerdown.self="selectedUid = null"
					>
						<!-- Where the dragged tile will land once released. The grid
						     lines alone do not answer "which cell am I on" while a
						     tile is under the thumb hiding them. -->
						<div v-if="ghost" class="floor-editor__ghost" :style="ghostStyle" aria-hidden="true" />
						<div
							v-for="entry in placed"
							:key="entry.table_uid"
							class="floor-editor__tile"
							:class="[
								`floor-editor__tile--${entry.layout.shape || 'rect'}`,
								{
									'floor-editor__tile--selected': entry.table_uid === selectedUid,
									'floor-editor__tile--dragging': drag?.uid === entry.table_uid,
								},
							]"
							:style="[tileStyleFor(entry.layout), { '--floor-tile-color': colorHex(entry.layout.color) }]"
							:data-test="`editor-tile-${entry.table_label}`"
							@pointerdown="onDown($event, entry, 'move')"
						>
							<span class="floor-editor__tile-label" :style="labelStyleFor(entry.layout)">
								{{ entry.table_label }}
							</span>
							<!-- The handle is only offered when the rendered tile is big
							     enough to host one without covering the table it resizes;
							     the rail's steppers are the path everywhere else. -->
							<span
								v-if="entry.table_uid === selectedUid && handleFits(entry.layout)"
								class="floor-editor__handle"
								:title="resizeLabel"
								@pointerdown.stop="onDown($event, entry, 'resize')"
							/>
						</div>
						<p v-if="!placed.length" class="floor-editor__empty">{{ emptyLabel }}</p>
					</div>
				</div>
			</div>

			<FloorEditorRail
				:selected="selected"
				:variant="wide ? 'rail' : 'sheet'"
				@label="setLabel"
				@seats="setSeats"
				@color="setColor"
				@resize="applyResize"
				@nudge="applyNudge"
				@rotate="applyRotate"
				@shape="applyShape"
				@duplicate="duplicateSelected"
				@deactivate="deactivate"
			/>
		</div>

		<v-dialog v-model="conflictOpen" max-width="380">
			<v-card class="pos-themed-card">
				<v-card-title class="floor-editor__conflict-title">{{ conflictTitle }}</v-card-title>
				<v-card-text class="floor-editor__conflict-body">{{ conflictBody }}</v-card-text>
				<v-card-actions>
					<v-btn variant="text" @click="conflictOpen = false">{{ __("Cancel") }}</v-btn>
					<v-spacer />
					<v-btn color="primary" variant="flat" @click="reloadAndRetry">{{ __("Reload") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
/**
 * Floor editor — the canvas, the drag, and the save. The per-table controls
 * live in `FloorEditorRail.vue` and the working-copy shape in
 * `floorEditorDraft.ts`.
 *
 * Geometry snaps to the floor's own `{cols, rows, cell}` frame, following
 * taller's BinsConstructor. The canvas is drawn at a fit scale, so pointer
 * deltas are divided by that scale before they become cells — otherwise every
 * drag on a phone moves two or three times as far as the finger did.
 *
 * Saves carry the floor's `modified` token (§6.3): a whole-floor write that
 * deactivates everything missing from the payload is exactly the shape where
 * the second manager silently wipes the first's additions. A drifted token
 * comes back as TimestampMismatch and the operator is asked, not overwritten.
 */
import { computed, ref, watch } from "vue";
import FloorEditorRail from "./FloorEditorRail.vue";
import { useFloorStore } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);
import {
	canvasStyle,
	clampToCanvas,
	colorHex,
	cycleShape,
	duplicateLayout,
	fitScale,
	labelStyle,
	nudgeLayout,
	resizeLayout,
	resolveCanvas,
	rotateLayout,
	scaledCanvasStyle,
	tileStyle,
	type PlacedLayout,
} from "./floorGeometry";
import {
	draftFromTable,
	duplicateDraft,
	newTableUid,
	nextTableLabel,
	type DraftTable,
} from "./floorEditorDraft";

const props = defineProps<{ availableWidth: number }>();
const emit = defineEmits<{ (event: "done"): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

const draft = ref<DraftTable[]>([]);
const selectedUid = ref<string | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictOpen = ref(false);

const canvas = computed(() => resolveCanvas(floorStore.activeFloorRow));
const canvasStyleValue = computed(() => canvasStyle(canvas.value));
const placed = computed(() => draft.value.filter((entry) => entry.is_active !== 0));
const selected = computed(
	() => draft.value.find((entry) => entry.table_uid === selectedUid.value) || null,
);

/** Beside the canvas once the panel can spare the width, under it otherwise. */
const wide = computed(() => props.availableWidth >= 760);

const scale = computed(() =>
	fitScale(canvas.value, wide.value ? props.availableWidth - 264 : props.availableWidth),
);
/** `--floor-inv` undoes the canvas scale for chrome that must stay grabbable. */
const scaleStyle = computed(() =>
	scale.value === 1
		? { "--floor-inv": "1" }
		: { transform: `scale(${scale.value})`, "--floor-inv": String(1 / scale.value) },
);
const stageStyleValue = computed(() => scaledCanvasStyle(canvas.value, scale.value));

const addLabel = computed(() => `${verticalStore.t("Add")} ${verticalStore.t("Table")}`);
const emptyLabel = computed(() => verticalStore.t("No tables yet — add one to start"));
const resizeLabel = computed(() => verticalStore.t("Drag to resize"));
const unsavedLabel = computed(() => verticalStore.t("Unsaved changes"));
const conflictTitle = computed(() => verticalStore.t("Floor changed elsewhere"));
const conflictBody = computed(() =>
	verticalStore.t(
		"Someone else saved this floor while you were editing. Reload their version, then save your changes again.",
	),
);

const loadDraft = () => {
	draft.value = floorStore.activeFloorTables.map((table, index) =>
		draftFromTable(table, index, canvas.value),
	);
	dirty.value = false;
	selectedUid.value = null;
};

watch(() => floorStore.activeFloor, loadDraft, { immediate: true });

function addTable() {
	const index = draft.value.length;
	const layout = clampToCanvas(
		{ x: (index % 6) * 3, y: Math.floor(index / 6) * 3, w: 2, h: 2, rotation: 0, shape: "rect" },
		canvas.value,
	);
	const entry: DraftTable = {
		table_uid: newTableUid(),
		table_label: nextTableLabel(draft.value),
		seats: 2,
		is_active: 1,
		layout,
	};
	draft.value.push(entry);
	selectedUid.value = entry.table_uid;
	dirty.value = true;
}

// ---- per-table edits ------------------------------------------------------

function setLabel(value: string) {
	if (!selected.value) return;
	selected.value.table_label = value;
	dirty.value = true;
}

function setSeats(value: string) {
	if (!selected.value) return;
	const parsed = Number(value);
	selected.value.seats = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
	dirty.value = true;
}

function setColor(color: string | undefined) {
	if (!selected.value) return;
	selected.value.layout = { ...selected.value.layout, color };
	dirty.value = true;
}

function applyResize(deltaW: number, deltaH: number) {
	if (!selected.value) return;
	selected.value.layout = resizeLayout(selected.value.layout, deltaW, deltaH, canvas.value);
	dirty.value = true;
}

function applyNudge(deltaX: number, deltaY: number) {
	if (!selected.value) return;
	selected.value.layout = nudgeLayout(selected.value.layout, deltaX, deltaY, canvas.value);
	dirty.value = true;
}

function applyRotate() {
	if (!selected.value) return;
	selected.value.layout = rotateLayout(selected.value.layout);
	dirty.value = true;
}

function applyShape() {
	if (!selected.value) return;
	selected.value.layout = cycleShape(selected.value.layout);
	dirty.value = true;
}

function duplicateSelected() {
	const source = selected.value;
	if (!source) return;
	const copy = duplicateDraft(source, draft.value, duplicateLayout(source.layout, canvas.value));
	draft.value.push(copy);
	selectedUid.value = copy.table_uid;
	dirty.value = true;
}

/**
 * Hiding, never deleting (§6.4): a table with settled invoices against it is
 * still referenced by them, so it leaves the floor and stays in the ledger.
 */
function deactivate() {
	if (!selected.value) return;
	selected.value.is_active = 0;
	selectedUid.value = null;
	dirty.value = true;
}

// ---- drag (snap to grid, taller BinsConstructor pattern) -------------------

interface DragState {
	uid: string;
	mode: "move" | "resize";
	sx: number;
	sy: number;
	ox: number;
	oy: number;
	ow: number;
	oh: number;
}

const drag = ref<DragState | null>(null);
/** The snapped footprint under the pointer, drawn behind the dragged tile. */
const ghost = ref<PlacedLayout | null>(null);

const ghostStyle = computed(() =>
	ghost.value ? tileStyle(ghost.value, canvas.value) : {},
);

/** A 22px grip must not swallow the table it resizes. */
function handleFits(layout: PlacedLayout): boolean {
	const cell = canvas.value.cell * scale.value;
	return layout.w * cell >= 64 && layout.h * cell >= 64;
}

function onDown(event: PointerEvent, entry: DraftTable, mode: "move" | "resize") {
	selectedUid.value = entry.table_uid;
	if (event.pointerType === "mouse" && event.button !== 0) return;
	drag.value = {
		uid: entry.table_uid,
		mode,
		sx: event.clientX,
		sy: event.clientY,
		ox: entry.layout.x,
		oy: entry.layout.y,
		ow: entry.layout.w,
		oh: entry.layout.h,
	};
	ghost.value = entry.layout;
	// Capture on the element the listener is bound to, not on whatever child was
	// under the finger: releasing over the label of a neighbouring tile would
	// otherwise strand the drag with no pointerup.
	(event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
	event.preventDefault();
	event.stopPropagation();
}

function onMove(event: PointerEvent) {
	const state = drag.value;
	if (!state) return;
	const entry = draft.value.find((row) => row.table_uid === state.uid);
	if (!entry) return;
	// Pointer pixels are screen pixels; cells are canvas pixels. The canvas is
	// drawn scaled, so the two only agree at 1:1.
	const cell = canvas.value.cell * scale.value;
	const dx = Math.round((event.clientX - state.sx) / cell);
	const dy = Math.round((event.clientY - state.sy) / cell);
	entry.layout =
		state.mode === "resize"
			? resizeLayout(
					{ ...entry.layout, w: state.ow, h: state.oh },
					dx,
					dy,
					canvas.value,
				)
			: clampToCanvas({ ...entry.layout, x: state.ox + dx, y: state.oy + dy }, canvas.value);
	ghost.value = entry.layout;
}

function onUp() {
	if (!drag.value) return;
	drag.value = null;
	ghost.value = null;
	dirty.value = true;
}

function tileStyleFor(layout: PlacedLayout) {
	return tileStyle(layout, canvas.value);
}

function labelStyleFor(layout: PlacedLayout) {
	return labelStyle(layout, 1 / scale.value);
}

// ---- save -----------------------------------------------------------------

const isTimestampMismatch = (error: any): boolean => {
	const haystack = [error?.exc_type, error?.message, error?._server_messages, String(error || "")]
		.filter(Boolean)
		.join(" ");
	return haystack.includes("TimestampMismatch");
};

async function save() {
	if (saving.value) return;
	saving.value = true;
	try {
		await floorStore.saveLayout({
			layout: { ...canvas.value },
			tables: draft.value.map((entry) => ({
				table_uid: entry.table_uid,
				table_label: entry.table_label,
				seats: entry.seats,
				is_active: entry.is_active,
				layout: entry.layout,
			})),
		});
		dirty.value = false;
		emit("done");
	} catch (error: any) {
		if (isTimestampMismatch(error)) {
			conflictOpen.value = true;
		} else {
			floorStore.error = error?.message || String(error);
		}
	} finally {
		saving.value = false;
	}
}

/**
 * Pull the winner's version and rebase on it. The operator's in-flight edits
 * stay on screen — discarding them is the same data loss the token exists to
 * prevent — so only the saved rows they never touched come back.
 */
async function reloadAndRetry() {
	conflictOpen.value = false;
	await floorStore.refresh({ silent: true });
	const known = new Set(draft.value.map((entry) => entry.table_uid));
	floorStore.activeFloorTables.forEach((table, index) => {
		const uid = table.table_uid || table.name;
		if (known.has(uid)) return;
		draft.value.push(draftFromTable(table, index, canvas.value));
	});
	dirty.value = true;
}
</script>

<style scoped src="./floor-editor.css"></style>
