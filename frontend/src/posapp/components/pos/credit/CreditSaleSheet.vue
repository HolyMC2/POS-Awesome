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
				<h2 class="credit-sheet__title">{{ __("Sell on credit with a provider") }}</h2>
				<p class="credit-sheet__lead">
					{{ __("Copy the figures from the provider's approval. The printed ticket shows only the down payment.") }}
				</p>
			</header>

			<div class="credit-sheet__body">
				<section class="credit-sheet__section" :aria-label="__('Provider')">
					<h3 class="credit-sheet__label">{{ __("Provider") }}</h3>
					<div class="credit-sheet__providers" role="radiogroup" :aria-label="__('Provider')">
						<button
							v-for="provider in providers"
							:key="provider.name"
							type="button"
							role="radio"
							class="credit-sheet__provider"
							:class="{ 'credit-sheet__provider--on': form.provider === provider.name }"
							:aria-checked="form.provider === provider.name"
							:data-testid="`credit-provider-${provider.name}`"
							@click="selectProvider(provider.name)"
						>
							<strong>{{ provider.label || provider.name }}</strong>
							<small>{{ shapeHint(provider) }}</small>
						</button>
					</div>
				</section>

				<section v-if="lines.length" class="credit-sheet__section" :aria-label="__('Items on credit')">
					<h3 class="credit-sheet__label">{{ __("Items on credit") }}</h3>
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
								<span class="credit-sheet__line-amount">{{ money(line.amount) }}</span>
							</label>
						</li>
					</ul>
				</section>

				<section v-if="provider" class="credit-sheet__section" :aria-label="__('Amounts')">
					<h3 class="credit-sheet__label">{{ __("Amounts") }}</h3>
					<div class="credit-sheet__grid">
						<template v-if="provider.shape === 'split'">
							<div class="credit-sheet__fact">
								<span>{{ __("Credit price") }}</span>
								<strong data-testid="credit-price-fixed">{{ money(summary.creditPrice) }}</strong>
								<small>{{ __("The price of the items on credit, as charged on this ticket.") }}</small>
							</div>
							<label class="credit-sheet__field">
								<span>{{ __("Down payment") }}</span>
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
							</label>
						</template>
						<template v-else>
							<div class="credit-sheet__fact">
								<span>{{ __("Down payment") }}</span>
								<strong data-testid="credit-enganche-fixed">{{ money(summary.enganche) }}</strong>
								<small>{{ __("The ticket total of the items on credit.") }}</small>
								<small v-if="issueFor('enganche')" class="credit-sheet__error">{{ issueFor("enganche") }}</small>
							</div>
							<label class="credit-sheet__field">
								<span>{{ __("Credit price") }}</span>
								<input
									v-model="form.creditPrice"
									type="number"
									inputmode="decimal"
									min="0"
									step="any"
									data-testid="credit-price-input"
									:aria-invalid="issueFor('price') ? 'true' : 'false'"
								/>
								<small v-if="issueFor('price')" class="credit-sheet__error">{{ issueFor("price") }}</small>
								<small v-else>{{ __("The total price on the provider's contract.") }}</small>
							</label>
						</template>
						<div class="credit-sheet__fact credit-sheet__fact--financed">
							<span>{{ __("Financed by {0}", [provider.label || provider.name]) }}</span>
							<strong data-testid="credit-financed">{{ money(summary.financed) }}</strong>
							<small v-if="provider.shape === 'split' && provider.mode_of_payment">
								{{ __("Recorded on {0}; collect only the down payment.", [provider.mode_of_payment]) }}
							</small>
						</div>
						<label class="credit-sheet__field">
							<span>{{ __("Term (months)") }}</span>
							<input v-model="form.planMonths" type="number" inputmode="numeric" min="0" step="1" data-testid="credit-months" />
						</label>
						<label class="credit-sheet__field">
							<span>{{ __("Monthly payment") }}</span>
							<input v-model="form.planMonthly" type="number" inputmode="decimal" min="0" step="any" data-testid="credit-monthly" />
						</label>
					</div>
					<p v-if="issueFor('lines')" class="credit-sheet__error" role="alert">{{ issueFor("lines") }}</p>
				</section>

				<section v-if="provider?.documents?.length" class="credit-sheet__section credit-sheet__docs">
					<h3 class="credit-sheet__label">{{ __("Paperwork after charging") }}</h3>
					<p>{{ __("You will attach: {0}.", [provider.documents.map((doc) => doc.label).join(", ")]) }}</p>
				</section>
			</div>

			<footer class="credit-sheet__actions">
				<button
					v-if="hasDraft"
					type="button"
					class="credit-sheet__secondary credit-sheet__remove"
					data-testid="credit-remove"
					@click="removeCredit"
				>
					{{ __("Not a credit sale") }}
				</button>
				<span class="credit-sheet__spacer" />
				<button type="button" class="credit-sheet__secondary" data-testid="credit-cancel" @click="close">
					{{ __("Cancel") }}
				</button>
				<button
					type="button"
					class="credit-sheet__primary"
					data-testid="credit-apply"
					:disabled="!summary.valid"
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
 * The credit declaration for the sale on screen: provider, the lines the
 * credit covers, the one figure the cashier types (down payment in the split
 * shape, credit price in the enganche shape) and the plan.
 *
 * Money stays with the payment screen: this writes a draft into the credit
 * store; `Payments.vue` treats the provider's share as settled and the
 * submission adds it to the provider's payment row.
 */
