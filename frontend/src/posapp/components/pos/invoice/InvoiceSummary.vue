<template>
	<v-card
		class="cards sticky-summary-card mb-0 py-2 px-3 rounded-lg pos-themed-card"
		:class="{ 'sticky-summary-card--dock-safe': useCompactSaleDock }"
	>
		<!-- Tab identity (cafetería "name on the cup") — hidden unless the vertical
		     preset enables the tab_identity capability; retail never renders this. -->
		<div
			v-if="showTabName"
			class="summary-tab-name d-flex ga-2"
			data-test="tab-name-field"
		>
			<v-text-field
				v-model="invoiceStore.posaTabName"
				:label="tabNameLabel"
				prepend-inner-icon="mdi-tag-outline"
				variant="solo"
				density="compact"
				color="primary"
				hide-details
				clearable
				autocomplete="off"
				maxlength="60"
				class="summary-field sleek-field pos-themed-input flex-grow-1"
			/>
			<v-text-field
				:model-value="invoiceStore.posaGuestCount"
				@update:model-value="handleGuestCountUpdate"
				:label="guestCountLabel"
				type="number"
				min="0"
				inputmode="numeric"
				prepend-inner-icon="mdi-account-group-outline"
				variant="solo"
				density="compact"
				color="primary"
				hide-details
				autocomplete="off"
				data-test="guest-count-field"
				style="max-width: 96px"
				class="summary-field sleek-field pos-themed-input"
			/>
		</div>

		<!-- Service type (Dine In / Takeout / Delivery) — its own orthogonal
		     service_types capability; records the value only, tax unaffected. -->
		<div
			v-if="showServiceType"
			class="summary-service-type"
			data-test="service-type-field"
		>
			<v-select
				v-model="invoiceStore.posaServiceType"
				:items="serviceTypeItems"
				:label="serviceTypeLabel"
				prepend-inner-icon="mdi-silverware-fork-knife"
				variant="solo"
				density="compact"
				color="primary"
				hide-details
				clearable
				class="summary-field sleek-field pos-themed-input"
			/>
		</div>

		<!-- The tender, chosen BEFORE the primary action (`Main.dc.html` nodes
		     127–131). The artboard draws this row inside the band, left of
		     PAGAR; the band is not this card's to edit, so it takes the last
		     row before it — the same place in the operator's reading order, and
		     directly above PAY on a phone, where no band mounts at all.

		     It ARMS the payment screen and nothing else. Tendered amount,
		     change due, split payments and submission all stay exactly where
		     they were; what moved earlier is a choice, not money.

		     There is no fixed four. The chips are this register's own payment
		     methods, so a carnicería with cash only renders ONE and no dead
		     siblings. `Mixto` is not among them because it is not a method: it
		     is the empty selection, reached by tapping the lit chip off, and it
		     leaves the payment screen exactly as it opens today — every method
		     listed, every amount open, which is already the split surface. -->
		<div
			v-if="tenderChips.length"
			class="tender-strip"
			role="group"
			:aria-label="__('Method')"
			data-testid="tender-strip"
		>
			<span class="tender-strip__label" aria-hidden="true">{{ __("Method") }}</span>
			<button
				v-for="chip in tenderChips"
				:key="chip.mode"
				type="button"
				class="tender-strip__chip"
				:class="{ 'tender-strip__chip--armed': chip.mode === armedTender }"
				:aria-pressed="chip.mode === armedTender ? 'true' : 'false'"
				data-testid="tender-chip"
				:data-tender-mode="chip.mode"
				@click="selectTender(chip.mode)"
			>
				{{ chip.mode }}
			</button>
		</div>

		<v-row dense class="summary-content">
			<v-col
				v-if="!useCompactSaleDock || showReturnDiscountAlert"
				cols="12"
				:md="useCompactSaleDock ? 12 : 7"
			>
				<v-alert
					v-if="showReturnDiscountAlert"
					density="compact"
					type="info"
					variant="tonal"
					class="summary-field summary-field--alert"
				>
					{{ __("Prorated return discount") }}: {{ formatRatio(return_discount_meta.ratio) }} -
					{{ __("Original") }}: {{ formatCurrency(return_discount_meta.original_discount) }},
					{{ __("Applied") }}:
					{{ formatCurrency(return_discount_meta.prorated_discount) }}
				</v-alert>

				<div
					v-if="!useCompactSaleDock"
					class="summary-hero"
					:class="{ 'summary-hero--band-owns-lane': bandOwnsSaleLane }"
					:data-band-owns-lane="bandOwnsSaleLane ? 'true' : 'false'"
				>
					<!-- TWO SHAPES, and which one renders is decided by who owns the
					     lane — not by CSS weight on a single shape, which is what
					     shipped first and what the screenshot caught.

					     Demoting the figure was not enough. Under an "ACTIVE SALE"
					     eyebrow, an unlabelled amount reads as a total however small
					     it is set, so the register showed the band's total, this
					     figure, and the discount stacked together — three money
					     numbers where §17.7 allows one. The fix is to say what the
					     number IS: `Main.dc.html` writes "Subtotal $973.28" as a
					     label/value pair, and a labelled subtotal cannot be mistaken
					     for the total no matter how it is typeset.

					     `qty` is gone from here on purpose too: the count strip below
					     the cart already says "6 líneas · 9 piezas", and that is the
					     artboard's home for it. -->
					<div
						v-if="bandOwnsSaleLane"
						class="summary-breakdown"
						data-testid="summary-breakdown"
					>
						<span class="summary-breakdown__pair">
							<span class="summary-breakdown__label">{{ __("Subtotal") }}</span>
							<span
								class="summary-breakdown__value"
								data-testid="summary-subtotal"
								data-money-role="breakdown"
								>{{ currencySymbol(displayCurrency) }}{{ formatCurrency(subtotal) }}</span
							>
						</span>
						<span class="summary-breakdown__pair">
							<span class="summary-breakdown__label">{{ __("Discount") }}</span>
							<span class="summary-breakdown__value" data-money-role="breakdown"
								>{{ currencySymbol(displayCurrency)
								}}{{ formatCurrency(total_items_discount_amount) }}</span
							>
						</span>
					</div>
					<!-- No band below (a lean-vertical preset at desktop width): this
					     card IS the lane, so the figure keeps its weight and carries
					     the total role. -->
					<div v-else class="summary-hero__copy">
						<span class="summary-hero__eyebrow">{{ __("Active sale") }}</span>
						<strong
							class="summary-hero__amount"
							data-testid="summary-subtotal"
							data-money-role="total"
						>
							{{ currencySymbol(displayCurrency) }}{{ formatCurrency(subtotal) }}
						</strong>
						<div class="summary-hero__meta">
							<span
								>{{ formatFloat(total_qty, hide_qty_decimals ? 0 : undefined) }}
								{{ __("qty") }}</span
							>
							<span>
								{{ currencySymbol(displayCurrency)
								}}{{ formatCurrency(total_items_discount_amount) }}
								{{ __("discount") }}
							</span>
						</div>
					</div>

					<!-- The field stays (muscle memory, Alt+A); the button is the
					     clearer target a busy counter needs — §17.2. -->
					<v-btn
						v-if="pos_profile.posa_allow_user_to_edit_additional_discount && !discount_percentage_offer_name"
						class="summary-discount-btn"
						variant="tonal"
						prepend-icon="mdi-tag-minus"
						data-testid="open-discount-dialog"
						@click="discountDialogOpen = true"
					>{{ __("Discount") }}</v-btn>

					<DiscountDialog
						v-model="discountDialogOpen"
						:base-total="Number(subtotal) || 0"
						:currency-symbol="currencySymbol(pos_profile.currency)"
						:initial-mode="pos_profile.posa_use_percentage_discount ? 'percentage' : 'amount'"
						:initial-percentage="additional_discount_percentage"
						:initial-amount="additional_discount"
						@apply="applyDiscountFromDialog"
						@clear="clearDiscountFromDialog"
					/>

					<div class="summary-hero__field-wrap">
						<v-text-field
							v-if="!pos_profile.posa_use_percentage_discount"
							ref="additionalDiscountField"
							v-model="additionalDiscountDisplay"
							@update:model-value="handleAdditionalDiscountUpdate"
							@focus="handleAdditionalDiscountFocus"
							@blur="handleAdditionalDiscountBlur"
							:label="frappe._('Additional Discount')"
							prepend-inner-icon="mdi-cash-minus"
							variant="solo"
							density="compact"
							color="primary"
							:prefix="currencySymbol(pos_profile.currency)"
							inputmode="decimal"
							enterkeyhint="done"
							:disabled="
								!pos_profile.posa_allow_user_to_edit_additional_discount ||
								!!discount_percentage_offer_name
							"
							class="summary-field summary-field--dock"
						/>

						<v-text-field
							v-else
							ref="additionalDiscountField"
							v-model="additionalDiscountPercentageDisplay"
							@update:model-value="handleAdditionalDiscountPercentageUpdate"
							@change="$emit('update_discount_umount')"
							@focus="handleAdditionalDiscountPercentageFocus"
							@blur="handleAdditionalDiscountPercentageBlur"
							:rules="[isNumber]"
							:label="frappe._('Additional Discount %')"
							suffix="%"
							prepend-inner-icon="mdi-percent"
							variant="solo"
							density="compact"
							color="primary"
							inputmode="decimal"
							enterkeyhint="done"
							:disabled="
								!pos_profile.posa_allow_user_to_edit_additional_discount ||
								!!discount_percentage_offer_name
							"
							class="summary-field summary-field--dock"
						/>
					</div>
				</div>
			</v-col>

			<v-col cols="12" :md="useCompactSaleDock ? 12 : 5" class="invoice-summary-actions">
				<InvoiceActionButtons
					:pos_profile="pos_profile"
					:band-owns-primary="bandOwnsSaleLane"
					:line-summary="lineSummary"
					:saveLoading="saveLoading"
					:loadDraftsLoading="loadDraftsLoading"
					:selectOrderLoading="selectOrderLoading"
					:selectPurchaseOrderLoading="selectPurchaseOrderLoading"
					:cancelLoading="cancelLoading"
					:invoiceManagementLoading="invoiceManagementLoading"
					:returnsLoading="returnsLoading"
					:printLoading="printLoading"
					:paymentLoading="paymentLoading"
					:customerDisplayLoading="customerDisplayLoading"
					@save-and-clear="handleSaveAndClear"
					@load-drafts="handleLoadDrafts"
					@select-order="handleSelectOrder"
					@cancel-sale="handleCancelSale"
					@open-invoice-management="handleOpenInvoiceManagement"
					@open-returns="handleOpenReturns"
					@print-draft="handlePrintDraft"
					@show-payment="handleShowPayment"
					@open-customer-display="handleOpenCustomerDisplay"
					@open-saldo-picker="$emit('open-saldo-picker')"
				/>
			</v-col>
		</v-row>
	</v-card>

	<v-navigation-drawer
		v-if="showDesktopDrafts"
		v-model="desktopDraftsDrawer"
		location="right"
		temporary
		width="360"
		class="drafts-drawer"
	>
		<div class="drafts-drawer__body">
			<DocumentSourceSelector
				v-if="showDraftSourceSelector"
				v-model="currentDraftSource"
				:options="availableDraftSources"
				compact
				:aria-label="__('Draft source')"
				class="drafts-drawer__sources"
			/>
			<ParkedOrdersList
				ref="desktopDraftsList"
				:parked-orders="allDrafts"
				:format-currency="formatCurrency"
				:currency-symbol="currencySymbol"
				:show-manage-all="true"
				:loading="loadDraftsLoading"
				:loading-title="__(currentDraftSourceOption.loadingLabel)"
				:title="currentDraftSourceOption.panelTitle"
				:eyebrow="currentDraftSourceOption.panelEyebrow"
				:subtitle="currentDraftSourceOption.panelSubtitle"
				:empty-title="__(currentDraftSourceOption.emptyTitle)"
				:empty-subtitle="__(currentDraftSourceOption.emptySubtitle)"
				@resume="handleResumeDraft"
				@manage-all="handleManageAllDrafts"
				@close="closeDraftsSurface"
			/>
		</div>
	</v-navigation-drawer>

	<v-dialog v-else v-model="mobileDraftsDialog" max-width="680" scrollable data-test="mobile-drafts-dialog">
		<v-card class="pos-themed-card">
			<v-card-title class="d-flex align-center justify-space-between">
				<span>{{ __(currentDraftSourceOption.panelTitle) }}</span>
				<v-btn variant="text" size="small" @click="mobileDraftsDialog = false">
					{{ __("Close") }}
				</v-btn>
			</v-card-title>
			<v-card-text class="pt-0">
				<DocumentSourceSelector
					v-if="showDraftSourceSelector"
					v-model="currentDraftSource"
					:options="availableDraftSources"
					compact
					:aria-label="__('Draft source')"
					class="drafts-drawer__sources"
				/>
				<ParkedOrdersList
					ref="mobileDraftsList"
					:parked-orders="allDrafts"
					:format-currency="formatCurrency"
					:currency-symbol="currencySymbol"
					:show-manage-all="true"
					:loading="loadDraftsLoading"
					:loading-title="__(currentDraftSourceOption.loadingLabel)"
					:title="currentDraftSourceOption.panelTitle"
					:eyebrow="currentDraftSourceOption.panelEyebrow"
					:subtitle="currentDraftSourceOption.panelSubtitle"
					:empty-title="__(currentDraftSourceOption.emptyTitle)"
					:empty-subtitle="__(currentDraftSourceOption.emptySubtitle)"
					@resume="handleResumeDraft"
					@manage-all="handleManageAllDrafts"
					@close="closeDraftsSurface"
				/>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { loadItemSelectorSettings } from "../../../utils/itemSelectorSettings";
