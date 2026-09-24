<template>
	<article
		class="credit-detail"
		:class="`credit-detail--${mode}`"
		:aria-busy="loading ? 'true' : 'false'"
		data-testid="credit-sale-detail"
	>
		<p v-if="loading && !sale" class="credit-detail__state" role="status">{{ __("Loading the credit sale…") }}</p>

		<div v-else-if="loadError && !sale" class="credit-detail__notice" role="alert" data-testid="credit-detail-error">
			<p>{{ loadError }}</p>
			<div class="credit-detail__buttons">
				<button type="button" class="credit-detail__button" data-testid="credit-detail-retry" @click="load">
					{{ __("Try again") }}
				</button>
				<button type="button" class="credit-detail__button" data-testid="credit-detail-close" @click="emit('close')">
					{{ __("Close") }}
				</button>
			</div>
		</div>

		<template v-else-if="sale">
			<header class="credit-detail__head">
				<p class="credit-detail__eyebrow">{{ __("Credit sale") }} · {{ providerName }}</p>
				<h2 class="credit-detail__customer" data-testid="credit-detail-customer">
					{{ sale.customer_name || sale.customer }}
				</h2>
				<p class="credit-detail__meta">{{ metaLine }}</p>
				<div class="credit-detail__chips">
					<CreditChip :tone="compliance.tone" data-testid="credit-detail-compliance">{{ __(compliance.label) }}</CreditChip>
				</div>
			</header>

			<template v-if="mode === 'after-sale'">
				<p class="credit-detail__lead">{{ __("Attach the documents now, while the customer is still here.") }}</p>
				<CreditDocumentsPanel
					:invoice="sale.name"
					:documents="sale.documents"
					:editable="sale.can_edit"
					:document-kinds="documentKinds"
					:max-upload-mb="maxUploadMb"
					@update:documents="onDocuments"
				/>
			</template>

			<section class="credit-detail__section" :aria-labelledby="`${uid}-amounts`">
				<h3 :id="`${uid}-amounts`" class="credit-detail__label">{{ __("Amounts") }}</h3>
				<dl class="credit-detail__facts" data-testid="credit-detail-facts">
					<div class="credit-detail__fact">
						<dt>{{ __("Credit price") }}</dt>
						<dd class="reg-mono" data-testid="credit-fact-price">{{ money(sale.customer_offered_price) }}</dd>
					</div>
					<div class="credit-detail__fact">
						<dt>{{ __("Down payment") }}</dt>
						<dd class="reg-mono" data-testid="credit-fact-enganche">{{ money(sale.enganche) }}</dd>
					</div>
					<div class="credit-detail__fact">
						<dt>{{ __("Financed by {0}", [providerName]) }}</dt>
						<dd class="reg-mono" data-testid="credit-fact-financed">{{ money(sale.credit_amount) }}</dd>
					</div>
					<div class="credit-detail__fact">
						<dt>{{ __("Term") }}</dt>
						<dd data-testid="credit-fact-term">
							{{ Number(sale.plan_months) > 0 ? __("{0} months", [Number(sale.plan_months)]) : __("Not set") }}
						</dd>
					</div>
					<div class="credit-detail__fact">
						<dt>{{ __("Monthly payment") }}</dt>
						<dd class="reg-mono" data-testid="credit-fact-monthly">
							{{ Number(sale.plan_monthly) > 0 ? money(sale.plan_monthly) : __("Not set") }}
						</dd>
					</div>
				</dl>
			</section>

			<section v-if="mode === 'queue' && sale.items.length" class="credit-detail__section" :aria-labelledby="`${uid}-items`">
				<h3 :id="`${uid}-items`" class="credit-detail__label">{{ __("Items") }}</h3>
				<ul class="credit-detail__items">
					<li v-for="(item, index) in sale.items" :key="`${item.item_code}-${index}`" class="credit-detail__item">
						<div class="credit-detail__item-top">
							<strong>{{ item.item_name || item.item_code }}</strong>
							<CreditChip v-if="item.financed" tone="neutral" data-testid="credit-item-financed">{{ __("On credit") }}</CreditChip>
						</div>
						<small>{{ item.item_code }} · {{ __("Qty {0}", [Number(item.qty)]) }}</small>
						<small v-if="serials(item)" class="reg-mono">{{ __("Serial no. {0}", [serials(item)]) }}</small>
					</li>
				</ul>
			</section>

			<CreditDocumentsPanel
				v-if="mode === 'queue'"
				:invoice="sale.name"
				:documents="sale.documents"
				:editable="sale.can_edit"
				:document-kinds="documentKinds"
				:max-upload-mb="maxUploadMb"
				@update:documents="onDocuments"
			/>

			<CreditExpensesPanel
				:invoice="sale.name"
				:currency="sale.currency"
				:editable="Number(sale.docstatus) === 1"
				@changed="onExpensesChanged"
			/>

			<section class="credit-detail__section" :aria-labelledby="`${uid}-plan`">
				<h3 :id="`${uid}-plan`" class="credit-detail__label">{{ __("Plan and notes") }}</h3>
				<form v-if="sale.can_edit" class="credit-detail__plan" novalidate @submit.prevent="savePlan">
					<label class="credit-detail__field">
						<span>{{ __("Term (months)") }}</span>
						<input
							v-model="plan.months"
							type="number"
							inputmode="numeric"
							min="0"
							step="1"
							data-testid="credit-plan-months"
						/>
					</label>
					<label class="credit-detail__field">
						<span>{{ __("Monthly payment") }}</span>
						<input
							v-model="plan.monthly"
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							data-testid="credit-plan-monthly"
						/>
					</label>
					<label class="credit-detail__field credit-detail__field--wide">
						<span>{{ __("Notes") }}</span>
						<textarea v-model="plan.notes" rows="3" maxlength="1000" data-testid="credit-plan-notes"></textarea>
					</label>
					<p v-if="planError" class="credit-detail__error" role="alert" data-testid="credit-plan-error">{{ planError }}</p>
					<div class="credit-detail__buttons credit-detail__field--wide">
						<button
							type="submit"
							class="credit-detail__button"
							:disabled="!planDirty || saving"
							data-testid="credit-plan-save"
						>
							{{ saving ? __("Saving…") : __("Save plan") }}
						</button>
					</div>
				</form>
				<p v-else-if="sale.notes" class="credit-detail__notes" data-testid="credit-plan-readonly">{{ sale.notes }}</p>
				<p v-else class="credit-detail__muted" data-testid="credit-plan-readonly">{{ __("No notes.") }}</p>
			</section>

			<section v-if="mode === 'after-sale' && sale.items.length" class="credit-detail__section" :aria-labelledby="`${uid}-items`">
				<h3 :id="`${uid}-items`" class="credit-detail__label">{{ __("Items") }}</h3>
				<ul class="credit-detail__items">
					<li v-for="(item, index) in sale.items" :key="`${item.item_code}-${index}`" class="credit-detail__item">
						<div class="credit-detail__item-top">
							<strong>{{ item.item_name || item.item_code }}</strong>
							<CreditChip v-if="item.financed" tone="neutral">{{ __("On credit") }}</CreditChip>
						</div>
						<small>{{ item.item_code }} · {{ __("Qty {0}", [Number(item.qty)]) }}</small>
						<small v-if="serials(item)" class="reg-mono">{{ __("Serial no. {0}", [serials(item)]) }}</small>
					</li>
				</ul>
			</section>

			<footer class="credit-detail__footer">
				<div class="credit-detail__buttons">
					<button
						v-if="Number(sale.docstatus) === 1"
						type="button"
						class="credit-detail__button"
						data-testid="credit-detail-print"
						@click="emit('print', sale.name)"
					>
						<v-icon icon="mdi-printer-pos" size="18" aria-hidden="true" />
						{{ __("Print down-payment ticket") }}
					</button>
					<button
						v-if="canLock && !confirmingLock"
						type="button"
						class="credit-detail__button"
						:disabled="locking || !sale.documents.complete"
						data-testid="credit-detail-lock"
						@click="confirmingLock = true"
					>
						<v-icon icon="mdi-check-circle-outline" size="18" aria-hidden="true" />
						{{ __("Mark paperwork complete") }}
					</button>
				</div>
				<p v-if="canLock && !sale.documents.complete" class="credit-detail__muted" data-testid="credit-detail-lock-blocked">
					{{ __("Attach the missing documents before marking the paperwork complete.") }}
				</p>
				<div
					v-if="canLock && confirmingLock"
					class="credit-detail__confirm"
					role="group"
					:aria-labelledby="`${uid}-lock`"
					data-testid="credit-detail-lock-confirm-box"
				>
					<p :id="`${uid}-lock`">{{ __("Confirm that every document for this sale is attached and legible.") }}</p>
					<div class="credit-detail__buttons">
						<button
							type="button"
							class="credit-detail__button credit-detail__button--strong"
							:disabled="locking"
							data-testid="credit-detail-lock-confirm"
							@click="lock"
						>
							{{ locking ? __("Saving…") : __("Mark complete") }}
						</button>
						<button type="button" class="credit-detail__button" :disabled="locking" @click="confirmingLock = false">
							{{ __("Cancel") }}
						</button>
					</div>
				</div>
				<p v-if="lockError" class="credit-detail__error" role="alert" data-testid="credit-detail-lock-error">{{ lockError }}</p>
			</footer>
		</template>
	</article>
