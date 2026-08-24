<template>
	<div class="cliente-wallet" data-testid="cliente-wallet">
		<!-- the card itself -->
		<section class="cliente-wallet__card">
			<header class="cliente-wallet__card-head">
				<span class="cliente-wallet__label">{{ walletTitle }}</span>
				<span
					v-if="wallet.enrolled && wallet.cashbackPercent !== null"
					class="cliente-wallet__chip"
					data-testid="cliente-wallet-rate"
					>{{ rateLabel }}</span
				>
			</header>

			<p class="cliente-wallet__balance mono" data-testid="cliente-wallet-balance">
				{{ formatCurrency(wallet.balance) }}
			</p>

			<!-- Provenance, not a second total. The balance is one spendable
			     figure; this line says which half was paid in and which half was
			     earned, and it renders only for the halves the server named. -->
			<p
				v-if="provenance"
				class="cliente-wallet__provenance"
				data-testid="cliente-wallet-provenance"
			>
				{{ provenance }}
			</p>

			<div class="cliente-wallet__actions">
				<v-btn
					class="cliente-wallet__primary"
					color="primary"
					variant="flat"
					size="large"
					prepend-icon="mdi-plus"
					data-testid="cliente-wallet-deposit"
					@click="depositOpen = true"
				>
					{{ __("Make a deposit") }}
				</v-btn>
				<!-- A STUB, and it says so rather than pretending. Card stock,
				     a layout and a printer profile are a piece of work of their
				     own; a button that opened a print dialog and produced
				     nothing would be worse than one that is honestly not ready.
				     Tracked as an open item in this task's report. -->
				<v-btn
					variant="outlined"
					size="large"
					disabled
					prepend-icon="mdi-card-account-details-outline"
					data-testid="cliente-wallet-print"
					:title="__('Card printing is not built yet.')"
				>
					{{ __("Print card") }}
				</v-btn>
			</div>

			<p class="cliente-wallet__note">
				{{ __("Spent at checkout as a means of payment.") }}
				{{ __("The deposit lands in this register's count.") }}
			</p>

			<!-- Enrolment lives INSIDE the card, under the money, because the
			     money is real whether or not there is a programme: a customer
			     can hold monedero with no cashback at all. What «Activar» adds
			     is the earning half — so it replaces the cashback body, not the
			     balance. -->
			<div v-if="!wallet.enrolled" class="cliente-wallet__enrol">
				<p class="cliente-wallet__enrol-note">{{ __("Not on the cashback programme.") }}</p>
				<v-btn
					variant="outlined"
					size="small"
					:loading="enrolling"
					data-testid="cliente-wallet-enroll"
					@click="activate"
				>
					{{ __("Activate card") }}
				</v-btn>
			</div>

			<p
				v-if="enrolError"
				class="cliente-wallet__enrol-error"
				data-testid="cliente-wallet-enroll-error"
			>
				{{ enrolError }}
			</p>
		</section>

		<!-- how the card behaves at the register -->
		<section class="cliente-wallet__next" data-testid="cliente-wallet-next">
			<span class="cliente-wallet__label">{{ __("On the next purchase") }}</span>
			<div class="cliente-wallet__row">
				<span>{{ __("Can pay up to") }}</span>
				<span class="mono cliente-wallet__row-figure">{{
					formatCurrency(wallet.balance)
				}}</span>
			</div>
			<div v-if="preview" class="cliente-wallet__row" data-testid="cliente-wallet-accrual">
				<span>{{ accrualLabel }}</span>
				<span class="mono cliente-wallet__row-figure cliente-wallet__row-figure--in"
					>+{{ formatCurrency(preview.value) }}</span
				>
			</div>
		</section>

		<!-- movements -->
		<ClienteMovements
			:movements="wallet.movements"
			:cap="wallet.cap"
			:format-currency="formatCurrency"
		/>

		<ClienteDepositDialog
			v-if="depositMounted"
			v-model="depositOpen"
			:pos-profile="posProfile"
			:customer="customer"
			:customer-label="customerLabel"
			:tenders="tenders"
			@deposited="$emit('refresh')"
		/>
	</div>
</template>

<script setup lang="ts">
/**
 * The monedero card — the balance, what it does at the till, and the two acts
 * on it (artboard `Cliente.dc.html`, left column). The ledger beneath it is
 * `ClienteMovements`, which needs nothing but rows.
 *
 * PRESENTATIONAL ABOUT THE BALANCE, ACTIVE ABOUT THE ACTS. The wallet is
 * fetched by `ClienteView` and handed down, because the header's card-state
 * chip reads the same object and two fetchers would let the chip and the card
 * disagree on screen. What lives here is the pair of things a cashier DOES —
 * depositing and activating — and both re-read through the parent rather than
 * patching a figure locally, so what is on screen is what the server holds.
 *
 * THE ACCRUAL LINE IS A SERVER FIGURE OR IT IS ABSENT. `walletSummary.ts` says
 * why at length: the accrual is `cint(eligible / collection_factor) ×
 * conversion_factor` and `collection_factor` has never been on a payload the
 * SPA holds. `get_cashback_preview` is that missing half, and when it does not
 * answer the line does not render — never a zero, never a client-side guess.
 *
 * THE EXAMPLE PURCHASE IS AN EXAMPLE, AND IT SAYS SO. The artboard asks «what
 * would this customer earn», which has no answer without a basket; a fixed
 * $500 in the label is honest, while quietly using the open cart's total would
 * put a figure on this screen that changes while nobody is looking at it.
 */
import { computed, ref, watch } from "vue";

