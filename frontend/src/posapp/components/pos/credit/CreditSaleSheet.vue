<template>
	<v-dialog
		:model-value="modelValue"
		v-bind="dialogProps"
		:scrollable="isFullscreenDialog"
		@update:model-value="$emit('update:modelValue', $event)"
	>
		<v-card class="credit-sheet" data-testid="credit-sale-sheet">
			<header class="credit-sheet__head">
				<p class="credit-sheet__eyebrow">{{ __("Credit sale") }}</p>
				<h2 class="credit-sheet__title">{{ __("Sell on credit") }}</h2>
				<p class="credit-sheet__lead">
					{{ __("Copy the provider's approval. The ticket adjusts to it and prints only the down payment.") }}
				</p>
			</header>

			<div class="credit-sheet__body">
				<section class="credit-sheet__section" :aria-label="__('Provider')">
					<h3 class="credit-sheet__label">{{ __("1. Provider") }}</h3>
					<p class="credit-sheet__help">{{ __("The company that approved the customer's credit.") }}</p>
					<div class="credit-sheet__providers" role="radiogroup" :aria-label="__('Provider')">
						<button
							v-for="row in providers"
							:key="row.name"
							type="button"
							role="radio"
							class="credit-sheet__provider"
							:class="{ 'credit-sheet__provider--on': form.provider === row.name }"
							:aria-checked="form.provider === row.name"
							:data-testid="`credit-provider-${row.name}`"
							@click="selectProvider(row.name)"
						>
							<strong>{{ row.label || row.name }}</strong>
						</button>
					</div>
				</section>

				<section v-if="lines.length" class="credit-sheet__section" :aria-label="__('Items on credit')">
					<h3 class="credit-sheet__label">{{ __("2. What goes on credit") }}</h3>
					<p class="credit-sheet__help">
						{{ __("Tick what the provider finances. Anything left unticked is charged normally today.") }}
					</p>
					<ul class="credit-sheet__lines">
						<li v-for="line in lines" :key="line.rowId">
							<label class="credit-sheet__line">
								<input
									type="checkbox"
									:checked="form.lineRowIds.includes(line.rowId)"
									:data-testid="`credit-line-${line.rowId}`"
									@change="toggleLine(line.rowId, ($event.target as HTMLInputElement).checked)"
								/>
								<span class="credit-sheet__line-name">
									{{ line.itemName }}
									<small v-if="line.serialNo">{{ line.serialNo.split("\n").join(", ") }}</small>
								</span>
								<span class="credit-sheet__line-amount">{{ money(ownAmount(line)) }}</span>
							</label>
						</li>
					</ul>
					<p v-if="issueFor('lines')" class="credit-sheet__error" role="alert">{{ issueFor("lines") }}</p>
				</section>

				<section v-if="provider" class="credit-sheet__section" :aria-label="__('The approval')">
					<h3 class="credit-sheet__label">{{ __("3. From the provider's approval") }}</h3>
					<p class="credit-sheet__help">{{ __("Copy these figures from the provider's approval or contract.") }}</p>
					<div class="credit-sheet__grid">
						<label class="credit-sheet__field">
							<span>{{ __("Total credit price") }}</span>
							<input
								v-model="form.creditPrice"
								type="number"
								inputmode="decimal"
								min="0"
								step="any"
								data-testid="credit-price-input"
								:aria-invalid="issueFor('price') ? 'true' : 'false'"
								@input="priceEdited = true"
							/>
							<small v-if="issueFor('price')" class="credit-sheet__error">{{ issueFor("price") }}</small>
							<small v-else>{{ __("The full price the customer pays the provider.") }}</small>
						</label>
						<label class="credit-sheet__field">
							<span>{{ __("Down payment today") }}</span>
							<input
								v-model="form.enganche"
								type="number"
								inputmode="decimal"
								min="0"
								step="any"
								data-testid="credit-enganche-input"
								:aria-invalid="issueFor('enganche') ? 'true' : 'false'"
							/>
							<small v-if="issueFor('enganche')" class="credit-sheet__error">{{ issueFor("enganche") }}</small>
							<small v-else>{{ __("0 if the provider asks for none.") }}</small>
						</label>
						<label class="credit-sheet__field">
							<span>{{ __("Term (months)") }} <em>{{ __("optional") }}</em></span>
							<input v-model="form.planMonths" type="number" inputmode="numeric" min="0" step="1" data-testid="credit-months" />
						</label>
						<label class="credit-sheet__field">
							<span>{{ __("Monthly payment") }} <em>{{ __("optional") }}</em></span>
							<input v-model="form.planMonthly" type="number" inputmode="decimal" min="0" step="any" data-testid="credit-monthly" />
						</label>
					</div>
					<p class="credit-sheet__help">
						{{ __("Term and monthly payment are only recorded with the sale; the provider collects them.") }}
					</p>
				</section>

				<section
					v-if="provider && preview.covered.length"
					class="credit-sheet__summary"
					aria-live="polite"
					data-testid="credit-summary"
				>
					<div class="credit-sheet__collect">
						<span>{{ __("Collect today") }}</span>
						<strong data-testid="credit-collect-today">{{ money(preview.collectToday) }}</strong>
						<small v-if="preview.othersTotal > 0">
							{{ __("Down payment {0} + other items {1}", [money(preview.enganche), money(preview.othersTotal)]) }}
						</small>
					</div>
					<dl class="credit-sheet__facts">
						<div>
							<dt>{{ __("{0} finances", [provider.label || provider.name]) }}</dt>
							<dd data-testid="credit-financed">{{ money(preview.financed) }}</dd>
						</div>
						<div>
							<dt>{{ __("On the ticket") }}</dt>
							<dd data-testid="credit-ticket-lines">{{ money(preview.ticketTarget) }}</dd>
						</div>
					</dl>
					<p class="credit-sheet__note">{{ ticketNote }}</p>
				</section>

				<section v-if="provider?.documents?.length" class="credit-sheet__section credit-sheet__docs">
					<h3 class="credit-sheet__label">{{ __("Paperwork after charging") }}</h3>
					<p>{{ __("You will attach: {0}.", [provider.documents.map((doc) => doc.label).join(", ")]) }}</p>
				</section>
			</div>

			<p class="credit-sheet__help credit-sheet__apply-help">
				{{ __("Applying the credit only reprices the ticket. Nothing is charged until you collect.") }}
			</p>
			<footer class="credit-sheet__actions">
				<button
					v-if="hasDraft"
					type="button"
					class="credit-sheet__secondary credit-sheet__remove"
					data-testid="credit-remove"
					:disabled="repricing"
					@click="removeCredit"
				>
					{{ __("Remove credit and restore prices") }}
				</button>
				<span class="credit-sheet__spacer" />
				<button type="button" class="credit-sheet__secondary" data-testid="credit-cancel" @click="close">
					{{ __("Cancel") }}
				</button>
				<button
					type="button"
					class="credit-sheet__primary"
					data-testid="credit-apply"
					:disabled="!preview.valid || repricing"
					@click="applyCredit"
				>
					{{ __("Apply credit") }}
				</button>
			</footer>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * The credit declaration for the sale on screen, in the order the cashier
 * reads the provider's approval: provider, the items on credit, the total
 * credit price and today's down payment, the plan. Applying it prices the
 * ticket (the credit store reprices the covered lines through the cart) and
 * the payment screen then collects the down payment plus any other item.
 */
