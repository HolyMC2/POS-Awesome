<template>
	<div class="recargas__capture">
		<!-- Tabs are the catalogue's real categories, not the artboard's three:
		     TAECEL's sync decides what this shop sells, and hard-coding the three a
		     phone shop sees would hide a fourth it stocks. -->
		<div v-if="tabs.length > 1" class="recargas__tabs" role="tablist">
			<button
				v-for="tab in tabs"
				:key="tab.id"
				type="button"
				role="tab"
				class="recargas__tab"
				:class="{ 'is-on': tab.id === activeTabId }"
				:aria-selected="tab.id === activeTabId ? 'true' : 'false'"
				:data-testid="`recargas-tab-${tab.id}`"
				@click="activeTabId = tab.id"
			>
				{{ tab.label }}
			</button>
		</div>

		<div v-if="activeTab" class="recargas__card">
			<div class="recargas__label">{{ __("Company") }}</div>
			<div class="recargas__carriers">
				<button
					v-for="carrier in activeTab.carriers"
					:key="carrier.id"
					type="button"
					class="recargas__carrier"
					:class="{ 'is-on': carrier.id === carrierId }"
					:aria-pressed="carrier.id === carrierId ? 'true' : 'false'"
					:data-testid="`recargas-carrier-${carrier.id}`"
					@click="chooseCarrier(carrier.id)"
				>
					{{ carrier.label }}
				</button>
			</div>
		</div>

		<div class="recargas__card recargas__entry">
			<div class="recargas__field">
				<div class="recargas__field-head">
					<label class="recargas__label" for="recargas-reference">{{
						__("Number to top up")
					}}</label>
					<!--
						A HINT, never a selection. `hintIsAuthoritative()` returns false
						and explains why: Mexico has had full number portability since
						2019, so nothing in the digits proves who serves the line. What
						this says is what our own ledger recorded — and pressing it is the
						operator choosing, which is the only thing that arms a recharge.
					-->
					<button
						v-if="hint.kind === 'suggested'"
						type="button"
						class="recargas__hint recargas__hint--action"
						data-testid="recargas-hint"
						:data-hint-source="hint.source"
						@click="chooseCarrier(hint.carrier)"
					>
						{{ __("Recharged here before on {0}").replace("{0}", hintCarrierLabel) }}
					</button>
					<span
						v-else-if="hintMessageKey"
						class="recargas__hint"
						data-testid="recargas-hint"
						:data-hint-reason="hint.reason"
					>
						{{ __(hintMessageKey) }}
					</span>
				</div>
				<input
					id="recargas-reference"
					v-model="reference"
					class="recargas__input reg-mono"
					type="tel"
					inputmode="numeric"
					autocomplete="off"
					data-testid="recargas-reference"
				/>
				<!-- Typed twice, on purpose (owner direction 2026-08-22). A recharge to
				     the wrong number is charged and cannot be undone — TAECEL's spec:
				     every request that arrives is charged — so the number has to be
				     confirmed by a second typing, not by a glance. Only a number both
				     fields agree on reaches the intent; until then the band stays
				     disarmed and the mismatch is named under the field. -->
				<label class="recargas__label recargas__label--confirm" for="recargas-reference-confirm">{{
					__("Type the number again")
				}}</label>
				<input
					id="recargas-reference-confirm"
					v-model="referenceConfirm"
					class="recargas__input reg-mono"
					:class="{ 'recargas__input--mismatch': referenceMismatch }"
					type="tel"
					inputmode="numeric"
					autocomplete="off"
					data-testid="recargas-reference-confirm"
					:aria-invalid="referenceMismatch ? 'true' : undefined"
					aria-describedby="recargas-reference-mismatch"
				/>
				<span
					v-if="referenceMismatch"
					id="recargas-reference-mismatch"
					class="recargas__mismatch"
					role="alert"
					data-testid="recargas-reference-mismatch"
				>
					{{ __("The numbers do not match") }}
				</span>
				<div class="recargas__quick">
					<!-- Both of these are real: the last row of today's ledger, and the
					     phone on the customer the register already has open. The
					     artboard's third affordance, "Escanear recibo", is absent —
					     there is no receipt-scanning path in this app, and a dead button
					     on a money screen is worse than no button. -->
					<button
						v-if="lastEntry"
						type="button"
						class="recargas__quick-btn"
						data-testid="recargas-repeat-last"
						@click="repeatLast()"
					>
						{{ __("Repeat last") }}
					</button>
					<button
						v-if="customerPhone"
						type="button"
						class="recargas__quick-btn"
						data-testid="recargas-customer-phone"
						@click="fillReference(customerPhone)"
					>
						{{ __("From the customer on screen") }}
					</button>
				</div>
			</div>

			<div class="recargas__field">
				<div class="recargas__field-head">
					<span class="recargas__label">{{ __("Amount") }}</span>
					<!--
						No "comisión 5 % · te quedan $10.00" here. 5 % is a mock's number
						and the figure beside it is the operator's cut, which no POS
						endpoint returns — `recargasModel.ts` names both gaps and the
						one-line saldo change each needs. Reported, not guessed.
					-->
				</div>
				<div v-if="presets.length" class="recargas__amounts">
					<button
						v-for="product in presets"
						:key="product.code"
						type="button"
						class="recargas__amount reg-mono"
						:class="{ 'is-on': product.code === productCode }"
						:aria-pressed="product.code === productCode ? 'true' : 'false'"
						:data-money-role="MONEY_ROLE.preset"
						:data-testid="`recargas-amount-${product.code}`"
						@click="chooseProduct(product)"
					>
						{{ formatCurrency(product.amount ?? 0) }}
					</button>
				</div>
				<!-- TAECEL's `tipo == "1"`: this company has no fixed catalogue and the
				     amount is typed. Drawing the artboard's $10–$500 grid for it would
				     offer amounts that could never be sent. -->
				<div v-else-if="selectedCarrier" class="recargas__free">
					<label class="recargas__label" for="recargas-free-amount">{{
						__("Free amount")
					}}</label>
					<input
						id="recargas-free-amount"
						v-model="freeAmount"
						class="recargas__input reg-mono"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						data-testid="recargas-free-amount"
					/>
				</div>
			</div>
		</div>

		<slot />
	</div>
