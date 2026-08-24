<template>
	<section class="cobranza" data-testid="cobranza-surface">
		<!-- CAPTURE. The same PayView the Payments destination has always been,
		     mounted here rather than navigated to — see the header. -->
		<template v-if="step === 'capture'">
			<header class="cobranza__capture-bar">
				<v-btn
					variant="tonal"
					size="small"
					data-testid="cobranza-back"
					@click="backToWorklist"
				>
					{{ __("Back to the list") }}
				</v-btn>
				<div class="cobranza__capture-target" data-testid="cobranza-capture-target">
					<span class="mono">{{ captureTarget?.invoiceName }}</span>
					<span v-if="captureTarget?.customerName"> · {{ captureTarget.customerName }}</span>
				</div>
			</header>
			<PayView class="cobranza__capture" />
		</template>

		<template v-else>
			<v-alert
				v-if="errorMessage"
				type="error"
				variant="tonal"
				density="compact"
				class="cobranza__error"
				data-testid="cobranza-error"
			>
				{{ errorMessage }}
			</v-alert>

			<div class="cobranza__stats" data-testid="cobranza-stats">
				<div class="cobranza__stat">
					<div class="cobranza__stat-label">{{ __("To collect") }}</div>
					<div class="mono cobranza__stat-value">{{ formatCurrency(totals.outstanding) }}</div>
					<div class="cobranza__stat-note">
						{{ __("{0} invoices", [totals.outstanding_count]) }}
					</div>
				</div>
				<div class="cobranza__stat cobranza__stat--bad" data-testid="cobranza-stat-overdue">
					<div class="cobranza__stat-label">{{ __("Overdue") }}</div>
					<div class="mono cobranza__stat-value">{{ formatCurrency(totals.overdue) }}</div>
					<div class="cobranza__stat-note">
						{{ __("{0} invoices", [totals.overdue_count]) }}
						<!-- `null`, not `0`: nothing overdue prints no age at all. -->
						<template v-if="totals.oldest_overdue_days !== null">
							· {{ __("oldest {0} days", [totals.oldest_overdue_days]) }}
						</template>
					</div>
				</div>
				<div class="cobranza__stat">
					<div class="cobranza__stat-label">{{ __("Collected today") }}</div>
					<div class="mono cobranza__stat-value cobranza__stat-value--good">
						{{ formatCurrency(collectedTotal) }}
					</div>
					<div class="cobranza__stat-note">{{ __("{0} payments", [collectedCount]) }}</div>
				</div>
			</div>

			<div class="cobranza__body">
				<div class="cobranza__list" data-testid="cobranza-list">
					<div class="cobranza__tabs" role="tablist">
						<button
							v-for="tab in tabs"
							:key="tab.id"
							type="button"
							role="tab"
							class="cobranza__tab"
							:class="{ 'cobranza__tab--on': tab.active }"
							:aria-selected="tab.active"
							:data-testid="`cobranza-tab-${tab.id}`"
							@click="chooseTab(tab.id)"
						>
							{{ __(tab.label) }}
							<span class="mono cobranza__tab-count">{{ tab.count }}</span>
						</button>
						<div class="cobranza__tabs-spacer"></div>
						<input
							ref="searchRef"
							v-model="query"
							class="cobranza__search"
							type="search"
							:placeholder="__('Folio or customer…')"
							:aria-label="__('Folio or customer…')"
							data-testid="cobranza-search"
						/>
					</div>

					<div
						class="cobranza__table"
						tabindex="0"
						role="listbox"
						:aria-label="__('Receivables')"
						@keydown="onKeydown"
					>
						<!-- «Cobrado hoy» is a different document, so it is a different
						     header. Reusing the invoice columns would print an empty
						     «Pendiente» beside every payment. -->
						<div v-if="isCollectedTab" class="cobranza__row cobranza__row--paid cobranza__row--head">
							<span>{{ __("Folio") }}</span>
							<span>{{ __("Customer") }}</span>
							<span>{{ __("Mode") }}</span>
							<span>{{ __("Reference") }}</span>
							<span class="cobranza__cell--right">{{ __("Total") }}</span>
						</div>
						<div v-else class="cobranza__row cobranza__row--head">
							<span>{{ __("Folio") }}</span>
							<span>{{ __("Customer") }}</span>
							<span>{{ __("Due") }}</span>
							<span class="cobranza__cell--right">{{ __("Total") }}</span>
							<span class="cobranza__cell--right">{{ __("Pending") }}</span>
							<span>{{ __("Status") }}</span>
						</div>

						<div v-if="loading" class="cobranza__empty">{{ __("Loading…") }}</div>
						<div
							v-else-if="!visibleCount"
							class="cobranza__empty"
							data-testid="cobranza-empty"
						>
							{{ __(emptyState) }}
						</div>

						<template v-else-if="isCollectedTab">
							<div
								v-for="payment in visibleCollected"
								:key="payment.name"
								class="cobranza__row cobranza__row--paid"
								:data-testid="`cobranza-collected-${payment.name}`"
							>
								<span class="mono cobranza__folio">{{ payment.name }}</span>
								<span class="cobranza__customer">{{ payment.party_name || payment.party }}</span>
								<span>{{ payment.mode_of_payment || "—" }}</span>
								<span class="cobranza__muted">{{ payment.reference_no || "—" }}</span>
								<span class="mono cobranza__cell--right cobranza__amount">
									{{ formatCurrency(payment.amount) }}
								</span>
							</div>
						</template>

						<template v-else>
							<button
								v-for="(row, index) in visibleRows"
								:key="row.name"
								type="button"
								role="option"
								class="cobranza__row cobranza__row--item"
								:class="{ 'cobranza__row--sel': row.name === selectedName }"
								:aria-selected="row.name === selectedName"
								:data-testid="`cobranza-row-${row.name}`"
								@click="select(index)"
							>
								<span class="mono cobranza__folio">{{ row.name }}</span>
								<span class="cobranza__customer">{{ row.customer_name || row.customer }}</span>
								<span class="mono" :data-tone="dueTone(row)">{{ dueText(row) }}</span>
								<span class="mono cobranza__cell--right">{{ formatCurrency(row.total) }}</span>
								<span class="mono cobranza__cell--right cobranza__amount">
									{{ formatCurrency(row.outstanding) }}
								</span>
								<span>
									<span class="cobranza__chip" :data-tone="estadoChip(row).tone">
										{{ __(estadoChip(row).label) }}
									</span>
								</span>
							</button>
						</template>

						<div class="cobranza__hint">
							<template v-if="capped">
								{{ __("Showing the first {0} — narrow the list to reach the rest.", [limit]) }}
							</template>
							<template v-else>
								{{ __("↑↓ moves · Enter collects · searching refines the list, it is never the way in") }}
							</template>
						</div>
					</div>
				</div>

				<CobranzaDetail
					v-if="!isCollectedTab"
					:row="selectedRow"
					:contact="detail?.contact ?? null"
					:lines="detail?.lines ?? []"
					:payments="detail?.payments ?? []"
					:line-count="detailLineCount"
					:store-credit="detail?.store_credit ?? null"
					:loading-detail="loadingDetail"
					:collecting="collecting"
					:offline="offline"
					:reminder-state="reminderState"
					:format-currency="formatCurrency"
					@collect="collect"
					@reminder="fileReminder"
					@statement="announceStatementStub"
				/>
			</div>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * Cobranza — the payments ops panel (COBRANZA_GOLDEN_FLOW, artboard
 * `Cobranza.dc.html`).
 *
 * WHAT CHANGED AND WHY. The `payments` destination used to open `PayView`
 * directly: a capture tool you have to FEED — pick a customer, find the
 * invoice, every single time. Owner direction, verbatim: *"the one we have
 * works but is not that obvious and you have to manually search each time; a
 * reminder or list would be great."* So the worklist became the surface and
 * search became a refinement of it.
 *
 * PAYVIEW IS MOUNTED HERE, NOT NAVIGATED TO, and that follows from how the
 * shell hosts sheets: `DestinationHost` renders exactly ONE component per
 * destination id out of `SHEET_COMPONENTS`. Two destinations cannot be on
 * screen at once, so "navigate to capture" would mean either a second rail
 * entry for a thing that is not a place, or leaving the register shell —
 * which is the navigation dead end `destinationRegistry`'s `route` kind was
 * retired for. Hosting it keeps the rail, the band and the way back.
 *
 * THE HANDOFF IS THE ONE THAT ALREADY EXISTED. `InvoiceManagement.openAddPayment`
 * has always done three things — set the selected customer, put an
 * `{invoiceName, customer, currency}` on `uiStore.paymentRouteTarget`, and land
 * on Payments — and `PayView.applyPaymentRouteTarget` picks that target up,
 * selects the matching outstanding invoice and clears it. COBRAR drives exactly
 * that path, so the amount is pre-filled by PayView's own auto-allocation
 * rather than by a number this panel computed. Nothing here writes money, and
 * there is no second capture surface to keep in step.
 *
 * That also means the deep link still works: arriving at `/payments` with a
 * target already on the store (Facturas' «Agregar pago») opens straight into
 * capture instead of dropping the cashier on a worklist they did not ask for.
 *
 * REFRESH IS EVENT-DRIVEN, NOT POLLED. `PayView` publishes `payment_captured`
 * once the server has accepted a capture — see the note on that emit — and this
 * panel re-reads on it. Nothing here runs on a timer.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import CobranzaDetail from "./CobranzaDetail.vue";
import PayView from "../../shell/PayView.vue";
import {
	defaultTab,
	describeDue,
	emptyCounts,
	emptyStateKey,
	emptyTotals,
	estadoChip,
	matchesCollectedQuery,
	matchesQuery,
	nextIndex,
	describeTabs,
	type CollectedRow,
	type ReceivableCounts,
	type ReceivableDetail,
	type ReceivableRow,
	type ReceivableTabId,
	type ReceivableTotals,
} from "./receivablesModel";
import { useFormat } from "../../../../format";
import { bus } from "../../../../bus";
import { useOnlineStatus } from "../../../../composables/core/useOnlineStatus";
import { createSeguimiento, crmIsUnavailable } from "../../../../services/crmService";
import {
	fetchCollectedToday,
	fetchReceivableDetail,
	fetchReceivables,
	invalidateReceivablesBadge,
} from "../../../../services/receivablesService";
import { useCustomersStore } from "../../../../stores/customersStore.js";
import { useToastStore } from "../../../../stores/toastStore";
import { useUIStore } from "../../../../stores/uiStore";

// Declared but never emitted: `DestinationHost` binds `@close` on every hosted
// component, and an undeclared listener falls through onto the root element as
// a stray attribute. This surface has no reason to dismiss itself — the rail is
// the way out — so the contract is stated and left unused.
defineEmits<{ close: [] }>();

const uiStore = useUIStore();
const toastStore = useToastStore();
const customersStore = useCustomersStore();
const { posProfile, paymentRouteTarget } = storeToRefs(uiStore);
const { formatCurrency } = useFormat();
const { isOnline } = useOnlineStatus();

const __ =
	(window as Record<string, any>).__ ||
	((value: string, args?: any[]) => {
		if (!args?.length) return value;
		return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), value);
	});

