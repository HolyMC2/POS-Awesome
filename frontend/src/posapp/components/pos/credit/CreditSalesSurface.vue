<template>
	<section
		ref="surface"
		class="credit-sales"
		:class="{ 'credit-sales--detail': Boolean(selected), 'credit-sales--compact': isCompact }"
		data-testid="credit-sales-surface"
	>
		<header v-if="!(isCompact && selected)" class="credit-sales__header">
			<div>
				<p v-if="profileName" class="credit-sales__eyebrow">{{ profileName }}</p>
				<h1>{{ __("Credit sales") }}</h1>
				<p class="credit-sales__lead">{{ __("Sales financed by a provider, and the paperwork each one still needs.") }}</p>
			</div>
			<div v-if="enabled" class="credit-sales__actions">
				<button
					type="button"
					class="credit-sales__button"
					:disabled="listLoading"
					data-testid="credit-refresh"
					@click="refresh"
				>
					{{ __("Refresh") }}
				</button>
			</div>
		</header>

		<p v-if="contextLoading" class="credit-sales__empty" role="status">{{ __("Loading credit sales…") }}</p>

		<div v-else-if="contextError" class="credit-sales__notice" role="alert" data-testid="credit-context-error">
			<p>{{ contextError }}</p>
			<button type="button" class="credit-sales__button" @click="loadContext">{{ __("Try again") }}</button>
		</div>

		<div v-else-if="context && !context.enabled" class="credit-sales__off" data-testid="credit-sales-off">
			<v-icon icon="mdi-credit-card-outline" size="40" aria-hidden="true" />
			<h2>{{ __("Credit sales are not available here") }}</h2>
			<p data-testid="credit-sales-off-reason">{{ context.reason || __("Credit sales are turned off for this register.") }}</p>
			<button type="button" class="credit-sales__button" data-testid="credit-sales-close" @click="emit('close')">
				{{ __("Back to sale") }}
			</button>
		</div>

		<div v-else-if="enabled" class="credit-sales__layout">
			<section v-if="showQueue" class="credit-sales__queue" :aria-label="__('Credit sales')">
				<div class="credit-sales__tabs" role="group" :aria-label="__('Credit sales to show')">
					<button
						v-for="tab in tabs"
						:key="tab.id"
						type="button"
						:aria-pressed="status === tab.id ? 'true' : 'false'"
						:data-testid="`credit-tab-${tab.id}`"
						@click="setStatus(tab.id)"
					>
						<span>{{ __(tab.label) }}</span>
						<span class="credit-sales__count reg-mono" :data-testid="`credit-count-${tab.id}`">{{ counts[tab.id] }}</span>
					</button>
				</div>

				<form class="credit-sales__search" role="search" @submit.prevent="applySearch">
					<label class="credit-sales__sr" :for="searchId">{{ __("Search by customer or invoice") }}</label>
					<input
						:id="searchId"
						v-model="search"
						type="search"
						maxlength="120"
						:placeholder="__('Customer or invoice')"
						data-testid="credit-search"
					/>
					<button type="submit" class="credit-sales__button" data-testid="credit-search-submit">{{ __("Search") }}</button>
				</form>

				<div v-if="listError" class="credit-sales__notice" role="alert" data-testid="credit-list-error">
					<p>{{ listError }}</p>
					<button type="button" class="credit-sales__button" @click="loadList()">{{ __("Try again") }}</button>
				</div>
				<p v-else-if="listLoading && !rows.length" class="credit-sales__empty" role="status">
					{{ __("Loading credit sales…") }}
				</p>
				<div v-else-if="!rows.length" class="credit-sales__empty" data-testid="credit-sales-empty">
					<h2>{{ emptyTitle }}</h2>
					<p v-if="status === 'pending' && !appliedSearch">
						{{ __("Every credit sale on this register has its paperwork.") }}
					</p>
					<div class="credit-sales__actions">
						<button v-if="appliedSearch" type="button" class="credit-sales__button" @click="clearSearch">
							{{ __("Clear search") }}
						</button>
						<button
							v-if="status === 'pending'"
							type="button"
							class="credit-sales__button"
							data-testid="credit-view-all"
							@click="setStatus('all')"
						>
							{{ __("View all credit sales") }}
						</button>
					</div>
				</div>
				<ul v-else class="credit-sales__list" :aria-busy="listLoading ? 'true' : 'false'">
					<li v-for="row in rows" :key="row.name">
						<button
							type="button"
							class="credit-sales__row"
							:class="{ 'credit-sales__row--selected': selected === row.name }"
							:aria-pressed="selected === row.name ? 'true' : 'false'"
							:data-credit-sale="row.name"
							@click="select(row.name)"
						>
							<span class="credit-sales__row-top">
								<strong class="credit-sales__customer">{{ row.customer_name }}</strong>
								<span class="credit-sales__down">
									<small>{{ __("Down payment") }}</small>
									<span class="reg-mono">{{ money(row.enganche, row) }}</span>
								</span>
							</span>
							<span class="credit-sales__row-meta">
								{{ [formatDate(row.posting_date), row.credit_provider, row.name].filter(Boolean).join(" · ") }}
							</span>
							<span class="credit-sales__badges">
								<CreditChip :tone="Number(row.missing) > 0 ? 'warning' : 'positive'" data-testid="credit-row-documents">
									{{ __("Documents {0}", [row.documents]) }}
								</CreditChip>
								<CreditChip :tone="complianceDisplay(row.compliance).tone">
									{{ __(complianceDisplay(row.compliance).label) }}
								</CreditChip>
								<span v-if="row.owner_name" class="credit-sales__seller">{{ __("Sold by {0}", [row.owner_name]) }}</span>
							</span>
						</button>
					</li>
				</ul>
				<p v-if="rows.length >= LIST_LIMIT" class="credit-sales__hint">
					{{ __("Showing the latest {0}. Search to find an older sale.", [LIST_LIMIT]) }}
				</p>
			</section>

			<section v-if="showDetail" class="credit-sales__detail" :aria-label="__('Credit sale')">
				<div v-if="selected" class="credit-sales__detail-toolbar">
					<button
						ref="backButton"
						type="button"
						class="credit-sales__button"
						data-testid="credit-back"
						@click="backToList"
					>
						← {{ __("Back to credit sales") }}
					</button>
				</div>
				<div v-if="!selected" class="credit-sales__welcome">
					<v-icon icon="mdi-file-document-multiple-outline" size="40" aria-hidden="true" />
					<h2>{{ __("Choose a credit sale") }}</h2>
					<p>{{ __("See its documents, expenses and plan, and attach what is still missing.") }}</p>
				</div>
				<CreditSaleDetail
					v-else
					:key="`${selected}:${detailVersion}`"
					:invoice="selected"
					mode="queue"
					@changed="onChanged"
					@close="backToList"
					@print="printTicket"
				/>
			</section>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * «Credit sales» as a rail destination: the pending-paperwork queue, then one
 * sale's detail beside it (below 1100 px, the detail is a step of its own
 * with a way back to the same place in the list).
 *
 * The queue is the register's own: `list_credit_sales` is asked for this POS
 * Profile's sales. Whether credit sales exist here at all is the server's
 * answer (`get_context`), and when they do not, its reason is shown rather
 * than an empty list.
 *
 * The band carries no money here: the one honest action is going back to the
 * sale, so the published state is a caption and «Back to sale».
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { storeToRefs } from "pinia";

