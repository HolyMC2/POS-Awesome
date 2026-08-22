<template>
	<!-- Single root: a top-level comment would make this a fragment and break
	     `wrapper.attributes()` (build plan §10). -->
	<section
		v-if="renders"
		class="pay-summary"
		data-testid="pay-sale-summary"
		:aria-label="__('Sale summary')"
	>
		<header class="pay-summary__head">
			<span class="pay-summary__label">{{ __("Sale summary") }}</span>
			<span class="pay-summary__count mono" data-testid="pay-summary-count">
				{{ countLabel }}
			</span>
		</header>

		<ol class="pay-summary__lines" data-testid="pay-summary-lines">
			<li
				v-for="line in summary.lines"
				:key="line.key"
				class="pay-summary__line"
				:class="{ 'pay-summary__line--combo': line.isCombo }"
				:data-testid="line.isCombo ? 'pay-summary-line-combo' : 'pay-summary-line'"
			>
				<span class="pay-summary__body">
					<span class="pay-summary__name">{{ line.itemName }}</span>
					<!-- One meta row, and which one depends on what the line IS.
					     A combo's identity is its parts and what they saved; an
					     ordinary line's is the code the cashier reads off the
					     shelf tag and how many went in. -->
					<span
						v-if="line.isCombo"
						class="pay-summary__meta pay-summary__meta--combo mono"
						data-testid="pay-summary-combo-meta"
					>
						{{ componentsLabel(line)
						}}<template v-if="line.saving > 0">
							·
							<span data-money-role="line-saving">{{ savingLabel(line) }}</span>
						</template>
					</span>
					<!-- The unit rate gets its own element because it is a money
					     figure and every money figure on this screen declares
					     what it is (`cobroSaysItOnce.spec.ts`). -->
					<span v-else class="pay-summary__meta mono"
						><template v-if="line.itemCode">{{ line.itemCode }} · </template
						>{{ line.qty }} ×<template v-if="line.showsUnitRate"
							><!-- interpolated, because the compiler condenses a
							     literal space between two elements away -->{{ " "
							}}<span data-money-role="unit-rate">{{
								formatCurrency(line.rate)
							}}</span></template
						></span
					>
				</span>
				<span class="pay-summary__amount mono" data-money-role="line">{{
					formatCurrency(line.amount)
				}}</span>
			</li>
		</ol>

		<!-- The wallet, when the customer has one the register can read. -->
		<div v-if="wallet.visible" class="pay-summary__wallet" data-testid="pay-summary-wallet">
			<div class="pay-summary__wallet-top">
				<span class="pay-summary__wallet-title">{{ walletTitle }}</span>
				<span class="pay-summary__wallet-balance mono" data-money-role="wallet">{{
					formatCurrency(wallet.balance)
				}}</span>
			</div>
			<div
				v-if="wallet.accrual !== null"
				class="pay-summary__wallet-accrual"
				data-testid="pay-summary-wallet-accrual"
			>
				{{ __("Earns") }}
				<span class="mono" data-money-role="wallet-accrual">{{
					formatCurrency(wallet.accrual)
				}}</span>
				{{ __("with this purchase") }}
			</div>
		</div>

		<!--
			TWO BLOCKS THE ARTBOARD DRAWS AND THIS DOES NOT.

			**The totals.** `Cobro.dc.html` closes this card with Subtotal / IVA /
			Total. Our payment screen already carries all three in
			`InvoiceTotals`, one column over. Drawing them again would put the
			ticket's total on the screen twice, which is the exact defect W25-A
			removed from the sale surface — and it is why nothing in this file
			declares `data-money-role="total"`.

			**The warranty.** "Fundas y adaptadores · 30 días" is a promise the
			printed ticket makes, and this app has no read model for it: nothing
			in posawesome reads `Item.warranty_period`, no warranty field reaches
			a cart line, and no per-category policy exists anywhere in the tree.
			Rendering a plausible one would print a promise the shop never made.
			Absent, with the path to build it in this task's report.
		-->
	</section>
</template>

<script setup lang="ts">
/**
 * The sale, line by line, on the payment screen (§12 item B).
 *
 * Presentation only. It reads the cart it is handed and draws it; it holds no
 * state, emits no event and cannot change a peso.
 *
 * WHEN IT RENDERS. Only when the cart is NOT already on screen. The desk's
 * anchored layout keeps the cart column beside the payment column, and a
 * second copy of the same six lines two hundred pixels away is duplication,
 * not convergence. In the payment DIALOG (96vw over a scrim) and on the phone
 * sheet the cart is gone, and that is where the artboard's summary earns its
 * place.
 */
import { computed } from "vue";

