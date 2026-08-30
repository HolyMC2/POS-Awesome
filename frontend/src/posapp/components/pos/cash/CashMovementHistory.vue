<template>
	<v-card class="pos-themed-card cash-movement-history__card">
		<!-- E2: this card is the RECORD, and its name says whose: the shift's.
		     The old pair («Cash Movements» + a subtitle restating it) was the
		     surface's third restatement of its own name. -->
		<div class="cash-movement-history__head">
			<div>
				<div class="cash-movement-history__title">{{ __("Movements this shift") }}</div>
			</div>
			<div class="cash-movement-history__actions">
				<v-chip v-if="pendingOfflineCount > 0" color="warning" size="small" variant="tonal">
					{{ __("Offline Queue: {0}", [pendingOfflineCount]) }}
				</v-chip>
				<v-btn variant="outlined" size="small" @click="$emit('refresh')" :disabled="loading">
					{{ __("Refresh") }}
				</v-btn>
			</div>
		</div>

		<v-row dense class="mb-2">
			<v-col cols="12" md="4">
				<v-text-field
					:model-value="localSearchText"
					variant="outlined"
					density="compact"
					clearable
					hide-details
					prepend-inner-icon="mdi-magnify"
					:label="__('Search')"
					@update:model-value="onSearchInput"
				/>
			</v-col>
			<v-col cols="12" md="4">
				<v-select
					:model-value="selectedStatus"
					:items="statusFilters"
					variant="outlined"
					density="compact"
					:label="__('Status')"
					:disabled="loading"
					@update:model-value="emitFilterChange({ status: $event })"
				/>
			</v-col>
			<v-col cols="12" md="4">
				<v-select
					:model-value="selectedMovementType"
					:items="movementTypeFilters"
					variant="outlined"
					density="compact"
					:label="__('Movement Type')"
					:disabled="loading"
					@update:model-value="emitFilterChange({ movementType: $event })"
				/>
			</v-col>
		</v-row>

		<!-- The safety net, not the design. `visibleColumns` picks the tier that
		     fits, so on every desktop width this scroller has nothing to do:
		     the narrowest tier needs 491px and the two-column grid never gives
		     the card less than ~526px (at its 1100px boundary). What is left
		     for the scroller is a phone-width card and a row whose supplier or
		     account name is longer than any this was measured against.

		     It measures ITSELF, not the window, because the same window gives
		     this surface two different widths — 724px at 1440 as half of the
		     destination grid, 968px at 1024 once the grid collapses to one
		     column. A viewport media query would get one of those wrong. -->
		<div ref="scroller" class="cash-movement-history__scroller">
			<!-- E2: no pagination chrome. A shift's movements are ONE list —
			     «Items per page: 10 · 0-0 of 0» under an empty morning table
			     was footer furniture for a dataset that never earns it. The
			     card's own scroller is the design. -->
			<v-data-table
				:items="rows"
				:headers="visibleHeaders"
				v-model:expanded="expandedRows"
				item-value="name"
				:loading="loading"
				:items-per-page="-1"
				hide-default-footer
				density="compact"
				class="elevation-0"
			>
				<template #no-data>
					<div class="cash-movement-history__empty" data-testid="cash-history-empty">
						<v-icon icon="mdi-cash-register" size="26" />
						<div class="cash-movement-history__empty-title">
							{{ __("No movements this shift yet.") }}
						</div>
						<div class="cash-movement-history__empty-hint">
							{{ __("Expenses and deposits you submit will appear here.") }}
						</div>
					</div>
				</template>
				<template #item.posting_date="{ item }">
					{{ formatPostingDate(item.posting_date) }}
				</template>
				<template #item.docstatus="{ item }">
					<v-chip size="small" :color="statusColor(item.docstatus)">
						{{ statusLabel(item.docstatus) }}
					</v-chip>
				</template>
				<template #item.actions="{ item, internalItem, isExpanded, toggleExpand }">
					<!-- Three peer row actions used to carry three different tints —
					     info, amber, red — which is the rainbow reproduced at row
					     scale, once per movement in the list. Only the irreversible
					     one keeps a colour now; the other two are neutral. The status
					     chip above is untouched: it pairs `statusColor` with
					     `statusLabel` text, so it is state a colourblind operator can
					     still read, which is exactly what §17.7 permits.

					     The disclosure leads the stack because it is the harmless
					     one and the stack runs from safe to irreversible. It renders
					     only when this width actually sheds something, so at the
					     widest tier the rows keep their old height. -->
					<div class="cash-movement-history__row-actions">
						<v-btn
							v-if="hiddenColumns.length > 0"
							size="x-small"
							variant="text"
							@click="toggleExpand(internalItem)"
						>
							{{ isExpanded(internalItem) ? __("Hide") : __("Details") }}
						</v-btn>
						<v-btn
							size="x-small"
							variant="tonal"
							:disabled="![1, 2].includes(item.docstatus) || actionLoading"
							@click="$emit('duplicate', item)"
						>
							{{ __("Duplicate") }}
						</v-btn>
						<v-btn
							size="x-small"
							variant="tonal"
							:disabled="!allowCancel || item.docstatus !== 1 || actionLoading"
							@click="$emit('cancel', item)"
						>
							{{ __("Cancel") }}
						</v-btn>
						<v-btn
							size="x-small"
							color="error"
							variant="tonal"
							:disabled="!allowDelete || item.docstatus !== 2 || actionLoading"
							@click="$emit('delete', item)"
						>
							{{ __("Delete") }}
						</v-btn>
					</div>
				</template>
				<!-- Where the shed columns went. A narrow tier drops a column from
				     the row; it never drops the value. -->
				<template #expanded-row="{ columns, item }">
					<tr class="cash-movement-history__detail-row">
						<td :colspan="columns.length">
							<dl class="cash-movement-history__detail">
								<div
									v-for="key in hiddenColumns"
									:key="key"
									class="cash-movement-history__detail-pair"
								>
									<dt>{{ columnTitles[key] }}</dt>
									<dd>{{ detailValue(item, key) }}</dd>
								</div>
							</dl>
						</td>
					</tr>
				</template>
			</v-data-table>
		</div>
	</v-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
	hiddenCashHistoryColumns,
	visibleCashHistoryColumns,
	type CashHistoryColumnKey,
} from "./cashHistoryColumns";

