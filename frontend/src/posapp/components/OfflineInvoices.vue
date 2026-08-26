<template>
	<v-row justify="center">
		<v-dialog
			v-model="dialog"
			max-width="1200px"
			:fullscreen="movilOffline"
			persistent
			transition="fade-transition"
		>
			<!-- The phone's offline surface (movil round 4): MovilOfflineSurface
			     reads the real queue and owns the drain; this dialog keeps the
			     door and the ✕. The desktop management table stays below for
			     every other width. -->
			<v-card v-if="movilOffline" class="pos-card offline-movil-card">
				<div class="offline-movil-card__bar">
					<span class="offline-movil-card__title">{{ __("Offline Invoices") }}</span>
					<v-btn
						icon="mdi-close"
						variant="text"
						density="comfortable"
						:aria-label="__('Close')"
						@click="dialog = false"
					/>
				</div>
				<MovilOfflineSurface
					:online="movilOnline"
					:format-currency="movilFormatCurrency"
				/>
			</v-card>
			<v-card v-else class="pos-card offline-invoices-card elevation-12">
				<!-- Revamped Modern Header -->
				<v-card-title class="offline-header pa-8">
					<div class="header-content-wrapper">
						<div class="header-main-content">
							<div class="header-icon-wrapper-revamped">
								<div class="icon-background">
									<v-icon class="header-icon-revamped" size="32"
										>mdi-file-document-multiple-outline</v-icon
									>
								</div>
								<div class="icon-glow"></div>
							</div>
							<div class="header-text-revamped">
								<h2 class="header-title-revamped">{{ __("Offline Invoices") }}</h2>
								<p class="header-subtitle-revamped">
									{{ __("Manage and synchronize your offline transactions") }}
								</p>
								<div class="header-stats-revamped">
									<v-chip
										v-if="invoices.length > 0"
										color="warning"
										variant="elevated"
										size="default"
										class="status-chip-revamped pending-chip"
										elevation="2"
									>
										<v-icon start size="16">mdi-clock-outline</v-icon>
										{{ invoices.length }} {{ __("Pending Sync") }}
									</v-chip>
									<v-chip
										v-else
										color="success"
										variant="elevated"
										size="default"
										class="status-chip-revamped synced-chip"
										elevation="2"
									>
										<v-icon start size="16">mdi-check-circle</v-icon>
										{{ __("All Synchronized") }}
									</v-chip>
								</div>
							</div>
						</div>
						<div class="header-close-section">
							<v-btn
								icon="mdi-close"
								variant="text"
								size="large"
								color="error"
								class="header-close-btn"
								@click="dialog = false"
								:aria-label="__('Close offline invoices dialog')"
							>
								<v-tooltip activator="parent" location="bottom">
									{{ __("Close Dialog") }}
								</v-tooltip>
							</v-btn>
						</div>
					</div>
				</v-card-title>

				<v-divider class="header-divider"></v-divider>

				<v-card-text class="pa-0 white-background">
					<v-container fluid class="pa-6">
						<!-- SPEC A: dead-lettered sales — sync retries exhausted;
						     cash was collected but NO invoice exists. Loudest
						     section, first. -->
						<v-alert
							v-if="deadLetterRows.length || writeQueueDeadLetterRows.length"
							type="error"
							variant="tonal"
							class="mb-6"
							density="comfortable"
						>
							<div class="text-subtitle-1 font-weight-bold mb-2">
								{{ __("Sin sincronizar — atención") }} ({{ deadLetterRows.length + writeQueueDeadLetterRows.length }})
							</div>
							<div class="text-body-2 mb-3">
								{{ __("Estas ventas cobradas NO tienen factura registrada. Reintenta; si vuelve a fallar, exporta el JSON y llama al administrador.") }}
							</div>
							<div
								v-for="row in deadLetterRows"
								:key="row.client_request_id"
								class="d-flex align-center flex-wrap mb-2"
								style="gap: 8px"
							>
								<span class="font-weight-medium">
									{{ row.invoice?.customer_name || row.invoice?.customer || __("Cliente") }}
								</span>
								<span>{{ currencySymbol(row.invoice?.currency) }} {{ formatCurrency(row.invoice?.grand_total) }}</span>
								<span class="text-caption text-medium-emphasis">
									{{ row.created_at }} · {{ __("intentos") }}: {{ row.retry_count }}
								</span>
								<span v-if="row.last_error" class="text-caption text-error" style="max-width: 420px">
									{{ String(row.last_error).slice(0, 160) }}
								</span>
								<v-spacer />
								<v-btn
									size="small"
									color="primary"
									variant="tonal"
									:loading="deadLetterBusy === row.client_request_id"
									@click="retryDeadLetter(row)"
								>
									{{ __("Reintentar") }}
								</v-btn>
								<v-btn
									size="small"
									variant="tonal"
									@click="exportDeadLetter(row)"
								>
									{{ __("Exportar JSON") }}
								</v-btn>
							</div>
							<!-- Live write_queue dead-letters (audit r2 A2): the
							     badge counts these, so they must be listed and
							     retryable here — before this block they had no
							     surface at all. -->
							<div
								v-for="row in writeQueueDeadLetterRows"
								:key="`wq-${row.queue_id}`"
								class="d-flex align-center flex-wrap mb-2"
								style="gap: 8px"
							>
								<span class="text-caption font-weight-bold text-uppercase">
									{{ writeQueueEntityLabel(row) }}
								</span>
								<span class="font-weight-medium">
									{{ writeQueueRowCustomer(row) || __("Cliente") }}
								</span>
								<span v-if="writeQueueRowAmount(row) !== null">
									{{ currencySymbol(row.invoice?.currency) }} {{ formatCurrency(writeQueueRowAmount(row)) }}
								</span>
								<span class="text-caption text-medium-emphasis">
									{{ row.created_at }} · {{ __("intentos") }}: {{ row.retry_count }}
								</span>
								<span v-if="row.last_error" class="text-caption text-error" style="max-width: 420px">
									{{ String(row.last_error).slice(0, 160) }}
								</span>
								<v-spacer />
								<v-btn
									size="small"
									color="primary"
									variant="tonal"
									:loading="writeQueueDeadLetterBusy === row.queue_id"
									@click="retryWriteQueueDeadLetter(row)"
								>
									{{ __("Reintentar") }}
								</v-btn>
								<v-btn
									size="small"
									variant="tonal"
									@click="exportWriteQueueDeadLetter(row)"
								>
									{{ __("Exportar JSON") }}
								</v-btn>
							</div>
						</v-alert>

						<v-alert
							v-if="draftReviewRows.length"
							type="warning"
							variant="tonal"
							class="mb-6"
							density="comfortable"
						>
							<div class="text-subtitle-1 font-weight-bold mb-2">
								{{ __("Borradores por revisar") }} ({{ draftReviewRows.length }})
							</div>
							<div class="text-body-2 mb-3">
								{{ __("Estas ventas quedaron como BORRADOR en el servidor — no están timbradas ni contabilizadas. Reintentar vuelve a enviarlas (seguro: adopta el mismo borrador); Resuelto solo las marca atendidas después de arreglarlas en el escritorio.") }}
							</div>
							<div
								v-for="row in draftReviewRows"
								:key="row.queue_id"
								class="d-flex align-center flex-wrap mb-2"
								style="gap: 8px"
							>
								<span class="font-weight-medium">
									{{ row.invoice?.customer_name || row.invoice?.customer || __("Cliente") }}
								</span>
								<span>
									{{ currencySymbol(row.invoice?.currency) }}
									{{ formatCurrency(row.invoice?.grand_total || row.invoice?.rounded_total) }}
								</span>
								<span v-if="row.draft_invoice_name" class="text-caption font-weight-medium">
									{{ row.draft_invoice_name }}
								</span>
								<span class="text-caption text-medium-emphasis">
									{{ row.created_at }}
								</span>
								<span v-if="row.draft_reason" class="text-caption text-warning" style="max-width: 420px">
									{{ String(row.draft_reason).slice(0, 160) }}
								</span>
								<v-spacer />
								<v-btn
									size="small"
									color="primary"
									variant="tonal"
									:loading="draftReviewBusy === row.queue_id"
									@click="retryDraftReview(row)"
								>
									{{ __("Reintentar") }}
								</v-btn>
								<!-- Neutral tonal, not amber. This sits beside a `tonal primary`
								     "Reintentar" as its peer, and giving two peer actions two
								     different tints is colour used as a category label — the
								     habit that stops amber meaning "state" anywhere else. -->
								<v-btn
									size="small"
									variant="tonal"
									:loading="draftReviewBusy === row.queue_id"
									@click="resolveDraftReview(row)"
								>
									{{ __("Resuelto") }}
								</v-btn>
								<v-btn size="small" variant="tonal" @click="exportDraftReview(row)">
									{{ __("Exportar JSON") }}
								</v-btn>
							</div>
						</v-alert>

						<!-- Enhanced Empty State -->
						<div v-if="!invoices.length" class="empty-state text-center py-12">
							<div class="empty-icon-wrapper mb-4">
								<v-icon size="80" color="success" class="empty-icon"
									>mdi-check-circle-outline</v-icon
								>
							</div>
							<h3 class="text-h5 mb-3 text-grey-darken-2 font-weight-medium">
								{{ __("All Caught Up!") }}
							</h3>
							<p class="text-body-1 text-grey-darken-1 mb-0">
								{{ __("No offline invoices pending synchronization") }}
							</p>
						</div>

						<!-- Enhanced Invoices Table -->
						<div v-else class="table-container">
							<div class="table-header mb-4">
								<h4 class="text-h6 text-grey-darken-2 mb-1">{{ __("Pending Invoices") }}</h4>
								<p class="text-body-2 text-grey">
									{{ __("These invoices will be synced when connection is restored") }}
								</p>
							</div>

							<v-data-table
								:headers="headers"
								:items="invoices"
								class="elevation-0 rounded-lg white-table"
								:items-per-page="15"
								:items-per-page-options="[15, 25, 50]"
							>
								<template #item.customer="{ item }">
									<div class="customer-cell">
										<v-avatar size="32" color="primary" class="mr-3">
											<v-icon size="18" color="white">mdi-account</v-icon>
										</v-avatar>
										<div>
											<div class="font-weight-medium text-grey-darken-2">
												{{ item.invoice.customer_name || item.invoice.customer }}
											</div>
											<div class="text-caption text-grey">{{ __("Customer") }}</div>
										</div>
									</div>
								</template>

								<template #item.posting_date="{ item }">
									<v-chip size="small" color="info" variant="tonal" class="date-chip">
										<v-icon start size="14">mdi-calendar</v-icon>
										{{ item.invoice.posting_date }}
									</v-chip>
								</template>

								<template #item.grand_total="{ item }">
									<div class="amount-cell text-right">
										<div class="text-h6 font-weight-bold text-success">
											{{ currencySymbol(item.invoice.currency) }}
											{{
												formatCurrency(
													item.invoice.grand_total || item.invoice.rounded_total,
												)
											}}
										</div>
										<div class="text-caption text-grey">{{ __("Total Amount") }}</div>
									</div>
								</template>

								<template #item.actions="{ index }">
									<v-btn
										v-if="posProfile.posa_allow_delete_offline_invoice"
										icon
										color="error"
										size="small"
										variant="text"
										@click="askRemoveInvoice(index)"
										class="delete-btn"
										:aria-label="__('Delete offline invoice')"
									>
										<v-icon size="18">mdi-delete-outline</v-icon>
										<v-tooltip activator="parent" location="top">
											{{ __("Delete Invoice") }}
										</v-tooltip>
									</v-btn>
								</template>
							</v-data-table>
						</div>
					</v-container>
				</v-card-text>

				<!-- Revamped Modern Footer -->
				<v-divider class="footer-divider"></v-divider>
				<v-card-actions class="dialog-actions-container-revamped">
					<div class="actions-left-section">
						<v-btn
							v-if="invoices.length > 0"
							variant="elevated"
							prepend-icon="mdi-sync"
							@click="$emit('sync-all')"
							class="sync-action-btn-revamped"
							size="large"
							elevation="3"
						>
							{{ __("Sync All Invoices") }}
						</v-btn>
						<div v-else class="sync-status-indicator">
							<v-icon color="success" size="20" class="mr-2">mdi-check-circle</v-icon>
							<span class="text-success font-weight-medium">{{
								__("All invoices are synchronized")
							}}</span>
						</div>
					</div>
					<div class="actions-right-section">
						<v-btn
							variant="outlined"
							color="error"
							@click="dialog = false"
							class="close-action-btn-revamped"
							size="large"
							prepend-icon="mdi-close"
						>
							{{ __("Close") }}
						</v-btn>
					</div>
				</v-card-actions>

				<v-dialog v-model="confirmDeleteDialog" max-width="480" persistent>
					<v-card>
						<v-card-title class="text-h6">
							{{ __("¿Eliminar venta sin sincronizar?") }}
						</v-card-title>
						<v-card-text>
							<div class="mb-2">
								{{ __("Esta venta NO se ha enviado al servidor. Si la eliminas, se pierde para siempre — no quedará factura ni registro.") }}
							</div>
							<div v-if="pendingDeleteInvoice" class="font-weight-medium">
								{{
									pendingDeleteInvoice.invoice?.customer_name ||
									pendingDeleteInvoice.invoice?.customer ||
									__("Cliente")
								}}
								·
								{{ currencySymbol(pendingDeleteInvoice.invoice?.currency) }}
								{{
									formatCurrency(
										pendingDeleteInvoice.invoice?.grand_total ||
											pendingDeleteInvoice.invoice?.rounded_total,
									)
								}}
							</div>
						</v-card-text>
						<v-card-actions>
							<v-spacer />
							<v-btn variant="text" @click="cancelRemoveInvoice">
								{{ __("Cancelar") }}
							</v-btn>
							<!-- KEPT saturated, deliberately. This confirm is its own surface
							     — a modal whose only coloured element this is — so "one
							     saturated colour on the primary action" is satisfied, and here
							     the destructive act IS the primary. Red on an irreversible
							     delete is a safety affordance, not emphasis; the label carries
							     the meaning for anyone who cannot see the colour. -->
							<v-btn color="error" variant="elevated" @click="confirmRemoveInvoice">
								{{ __("Eliminar definitivamente") }}
							</v-btn>
						</v-card-actions>
					</v-card>
				</v-dialog>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { formatUtils } from "../format";
