<template>
	<section class="cotizaciones" data-testid="cotizaciones-surface">
		<v-alert
			v-if="errorMessage"
			type="error"
			variant="tonal"
			density="compact"
			class="cotizaciones__error"
			data-testid="cotizaciones-error"
		>
			{{ errorMessage }}
		</v-alert>

		<div class="cotizaciones__body">
			<div class="cotizaciones__list" data-testid="cotizaciones-list">
				<div class="cotizaciones__tabs" role="tablist">
					<button
						v-for="tab in tabs"
						:key="tab.id"
						type="button"
						role="tab"
						class="cotizaciones__tab"
						:class="{ 'cotizaciones__tab--on': tab.active }"
						:aria-selected="tab.active"
						:data-testid="`cotizaciones-tab-${tab.id}`"
						@click="chooseTab(tab.id)"
					>
						{{ __(tab.label) }}
						<span class="mono cotizaciones__tab-count">{{ tab.count }}</span>
					</button>
					<div class="cotizaciones__tabs-spacer"></div>
					<input
						ref="searchRef"
						v-model="query"
						class="cotizaciones__search"
						type="search"
						:placeholder="__('Folio or customer…')"
						:aria-label="__('Folio or customer…')"
						data-testid="cotizaciones-search"
					/>
				</div>

				<div
					class="cotizaciones__table"
					tabindex="0"
					role="listbox"
					:aria-label="__('Quotations')"
					@keydown="onKeydown"
				>
					<div class="cotizaciones__row cotizaciones__row--head">
						<span>{{ __("Folio") }}</span>
						<span>{{ __("Customer") }}</span>
						<span>{{ __("Date") }}</span>
						<span>{{ __("Due") }}</span>
						<span class="cotizaciones__cell--right">{{ __("Total") }}</span>
						<span>{{ __("Status") }}</span>
					</div>

					<div v-if="loading" class="cotizaciones__empty">{{ __("Loading quotations…") }}</div>
					<div
						v-else-if="!visibleRows.length"
						class="cotizaciones__empty"
						data-testid="cotizaciones-empty"
					>
						{{ __("No quotations in this list.") }}
					</div>

					<button
						v-for="(row, index) in visibleRows"
						:key="row.name"
						type="button"
						role="option"
						class="cotizaciones__row cotizaciones__row--item"
						:class="{ 'cotizaciones__row--sel': row.name === selectedName }"
						:aria-selected="row.name === selectedName"
						:data-testid="`cotizacion-row-${row.name}`"
						@click="select(index)"
					>
						<span class="mono cotizaciones__folio">{{ row.name }}</span>
						<span class="cotizaciones__customer">{{ row.customer_name || row.customer }}</span>
						<span class="mono cotizaciones__muted">{{ row.date }}</span>
						<span class="mono" :data-tone="dueTone(row)">{{ dueText(row) }}</span>
						<span class="mono cotizaciones__cell--right cotizaciones__total">
							{{ formatCurrency(row.total) }}
						</span>
						<span>
							<span class="cotizaciones__chip" :data-tone="toneFor(row)">
								{{ estadoText(row) }}
							</span>
						</span>
					</button>

					<div class="cotizaciones__hint">
						{{ __("↑↓ moves · Enter opens · the quoted price holds while the quotation is valid") }}
					</div>
				</div>
			</div>

			<QuotationDetail
				:row="selectedRow"
				:lines="detailLines"
				:loading-lines="loadingDetail"
				:loading="loadingCart"
				:offline="offline"
				:expired="detailExpired"
				:quoted-total="detailQuotedTotal"
				:today-total="detailTodayTotal"
				:format-currency="formatCurrency"
				@load="loadIntoSale"
				@print="printQuotation"
				@open-invoice="openInvoice"
				@extend="announceExtendStub"
			/>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Cotizaciones as a rail DESTINATION (artboard `Cotizacion.dc.html`).
 *
 * A view, not a hosted dialog — the same choice `OrdenSurface.vue` records:
 * `useHostedSheet` exists to make a MODAL behave as a surface, and this has no
 * modal and no store flag, so it renders straight into `DestinationHost`.
 *
 * THE MONEY PATH IS THE SERVER'S. `loadIntoSale` calls
 * `load_quotation_for_sale`, which decides whether the quoted rates still hold
 * and INSERTS the draft invoice itself, stamped with `posa_quotation`. This
 * component hands that draft to the cart through the same `triggerLoadInvoice`
 * every other pull-model surface uses, and computes no price of its own — the
 * provenance line and the expiry warning are both rendered from what the server
 * sent, so the panel and the cart cannot disagree about which lines moved.
 *
 * Online-only. `get_quotations` and the load both need the server, so the
 * registry marks the destination `online_required` and the rail dims it; this
 * component's `offline` prop is the second half of that promise — the primary
 * action stays disabled even if the surface is somehow reached.
 */
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import QuotationDetail from "./QuotationDetail.vue";
import {
	describeDue,
	describeTabs,
	emptyCounts,
	getQuotationTab,
	matchesQuery,
	nextIndex,
	type QuotationCounts,
	type QuotationEstado,
	type QuotationLine,
	type QuotationRow,
} from "./quotationModel";
import { useFormat } from "../../../../format";
import { useOnlineStatus } from "../../../../composables/core/useOnlineStatus";
import {
	fetchQuotations,
	isRefusedQuotation,
	loadQuotationForSale,
} from "../../../../services/quotationService";
import { useInvoiceStore } from "../../../../stores/invoiceStore";
import { useToastStore } from "../../../../stores/toastStore";
import { useUIStore } from "../../../../stores/uiStore";
import { printInvoiceByName } from "../../../../utils/printInvoiceByName";

