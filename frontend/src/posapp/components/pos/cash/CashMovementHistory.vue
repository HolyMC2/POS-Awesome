<template>
	<v-card class="pos-themed-card cash-movement-history__card">
		<div class="cash-movement-history__head">
			<div>
				<div class="cash-movement-history__title">{{ __("Cash Movements") }}</div>
				<div class="cash-movement-history__subtitle">{{ __("Latest entries for current shift") }}</div>
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

		<v-data-table
			:items="rows"
			:headers="headers"
			item-key="name"
			:loading="loading"
			density="compact"
			class="elevation-0"
		>
			<template #item.posting_date="{ item }">
				{{ formatPostingDate(item.posting_date) }}
			</template>
			<template #item.docstatus="{ item }">
				<v-chip size="small" :color="statusColor(item.docstatus)">
					{{ statusLabel(item.docstatus) }}
				</v-chip>
			</template>
			<template #item.actions="{ item }">
				<!-- Three peer row actions used to carry three different tints —
				     info, amber, red — which is the rainbow reproduced at row
				     scale, once per movement in the list. Only the irreversible
				     one keeps a colour now; the other two are neutral. The status
				     chip above is untouched: it pairs `statusColor` with
				     `statusLabel` text, so it is state a colourblind operator can
				     still read, which is exactly what §17.7 permits. -->
				<div class="cash-movement-history__row-actions">
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
		</v-data-table>
	</v-card>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

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

const headers: any[] = [
	{ title: __("Date"), key: "posting_date" },
	{ title: __("Against Name"), key: "against_name" },
	{ title: __("Type"), key: "movement_type" },
	{ title: __("Amount"), key: "amount", align: "end" },
	{ title: __("Source"), key: "source_account" },
	{ title: __("Target"), key: "target_account" },
	{ title: __("Remarks"), key: "remarks" },
	{ title: __("Journal Entry"), key: "journal_entry" },
	{ title: __("Status"), key: "docstatus", align: "center" },
	{ title: __("Actions"), key: "actions", sortable: false, align: "end" },
];

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

.cash-movement-history__subtitle {
	font-size: 0.875rem;
	line-height: 1.4;
	color: rgb(var(--v-theme-on-surface));
	opacity: 0.7;
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

/* The table is the elastic child. It grows inside the card; it does NOT open a
 * scrollport of its own — the destination's `__body` is the only one on this
 * surface (commit 59c5fe1ad). */
.cash-movement-history__card > :deep(.v-data-table) {
	flex: 1 1 auto;
	min-height: 0;
}
</style>
