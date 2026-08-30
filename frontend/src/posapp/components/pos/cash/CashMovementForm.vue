<template>
	<v-card class="pos-themed-card cash-movement-form__card">
		<!-- E2: ONE name per card. The destination is already called Gasto on
		     the rail; this card is the verb («register a movement»), the card
		     beside it is the record. And the posting date is a FIELD, not
		     chrome — it lives in the grid with its peers instead of floating
		     alone in the corner of the title row. -->
		<div class="cash-movement-form__head">
			<div class="cash-movement-form__title">{{ __("New movement") }}</div>
		</div>
		<div class="cash-movement-form__subtitle">
			{{ __("Book an expense, send cash to the back office, or bring cash into the drawer.") }}
		</div>

		<v-alert
			v-if="enabled && !allowExpense && !allowDeposit"
			type="warning"
			variant="tonal"
			density="compact"
			class="mb-3"
		>
			{{ __("No cash movement type is allowed for this POS Profile.") }}
		</v-alert>

		<v-row dense>
			<!-- Type leads the form: it decides the direction, so it is the first
			     thing chosen and the first thing explained. -->
			<v-col cols="12" md="4">
				<v-select
					v-model="movementType"
					:items="movementTypes"
					variant="outlined"
					density="compact"
					:label="__('Movement Type')"
					:disabled="submitting || !enabled || movementTypes.length === 0"
				/>
			</v-col>
			<v-col cols="12" md="4">
				<v-text-field
					v-model.number="amount"
					type="number"
					inputmode="decimal"
					enterkeyhint="done"
					min="0"
					step="0.01"
					variant="outlined"
					density="compact"
					:label="__('Amount')"
					:disabled="submitting || !enabled"
					@focus="onAmountFocus"
					@blur="onAmountBlur"
					@update:model-value="onAmountInput"
				/>
			</v-col>
			<v-col cols="12" md="4">
				<v-text-field
					v-model="postingDate"
					type="date"
					variant="outlined"
					density="compact"
					:label="__('Posting Date')"
					:disabled="submitting || !enabled"
				/>
			</v-col>
			<v-col cols="12">
				<v-text-field
					v-model="againstName"
					variant="outlined"
					density="compact"
					:label="__('Against Name')"
					:disabled="submitting || !enabled"
				/>
			</v-col>
			<v-col cols="12" v-if="movementType">
				<!-- The form looks identical for every type because the payload is
				     role-based; this strip is what tells the cashier which way the
				     money actually moves before they commit it. -->
				<div
					class="cash-movement-form__direction"
					:class="
						direction.entersDrawer
							? 'cash-movement-form__direction--in'
							: 'cash-movement-form__direction--out'
					"
					data-testid="cash-movement-direction"
				>
					<v-icon
						:icon="direction.entersDrawer ? 'mdi-cash-plus' : 'mdi-cash-minus'"
						size="22"
					/>
					<div class="cash-movement-form__direction-body">
						<div class="cash-movement-form__direction-flow">
							<span class="cash-movement-form__account">{{ fromAccountLabel }}</span>
							<v-icon icon="mdi-arrow-right" size="18" class="cash-movement-form__arrow" />
							<span class="cash-movement-form__account">{{ toAccountLabel }}</span>
						</div>
						<div class="cash-movement-form__direction-effect">
							{{ directionSummary }}
						</div>
					</div>
				</div>
			</v-col>
			<v-col cols="12" md="4" v-if="allowSourceAccountOverride">
				<v-autocomplete
					v-model="sourceAccount"
					:items="sourceAccountOptions"
					:loading="sourceAccountLoading"
					:search="sourceAccountSearch"
					@update:search="onSourceSearch"
					@focus="loadSourceAccounts('')"
					no-filter
					clearable
					hide-no-data
					variant="outlined"
					density="compact"
					:label="drawerAccountLabel"
					:disabled="submitting || !enabled"
				/>
			</v-col>
			<v-col cols="12" md="4" v-if="movementType === 'Expense'">
				<v-autocomplete
					v-model="expenseAccount"
					:items="expenseAccountOptions"
					:loading="expenseAccountLoading"
					:search="expenseAccountSearch"
					@update:search="onExpenseSearch"
					@focus="loadExpenseAccounts('')"
					no-filter
					clearable
					hide-no-data
					variant="outlined"
					density="compact"
					:label="__('Expense Account (Optional Override)')"
					:disabled="submitting || !enabled"
				/>
			</v-col>
			<v-col cols="12" md="4" v-if="movementType === 'Deposit' || movementType === 'Cash In'">
				<v-autocomplete
					v-model="targetAccount"
					:items="targetAccountOptions"
					:loading="targetAccountLoading"
					:search="targetAccountSearch"
					@update:search="onTargetSearch"
					@focus="loadTargetAccounts('')"
					no-filter
					:clearable="!targetAccountLocked"
					hide-no-data
					variant="outlined"
					density="compact"
					:label="backOfficeAccountLabel"
					:disabled="submitting || !enabled || targetAccountLocked"
				/>
			</v-col>
			<v-col cols="12">
				<v-textarea
					v-model="remarks"
					variant="outlined"
					density="compact"
					rows="2"
					auto-grow
					:label="__('Remarks')"
					:disabled="submitting || !enabled"
				/>
			</v-col>
			<v-col cols="12">
				<!-- One button, driven by the selected type. Three buttons with two
				     permanently greyed out taught nobody which type they had picked. -->
				<v-btn
					class="cash-movement-form__submit"
					:color="direction.entersDrawer ? 'success' : 'primary'"
					size="large"
					block
					:disabled="submitting || !enabled || !movementTypeAllowed"
					:loading="submitting"
					@click="onSubmit()"
				>
					{{ submitLabel }}
				</v-btn>
			</v-col>
		</v-row>
	</v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
	describeDirection,
	prefillFieldsFromMovement,
	type MovementType,
} from "../../../composables/pos/cash/movementDirection";

