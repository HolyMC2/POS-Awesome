<template>
	<div class="ledger-table" data-testid="ledger-table">
		<div class="ledger-table__head" :style="gridStyle" role="presentation">
			<span class="ledger-table__col">{{ __("Ticket") }}</span>
			<span class="ledger-table__col">{{ __("Hour") }}</span>
			<span class="ledger-table__col">{{ __("Customer") }}</span>
			<!-- `Cajero` renders only when `owner` resolves to a display name the
			     client is already holding. A column of em dashes teaches nothing
			     and takes 78 px from the customer, so it is DROPPED instead. -->
			<span v-if="columns.cashier" class="ledger-table__col">{{ __("Cashier") }}</span>
			<!--
				`Cobro` (Efectivo · Tarjeta · Transfer. · Mixto) is deliberately
				absent. The tender lives in the invoice's `payments` child table
				and the list read (`getInvoiceListFields`) does not touch child
				tables, so filling this column means one request per row — which
				build plan §15.2 forbids outright. The PANEL shows the tender for
				the selected row, because `viewInvoice` fetches that whole
				document anyway. See `ledgerModel.describeColumns`, whose
				`tender` is a constant `false` for the same reason.
			-->
			<span class="ledger-table__col ledger-table__col--end">{{ __("Total") }}</span>
			<span class="ledger-table__col ledger-table__col--end">{{ __("Status") }}</span>
		</div>

		<div
			ref="ring"
			class="ledger-table__body"
			role="grid"
			tabindex="0"
			:aria-label="__('Invoices')"
			:aria-activedescendant="activeRowId"
			data-testid="ledger-rows"
			@keydown="onKeydown"
		>
			<div
				v-for="(row, index) in rows"
				:id="rowId(index)"
				:key="row.name || index"
				class="ledger-row"
				:class="{ 'ledger-row--on': index === selectedIndex }"
				:style="gridStyle"
				role="row"
				:aria-selected="index === selectedIndex"
				data-testid="ledger-row"
				:data-ledger-row="row.name"
				@click="$emit('open', { row, index })"
			>
				<span class="ledger-row__ticket reg-mono" role="gridcell">{{ row.name }}</span>
				<span class="ledger-row__muted reg-mono" role="gridcell">{{ row.time }}</span>
				<span class="ledger-row__customer" role="gridcell">{{ row.customer }}</span>
				<span v-if="columns.cashier" class="ledger-row__muted" role="gridcell">{{
					row.cashier || "—"
				}}</span>
				<span
					class="ledger-row__amount reg-mono"
					role="gridcell"
					data-money-role="ledger-row"
					>{{ formatCurrency(row.amount) }}</span
				>
				<span class="ledger-row__status" role="gridcell">
					<span class="ledger-chip" :class="`ledger-chip--${row.status.tone}`">{{
						__(row.status.label)
					}}</span>
				</span>
			</div>

			<div v-if="!rows.length" class="ledger-table__empty" data-testid="ledger-empty">
				{{ loading ? __("Reading the register…") : __("Nothing on this list yet") }}
			</div>
		</div>

		<div class="ledger-table__foot" data-testid="ledger-footer">
			<!-- R8: only the keys this table really binds. The artboard prints
			     `F5 imprime · F8 devuelve`; `MUELLE_DEFAULT` binds neither here
			     (`f8` is `app.lockScreen`), so neither is named. -->
			<span class="ledger-table__hint">{{
				__("↑↓ moves · Enter opens · Home and End jump")
			}}</span>
			<div class="ledger-table__pager">
				<button
					v-if="pageCount > 1"
					type="button"
					class="ledger-table__page"
					:disabled="page <= 1"
					:aria-label="__('Previous page')"
					data-testid="ledger-page-prev"
					@click="$emit('page', page - 1)"
				>
					‹
				</button>
				<span class="ledger-table__count reg-mono" data-testid="ledger-count">{{ countLabel }}</span>
				<button
					v-if="pageCount > 1"
					type="button"
					class="ledger-table__page"
					:disabled="page >= pageCount"
					:aria-label="__('Next page')"
					data-testid="ledger-page-next"
					@click="$emit('page', page + 1)"
				>
					›
				</button>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * The ledger's rows, its selection and its keyboard ring (§15.3).
 *
 * The ring itself is `ledgerModel.nextIndex` — pure, clamped at both ends,
 * and `null` for a key that is not ours so a chord the shortcuts engine owns
 * passes straight through instead of being swallowed by a list.
 */
import { computed, ref, watch } from "vue";

import type { LedgerColumns, LedgerFooterKind, LedgerRow } from "./ledgerModel";
import { nextIndex } from "./ledgerModel";
import { translate as __ } from "./ledgerText";

