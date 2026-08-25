<template>
	<aside class="ledger-panel" data-testid="ledger-panel">
		<div v-if="!row" class="ledger-panel__blank" data-testid="ledger-panel-blank">
			{{ __("Choose a ticket to see it here") }}
		</div>

		<template v-else>
			<header class="ledger-panel__head">
				<div class="ledger-panel__title">
					<span class="ledger-panel__ticket reg-mono">{{ __("Ticket {0}", [row.name]) }}</span>
					<span
						class="ledger-panel__amount reg-mono"
						data-money-role="ledger-panel-amount"
						data-testid="ledger-panel-amount"
						>{{ money(row.amount) }}</span
					>
				</div>
				<div class="ledger-panel__who">{{ who }}</div>
				<div class="ledger-panel__chips">
					<span class="ledger-chip" :class="`ledger-chip--${row.status.tone}`">{{
						__(row.status.label)
					}}</span>
					<span v-if="repairState" class="ledger-chip ledger-chip--warning">{{
						__("Change to repair")
					}}</span>
					<!--
						`CFDI 4.0 timbrada` is NOT drawn. No CFDI or stamp field
						reaches this component: the list payload carries none and
						`viewInvoice`'s `frappe.client.get` returns whatever the
						doctype holds, which on a register without the CFDI app is
						nothing at all. A stamp chip is a claim a cashier repeats to
						a customer, so it is absent rather than guessed.
					-->
				</div>
			</header>

			<div class="ledger-panel__body">
				<template v-if="items.length">
					<div class="ledger-panel__label">{{ __("Items · {0} lines", [items.length]) }}</div>
					<div v-for="(item, index) in items" :key="index" class="ledger-panel__line">
						<div class="ledger-panel__line-text">
							<div class="ledger-panel__line-name">{{ item.name }}</div>
							<div v-if="item.note" class="ledger-panel__line-note">{{ item.note }}</div>
						</div>
						<span class="reg-mono" data-money-role="ledger-panel-line">{{
							formatCurrency(item.amount)
						}}</span>
					</div>
				</template>

				<template v-if="tenders.length || hasChange">
					<div class="ledger-panel__label">{{ __("Payment") }}</div>
					<!-- The tender the TABLE cannot show: `viewInvoice` fetched this
					     whole document, so its `payments` rows are real here. -->
					<div v-for="(tender, index) in tenders" :key="`t-${index}`" class="ledger-panel__pair">
						<span class="ledger-panel__pair-label">{{ tender.mode }}</span>
						<span class="reg-mono" data-money-role="ledger-panel-tender">{{
							money(tender.amount)
						}}</span>
					</div>
					<div v-if="hasChange" class="ledger-panel__pair">
						<span class="ledger-panel__pair-label">{{ __("Change") }}</span>
						<span class="reg-mono" data-money-role="ledger-panel-change">{{
							money(changeAmount)
						}}</span>
					</div>
					<div v-if="outstanding > 0" class="ledger-panel__pair ledger-panel__pair--warning">
						<span class="ledger-panel__pair-label">{{ __("Balance due") }}</span>
						<span class="reg-mono" data-money-role="ledger-panel-outstanding">{{
							money(outstanding)
						}}</span>
					</div>
				</template>

				<!-- «Cliente» — the facts a counter reaches for while the customer
				     is still standing there (artboard `Facturas de la caja`,
				     08-24): the phone off the fetched doc, and the CRM's one-line
				     answer with a real door into it. Each row renders only when
				     its fact exists — absence, never a filler dash. -->
				<template v-if="contactPhone || crmFact">
					<div class="ledger-panel__label">{{ __("Customer") }}</div>
					<div v-if="contactPhone" class="ledger-panel__pair">
						<span class="ledger-panel__pair-label">{{ __("Phone") }}</span>
						<span class="reg-mono" data-testid="ledger-panel-phone">{{ contactPhone }}</span>
					</div>
					<div v-if="crmFact" class="ledger-panel__pair">
						<span class="ledger-panel__pair-label">CRM</span>
						<span data-testid="ledger-panel-crm">
							{{ crmFact.text }}
							<a
								v-if="crmFact.href"
								class="ledger-panel__link"
								:href="crmFact.href"
								target="_blank"
								rel="noopener"
								data-testid="ledger-panel-crm-link"
								>{{ __("open") }}</a
							>
						</span>
					</div>
				</template>

				<!-- «Origen» — only a ticket born in Taller has one to state. -->
				<template v-if="origin">
					<div class="ledger-panel__label">{{ __("Origin") }}</div>
					<div class="ledger-panel__pair">
						<span class="ledger-panel__pair-label">{{ __("Service Order") }}</span>
						<span class="reg-mono" data-testid="ledger-panel-origin">{{ origin.label }}</span>
					</div>
				</template>

				<div v-if="!detail" class="ledger-panel__pending" data-testid="ledger-panel-pending">
					{{ __("Press Enter to read this ticket") }}
				</div>
			</div>

			<footer class="ledger-panel__actions" data-testid="ledger-panel-actions">
				<!-- ONE filled button on this surface, and only here: collecting
				     the balance is what an unpaid row exists for. Everything else
				     is outlined, and the sale's band below stays the sale's. -->
				<button
					v-if="outstanding > 0"
					type="button"
					class="ledger-panel__action ledger-panel__primary"
					data-testid="ledger-action-collect"
					@click="$emit('collect')"
				>
					{{ __("Collect balance") }}
				</button>

				<button
					v-if="!row.isDraft"
					type="button"
					class="ledger-panel__action"
					data-testid="ledger-action-print"
					@click="$emit('print')"
				>
					{{ __("Print") }}
				</button>

				<button
					v-if="!row.isDraft && !row.isReturn"
					type="button"
					class="ledger-panel__action"
					data-testid="ledger-action-return"
					@click="$emit('return')"
				>
					{{ __("Return") }}
				</button>

				<button
					v-for="action in draftActions"
					:key="action"
					type="button"
					class="ledger-panel__action"
					:data-testid="`ledger-action-draft-${action}`"
					@click="$emit('draftAction', action)"
				>
					{{ draftActionLabel(action) }}
				</button>

				<button
					v-if="row.isDraft && canDeleteDraft"
					type="button"
					class="ledger-panel__action"
					data-testid="ledger-action-delete"
					@click="$emit('deleteDraft')"
				>
					{{ __("Delete") }}
				</button>

				<button
					v-if="repairState"
					type="button"
					class="ledger-panel__action"
					:disabled="repairBusy || offline"
					data-testid="ledger-action-repair"
					@click="$emit('repair')"
				>
					{{ __("Repair change") }}
				</button>

				<!--
					`Enviar CFDI` is NOT drawn. The register has no send path and no
					stamp call on this surface: stamping lives in
					`cfdi/FacturacionDialog.vue` against an already-submitted
					invoice, and nothing here can reach it without a new seam
					§15.3 puts out of scope. A button that promises to send a
					CFDI and does not is worse than no button.
				-->
			</footer>
		</template>
	</aside>
