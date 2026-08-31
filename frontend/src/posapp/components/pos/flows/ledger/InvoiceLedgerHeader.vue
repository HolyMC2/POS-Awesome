<template>
	<div class="ledger-head">
		<!-- The segment replaces the four tabs. Counts are the LOADED collection
		     sizes, and a collection that has not loaded renders no number at
		     all — the corte header's rule: `null` is not `0`. -->
		<div class="ledger-seg" role="tablist" :aria-label="__('Invoice segments')" data-testid="ledger-segment">
			<button
				v-for="segment in segments"
				:key="segment.id"
				type="button"
				role="tab"
				class="ledger-seg__item"
				:class="{ 'ledger-seg__item--on': segment.id === activeSegment }"
				:aria-selected="segment.id === activeSegment"
				:data-testid="`ledger-segment-${segment.id}`"
				@click="$emit('segment', segment.id)"
			>
				{{ __(segment.label) }}
				<span v-if="counts[segment.id] !== null" class="ledger-seg__count reg-mono">{{
					counts[segment.id]
				}}</span>
			</button>
		</div>

		<!-- WHICH document family Borradores is listing. Absent unless the
		     segment is showing and the register offers more than one source —
		     a register with sales orders switched off has a single kind of
		     draft and a one-button switch is a button that answers nothing. -->
		<div
			v-if="showSourceSwitch"
			class="ledger-source"
			role="group"
			:aria-label="__('Draft source')"
			data-testid="ledger-source"
		>
			<button
				v-for="source in sources"
				:key="source.key"
				type="button"
				class="ledger-source__item"
				:class="{ 'ledger-source__item--on': source.key === activeSource }"
				:aria-pressed="source.key === activeSource"
				:data-testid="`ledger-source-${source.key}`"
				@click="$emit('source', source.key)"
			>
				{{ __(source.label) }}
			</button>
		</div>

		<div class="ledger-head__spacer" />

		<!-- One search box, four modes (artboard `Buscador.dc.html`). The chips
		     carry NO chord: R8 says a chip renders the bound chord or nothing,
		     and `MUELLE_DEFAULT` binds none of these — the artboard's F1–F4 are
		     the browser's and F4 has been `employee.switch` for years. The
		     moment the lead binds them `describeFindModes` fills `chords` in
		     and the chip appears with no edit here. -->
		<div class="ledger-finder" data-testid="ledger-finder">
			<div class="ledger-finder__modes" role="group" :aria-label="__('Find the sale')">
				<button
					v-for="mode in modes"
					:key="mode.id"
					type="button"
					class="ledger-finder__mode"
					:class="{ 'ledger-finder__mode--on': mode.id === activeMode }"
					:aria-pressed="mode.id === activeMode"
					:data-testid="`ledger-finder-${mode.id}`"
					@click="$emit('mode', mode.id)"
				>
					{{ __(mode.label) }}
					<span v-for="chord in mode.chords" :key="chord" class="ledger-chord reg-mono">{{
						chord
					}}</span>
				</button>
			</div>

			<div v-if="activeMode === 'date'" class="ledger-finder__range">
				<label class="ledger-finder__range-label">
					<span class="ledger-finder__range-text">{{ __("From") }}</span>
					<input
						class="ledger-finder__date reg-mono"
						type="date"
						:value="dateFrom"
						data-testid="ledger-finder-date-from"
						@input="$emit('update:dateFrom', ($event.target as HTMLInputElement).value)"
					/>
				</label>
				<label class="ledger-finder__range-label">
					<span class="ledger-finder__range-text">{{ __("To") }}</span>
					<input
						class="ledger-finder__date reg-mono"
						type="date"
						:value="dateTo"
						data-testid="ledger-finder-date-to"
						@input="$emit('update:dateTo', ($event.target as HTMLInputElement).value)"
					/>
				</label>
			</div>

			<div v-else class="ledger-finder__box">
				<svg
					class="ledger-finder__glyph"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.9"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="7" />
					<path d="m20 20-3.5-3.5" />
				</svg>
				<input
					ref="queryInput"
					class="ledger-finder__input"
					type="search"
					:value="query"
					:placeholder="__(placeholder)"
					:aria-label="__(placeholder)"
					data-testid="ledger-finder-input"
					@input="$emit('update:query', ($event.target as HTMLInputElement).value)"
				/>
			</div>
		</div>

		<!-- The date chip and the Fecha mode are one control, not two: pressing
		     the chip arms the mode that owns the range it is printing. -->
		<button
			type="button"
			class="ledger-daterange"
			:class="{ 'ledger-daterange--on': activeMode === 'date' }"
			data-testid="ledger-daterange"
			@click="$emit('mode', 'date')"
		>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.9"
				stroke-linecap="round"
				aria-hidden="true"
			>
				<rect x="3" y="5" width="18" height="16" rx="2" />
				<path d="M3 10h18M8 3v4M16 3v4" />
			</svg>
			{{ rangeLabel }}
		</button>
	</div>