type AccountSearchType = "expense" | "cash";

const __ = window.__ || ((text: string, _args?: any[]) => text);

const props = defineProps<{
	context: any;
	submitting: boolean;
	resetToken?: number;
	prefillToken?: number;
	prefillData?: any;
}>();

const emit = defineEmits<{
	(e: "submit", payload: any): void;
}>();

const movementType = ref<MovementType | null>("Expense");
const amount = ref<number | string | null>(0);
const postingDate = ref<string>(getTodayDate());
const remarks = ref<string>("");
const againstName = ref<string>("");
const sourceAccount = ref<string>("");
const expenseAccount = ref<string>("");
const targetAccount = ref<string>("");
const sourceAccountOptions = ref<string[]>([]);
const expenseAccountOptions = ref<string[]>([]);
const targetAccountOptions = ref<string[]>([]);
const sourceAccountSearch = ref("");
const expenseAccountSearch = ref("");
const targetAccountSearch = ref("");
const sourceAccountLoading = ref(false);
const expenseAccountLoading = ref(false);
const targetAccountLoading = ref(false);
let sourceSearchTimer: ReturnType<typeof setTimeout> | null = null;
let expenseSearchTimer: ReturnType<typeof setTimeout> | null = null;
let targetSearchTimer: ReturnType<typeof setTimeout> | null = null;
let previousAmount = 0;
let amountEdited = false;

const enabled = computed(() => !!props.context?.enable_cash_movement);
const allowExpense = computed(() => !!props.context?.allow_pos_expense);
const allowDeposit = computed(() => !!props.context?.allow_cash_deposit);
const allowSourceAccountOverride = computed(() => !!props.context?.allow_source_account_override);
const targetAccountLocked = computed(() => !!props.context?.back_office_cash_account);
const allowedExpenseAccounts = computed(() =>
	normalizeAllowedAccountList(props.context?.allowed_expense_accounts),
);
const allowedSourceAccounts = computed(() =>
	normalizeAllowedAccountList(props.context?.allowed_source_accounts),
);
const movementTypes = computed(() => {
	// Titles name the direction, not just the type. "Deposit"/"Depósito" reads
	// to a cashier as "money into the till", which is the opposite of what it
	// posts — the option label itself has to say which way the cash goes.
	const types: Array<{ title: string; value: MovementType }> = [];
	if (allowExpense.value) {
		types.push({ title: __("Expense — cash out"), value: "Expense" });
	}
	if (allowDeposit.value) {
		types.push({ title: __("Deposit — drawer to back office"), value: "Deposit" });
		// Cash In (change fund into the drawer) shares the deposit flag:
		// same drawer <-> back-office trust domain, opposite direction.
		types.push({ title: __("Cash In — back office to drawer"), value: "Cash In" });
	}
	return types;
});

