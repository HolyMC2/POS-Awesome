<template>
	<div class="floor-editor" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
		<div class="floor-editor__toolbar">
			<v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addTable">
				{{ addLabel }}
			</v-btn>
			<v-spacer />
			<v-btn size="small" variant="text" @click="emit('done')">{{ __("Close") }}</v-btn>
			<v-btn
				size="small"
				color="primary"
				variant="flat"
				:loading="saving"
				:disabled="!dirty || saving"
				@click="save"
			>
				{{ __("Save") }}
			</v-btn>
		</div>

		<div class="floor-editor__body">
			<div class="floor-editor__scroller">
				<div class="floor-editor__canvas" :style="canvasStyleValue" @pointerdown.self="selectedUid = null">
					<div
						v-for="entry in placed"
						:key="entry.table_uid"
						class="floor-editor__tile"
						:class="{ 'floor-editor__tile--selected': entry.table_uid === selectedUid }"
						:style="[tileStyleFor(entry.layout), { '--floor-tile-color': colorHex(entry.layout.color) }]"
						@pointerdown="onDown($event, entry)"
					>
						<span class="floor-editor__tile-label">{{ entry.table_label }}</span>
					</div>
					<p v-if="!placed.length" class="floor-editor__empty">{{ emptyLabel }}</p>
				</div>
			</div>

			<aside class="floor-editor__rail">
				<p v-if="!selected" class="floor-editor__hint">{{ hintLabel }}</p>
				<template v-else>
					<v-text-field
						v-model="selected.table_label"
						:label="labelFieldLabel"
						variant="solo"
						density="compact"
						hide-details
						maxlength="40"
						class="mb-2"
						@update:model-value="dirty = true"
					/>
					<v-text-field
						:model-value="selected.seats"
						:label="seatsFieldLabel"
						type="number"
						min="0"
						variant="solo"
						density="compact"
						hide-details
						class="mb-2"
						@update:model-value="setSeats"
					/>
					<div class="floor-editor__swatches">
						<button
							v-for="swatch in TABLE_COLORS"
							:key="swatch.value || 'default'"
							type="button"
							class="floor-editor__swatch"
							:class="{ 'floor-editor__swatch--on': (selected.layout.color || undefined) === swatch.value }"
							:style="{ background: swatch.hex }"
							:aria-label="swatch.value || __('Default')"
							@click="setColor(swatch.value)"
						/>
					</div>
					<div class="floor-editor__steppers">
						<span>{{ sizeLabel }}</span>
						<span class="floor-editor__stepper">
							<v-btn size="x-small" variant="tonal" @click="resize(-1, 0)">−</v-btn>
							<span class="floor-editor__size">{{ selected.layout.w }}×{{ selected.layout.h }}</span>
							<v-btn size="x-small" variant="tonal" @click="resize(1, 0)">+</v-btn>
						</span>
					</div>
					<v-btn
						size="small"
						variant="text"
						color="error"
						class="mt-2"
						prepend-icon="mdi-eye-off-outline"
						@click="deactivate"
					>
						{{ deactivateLabel }}
					</v-btn>
				</template>
			</aside>
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
 * Floor editor — v1 scope is add / rename / deactivate plus drag-to-move on the
 * grid (spec §4 skip-list: no rotate/decor/undo). Geometry snaps to the floor's
 * own `{cols, rows, cell}` frame, following taller's BinsConstructor.
 *
 * Saves carry the floor's `modified` token (§6.3): a whole-floor write that
 * deactivates everything missing from the payload is exactly the shape where
 * the second manager silently wipes the first's additions. A drifted token
 * comes back as TimestampMismatch and the operator is asked, not overwritten.
 */
import { computed, ref, watch } from "vue";
import { useFloorStore } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);
import {
	TABLE_COLORS,
	canvasStyle,
	clampToCanvas,
	colorHex,
	resolveCanvas,
	resolveTableLayout,
	tileStyle,
	type PlacedLayout,
} from "./floorGeometry";

const emit = defineEmits<{ (event: "done"): void }>();

const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

interface DraftTable {
	name?: string;
	table_uid: string;
	table_label: string;
	seats: number;
	is_active: number;
	layout: PlacedLayout;
}

const draft = ref<DraftTable[]>([]);
const selectedUid = ref<string | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflictOpen = ref(false);

const canvas = computed(() => resolveCanvas(floorStore.activeFloorRow));
const canvasStyleValue = computed(() => canvasStyle(canvas.value));
const placed = computed(() => draft.value.filter((entry) => entry.is_active !== 0));
const selected = computed(() => draft.value.find((entry) => entry.table_uid === selectedUid.value) || null);

const addLabel = computed(() => `${verticalStore.t("Add")} ${verticalStore.t("Table")}`);
const emptyLabel = computed(() => verticalStore.t("No tables yet — add one to start"));
const hintLabel = computed(() => verticalStore.t("Tap a table to rename or recolour it. Drag to move."));
const labelFieldLabel = computed(() => verticalStore.t("Label"));
const seatsFieldLabel = computed(() => verticalStore.t("Seats"));
const sizeLabel = computed(() => verticalStore.t("Size"));
const deactivateLabel = computed(() => verticalStore.t("Hide from floor"));
const conflictTitle = computed(() => verticalStore.t("Floor changed elsewhere"));
const conflictBody = computed(() =>
	verticalStore.t(
		"Someone else saved this floor while you were editing. Reload their version, then save your changes again.",
	),
);

const loadDraft = () => {
	draft.value = floorStore.activeFloorTables.map((table, index) => ({
		name: table.name,
		table_uid: table.table_uid || table.name,
		table_label: table.table_label,
		seats: Number(table.seats) || 0,
		is_active: table.is_active === 0 ? 0 : 1,
		layout: resolveTableLayout(table, index, canvas.value),
	}));
	dirty.value = false;
	selectedUid.value = null;
};