import { useToastStore } from "../../../stores/toastStore";
import ClienteDepositDialog from "./ClienteDepositDialog.vue";
import ClienteMovements from "./ClienteMovements.vue";
import type { CashbackPreview, CustomerWallet } from "./customerCard";
import { enrollCustomerCard, fetchCashbackPreview, refusalText } from "./customerCardService";

/** The basket the accrual line reasons about, stated on screen. */
const EXAMPLE_PURCHASE = 500;

const props = defineProps<{
	wallet: CustomerWallet;
	customer: string;
	customerLabel: string;
	company: string;
	posProfile: string;
	/** Mode-of-payment names from the profile — the only tenders allowed. */
	tenders: string[];
	formatCurrency: (value: number) => string;
}>();

const emit = defineEmits<{ refresh: [] }>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const depositOpen = ref(false);
// Once opened it stays mounted, so re-opening does not re-import the chunk.
const depositMounted = ref(false);
watch(depositOpen, (open) => {
	if (open) depositMounted.value = true;
});

const enrolling = ref(false);
const enrolError = ref("");
const preview = ref<CashbackPreview | null>(null);

const walletTitle = computed(() =>
	__("{0}'s wallet").replace("{0}", props.customerLabel || __("Customer")),
);

const rateLabel = computed(() =>
	__("Cashback {0}%").replace("{0}", String(props.wallet.cashbackPercent ?? "")),
);

const accrualLabel = computed(() =>
	__("Would earn on a {0} purchase").replace("{0}", props.formatCurrency(EXAMPLE_PURCHASE)),
);

/**
 * «$390 depositados · $28 de cashback acumulado».
 *
 * Both halves or neither: a line that named only the deposited half beside a
 * larger balance would read as an arithmetic error rather than as a partial
 * answer, and the server sends both or sends neither.
 */
const provenance = computed(() => {
	const { deposited, cashbackValue } = props.wallet;
	if (deposited === null || cashbackValue === null) return "";
	return __("{0} deposited · {1} earned")
		.replace("{0}", props.formatCurrency(deposited))
		.replace("{1}", props.formatCurrency(cashbackValue));
});

async function activate() {
	if (enrolling.value) return;
	enrolling.value = true;
	enrolError.value = "";
	try {
		await enrollCustomerCard(props.posProfile, props.customer);
		useToastStore().show({
			title: __("Activate card"),
			message: __("The card is active."),
			color: "success",
		});
		emit("refresh");
	} catch (error) {
		// In place, not as a toast: the reason is usually a profile that has no
		// programme designated, which is a thing somebody has to go and fix.
		enrolError.value = refusalText(error, __("The card was not activated."));
	} finally {
		enrolling.value = false;
	}
}

async function loadPreview() {
	preview.value = props.wallet.enrolled
		? await fetchCashbackPreview(props.customer, props.company, EXAMPLE_PURCHASE)
		: null;
}

watch(
	() => [props.customer, props.company, props.wallet.enrolled] as const,
	() => void loadPreview(),
	{ immediate: true },
);
</script>

<style scoped>
.cliente-wallet {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-lg, 14px);
	min-height: 0;
}

.cliente-wallet__card,
.cliente-wallet__next,
/* The one card on the surface that carries the brand, as a WASH — the pale
 * derivative `singleAccent.spec.ts` explicitly permits, not a fill. The
 * saturated accent on this screen belongs to «Depositar» alone. */
.cliente-wallet__card {
	border-color: var(--reg-accent-edge, #9fdde6);
	background: color-mix(in srgb, var(--pos-primary) 8%, var(--reg-surface));
	padding: 18px;
}

.cliente-wallet__card-head,
.cliente-wallet__label {
	font-size: 0.66rem;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #667085);
}

.cliente-wallet__chip {
	border-radius: 999px;
	padding: 3px 9px;
	background: var(--reg-surface, #fff);
	color: var(--reg-on-accent-soft, #00646f);
	font-size: 0.72rem;
	font-weight: 700;
	white-space: nowrap;
}

.cliente-wallet__balance {
	margin: 8px 0 0;
	font-size: 3rem;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.05;
	color: var(--reg-text-primary, #212121);
}

.cliente-wallet__provenance {
	margin: 6px 0 0;
	font-size: 0.72rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-wallet__actions {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	margin-top: 16px;
}

.cliente-wallet__primary {
	/* The artboard's DEPOSITAR. Uppercased here rather than in the source
	 * string, so the Spanish row stays a normal sentence-case word. */
	text-transform: uppercase;
	font-weight: 700;
}

.cliente-wallet__note {
	margin: 10px 0 0;
	font-size: 0.68rem;
	line-height: 1.45;
	color: var(--reg-text-muted, #667085);
}

.cliente-wallet__enrol {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-md, 10px);
	margin-top: var(--reg-space-lg, 14px);
	padding-top: var(--reg-space-md, 10px);
	border-top: 1px dashed var(--reg-border-soft, #e6e9ee);
}

.cliente-wallet__enrol-note {
	margin: 0;
	font-size: 0.75rem;
	color: var(--reg-text-secondary, #56606e);
}

.cliente-wallet__enrol-error {
	margin: var(--reg-space-md, 10px) 0 0;
	font-size: 0.75rem;
	color: var(--reg-tone-negative-label, #b42318);
}

.cliente-wallet__row {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	margin-top: 6px;
	font-size: 0.78rem;
	color: var(--reg-text-secondary, #4a5260);
}

.cliente-wallet__row-figure {
	color: var(--reg-text-primary, #212121);
	font-weight: 700;
}

.cliente-wallet__row-figure--in {
	color: var(--reg-tone-positive-number, #157a48);
}

.mono {
	font-variant-numeric: tabular-nums;
}
</style>