import { useResponsive } from "../../../composables/core/useResponsive";
import { useUIStore } from "../../../stores/uiStore";
import DiscountDialog from "./DiscountDialog.vue";
import { useVerticalStore } from "../../../stores/verticalStore";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import {
	getAvailableDocumentSources,
	getDefaultDocumentSource,
	getDocumentSourceOption,
	shouldShowDocumentSourceSelector,
} from "../../../utils/documentSources";
import InvoiceActionButtons from "./InvoiceActionButtons.vue";
import { bandOwnsLane } from "./bandLaneOwnership";
import { mixedIsAvailable, resolveTenderChips } from "./tenderChips";
import {
	armTender,
	peekArmedTender,
	resetTenderSelection,
	revalidateArmedTender,
} from "./armedTender";
import ParkedOrdersList from "./ParkedOrdersList.vue";
import DocumentSourceSelector from "../shared/DocumentSourceSelector.vue";

defineOptions({
	name: "InvoiceSummary",
});

const props = defineProps({
	pos_profile: Object,
	total_qty: [Number, String],
	additional_discount: Number,
	additional_discount_percentage: Number,
	total_items_discount_amount: Number,
	subtotal: Number,
	displayCurrency: String,
	formatFloat: Function,
	formatCurrency: Function,
	currencySymbol: Function,
	discount_percentage_offer_name: [String, Number],
	isNumber: Function,
	return_discount_meta: Object,
});