const searchRef = ref<HTMLInputElement | null>(null);

const step = ref<"worklist" | "capture">("worklist");
const captureTarget = ref<{ invoiceName: string; customerName: string | null } | null>(null);

const tab = ref<ReceivableTabId>("all");
/** The panel has not yet had a chance to land on a populated bucket (§1). */
const landed = ref(false);
const query = ref("");
const rows = ref<ReceivableRow[]>([]);
const counts = ref<ReceivableCounts>(emptyCounts());
const totals = ref<ReceivableTotals>(emptyTotals());
const limit = ref(0);
const capped = ref(false);
const collected = ref<CollectedRow[]>([]);
const collectedTotal = ref(0);
const selectedName = ref<string | null>(null);
const detail = ref<ReceivableDetail | null>(null);
const loading = ref(false);
const loadingDetail = ref(false);
const collecting = ref(false);
const reminderState = ref<"idle" | "sending" | "filed">("idle");
const errorMessage = ref("");

const profileName = computed(() => posProfile.value?.name ?? null);
const offline = computed(() => !isOnline.value);
const isCollectedTab = computed(() => tab.value === "collected_today");
const collectedCount = computed(() => collected.value.length);
const tabs = computed(() => describeTabs(counts.value, collectedCount.value, tab.value));
const visibleRows = computed(() => rows.value.filter((row) => matchesQuery(row, query.value)));
const visibleCollected = computed(() =>
	collected.value.filter((row) => matchesCollectedQuery(row, query.value)),
);
const visibleCount = computed(() =>
	isCollectedTab.value ? visibleCollected.value.length : visibleRows.value.length,
);
const selectedRow = computed(
	() => visibleRows.value.find((row) => row.name === selectedName.value) ?? null,
);
const detailLineCount = computed(() => detail.value?.lines_shown ?? 0);
const emptyState = computed(() => emptyStateKey(tab.value, Boolean(query.value.trim())));

