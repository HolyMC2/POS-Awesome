<template>
	<section class="ledger-surface" data-testid="ledger-surface">
		<InvoiceLedgerHeader
			ref="headerRef"
			:segments="segments"
			:active-segment="segment"
			:counts="counts"
			:modes="modes"
			:active-mode="mode"
			:query="query"
			:date-from="dateFrom"
			:date-to="dateTo"
			@segment="chooseSegment"
			@mode="chooseMode"
			@update:query="setQuery"
			@update:date-from="publishFilters($event, dateTo)"
			@update:date-to="publishFilters(dateFrom, $event)"
		/>

		<InvoiceLedgerFigures
			:figures="figures"
			:format-currency="formatCurrency"
			:currency-symbol="currencySymbol"
		/>

		<div class="ledger-surface__body">
			<InvoiceLedgerTable
				ref="tableRef"
				:rows="visibleRows"
				:columns="columns"
				:selected-index="selectedIndex"
				:format-currency="formatCurrency"
				:page="collection.pageNo"
				:page-count="collection.pageCount"
				:total="collection.total"
				:page-size="pageSize"
				:loaded-on-page="pageRows.length"
				:footer-kind="footerKind"
				:loading="loading"
				@select="selectAt"
				@open="openRow"
				@page="$emit('page', { tab: activeTab, page: $event })"
			/>

			<InvoiceLedgerPanel
				:row="selectedRow"
				:detail="matchedDetail"
				:format-currency="formatCurrency"
				:format-float="formatFloat"
				:currency-symbol="currencySymbol"
				:is-repair-candidate="isRepairCandidate"
				:draft-actions-for="draftActionsFor"
				:draft-action-label="draftActionLabel"
				:can-delete-draft="canDeleteDraft"
				:repair-busy="repairBusy"
				:offline="offline"
				@print="withRow('print')"
				@return="withRow('return')"
				@collect="withRow('collect')"
				@delete-draft="withRow('deleteDraft')"
				@repair="withRow('repair')"
				@draft-action="onDraftAction"
			/>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * The Facturas ledger, composed (build plan §15.2, artboard `Main.dc.html`).
 *
 * §15.3 names four children and a model; this is the fifth, and it exists for
 * one reason: the ledger needs three pieces of state the tab layout never had
 * — the armed finder mode, the selected ticket, and the text in the box — and
 * `InvoiceManagement.vue`'s `data()` has to stay byte-identical. They live
 * here, where they are three refs rather than three more keys on a
 * 3,283-line engine.
 *
 * NOTHING here reaches the engine directly. Every act is an emit that
 * `InvoiceManagement.vue`'s template binds to a method it already has
 * (`viewInvoice`, `printInvoice`, `createReturn`, `openAddPayment`,
 * `runDraftAction`, `deleteDraft`, `repairChangeAllocation`) or to a field of
 * its filter state (`historySearch`, `historyDateFrom`, …). The engine loads,
 * filters, paginates and submits exactly as it did.
 */
import { computed, onMounted, ref, watch } from "vue";

import InvoiceLedgerFigures from "./InvoiceLedgerFigures.vue";
import InvoiceLedgerHeader from "./InvoiceLedgerHeader.vue";
import InvoiceLedgerPanel from "./InvoiceLedgerPanel.vue";
import InvoiceLedgerTable from "./InvoiceLedgerTable.vue";
import {
	buildCashierDirectory,
	collectionForSegment,
	describeColumns,
	describeFigures,
	describeFindModes,
	describeRows,
	describeSegments,
	finderFooterKind,
	getFindMode,
	getSegment,
	matchesAmount,
	parseAmountQuery,
	segmentCounts,
	segmentForDestination,
	segmentIntent,
	type LedgerCollections,
	type LedgerFindModeId,
	type LedgerRow,
	type LedgerRowSource,
	type LedgerSegmentId,
} from "./ledgerModel";