const emit = defineEmits([
	"update:additional_discount",
	"update:additional_discount_percentage",
	"update_discount_umount",
	"save-and-clear",
	"load-drafts",
	"select-order",
	"cancel-sale",
	"open-invoice-management",
	"open-returns",
	"print-draft",
	"show-payment",
	"open-customer-display",
	"resume-parked-order",
	"open-saldo-picker",
]);

const discountDialogOpen = ref(false);

/**
 * The dialog owns no pricing: it hands back the operator's intent and we
 * push it through the SAME emits the inline field uses, so the two surfaces
 * can never disagree about what a discount means.
 */
const applyDiscountFromDialog = ({ mode, value }) => {
	if (mode === "percentage") {
		emit("update:additional_discount_percentage", value);
	} else {
		emit("update:additional_discount", value);
	}
};

const clearDiscountFromDialog = () => {
	// Both, deliberately: clearing only the active mode would leave the other
	// one still applied and invisible.
	emit("update:additional_discount_percentage", 0);
	emit("update:additional_discount", 0);
};

const saveLoading = ref(false);
const loadDraftsLoading = ref(false);
const selectOrderLoading = ref(false);
const cancelLoading = ref(false);
const invoiceManagementLoading = ref(false);
const returnsLoading = ref(false);
const printLoading = ref(false);
const paymentLoading = ref(false);
const customerDisplayLoading = ref(false);
const isEditingAdditionalDiscount = ref(false);
const isEditingAdditionalDiscountPercentage = ref(false);
const additionalDiscountField = ref(null);
const desktopDraftsDrawer = ref(false);
const mobileDraftsDialog = ref(false);
const desktopDraftsList = ref(null);
const mobileDraftsList = ref(null);
const responsive = useResponsive();
const uiStore = useUIStore();
const verticalStore = useVerticalStore();
const invoiceStore = useInvoiceStore();