</template>

<script setup lang="ts">
/**
 * The ledger's one row of chrome: segment, finder, date range (§15.3).
 *
 * It decides nothing. Which segments exist, which modes exist and what each
 * one is called are `ledgerModel.ts`'s answers; this file draws them and
 * emits the operator's choice back.
 */
import { computed, ref } from "vue";

import type {
	LedgerFindModeId,
	LedgerSegment,
	LedgerSegmentId,
	ResolvedLedgerFindMode,
} from "./ledgerModel";
import { getFindMode } from "./ledgerModel";
import { translate as __ } from "./ledgerText";

const props = withDefaults(
	defineProps<{
		segments: readonly LedgerSegment[];
		activeSegment: LedgerSegmentId;
		/** Loaded collection size per segment; `null` until it has loaded. */
		counts: Readonly<Record<string, number | null>>;
		modes: readonly ResolvedLedgerFindMode[];
		activeMode: LedgerFindModeId;
		query: string;
		dateFrom: string;
		dateTo: string;
		/** `getAvailableCommercialDocumentSources(posProfile)`, English labels. */
		sources?: ReadonlyArray<{ key: string; label: string }>;
		activeSource?: string;
	}>(),
	{ sources: () => [], activeSource: "invoice" },
);

defineEmits<{
	segment: [LedgerSegmentId];
	mode: [LedgerFindModeId];
	source: [string];
	"update:query": [string];
	"update:dateFrom": [string];
	"update:dateTo": [string];
}>();

const showSourceSwitch = computed(
	() => props.activeSegment === "drafts" && props.sources.length > 1,
);

const queryInput = ref<HTMLInputElement | null>(null);

const placeholder = computed(() => getFindMode(props.activeMode).placeholder || "Ticket number");

/**
 * `hoy` rather than a repeated date when both ends are today — the artboard's
 * `vie 22 ago · hoy`, minus the day name we have no formatter for here.
 */
const rangeLabel = computed(() => {
	if (!props.dateFrom && !props.dateTo) return __("Every date");
	if (props.dateFrom && props.dateFrom === props.dateTo) return props.dateFrom;
	return `${props.dateFrom || "…"} → ${props.dateTo || "…"}`;
});

/** The parent focuses the box when it swaps modes; nothing else calls this. */
defineExpose({ focusQuery: () => queryInput.value?.focus() });
</script>

<style scoped>
.ledger-head {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	flex: none;
	flex-wrap: wrap;
}

.ledger-head__spacer {
	flex: 1;
}

/* ---- segment ---------------------------------------------------------- */

