<template>
	<section class="credit-expenses" :aria-labelledby="headingId" data-testid="credit-expenses">
		<header class="credit-expenses__head">
			<h3 :id="headingId" class="credit-expenses__title">{{ __("Expenses") }}</h3>
			<span v-if="submittedRows.length" class="credit-expenses__total reg-mono" data-testid="credit-expenses-total">
				{{ __("Total {0}", [money(submittedTotal)]) }}
			</span>
		</header>
		<p class="credit-expenses__hint">
			{{ __("Cash paid out of this register for this sale, such as a delivery or an activation.") }}
		</p>

		<p v-if="loading" class="credit-expenses__empty" role="status">{{ __("Loading expenses…") }}</p>
		<div v-else-if="loadError" class="credit-expenses__notice" role="alert" data-testid="credit-expenses-error">
			<p>{{ loadError }}</p>
			<button type="button" class="credit-expenses__button" @click="loadRows">{{ __("Try again") }}</button>
		</div>
		<p v-else-if="!rows.length" class="credit-expenses__empty" data-testid="credit-expenses-empty">
			{{ __("No expenses recorded for this sale.") }}
		</p>
		<ul v-else class="credit-expenses__list">
			<li
				v-for="row in rows"
				:key="row.name"
				class="credit-expenses__row"
				:class="{ 'credit-expenses__row--cancelled': isCancelled(row) }"
				:data-testid="`credit-expense-${row.name}`"
			>
				<div class="credit-expenses__row-top">
					<strong class="credit-expenses__what">{{ row.remarks || row.expense_account }}</strong>
					<span class="credit-expenses__amount reg-mono">{{ money(row.amount) }}</span>
				</div>
				<div class="credit-expenses__row-meta">
					<small>{{ [formatDate(row.posting_date), row.expense_account, row.user_name].filter(Boolean).join(" · ") }}</small>
					<CreditChip v-if="isCancelled(row)" tone="neutral">{{ __("Cancelled") }}</CreditChip>
				</div>
			</li>
		</ul>

		<template v-if="editable">
			<p v-if="contextLoading" class="credit-expenses__empty" role="status">{{ __("Checking the register…") }}</p>
			<div
				v-else-if="blockedReason"
				class="credit-expenses__notice"
				role="note"
				data-testid="credit-expenses-blocked"
			>
				<p>{{ blockedReason }}</p>
				<button v-if="contextError" type="button" class="credit-expenses__button" @click="loadRegister">
					{{ __("Try again") }}
				</button>
			</div>
			<button
				v-else-if="!formOpen"
				type="button"
				class="credit-expenses__button credit-expenses__add"
				data-testid="credit-expense-add"
				@click="openForm"
			>
				<v-icon icon="mdi-cash-minus" size="18" aria-hidden="true" />
				{{ __("Add expense") }}
			</button>
			<form
				v-else
				class="credit-expenses__form"
				data-testid="credit-expense-form"
				novalidate
				@submit.prevent="submit"
			>
				<label class="credit-expenses__field">
					<span>{{ __("Amount") }}</span>
					<input
						ref="amountInput"
						v-model="form.amount"
						type="number"
						inputmode="decimal"
						min="0"
						step="any"
						required
						data-testid="credit-expense-amount"
					/>
					<small v-if="maxAmount > 0">{{ __("Up to {0} per expense.", [money(maxAmount)]) }}</small>
				</label>
				<label v-if="accounts.length > 1" class="credit-expenses__field">
					<span>{{ __("Expense account") }}</span>
					<select v-model="form.account" data-testid="credit-expense-account">
						<option v-for="account in accounts" :key="account" :value="account">{{ account }}</option>
					</select>
				</label>
				<div v-else class="credit-expenses__field">
					<span>{{ __("Expense account") }}</span>
					<strong class="credit-expenses__fixed" data-testid="credit-expense-account-fixed">{{ accounts[0] }}</strong>
				</div>
				<label class="credit-expenses__field">
					<span>{{ remarksRequired ? __("Remarks (required)") : __("Remarks") }}</span>
					<textarea
						v-model="form.remarks"
						rows="2"
						maxlength="500"
						:required="remarksRequired"
						:placeholder="__('What was it for?')"
						data-testid="credit-expense-remarks"
					></textarea>
				</label>
				<p v-if="formError" class="credit-expenses__error" role="alert" data-testid="credit-expense-error">
					{{ formError }}
				</p>
				<div class="credit-expenses__form-actions">
					<button type="button" class="credit-expenses__button" :disabled="submitting" @click="closeForm">
						{{ __("Cancel") }}
					</button>
					<button
						type="submit"
						class="credit-expenses__button credit-expenses__submit"
						:disabled="submitting"
						data-testid="credit-expense-save"
					>
						{{ submitting ? __("Saving…") : __("Save expense") }}
					</button>
				</div>
			</form>
		</template>
	</section>
</template>