const emit = defineEmits<{ close: [] }>();

const __ = (window as Record<string, any>).__ || ((value: string, args?: any[]) => {
	if (!args?.length) return value;
	return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value);
});

const uiStore = useUIStore();
const toastStore = useToastStore();
const invoiceStore = useInvoiceStore();
const { posProfile } = storeToRefs(uiStore);
const { formatCurrency } = useFormat();
const { isOnline } = useOnlineStatus();

const searchRef = ref<HTMLInputElement | null>(null);

const bucket = ref<QuotationEstado>("active");
const query = ref("");
const rows = ref<QuotationRow[]>([]);
const counts = ref<QuotationCounts>(emptyCounts());
const selectedName = ref<string | null>(null);
const detailLines = ref<QuotationLine[]>([]);
const detailExpired = ref(false);
const detailQuotedTotal = ref(0);
const detailTodayTotal = ref(0);
const loading = ref(false);
const loadingDetail = ref(false);
const loadingCart = ref(false);
const errorMessage = ref("");

const profileName = computed(() => posProfile.value?.name ?? null);
const offline = computed(() => !isOnline.value);
const tabs = computed(() => describeTabs(counts.value, bucket.value));
const visibleRows = computed(() => rows.value.filter((row) => matchesQuery(row, query.value)));
const selectedRow = computed(
	() => visibleRows.value.find((row) => row.name === selectedName.value) ?? null,
);

const toneFor = (row: QuotationRow) => getQuotationTab(row.estado).tone;
const estadoText = (row: QuotationRow) => {
	const label = __(getQuotationTab(row.estado).label);
	return row.converted_invoice ? `${label} · ${row.converted_invoice}` : label;
};

const dueTone = (row: QuotationRow) => describeDue(row)?.tone ?? "muted";
const dueText = (row: QuotationRow) => {
	const due = describeDue(row);
	if (!due) {
		// «—», the artboard's cell for a quotation with no validity date and for
		// one that is already sold: neither has a countdown worth printing.
		return row.valid_till && row.estado === "converted" ? row.valid_till : "—";
	}
	return due.count === null ? __(due.key) : __(due.key, [due.count]);
};

const reportFailure = (error: unknown, fallback: string) => {
	const failure = error as { serverMessage?: string; message?: string } | null;
	errorMessage.value = failure?.serverMessage || failure?.message || fallback;
};

const clearDetail = () => {
	detailLines.value = [];
	detailExpired.value = false;
	detailQuotedTotal.value = 0;
	detailTodayTotal.value = 0;
};

async function load() {
	const profile = profileName.value;
	if (!profile) return;
	loading.value = true;
	try {
		const payload = await fetchQuotations(profile, { bucket: bucket.value });
		rows.value = Array.isArray(payload?.rows) ? payload.rows : [];
		counts.value = payload?.counts ?? emptyCounts();
		errorMessage.value = "";
		// The previous selection may not be in this bucket; dropping it is
		// honest, keeping it would show a detail panel for a row nobody can see.
		if (!rows.value.some((row) => row.name === selectedName.value)) {
			selectedName.value = null;
			clearDetail();
		}
	} catch (error) {
		rows.value = [];
		counts.value = emptyCounts();
		reportFailure(error, __("Could not load the quotations."));
	} finally {
		loading.value = false;
	}
}