import CreditChip from "./CreditChip.vue";
import CreditSaleDetail from "./CreditSaleDetail.vue";
import {
	listCreditSales,
	loadCreditContext,
	type CreditContext,
	type CreditListStatus,
	type CreditSaleRow,
} from "./creditApi";
import { complianceDisplay, describeError, formatDate, formatMoney, translate as __ } from "./creditFormat";
import type { BandState } from "../../../composables/pos/shell/bandState";
import { useResponsive } from "../../../composables/core/useResponsive";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";
import { printInvoiceByName } from "../../../utils/printInvoiceByName";

const props = withDefaults(
	defineProps<{
		/** Open this sale's detail on arrival (e.g. from the invoice ledger). */
		focusInvoice?: string | null;
	}>(),
	{ focusInvoice: null },
);

const emit = defineEmits<{
	band: [BandState | null];
	close: [];
}>();

/**
 * The host relays only `close`, `band` and `update:selected-detail`, so the
 * surface prints itself — through the register's print path, which picks the
 * provider's down-payment ticket for a financed sale.
 */
const printTicket = (invoice: string) => {
	if (!invoice) return;
	printInvoiceByName(useUIStore().posProfile, "Sales Invoice", invoice).catch((error) => {
		console.error("The credit sale ticket could not be printed", error);
		useToastStore().show({ title: __("Unable to print submitted invoice"), color: "error" });
	});
};