const movementTypeAllowed = computed(() =>
	movementTypes.value.some((type) => type.value === movementType.value),
);

const direction = computed(() =>
	describeDirection(
		movementType.value,
		{
			sourceAccount: sourceAccount.value,
			expenseAccount: expenseAccount.value,
			targetAccount: targetAccount.value,
		},
		props.context,
	),
);

const unsetAccountLabel = computed(() => __("(not set)"));
const fromAccountLabel = computed(() => direction.value.fromAccount || unsetAccountLabel.value);
const toAccountLabel = computed(() => direction.value.toAccount || unsetAccountLabel.value);

const formattedAmount = computed(() => {
	const value = Number(amount.value) || 0;
	const currency = props.context?.currency;
	const formatter = (window as any).format_currency;
	if (typeof formatter === "function") {
		return formatter(Math.abs(value), currency);
	}
	return Math.abs(value).toFixed(2);
});

const directionSummary = computed(() =>
	direction.value.entersDrawer
		? __("Cash ENTERS the drawer — this shift goes up by {0}.", [formattedAmount.value])
		: __("Cash LEAVES the drawer — this shift goes down by {0}.", [formattedAmount.value]),
);

const drawerAccountLabel = computed(() =>
	direction.value.entersDrawer
		? __("Register Drawer Account (money arrives here)")
		: __("Register Drawer Account (money leaves here)"),
);

const backOfficeAccountLabel = computed(() =>
	direction.value.entersDrawer
		? __("Back Office Cash Account (money comes from here)")
		: __("Back Office Cash Account (money goes here)"),
);

const submitLabel = computed(() => {
	if (movementType.value === "Cash In") return __("Submit Cash In");
	if (movementType.value === "Deposit") return __("Submit Deposit");
	return __("Submit Expense");
});

watch(
	() => props.context,
	async (newContext) => {
		if (!newContext) return;
		sourceAccount.value = resolveInitialSourceAccount(newContext);
		expenseAccount.value = resolveInitialExpenseAccount(newContext);
		targetAccount.value = newContext.back_office_cash_account || "";
		if (sourceAccount.value) {
			ensureOptionExists(sourceAccountOptions.value, sourceAccount.value);
		}
		if (expenseAccount.value) {
			ensureOptionExists(expenseAccountOptions.value, expenseAccount.value);
		}
		if (targetAccount.value) {
			ensureOptionExists(targetAccountOptions.value, targetAccount.value);
		}
		await Promise.all([loadSourceAccounts(""), loadExpenseAccounts(""), loadTargetAccounts("")]);
	},
	{ immediate: true, deep: true },
);

watch(
	movementTypes,
	(types) => {
		const selectedIsAllowed = types.some((type) => type.value === movementType.value);
		if (!selectedIsAllowed && types.length) {
			const firstType = types[0];
			movementType.value = firstType ? firstType.value : null;
		}
	},
	{ immediate: true },
);

function ensureOptionExists(options: string[], value: string) {
	if (!value) return;
	if (!options.includes(value)) {
		options.unshift(value);
	}
}

function normalizeAllowedAccountList(values: any): string[] {
	const result: string[] = [];
	for (const value of values || []) {
		const account = String(value || "").trim();
		if (account && !result.includes(account)) {
			result.push(account);
		}
	}
	return result;
}

function filterAllowedAccounts(allowedAccounts: string[], searchText: string): string[] {
	const query = (searchText || "").trim().toLowerCase();
	if (!query) {
		return [...allowedAccounts];
	}
	return allowedAccounts.filter((account) => account.toLowerCase().includes(query));
}

function resolveInitialExpenseAccount(context: any) {
	const allowed = normalizeAllowedAccountList(context?.allowed_expense_accounts);
	const preferred = String(context?.default_expense_account || "");
	if (allowed.length > 0 && preferred && !allowed.includes(preferred)) {
		return allowed[0] || "";
	}
	return preferred;
}

function resolveInitialSourceAccount(context: any) {
	const preferred = String(context?.default_source_account || "");
	return preferred;
}

function normalizeSearchResults(rows: any[]): string[] {
	const result: string[] = [];
	for (const row of rows || []) {
		let value = "";
		if (typeof row === "string") {
			value = row;
		} else if (Array.isArray(row) && row.length) {
			value = String(row[0] || "");
		} else if (row?.value) {
			value = String(row.value);
		} else if (row?.name) {
			value = String(row.name);
		}
		if (value && !result.includes(value)) {
			result.push(value);
		}
	}
	return result;
}