const __ = window.__ || ((text: string, _args?: any[]) => text);

const props = defineProps<{
	rows: any[];
	loading: boolean;
	actionLoading: boolean;
	allowCancel: boolean;
	allowDelete: boolean;
	selectedStatus: string;
	selectedMovementType: string;
	selectedSearchText: string;
	pendingOfflineCount: number;
}>();

const emit = defineEmits<{
	(e: "refresh"): void;
	(e: "duplicate", row: any): void;
	(e: "cancel", row: any): void;
	(e: "delete", row: any): void;
	(e: "filter-change", payload: { status: string; movementType: string; searchText: string }): void;
}>();

const localSearchText = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;

watch(
	() => props.selectedSearchText,
	(value) => {
		localSearchText.value = value || "";
	},
	{ immediate: true },
);

function emitFilterChange(payload: Partial<{ status: string; movementType: string; searchText: string }>) {
	const nextStatus = payload.status ?? props.selectedStatus;
	const nextMovementType = payload.movementType ?? props.selectedMovementType;
	const nextSearchText = payload.searchText ?? localSearchText.value ?? "";
	emit("filter-change", {
		status: nextStatus,
		movementType: nextMovementType,
		searchText: nextSearchText,
	});
}

function onSearchInput(value: string | null) {
	localSearchText.value = value || "";
	if (searchTimer) {
		clearTimeout(searchTimer);
	}
	searchTimer = setTimeout(() => {
		emitFilterChange({ searchText: localSearchText.value });
	}, 350);
}

const statusFilters = [
	{ title: __("All"), value: "" },
	{ title: __("Submitted"), value: "submitted" },
	{ title: __("Cancelled"), value: "cancelled" },
	{ title: __("Draft"), value: "draft" },
];

