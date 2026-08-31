<template>
	<div class="ledger-figures" data-testid="ledger-figures">
		<div class="ledger-figure" data-testid="ledger-figure-sold">
			<div class="ledger-figure__label">{{ __("Sold today") }}</div>
			<div
				v-if="figures.sold"
				class="ledger-figure__number reg-mono"
				data-money-role="ledger-sold"
			>
				{{ money(figures.sold.total) }}
			</div>
			<!-- Not loaded is not zero. A register that has not finished reading
			     the day must not announce an empty one. -->
			<div v-else class="ledger-figure__number ledger-figure__number--absent reg-mono">—</div>
			<div v-if="figures.sold" class="ledger-figure__meta">{{ soldMeta }}</div>
		</div>

		<div class="ledger-figure" data-testid="ledger-figure-receivable">
			<div class="ledger-figure__label">{{ __("Receivable") }}</div>
			<div
				v-if="figures.receivable"
				class="ledger-figure__number ledger-figure__number--warning reg-mono"
				data-money-role="ledger-receivable"
			>
				{{ money(figures.receivable.total) }}
			</div>
			<div v-else class="ledger-figure__number ledger-figure__number--absent reg-mono">—</div>
			<div v-if="figures.receivable" class="ledger-figure__meta">{{ receivableMeta }}</div>
		</div>

		<div class="ledger-figure" data-testid="ledger-figure-refunded">
			<div class="ledger-figure__label">{{ __("Refunded") }}</div>
			<div
				v-if="figures.refunded"
				class="ledger-figure__number ledger-figure__number--returned reg-mono"
				data-money-role="ledger-refunded"
			>
				{{ money(figures.refunded.total) }}
			</div>
			<div v-else class="ledger-figure__number ledger-figure__number--absent reg-mono">—</div>
			<div v-if="figures.refunded" class="ledger-figure__meta">{{ refundedMeta }}</div>
		</div>

		<!--
			`Timbrado 28 de 31 · 3 sin CFDI · 137 timbres restantes` — the
			artboard's fourth card — is DELIBERATELY not drawn.

			Nothing on the client can source any of its three numbers.
			`getInvoiceListFields` asks for no CFDI or stamp field, so a row
			cannot say whether it was stamped; `cfdiStore.ts` holds catalogs, a
			search and a stamp state machine, but no per-invoice state and no
			quota, and the endpoints behind it return neither. Adding the field
			is a `loadHistory` edit, which build plan §15.3 puts out of scope.

			A stamped count is a figure the cashier repeats to a customer, so a
			guessed one is worse than none at all. See `ledgerModel.ts`'s
			`LedgerFigures`, which has no `stamped` key for the same reason.
		-->
	</div>
</template>

<script setup lang="ts">
/**
 * The three figures over the ledger (§15.2), each with a real source.
 *
 * The arithmetic is `ledgerModel.describeFigures`; this file formats it. No
 * `total` money role appears anywhere on this surface — the sale's band below
 * the ledger owns that one number, and a second one here would be exactly the
 * duplication `registerSaysItOnce.spec.ts` exists to prevent.
 */
import { computed } from "vue";

import type { LedgerFigures } from "./ledgerModel";
import { translate as __ } from "./ledgerText";

const props = defineProps<{
	figures: LedgerFigures;
	/** The register's own formatter (`format.ts`), never a local one. */
	formatCurrency: (value: number) => string;
	currencySymbol?: string;
}>();

const money = (value: number) => `${props.currencySymbol ?? ""}${props.formatCurrency(value)}`;

const soldMeta = computed(() => {
	const sold = props.figures.sold;
	if (!sold) return "";
	if (!sold.count) return __("No sales yet today");
	return __("{0} tickets · average {1}", [sold.count, money(sold.average ?? 0)]);
});

const receivableMeta = computed(() => {
	const receivable = props.figures.receivable;
	if (!receivable) return "";
	if (!receivable.count) return __("Nothing outstanding");
	if (!receivable.overdue) return __("{0} invoices · none overdue", [receivable.count]);
	return __("{0} invoices · {1} overdue", [receivable.count, receivable.overdue]);
});

const refundedMeta = computed(() => {
	const refunded = props.figures.refunded;
	if (!refunded) return "";
	if (!refunded.count) return __("No refunds");
	if (!refunded.withoutTicket) return __("{0} refunds · all against a ticket", [refunded.count]);
	return __("{0} refunds · {1} with no ticket", [refunded.count, refunded.withoutTicket]);
});
</script>

<style scoped>
.ledger-figures {
	display: flex;
	gap: var(--reg-space-md, 10px);
	flex: none;
}

.ledger-figure {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 12px 16px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
	box-shadow: 0 1px 2px rgba(16, 20, 30, 0.05);
}

.ledger-figure__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label, #667085);
}

.ledger-figure__number {
	font-size: 22px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--reg-text-primary, #212121);
}

/* Amber and violet here are STATE on a FIGURE, which is the use invariant 2
   reserves them for — never a fill, and never on an action. */
.ledger-figure__number--warning {
	color: var(--reg-tone-warning-number, #8a5a0d);
}

.ledger-figure__number--returned {
	color: var(--reg-tone-returned-label, #5b3fb8);
}

.ledger-figure__number--absent {
	color: var(--reg-text-muted, #667085);
}

.ledger-figure__meta {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

/* ---- phones ----------------------------------------------------------- */

/* A row of three cards leaves ~100px each on a 360px phone and 22px money
   breaks across two lines. Below the phone boundary the figures pack two to a
   row, an odd last one spans the row, and every line truncates rather than
   wraps: money is never split. */
@media (max-width: 767.98px) {
	.ledger-figures {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.ledger-figure {
		padding: 10px 12px;
		gap: 2px;
	}

	.ledger-figure:nth-child(odd):last-child {
		grid-column: 1 / -1;
	}

	.ledger-figure__label,
	.ledger-figure__number,
	.ledger-figure__meta {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ledger-figure__number {
		font-size: 18px;
	}
}
</style>