/**
 * Open a quotation: this is the SAME call as «Cargar a la venta».
 *
 * `load_quotation_for_sale` is what knows the lines, the provenance and the
 * repricing, and it mints (or re-adopts) one draft per quotation per shift — so
 * asking twice does not stack invoices. Reading the detail through it is what
 * guarantees the panel shows exactly the prices the cart is about to get.
 */
async function openDetail(name: string) {
	const profile = profileName.value;
	if (!profile) return;
	loadingDetail.value = true;
	clearDetail();
	try {
		const result = await loadQuotationForSale(profile, name);
		if (selectedName.value !== name) return;
		if (isRefusedQuotation(result)) {
			// Not an error: the row already says Convertida and the detail panel
			// renders the link. Nothing to warn about twice.
			return;
		}
		detailLines.value = result.lines ?? [];
		detailExpired.value = Boolean(result.expired);
		detailQuotedTotal.value = Number(result.quoted_total) || 0;
		detailTodayTotal.value = Number(result.today_total) || 0;
	} catch (error) {
		if (selectedName.value === name) {
			reportFailure(error, __("Could not open this quotation."));
		}
	} finally {
		loadingDetail.value = false;
	}
}

const select = (index: number) => {
	const row = visibleRows.value[index];
	if (!row) return;
	selectedName.value = row.name;
	if (row.converted_invoice) {
		clearDetail();
		return;
	}
	void openDetail(row.name);
};

const chooseTab = (id: QuotationEstado) => {
	if (id === bucket.value) return;
	bucket.value = id;
	selectedName.value = null;
	clearDetail();
	void load();
};

const onKeydown = (event: KeyboardEvent) => {
	if (event.key === "Enter") {
		event.preventDefault();
		const row = selectedRow.value;
		if (row) void loadIntoSale(row);
		return;
	}
	const current = visibleRows.value.findIndex((row) => row.name === selectedName.value);
	const next = nextIndex(event.key, current, visibleRows.value.length);
	if (next === null) return;
	event.preventDefault();
	select(next);
};

/**
 * «CARGAR A LA VENTA».
 *
 * The draft already exists — `openDetail` minted it when the row was chosen —
 * but the call is made again rather than cached: between choosing the row and
 * pressing the button, another cashier may have billed the quotation, and the
 * server is the only thing that knows. Re-asking is one round trip; billing a
 * quotation twice is a phone call with the customer.
 */
async function loadIntoSale(row: QuotationRow) {
	const profile = profileName.value;
	if (!profile || loadingCart.value) return;
	loadingCart.value = true;
	errorMessage.value = "";
	try {
		const result = await loadQuotationForSale(profile, row.name);
		if (isRefusedQuotation(result)) {
			toastStore.show({
				title: __("Already sold"),
				message: __("Quotation {0} was billed on {1}.", [row.name, result.invoice]),
				color: "warning",
			});
			await load();
			return;
		}
		invoiceStore.triggerLoadInvoice(result.invoice_doc);
		toastStore.show({
			title: __("Quotation loaded"),
			message: result.expired
				? __("Priced at today's rates — the quotation had expired.")
				: __("Quoted prices kept; charge it like any sale."),
			color: result.expired ? "warning" : "info",
		});
		emit("close");
	} catch (error) {
		reportFailure(error, __("Could not load this quotation into the sale."));
	} finally {
		loadingCart.value = false;
	}
}

async function printQuotation(row: QuotationRow) {
	try {
		await printInvoiceByName(posProfile.value, "Quotation", row.name);
	} catch (error) {
		reportFailure(error, __("Could not print this quotation."));
	}
}

const openInvoice = (row: QuotationRow) => {
	if (!row.converted_invoice) return;
	const base = (window as any).frappe?.urllib?.get_base_url?.() ?? "";
	const doctype = row.converted_invoice_doctype || "Sales Invoice";
	window.open(
		`${base}/app/${doctype.toLowerCase().replace(/\s+/g, "-")}/${encodeURIComponent(row.converted_invoice)}`,
		"_blank",
		"noopener",
	);
};

const announceExtendStub = () => {
	toastStore.show({
		title: __("Not built yet"),
		message: __("Extending a quotation's validity is not built yet — save a new one instead."),
		color: "info",
	});
};

watch(profileName, () => {
	selectedName.value = null;
	clearDetail();
	void load();
});

onMounted(() => {
	void load();
	searchRef.value?.focus?.();
});
</script>