watch(() => floorStore.activeFloor, loadDraft, { immediate: true });

function newUid(): string {
	return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function addTable() {
	const index = draft.value.length;
	const layout = clampToCanvas(
		{ x: (index % 6) * 3, y: Math.floor(index / 6) * 3, w: 2, h: 2, rotation: 0, shape: "rect" },
		canvas.value,
	);
	const entry: DraftTable = {
		table_uid: newUid(),
		table_label: String(index + 1),
		seats: 2,
		is_active: 1,
		layout,
	};
	draft.value.push(entry);
	selectedUid.value = entry.table_uid;
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

function resize(deltaW: number, deltaH: number) {
	if (!selected.value) return;
	const next = {
		...selected.value.layout,
		w: Math.max(1, selected.value.layout.w + deltaW),
		h: Math.max(1, selected.value.layout.h + (deltaH || deltaW)),
	};
	selected.value.layout = clampToCanvas(next, canvas.value);
	dirty.value = true;
}

function deactivate() {
	if (!selected.value) return;
	selected.value.is_active = 0;
	selectedUid.value = null;
	dirty.value = true;
}

// ---- drag (snap to grid, taller BinsConstructor pattern) -------------------

let drag: { uid: string; sx: number; sy: number; ox: number; oy: number } | null = null;

function onDown(event: PointerEvent, entry: DraftTable) {
	selectedUid.value = entry.table_uid;
	if (event.pointerType === "mouse" && event.button !== 0) return;
	drag = { uid: entry.table_uid, sx: event.clientX, sy: event.clientY, ox: entry.layout.x, oy: entry.layout.y };
	(event.target as HTMLElement).setPointerCapture?.(event.pointerId);
	event.preventDefault();
	event.stopPropagation();
}

function onMove(event: PointerEvent) {
	if (!drag) return;
	const entry = draft.value.find((row) => row.table_uid === drag?.uid);
	if (!entry) return;
	const cell = canvas.value.cell;
	const dx = Math.round((event.clientX - drag.sx) / cell);
	const dy = Math.round((event.clientY - drag.sy) / cell);
	entry.layout = clampToCanvas({ ...entry.layout, x: drag.ox + dx, y: drag.oy + dy }, canvas.value);
}

function onUp() {
	if (!drag) return;
	drag = null;
	dirty.value = true;
}

function tileStyleFor(layout: PlacedLayout) {
	return tileStyle(layout, canvas.value);
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
		draft.value.push({
			name: table.name,
			table_uid: uid,
			table_label: table.table_label,
			seats: Number(table.seats) || 0,
			is_active: table.is_active === 0 ? 0 : 1,
			layout: resolveTableLayout(table, index, canvas.value),
		});
	});
	dirty.value = true;
}
</script>

<style scoped>
.floor-editor {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	background: var(--pos-surface);
}

.floor-editor__toolbar {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	padding: 6px 8px;
	border-bottom: 1px solid var(--pos-border);
	background: var(--pos-surface);
}

/* Stacked below the rail's breakpoint; the plan owns the scroll either way. */
.floor-editor__body {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

.floor-editor__scroller {
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
	padding: 8px;
	background: var(--pos-bg-secondary);
	touch-action: none;
}

.floor-editor__canvas {
	position: relative;
	background-color: var(--pos-surface);
	background-image:
		linear-gradient(to right, var(--pos-border-light) 1px, transparent 1px),
		linear-gradient(to bottom, var(--pos-border-light) 1px, transparent 1px);
	border: 1px solid var(--pos-border);
	border-radius: 8px;
}

.floor-editor__tile {
	position: absolute;
	top: 0;
	left: 0;
	transform-origin: top left;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 2px solid var(--floor-tile-color, #94a3b8);
	border-radius: 10px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	cursor: grab;
}

.floor-editor__tile--selected {
	outline: 2px solid var(--pos-primary);
	outline-offset: -1px;
}

.floor-editor__tile-label {
	font-size: 13px;
	font-weight: 700;
	color: var(--pos-text-primary);
	pointer-events: none;
}

.floor-editor__empty {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	margin: 0;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 14px;
}

.floor-editor__rail {
	flex: 0 0 auto;
	max-height: 45%;
	overflow-y: auto;
	padding: 8px;
	border-top: 1px solid var(--pos-border);
	background: var(--pos-surface);
	color: var(--pos-text-primary);
}

.floor-editor__hint {
	margin: 0;
	color: var(--pos-text-secondary);
	font-size: 12px;
	background: transparent;
}

.floor-editor__swatches {
	display: flex;
	gap: 6px;
	margin-bottom: 8px;
}

.floor-editor__swatch {
	width: 26px;
	height: 26px;
	border: 2px solid transparent;
	border-radius: 50%;
}

.floor-editor__swatch--on {
	border-color: var(--pos-text-primary);
}

.floor-editor__steppers {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	color: var(--pos-text-secondary);
	font-size: 12px;
}

.floor-editor__stepper {
	display: flex;
	align-items: center;
	gap: 6px;
}

.floor-editor__size {
	min-width: 40px;
	text-align: center;
	color: var(--pos-text-primary);
	font-variant-numeric: tabular-nums;
}

.floor-editor__conflict-title {
	font-size: 16px;
	font-weight: 700;
	color: var(--pos-text-primary);
	background: var(--pos-surface);
}

.floor-editor__conflict-body {
	color: var(--pos-text-secondary);
	background: var(--pos-surface);
}
</style>