// Counts at the strip's left, the way `Main.dc.html` opens that line
// ("6 líneas · 9 piezas"). Sourced from the store rather than recounted, so it
// cannot disagree with the cart it describes.
const __ = window.__;
const lineSummary = computed(() => {
	const lines = invoiceStore.itemsCount ?? 0;
	const pieces = invoiceStore.totalQty ?? 0;
	// ONE string with placeholders, not three fragments concatenated. Assembling
	// a sentence from separate `__()` calls forces every translator to guess at
	// an order and an agreement they cannot see — the same trap the offline
	// overlay's bare "You can" fell into. It also let the wrong noun ship: the
	// existing `Lines` row reads "Partidas" (accounting), while the artboard —
	// which §17.7 makes the reference of record — writes "líneas" (the counter's
	// word). A dedicated row lets this strip say líneas without repointing
	// `Lines` for anyone else.
	return __("{0} lines · {1} pcs", [lines, pieces]);
});
const { parkedOrders, draftSource } = storeToRefs(uiStore);

// ---- tender pre-selection ------------------------------------------------
// The register's own payment methods, never a hardcoded list. `pos_profile`
// carries the same `payments` child table `get_payments()` builds the invoice's
// payment lines from, so the chips and the payment screen cannot offer
// different tenders.
const tenderChips = computed(() => resolveTenderChips(props.pos_profile));

// What makes an arm valid, re-read on every change rather than captured at
// selection time — the cart, the profile and the return flag all move
// underneath a chosen tender.
const tenderContext = computed(() => ({
	cartHasItems: (invoiceStore.itemsCount ?? 0) > 0,
	isReturn: Boolean(invoiceStore.invoiceDoc?.is_return),
}));

// Reactive because `peekArmedTender()` reads the holder's ref: a tender that
// stops being valid un-lights its chip on the same tick it stops being armed,
// so the strip can never show a selection the payment screen would ignore.
const armedTender = computed(() => peekArmedTender());