</template>

<script setup lang="ts">
/**
 * One provider-financed sale, as the register may show it: who bought, from
 * which provider, the credit price, the down payment and what the provider
 * finances, the plan, the covered items with their serial numbers, the
 * paperwork checklist and the expenses paid for it.
 *
 * `after-sale` is the sheet the cashier sees right after charging, so the
 * checklist leads; `queue` is the Credit sales review, where the figures do.
 *
 * Commission, expected settlement, bonus and seller commission are
 * management figures: the server never sends them to the register, and this
 * view has no place for them even if a payload carried them.
 */
import { computed, onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import { storeToRefs } from "pinia";

import CreditChip from "./CreditChip.vue";
import CreditDocumentsPanel from "./CreditDocumentsPanel.vue";
import CreditExpensesPanel from "./CreditExpensesPanel.vue";
import {
	getCreditSale,
	loadCreditContext,
	lockCreditSale,
	updateCreditSale,
	type CreditContext,
	type CreditDocuments,
	type CreditSale,
	type CreditSaleItem,
} from "./creditApi";
import { complianceDisplay, describeError, formatDate, formatMoney, translate as __ } from "./creditFormat";
import { DEFAULT_MAX_UPLOAD_MB } from "./creditUpload";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";

const props = defineProps<{
	invoice: string;
	mode: "after-sale" | "queue";
}>();

const emit = defineEmits<{
	/** After every successful write, with the sale as it now stands. */
	changed: [CreditSale];
	/** After every successful read. */
	loaded: [CreditSale];
	close: [];
	/** The down-payment ticket should be printed again. */
	print: [string];
}>();

const uid = `credit-detail-${useId()}`;
const toastStore = useToastStore();
const { posProfile } = storeToRefs(useUIStore());

const sale = ref<CreditSale | null>(null);
const loading = ref(false);
const loadError = ref("");
const context = ref<CreditContext | null>(null);
const plan = reactive({ months: "" as string | number, monthly: "" as string | number, notes: "" });
const saving = ref(false);
const planError = ref("");
const confirmingLock = ref(false);
const locking = ref(false);
const lockError = ref("");
let loadRequest = 0;
let disposed = false;

const providerName = computed(() => sale.value?.provider_label || sale.value?.credit_provider || "");
const compliance = computed(() => complianceDisplay(sale.value?.compliance));
const canLock = computed(() => Boolean(sale.value?.can_lock) && sale.value?.compliance !== "Completo");
const documentKinds = computed(() => context.value?.document_kinds || []);
const maxUploadMb = computed(() => Number(context.value?.max_upload_mb) || DEFAULT_MAX_UPLOAD_MB);

const money = (value: unknown) => formatMoney(value, sale.value?.currency);

const metaLine = computed(() => {
	const current = sale.value;
	if (!current) return "";
	return [
		current.name,
		formatDate(current.posting_date),
		current.owner_name ? __("Sold by {0}", [current.owner_name]) : "",
	]
		.filter(Boolean)
		.join(" · ");
});

const serials = (item: CreditSaleItem) =>
	String(item.serial_no || "")
		.split(/[\n,]+/)
		.map((serial) => serial.trim())
		.filter(Boolean)
		.join(", ");

const asText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

const syncPlan = (current: CreditSale) => {
	plan.months = Number(current.plan_months) > 0 ? String(current.plan_months) : "";
	plan.monthly = Number(current.plan_monthly) > 0 ? String(current.plan_monthly) : "";
	plan.notes = asText(current.notes);
};

const planDirty = computed(() => {
	const current = sale.value;
	if (!current) return false;
	const months = Number(current.plan_months) > 0 ? String(current.plan_months) : "";
	const monthly = Number(current.plan_monthly) > 0 ? String(current.plan_monthly) : "";
	return asText(plan.months) !== months || asText(plan.monthly) !== monthly || plan.notes !== asText(current.notes);
});

async function loadContextFor(current: CreditSale) {
	const profile = current.pos_profile || posProfile.value?.name;
	if (!profile) return;
	try {
		const result = await loadCreditContext(String(profile));
		if (!disposed && sale.value?.name === current.name) context.value = result;
	} catch {
		// Without it the checklist still works: no extra document types, default limit.
	}
}

async function load() {
	const request = ++loadRequest;
	const invoice = props.invoice;
	loading.value = true;
	loadError.value = "";
	try {
		const result = await getCreditSale(invoice);
		if (disposed || request !== loadRequest) return;
		sale.value = result;
		syncPlan(result);
		emit("loaded", result);
		void loadContextFor(result);
	} catch (error) {
		if (disposed || request !== loadRequest) return;
		loadError.value = describeError(error, __("This credit sale could not be loaded. Check the connection and try again."));
	} finally {
		if (!disposed && request === loadRequest) loading.value = false;
	}
}

function adopt(next: CreditSale) {
	sale.value = next;
	emit("changed", next);
}

function onDocuments(documents: CreditDocuments) {
	if (!sale.value) return;
	adopt({ ...sale.value, documents });
}

function onExpensesChanged() {
	if (sale.value) emit("changed", sale.value);
}

const optionalNumber = (value: unknown): number | null => {
	if (value === null || value === undefined || String(value).trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
};

async function savePlan() {
	const current = sale.value;
	if (!current || saving.value) return;
	planError.value = "";
	const months = optionalNumber(plan.months);
	const monthly = optionalNumber(plan.monthly);
	if (months !== null && (!Number.isInteger(months) || months < 0)) {
		planError.value = __("The term is a whole number of months.");
		return;
	}
	if (monthly !== null && (Number.isNaN(monthly) || monthly < 0)) {
		planError.value = __("The monthly payment cannot be negative.");
		return;
	}
	saving.value = true;
	try {
		const result = await updateCreditSale(current.name, {
			plan_months: months,
			plan_monthly: monthly,
			notes: plan.notes.trim(),
		});
		if (disposed || sale.value?.name !== current.name) return;
		syncPlan(result);
		adopt(result);
		toastStore.show({ title: __("Credit plan saved"), color: "success" });
	} catch (error) {
		if (!disposed) planError.value = describeError(error, __("The plan was not saved. Check the connection and try again."));
	} finally {
		if (!disposed) saving.value = false;
	}
}

async function lock() {
	const current = sale.value;
	if (!current || locking.value) return;
	locking.value = true;
	lockError.value = "";
	try {
		const result = await lockCreditSale(current.name);
		if (disposed || sale.value?.name !== current.name) return;
		confirmingLock.value = false;
		syncPlan(result);
		adopt(result);
		toastStore.show({ title: __("Paperwork marked complete"), color: "success" });
	} catch (error) {
		if (!disposed) lockError.value = describeError(error, __("The paperwork was not marked complete. Check the connection and try again."));
	} finally {
		if (!disposed) locking.value = false;
	}
}

watch(
	() => props.invoice,
	() => {
		sale.value = null;
		context.value = null;
		planError.value = "";
		lockError.value = "";
		confirmingLock.value = false;
		void load();
	},
	{ immediate: true },
);

onBeforeUnmount(() => {
	disposed = true;
});
</script>

<style scoped>
.credit-detail {
	display: grid;
	gap: var(--reg-space-xl);
	min-width: 0;
	color: var(--reg-text-primary);
	font-size: 14px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.credit-detail--queue {
	padding: clamp(16px, 2vw, 24px);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-lg);
	background: var(--reg-surface);
	animation: credit-detail-arrive var(--motion-base) var(--ease-out);
}

.credit-detail__state {
	margin: 0;
	padding: var(--reg-space-xl) 0;
	color: var(--reg-text-secondary);
}

.credit-detail__notice {
	display: grid;
	gap: var(--reg-space-md);
	padding: var(--reg-space-lg);
	border: 1px solid var(--reg-tone-warning-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-tone-warning-bg);
	color: var(--reg-tone-warning-label);
}

.credit-detail__notice p {
	margin: 0;
}

.credit-detail__notice .credit-detail__button {
	color: var(--reg-text-primary);
}

.credit-detail__head {
	display: grid;
	gap: var(--reg-space-xs);
}

.credit-detail__eyebrow {
	margin: 0;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted);
}

.credit-detail__customer {
	margin: 0;
	font-size: 22px;
	line-height: 1.25;
	letter-spacing: -0.01em;
}

.credit-detail__meta,
.credit-detail__lead,
.credit-detail__muted {
	margin: 0;
	color: var(--reg-text-secondary);
}

.credit-detail__lead {
	font-size: 15px;
}

.credit-detail__chips {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm);
	margin-top: var(--reg-space-2xs);
}