const LIST_LIMIT = 50;

const BAND: BandState = {
	kind: "hostedContext",
	tone: "neutral",
	value: 0,
	labelKey: "Credit sales",
	primaryAction: { id: "sale.return", labelKey: "Back to sale" },
	primaryEnabled: true,
};

const tabs: { id: CreditListStatus; label: string }[] = [
	{ id: "pending", label: "Pending" },
	{ id: "all", label: "All" },
];

const searchId = `credit-search-${useId()}`;
const { posProfile } = storeToRefs(useUIStore());
const { isCompact } = useResponsive();
const profileName = computed(() => String(posProfile.value?.name || ""));

// Only navigation is kept for this browser session; sales are always re-read.
const user = (window as any).frappe?.session?.user;
const navigationKey =
	user && user !== "Guest" ? `posa:credit-sales:navigation:${user}:${profileName.value}` : null;

interface SavedNavigation {
	status?: CreditListStatus;
	search?: string;
	selected?: string;
	scrollTop?: number;
}

function readNavigation(): SavedNavigation {
	try {
		const value = navigationKey ? JSON.parse(sessionStorage.getItem(navigationKey) || "null") : null;
		if (!value || !["pending", "all"].includes(value.status)) return {};
		return {
			status: value.status,
			search: String(value.search || "").slice(0, 120),
			selected: String(value.selected || "").slice(0, 140),
			scrollTop: Math.max(0, Number(value.scrollTop) || 0),
		};
	} catch {
		return {};
	}
}

const saved = readNavigation();
const context = ref<CreditContext | null>(null);
const contextLoading = ref(false);
const contextError = ref("");
const status = ref<CreditListStatus>(saved.status || "pending");
const search = ref(saved.search || "");
const appliedSearch = ref(search.value.trim());
const rows = ref<CreditSaleRow[]>([]);
const counts = ref<Record<CreditListStatus, number>>({ pending: 0, all: 0 });
const listLoading = ref(false);
const listError = ref("");
const selected = ref(props.focusInvoice || saved.selected || "");
const detailVersion = ref(0);
const surface = ref<HTMLElement | null>(null);
const backButton = ref<HTMLButtonElement | null>(null);
let queueScrollTop = saved.scrollTop || 0;
let listRequest = 0;
let disposed = false;

const enabled = computed(() => Boolean(context.value?.enabled));
const showQueue = computed(() => !isCompact.value || !selected.value);
const showDetail = computed(() => !isCompact.value || Boolean(selected.value));
const scrollHost = () => surface.value?.closest<HTMLElement>(".destination-host") ?? null;

const money = (value: unknown, row: CreditSaleRow) =>
	formatMoney(value, row.currency || posProfile.value?.currency || "");

const emptyTitle = computed(() => {
	if (appliedSearch.value) return __("No credit sales match “{0}”", [appliedSearch.value]);
	return status.value === "pending" ? __("No paperwork pending") : __("No credit sales yet");
});

async function loadList({ quiet = false } = {}) {
	if (!profileName.value) return;
	const request = ++listRequest;
	listLoading.value = true;
	listError.value = "";
	if (!quiet) rows.value = [];
	appliedSearch.value = search.value.trim();
	try {
		const result = await listCreditSales({
			posProfile: profileName.value,
			status: status.value,
			search: appliedSearch.value,
			limit: LIST_LIMIT,
		});
		if (disposed || request !== listRequest) return;
		rows.value = Array.isArray(result?.rows) ? result.rows : [];
		counts.value = {
			pending: Number(result?.counts?.pending) || 0,
			all: Number(result?.counts?.all) || 0,
		};
	} catch (error) {
		if (disposed || request !== listRequest) return;
		listError.value = describeError(error, __("Credit sales could not be loaded. Check the connection and try again."));
	} finally {
		if (!disposed && request === listRequest) listLoading.value = false;
	}
}