function selectTender(mode) {
	// Tapping the lit chip clears it, and clearing IS "Mixto" — the payment
	// screen with nothing pre-armed is already the split-payment surface. A
	// register with one tender has nothing to mix, so its chip does not toggle
	// off; that would leave the strip looking broken with no way back.
	const next = armedTender.value === mode && mixedIsAvailable(tenderChips.value) ? null : mode;
	armTender(next, tenderChips.value, tenderContext.value);
}

// One guard, run on every world change. A profile reload that drops a method,
// a cart edit that empties the ticket, a sale that turns into a return — all
// resolve through `resolveArmedTender`, so there is no second definition of
// "valid" to drift from the first.
watch(
	[tenderChips, tenderContext],
	([chips, context]) => {
		revalidateArmedTender(chips, context);
	},
	{ immediate: true },
);

// The sale ended: back to the register's default rather than the previous
// customer's tender. Suppressing an empty cart is not enough on its own —
// without this, refilling the cart would re-light a choice made for a ticket
// that has already been paid.
watch(
	() => invoiceStore.itemsCount ?? 0,
	(count, previous) => {
		if (count === 0 && (previous ?? 0) > 0) {
			resetTenderSelection();
		}
	},
);

// Cafetería "name on the cup" — only surfaces when the vertical preset enables
// the tab_identity capability. Off (retail) → nothing renders, no layout shift.
const showTabName = computed(() => verticalStore.has("tab_identity"));
const tabNameLabel = computed(() => verticalStore.t("Tab Name"));
const guestCountLabel = computed(() => verticalStore.t("Guests"));
// Service type is an orthogonal capability — a taquería can enable it without
// the tab-name identity. Option titles run through the vocabulary so a preset
// can localise "Dine In" → "Para aquí", etc.
const SERVICE_TYPES = ["Dine In", "Takeout", "Delivery"];
const showServiceType = computed(() => verticalStore.has("service_types"));
const serviceTypeLabel = computed(() => verticalStore.t("Service Type"));
const serviceTypeItems = computed(() =>
	SERVICE_TYPES.map((value) => ({ value, title: verticalStore.t(value) })),
);

// posa_rt_guest_count is a non_negative server field: a negative typed into the
// number input would only surface as a save error at hold/pay time, with the
// cart already built. Normalise at the edge — blank/NaN/negative all mean "no
// count" (null), which is also what the row-meta `v-if` treats as absent.
function handleGuestCountUpdate(value) {
	const parsed = Number(value);
	invoiceStore.posaGuestCount =
		value === "" || value === null || !Number.isFinite(parsed) || parsed < 0
			? null
			: parsed;
}

const additionalDiscountDisplay = ref(normalizeAdditionalDiscountDisplay(props.additional_discount));
const additionalDiscountPercentageDisplay = ref(
	normalizeDiscountDisplay(props.additional_discount_percentage),
);
const useCompactSaleDock = computed(() => responsive.windowWidth.value < 1100);
/**
 * True when the shell's ActionBand is mounted below this card and carrying
 * the sale's number and primary action. The summary then yields BOTH — see
 * `bandLaneOwnership.ts` for why the predicate is duplicated and how it is
 * guarded against drifting from `Pos.vue`'s `railVisible`.
 *
 * What the summary keeps regardless: the subtotal/qty/discount breakdown (the
 * band's 60px figure is the total, and a cashier still needs to see what it is
 * made of) and every SECONDARY action. The invariant is one number and one
 * PRIMARY action, not one button.
 */
const bandOwnsSaleLane = computed(() =>
	bandOwnsLane(Boolean(verticalStore.leanVerticalLayout), responsive.windowWidth.value),
);
const showDesktopDrafts = computed(() => Boolean(responsive.isDesktop.value));
const showReturnDiscountAlert = computed(
	() =>
		!!props.return_discount_meta &&
		!props.pos_profile?.posa_use_percentage_discount &&
		!isFullReturnDiscount(props.return_discount_meta?.ratio),
);
const allDrafts = computed(() => (Array.isArray(parkedOrders.value) ? parkedOrders.value : []));
const availableDraftSources = computed(() => getAvailableDocumentSources(props.pos_profile));
const showDraftSourceSelector = computed(() => shouldShowDocumentSourceSelector(availableDraftSources.value));
const currentDraftSource = computed({
	get() {
		return getDefaultDocumentSource(props.pos_profile, draftSource.value);
	},
	async set(value) {
		const nextSource = getDefaultDocumentSource(props.pos_profile, value);
		if (draftSource.value === nextSource) {
			return;
		}
		uiStore.setDraftSource(nextSource);
		uiStore.setParkedOrders([]);
		await emit("load-drafts", nextSource);
	},
});
const currentDraftSourceOption = computed(() => getDocumentSourceOption(currentDraftSource.value));