import {
	getOfflineInvoices,
	deleteOfflineInvoice,
	getPendingOfflineInvoiceCount,
	getDeadLetterRows,
	exportDeadLetterEntry,
	getWriteQueueDeadLetterRows,
	getWriteQueueDraftReviewRows,
} from "../../offline/index";
import { useSyncStore } from "../stores/syncStore";
import { useResponsive } from "../composables/core/useResponsive";
import { useOnlineStatus } from "../composables/core/useOnlineStatus";
import MovilOfflineSurface from "./pos/mobile/offline/MovilOfflineSurface.vue";

defineOptions({
	name: "OfflineInvoicesDialog",
});

const props = defineProps({
	modelValue: Boolean,
	posProfile: {
		type: Object,
		default: () => ({}),
	},
});

const emit = defineEmits(["update:modelValue", "deleted", "sync-all"]);

// ---- MovilOffline (round 4 of the mobile wiring) ------------------------
// On phones this dialog's content is the movil offline surface: the held
// money, the queue behind it, one Reintentar. The surface reads the real
// queue and owns the drain (its own contract); this dialog keeps the door.
const responsive = useResponsive();
// The compact band (< 1100), matching the shell's movil boundary.
const movilOffline = computed(() => responsive.isCompact.value);
const { isOnline: movilOnline } = useOnlineStatus();
const movilFormatCurrency = (value) => formatCurrency(value);
const __ = window.__ || ((text) => text);
const get_currency_symbol = window.get_currency_symbol;
const currency_precision = ref(2);

