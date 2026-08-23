<template>
	<!--
		Gasto as a DESTINATION, not a dialog body on a page of its own.

		What it was: a `pa-3` div wrapping a `v-row`, sized by Vuetify spacing
		utilities. Those utilities are not in the web route's stylesheet at all
		(only `vuetify/components` CSS is bundled; the full `vuetify.min.css`
		is injected by the Desk loader and nowhere else), so `pa-3` and `pa-4`
		contributed ZERO padding while `v-row`'s −4px dense margin — component
		CSS, and therefore present — stayed real. The row hung 4px outside its
		container on both sides, the card's text sat flush against a clipped
		left edge, and "Cash Movement" lost its C.

		So the geometry is authored here instead of borrowed from a utility that
		may or may not exist. One scrollport (`__body`), the same height-chain
		discipline the register columns use, and the history stretches to the
		full height rather than leaving half the surface empty under it.
	-->
	<div class="cash-movement-destination">
		<div
			v-if="pendingOfflineCount > 0 || errorMessage || (contextLoaded && !context?.enable_cash_movement)"
			class="cash-movement-destination__notices"
		>
			<div v-if="pendingOfflineCount > 0" class="cash-movement-destination__sync">
				<v-btn
					variant="outlined"
					color="warning"
					:loading="syncingOffline"
					:disabled="isOffline()"
					@click="handleSyncOffline"
				>
					{{ __("Sync Offline Cash Movements ({0})", [pendingOfflineCount]) }}
				</v-btn>
			</div>

			<v-alert v-if="errorMessage" type="error" variant="tonal" density="compact">
				{{ errorMessage }}
			</v-alert>

			<v-alert
				v-if="contextLoaded && !context?.enable_cash_movement"
				type="warning"
				variant="tonal"
				density="compact"
			>
				{{ __("Cash Movement is disabled in current POS Profile.") }}
			</v-alert>
		</div>

		<div class="cash-movement-destination__body">
			<div class="cash-movement-destination__col cash-movement-destination__col--form">
				<CashMovementForm
					:context="context"
					:submitting="submitting"
					:reset-token="formResetToken"
					:prefill-token="prefillToken"
					:prefill-data="prefillData"
					@submit="handleSubmit"
				/>
			</div>
			<div class="cash-movement-destination__col cash-movement-destination__col--history">
				<CashMovementHistory
					:rows="historyRows"
					:loading="loading"
					:action-loading="actionLoading"
					:allow-cancel="!!context?.allow_cancel_submitted_cash_movement"
					:allow-delete="!!context?.allow_delete_cancelled_cash_movement"
					:selected-status="historyStatus"
					:selected-movement-type="historyMovementType"
					:selected-search-text="historySearchText"
					:pending-offline-count="pendingOfflineCount"
					@refresh="refreshHistory"
					@duplicate="handleDuplicate"
					@cancel="handleCancel"
					@delete="handleDelete"
					@filter-change="handleFilterChange"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useUIStore } from "../../../stores/uiStore";
import { useToastStore } from "../../../stores/toastStore";
import { useCashMovement } from "../../../composables/pos/cash/useCashMovement";
import {
	getPendingOfflineCashMovementCount,
	isOffline,
	saveOfflineCashMovement,
	syncOfflineCashMovements,
} from "../../../../offline";
import CashMovementForm from "./CashMovementForm.vue";
import CashMovementHistory from "./CashMovementHistory.vue";

const __ = window.__ || ((text: string, _args?: any[]) => text);

const uiStore = useUIStore();
const toastStore = useToastStore();

const {
	loading,
	submitting,
	actionLoading,
	context,
	historyRows,
	error,
	loadContext,
	loadHistory,
	submitMovement,
	cancelMovement,
	deleteMovement,
} = useCashMovement();

const contextLoaded = ref(false);
const syncingOffline = ref(false);
const pendingOfflineCount = ref(0);
const historyStatus = ref("");
const historyMovementType = ref("");
const historySearchText = ref("");
const prefillToken = ref(0);
const prefillData = ref<any>(null);
const formResetToken = ref(0);
const errorMessage = computed(() => error.value);

const posProfileName = computed(() => uiStore.posProfile?.name || "");
const openingShiftName = computed(() => uiStore.posOpeningShift?.name || "");

async function initialize() {
	if (!posProfileName.value || !openingShiftName.value) {
		return;
	}
	await loadContext(posProfileName.value, openingShiftName.value);
	contextLoaded.value = true;
	refreshPendingOfflineCount();
	await refreshHistory();
}

async function refreshHistory() {
	if (!openingShiftName.value) {
		return;
	}
	await loadHistory(openingShiftName.value, {
		status: historyStatus.value,
		movementType: historyMovementType.value,
		searchText: historySearchText.value,
	});
}

function refreshPendingOfflineCount() {
	pendingOfflineCount.value = getPendingOfflineCashMovementCount();
}

async function handleFilterChange(payload: { status: string; movementType: string; searchText: string }) {
	historyStatus.value = payload?.status || "";
	historyMovementType.value = payload?.movementType || "";
	historySearchText.value = payload?.searchText || "";
	await refreshHistory();
}