import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useCreditSaleStore, type CreditProviderOption } from "../../../stores/creditSaleStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useFormat } from "../../../format";
import {
	creditLinesFromItems,
	defaultCoveredRowIds,
	roundMoney,
	summarizeCredit,
	type CreditDraft,
	type CreditIssue,
	type CreditLine,
} from "../../../composables/pos/credit/creditMath";
import { CREDIT_ISSUE_TEXT } from "../../../composables/pos/credit/creditIssues";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (_e: "update:modelValue", _value: boolean): void }>();

const __ = (window as any).__ || ((value: string) => value);
const creditStore = useCreditSaleStore();
const invoiceStore = useInvoiceStore();
const { providers, draft, repricing } = storeToRefs(creditStore);
const { formatCurrency, currencySymbol, currency_precision } = useFormat();

const { isFullscreenDialog, dialogProps } = useDialogFullscreen({ maxWidth: 640, breakpoint: 1100 });

interface SheetForm {
	provider: string;
	lineRowIds: string[];
	creditPrice: number | string | null;
	enganche: number | string | null;
	planMonths: number | string | null;
	planMonthly: number | string | null;
}

const form = reactive<SheetForm>({
	provider: "",
	lineRowIds: [],
	creditPrice: null,
	enganche: null,
	planMonths: null,
	planMonthly: null,
});
/** The cashier typed a price; stop following the covered items' own total. */
const priceEdited = ref(false);