const dialog = ref(props.modelValue);
const invoices = ref([]);
const deadLetterRows = ref([]);
const deadLetterBusy = ref("");
// Live write_queue dead-letters (invoice/payment/cash) — the badge counts
// them, so the panel must list them or "Reintentar" is unreachable (audit r2
// A2). Separate list from the OUTBOX dead-letters above: different id space
// (queue_id vs client_request_id) and different requeue action.
const writeQueueDeadLetterRows = ref([]);
const writeQueueDeadLetterBusy = ref(null);
const WRITE_QUEUE_ENTITY_LABELS = {
	invoice: __("Venta"),
	payment: __("Pago"),
	cash_movement: __("Movimiento de caja"),
	customer: __("Cliente"),
	restaurant_order: __("Comanda"),
};

function writeQueueEntityLabel(row) {
	return WRITE_QUEUE_ENTITY_LABELS[row.entity_type] || row.entity_type;
}

function writeQueueRowCustomer(row) {
	return (
		row.invoice?.customer_name ||
		row.invoice?.customer ||
		row.args?.payload?.customer_name ||
		row.args?.payload?.customer ||
		""
	);
}

function writeQueueRowAmount(row) {
	const amount = row.invoice?.grand_total ?? row.invoice?.rounded_total;
	return amount === undefined || amount === null ? null : amount;
}
const draftReviewRows = ref([]);
const draftReviewBusy = ref(null);
const confirmDeleteDialog = ref(false);
const pendingDeleteIndex = ref(null);
const pendingDeleteInvoice = computed(() =>
	pendingDeleteIndex.value === null || pendingDeleteIndex.value === undefined
		? null
		: invoices.value[pendingDeleteIndex.value] || null,
);
const syncStore = useSyncStore();
const headers = [
	{
		title: __("Customer"),
		value: "customer",
		align: "start",
		width: "35%",
	},
	{
		title: __("Date"),
		value: "posting_date",
		align: "center",
		width: "20%",
	},
	{
		title: __("Amount"),
		value: "grand_total",
		align: "end",
		width: "25%",
	},
	{
		title: __("Actions"),
		value: "actions",
		align: "center",
		width: "20%",
		sortable: false,
	},
];