.ledger-seg {
	display: flex;
	gap: 2px;
	padding: 3px;
	background: var(--reg-surface-muted, #f2f4f7);
	border-radius: 11px;
}

.ledger-seg__item {
	display: inline-flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	height: 34px;
	padding: 0 14px;
	border: 0;
	border-radius: 9px;
	cursor: pointer;
	font: inherit;
	font-size: 13px;
	background: transparent;
	color: var(--reg-text-secondary, #56606e);
}

.ledger-seg__item:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

/* The chosen segment is a RAISED surface with accent TEXT, never an accent
   fill: the surface's one saturated colour is spent on the panel's action. */
.ledger-seg__item--on {
	background: var(--reg-surface, #fff);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
	box-shadow: 0 1px 3px rgba(16, 20, 30, 0.09);
}

.ledger-seg__count {
	font-weight: 600;
	opacity: 0.75;
}

/* ---- source switch ---------------------------------------------------- */

/* Deliberately the finder's chip treatment rather than the segment's raised
   pill: the segment picks WHAT LIST, this picks what the list is OF, and two
   controls with the same shape sitting side by side would read as one row of
   eight tabs. */
.ledger-source {
	display: flex;
	gap: 2px;
}

.ledger-source__item {
	display: inline-flex;
	align-items: center;
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
	white-space: nowrap;
}

.ledger-source__item:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

.ledger-source__item--on {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

/* ---- finder ----------------------------------------------------------- */

.ledger-finder {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
}

.ledger-finder__modes {
	display: flex;
	gap: 2px;
}

.ledger-finder__mode {
	display: inline-flex;
	align-items: center;
	gap: var(--reg-space-xs, 5px);
	height: 32px;
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
	white-space: nowrap;
}

.ledger-finder__mode:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

.ledger-finder__mode--on {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent-soft, #00646f);
	font-weight: 700;
}

.ledger-chord {
	padding: 1px 5px;
	border-radius: 999px;
	background: var(--reg-surface-muted, #f2f4f7);
	color: var(--reg-text-muted, #667085);
	font-size: 10.5px;
}

.ledger-finder__box {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	width: 320px;
	max-width: 100%;
	height: 40px;
	padding: 0 12px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
}

.ledger-finder__glyph {
	color: var(--reg-text-muted, #667085);
	flex: none;
}

.ledger-finder__input {
	flex: 1;
	min-width: 0;
	border: 0;
	outline: none;
	background: transparent;
	font: inherit;
	font-size: 13.5px;
	color: var(--reg-text-primary, #212121);
}

.ledger-finder__range {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
}

.ledger-finder__range-label {
	display: inline-flex;
	align-items: center;
	gap: var(--reg-space-xs, 5px);
}

.ledger-finder__range-text {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.ledger-finder__date {
	height: 40px;
	padding: 0 10px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13px;
}

/* ---- date chip -------------------------------------------------------- */

.ledger-daterange {
	display: inline-flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
	height: 40px;
	padding: 0 12px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
	white-space: nowrap;
}

.ledger-daterange:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

.ledger-daterange--on {
	border-color: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent-soft, #00646f);
}

/* ---- phones ----------------------------------------------------------- */

/* Below the register's phone boundary (`useResponsive().isPhone`, 768) the
   one-row chrome measures ~650px in the finder alone, so it becomes three
   rows, none wider than the surface:

     [ segment pills — one line, swipes sideways                 ]
     [ search box  |  Desde [date]  A [date]  — the full width   ]
     [ mode chips — swipe … ] [ range chip ]

   `.ledger-finder` turns into `display: contents` so its modes and its
   box/range can be ordered among the head's own children. The segment, the
   modes and the source switch become one-line scrollers: an intended scroller
   can be swiped back, an overflow the card clips cannot. The range chip hides
   while Fecha is armed, because the two date fields print the same range. */
@media (max-width: 767.98px) {
	.ledger-head {
		gap: 8px;
	}

	.ledger-head__spacer {
		display: none;
	}

	.ledger-seg,
	.ledger-source,
	.ledger-finder__modes {
		max-width: 100%;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.ledger-seg::-webkit-scrollbar,
	.ledger-source::-webkit-scrollbar,
	.ledger-finder__modes::-webkit-scrollbar {
		display: none;
	}

	.ledger-seg__item,
	.ledger-source__item,
	.ledger-finder__mode {
		flex: none;
		white-space: nowrap;
	}

	.ledger-seg {
		order: 1;
		flex: 1 1 100%;
	}

	.ledger-finder {
		display: contents;
	}

	.ledger-finder__box,
	.ledger-finder__range {
		order: 2;
		flex: 1 1 100%;
		width: auto;
	}

	/* A date input keeps an intrinsic floor (~120px in Chromium) that
	   `min-width: 0` does not remove, so the pair shares the row only while
	   each half can be 150px, and wraps to two rows on anything narrower. */
	.ledger-finder__range {
		flex-wrap: wrap;
	}

	.ledger-finder__range-label {
		flex: 1 1 150px;
		min-width: 0;
	}

	.ledger-finder__date {
		flex: 1 1 0;
		min-width: 0;
		width: 100%;
		padding: 0 8px;
	}

	.ledger-finder__modes {
		order: 3;
		flex: 1 1 0;
	}

	.ledger-daterange {
		order: 4;
		flex: none;
		height: 32px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ledger-daterange--on {
		display: none;
	}

	.ledger-source {
		order: 5;
		flex: 1 1 100%;
	}
}
</style>