<script setup lang="ts">
/**
 * Till expenses paid for one credit sale («gastos»), next to the sale.
 *
 * An expense here is the register's ordinary POS «Gasto» — the same POS Cash
 * Movement and Journal Entry `CashMovementView` creates — carrying a link to
 * the Sales Invoice, so it comes out of THIS register's open shift and follows
 * this register's cash policy (movements on, expenses allowed, the expense
 * accounts, remarks, the per-movement cap). When the policy says no, the panel
 * says why instead of hiding the action.
 *
 * One client request id per open form: a retry after a lost answer reuses it,
 * and the server returns the movement it already made instead of paying the
 * expense twice.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { storeToRefs } from "pinia";

import CreditChip from "./CreditChip.vue";
import { getCreditSaleExpenses, type CreditExpenseRow } from "./creditApi";
import { describeError, formatDate, formatMoney, translate as __ } from "./creditFormat";
import { useCashMovement } from "../../../composables/pos/cash/useCashMovement";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";

const props = defineProps<{
	invoice: string;
	currency: string;
	editable: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

const headingId = `credit-expenses-${useId()}`;

const { posProfile, posOpeningShift } = storeToRefs(useUIStore());
const toastStore = useToastStore();
const { context, submitting, loadContext, submitMovement } = useCashMovement();

const rows = ref<CreditExpenseRow[]>([]);
const loading = ref(false);
const loadError = ref("");
const contextLoading = ref(false);
const contextError = ref("");
const formOpen = ref(false);
const formError = ref("");
const amountInput = ref<HTMLInputElement | null>(null);
const form = reactive({ amount: "" as string | number, account: "", remarks: "" });
let requestId = "";
let rowsRequest = 0;
let disposed = false;

const profileName = computed(() => String(posProfile.value?.name || ""));
const shiftName = computed(() => String(posOpeningShift.value?.name || ""));

const money = (value: unknown) => formatMoney(value, props.currency);
const isCancelled = (row: CreditExpenseRow) => Number(row.docstatus) === 2;
const submittedRows = computed(() => rows.value.filter((row) => Number(row.docstatus) === 1));
const submittedTotal = computed(() =>
	submittedRows.value.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
);

const accounts = computed<string[]>(() => {
	const allowed = context.value?.allowed_expense_accounts;
	const list = Array.isArray(allowed) ? allowed.filter((account: unknown) => typeof account === "string" && account) : [];
	if (list.length) return list;
	const fallback = context.value?.default_expense_account;
	return fallback ? [String(fallback)] : [];
});

/** The server's own choice: the profile default when it is allowed, else the first allowed. */
const defaultAccount = computed(() => {
	const preferred = context.value?.default_expense_account;
	return preferred && accounts.value.includes(preferred) ? String(preferred) : accounts.value[0] || "";
});

const remarksRequired = computed(() => Boolean(context.value?.require_cash_movement_remarks));
const maxAmount = computed(() => Number(context.value?.cash_movement_max_amount) || 0);

const blockedReason = computed(() => {
	if (!profileName.value || !shiftName.value) {
		return __("Open a shift on this register to pay an expense for this sale.");
	}
	if (contextError.value) return contextError.value;
	const policy = context.value;
	if (!policy) return "";
	if (!policy.enable_cash_movement) return __("Cash movements are turned off for this register.");
	if (!policy.allow_pos_expense) return __("Expenses are turned off for this register.");
	if (!accounts.value.length) return __("This register has no expense account set up.");
	return "";
});