watch(
	() => props.modelValue,
	(val) => {
		dialog.value = val;
		if (val) {
			loadInvoices();
		}
	},
);

watch(dialog, (val) => {
	emit("update:modelValue", val);
});

function formatCurrency(value, precision) {
	if (value === null || value === undefined) {
		value = 0;
	}
	let number = Number(formatUtils.fromArabicNumerals(String(value)).replace(/,/g, ""));
	if (isNaN(number)) number = 0;
	let prec = precision != null ? Number(precision) : Number(currency_precision.value) || 2;
	if (!Number.isInteger(prec) || prec < 0 || prec > 20) {
		prec = Math.min(Math.max(parseInt(prec) || 2, 0), 20);
	}

	const locale = formatUtils.getNumberLocale();
	let formatted = number.toLocaleString(locale, {
		minimumFractionDigits: prec,
		maximumFractionDigits: prec,
		useGrouping: true,
	});

	formatted = formatUtils.toArabicNumerals(formatted);
	return formatted;
}

function currencySymbol(currency) {
	return get_currency_symbol?.(currency);
}

// The queue mirror deliberately keeps dead_letter/draft_review rows (the
// close-shift gate counts them as unresolved money), but the TABLE labels its
// rows "Pending Sync" — listing operator-action rows there duplicated the
// alert sections above and lied about what the drain will retry (audit r2
// A7). The table shows drain-owned rows only.
const OPERATOR_REVIEW_STATUSES = new Set(["dead_letter", "draft_review"]);