</template>

<script setup lang="ts">
/**
 * Capturing one recharge: company, number, amount (build plan §12 item F).
 *
 * It composes an INTENT and emits it. It never sends anything — a request that
 * reaches TAECEL is charged whether it succeeds or not, so the one path that
 * spends the owner's money stays where it already was: the band arms it and
 * `Pos.vue`'s `SALDO-INTEGRATION-POINT` hands it to the saldo app's own capture
 * flow.
 */
import { computed, ref, watch } from "vue";

import { resolveCarrierHint, type CarrierHint } from "./carrierHint";
import {
	amountPresets,
	buildCatalogTabs,
	findCarrier,
	tabForCarrier,
	type CatalogProduct,
} from "./recargasCatalog";
import {
	MONEY_ROLE,
	rechargeBandInput,
	type LedgerEntry,
	type RechargeIntent,
} from "./recargasModel";

type AnyRecord = Record<string, any>;

const props = withDefaults(
	defineProps<{
		/** `catalog_tree()`'s envelope. */
		catalogTree?: AnyRecord | null;
		/** Today's `list_transactions().rows` — the hint's only real evidence. */
		rows?: AnyRecord[];
		/** Newest first, for "Repeat last". */
		lastEntry?: LedgerEntry | null;
		formatCurrency: (value: number) => string;
		customerPhone?: string | null;
	}>(),
	{ catalogTree: null, rows: () => [], lastEntry: null, customerPhone: null },
);

const emit = defineEmits<{
	intent: [{ intent: RechargeIntent; band: ReturnType<typeof rechargeBandInput> }];
}>();

const __ = (window as any).__ || ((value: string) => value);

const tabs = computed(() => buildCatalogTabs(props.catalogTree));
const activeTabId = ref<string | null>(null);
const carrierId = ref<string | null>(null);
const productCode = ref<string | null>(null);
const reference = ref("");
const referenceConfirm = ref("");
const freeAmount = ref("");

/** Both fields, trimmed. A number the operator typed twice the same way. */
const referenceConfirmed = computed(
	() => reference.value.trim() !== "" && reference.value.trim() === referenceConfirm.value.trim(),
);
/** Named only once the second field has something in it — an empty confirm
 * is "not yet", not "wrong". */
const referenceMismatch = computed(
	() => referenceConfirm.value.trim() !== "" && !referenceConfirmed.value,
);

/** A number that came from a RECORD — today's ledger, the customer on screen —
 * was not typed, so there is nothing to mistype; both fields take it. */
function fillReference(value: string): void {
	reference.value = value;
	referenceConfirm.value = value;
}