const precision = computed(() => Number(currency_precision.value) || 2);
const items = computed(() => invoiceStore.invoiceDoc?.items || []);
const lines = computed(() => creditLinesFromItems(items.value));
const provider = computed<CreditProviderOption | null>(
	() => providers.value.find((row) => row.name === form.provider) || null,
);
const hasDraft = computed(() => Boolean(draft.value));

/** A line's own amount: before the credit repriced it, when it did. */
const ownAmount = (line: CreditLine): number => {
	const original = draft.value?.originalPrices?.[line.rowId];
	return original ? roundMoney(original.rate * line.qty, precision.value) : line.amount;
};
const coveredOwnTotal = computed(() =>
	roundMoney(
		lines.value.filter((line) => form.lineRowIds.includes(line.rowId)).reduce((sum, line) => sum + ownAmount(line), 0),
		precision.value,
	),
);

const numberOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const formDraft = computed<CreditDraft>(() => ({
	provider: form.provider,
	lineRowIds: [...form.lineRowIds],
	creditPrice: numberOrNull(form.creditPrice),
	enganche: numberOrNull(form.enganche),
	planMonths: numberOrNull(form.planMonths),
	planMonthly: numberOrNull(form.planMonthly),
	originalPrices: { ...(draft.value?.originalPrices || {}) },
}));

/**
 * The sale once applied: the declared figures against the lines outside the
 * credit. The ticket does not carry them yet, so only the typed figures and
 * the chosen items can block Apply.
 */
const preview = computed(() => {
	const summary = summarizeCredit(
		formDraft.value,
		provider.value?.shape || "enganche",
		items.value,
		precision.value,
	);
	const issues: CreditIssue[] = summary.issues.filter((issue) => issue !== "ticket_pending");
	return { ...summary, issues, valid: issues.length === 0 };
});

const touched = computed(
	() =>
		priceEdited.value ||
		(form.enganche !== null && form.enganche !== "") ||
		Boolean(draft.value),
);

const issueFor = (target: "enganche" | "price" | "lines"): string => {
	const issues = preview.value.issues;
	const pick = (candidates: CreditIssue[]) => candidates.find((issue) => issues.includes(issue));
	const issue =
		target === "enganche"
			? pick(["missing_enganche", "enganche_too_high"])
			: target === "price"
				? pick(["missing_price"])
				: pick(["no_lines", "lines_changed"]);
	// A fresh form should not greet the cashier with errors for fields they
	// have not reached yet; Apply already stays disabled.
	if (!issue || (!touched.value && issue !== "lines_changed")) return "";
	return __(CREDIT_ISSUE_TEXT[issue]);
};

const ticketNote = computed(() => {
	const row = provider.value;
	if (!row) return "";
	return row.shape === "split"
		? __("The items on credit stay at the credit price; {0} is recorded on {1}. The printed ticket shows only the down payment.", [
				money(preview.value.financed),
				row.mode_of_payment || "",
			])
		: __("The items on credit are charged at the down payment; {0} settles the rest with the store. The printed ticket shows only the down payment.", [
				row.label || row.name,
			]);
});