const movementTypeFilters = [
	{ title: __("Expense"), value: "Expense" },
	{ title: __("Deposit"), value: "Deposit" },
	{ title: __("Cash In (Change Fund)"), value: "Cash In" },
	{ title: __("All"), value: "" },
];

/**
 * One label per column, so the header row and the detail panel of a shed
 * column read the same word. Every string here already existed in this file.
 */
const columnTitles: Record<CashHistoryColumnKey, string> = {
	posting_date: __("Date"),
	against_name: __("Against Name"),
	movement_type: __("Type"),
	amount: __("Amount"),
	source_account: __("Source"),
	target_account: __("Target"),
	remarks: __("Remarks"),
	journal_entry: __("Journal Entry"),
	docstatus: __("Status"),
	actions: __("Actions"),
};

const columnOptions: Partial<Record<CashHistoryColumnKey, Record<string, unknown>>> = {
	amount: { align: "end" },
	docstatus: { align: "center" },
	actions: { sortable: false, align: "end" },
};

/**
 * The card's own content width, not the viewport's. The history is one half of
 * a two-column grid above 1100px and the whole surface below it, so the same
 * window gives the table 724px in one layout and ~968px in the other; a
 * viewport media query would get both wrong. Same pattern (and same
 * `typeof` guard for environments without layout) as
 * `useItemsTableResponsive`.
 */
const scroller = ref<HTMLElement | null>(null);
const tableWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

function measure() {
	if (scroller.value) {
		tableWidth.value = scroller.value.getBoundingClientRect().width;
	}
}

onMounted(() => {
	measure();
	if (typeof ResizeObserver !== "undefined" && scroller.value) {
		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				tableWidth.value = entry.contentRect.width;
			}
		});
		resizeObserver.observe(scroller.value);
	}
});

onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	resizeObserver = null;
});

const visibleColumns = computed(() => visibleCashHistoryColumns(tableWidth.value));
const hiddenColumns = computed(() => hiddenCashHistoryColumns(tableWidth.value));

const visibleHeaders = computed<any[]>(() =>
	visibleColumns.value.map((key) => ({
		title: columnTitles[key],
		key,
		...(columnOptions[key] || {}),
	})),
);

const expandedRows = ref<string[]>([]);

// A window widened past a threshold puts every shed value back in its own
// column. Leaving rows expanded there would leave an empty panel under them.
watch(hiddenColumns, (columns) => {
	if (columns.length === 0) {
		expandedRows.value = [];
	}
});

function detailValue(row: any, key: CashHistoryColumnKey) {
	if (key === "posting_date") return formatPostingDate(row?.posting_date);
	if (key === "docstatus") return statusLabel(row?.docstatus);
	const value = row?.[key];
	return value === null || value === undefined || value === "" ? "—" : String(value);
}

function statusLabel(docstatus: number) {
	if (docstatus === 1) return __("Submitted");
	if (docstatus === 2) return __("Cancelled");
	return __("Draft");
}

function statusColor(docstatus: number) {
	if (docstatus === 1) return "success";
	if (docstatus === 2) return "warning";
	return "grey";
}

function formatPostingDate(value: string) {
	const dateText = String(value || "").trim();
	if (!dateText) return "";
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
	if (match) {
		const year = match[1] || "";
		const month = match[2] || "";
		const day = match[3] || "";
		return `${day}-${month}-${year}`;
	}

	const parsed = new Date(dateText);
	if (Number.isNaN(parsed.getTime())) return dateText;
	const dd = String(parsed.getDate()).padStart(2, "0");
	const mm = String(parsed.getMonth() + 1).padStart(2, "0");
	const yyyy = String(parsed.getFullYear());
	return `${dd}-${mm}-${yyyy}`;
}
</script>

<style scoped>
/* Real CSS for the card's chrome, for the reason `CashMovementView.vue`'s
 * template note records: the `pa-4` / `d-flex` / `text-h6` utilities this card
 * used are not in the web route's stylesheet, so it rendered with no padding
 * and a body-sized heading. */