const hide_qty_decimals = computed(() => {
	const opts = loadItemSelectorSettings();
	return !!opts?.hide_qty_decimals;
});

watch(
	// Drop deep:true — only need to react to profile reassignment.
	() => props.pos_profile,
	() => {
		const nextSource = getDefaultDocumentSource(props.pos_profile, draftSource.value);
		if (draftSource.value !== nextSource) {
			uiStore.setDraftSource(nextSource);
		}
	},
	{ immediate: true },
);

watch(
	() => [
		props.additional_discount,
		props.return_discount_meta?.prorated_discount,
		props.pos_profile?.posa_use_percentage_discount,
	],
	([value]) => {
		if (!isEditingAdditionalDiscount.value) {
			additionalDiscountDisplay.value = normalizeAdditionalDiscountDisplay(value);
		}
	},
);

watch(
	() => props.additional_discount_percentage,
	(value) => {
		if (!isEditingAdditionalDiscountPercentage.value) {
			additionalDiscountPercentageDisplay.value = normalizeDiscountDisplay(value);
		}
	},
);

function normalizeDiscountDisplay(value) {
	if (value === 0 || value === "0") {
		return "";
	}
	return value;
}

function normalizeAdditionalDiscountDisplay(value) {
	if (value === 0 || value === "0") {
		return "";
	}
	if (props.return_discount_meta && !props.pos_profile?.posa_use_percentage_discount) {
		const proratedValue = Number(props.return_discount_meta.prorated_discount);
		if (Number.isFinite(proratedValue)) {
			return Math.abs(proratedValue);
		}
		const numericValue = Number(value);
		if (Number.isFinite(numericValue)) {
			return Math.abs(numericValue);
		}
	}
	return value;
}

function normalizeAdditionalDiscountInput(value) {
	if (props.return_discount_meta && !props.pos_profile?.posa_use_percentage_discount) {
		const numericValue = Number(value);
		if (Number.isFinite(numericValue)) {
			const originalStoredValue = Number(props.additional_discount);
			const sign = Math.sign(
				Number.isFinite(originalStoredValue) && originalStoredValue !== 0 ? originalStoredValue : -1,
			);
			return sign * Math.abs(numericValue);
		}
	}
	return value;
}

function handleAdditionalDiscountUpdate(value) {
	emit("update:additional_discount", normalizeAdditionalDiscountInput(value));
}

function handleAdditionalDiscountFocus() {
	isEditingAdditionalDiscount.value = true;
}

function handleAdditionalDiscountBlur() {
	isEditingAdditionalDiscount.value = false;
}

function handleAdditionalDiscountPercentageUpdate(value) {
	emit("update:additional_discount_percentage", value);
}

function handleAdditionalDiscountPercentageFocus() {
	isEditingAdditionalDiscountPercentage.value = true;
}

function handleAdditionalDiscountPercentageBlur() {
	isEditingAdditionalDiscountPercentage.value = false;
}

function focusAdditionalDiscountField() {
	const field = additionalDiscountField.value;
	field?.focus?.();
	field?.$el?.querySelector?.("input")?.focus?.();
}

function formatRatio(value) {
	const ratio = Number.isFinite(Number(value)) ? Number(value) : 0;
	const percent = Math.round(ratio * 10000) / 100;
	return `${percent}%`;
}

function isFullReturnDiscount(value) {
	const ratio = Number.isFinite(Number(value)) ? Number(value) : 0;
	return Math.abs(ratio - 1) < 0.0001;
}

async function handleSaveAndClear() {
	saveLoading.value = true;
	try {
		await emit("save-and-clear");
	} finally {
		saveLoading.value = false;
	}
}

function handleLoadDrafts() {
	const nextSource = getDefaultDocumentSource(props.pos_profile, "invoice");
	uiStore.setDraftSource(nextSource);
	uiStore.setParkedOrders([]);
	openDraftsSurface({ focus: false });
	emit("load-drafts", nextSource);
}

function openDraftsSurface(options = {}) {
	if (showDesktopDrafts.value) {
		desktopDraftsDrawer.value = true;
		if (options.focus !== false) {
			void focusDraftsSurface();
		}
		return;
	}

	mobileDraftsDialog.value = true;
	if (options.focus !== false) {
		void focusDraftsSurface();
	}
}

function closeDraftsSurface() {
	desktopDraftsDrawer.value = false;
	mobileDraftsDialog.value = false;
}

async function focusDraftsSurface() {
	await nextTick();
	await new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(resolve);
			return;
		}
		setTimeout(resolve, 0);
	});
	const list = showDesktopDrafts.value ? desktopDraftsList.value : mobileDraftsList.value;
	await list?.focusFirstDraft?.();
}

async function handleSelectOrder() {
	selectOrderLoading.value = true;
	try {
		await emit("select-order");
	} finally {
		selectOrderLoading.value = false;
	}
}