.credit-detail__section {
	display: grid;
	gap: var(--reg-space-md);
	min-width: 0;
}

.credit-detail__label {
	margin: 0;
	font-size: 16px;
	font-weight: 700;
}

.credit-detail__facts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
	gap: var(--reg-space-md);
	margin: 0;
}

.credit-detail__fact {
	display: grid;
	gap: 2px;
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px solid var(--reg-border-light);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-sunken);
}

.credit-detail__fact dt {
	font-size: 12.5px;
	color: var(--reg-text-secondary);
}

.credit-detail__fact dd {
	margin: 0;
	font-size: 18px;
	font-weight: 700;
}

.credit-detail__items {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
}

.credit-detail__item {
	display: grid;
	gap: 2px;
	padding: var(--reg-space-md) 0;
	border-bottom: 1px solid var(--reg-divider-soft);
}

.credit-detail__item-top {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: var(--reg-space-sm);
}

.credit-detail__item small {
	font-size: 12.5px;
	color: var(--reg-text-muted);
}

.credit-detail__plan {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--reg-space-md);
}

.credit-detail__field {
	display: grid;
	gap: var(--reg-space-2xs);
	font-size: 13px;
	color: var(--reg-text-secondary);
}

.credit-detail__field--wide {
	grid-column: 1 / -1;
}