async function loadContext() {
	if (!profileName.value) {
		contextError.value = __("Open a register to see its credit sales.");
		return;
	}
	contextLoading.value = true;
	contextError.value = "";
	try {
		context.value = await loadCreditContext(profileName.value, { force: true });
	} catch (error) {
		if (!disposed) {
			contextError.value = describeError(error, __("Credit sales could not be opened. Check the connection and try again."));
		}
		return;
	} finally {
		if (!disposed) contextLoading.value = false;
	}
	if (disposed) return;
	if (context.value?.enabled) {
		await loadList();
		await nextTick();
		const host = scrollHost();
		if (host && !selected.value) host.scrollTop = queueScrollTop;
	} else {
		selected.value = "";
	}
}

async function select(name: string, focus = true) {
	if (!selected.value) queueScrollTop = scrollHost()?.scrollTop || 0;
	selected.value = name;
	if (!focus) return;
	await nextTick();
	const host = scrollHost();
	if (host) host.scrollTop = 0;
	backButton.value?.focus({ preventScroll: true });
}

function backToList() {
	const previous = selected.value;
	selected.value = "";
	void nextTick(() => {
		const host = scrollHost();
		if (host) host.scrollTop = queueScrollTop;
		const row = Array.from(surface.value?.querySelectorAll<HTMLButtonElement>("[data-credit-sale]") ?? []).find(
			(element) => element.dataset.creditSale === previous,
		);
		row?.focus({ preventScroll: true });
	});
}

function setStatus(value: CreditListStatus) {
	if (status.value === value && !listError.value) return;
	status.value = value;
	queueScrollTop = 0;
	void loadList();
}

function applySearch() {
	queueScrollTop = 0;
	void loadList();
}

function clearSearch() {
	search.value = "";
	applySearch();
}

function refresh() {
	void loadList({ quiet: true });
	if (selected.value) detailVersion.value += 1;
}

/** A write in the detail can move the sale between the tabs: re-read the list, keep the place. */
function onChanged() {
	void loadList({ quiet: true });
}

watch(
	() => props.focusInvoice,
	(name, previous) => {
		if (name && name !== previous) void select(name, false);
	},
);

onMounted(() => {
	emit("band", BAND);
	void loadContext();
});

onBeforeUnmount(() => {
	disposed = true;
	++listRequest;
	emit("band", null);
	try {
		if (navigationKey) {
			sessionStorage.setItem(
				navigationKey,
				JSON.stringify({
					status: status.value,
					search: appliedSearch.value,
					selected: selected.value,
					scrollTop: selected.value ? queueScrollTop : scrollHost()?.scrollTop || 0,
				}),
			);
		}
	} catch {
		/* Navigation still works when browser storage is unavailable. */
	}
});
</script>

<style scoped>
.credit-sales {
	width: 100%;
	min-width: 0;
	max-width: 1480px;
	margin: 0 auto;
	padding: clamp(12px, 2vw, 28px);
	color: var(--reg-text-primary);
	font-size: 14px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.credit-sales :is(h1, h2, p, ul) {
	margin: 0;
}

.credit-sales h1 {
	font-size: clamp(22px, 2.4vw, 30px);
	letter-spacing: -0.025em;
	line-height: 1.2;
}

.credit-sales h2 {
	font-size: 18px;
	line-height: 1.3;
}

.credit-sales__eyebrow {
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted);
}

.credit-sales__lead,
.credit-sales__hint {
	color: var(--reg-text-secondary);
}

.credit-sales__hint {
	margin-top: var(--reg-space-md);
	font-size: 12.5px;
}

.credit-sales__header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-lg);
	margin-bottom: var(--reg-space-xl);
}

.credit-sales__actions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm);
}

.credit-sales__button,
.credit-sales__tabs button,
.credit-sales__search input {
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
}

.credit-sales__button,
.credit-sales__tabs button {
	cursor: pointer;
	font-weight: 600;
	transition: transform var(--motion-fast) var(--ease-out);
}

.credit-sales__button:active:not(:disabled),
.credit-sales__row:active {
	transform: scale(var(--press-scale));
}