async function handleCancelSale() {
	cancelLoading.value = true;
	try {
		await emit("cancel-sale");
	} finally {
		cancelLoading.value = false;
	}
}

async function handleOpenInvoiceManagement() {
	invoiceManagementLoading.value = true;
	try {
		await emit("open-invoice-management");
	} finally {
		invoiceManagementLoading.value = false;
	}
}

function handleManageAllDrafts() {
	closeDraftsSurface();
	uiStore.setInvoiceManagementDraftSource(currentDraftSource.value);
	emit("open-invoice-management", "drafts", currentDraftSource.value);
}

async function handleOpenReturns() {
	returnsLoading.value = true;
	try {
		await emit("open-returns");
	} finally {
		returnsLoading.value = false;
	}
}

async function handlePrintDraft() {
	printLoading.value = true;
	try {
		await emit("print-draft");
	} finally {
		printLoading.value = false;
	}
}

async function handleShowPayment() {
	paymentLoading.value = true;
	try {
		await emit("show-payment");
	} finally {
		paymentLoading.value = false;
	}
}

async function handleOpenCustomerDisplay() {
	customerDisplayLoading.value = true;
	try {
		await emit("open-customer-display");
	} finally {
		customerDisplayLoading.value = false;
	}
}

function handleResumeDraft(draft) {
	closeDraftsSurface();
	emit("resume-parked-order", draft);
}

defineExpose({
	focusAdditionalDiscountField,
	focusDraftsSurface,
	handleManageAllDrafts,
	openDraftsSurface,
	closeDraftsSurface,
	setDraftsLoading(value) {
		loadDraftsLoading.value = Boolean(value);
	},
});
</script>

<style scoped>
.drafts-drawer :deep(.v-navigation-drawer__content) {
	padding: 12px;
	background: var(--pos-surface-muted);
}

.drafts-drawer__body {
	padding: 4px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.drafts-drawer__sources {
	position: sticky;
	top: 0;
	z-index: 1;
	padding: 4px;
	background: var(--pos-surface-muted);
	border-radius: 16px;
}

.cards {
	background-color: var(--pos-card-bg) !important;
	transition: all 0.3s ease;
}

/* Pinned, not sticky-by-luck. `flex: 0 0 auto` is what guarantees the totals
 * and the action grid keep their full height and stay on screen: the cart list
 * above is the elastic sibling, so this can never be scrolled out of reach.
 * `position: sticky` is kept for the mobile path, where the column still
 * scrolls with the document. */
.sticky-summary-card {
	position: sticky;
	bottom: 0;
	z-index: 9;
	flex: 0 0 auto;
	box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.08);
}

/* `sticky-summary-card--dock-safe` deliberately carries no margin. The card is
 * `class="cards sticky-summary-card mb-0 …"`, and Vuetify's
 * `.mb-0 { margin-bottom: 0px !important }` beat every
 * `margin-bottom: calc(var(--bottom-safe-space) + …)` this class used to
 * declare — measured computed margin-bottom was 0px at 630 px and 900 px, in
 * all three bands. Clearance under the action grid comes from Pos.vue's
 * `.dynamic-container` padding-bottom instead; see the note in Invoice.vue.
 * Pinned by tests/cartActionBarLayout.spec.ts. */

.summary-content {
	row-gap: 6px;
}

/* One line, ~34px, the way `Main.dc.html` writes the strip it sits beside.
   This area was cut from ~200px to ~38px this wave, so the chips pay for their
   height by removing a step from every cash sale — they are a row, not a
   panel, and nothing here changes the card's `flex: 0 0 auto`, so commit
   59c5fe1ad's single-scrollport chain is untouched: the cart is still the one
   elastic sibling. */
.tender-strip {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
	padding: 2px 2px 6px;
}

.tender-strip__label {
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--pos-text-muted, #667085);
	margin-right: 2px;
}

/* Neutral by construction, and a native button so no Vuetify `color` prop can
   quietly become a background here. */