.credit-detail__field :is(input, textarea) {
	min-height: var(--reg-touch-min);
	padding: var(--reg-space-sm) var(--reg-space-md);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-surface);
	color: var(--reg-text-primary);
	font: inherit;
	font-size: 15px;
}

.credit-detail__field input {
	font-variant-numeric: tabular-nums;
}

.credit-detail__field textarea {
	resize: vertical;
}

.credit-detail__notes {
	margin: 0;
	white-space: pre-line;
}

.credit-detail__error {
	grid-column: 1 / -1;
	margin: 0;
	padding: var(--reg-space-sm) var(--reg-space-md);
	border: 1px solid var(--reg-tone-negative-border);
	border-radius: var(--reg-radius-sm);
	background: var(--reg-tone-negative-bg);
	color: var(--reg-tone-negative-label);
	font-size: 13px;
}

.credit-detail__footer {
	display: grid;
	gap: var(--reg-space-md);
	padding-top: var(--reg-space-lg);
	border-top: 1px solid var(--reg-divider-soft);
}

.credit-detail__buttons {
	display: flex;
	flex-wrap: wrap;
	gap: var(--reg-space-sm);
}

.credit-detail__button {
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

.credit-detail__button:active:not(:disabled) {
	transform: scale(var(--press-scale));
}

.credit-detail__button:disabled {
	opacity: 0.55;
	cursor: default;
}

/* A decision's confirming press: accent ink on the wash, never the fill the
   screen's primary action owns. */
.credit-detail__button--strong {
	border-color: var(--reg-accent-edge);
	background: var(--reg-accent-soft);
	color: var(--reg-on-accent-soft);
}

.credit-detail__confirm {
	display: grid;
	gap: var(--reg-space-md);
	padding: var(--reg-space-md) var(--reg-space-lg);
	border: 1px solid var(--reg-border);
	border-radius: var(--reg-radius-md);
	background: var(--reg-surface-sunken);
}

.credit-detail__confirm p {
	margin: 0;
	font-weight: 600;
}

.credit-detail :is(button, input, textarea):focus-visible {
	outline: 2px solid var(--reg-accent);
	outline-offset: 2px;
}

@keyframes credit-detail-arrive {
	from {
		opacity: 0.4;
		transform: translateY(4px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@media (max-width: 599.98px) {
	.credit-detail__plan {
		grid-template-columns: minmax(0, 1fr);
	}
	.credit-detail__buttons .credit-detail__button {
		flex: 1 1 100%;
	}
}

@media (prefers-reduced-motion: reduce) {
	.credit-detail--queue {
		animation: none;
	}
	.credit-detail__button {
		transition: none;
	}
}
</style>