const currency = computed(() => invoiceStore.invoiceDoc?.currency || "");
const money = (value: number) =>
	`${currency.value ? currencySymbol(currency.value) || "" : ""}${formatCurrency(value)}`;

const loadForm = () => {
	const current = draft.value;
	const first = providers.value[0];
	form.provider = current?.provider || (providers.value.length === 1 && first ? first.name : "");
	const available = new Set(lines.value.map((line) => line.rowId));
	const kept = (current?.lineRowIds || []).filter((rowId) => available.has(rowId));
	form.lineRowIds = kept.length ? kept : defaultCoveredRowIds(lines.value);
	priceEdited.value = current?.creditPrice != null;
	form.creditPrice = current?.creditPrice ?? (coveredOwnTotal.value || null);
	form.enganche = current?.enganche ?? null;
	const chosen = providers.value.find((row) => row.name === form.provider);
	form.planMonths = current?.planMonths ?? chosen?.default_plan_months ?? null;
	form.planMonthly = current?.planMonthly ?? null;
};

const selectProvider = (name: string) => {
	const previous = form.provider;
	form.provider = name;
	const chosen = providers.value.find((row) => row.name === name);
	if (previous !== name && (form.planMonths === null || form.planMonths === "")) {
		form.planMonths = chosen?.default_plan_months ?? null;
	}
};

const toggleLine = (rowId: string, checked: boolean) => {
	const next = new Set(form.lineRowIds);
	if (checked) next.add(rowId);
	else next.delete(rowId);
	form.lineRowIds = lines.value.map((line) => line.rowId).filter((id) => next.has(id));
	// Until the cashier types a price, it follows the chosen items' own total.
	if (!priceEdited.value) form.creditPrice = coveredOwnTotal.value || null;
};

const close = () => emit("update:modelValue", false);

const applyCredit = () => {
	if (!preview.value.valid || repricing.value) return;
	const next = formDraft.value;
	close();
	void creditStore.apply(next);
};

const removeCredit = () => {
	close();
	void creditStore.remove();
};

watch(
	() => props.modelValue,
	(open) => {
		if (open) loadForm();
	},
	{ immediate: true },
);
</script>