async function fetchAccountOptions(searchText: string, type: AccountSearchType): Promise<string[]> {
	const company = props.context?.company;
	const filters: Record<string, any> = {
		is_group: 0,
	};
	if (company) {
		filters.company = company;
	}
	if (type === "expense") {
		filters.root_type = "Expense";
	} else {
		filters.account_type = "Cash";
	}

	const response = await frappe.call({
		method: "frappe.desk.search.search_link",
		args: {
			doctype: "Account",
			txt: searchText || "",
			page_length: 20,
			filters,
		},
	});
	return normalizeSearchResults(response?.message || []);
}

async function loadExpenseAccounts(searchText = "") {
	if (!enabled.value || !allowExpense.value) return;
	if (allowedExpenseAccounts.value.length > 0) {
		expenseAccountOptions.value = filterAllowedAccounts(allowedExpenseAccounts.value, searchText);
		ensureOptionExists(expenseAccountOptions.value, expenseAccount.value);
		return;
	}
	expenseAccountLoading.value = true;
	try {
		const results = await fetchAccountOptions(searchText, "expense");
		expenseAccountOptions.value = results;
		ensureOptionExists(expenseAccountOptions.value, expenseAccount.value);
	} finally {
		expenseAccountLoading.value = false;
	}
}

async function loadSourceAccounts(searchText = "") {
	if (!enabled.value || !allowSourceAccountOverride.value) return;
	if (allowedSourceAccounts.value.length > 0) {
		sourceAccountOptions.value = filterAllowedAccounts(allowedSourceAccounts.value, searchText);
		ensureOptionExists(sourceAccountOptions.value, sourceAccount.value);
		return;
	}
	sourceAccountLoading.value = true;
	try {
		const results = await fetchAccountOptions(searchText, "cash");
		sourceAccountOptions.value = results;
		ensureOptionExists(sourceAccountOptions.value, sourceAccount.value);
	} finally {
		sourceAccountLoading.value = false;
	}
}

async function loadTargetAccounts(searchText = "") {
	if (!enabled.value || !allowDeposit.value) return;
	if (targetAccountLocked.value) {
		targetAccountOptions.value = [];
		ensureOptionExists(targetAccountOptions.value, targetAccount.value);
		return;
	}
	targetAccountLoading.value = true;
	try {
		const results = await fetchAccountOptions(searchText, "cash");
		targetAccountOptions.value = results;
		ensureOptionExists(targetAccountOptions.value, targetAccount.value);
	} finally {
		targetAccountLoading.value = false;
	}
}

function onSourceSearch(value: string) {
	sourceAccountSearch.value = value || "";
	if (sourceSearchTimer) {
		clearTimeout(sourceSearchTimer);
	}
	sourceSearchTimer = setTimeout(() => {
		loadSourceAccounts(sourceAccountSearch.value);
	}, 250);
}

function onExpenseSearch(value: string) {
	expenseAccountSearch.value = value || "";
	if (expenseSearchTimer) {
		clearTimeout(expenseSearchTimer);
	}
	expenseSearchTimer = setTimeout(() => {
		loadExpenseAccounts(expenseAccountSearch.value);
	}, 250);
}

function onTargetSearch(value: string) {
	targetAccountSearch.value = value || "";
	if (targetSearchTimer) {
		clearTimeout(targetSearchTimer);
	}
	targetSearchTimer = setTimeout(() => {
		loadTargetAccounts(targetAccountSearch.value);
	}, 250);
}

function onSubmit() {
	// The selected type IS the action now, so nothing can post a movement of a
	// type the cashier did not have on screen.
	const type = movementType.value;
	if (!type || !movementTypeAllowed.value) {
		return;
	}
	emit("submit", {
		movementType: type,
		amount: Number(amount.value || 0),
		againstName: againstName.value,
		postingDate: postingDate.value,
		sourceAccount: sourceAccount.value,
		remarks: remarks.value,
		expenseAccount: expenseAccount.value,
		targetAccount: targetAccount.value,
	});
}

function onAmountFocus() {
	previousAmount = Number.isFinite(Number(amount.value)) ? Number(amount.value) : 0;
	amountEdited = false;
	amount.value = null;
}

function onAmountInput(value: number | string | null) {
	if (!amountEdited && (value === null || value === undefined || value === "")) {
		return;
	}
	amountEdited = true;
}

