<template>
	<aside class="editor-rail" :class="`editor-rail--${variant}`">
		<p v-if="!selected" class="editor-rail__hint">{{ hintLabel }}</p>
		<template v-else>
			<div class="editor-rail__identity">
				<v-text-field
					:model-value="selected.table_label"
					:label="labelFieldLabel"
					variant="solo"
					density="compact"
					hide-details
					maxlength="40"
					data-test="editor-label"
					@update:model-value="emit('label', $event)"
				/>
				<v-text-field
					:model-value="selected.seats"
					:label="seatsFieldLabel"
					type="number"
					min="0"
					variant="solo"
					density="compact"
					hide-details
					class="editor-rail__seats"
					data-test="editor-seats"
					@update:model-value="emit('seats', $event)"
				/>
			</div>

			<div class="editor-rail__group">
				<span class="editor-rail__group-title">{{ colorLabel }}</span>
				<div class="editor-rail__swatches">
					<button
						v-for="swatch in TABLE_COLORS"
						:key="swatch.value || 'default'"
						type="button"
						class="editor-rail__swatch"
						:class="{ 'editor-rail__swatch--on': (selected.layout.color || undefined) === swatch.value }"
						:style="{ background: swatch.hex }"
						:aria-pressed="(selected.layout.color || undefined) === swatch.value"
						:aria-label="swatch.value || __('Default')"
						:title="swatch.value || __('Default')"
						@click="emit('color', swatch.value)"
					>
						<v-icon
							v-if="(selected.layout.color || undefined) === swatch.value"
							icon="mdi-check"
							size="14"
						/>
					</button>
				</div>
			</div>

			<div class="editor-rail__group">
				<span class="editor-rail__group-title">{{ sizeLabel }}</span>
				<!-- Two axes, separately. The v1 stepper moved width and height
				     together, so a bar counter or a banquet run could not be drawn
				     at all. -->
				<div class="editor-rail__axis">
					<v-icon icon="mdi-arrow-expand-horizontal" size="16" />
					<button type="button" class="editor-rail__step" :aria-label="narrowerLabel" @click="emit('resize', -1, 0)">−</button>
					<span class="editor-rail__reading">{{ selected.layout.w }}</span>
					<button type="button" class="editor-rail__step" :aria-label="widerLabel" @click="emit('resize', 1, 0)">+</button>
				</div>
				<div class="editor-rail__axis">
					<v-icon icon="mdi-arrow-expand-vertical" size="16" />
					<button type="button" class="editor-rail__step" :aria-label="shorterLabel" @click="emit('resize', 0, -1)">−</button>
					<span class="editor-rail__reading">{{ selected.layout.h }}</span>
					<button type="button" class="editor-rail__step" :aria-label="tallerLabel" @click="emit('resize', 0, 1)">+</button>
				</div>
			</div>

			<div class="editor-rail__group">
				<span class="editor-rail__group-title">{{ positionLabel }}</span>
				<!-- Tap-to-select then nudge. On a phone a drag that has to land on
				     the right cell is a coin flip; the pad is the honest way to place
				     a table with a thumb. -->
				<div class="editor-rail__pad">
					<button type="button" class="editor-rail__nudge editor-rail__nudge--up" :aria-label="upLabel" @click="emit('nudge', 0, -1)">
						<v-icon icon="mdi-arrow-up" size="18" />
					</button>
					<button type="button" class="editor-rail__nudge editor-rail__nudge--left" :aria-label="leftLabel" @click="emit('nudge', -1, 0)">
						<v-icon icon="mdi-arrow-left" size="18" />
					</button>
					<span class="editor-rail__coords">{{ selected.layout.x }},{{ selected.layout.y }}</span>
					<button type="button" class="editor-rail__nudge editor-rail__nudge--right" :aria-label="rightLabel" @click="emit('nudge', 1, 0)">
						<v-icon icon="mdi-arrow-right" size="18" />
					</button>
					<button type="button" class="editor-rail__nudge editor-rail__nudge--down" :aria-label="downLabel" @click="emit('nudge', 0, 1)">
						<v-icon icon="mdi-arrow-down" size="18" />
					</button>
				</div>
			</div>

			<div class="editor-rail__tools">
				<button type="button" class="editor-rail__tool" :title="rotateLabel" :aria-label="rotateLabel" @click="emit('rotate')">
					<v-icon icon="mdi-rotate-right" size="18" />
					<span class="editor-rail__tool-text">{{ selected.layout.rotation || 0 }}°</span>
				</button>
				<button type="button" class="editor-rail__tool" :title="shapeLabel" :aria-label="shapeLabel" @click="emit('shape')">
					<v-icon :icon="isRound ? 'mdi-circle-outline' : 'mdi-square-outline'" size="18" />
					<span class="editor-rail__tool-text">{{ isRound ? roundLabel : rectLabel }}</span>
				</button>
				<button type="button" class="editor-rail__tool" :title="duplicateLabel" :aria-label="duplicateLabel" data-test="editor-duplicate" @click="emit('duplicate')">
					<v-icon icon="mdi-content-duplicate" size="18" />
					<span class="editor-rail__tool-text">{{ duplicateLabel }}</span>
				</button>
				<button type="button" class="editor-rail__tool editor-rail__tool--danger" :title="deactivateLabel" :aria-label="deactivateLabel" @click="emit('deactivate')">
					<v-icon icon="mdi-eye-off-outline" size="18" />
					<span class="editor-rail__tool-text">{{ deactivateLabel }}</span>
				</button>
			</div>
		</template>
	</aside>
</template>

<script setup lang="ts">
/**
 * The editor's inspector for one table. Split out of `FloorEditor.vue` when
 * that file reached its size ceiling; the editor keeps the draft and the
 * canvas, this keeps the controls.
 *
 * It emits intent and never mutates — one owner for the draft is what keeps
 * the dirty flag and the concurrency token honest.
 */