<style scoped>
.credit-sheet {
	display: flex;
	flex-direction: column;
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	border-radius: var(--reg-radius-lg);
	max-height: 100%;
}
.credit-sheet__head {
	padding: var(--reg-space-lg) var(--reg-space-lg) var(--reg-space-sm);
	border-bottom: 1px solid var(--reg-divider-soft);
}
.credit-sheet__eyebrow {
	margin: 0;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted);
}
.credit-sheet__title {
	margin: var(--reg-space-2xs) 0;
	font-size: 20px;
	line-height: 1.25;
}
.credit-sheet__lead {
	margin: 0;
	color: var(--reg-text-secondary);
	font-size: 14px;
}
.credit-sheet__body {
	display: grid;
	gap: var(--reg-space-lg);
	padding: var(--reg-space-lg);
	overflow-y: auto;
}
.credit-sheet__section {
	display: grid;
	gap: var(--reg-space-sm);
}
.credit-sheet__label {
	margin: 0;
	font-size: 13px;
	font-weight: 700;
	color: var(--reg-text-secondary);
}
.credit-sheet__help {
	margin: 0;
	font-size: 12px;
	line-height: 1.35;
	color: var(--reg-text-secondary);
}
.credit-sheet__apply-help {
	padding: var(--reg-space-sm) var(--reg-space-lg) 0;
	border-top: 1px solid var(--reg-divider-soft);
}
.credit-sheet__providers {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: var(--reg-space-sm);
}
.credit-sheet__provider {
	min-height: var(--reg-touch-min);
	padding: var(--reg-space-sm) var(--reg-space-md);
	text-align: left;
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-muted);
	color: var(--reg-text-primary);
	cursor: pointer;
}
.credit-sheet__provider--on {
	border-color: var(--reg-accent-edge);
	background: var(--reg-accent-soft);
	color: var(--reg-on-accent-soft);
}
.credit-sheet__lines {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	gap: var(--reg-space-2xs);
}
.credit-sheet__line {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: var(--reg-space-sm);
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-sm);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface-sunken);
	cursor: pointer;
}
.credit-sheet__line input {
	width: 20px;
	height: 20px;
}
.credit-sheet__line-name {
	min-width: 0;
	overflow-wrap: anywhere;
}
.credit-sheet__line-name small {
	display: block;
	color: var(--reg-text-muted);
}
.credit-sheet__line-amount {
	font-variant-numeric: tabular-nums;
}
.credit-sheet__grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--reg-space-md);
}
.credit-sheet__field {
	display: grid;
	gap: var(--reg-space-2xs);
	align-content: start;
}
.credit-sheet__field span {
	font-size: 13px;
	color: var(--reg-text-secondary);
}
.credit-sheet__field em {
	font-style: normal;
	color: var(--reg-text-muted);
}
.credit-sheet__field small {
	color: var(--reg-text-muted);
	font-size: 12px;
}
.credit-sheet__field input {
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-sm);
	font-size: 18px;
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font-variant-numeric: tabular-nums;
}
.credit-sheet__field input[aria-invalid="true"] {
	border-color: var(--reg-tone-negative-border);
}
.credit-sheet__summary {
	display: grid;
	gap: var(--reg-space-sm);
	padding: var(--reg-space-md);
	border-radius: var(--reg-radius-md);
	background: var(--reg-accent-soft);
	border: 1px solid var(--reg-accent-edge);
	color: var(--reg-on-accent-soft);
}
.credit-sheet__collect {
	display: grid;
	gap: 2px;
}
.credit-sheet__collect span {
	font-size: 13px;
	font-weight: 700;
}
.credit-sheet__collect strong {
	font-size: 28px;
	line-height: 1.1;
	font-variant-numeric: tabular-nums;
}
.credit-sheet__collect small {
	font-size: 12px;
}
.credit-sheet__facts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--reg-space-sm);
	margin: 0;
}
.credit-sheet__facts div {
	display: grid;
	gap: 2px;
}
.credit-sheet__facts dt {
	font-size: 12px;
}
.credit-sheet__facts dd {
	margin: 0;
	font-size: 17px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
.credit-sheet__note {
	margin: 0;
	font-size: 12px;
}
.credit-sheet__error {
	margin: 0;
	color: var(--reg-tone-negative-label) !important;
}
.credit-sheet__docs p {
	margin: 0;
	color: var(--reg-text-secondary);
}
.credit-sheet__actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--reg-space-sm);
	padding: var(--reg-space-sm) var(--reg-space-lg) var(--reg-space-md);
}
.credit-sheet__spacer {
	flex: 1 1 auto;
}
.credit-sheet__primary,
.credit-sheet__secondary {
	min-height: var(--reg-touch-min);
	padding: 0 var(--reg-space-lg);
	border-radius: var(--reg-radius-md);
	font-weight: 700;
	cursor: pointer;
}
.credit-sheet__primary {
	border: 1px solid var(--reg-accent);
	background: var(--reg-accent);
	color: var(--reg-on-accent);
}
.credit-sheet__primary:disabled,
.credit-sheet__secondary:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
.credit-sheet__secondary {
	border: 1px solid var(--reg-border);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
}
.credit-sheet__remove {
	color: var(--reg-tone-negative-label);
	border-color: var(--reg-tone-negative-border);
}
.credit-sheet button:focus-visible,
.credit-sheet input:focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}
@media (max-width: 599.98px) {
	.credit-sheet__grid,
	.credit-sheet__facts {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