const newRequestId = (): string => {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === "function") return `credit-expense-${cryptoApi.randomUUID()}`;
	const bytes = new Uint8Array(16);
	cryptoApi.getRandomValues(bytes);
	return `credit-expense-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

async function loadRows() {
	const request = ++rowsRequest;
	const invoice = props.invoice;
	loading.value = true;
	loadError.value = "";
	try {
		const result = await getCreditSaleExpenses(invoice);
		if (disposed || request !== rowsRequest) return;
		rows.value = Array.isArray(result) ? result : [];
	} catch (error) {
		if (disposed || request !== rowsRequest) return;
		loadError.value = describeError(error, __("Expenses could not be loaded. Check the connection and try again."));
	} finally {
		if (!disposed && request === rowsRequest) loading.value = false;
	}
}

async function loadRegister() {
	if (!props.editable || !profileName.value || !shiftName.value) return;
	contextLoading.value = true;
	contextError.value = "";
	try {
		await loadContext(profileName.value, shiftName.value);
	} catch (error) {
		if (!disposed) {
			contextError.value = describeError(error, __("The register's expense settings could not be loaded."));
		}
	} finally {
		if (!disposed) contextLoading.value = false;
	}
}

function openForm() {
	form.amount = "";
	form.account = defaultAccount.value;
	form.remarks = "";
	formError.value = "";
	requestId = newRequestId();
	formOpen.value = true;
	void nextTick(() => amountInput.value?.focus());
}

function closeForm() {
	formOpen.value = false;
	formError.value = "";
}

async function submit() {
	if (submitting.value) return;
	formError.value = "";
	const amount = Number(form.amount);
	if (!Number.isFinite(amount) || amount <= 0) {
		formError.value = __("Enter an amount greater than zero.");
		return;
	}
	if (remarksRequired.value && !form.remarks.trim()) {
		formError.value = __("Write what the expense was for.");
		return;
	}
	try {
		await submitMovement({
			movementType: "Expense",
			amount,
			remarks: form.remarks.trim(),
			posProfileName: profileName.value,
			posOpeningShiftName: shiftName.value,
			expenseAccount: form.account || defaultAccount.value || undefined,
			clientRequestId: requestId,
			salesInvoice: props.invoice,
		});
	} catch (error) {
		if (!disposed) {
			formError.value = describeError(error, __("The expense was not saved. Check the connection and try again."));
		}
		return;
	}
	if (disposed) return;
	toastStore.show({ title: __("Expense recorded"), color: "success" });
	closeForm();
	await loadRows();
	emit("changed");
}

watch(
	() => props.invoice,
	() => {
		closeForm();
		rows.value = [];
		void loadRows();
	},
);

watch(
	() => [props.editable, profileName.value, shiftName.value],
	() => void loadRegister(),
);

onMounted(() => {
	void loadRows();
	void loadRegister();
});

onBeforeUnmount(() => {
	disposed = true;
});
</script>

<style scoped>
.credit-expenses {
	display: grid;
	gap: var(--reg-space-md);
	min-width: 0;
	color: var(--reg-text-primary);
}

.credit-expenses__head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--reg-space-sm);
}

.credit-expenses__title {
	margin: 0;
	font-size: 16px;
	font-weight: 700;
}

.credit-expenses__total {
	font-size: 15px;
	font-weight: 700;
}

.credit-expenses__hint,
.credit-expenses__empty {
	margin: 0;
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-expenses__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
}

.credit-expenses__row {
	display: grid;
	gap: 2px;
	padding: var(--reg-space-md) 0;
	border-bottom: 1px solid var(--reg-divider-soft);
}

.credit-expenses__row-top {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	gap: var(--reg-space-md);
}

.credit-expenses__what {
	min-width: 0;
	font-size: 14px;
	overflow-wrap: anywhere;
}

.credit-expenses__amount {
	flex: none;
	font-size: 15px;
	font-weight: 700;
}

.credit-expenses__row-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm);
}

.credit-expenses__row-meta small {
	font-size: 12px;
	color: var(--reg-text-muted);
	overflow-wrap: anywhere;
}

.credit-expenses__row--cancelled .credit-expenses__what,
.credit-expenses__row--cancelled .credit-expenses__amount {
	color: var(--reg-text-muted);
	text-decoration: line-through;
}

.credit-expenses__notice {
	display: grid;
	gap: var(--reg-space-sm);
	justify-items: start;
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px solid var(--reg-tone-warning-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-tone-warning-bg);
	color: var(--reg-tone-warning-label);
	font-size: 13px;
}

.credit-expenses__notice p {
	margin: 0;
}

.credit-expenses__notice .credit-expenses__button {
	color: var(--reg-text-primary);
}

.credit-expenses__button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: var(--reg-space-xs);
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
	transition: transform var(--motion-fast) var(--ease-out);
}

.credit-expenses__button:active:not(:disabled) {
	transform: scale(var(--press-scale));
}

.credit-expenses__button:disabled {
	opacity: 0.55;
	cursor: default;
}

.credit-expenses__add {
	justify-self: start;
}

/* The form's own action is a wash with accent ink, not a fill: the one
   saturated accent on screen belongs to the host's primary action. */
.credit-expenses__submit {
	border-color: var(--reg-accent-edge);
	background: var(--reg-accent-soft);
	color: var(--reg-on-accent-soft);
}

.credit-expenses__form {
	display: grid;
	gap: var(--reg-space-md);
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-sunken);
}

.credit-expenses__field {
	display: grid;
	gap: var(--reg-space-2xs);
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-expenses__field :is(input, select, textarea) {
	min-height: var(--reg-touch-min);
	padding: var(--reg-space-sm) var(--reg-space-md);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
	font-size: 15px;
}

.credit-expenses__field input {
	font-variant-numeric: tabular-nums;
}

.credit-expenses__field textarea {
	resize: vertical;
}

.credit-expenses__field small {
	font-size: 12px;
	color: var(--reg-text-muted);
}

.credit-expenses__fixed {
	color: var(--reg-text-primary);
	font-size: 14px;
	overflow-wrap: anywhere;
}

.credit-expenses__error {
	margin: 0;
	padding: var(--reg-space-sm) var(--reg-space-md);
	border: 1px solid var(--reg-tone-negative-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-tone-negative-bg);
	color: var(--reg-tone-negative-label);
	font-size: 13px;
	white-space: pre-line;
}

.credit-expenses__form-actions {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--reg-space-sm);
}

.credit-expenses :is(button, input, select, textarea):focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}

@media (max-width: 599.98px) {
	.credit-expenses__form-actions .credit-expenses__button {
		flex: 1 1 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.credit-expenses__button {
		transition: none;
	}
}
</style>