const dueTone = (row: ReceivableRow) => describeDue(row)?.tone ?? "muted";
const dueText = (row: ReceivableRow) => {
	const due = describeDue(row);
	if (!due) return "—";
	return due.count === null ? __(due.key) : __(due.key, [due.count]);
};

const reportFailure = (error: unknown, fallback: string) => {
	const failure = error as { serverMessage?: string; message?: string } | null;
	errorMessage.value = failure?.serverMessage || failure?.message || fallback;
};

async function loadWorklist() {
	const profile = profileName.value;
	if (!profile) return;
	loading.value = true;
	try {
		// The bucket is NOT sent while the panel is still deciding where to
		// land: `defaultTab` needs the counts, and the counts come back with
		// any bucket, so the first read asks for «Todas» and the tab follows.
		const payload = await fetchReceivables(profile, {
			bucket: landed.value ? tab.value : "all",
		});
		counts.value = payload?.counts ?? emptyCounts();
		totals.value = payload?.totals ?? emptyTotals();
		limit.value = Number(payload?.limit) || 0;
		capped.value = Boolean(payload?.capped);
		errorMessage.value = "";

		if (!landed.value) {
			landed.value = true;
			const wanted = defaultTab(counts.value);
			if (wanted !== "all") {
				// Land on Vencidas with zero typing (§1 / acceptance 1). The
				// «Todas» rows we already hold are the superset, so the tab moves
				// without a second round trip.
				tab.value = wanted;
				rows.value = (payload?.rows ?? []).filter((row) => row.aging === wanted);
				syncSelection();
				return;
			}
		}
		rows.value = Array.isArray(payload?.rows) ? payload.rows : [];
		syncSelection();
	} catch (error) {
		rows.value = [];
		counts.value = emptyCounts();
		totals.value = emptyTotals();
		reportFailure(error, __("Could not read what is owed to this register."));
	} finally {
		loading.value = false;
	}
}