.credit-sales__button:disabled {
	opacity: 0.55;
	cursor: default;
}

.credit-sales :is(button, input):focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}

.credit-sales__notice {
	display: grid;
	gap: var(--reg-space-sm);
	justify-items: start;
	padding: var(--reg-space-lg);
	border: 1px solid var(--reg-tone-warning-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-tone-warning-bg);
	color: var(--reg-tone-warning-label);
}

.credit-sales__notice .credit-sales__button {
	color: var(--reg-text-primary);
}

.credit-sales__empty {
	display: grid;
	gap: var(--reg-space-md);
	justify-items: start;
	padding: var(--reg-space-xl) var(--reg-space-md);
	color: var(--reg-text-secondary);
}

.credit-sales__empty h2 {
	color: var(--reg-text-primary);
}

.credit-sales__off,
.credit-sales__welcome {
	display: grid;
	gap: var(--reg-space-md);
	justify-items: center;
	padding: 48px var(--reg-space-xl);
	text-align: center;
	color: var(--reg-text-secondary);
}

.credit-sales__off h2,
.credit-sales__welcome h2 {
	color: var(--reg-text-primary);
}

.credit-sales__off p,
.credit-sales__welcome p {
	max-width: 46ch;
}

.credit-sales__layout {
	display: grid;
	grid-template-columns: minmax(300px, 0.85fr) minmax(0, 1.4fr);
	gap: var(--reg-space-xl);
	align-items: start;
}

.credit-sales__queue,
.credit-sales__detail {
	min-width: 0;
}

.credit-sales__tabs {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--reg-space-xs);
	padding: var(--reg-space-xs);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-muted);
}

.credit-sales__tabs button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-sm);
	border-color: transparent;
	background: transparent;
	color: var(--reg-text-secondary);
}

.credit-sales__tabs button[aria-pressed="true"] {
	border-color: var(--reg-border);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
}

.credit-sales__count {
	min-width: 24px;
	padding: 0 7px;
	border-radius: 999px;
	background: var(--reg-surface-sunken);
	font-size: 12px;
	line-height: 20px;
}

.credit-sales__search {
	display: flex;
	gap: var(--reg-space-sm);
	margin: var(--reg-space-md) 0;
}

.credit-sales__search input {
	flex: 1 1 auto;
	min-width: 0;
	width: 100%;
}

.credit-sales__search .credit-sales__button {
	flex: none;
	white-space: nowrap;
}

.credit-sales__list {
	list-style: none;
	padding: 0;
	display: grid;
	gap: var(--reg-space-sm);
}

.credit-sales__row {
	display: grid;
	gap: var(--reg-space-xs);
	width: 100%;
	padding: var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface);
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
	transition: transform var(--motion-fast) var(--ease-out);
}

.credit-sales__row--selected {
	border-color: var(--reg-accent-edge);
	box-shadow: inset 3px 0 var(--reg-accent-edge);
	background: var(--reg-surface-sunken);
}

.credit-sales__row-top {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md);
}

.credit-sales__customer {
	min-width: 0;
	font-size: 16px;
}

.credit-sales__down {
	display: grid;
	flex: none;
	justify-items: end;
	font-weight: 700;
}

.credit-sales__down small {
	font-size: 11px;
	font-weight: 600;
	color: var(--reg-text-muted);
}

.credit-sales__row-meta {
	font-size: 12.5px;
	color: var(--reg-text-secondary);
}

.credit-sales__badges {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm);
	margin-top: var(--reg-space-2xs);
}

.credit-sales__seller {
	font-size: 12px;
	color: var(--reg-text-muted);
}

.credit-sales__detail-toolbar {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-sm);
	margin-bottom: var(--reg-space-lg);
}

.credit-sales__sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

@media (max-width: 1099.98px) {
	.credit-sales__layout {
		display: block;
	}
	.credit-sales__header .credit-sales__actions {
		width: 100%;
	}
	.credit-sales__header .credit-sales__actions .credit-sales__button {
		flex: 1;
	}
}

@media (prefers-reduced-motion: reduce) {
	.credit-sales__button,
	.credit-sales__tabs button,
	.credit-sales__row {
		transition: none;
	}
}
</style>