import { computed, reactive, watch } from "vue";
import { storeToRefs } from "pinia";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useCreditSaleStore, type CreditProviderOption } from "../../../stores/creditSaleStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useFormat } from "../../../format";
import {
	creditLinesFromItems,
	defaultCoveredRowIds,
	summarizeCredit,
	type CreditDraft,
	type CreditIssue,
} from "../../../composables/pos/credit/creditMath";
import { CREDIT_ISSUE_TEXT } from "../../../composables/pos/credit/creditIssues";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (_e: "update:modelValue", _value: boolean): void }>();

const __ = (window as any).__ || ((value: string) => value);
const creditStore = useCreditSaleStore();
const invoiceStore = useInvoiceStore();
const { providers, draft } = storeToRefs(creditStore);
const { formatCurrency, currencySymbol, currency_precision } = useFormat();

const { isFullscreenDialog, dialogProps } = useDialogFullscreen({ maxWidth: 640, breakpoint: 1100 });

interface SheetForm {
	provider: string;
	lineRowIds: string[];
	enganche: number | string | null;
	creditPrice: number | string | null;
	planMonths: number | string | null;
	planMonthly: number | string | null;
}

const form = reactive<SheetForm>({
	provider: "",
	lineRowIds: [],
	enganche: null,
	creditPrice: null,
	planMonths: null,
	planMonthly: null,
});

const items = computed(() => invoiceStore.invoiceDoc?.items || []);
const lines = computed(() => creditLinesFromItems(items.value));
const provider = computed<CreditProviderOption | null>(
	() => providers.value.find((row) => row.name === form.provider) || null,
);
const hasDraft = computed(() => Boolean(draft.value));

const numberOrNull = (value: unknown): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const formDraft = computed<CreditDraft>(() => ({
	provider: form.provider,
	lineRowIds: [...form.lineRowIds],
	enganche: numberOrNull(form.enganche),
	creditPrice: numberOrNull(form.creditPrice),
	planMonths: numberOrNull(form.planMonths),
	planMonthly: numberOrNull(form.planMonthly),
}));

const summary = computed(() =>
	summarizeCredit(
		formDraft.value,
		provider.value?.shape || "enganche",
		items.value,
		Number(currency_precision.value) || 2,
	),
);

const currency = computed(() => invoiceStore.invoiceDoc?.currency || "");
const money = (value: number) =>
	`${currency.value ? currencySymbol(currency.value) || "" : ""}${formatCurrency(value)}`;


const issueFor = (target: "enganche" | "price" | "lines"): string => {
	const issues = summary.value.issues;
	const pick = (candidates: CreditIssue[]) => candidates.find((issue) => issues.includes(issue));
	const issue =
		target === "enganche"
			? pick(["missing_enganche", "enganche_too_high"])
			: target === "price"
				? pick(["missing_price", "price_not_above_enganche"])
				: pick(["no_lines", "lines_changed"]);
	// A fresh form should not greet the cashier with errors for fields they
	// have not reached yet; the Apply button already stays disabled.
	if (!issue || (!touched.value && issue !== "lines_changed")) return "";
	return __(CREDIT_ISSUE_TEXT[issue]);
};

const touched = computed(
	() =>
		(form.enganche !== null && form.enganche !== "") ||
		(form.creditPrice !== null && form.creditPrice !== "") ||
		Boolean(draft.value),
);

const shapeHint = (row: CreditProviderOption): string =>
	row.shape === "split"
		? __("Down payment here, the rest on {0}", [row.mode_of_payment || ""])
		: __("The ticket is the down payment");

const loadForm = () => {
	const current = draft.value;
	const first = providers.value[0];
	form.provider = current?.provider || (providers.value.length === 1 && first ? first.name : "");
	const available = new Set(lines.value.map((line) => line.rowId));
	const kept = (current?.lineRowIds || []).filter((rowId) => available.has(rowId));
	form.lineRowIds = kept.length ? kept : defaultCoveredRowIds(lines.value);
	form.enganche = current?.enganche ?? null;
	form.creditPrice = current?.creditPrice ?? null;
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
};

const close = () => emit("update:modelValue", false);

const applyCredit = () => {
	if (!summary.value.valid) return;
	creditStore.apply(formDraft.value);
	close();
};

const removeCredit = () => {
	creditStore.remove();
	close();
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
.credit-sheet__providers {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
	gap: var(--reg-space-sm);
}
.credit-sheet__provider {
	display: grid;
	gap: 2px;
	min-height: var(--reg-touch-min);
	padding: var(--reg-space-sm) var(--reg-space-md);
	text-align: left;
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-muted);
	color: var(--reg-text-primary);
	cursor: pointer;
}
.credit-sheet__provider small {
	color: var(--reg-text-muted);
	font-size: 12px;
}
.credit-sheet__provider--on {
	border-color: var(--reg-accent-edge);
	background: var(--reg-accent-soft);
	color: var(--reg-on-accent-soft);
}
.credit-sheet__provider--on small {
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
.credit-sheet__fact,
.credit-sheet__field {
	display: grid;
	gap: var(--reg-space-2xs);
	align-content: start;
}
.credit-sheet__fact span,
.credit-sheet__field span {
	font-size: 13px;
	color: var(--reg-text-secondary);
}
.credit-sheet__fact strong {
	font-size: 20px;
	font-variant-numeric: tabular-nums;
}
.credit-sheet__fact small,
.credit-sheet__field small {
	color: var(--reg-text-muted);
	font-size: 12px;
}
.credit-sheet__fact--financed {
	padding: var(--reg-space-sm) var(--reg-space-md);
	border-radius: var(--reg-radius-md);
	background: var(--reg-tone-neutral-bg);
	border: 1px solid var(--reg-tone-neutral-border);
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
	padding: var(--reg-space-md) var(--reg-space-lg);
	border-top: 1px solid var(--reg-divider-soft);
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
.credit-sheet__primary:disabled {
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
	.credit-sheet__grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