function loadInvoices() {
	invoices.value = getOfflineInvoices().filter(
		(row) => !OPERATOR_REVIEW_STATUSES.has(row.status),
	);
	void loadOperatorReviewRows();
}

async function loadOperatorReviewRows() {
	await Promise.all([loadDeadLetters(), loadDraftReviews()]);
}

async function loadDeadLetters() {
	try {
		deadLetterRows.value = await getDeadLetterRows();
	} catch (e) {
		console.error("dead-letter load failed", e);
	}
	try {
		writeQueueDeadLetterRows.value = await getWriteQueueDeadLetterRows();
	} catch (e) {
		console.error("write-queue dead-letter load failed", e);
	}
}

async function loadDraftReviews() {
	try {
		draftReviewRows.value = await getWriteQueueDraftReviewRows("invoice");
	} catch (e) {
		console.error("draft-review load failed", e);
	}
}

async function retryDeadLetter(row) {
	deadLetterBusy.value = row.client_request_id;
	try {
		await syncStore.requeueDeadLetter(row.client_request_id);
	} finally {
		deadLetterBusy.value = "";
		// Reload the TABLE too: a requeued row is pending again and must move
		// from the alert section into the drain-owned list (audit r2 A7).
		loadInvoices();
	}
}

async function retryWriteQueueDeadLetter(row) {
	writeQueueDeadLetterBusy.value = row.queue_id;
	try {
		await syncStore.requeueWriteQueueDeadLetter(row.queue_id);
	} finally {
		writeQueueDeadLetterBusy.value = null;
		loadInvoices();
	}
}

function exportWriteQueueDeadLetter(row) {
	downloadJson(row, `venta-sin-sincronizar-cola-${row.queue_id}.json`);
}

async function retryDraftReview(row) {
	draftReviewBusy.value = row.queue_id;
	try {
		await syncStore.requeueDraftReview(row.queue_id);
	} finally {
		draftReviewBusy.value = null;
		loadInvoices();
	}
}

async function resolveDraftReview(row) {
	draftReviewBusy.value = row.queue_id;
	try {
		await syncStore.resolveDraftReview(row.queue_id);
	} finally {
		draftReviewBusy.value = null;
		loadInvoices();
	}
}