</template>

<script setup lang="ts">
/**
 * The selected ticket, beside the ledger (§15.2).
 *
 * It REPLACES the detail dialog while the surface is hosted; the dialog stays
 * for the floating modal below the rail boundary. Two states, and the
 * difference is honest rather than cosmetic: the header and the actions come
 * from the LIST row and are available the moment a row is highlighted, while
 * the lines and the tender come from `selectedInvoiceDetail` — the whole
 * document `viewInvoice` fetches — and appear once Enter has asked for it.
 *
 * Every action is an emit. This component calls no method and changes no
 * state; `InvoiceManagement.vue`'s own `printInvoice`, `createReturn`,
 * `openAddPayment`, `runDraftAction`, `deleteDraft` and
 * `repairChangeAllocation` are what actually run.
 */
import { computed } from "vue";

import type { LedgerRow, LedgerRowSource } from "./ledgerModel";
import { describeTicketOrigin, ticketDayLabel } from "./ledgerRows";
import { translate as __ } from "./ledgerText";
import type { CrmContext } from "../../../../services/crmService";

const props = withDefaults(
	defineProps<{
		row: LedgerRow | null;
		/** `selectedInvoiceDetail`, but only when it is THIS row's document. */
		detail: Record<string, any> | null;
		formatCurrency: (value: number) => string;
		formatFloat: (value: number) => string;
		currencySymbol?: string;
		/** `InvoiceManagement.isRepairCandidate`, passed rather than restated. */
		isRepairCandidate: (invoice: LedgerRowSource) => boolean;
		/** `InvoiceManagement.draftActions` and `.draftActionLabel`. */
		draftActionsFor: (invoice: LedgerRowSource) => string[];
		draftActionLabel: (action: string) => string;
		canDeleteDraft?: boolean;
		repairBusy?: boolean;
		offline?: boolean;
		/** The row's customer as the CRM knows them — fetched by the surface,
		 * probe-gated there; `null` while unknown or when the app is absent. */
		crm?: CrmContext | null;
	}>(),
	{ canDeleteDraft: false, repairBusy: false, offline: false, crm: null },
);