async function loadCollected() {
	const profile = profileName.value;
	if (!profile) return;
	try {
		const payload = await fetchCollectedToday(profile);
		collected.value = Array.isArray(payload?.rows) ? payload.rows : [];
		collectedTotal.value = Number(payload?.total) || 0;
	} catch {
		// The stats card and the fourth tab are the reconciliation half; failing
		// to read them is not a reason to take the worklist down, and a stale
		// «Cobrado hoy» would be worse than an honest zero.
		collected.value = [];
		collectedTotal.value = 0;
	}
}

/** Drop a selection the current list no longer contains, and open the first. */
function syncSelection() {
	if (selectedName.value && rows.value.some((row) => row.name === selectedName.value)) {
		void openDetail(selectedName.value);
		return;
	}
	selectedName.value = null;
	detail.value = null;
	const first = visibleRows.value[0];
	if (first) {
		selectedName.value = first.name;
		void openDetail(first.name);
	}
}

async function openDetail(name: string) {
	const profile = profileName.value;
	const row = rows.value.find((candidate) => candidate.name === name);
	if (!profile || !row) return;
	loadingDetail.value = true;
	reminderState.value = "idle";
	try {
		const payload = await fetchReceivableDetail(profile, name, row.doctype);
		// The cashier may have moved on while this was in flight; landing a
		// stale panel under a different folio is how a payment gets taken
		// against the wrong invoice.
		if (selectedName.value !== name) return;
		detail.value = payload;
	} catch (error) {
		if (selectedName.value === name) {
			detail.value = null;
			reportFailure(error, __("Could not open this invoice."));
		}
	} finally {
		loadingDetail.value = false;
	}
}