import { resolveSaleSummary, type SaleSummaryLine, type SaleSummarySourceLine } from "./saleSummary";
import { resolveWalletSummary, type WalletSummaryInput } from "./walletSummary";

const props = withDefaults(
	defineProps<{
		items?: readonly (SaleSummarySourceLine | null | undefined)[] | null;
		/** Whether the cart is visible elsewhere on this screen. */
		cartOnScreen?: boolean;
		wallet?: WalletSummaryInput | null;
		formatCurrency: (_value: number) => string;
	}>(),
	{
		items: () => [],
		cartOnScreen: false,
		wallet: null,
	},
);

// Bare `__` is a Frappe desk global; absent under vitest and in a bare mount.
const __ = (value: string): string =>
	typeof window !== "undefined" && (window as any).__ ? (window as any).__(value) : value;

const summary = computed(() => resolveSaleSummary(props.items));
const wallet = computed(() => resolveWalletSummary(props.wallet));

/** An empty cart has nothing to summarise, and neither does a visible one. */
const renders = computed(() => !props.cartOnScreen && summary.value.lines.length > 0);

const walletTitle = computed(() =>
	wallet.value.kind === "loyalty" ? __("Customer points") : __("Customer wallet"),
);

/**
 * `6 lines · 9 pcs`. Assembled here rather than in the module because the
 * separator and the pluralisation are language, and the module is pure.
 */
const countLabel = computed(
	() => `${summary.value.lineCount} ${__("lines")} · ${summary.value.pieceCount} ${__("pcs")}`,
);

/** `3 items` — what the bundle contains, not what it costs. */
const componentsLabel = (line: SaleSummaryLine): string =>
	`${line.componentCount} ${__("items")}`;

const savingLabel = (line: SaleSummaryLine): string =>
	`${__("saved")} ${props.formatCurrency(line.saving)}`;

/*
 * `IPN001880 · 2 × 120.00`, and `IPN001545 · 1 ×` for one of something — the
 * artboard's own treatment, assembled in the template rather than here so the
 * unit rate can carry its own `data-money-role`. The rate on a single-qty line
 * would restate the amount already on the row, which is why it is conditional.
 */

</script>

<style scoped>
.pay-summary {
	display: flex;
	flex-direction: column;
	min-height: 0;
	gap: var(--reg-space-md, 10px);
	padding: var(--reg-space-lg, 14px);
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

.pay-summary__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
}

.pay-summary__label {
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.pay-summary__count {
	font-size: 11.5px;
	color: var(--reg-text-muted, #667085);
}

.pay-summary__lines {
	/* The card is one scrollport inside the screen's chain; the list is what
	   gives when the ticket is long, never the wallet below it. */
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	margin: 0;
	padding: 0;
	list-style: none;
	border-top: 1px solid var(--reg-divider-soft, #f2f4f7);
}

.pay-summary__line {
	display: flex;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	padding: 7px 0;
	border-bottom: 1px solid var(--reg-divider-soft, #f5f7f9);
}

.pay-summary__line:last-child {
	border-bottom: 0;
}

/* Amber left edge on a combo, matching `ComboCartLine`: this row is not an
   item, it is several. STATE colour — the accent stays on the primary. */
.pay-summary__line--combo {
	border-left: 3px solid #e9a13b;
	padding-left: 9px;
}

.pay-summary__body {
	display: flex;
	flex-direction: column;
	min-width: 0;
	gap: 2px;
}

.pay-summary__name {
	font-size: 13px;
	color: var(--reg-text-primary, #212121);
}

.pay-summary__meta {
	font-size: 10px;
	color: var(--reg-text-muted, #8a93a0);
}

.pay-summary__meta--combo {
	color: #8a5a0d;
}

.pay-summary__amount {
	font-size: 13px;
	white-space: nowrap;
	color: var(--reg-text-primary, #212121);
}

.pay-summary__wallet {
	flex: none;
	padding: 11px 13px;
	border-radius: var(--reg-radius-sm, 11px);
	background: var(--reg-tone-positive-bg, #f0fbf4);
	border: 1px solid var(--reg-tone-positive-border, #cdead8);
}

.pay-summary__wallet-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
}

.pay-summary__wallet-title {
	font-size: 12.5px;
	font-weight: 700;
	color: #14603a;
}

.pay-summary__wallet-balance {
	font-size: 16px;
	font-weight: 700;
	color: var(--reg-tone-positive-number, #157a48);
}

.pay-summary__wallet-accrual {
	margin-top: 3px;
	font-size: 11px;
	color: #2f7a55;
}

.mono {
	font-family: "Roboto Mono", ui-monospace, monospace;
	font-variant-numeric: tabular-nums;
}
</style>