.tender-strip__chip {
	appearance: none;
	border: 1px solid transparent;
	border-radius: 999px;
	padding: 0 12px;
	min-height: 28px;
	font: inherit;
	font-size: 12px;
	font-weight: 500;
	line-height: 1;
	white-space: nowrap;
	cursor: pointer;
	background: var(--pos-surface-variant, #f2f4f7);
	color: var(--pos-text-muted, #667085);
}

/* SELECTED IS STATE, NOT EMPHASIS (§17.7 invariant 2). The one saturated
   accent on this screen belongs to the primary button, so the armed chip is
   carried by the pale wash + its paired ink and a weight step — the same pair
   `Main.dc.html` paints its lit chip with (`--ac-soft` on `#00646f`), and both
   halves flip with the theme so dark mode is not a second palette. */
.tender-strip__chip--armed {
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-on-accent-soft, #00646f);
	border-color: var(--reg-accent-edge, #9fdde6);
	font-weight: 700;
}

.tender-strip__chip:focus-visible {
	outline: 2px solid var(--pos-primary, #0097a7);
	outline-offset: 2px;
}

/* A counter terminal is a touch screen at desktop width — same 44px floor the
   action strip takes, without the phone reflow. */
@media (pointer: coarse) {
	.tender-strip__chip {
		min-height: 44px;
	}
}

.summary-tab-name,
.summary-service-type {
	margin-bottom: 8px;
}

.summary-hero {
	display: flex;
	align-items: center;
	justify-content: space-between;
	/* Wrap rather than crush: this row gained a third child (the Discount
	   button) beside a fixed 260px field, so on a narrow panel something has
	   to give. It must never be the total. */
	flex-wrap: wrap;
	gap: 14px;
	padding: 14px 16px;
	border-radius: 20px;
	background:
		linear-gradient(135deg, rgba(var(--v-theme-primary), 0.12), rgba(var(--v-theme-success), 0.08)),
		var(--pos-surface-muted);
	border: 1px solid rgba(var(--v-theme-primary), 0.12);
}

.summary-hero__copy {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.summary-hero__eyebrow {
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--pos-text-secondary);
}

.summary-hero__amount {
	font-size: clamp(1.2rem, 2vw, 1.8rem);
	line-height: 1.1;
	color: var(--pos-text-primary);
	/* The number a cashier reads out loud is ONE thing. Without this the
	   flex row split "MX$102.00" into "MX$10 / 2.00" — not a smaller total,
	   a different and wrong number at a glance. */
	white-space: nowrap;
}

/* Band present: the subtotal drops to breakdown weight so the band's 60px
   total is unambiguously THE number on screen (§17.7 invariant 1). It is
   demoted rather than hidden — a cashier still needs to see what the total is
   made of, and the eyebrow is retitled by weight alone, not by swapping the
   string, so nothing has to be translated twice.

   Deliberately only type: no display:none, no height change. The card is
   `flex: 0 0 auto` and the cart above it is the single elastic sibling
   (commit 59c5fe1ad), so collapsing this block would hand the cart height it
   would then have to give back the moment the band unmounts on a resize. */
/* The breakdown shape: label/value pairs on one line, the way
   `Main.dc.html` writes "Subtotal $973.28". No eyebrow and no hero weight —
   the LABEL is what stops the figure reading as a total, not the type size. */
.summary-breakdown {
	display: flex;
	align-items: baseline;
	flex-wrap: wrap;
	gap: 4px 18px;
	min-width: 0;
}

.summary-breakdown__pair {
	display: inline-flex;
	align-items: baseline;
	gap: 6px;
	white-space: nowrap;
}

.summary-breakdown__label {
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--pos-text-muted, #667085);
}

.summary-breakdown__value {
	font-size: 0.95rem;
	font-weight: 600;
	color: var(--pos-text-secondary);
	font-variant-numeric: tabular-nums;
}

/* The card stops announcing itself when it is no longer the lane: no tint, no
   border, no 20px radius. It is a breakdown line sitting above the band, and a
   gradient panel around it competed with the one surface that should draw the
   eye. */
.summary-hero--band-owns-lane {
	background: none;
	border-color: transparent;
	border-radius: 0;
	padding: 4px 2px;
	gap: 10px;
}

/* The Discount button keeps its own size and never squeezes the total;
   when the row runs out of width it wraps to the next line instead. */
.summary-discount-btn {
	flex: 0 0 auto;
}

.summary-hero__meta {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 14px;
	font-size: 0.84rem;
	color: var(--pos-text-secondary);
}

.summary-hero__field-wrap {
	width: min(260px, 100%);
}

.invoice-summary-actions {
	position: sticky;
	bottom: 0;
}

.summary-field {
	transition: all 0.2s ease;
}

.summary-field:hover {
	transform: translateY(-1px);
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.summary-field--alert {
	margin-bottom: 10px;
}

.summary-field--dock :deep(.v-field) {
	background: rgba(var(--v-theme-surface), 0.92);
}

@media (max-width: 1279px) {
	.sticky-summary-card {
		position: static;
		bottom: auto;
		box-shadow: none;
	}

	.invoice-summary-actions {
		position: static;
	}
}

@media (max-width: 768px) {
	.sticky-summary-card {
		position: static;
		bottom: auto;
		box-shadow: none;
	}

	.summary-hero {
		flex-direction: column;
		align-items: stretch;
		padding: 12px;
	}

	.summary-hero__field-wrap {
		width: 100%;
	}

	.invoice-summary-actions {
		position: static;
	}

	.cards {
		padding: 10px 12px !important;
	}

	.summary-field {
		font-size: 0.875rem;
	}
}
</style>