function downloadJson(payload, filename) {
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

async function exportDeadLetter(row) {
	const payload = await exportDeadLetterEntry(row.client_request_id);
	if (!payload) return;
	downloadJson(payload, `venta-sin-sincronizar-${row.client_request_id}.json`);
}

function exportDraftReview(row) {
	downloadJson(
		{
			client_request_id: row.idempotency_key,
			invoice: row.invoice,
			data: row.data,
			draft_invoice_name: row.draft_invoice_name,
			draft_reason: row.draft_reason,
			created_at: row.created_at,
		},
		`venta-borrador-${row.queue_id}.json`,
	);
}

// Deleting a pending offline invoice destroys the only copy of an unsynced
// sale — never one tap (audit r2 A5). The button arms this dialog; the
// destructive call runs only from its explicit confirm.
function askRemoveInvoice(index) {
	if (!props.posProfile.posa_allow_delete_offline_invoice) {
		return;
	}
	pendingDeleteIndex.value = index;
	confirmDeleteDialog.value = true;
}

function cancelRemoveInvoice() {
	confirmDeleteDialog.value = false;
	pendingDeleteIndex.value = null;
}

async function confirmRemoveInvoice() {
	const index = pendingDeleteIndex.value;
	confirmDeleteDialog.value = false;
	pendingDeleteIndex.value = null;
	if (index === null || index === undefined) {
		return;
	}
	await deleteOfflineInvoice(index);
	loadInvoices();
	emit("deleted", getPendingOfflineInvoiceCount());
}
</script>

<style>
/* ========== REVAMPED OFFLINE INVOICES DIALOG ========== */

/* Main Card Styling */
.offline-invoices-card {
	border-radius: 20px !important;
	overflow: hidden;
	background-color: var(--pos-card-bg) !important;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15) !important;
	border: 1px solid var(--pos-border);
}

/* ========== REVAMPED HEADER SECTION ========== */
.offline-header {
	background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%) !important;
	color: white !important;
	border-bottom: none !important;
	position: relative;
	overflow: hidden;
}

.offline-header::before {
	content: "";
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%);
	pointer-events: none;
}

.offline-header::after {
	content: "";
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	height: 1px;
	background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.3) 50%, transparent 100%);
}

/* Header Content Layout */
.header-content-wrapper {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;
	position: relative;
	z-index: 2;
}

.header-main-content {
	display: flex;
	align-items: center;
	gap: 24px;
	flex: 1;
}

.header-close-section {
	display: flex;
	align-items: center;
}

/* Revamped Icon Wrapper */
.header-icon-wrapper-revamped {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 80px;
	height: 80px;
}

.icon-background {
	position: relative;
	z-index: 2;
	width: 64px;
	height: 64px;
	background: rgba(255, 255, 255, 0.15);
	border: 2px solid rgba(255, 255, 255, 0.3);
	border-radius: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	backdrop-filter: blur(10px);
	transition: all 0.3s ease;
}

.icon-glow {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 80px;
	height: 80px;
	background: radial-gradient(circle, rgba(255, 255, 255, 0.2) 0%, transparent 70%);
	border-radius: 50%;
	opacity: 0;
	transition: opacity 0.3s ease;
	animation: iconPulse 2s infinite ease-in-out;
}

@keyframes iconPulse {
	0%,
	100% {
		opacity: 0.3;
		transform: translate(-50%, -50%) scale(1);
	}
	50% {
		opacity: 0.6;
		transform: translate(-50%, -50%) scale(1.1);
	}
}

.header-icon-revamped {
	color: white !important;
	filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.2));
}

.icon-background:hover {
	transform: scale(1.05);
	background: rgba(255, 255, 255, 0.25);
	border-color: rgba(255, 255, 255, 0.5);
}

.icon-background:hover + .icon-glow {
	opacity: 0.8;
}

/* Header Text Styling */
.header-text-revamped {
	flex: 1;
	color: white;
}

.header-title-revamped {
	margin: 0 0 8px 0;
	font-weight: 700;
	color: white !important;
	font-size: 2rem;
	letter-spacing: -0.5px;
	text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-subtitle-revamped {
	margin: 0 0 16px 0;
	font-size: 16px;
	color: rgba(255, 255, 255, 0.9) !important;
	font-weight: 400;
	letter-spacing: 0.2px;
}

.header-stats-revamped {
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
}

/* Status Chips */
.status-chip-revamped {
	font-weight: 600 !important;
	border-radius: 12px !important;
	padding: 0 16px !important;
	height: 36px !important;
	backdrop-filter: blur(10px);
	transition: all 0.3s ease;
}

.pending-chip {
	background: linear-gradient(135deg, #ff9800 0%, #ffc107 100%) !important;
	color: white !important;
	box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3) !important;
}

.synced-chip {
	background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%) !important;
	color: white !important;
	box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3) !important;
}