const props = withDefaults(
	defineProps<{
		rows: readonly LedgerRow[];
		columns: LedgerColumns;
		selectedIndex: number;
		formatCurrency: (value: number) => string;
		/** 1-based, from the engine's own `tabPages`. */
		page: number;
		pageCount: number;
		/** Rows in the filtered collection, before pagination. */
		total: number;
		/** The engine's page size (`TAB_PAGE_SIZE`), for the "1–8 of 31" range. */
		pageSize: number;
		/** Rows this page carried BEFORE the client-side amount match. */
		loadedOnPage: number;
		footerKind: LedgerFooterKind;
		loading?: boolean;
	}>(),
	{ loading: false },
);

const emit = defineEmits<{
	select: [number];
	open: [{ row: LedgerRow; index: number }];
	page: [number];
}>();

const ring = ref<HTMLElement | null>(null);

/**
 * Columns are declared in ONE place and both the header and every row read
 * it, because a header that disagrees with its rows by one column is the
 * classic way an optional column ships crooked.
 */
const gridStyle = computed(() => ({
	// TICKET 176 -> 192px and HORA 56 -> 60px, paid for by CAJERO 96 -> 84 and
	// ESTADO 132 -> 124, so the fixed tracks still total 572px and CLIENTE — the
	// only elastic one — keeps every pixel it had (measured: 548px on the
	// 1202px drafts surface at 1718x1023, 110px at 1280x900).
	//
	// The artboard's `B-04812` is six characters; the register's real folio
	// (`ACC-SINV-2026-00192`) is nineteen and measures 168.4px at the shipped
	// weight — inside the old 176px track by 7.6px, i.e. 4%. One font fallback,
	// one longer prefix or one wider glyph and it wrapped onto a second line,
	// which reads as two tickets because a wrapped 50px row paints over the row
	// below, and `.ledger-row__ticket` carried no `nowrap` to stop it (Marco,
	// drafts surface, 2026-08-23). The same 4% is why HORA clipped to «19:…»:
	// 56px against 39.8px of digits plus its own header.
	//
	// Both tracks now clear their content by ~14%, AND the cells truncate on one
	// line below, so the next long id degrades into an ellipsis instead of into
	// the neighbouring row. The two trimmed tracks keep their own margins:
	// «Cafetería» is 53px in 84, and the longest status chip («Nota de crédito
	// emitida», 117px) still fits 124.
	gridTemplateColumns: props.columns.cashier
		? "192px 60px minmax(0, 1fr) 84px 112px 124px"
		: "192px 60px minmax(0, 1fr) 112px 124px",
}));

const rowId = (index: number) => `ledger-row-${index}`;
const activeRowId = computed(() =>
	props.selectedIndex >= 0 && props.selectedIndex < props.rows.length
		? rowId(props.selectedIndex)
		: undefined,
);

const countLabel = computed(() => {
	if (props.footerKind === "loaded") {
		// The Monto mode matched the rows already on screen and nothing else.
		// "3 de 31" would claim a search of the whole ledger that never ran.
		return __("{0} of the {1} loaded", [props.rows.length, props.loadedOnPage]);
	}
	if (!props.total) return "";
	const first = (props.page - 1) * props.pageSize + 1;
	const last = Math.min(first + props.rows.length - 1, props.total);
	return __("{0}–{1} of {2}", [first, last, props.total]);
});

const onKeydown = (event: KeyboardEvent) => {
	if (event.key === "Enter") {
		const row = props.rows[props.selectedIndex];
		if (row) {
			event.preventDefault();
			emit("open", { row, index: props.selectedIndex });
		}
		return;
	}
	const target = nextIndex(event.key, props.selectedIndex, props.rows.length);
	if (target === null) return;
	event.preventDefault();
	emit("select", target);
};

// Keep the selected row inside the scrollport. Without this the ring walks
// off the bottom and the cashier is arrowing through rows they cannot see.
watch(
	() => props.selectedIndex,
	(index) => {
		// Indexed rather than selected by id: `CSS.escape` is not guaranteed in
		// every jsdom the suite runs under, and the row order is the only thing
		// this needs to know.
		const element = ring.value?.querySelectorAll<HTMLElement>('[data-testid="ledger-row"]')[index];
		element?.scrollIntoView?.({ block: "nearest" });
	},
);

defineExpose({ focusRing: () => ring.value?.focus() });
</script>

<style scoped>
.ledger-table {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	box-shadow: 0 1px 2px rgba(16, 20, 30, 0.05);
}

.ledger-table__head,
.ledger-row {
	display: grid;
	align-items: center;
	gap: var(--reg-space-md, 10px);
	padding: 0 16px;
}