<style scoped>
.cotizaciones {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	flex: 1 1 auto;
	min-height: 0;
	padding: 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.cotizaciones__error {
	flex: none;
}

.cotizaciones__body {
	display: flex;
	gap: var(--reg-space-lg, 14px);
	flex: 1 1 auto;
	min-height: 0;
}

.cotizaciones__list {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	padding: 14px 0 6px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.cotizaciones__tabs {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 14px 12px;
}

.cotizaciones__tab {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	height: 40px;
	padding: 0 16px;
	border-radius: 11px;
	border: 1px solid var(--reg-border, #e6e9ee);
	background: var(--reg-surface, #fff);
	font: inherit;
	font-size: 13px;
	font-weight: 500;
	color: var(--pos-text-secondary, #56606e);
	cursor: pointer;
}

.cotizaciones__tab--on {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent-edge, #9fdde6);
	color: var(--reg-accent-ink, #00646f);
	font-weight: 700;
}

.cotizaciones__tab-count {
	opacity: 0.7;
}

.cotizaciones__tabs-spacer {
	flex: 1;
}

.cotizaciones__search {
	height: 34px;
	min-width: 190px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid var(--reg-border, #e6e9ee);
	background: var(--reg-surface-sunken, #f2f4f7);
	font: inherit;
	font-size: 12.5px;
	color: var(--pos-text-primary, #212121);
}

.cotizaciones__table {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	outline: none;
}

.cotizaciones__row {
	display: grid;
	grid-template-columns: 15% 25% 12% 16% 16% 16%;
	gap: 12px;
	padding: 10px 14px;
	align-items: baseline;
	border-bottom: 1px solid var(--reg-border-light, #f5f7f9);
	font-size: 12.5px;
	color: var(--pos-text-secondary, #4a5260);
	text-align: left;
}

/* Percentages only, no `max()`: this grid is fixed-layout and a `max()` track
   is silently dropped, which collapses every column to equal width. */

.cotizaciones__row--head {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--pos-text-secondary, #8b93a0);
	border-bottom: 1px solid var(--reg-border, #eceff3);
}

.cotizaciones__row--item {
	width: 100%;
	background: none;
	border-left: 3px solid transparent;
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}

.cotizaciones__row--sel {
	background: var(--reg-accent-soft, #e0f7fa);
	border-left-color: var(--reg-accent, #0097a7);
}

.cotizaciones__folio {
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cotizaciones__customer {
	font-weight: 500;
	color: var(--pos-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cotizaciones__muted {
	color: var(--pos-text-secondary, #9aa2ae);
}

.cotizaciones__total {
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cotizaciones__cell--right {
	text-align: right;
}

.cotizaciones__chip {
	display: inline-flex;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 700;
}

.cotizaciones__chip[data-tone="good"],
[data-tone="good"] {
	color: var(--reg-good-ink, #14603a);
}

.cotizaciones__chip[data-tone="good"] {
	background: var(--reg-good-soft, #e8f5e8);
}

.cotizaciones__chip[data-tone="warn"],
[data-tone="warn"] {
	color: var(--reg-warn-ink, #a15200);
}

.cotizaciones__chip[data-tone="warn"] {
	background: var(--reg-warn-soft, #fff3e0);
}

.cotizaciones__chip[data-tone="bad"],
[data-tone="bad"] {
	color: var(--reg-bad-ink, #b42318);
}

.cotizaciones__chip[data-tone="bad"] {
	background: var(--reg-bad-soft, #fdeaea);
}

.cotizaciones__chip[data-tone="muted"],
[data-tone="muted"] {
	color: var(--reg-muted-ink, #667085);
}

.cotizaciones__chip[data-tone="muted"] {
	background: var(--reg-muted-soft, #f2f4f7);
}

.cotizaciones__empty {
	padding: 24px 14px;
	font-size: 12.5px;
	color: var(--pos-text-secondary, #9aa2ae);
	text-align: center;
}

.cotizaciones__hint {
	margin-top: auto;
	padding: 10px 14px;
	border-top: 1px dashed var(--reg-border, #e6e9ee);
	font-size: 11.5px;
	color: var(--pos-text-secondary, #9aa2ae);
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}

/* Below the artboard's width the list stops being a column and becomes the
   top half — the same boundary the ledger and orden surfaces use. */
@media (max-width: 1180px) {
	.cotizaciones__body {
		flex-direction: column;
	}

	.cotizaciones__list {
		max-height: 50%;
	}
}
</style>