const props = withDefaults(
	defineProps<{
		/** `useHostedSheet().destinationId` — `drafts` lands on Borradores. */
		destinationId?: string | null;
		/** `InvoiceManagement.activeTab`; the segment follows it, not the reverse. */
		activeTab: string;
		collections: LedgerCollections;
		/** `TAB_PAGE_SIZE`. */
		pageSize: number;
		dateFrom: string;
		dateTo: string;
		loading?: boolean;
		/** `selectedInvoiceDetail` — the whole document `viewInvoice` fetched. */
		detail: Record<string, any> | null;
		/** `employeeStore.terminalEmployees` and `.currentCashier`. */
		employees?: ReadonlyArray<{ user?: string; full_name?: string }>;
		currentCashier?: { user?: string; full_name?: string } | null;
		formatCurrency: (value: number) => string;
		formatFloat: (value: number) => string;
		currencySymbol?: string;
		isRepairCandidate: (invoice: LedgerRowSource) => boolean;
		draftActionsFor: (invoice: LedgerRowSource) => string[];
		draftActionLabel: (action: string) => string;
		canDeleteDraft?: boolean;
		repairBusy?: boolean;
		offline?: boolean;
		/** Injectable so a spec never depends on the machine's clock. */
		today?: string;
	}>(),
	{
		destinationId: null,
		loading: false,
		employees: () => [],
		currentCashier: null,
		currencySymbol: "",
		canDeleteDraft: false,
		repairBusy: false,
		offline: false,
		today: "",
	},
);

const emit = defineEmits<{
	/** The tab the engine should be on. */
	tab: [string];
	/** Every filter field this surface writes, in one shape. */
	filters: [{ search: string; from: string; to: string }];
	page: [{ tab: string; page: number }];
	open: [LedgerRowSource];
	print: [LedgerRowSource];
	return: [LedgerRowSource];
	collect: [LedgerRowSource];
	deleteDraft: [LedgerRowSource];
	repair: [LedgerRowSource];
	draftAction: [{ invoice: LedgerRowSource; action: string }];
}>();

const headerRef = ref<InstanceType<typeof InvoiceLedgerHeader> | null>(null);
const tableRef = ref<InstanceType<typeof InvoiceLedgerTable> | null>(null);

/* ---- the state that lives here, and nowhere else ----------------------- */

const segment = ref<LedgerSegmentId>(segmentForDestination(props.destinationId));
const mode = ref<LedgerFindModeId>("ticket");
const query = ref("");
const selectedName = ref<string | null>(null);

const today = computed(() => {
	if (props.today) return props.today;
	const datetime = (globalThis as { frappe?: { datetime?: { get_today?: () => string } } }).frappe
		?.datetime;
	if (typeof datetime?.get_today === "function") return String(datetime.get_today());
	return new Date().toISOString().slice(0, 10);
});

/* ---- what the model says ---------------------------------------------- */

/**
 * Turno is absent, not empty (R3).
 *
 * `posa_pos_opening_shift` is on the doctype, but `getInvoiceListFields` does
 * not ask for it and that call sits inside `loadHistory`, a method this wave
 * may not edit. A segment that cannot tell one shift from another would be a
 * button that filters nothing, so there is no button.
 */
const segments = computed(() => describeSegments({ shiftScoped: false }));

// The keymap is not consulted because no ledger action is registered:
// `describeFindModes()` resolves every `chords` to `[]` and the chips draw no
// chord (R8). The moment the lead registers and binds them, handing the
// resolved keymap in here is the only edit this needs.
const modes = computed(() => describeFindModes(null));

const directory = computed(() => buildCashierDirectory(props.employees, props.currentCashier));

const figures = computed(() =>
	describeFigures({
		history: props.collections.history.loaded,
		unpaid: props.collections.partial.loaded,
		today: today.value,
	}),
);

const counts = computed(() => segmentCounts(props.collections, figures.value));

const collection = computed(() => collectionForSegment(props.collections, segment.value));
const activeTab = computed(() => getSegment(segment.value).tab);

const pageRows = computed<LedgerRow[]>(() =>
	describeRows(collection.value.page, {
		today: today.value,
		directory: directory.value,
		isDraft: activeTab.value === "drafts",
	}),
);

/**
 * The Monto mode is the only narrowing this component does itself, because no
 * server filter exists for `grand_total` and inventing one would be the
 * server change §15.3 forbids. It runs over the rows already on screen, and
 * the footer says so.
 */
const visibleRows = computed<LedgerRow[]>(() => {
	if (mode.value !== "amount") return pageRows.value;
	const target = parseAmountQuery(query.value);
	if (target === null) return pageRows.value;
	return pageRows.value.filter((row) => matchesAmount(row.amount, target));
});