.status-chip-revamped:hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2) !important;
}

/* Header Close Button - Neutral with Red Icon */
.header-close-btn {
	width: 48px !important;
	height: 48px !important;
	border-radius: 12px !important;
	background: rgba(255, 255, 255, 0.15) !important;
	border: 1px solid rgba(255, 255, 255, 0.2) !important;
	color: #f44336 !important;
	transition: all 0.3s ease !important;
	backdrop-filter: blur(10px);
}

.header-close-btn:hover {
	background: rgba(244, 67, 54, 0.1) !important;
	border-color: rgba(244, 67, 54, 0.3) !important;
	transform: scale(1.05) !important;
	color: #d32f2f !important;
}

/* Force red color for the close icon */
.header-close-btn .v-icon {
	color: #f44336 !important;
}

.header-close-btn:hover .v-icon {
	color: #d32f2f !important;
}

/* Footer Divider */
.footer-divider {
	border-color: rgba(25, 118, 210, 0.1) !important;
	background: linear-gradient(90deg, transparent 0%, rgba(25, 118, 210, 0.2) 50%, transparent 100%);
	height: 2px;
}

/* Content containers */

.white-background {
	background: var(--pos-card-bg);
}

.empty-state {
	padding: var(--dynamic-xl) var(--dynamic-md);
	background: var(--pos-card-bg);
}

.empty-icon-wrapper {
	display: inline-block;
	padding: 20px;
	background: rgba(76, 175, 80, 0.1);
	border-radius: 50%;
}

.empty-icon {
	filter: drop-shadow(0 2px 8px rgba(76, 175, 80, 0.3));
}

.table-container {
	background: var(--pos-card-bg);
}

.table-header {
	padding: 0 var(--dynamic-xs);
	color: var(--pos-text-secondary);
}

.white-table {
	background: var(--pos-card-bg);
	border: 1px solid var(--pos-border);
	border-radius: var(--border-radius-lg);
	overflow: hidden;
}

.white-table :deep(th),
.white-table :deep(td) {
	border-bottom: 1px solid var(--pos-border);
}

:deep(.v-data-table-header) {
	background: var(--pos-table-header-bg);
	border-bottom: 2px solid var(--pos-border);
}

:deep(.v-data-table-header th) {
	font-weight: 600;
	color: var(--pos-text-primary);
	font-size: 0.875rem;
	padding: var(--dynamic-md);
}

:deep(.v-data-table__tr) {
	border-bottom: 1px solid var(--pos-border);
}

:deep(.v-data-table__tr:hover) {
	background-color: var(--pos-table-row-hover);
}

:deep(.v-data-table__td) {
	padding: var(--dynamic-md);
	border-bottom: 1px solid var(--pos-border);
}

/* Enhanced Cell Styling */
.customer-cell {
	display: flex;
	align-items: center;
}

.amount-cell {
	font-family: "Roboto Mono", monospace;
}

.date-chip {
	border-radius: var(--border-radius-sm);
	font-weight: 500;
}

.delete-btn {
	border-radius: var(--border-radius-sm);
	transition: all 0.2s ease;
}

.delete-btn:hover {
	background-color: rgba(244, 67, 54, 0.08);
	transform: scale(1.05);
}

.close-btn {
	border-radius: var(--border-radius-sm);
	text-transform: none;
	font-weight: 500;
	padding: var(--dynamic-sm) var(--dynamic-lg);
}

/* ========== RESPONSIVE DESIGN ========== */
@media (max-width: 768px) {
	.offline-invoices-card {
		margin: 16px !important;
		border-radius: 16px !important;
	}

	.offline-header {
		padding: 24px !important;
	}

	.header-main-content {
		gap: 16px;
	}

	.header-icon-wrapper-revamped {
		width: 60px;
		height: 60px;
	}

	.icon-background {
		width: 48px;
		height: 48px;
	}

	.header-title-revamped {
		font-size: 1.5rem;
	}

	.header-subtitle-revamped {
		font-size: 14px;
	}

	.dialog-actions-container-revamped {
		flex-direction: column-reverse;
		gap: 16px !important;
		padding: 20px !important;
		min-height: auto;
	}

	.actions-left-section,
	.actions-right-section {
		width: 100%;
		justify-content: center;
	}

	.sync-action-btn-revamped,
	.close-action-btn-revamped {
		min-width: 100% !important;
		margin: 0;
	}

	.table-container {
		overflow-x: auto;
		margin: 0 -16px;
		padding: 0 16px;
	}
}