.cash-movement-history__card {
	padding: 16px;
	/* The history is the half of the destination that earns the leftover
	 * height, so the card fills its column and the table grows into it rather
	 * than leaving the bottom of the surface empty. */
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.cash-movement-history__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 12px;
}

.cash-movement-history__title {
	font-size: 1.125rem;
	font-weight: 600;
	line-height: 1.4;
}

.cash-movement-history__empty {
	display: grid;
	justify-items: center;
	gap: 4px;
	padding: 28px 16px;
	color: rgb(var(--v-theme-on-surface));
	opacity: 0.65;
	text-align: center;
}

.cash-movement-history__empty-title {
	font-weight: 600;
	font-size: 0.9375rem;
}

.cash-movement-history__empty-hint {
	font-size: 0.8125rem;
}

.cash-movement-history__row-actions {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
}

.cash-movement-history__actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-shrink: 0;
}

/* The elastic child, and the ONE horizontal scrollport on this surface.
 *
 * `flex: 1 0 auto` rather than `1 1 auto; min-height: 0`, and the shrink half
 * is the load-bearing one. A box whose computed overflow is not `visible` has
 * an automatic minimum size of ZERO, so a shrinkable `overflow-x: auto` child
 * is a VERTICAL scrollport waiting for something to squeeze it — the nesting
 * commit 59c5fe1ad removed. Refusing to shrink keeps the vertical axis inert
 * while the table still grows into the card's leftover height.
 *
 * Measured under deliberate height pressure (a 300px grid row): with
 * `flex: 1 0 auto` the destination's `__body` stays the only vertical
 * scrollport; swapped to `flex: 1 1 auto; min-height: 0` this box starts
 * scrolling vertically at 719 > 196. The structure this replaced had the same
 * latent nesting one level down — Vuetify's own wrapper, squeezed, scrolled
 * at 890 > 199.
 *
 * `overscroll-behavior-x` stops a sideways trackpad flick inside the table
 * from chaining to the browser's back gesture — on a register that is a lost
 * ticket, not a lost scroll position. */
.cash-movement-history__scroller {
	flex: 1 0 auto;
	overflow-x: auto;
	overscroll-behavior-x: contain;
}

/* Exactly one horizontal scrollport, and it is this component's. Vuetify
 * ships `.v-table__wrapper { overflow: auto }` on BOTH axes; left in place it
 * clips first, so the box above would never engage — and it is shrinkable,
 * i.e. the second vertical scrollport the rule above exists to prevent. This
 * does not move the scrollbar (it sits at the foot of the table either way);
 * it makes the axis ours to reason about, and takes the shrinkable box out of
 * the height chain. */
.cash-movement-history__scroller :deep(.v-table__wrapper) {
	overflow: visible;
}

.cash-movement-history__scroller :deep(.v-data-table) {
	min-height: 0;
}

/* Narrow columns give their width to the values instead of to gutters — the
 * same trade `items-table-styles.css` makes with `--cell-padding-x`. Worth
 * 16px per column, which is what buys Source and Target a place at 1440. */
.cash-movement-history__scroller :deep(.v-table > .v-table__wrapper > table > thead > tr > th),
.cash-movement-history__scroller :deep(.v-table > .v-table__wrapper > table > tbody > tr > td) {
	padding: 0 8px;
}

.cash-movement-history__detail-row > td {
	padding: 8px 12px !important;
	background: rgba(var(--v-theme-on-surface), 0.03);
}

.cash-movement-history__detail {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 24px;
	margin: 0;
}

.cash-movement-history__detail-pair {
	display: flex;
	gap: 6px;
	min-width: 0;
	font-size: 0.8125rem;
	line-height: 1.5;
}

.cash-movement-history__detail-pair dt {
	font-weight: 600;
	white-space: nowrap;
	color: rgb(var(--v-theme-on-surface));
	opacity: 0.7;
}

.cash-movement-history__detail-pair dd {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}
</style>