// The first tab is the landing tab and it follows the catalogue rather than a
// remembered choice: `catalog_tree` already orders Tiempo Aire first, which is
// what this counter sells most of.
watch(
	tabs,
	(next) => {
		if (!activeTabId.value || !next.some((tab) => tab.id === activeTabId.value)) {
			activeTabId.value = next.length ? (next[0]?.id ?? null) : null;
		}
	},
	{ immediate: true },
);

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null);
const selectedCarrier = computed(() => findCarrier(tabs.value, carrierId.value));
const presets = computed(() => amountPresets(selectedCarrier.value));

const selectedProduct = computed<CatalogProduct | null>(
	() => presets.value.find((product) => product.code === productCode.value) ?? null,
);

/** The figure the band will show. A free-amount company has no Item behind a
 * typed number until a product is picked, which is why `itemCode` can be null
 * and the band therefore unarmed. */
const amount = computed<number | null>(() => {
	if (selectedProduct.value?.amount) {
		return selectedProduct.value.amount;
	}
	const typed = Number(String(freeAmount.value).replace(/[^\d.]/g, ""));
	return Number.isFinite(typed) && typed > 0 ? typed : null;
});

/**
 * The hint's evidence is our OWN ledger — every recharge this shop made, with
 * the number it went to and the company it went on. The prefix table it also
 * consults is empty, and `carrierHint.ts` says at length why.
 */
const hint = computed<CarrierHint>(() =>
	resolveCarrierHint(reference.value, { history: props.rows ?? [] }),
);

const hintCarrierLabel = computed(() =>
	hint.value.kind === "suggested"
		? (findCarrier(tabs.value, hint.value.carrier)?.label ?? hint.value.carrier)
		: "",
);

/**
 * What the hint says when it cannot name a company. `empty` is absent from the
 * map on purpose — an empty field does not need to be told it is empty.
 *
 * A map of `{ labelKey }` rather than a switch returning literals, so
 * `registerShellTranslations.spec.ts` can see the strings: its scan reads
 * `__("…")` and any `…Key` property, and `__(someVariable)` is invisible to it.
 * A refusal that ships in English is the worst kind to miss — it is what a
 * cashier reads exactly when something has gone wrong.
 */
const HINT_MESSAGE: Readonly<Record<string, { labelKey: string }>> = {
	incomplete: { labelKey: "Keep typing the number" },
	conflict: { labelKey: "This number has been topped up on more than one company here" },
	"no-source": { labelKey: "Which company?" },
};

const hintMessageKey = computed(() =>
	hint.value.kind === "ask" ? (HINT_MESSAGE[hint.value.reason]?.labelKey ?? null) : null,
);

function chooseCarrier(id: string): void {
	if (carrierId.value === id) {
		return;
	}
	carrierId.value = id;
	// The amount belonged to the previous company's catalogue. Carrying it over
	// would leave a $200 highlighted on a company with no $200 product — and the
	// band would read armed for a recharge that cannot be sent.
	productCode.value = null;
	freeAmount.value = "";
	const owner = tabForCarrier(tabs.value, id);
	if (owner) {
		activeTabId.value = owner.id;
	}
}

function chooseProduct(product: CatalogProduct): void {
	productCode.value = product.code;
	freeAmount.value = "";
}

/** Refill from the last recharge this register made — number, company and
 * amount. It fills the form; it sends nothing. */
function repeatLast(): void {
	const entry = props.lastEntry;
	if (!entry) {
		return;
	}
	// The masked reference on screen cannot be typed back into the field, so the
	// unmasked one is read from the row it was built from.
	const source = (props.rows ?? []).find((row) => String(row?.name ?? "") === entry.id);
	fillReference(String(source?.referencia ?? ""));
	if (entry.carrier) {
		chooseCarrier(entry.carrier);
	}
	const match = amountPresets(findCarrier(tabs.value, entry.carrier)).find(
		(product) => product.amount === entry.amount,
	);
	if (match) {
		chooseProduct(match);
	}
}

const intent = computed<RechargeIntent>(() => ({
	carrier: carrierId.value,
	carrierLabel: selectedCarrier.value?.label ?? null,
	// Only a confirmed number is an intent; `rechargeBandInput` reads an empty
	// reference as "not ready", which is exactly the state a half-typed or
	// mistyped confirmation should leave the band in.
	reference: referenceConfirmed.value ? reference.value.trim() : "",
	amount: amount.value,
	itemCode: selectedProduct.value?.code ?? null,
}));

watch(
	intent,
	(next) => {
		emit("intent", { intent: next, band: rechargeBandInput(next) });
	},
	{ immediate: true, deep: true },
);

defineExpose({ intent, hint, referenceMismatch });
</script>