const select = (index: number) => {
	const row = visibleRows.value[index];
	if (!row || row.name === selectedName.value) return;
	selectedName.value = row.name;
	detail.value = null;
	void openDetail(row.name);
};

const chooseTab = (id: ReceivableTabId) => {
	if (id === tab.value) return;
	tab.value = id;
	landed.value = true;
	selectedName.value = null;
	detail.value = null;
	if (id === "collected_today") {
		void loadCollected();
		return;
	}
	void loadWorklist();
};

const onKeydown = (event: KeyboardEvent) => {
	if (isCollectedTab.value) return;
	if (event.key === "Enter") {
		event.preventDefault();
		const row = selectedRow.value;
		if (row) void collect(row);
		return;
	}
	const current = visibleRows.value.findIndex((row) => row.name === selectedName.value);
	const next = nextIndex(event.key, current, visibleRows.value.length);
	if (next === null) return;
	event.preventDefault();
	select(next);
};

/**
 * «COBRAR» — arm the existing capture and show it.
 *
 * The three lines below are `InvoiceManagement.openAddPayment`'s, minus the
 * `router.push`: the customer, then the route target PayView already knows how
 * to consume. PayView selects the invoice, and its own auto-allocation fills
 * the amount from that invoice's outstanding — which is why this panel does not
 * send an amount and must not start.
 */
async function collect(row: ReceivableRow) {
	if (offline.value || collecting.value) return;
	if (!row.customer) {
		toastStore.show({
			title: __("This invoice has no customer to collect from."),
			color: "error",
		});
		return;
	}
	collecting.value = true;
	try {
		customersStore.setSelectedCustomer(row.customer);
		uiStore.setPaymentRouteTarget({
			invoiceName: row.name,
			customer: row.customer,
			currency: row.currency,
		});
		captureTarget.value = {
			invoiceName: row.name,
			customerName: row.customer_name || row.customer,
		};
		step.value = "capture";
	} finally {
		collecting.value = false;
	}
}

function backToWorklist() {
	step.value = "worklist";
	captureTarget.value = null;
	// PayView clears the target once it has consumed it; clearing again is what
	// keeps a target the cashier abandoned from re-arming capture on the next
	// visit to this destination.
	uiStore.clearPaymentRouteTarget();
	void refreshAll();
}

/**
 * Re-read everything a capture can have moved: the row, the buckets, the
 * stats, «Cobrado hoy» and the rail's badge.
 *
 * The badge cache is INVALIDATED rather than re-fetched here — the shell owns
 * that number and listens for the same event, so refetching from both would be
 * two round trips for one answer.
 */
async function refreshAll() {
	invalidateReceivablesBadge();
	await Promise.all([loadWorklist(), loadCollected()]);
}