const columns = computed(() => describeColumns(visibleRows.value));
const footerKind = computed(() => finderFooterKind(mode.value, query.value));

const selectedIndex = computed(() =>
	selectedName.value ? visibleRows.value.findIndex((row) => row.name === selectedName.value) : -1,
);
const selectedRow = computed<LedgerRow | null>(() => visibleRows.value[selectedIndex.value] ?? null);

/** The panel shows lines only for the document it actually holds. */
const matchedDetail = computed(() =>
	selectedRow.value && props.detail?.name === selectedRow.value.name ? props.detail : null,
);

/* ---- intents ----------------------------------------------------------- */

/**
 * Everything the surface writes into the engine's filter state, in one shape.
 *
 * The text box feeds the tab's search only in the two SEARCH modes: Fecha
 * writes the range instead, and Monto matches on screen. Leaving a ticket
 * number in the search while the cashier believes they are searching by
 * amount would silently empty the list, which is the worst kind of filter bug
 * — it looks like "no results".
 */
const publishFilters = (from = props.dateFrom, to = props.dateTo) => {
	emit("filters", {
		search: getFindMode(mode.value).kind === "search" ? query.value : "",
		from,
		to,
	});
};

const chooseSegment = (id: LedgerSegmentId) => {
	segment.value = id;
	selectedName.value = null;
	const intent = segmentIntent(id, today.value);
	emit("tab", intent.tab);
	publishFilters(intent.from, intent.to);
};

const chooseMode = (id: LedgerFindModeId) => {
	mode.value = id;
	publishFilters();
	void headerRef.value?.focusQuery?.();
};

const setQuery = (value: string) => {
	query.value = value;
	publishFilters();
};

const selectAt = (index: number) => {
	selectedName.value = visibleRows.value[index]?.name ?? null;
};

const openRow = ({ row }: { row: LedgerRow; index: number }) => {
	selectedName.value = row.name;
	emit("open", row.raw);
};

const withRow = (event: "print" | "return" | "collect" | "deleteDraft" | "repair") => {
	const raw = selectedRow.value?.raw;
	if (!raw) return;
	// One payload, five names. Vue's typed `emit` refuses a UNION of event
	// names even when every member takes the same argument, so the name is
	// widened here rather than five near-identical handlers being written out.
	(emit as (name: typeof event, payload: LedgerRowSource) => void)(event, raw);
};

const onDraftAction = (action: string) => {
	const raw = selectedRow.value?.raw;
	if (raw) emit("draftAction", { invoice: raw, action });
};

/* ---- staying in step with the engine ----------------------------------- */

// The engine can move the tab without us: the store's `openInvoiceManagement`
// does exactly that when the rail re-enters on a different destination.
watch(
	() => props.activeTab,
	(tab) => {
		if (getSegment(segment.value).tab === tab) return;
		segment.value = segments.value.find((candidate) => candidate.tab === tab)?.id ?? "today";
		selectedName.value = null;
	},
);

/**
 * Landing.
 *
 * `drafts` lands on Borradores and `invoices` on Hoy (§15.2) — and Hoy means
 * today, so the range is published on mount rather than waiting for the
 * operator to press the button they are already standing on.
 */
onMounted(() => {
	const landing = segmentForDestination(props.destinationId);
	segment.value = landing;
	const intent = segmentIntent(landing, today.value);
	emit("tab", intent.tab);
	publishFilters(intent.from, intent.to);
});

defineExpose({ focusRing: () => tableRef.value?.focusRing?.() });
</script>

<style scoped>
.ledger-surface {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	flex: 1 1 auto;
	min-height: 0;
	padding: 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.ledger-surface__body {
	display: flex;
	gap: var(--reg-space-lg, 14px);
	flex: 1;
	min-height: 0;
}

/* Below the artboard's width the panel stops being a column and becomes the
   bottom half: a 372 px panel beside a seven-column table leaves neither
   readable on a 1,024 px register. */
@media (max-width: 1180px) {
	.ledger-surface__body {
		flex-direction: column;
	}

	.ledger-surface__body :deep(.ledger-panel) {
		width: auto;
		max-height: 45%;
	}
}
</style>