<style scoped>
.recargas__capture {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md);
	flex: 1 1 auto;
	min-width: 0;
	/* The height chain again: this column hands the whole remainder to the
	 * ledger in its slot, which owns the only scrollport (59c5fe1ad). */
	min-height: 0;
}

.recargas__card {
	flex: 0 0 auto;
	background: var(--reg-surface);
	border: 1px solid var(--reg-border-light);
	border-radius: var(--reg-radius-md);
	padding: var(--reg-space-lg) 16px;
}

.recargas__label {
	display: block;
	font-size: 10.5px;
	font-weight: 700;
	letter-spacing: 0.07em;
	text-transform: uppercase;
	color: var(--reg-tone-neutral-label);
}

.recargas__tabs {
	display: flex;
	gap: 8px;
	flex: 0 0 auto;
	flex-wrap: wrap;
}

/*
 * Tabs, company chips and amount buttons are all NEUTRAL, and selection is a
 * STATE on them (§17.7 invariant 2, build plan §1). The selected treatment is a
 * tint plus an edge, never a saturated fill, because the one saturated colour
 * on this screen belongs to the band's RECARGAR button and a grid of nine
 * filled amount buttons would drown it.
 */
.recargas__tab,
.recargas__carrier,
.recargas__amount,
.recargas__quick-btn {
	font-family: inherit;
	cursor: pointer;
	background: var(--reg-surface);
	border: 1px solid var(--reg-border-soft);
	color: var(--reg-text-secondary);
}

.recargas__tab {
	height: 40px;
	padding: 0 18px;
	border-radius: var(--reg-radius-sm);
	font-size: 13.5px;
	font-weight: 500;
}

.recargas__carriers {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
	gap: 9px;
	margin-top: var(--reg-space-md);
}

.recargas__carrier {
	min-height: 56px;
	border-radius: var(--reg-radius-sm);
	font-size: 12px;
	font-weight: 500;
	padding: 6px;
}

.recargas__tab.is-on,
.recargas__carrier.is-on,
.recargas__amount.is-on {
	background: var(--reg-accent-soft);
	border: 2px solid var(--reg-accent);
	color: var(--reg-on-accent-soft);
	font-weight: 700;
}

.recargas__entry {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 18px;
}

.recargas__field-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	margin-bottom: 9px;
	min-height: 16px;
}

.recargas__hint {
	font-size: 11px;
	color: var(--reg-text-muted);
	background: none;
	border: 0;
	padding: 0;
	text-align: right;
}

.recargas__hint--action {
	cursor: pointer;
	text-decoration: underline;
	color: var(--reg-on-accent-soft);
	font-family: inherit;
}

.recargas__input {
	width: 100%;
	height: 62px;
	border-radius: var(--reg-radius-sm);
	border: 2px solid var(--reg-accent);
	background: var(--reg-accent-soft);
	color: var(--reg-on-accent-soft);
	padding: 0 16px;
	font-size: 26px;
	font-weight: 700;
	letter-spacing: 0.04em;
}

.recargas__quick {
	display: flex;
	flex-wrap: wrap;
	gap: 7px;
	margin-top: 9px;
}

.recargas__quick-btn {
	border-radius: 999px;
	padding: 4px 11px;
	font-size: 11.5px;
	background: var(--reg-surface-muted);
	border: 0;
}

.recargas__amounts {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
	gap: 8px;
}

.recargas__amount {
	min-height: 50px;
	border-radius: var(--reg-radius-sm);
	font-size: 16px;
	font-weight: 700;
	color: var(--reg-text-primary);
}

.recargas__free .recargas__input {
	height: 50px;
	font-size: 20px;
	margin-top: 6px;
}

/*
 * A counter runs on a touch screen more often than not, and these are the
 * controls a cashier hits while a customer waits. 44px is the floor
 * (`--reg-touch-min`), and the hint keeps its own hit area too — it selects a
 * company, which is the decision this screen is most careful about.
 */
@media (pointer: coarse) {
	.recargas__tab,
	.recargas__carrier,
	.recargas__amount,
	.recargas__quick-btn,
	.recargas__hint--action {
		min-height: var(--reg-touch-min);
	}

	.recargas__quick-btn {
		padding: 0 14px;
	}
}

@media (max-width: 1180px) {
	.recargas__entry {
		grid-template-columns: 1fr;
	}
}

.recargas__label--confirm {
	margin-top: 8px;
}

.recargas__input--mismatch {
	border-color: var(--reg-tone-danger-ink);
}

.recargas__mismatch {
	display: block;
	margin-top: 4px;
	font-size: 11.5px;
	color: var(--reg-tone-danger-ink);
}
</style>