async function fileReminder(row: ReceivableRow) {
	const profile = profileName.value;
	if (!profile || !row.customer || reminderState.value === "sending") return;
	if (crmIsUnavailable()) {
		toastStore.show({
			title: __("No CRM on this site"),
			message: __("There is nowhere to file a follow-up, so nothing was recorded."),
			color: "info",
		});
		return;
	}
	reminderState.value = "sending";
	try {
		const result = await createSeguimiento(row.customer, profile, {
			// Folio AND pendiente in the note, per §1 — a follow-up that says only
			// "call this customer" makes the back office look the amount up again.
			note: __("Collection reminder · {0} · {1} pending", [
				row.name,
				formatCurrency(row.outstanding),
			]),
			reference_doctype: row.doctype,
			reference_name: row.name,
		});
		reminderState.value = "filed";
		toastStore.show({
			// `updated` is the CRM round's idempotence showing through: pressed
			// twice on the same day it edits the same follow-up rather than
			// filing a second one, and saying so is what stops a cashier pressing
			// it a third time.
			title:
				result?.action === "updated"
					? __("Reminder updated")
					: __("Reminder filed"),
			message: __("The back office sees {0} and what is pending on it.", [row.name]),
			color: "success",
		});
	} catch (error) {
		reminderState.value = "idle";
		reportFailure(error, __("Could not file the reminder."));
	}
}

const announceStatementStub = () => {
	toastStore.show({
		title: __("Not built yet"),
		message: __(
			"Printing a customer statement is not built yet — this list is the customer's open items.",
		),
		color: "info",
	});
};

/**
 * A capture landed. Re-read rather than patch the row in place: the server is
 * the only thing that knows whether the payment settled the invoice, was
 * partly allocated, or was reconciled against something else entirely.
 */
const onCaptured = (payload: { queued?: boolean } = {}) => {
	// An offline capture is accepted by the register, not by the server: the
	// balances behind this panel have not moved, and re-reading them would show
	// the same debt and read as a failure.
	if (payload?.queued) return;
	invalidateReceivablesBadge();
	void loadWorklist();
	void loadCollected();
};

watch(profileName, () => {
	landed.value = false;
	selectedName.value = null;
	detail.value = null;
	void refreshAll();
});

onMounted(() => {
	bus.on("payment_captured", onCaptured);
	// Arrived from Facturas' «Agregar pago», which sets the target and lands on
	// this destination. Opening the worklist would throw that intent away.
	const target = paymentRouteTarget.value;
	if (target?.invoiceName) {
		captureTarget.value = {
			invoiceName: target.invoiceName,
			customerName: target.customer ?? null,
		};
		step.value = "capture";
	}
	void loadWorklist();
	void loadCollected();
	searchRef.value?.focus?.();
});

onBeforeUnmount(() => {
	bus.off("payment_captured", onCaptured);
});
</script>