defineEmits<{
	print: [];
	return: [];
	collect: [];
	draftAction: [string];
	deleteDraft: [];
	repair: [];
}>();

const money = (value: number) => `${props.currencySymbol ?? ""}${props.formatCurrency(value)}`;

const who = computed(() => {
	const row = props.row;
	if (!row) return "";
	// The DATE rides between the cashier and the time: with «Por fecha» open
	// the list holds last week's tickets, and a bare «17:37» on one of those
	// reads as this afternoon. Same abbreviated format as the navbar clock.
	const day = ticketDayLabel(row.date, new Date());
	return [row.customer, row.cashier, day, row.time].filter(Boolean).join(" · ");
});

const contactPhone = computed(() => {
	const detail = props.detail;
	if (!detail) return "";
	return String(detail.contact_mobile || detail.contact_phone || "").trim();
});

/**
 * One line about the customer in the CRM, with a real door when there is one.
 *
 * A deal outranks a lead (money over interest), and «Sin registro en el CRM»
 * is stated rather than implied — the strip on the sale surface made the same
 * call, and a silent absence reads as "not loaded yet" rather than "nothing
 * there". No fact at all while the context has not arrived: the panel must
 * not claim an absence it has not confirmed.
 */
const crmFact = computed(() => {
	const context = props.crm;
	if (!context || !context.installed) return null;
	const deal = context.deals?.[0];
	if (deal) {
		const bits = [deal.status, deal.amount ? props.formatCurrency(deal.amount) : ""]
			.filter(Boolean)
			.join(" · ");
		return { text: bits || deal.name, href: `/crm/deals/${deal.name}` };
	}
	if (context.lead) {
		return {
			text: context.lead.status || context.lead.label || context.lead.name,
			href: `/crm/leads/${context.lead.name}`,
		};
	}
	return { text: __("Not in the CRM"), href: null };
});

/** The Taller order behind the ticket, off the fetched doc — see ledgerRows. */
const origin = computed(() => describeTicketOrigin(props.detail));

const outstanding = computed(() => Number(props.row?.raw?.outstanding_amount || 0));
const changeAmount = computed(() => Number(props.detail?.change_amount || 0));
const hasChange = computed(() => changeAmount.value > 0);

const repairState = computed(() =>
	props.row ? props.isRepairCandidate(props.row.raw) : false,
);

const draftActions = computed(() =>
	props.row?.isDraft ? props.draftActionsFor(props.row.raw) : [],
);

interface PanelLine {
	name: string;
	note: string;
	amount: number;
}