async function handleSubmit(payload: any) {
	try {
		if (
			(payload.movementType === "Expense" && !context.value?.allow_pos_expense) ||
			(["Deposit", "Cash In"].includes(payload.movementType) &&
				!context.value?.allow_cash_deposit)
		) {
			throw new Error(__("Selected movement type is not allowed by POS Profile."));
		}

		const requestPayload = {
			pos_profile: posProfileName.value,
			pos_opening_shift: openingShiftName.value,
			posting_date: payload.postingDate,
			amount: payload.amount,
			against_name: payload.againstName,
			source_account: payload.sourceAccount,
			remarks: payload.remarks,
			expense_account: payload.expenseAccount,
			target_account: payload.targetAccount,
			movement_type: payload.movementType,
			client_request_id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		};

		if (isOffline()) {
			const method =
				payload.movementType === "Deposit"
					? "posawesome.posawesome.api.cash_movement.service.create_cash_deposit"
					: payload.movementType === "Cash In"
						? "posawesome.posawesome.api.cash_movement.service.create_cash_in"
						: "posawesome.posawesome.api.cash_movement.service.create_pos_expense";
			await saveOfflineCashMovement({
				method,
				args: {
					payload: requestPayload,
				},
			});
			toastStore.show({
				title: __("Cash movement saved offline"),
				color: "warning",
			});
			formResetToken.value += 1;
			refreshPendingOfflineCount();
			return;
		}

		await submitMovement({
			movementType: payload.movementType,
			amount: payload.amount,
			againstName: payload.againstName,
			postingDate: payload.postingDate,
			sourceAccount: payload.sourceAccount,
			remarks: payload.remarks,
			expenseAccount: payload.expenseAccount,
			targetAccount: payload.targetAccount,
			posProfileName: posProfileName.value,
			posOpeningShiftName: openingShiftName.value,
			clientRequestId: requestPayload.client_request_id,
		});
		toastStore.show({ title: __("Cash movement submitted"), color: "success" });
		formResetToken.value += 1;
		await refreshHistory();
	} catch (err: any) {
		toastStore.show({ title: err?.message || __("Failed to submit cash movement"), color: "error" });
	}
}

function handleDuplicate(row: any) {
	if (!row?.name) return;
	prefillData.value = {
		movement_type: row.movement_type,
		amount: row.amount,
		posting_date: row.posting_date,
		against_name: row.against_name,
		source_account: row.source_account,
		remarks: row.remarks,
		expense_account: row.expense_account,
		target_account: row.target_account,
	};
	prefillToken.value += 1;
	toastStore.show({ title: __("Data loaded in form. Review and submit."), color: "info" });
}

async function handleCancel(row: any) {
	if (!row?.name) return;
	try {
		const confirmed = window.confirm(__("Cancel cash movement {0}?", [row.name]));
		if (!confirmed) {
			return;
		}
		await cancelMovement(row.name);
		toastStore.show({ title: __("Cash movement cancelled"), color: "warning" });
		await refreshHistory();
	} catch (err: any) {
		toastStore.show({ title: err?.message || __("Failed to cancel cash movement"), color: "error" });
	}
}

async function handleDelete(row: any) {
	if (!row?.name) return;
	try {
		const confirmed = window.confirm(__("Delete cancelled cash movement {0}?", [row.name]));
		if (!confirmed) {
			return;
		}
		await deleteMovement(row.name);
		toastStore.show({ title: __("Cash movement deleted"), color: "success" });
		await refreshHistory();
	} catch (err: any) {
		toastStore.show({ title: err?.message || __("Failed to delete cash movement"), color: "error" });
	}
}

async function handleSyncOffline() {
	if (isOffline()) {
		return;
	}
	syncingOffline.value = true;
	try {
		const result = await syncOfflineCashMovements();
		refreshPendingOfflineCount();
		if (result?.synced) {
			toastStore.show({
				title: __("Synced {0} offline cash movement(s).", [result.synced]),
				color: "success",
			});
			await refreshHistory();
			return;
		}
		toastStore.show({
			title: __("No offline cash movement synced."),
			color: "info",
		});
	} catch (err: any) {
		toastStore.show({
			title: err?.message || __("Failed to sync offline cash movements"),
			color: "error",
		});
	} finally {
		syncingOffline.value = false;
	}
}

watch(
	[posProfileName, openingShiftName],
	() => {
		initialize();
	},
	{ immediate: true },
);
</script>
<style scoped>
/* Fills the destination surface and refuses to grow past it — `min-height: 0`
 * is the half that does the work, same as `.destination-host` and the register
 * columns (commit 59c5fe1ad). */
.cash-movement-destination {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
}

.cash-movement-destination__notices {
	flex: 0 0 auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 16px 0;
}

.cash-movement-destination__sync {
	display: flex;
	justify-content: flex-end;
}

/* THE only scrollport on this surface. The host above it is `overflow: hidden`
 * and every column inside is `min-width: 0`, so nothing nests a second one. */
.cash-movement-destination__body {
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	overflow-y: auto;
	overflow-x: hidden;
	overscroll-behavior: contain;
	padding: 16px;
	display: grid;
	gap: 16px;
	/* One grid, two columns — the form and its history were previously two
	 * `v-col`s that shared nothing but a row. `minmax(min-content, 1fr)` on the
	 * row lets the history fill the surface instead of leaving half of it
	 * empty, and still lets the pair grow past it and scroll. */
	grid-template-columns: minmax(320px, 5fr) minmax(0, 7fr);
	grid-template-rows: minmax(min-content, 1fr);
}

.cash-movement-destination__col {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

/* A form is as tall as its fields; only the table earns the leftover height. */
.cash-movement-destination__col--form {
	align-self: start;
}

.cash-movement-destination__col--history > :deep(*) {
	flex: 1 1 auto;
	min-height: 0;
}

/* Below the two-column boundary the surface is one column, in reading order:
 * the form first, its history under it. */
@media (max-width: 1100px) {
	.cash-movement-destination__body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto;
		padding: 12px;
	}

	.cash-movement-destination__col--form {
		align-self: stretch;
	}
}
</style>