function onAmountBlur() {
	if (!amountEdited && (amount.value === null || amount.value === undefined || amount.value === "")) {
		amount.value = previousAmount;
	}
}

function resetFormState() {
	amount.value = 0;
	postingDate.value = getTodayDate();
	againstName.value = "";
	remarks.value = "";
	sourceAccount.value = resolveInitialSourceAccount(props.context);
	expenseAccount.value = resolveInitialExpenseAccount(props.context);
	targetAccount.value = props.context?.back_office_cash_account || "";

	const allowed = movementTypes.value;
	if (allowed.length > 0) {
		const first = allowed[0];
		movementType.value = first ? first.value : null;
	}
}

function applyPrefillData(data: any) {
	if (!data) return;

	// Cash In rows are STORED back-office -> drawer. Prefilling them raw both
	// dropped the type (it only accepted Expense/Deposit) and left the accounts
	// swapped, so "duplicate" on a Cash In quietly rebuilt it as a Deposit
	// running the wrong way. The helper flips them back to role-based fields,
	// matching what the backend's duplicate_cash_movement does.
	const prefill = prefillFieldsFromMovement(data);
	if (prefill.movementType) {
		movementType.value = prefill.movementType;
	}

	const nextAmount = Number(data.amount);
	if (Number.isFinite(nextAmount) && nextAmount > 0) {
		amount.value = nextAmount;
	}

	postingDate.value = String(data.postingDate || data.posting_date || getTodayDate()).slice(0, 10);
	againstName.value = String(data.againstName || data.against_name || "");
	remarks.value = String(data.remarks || "");
	sourceAccount.value = prefill.sourceAccount;
	expenseAccount.value = prefill.expenseAccount;
	targetAccount.value = prefill.targetAccount;

	ensureOptionExists(sourceAccountOptions.value, sourceAccount.value);
	ensureOptionExists(expenseAccountOptions.value, expenseAccount.value);
	ensureOptionExists(targetAccountOptions.value, targetAccount.value);
}

function getTodayDate() {
	return new Date().toISOString().slice(0, 10);
}

watch(
	() => props.resetToken,
	() => {
		resetFormState();
	},
);

watch(
	() => props.prefillToken,
	() => {
		applyPrefillData(props.prefillData);
	},
);
</script>

<style scoped>
/* The card's own chrome, in real CSS.
 *
 * It used to be `pa-4` plus `d-flex … justify-space-between ga-3` plus
 * `text-h6` — Vuetify spacing/display utilities, none of which are in the web
 * route's stylesheet (see `CashMovementView.vue`'s template note). The card
 * therefore had no padding at all, the heading rendered at body size and the
 * posting-date field dropped onto its own line. Nothing about the FORM changes
 * here: the direction strip, the account labels and the submit are untouched.
 */
.cash-movement-form__card {
	padding: 16px;
}

.cash-movement-form__head {
	display: flex;
	align-items: center;
	margin-bottom: 4px;
}

.cash-movement-form__title {
	font-size: 1.125rem;
	font-weight: 600;
	line-height: 1.4;
}

.cash-movement-form__subtitle {
	font-size: 0.875rem;
	line-height: 1.4;
	color: rgb(var(--v-theme-on-surface));
	opacity: 0.7;
	margin-bottom: 16px;
}

.cash-movement-form__arrow {
	margin-inline: 4px;
}

.cash-movement-form__direction {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 10px 12px;
	border-radius: 8px;
	/* Colour is the second signal only — the wording carries the meaning, so a
	   colour-blind cashier still reads ENTERS/LEAVES. */
	border: 1px solid currentColor;
}

.cash-movement-form__direction--out {
	color: rgb(var(--v-theme-warning));
	background: rgba(var(--v-theme-warning), 0.08);
}

.cash-movement-form__direction--in {
	color: rgb(var(--v-theme-success));
	background: rgba(var(--v-theme-success), 0.08);
}

.cash-movement-form__direction-body {
	min-width: 0;
	flex: 1 1 auto;
}

.cash-movement-form__direction-flow {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	font-weight: 600;
	line-height: 1.3;
}

.cash-movement-form__account {
	overflow-wrap: anywhere;
}

.cash-movement-form__direction-effect {
	margin-top: 2px;
	font-size: 0.8125rem;
	opacity: 0.9;
}

.cash-movement-form__submit {
	font-weight: 600;
}
</style>