@media (max-width: 480px) {
	.header-content-wrapper {
		flex-direction: column;
		gap: 16px;
		align-items: flex-start;
	}

	.header-close-section {
		align-self: flex-end;
		position: absolute;
		top: 16px;
		right: 16px;
	}

	.header-main-content {
		width: 100%;
		padding-right: 60px;
	}
}

/* ========== REVAMPED FOOTER ACTIONS ========== */
.dialog-actions-container-revamped {
	background-color: var(--pos-card-bg) !important;
	border-top: 1px solid var(--pos-border) !important;
	padding: 24px 32px !important;
	display: flex !important;
	align-items: center !important;
	justify-content: space-between !important;
	gap: 24px !important;
	min-height: 80px !important;
	width: 100% !important;
	visibility: visible !important;
	opacity: 1 !important;
}

.actions-left-section {
	display: flex;
	align-items: center;
	flex: 1;
}

.actions-right-section {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-shrink: 0;
}

/* Sync Button */
.sync-action-btn-revamped {
	background: linear-gradient(135deg, #1976d2 0%, #42a5f5 100%) !important;
	color: white !important;
	border-radius: 14px !important;
	text-transform: none !important;
	font-weight: 600 !important;
	padding: 12px 28px !important;
	min-width: 180px !important;
	height: 48px !important;
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
	box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3) !important;
	letter-spacing: 0.5px;
	font-size: 15px !important;
}

.sync-action-btn-revamped:hover {
	transform: translateY(-3px) scale(1.02) !important;
	box-shadow: 0 8px 25px rgba(25, 118, 210, 0.4) !important;
	background: linear-gradient(135deg, #1565c0 0%, #1976d2 100%) !important;
}

.sync-action-btn-revamped:active {
	transform: translateY(-1px) scale(0.98) !important;
}

/* Close Button - Neutral with Red Text and Icon */
.close-action-btn-revamped {
	background: var(--pos-button-bg) !important;
	color: #f44336 !important;
	border: 2px solid #f44336 !important;
	border-radius: 14px !important;
	text-transform: none !important;
	font-weight: 600 !important;
	padding: 12px 24px !important;
	min-width: 120px !important;
	height: 48px !important;
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
	box-shadow: 0 2px 8px rgba(244, 67, 54, 0.2) !important;
	font-size: 15px !important;
	display: flex !important;
	align-items: center !important;
	justify-content: center !important;
	visibility: visible !important;
	opacity: 1 !important;
}

.close-action-btn-revamped:hover {
	background: rgba(244, 67, 54, 0.05) !important;
	border-color: #d32f2f !important;
	transform: translateY(-2px) !important;
	box-shadow: 0 4px 16px rgba(244, 67, 54, 0.3) !important;
	color: #d32f2f !important;
}

.close-action-btn-revamped:active {
	transform: translateY(0px) !important;
}

/* Force red color for icon and text */
.close-action-btn-revamped .v-icon,
.close-action-btn-revamped span {
	color: #f44336 !important;
}

.close-action-btn-revamped:hover .v-icon,
.close-action-btn-revamped:hover span {
	color: #d32f2f !important;
}

/* Sync Status Indicator */
.sync-status-indicator {
	display: flex;
	align-items: center;
	padding: 12px 20px;
	background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(102, 187, 106, 0.05) 100%);
	border: 1px solid rgba(76, 175, 80, 0.2);
	border-radius: 12px;
	box-shadow: 0 2px 8px rgba(76, 175, 80, 0.15);
}

.sync-status-indicator span {
	font-size: 15px;
	letter-spacing: 0.3px;
}

/* The phone's slim dialog bar over MovilOfflineSurface (movil round 4). */
.offline-movil-card {
	display: flex;
	flex-direction: column;
	min-height: 100%;
	background: var(--pos-surface, #f5f6f8);
}

.offline-movil-card__bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 12px 10px 18px;
	background: var(--pos-surface-raised, #ffffff);
	border-bottom: 1px solid var(--pos-border, #dfe4ea);
}

.offline-movil-card__title {
	font-size: 15px;
	font-weight: 700;
	color: var(--pos-text-primary, #16222a);
}
</style>