import { computed } from "vue";
import { TABLE_COLORS } from "./floorGeometry";
import type { DraftTable } from "./floorEditorDraft";
import { useVerticalStore } from "../../stores/verticalStore";

// `__` is a global provided by the Frappe boot; `<script setup>` templates
// cannot see app.config.globalProperties, so bind it locally.
const __ = window.__ || ((value: string) => value);

const props = defineProps<{
	selected: DraftTable | null;
	/** `rail` sits beside the canvas, `sheet` sits under it on a phone. */
	variant: "rail" | "sheet";
}>();

const emit = defineEmits<{
	(event: "label", value: string): void;
	(event: "seats", value: string): void;
	(event: "color", value: string | undefined): void;
	(event: "resize", deltaW: number, deltaH: number): void;
	(event: "nudge", deltaX: number, deltaY: number): void;
	(event: "rotate"): void;
	(event: "shape"): void;
	(event: "duplicate"): void;
	(event: "deactivate"): void;
}>();

const verticalStore = useVerticalStore();

const isRound = computed(() => props.selected?.layout.shape === "round");

const hintLabel = computed(() =>
	verticalStore.t("Tap a table to rename, resize or move it. Drag to place it."),
);
const labelFieldLabel = computed(() => verticalStore.t("Label"));
const seatsFieldLabel = computed(() => verticalStore.t("Seats"));
const colorLabel = computed(() => verticalStore.t("Section"));
const sizeLabel = computed(() => verticalStore.t("Size"));
const positionLabel = computed(() => verticalStore.t("Position"));
const rotateLabel = computed(() => verticalStore.t("Rotate"));
const shapeLabel = computed(() => verticalStore.t("Shape"));
const roundLabel = computed(() => verticalStore.t("Round"));
const rectLabel = computed(() => verticalStore.t("Square"));
const duplicateLabel = computed(() => verticalStore.t("Duplicate"));
const deactivateLabel = computed(() => verticalStore.t("Hide from floor"));
const widerLabel = computed(() => verticalStore.t("Wider"));
const narrowerLabel = computed(() => verticalStore.t("Narrower"));
const tallerLabel = computed(() => verticalStore.t("Taller"));
const shorterLabel = computed(() => verticalStore.t("Shorter"));
const upLabel = computed(() => verticalStore.t("Move up"));
const downLabel = computed(() => verticalStore.t("Move down"));
const leftLabel = computed(() => verticalStore.t("Move left"));
const rightLabel = computed(() => verticalStore.t("Move right"));
</script>

<style scoped>
.editor-rail {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 10px;
	background: var(--pos-surface);
	color: var(--pos-text-primary);
}

.editor-rail--rail {
	flex: 0 0 264px;
	min-height: 0;
	overflow-y: auto;
	border-inline-start: 1px solid var(--pos-border);
}

.editor-rail--sheet {
	flex: 0 0 auto;
	max-height: 46%;
	overflow-y: auto;
	border-top: 1px solid var(--pos-border);
}

.editor-rail__hint {
	margin: 0;
	background: transparent;
	color: var(--pos-text-secondary);
	font-size: 12px;
	line-height: 1.4;
}

.editor-rail__identity {
	display: flex;
	gap: 8px;
}

.editor-rail__seats {
	max-width: 92px;
}

.editor-rail__group {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.editor-rail__group-title {
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--pos-text-secondary);
}

.editor-rail__swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.editor-rail__swatch {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border: 2px solid transparent;
	border-radius: 50%;
	color: #ffffff;
	cursor: pointer;
}

.editor-rail__swatch--on {
	border-color: var(--pos-text-primary);
}

.editor-rail__axis {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--pos-text-secondary);
}

.editor-rail__step {
	width: 40px;
	height: 40px;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	font-size: 18px;
	font-weight: 700;
	line-height: 1;
	cursor: pointer;
}

.editor-rail__step:hover {
	background: var(--pos-hover-bg);
	border-color: var(--pos-primary);
}

.editor-rail__reading {
	min-width: 24px;
	text-align: center;
	font-size: 14px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary);
}

/* A three-by-three pad with the reading in the middle: the arrows sit where
   the hand expects them, and the coordinates confirm the move landed. */
.editor-rail__pad {
	display: grid;
	grid-template-columns: repeat(3, 40px);
	grid-template-rows: repeat(3, 40px);
	gap: 4px;
	justify-content: start;
}

.editor-rail__nudge {
	display: flex;
	align-items: center;
	justify-content: center;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	cursor: pointer;
}

.editor-rail__nudge:hover {
	background: var(--pos-hover-bg);
	border-color: var(--pos-primary);
}

.editor-rail__nudge--up {
	grid-area: 1 / 2;
}
.editor-rail__nudge--left {
	grid-area: 2 / 1;
}
.editor-rail__nudge--right {
	grid-area: 2 / 3;
}
.editor-rail__nudge--down {
	grid-area: 3 / 2;
}

.editor-rail__coords {
	grid-area: 2 / 2;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	background: transparent;
	color: var(--pos-text-secondary);
}

.editor-rail__tools {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.editor-rail__tool {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 1 1 108px;
	min-height: 40px;
	padding: 0 10px;
	border: 1px solid var(--pos-border);
	border-radius: 10px;
	background: var(--pos-surface-container);
	color: var(--pos-text-primary);
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
}

.editor-rail__tool:hover {
	background: var(--pos-hover-bg);
	border-color: var(--pos-primary);
}

.editor-rail__tool--danger {
	color: var(--pos-error);
}

.editor-rail__tool-text {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}
</style>