/** `IPN001880 · 2 × 120.00` — code plus how the amount was reached. */
const items = computed<PanelLine[]>(() => {
	const rows = props.detail?.items;
	if (!Array.isArray(rows)) return [];
	return rows.map((item: Record<string, any>) => {
		const qty = Number(item?.qty || 0);
		const rate = Number(item?.rate || 0);
		const parts = [item?.item_code, qty > 1 ? `${props.formatFloat(qty)} × ${props.formatCurrency(rate)}` : `${props.formatFloat(qty)} ×`];
		return {
			name: String(item?.item_name || item?.item_code || ""),
			note: parts.filter(Boolean).join(" · "),
			amount: Number(item?.amount || 0),
		};
	});
});

const tenders = computed(() => {
	const rows = props.detail?.payments;
	if (!Array.isArray(rows)) return [];
	return rows
		.filter((payment: Record<string, any>) => Number(payment?.amount || 0) !== 0)
		.map((payment: Record<string, any>) => ({
			mode: String(payment?.mode_of_payment || ""),
			amount: Number(payment?.amount || 0),
		}));
});
</script>

<style scoped>
.ledger-panel {
	width: 372px;
	flex: none;
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	box-shadow: 0 1px 2px rgba(16, 20, 30, 0.05);
	overflow: hidden;
}

.ledger-panel__blank {
	flex: 1;
	display: grid;
	place-items: center;
	padding: 32px 16px;
	text-align: center;
	font-size: 13px;
	color: var(--reg-text-muted, #667085);
}

.ledger-panel__head {
	flex: none;
	padding: 14px 16px 10px;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.ledger-panel__title {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
}

.ledger-panel__ticket {
	font-size: 15px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.ledger-panel__amount {
	font-size: 18px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.ledger-panel__who {
	margin-top: 2px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.ledger-panel__chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm, 6px);
	margin-top: 8px;
}

.ledger-panel__body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 8px 16px 14px;
}

.ledger-panel__label {
	margin: 12px 0 6px;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.ledger-panel__label:first-child {
	margin-top: 4px;
}

.ledger-panel__line {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	padding: 7px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f2f4f7);
	font-size: 12.5px;
	color: var(--reg-text-primary, #212121);
}

.ledger-panel__line-text {
	min-width: 0;
}

.ledger-panel__line-name {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ledger-panel__line-note {
	font-size: 11px;
	color: var(--reg-text-muted, #667085);
}

.ledger-panel__pair {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-lg, 14px);
	font-size: 12.5px;
	padding: 3px 0;
	color: var(--reg-text-primary, #212121);
}

.ledger-panel__pair-label {
	color: var(--reg-text-muted, #667085);
}

.ledger-panel__pair--warning,
.ledger-panel__pair--warning .ledger-panel__pair-label {
	color: var(--reg-tone-warning-label, #8a5a0d);
	font-weight: 600;
}

.ledger-panel__pending {
	margin-top: 14px;
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

/* The one door on a fact row. Accent as INK, never as a fill — the surface's
   single filled accent stays on «Cobrar saldo». */
.ledger-panel__link {
	color: var(--reg-accent, #0097a7);
	font-weight: 600;
	text-decoration: underline;
	text-underline-offset: 2px;
}

.ledger-panel__actions {
	flex: none;
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 12px 16px;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.ledger-panel__action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	height: 40px;
	padding: 0 14px;
	border: 1px solid var(--reg-border-soft, #e6e9ee);
	border-radius: var(--reg-radius-sm, 10px);
	background: var(--reg-surface, #fff);
	color: var(--reg-text-primary, #212121);
	font: inherit;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.ledger-panel__action:disabled {
	opacity: 0.5;
	cursor: default;
}

.ledger-panel__action:focus-visible {
	outline: 2px solid var(--reg-accent, #0097a7);
	outline-offset: 1px;
}

/* The surface's single accent. Named `__primary` because that is the naming
   `singleAccent.spec.ts` reads to tell an accent fill that belongs from one
   that does not. */
.ledger-panel__primary {
	background: var(--reg-accent, #0097a7);
	border-color: var(--reg-accent, #0097a7);
	color: var(--reg-on-accent, #fff);
}

/* ---- status chip (shared shape with the table) ------------------------ */

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
</style>