<style scoped>
.cobranza {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	flex: 1 1 auto;
	min-height: 0;
	padding: 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.cobranza__error {
	flex: none;
}

.cobranza__capture-bar {
	display: flex;
	align-items: center;
	gap: 12px;
	flex: none;
}

.cobranza__capture-target {
	font-size: 12.5px;
	color: var(--pos-text-secondary, #7b838f);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cobranza__capture {
	flex: 1 1 auto;
	min-height: 0;
}

.cobranza__stats {
	display: flex;
	gap: 10px;
	flex: none;
}

.cobranza__stat {
	flex: 1;
	padding: 12px 16px;
	border-radius: 12px;
	border: 1px solid var(--reg-border, #e6e9ee);
	background: var(--reg-surface, #fff);
}

.cobranza__stat--bad {
	border-color: #f3c9c4;
	background: #fdf6f5;
}

.cobranza__stat-label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--pos-text-secondary, #8b93a0);
}

.cobranza__stat--bad .cobranza__stat-label,
.cobranza__stat--bad .cobranza__stat-value,
.cobranza__stat--bad .cobranza__stat-note {
	color: var(--reg-bad-ink, #b42318);
}

.cobranza__stat-value {
	margin-top: 3px;
	font-size: 24px;
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cobranza__stat-value--good {
	color: var(--reg-good-ink, #14603a);
}

.cobranza__stat-note {
	font-size: 11px;
	color: var(--pos-text-secondary, #9aa2ae);
}

.cobranza__body {
	display: flex;
	gap: var(--reg-space-lg, 12px);
	flex: 1 1 auto;
	min-height: 0;
}

.cobranza__list {
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

.cobranza__tabs {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 14px 12px;
}

.cobranza__tab {
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

.cobranza__tab--on {
	background: var(--reg-accent-soft, #e0f7fa);
	border-color: var(--reg-accent-edge, #9fdde6);
	color: var(--reg-accent-ink, #00646f);
	font-weight: 700;
}

.cobranza__tab-count {
	opacity: 0.7;
}

.cobranza__tabs-spacer {
	flex: 1;
}

.cobranza__search {
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

.cobranza__table {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	outline: none;
}

/* Percentages only, no `max()`: this grid is fixed-layout and a `max()` track
   is silently dropped, which collapses every column to equal width (the
   `ledgerRowOverlap` lesson). Every cell below is nowrap-ellipsis for the same
   reason a ticket id once painted over the row beneath it. */
.cobranza__row {
	display: grid;
	grid-template-columns: 16% 25% 15% 14% 16% 14%;
	gap: 12px;
	padding: 10px 14px;
	align-items: baseline;
	border-bottom: 1px solid var(--reg-border-light, #f5f7f9);
	font-size: 12.5px;
	color: var(--pos-text-secondary, #4a5260);
	text-align: left;
}

.cobranza__row--paid {
	grid-template-columns: 22% 28% 18% 17% 15%;
}

.cobranza__row > span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.cobranza__row--head {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--pos-text-secondary, #8b93a0);
	border-bottom: 1px solid var(--reg-border, #eceff3);
}

.cobranza__row--item {
	width: 100%;
	background: none;
	border-left: 3px solid transparent;
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}

.cobranza__row--sel {
	background: var(--reg-accent-soft, #e0f7fa);
	border-left-color: var(--reg-accent, #0097a7);
}

.cobranza__folio {
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cobranza__customer {
	font-weight: 500;
	color: var(--pos-text-primary, #212121);
}

.cobranza__muted {
	color: var(--pos-text-secondary, #9aa2ae);
}

/* The number that matters, bold (§1). */
.cobranza__amount {
	font-weight: 700;
	color: var(--pos-text-primary, #212121);
}

.cobranza__cell--right {
	text-align: right;
}

.cobranza__chip {
	display: inline-flex;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 700;
}

.cobranza__chip[data-tone="good"],
[data-tone="good"] {
	color: var(--reg-good-ink, #14603a);
}

.cobranza__chip[data-tone="good"] {
	background: var(--reg-good-soft, #e8f5e8);
}

.cobranza__chip[data-tone="warn"],
[data-tone="warn"] {
	color: var(--reg-warn-ink, #a15200);
}

.cobranza__chip[data-tone="warn"] {
	background: var(--reg-warn-soft, #fff3e0);
}

.cobranza__chip[data-tone="bad"],
[data-tone="bad"] {
	color: var(--reg-bad-ink, #b42318);
}

.cobranza__chip[data-tone="bad"] {
	background: var(--reg-bad-soft, #fdeaea);
}

.cobranza__chip[data-tone="muted"],
[data-tone="muted"] {
	color: var(--reg-muted-ink, #667085);
}

.cobranza__chip[data-tone="muted"] {
	background: var(--reg-muted-soft, #f2f4f7);
}

.cobranza__empty {
	padding: 24px 14px;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--pos-text-secondary, #9aa2ae);
	text-align: center;
}

.cobranza__hint {
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

/* Below the artboard's width the list stops being a column and becomes the top
   half — the same boundary the ledger, orden and cotizaciones surfaces use. */
@media (max-width: 1180px) {
	.cobranza__body {
		flex-direction: column;
	}

	.cobranza__list {
		max-height: 50%;
	}

	.cobranza__stats {
		flex-wrap: wrap;
	}
}
</style>