.ledger-table__head {
	height: 36px;
	flex: none;
	background: var(--reg-surface-sunken, #f8f9fa);
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.ledger-table__col {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ledger-table__col--end {
	text-align: right;
}

.ledger-table__body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}

.ledger-table__body:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: -2px;
}

.ledger-row {
	height: 50px;
	cursor: pointer;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.ledger-row:hover {
	background: var(--reg-surface-sunken, #f8f9fa);
}

/* The selected row is a WASH plus a 3px edge, never an accent FILL: the
   surface's one saturated colour is spent on the panel's action. The wash is
   `--reg-accent-soft` (theme.css's `--pos-primary-container`), which is the
   same pale derivative the tender chips use and flips with the theme. */
.ledger-row--on,
.ledger-row--on:hover {
	background: var(--reg-accent-soft, #e0f7fa);
	box-shadow: inset 3px 0 0 var(--reg-accent, #0097a7);
}

.ledger-row--on .ledger-row__muted,
.ledger-row--on .ledger-row__customer,
.ledger-row--on .ledger-row__ticket,
.ledger-row--on .ledger-row__amount {
	color: var(--reg-on-accent-soft, #00646f);
}

/* Every cell on this row is one line, or it is a bug.
 *
 * The grid tracks are fixed, so a cell that outgrows its track WRAPS, and a
 * wrapped 50px row paints its second line over the row below — which is how a
 * ticket id came to sit in the neighbouring row's lines. Stated over every cell
 * rather than over the ticket: `ledger-row__ticket` and `ledger-row__amount`
 * were the two carrying no `white-space` at all, and a rule that named only the
 * reported one would leave the other a long currency away from the same defect.
 *
 * `min-width: 0` is the half that is easy to miss. A grid item's automatic
 * minimum size is its CONTENT, so without it a long id widens its own track and
 * shoves the row sideways instead of truncating — every cell needs it,
 * including the status one. */
.ledger-row > * {
	min-width: 0;
}

/* The status cell is excluded from the truncation, not forgotten by it: it is a
 * flex box with `justify-content: flex-end` holding a chip that is already
 * `nowrap`, so it cannot wrap — and clipping a flex-end box hides the START of
 * its content, which would turn a long label («Nota de crédito emitida») into a
 * chip missing its first word rather than its last. */
.ledger-row > *:not(.ledger-row__status) {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ledger-row__ticket {
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.ledger-row__muted {
	color: var(--reg-text-muted, #667085);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ledger-row__customer {
	color: var(--reg-text-primary, #212121);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ledger-row__amount {
	text-align: right;
	font-weight: 600;
	color: var(--reg-text-primary, #212121);
}

.ledger-row__status {
	display: flex;
	justify-content: flex-end;
}

/* ---- status chip ------------------------------------------------------ */

.ledger-chip {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 3px 9px;
	font-size: 11.5px;
	font-weight: 500;
	white-space: nowrap;
	border: 1px solid transparent;
}

.ledger-chip--positive {
	background: var(--reg-tone-positive-bg, #f4fbf7);
	border-color: var(--reg-tone-positive-border, #cdead8);
	color: var(--reg-tone-positive-label, #1b5e20);
}

.ledger-chip--warning {
	background: var(--reg-tone-warning-bg, #fdf9f0);
	border-color: var(--reg-tone-warning-border, #f0dcae);
	color: var(--reg-tone-warning-label, #8a5a0d);
}

.ledger-chip--negative {
	background: var(--reg-tone-negative-bg, #fdeaea);
	border-color: var(--reg-tone-negative-border, #f6cfcf);
	color: var(--reg-tone-negative-label, #b42318);
}

.ledger-chip--returned {
	background: var(--reg-tone-returned-bg, #ede9fe);
	border-color: var(--reg-tone-returned-border, #d7cffb);
	color: var(--reg-tone-returned-label, #5b3fb8);
}

.ledger-chip--neutral {
	background: var(--reg-surface-muted, #f2f4f7);
	border-color: var(--reg-tone-neutral-border, rgba(0, 0, 0, 0.06));
	color: var(--reg-text-secondary, #56606e);
}

/* ---- footer ----------------------------------------------------------- */

.ledger-table__empty {
	padding: 32px 16px;
	text-align: center;
	font-size: 13px;
	color: var(--reg-text-muted, #667085);
}

.ledger-table__foot {
	flex: none;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	padding: 8px 16px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.ledger-table__pager {
	display: flex;
	align-items: center;
	gap: var(--reg-space-sm, 6px);
}

.ledger-table__page {
	width: 26px;
	height: 26px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-xs, 6px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-secondary, #56606e);
	font: inherit;
	font-size: 14px;
	line-height: 1;
	cursor: pointer;
}

.ledger-table__page:disabled {
	opacity: 0.4;
	cursor: default;
}

.ledger-table__page:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}
</style>
