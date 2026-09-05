<template>
	<div class="posa-item-details-form line-detail" :class="expandedContentClasses" data-testid="line-detail">
		<!-- WHICH UNIT — first, because it is the decision that blocks a sale.
		     A serial-numbered or batch-tracked line used to keep its choice at
		     the bottom of this form, behind three sections of read-only stock
		     facts and an autocomplete (owner, 2026-09-05: «the batch/sn
		     selector needs better ui/ux»). The choice now reads as ONE card at
		     the top and is CHANGED through the same lot picker the catalogue
		     tap and the phone's line sheet already open — one picker, three
		     doors — instead of a dropdown that could not show a unit's status. -->
		<section
			v-if="tracksLots"
			class="posa-form-section line-detail__lots"
			:data-state="lotState"
			data-testid="line-detail-lots"
		>
			<div class="posa-section-header line-detail__lots-head">
				<v-icon size="small" class="section-icon">{{ item.has_serial_no ? "mdi-barcode-scan" : "mdi-package-variant-closed" }}</v-icon>
				<span class="posa-section-title">{{ __(lotsTitle) }}</span>
				<span class="line-detail__lots-state reg-mono" data-testid="line-detail-lots-state">{{ lotStateLabel }}</span>
			</div>

			<div v-if="chosenSerials.length" class="line-detail__chips" data-testid="line-detail-serials">
				<span v-for="serial in chosenSerials" :key="serial" class="line-detail__chip reg-mono">{{ serial }}</span>
			</div>
			<div v-if="item.batch_no" class="line-detail__batch" data-testid="line-detail-batch">
				<span class="reg-mono line-detail__chip">{{ item.batch_no }}</span>
				<span v-if="item.batch_no_expiry_date" class="line-detail__meta" :data-expired="item.batch_no_is_expired ? 'true' : 'false'">
					{{ __("Expiry") }} {{ item.batch_no_expiry_date }}
					<template v-if="item.batch_no_is_expired"> · {{ __("Expired") }}</template>
				</span>
				<span v-if="item.actual_batch_qty !== undefined && item.actual_batch_qty !== null" class="line-detail__meta">
					{{ __("Available") }} {{ formatFloat(item.actual_batch_qty) }}
				</span>
			</div>
			<p v-if="!chosenSerials.length && !item.batch_no" class="line-detail__none" data-testid="line-detail-none">
				{{ __(item.has_serial_no ? "No serial number chosen yet." : "No batch chosen yet.") }}
			</p>

			<div class="line-detail__lots-actions">
				<v-btn
					color="primary"
					variant="flat"
					size="default"
					class="line-detail__pick"
					data-testid="line-detail-pick"
					:disabled="!!item.posa_is_replace || !canPick"
					@click.stop="openPicker"
				>
					<v-icon size="small" class="mr-1">mdi-pencil</v-icon>
					{{ __(pickLabel) }}
				</v-btn>
				<span v-if="!canPick" class="line-detail__meta">{{ __("The picker needs the register's cart.") }}</span>
			</div>
		</section>

		<!-- QUANTITY & PRICE: the numbers a cashier actually edits, on one row. -->
		<section class="posa-form-section">
			<div class="posa-section-header">
				<v-icon size="small" class="section-icon">mdi-currency-usd</v-icon>
				<span class="posa-section-title">{{ __("Pricing & Discounts") }}</span>
			</div>
			<div class="posa-form-row line-detail__row">
				<div class="posa-form-field line-detail__field">
					<v-text-field
						density="compact"
						variant="outlined"
						color="primary"
						:label="frappe._('QTY')"
						class="pos-themed-input"
						hide-details
						:model-value="formatFloat(item.qty, hide_qty_decimals ? 0 : undefined)"
						@change="onQtyChange(item, $event)"
						:rules="[isNumber]"
						:disabled="!!item.posa_is_replace || (item.has_serial_no && chosenSerials.length > 0)"
						inputmode="decimal"
						enterkeyhint="done"
						prepend-inner-icon="mdi-numeric"
					></v-text-field>
					<div v-if="item.max_qty !== undefined" class="text-caption mt-1">
						{{ __("In stock: {0}", [formatFloat(item._base_actual_qty, hide_qty_decimals ? 0 : undefined)]) }}
					</div>
				</div>
				<div class="posa-form-field line-detail__field">
					<v-select
						density="compact"
						class="pos-themed-input"
						:label="frappe._('UOM')"
						v-model="item.uom"
						:items="item.item_uoms"
						variant="outlined"
						item-title="uom"
						item-value="uom"
						hide-details
						@update:model-value="calcUom(item, $event)"
						:disabled="!!item.posa_is_replace || (isReturnInvoice && invoice_doc.return_against)"
						prepend-inner-icon="mdi-weight"
					></v-select>
				</div>
				<div class="posa-form-field line-detail__field">
					<v-text-field
						density="compact"
						variant="outlined"
						color="primary"
						id="rate"
						:label="frappe._('Rate')"
						class="pos-themed-input"
						hide-details
						:model-value="formatCurrency(item.rate)"
						@change="[
							setFormatedCurrency(item, 'rate', null, false, $event),
							calcPrices(item, $event.target.value, $event),
						]"
						:disabled="!pos_profile.posa_allow_user_to_edit_rate || !!item.posa_is_replace"
						inputmode="decimal"
						enterkeyhint="done"
						prepend-inner-icon="mdi-currency-usd"
					></v-text-field>
				</div>
			</div>
			<div class="posa-form-row line-detail__row">
				<div class="posa-form-field line-detail__field">
					<v-text-field
						density="compact"
						variant="outlined"
						color="primary"
						id="discount_percentage"
						:label="frappe._('Discount %')"
						class="pos-themed-input"
						hide-details
						:model-value="formatFloat(Math.abs(item.discount_percentage || 0))"
						@change="[
							setFormatedCurrency(item, 'discount_percentage', null, false, $event),
							calcPrices(item, $event.target.value, $event),
						]"
						:disabled="!pos_profile.posa_allow_user_to_edit_item_discount || !!item.posa_is_replace || !!item.posa_offer_applied"
						inputmode="decimal"
						enterkeyhint="done"
						prepend-inner-icon="mdi-percent"
					></v-text-field>
				</div>
				<div class="posa-form-field line-detail__field">
					<v-text-field
						density="compact"
						variant="outlined"
						color="primary"
						id="discount_amount"
						:label="frappe._('Discount Amount')"
						class="pos-themed-input"
						hide-details
						:model-value="formatCurrency(Math.abs(item.discount_amount || 0))"
						@change="[
							setFormatedCurrency(item, 'discount_amount', null, false, $event),
							calcPrices(item, $event.target.value, $event),
						]"
						:disabled="!pos_profile.posa_allow_user_to_edit_item_discount || !!item.posa_is_replace || !!item.posa_offer_applied"
						inputmode="decimal"
						enterkeyhint="done"
						prepend-inner-icon="mdi-tag-minus"
					></v-text-field>
				</div>
				<div class="posa-form-field line-detail__field line-detail__total">
					<span class="line-detail__total-label">{{ __("Total Amount") }}</span>
					<span class="line-detail__total-value reg-mono" data-testid="line-detail-total">{{ formatCurrency(item.qty * item.rate) }}</span>
					<v-btn
						v-if="pos_profile.posa_allow_price_list_rate_change"
						size="small"
						color="primary"
						variant="outlined"
						class="change-price-btn"
						@click.stop="changePriceListRate(item)"
					>
						<v-icon size="small" class="mr-1">mdi-pencil</v-icon>
						{{ __("Change Price") }}
					</v-btn>
				</div>
			</div>
		</section>

		<!-- THE FACTS: read-only, so they read as a fact grid rather than as six
		     greyed-out inputs pretending to be editable. -->
		<section class="posa-form-section">
			<div class="posa-section-header">
				<v-icon size="small" class="section-icon">mdi-warehouse</v-icon>
				<span class="posa-section-title">{{ __("Stock Information") }}</span>
			</div>
			<dl class="line-detail__facts" data-testid="line-detail-facts">
				<dt>{{ __("Item Code") }}</dt>
				<dd class="reg-mono">{{ item.item_code }}</dd>
				<dt>{{ __("Available QTY") }}</dt>
				<dd class="reg-mono">{{ formatFloat(item._base_actual_qty) }}</dd>
				<dt>{{ __("Stock QTY") }}</dt>
				<dd class="reg-mono">{{ formatFloat(item.stock_qty) }} {{ item.stock_uom || "" }}</dd>
				<dt>{{ __("Price List Rate") }}</dt>
				<dd class="reg-mono">{{ currencySymbol(pos_profile.currency) }} {{ formatCurrency(item.price_list_rate ?? 0) }}</dd>
				<dt>{{ __("Warehouse") }}</dt>
				<dd>{{ item.warehouse || "—" }}</dd>
				<dt>{{ __("Group") }}</dt>
				<dd>{{ item.item_group || "—" }}</dd>
				<template v-if="item.posa_offer_applied">
					<dt>{{ __("Offer Applied") }}</dt>
					<dd><v-icon size="small" color="success">mdi-check-circle</v-icon></dd>
				</template>
			</dl>
		</section>

		<!-- Delivery Date Section -->
		<section
			class="posa-form-section"
			v-if="pos_profile.posa_allow_sales_order && ['Order', 'Quotation'].includes(invoiceType || '')"
		>
			<div class="posa-section-header">
				<v-icon size="small" class="section-icon">mdi-calendar-check</v-icon>
				<span class="posa-section-title">{{ __("Delivery Information") }}</span>
			</div>
			<div class="posa-form-row">
				<div class="posa-form-field">
					<VueDatePicker
						v-model="item.posa_delivery_date"
						model-type="format"
						format="dd-MM-yyyy"
						:min-date="new Date()"
						auto-apply
						@update:model-value="validateDueDate(item)"
					/>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";

import type { CartItem, POSProfile, InvoiceDoc } from "../../../types/models";

interface BusLike {
	emit: (event: string, payload?: unknown) => void;
}

interface Props {
	item: CartItem | any;
	pos_profile: POSProfile | any;
	invoiceType?: string;
	isReturnInvoice?: boolean;
	invoice_doc?: InvoiceDoc | any;
	hide_qty_decimals: boolean;
	expandedContentClasses?: any;

	// Formatters
	formatFloat: (_val: any, _precision?: number) => string;
	formatCurrency: (_val: any, _precision?: number) => string;
	currencySymbol: (_currency?: string) => string;
	isNumber: (_val: any) => boolean | string;

	// Actions
	setFormatedCurrency: (_item: any, _field: string, _value: any, _force?: boolean, _event?: any) => void;
	calcPrices: (_item: any, _value: any, _event?: any) => void;
	calcUom: (_item: any, _uom: string) => void;
	changePriceListRate: (_item: any) => void;
	validateDueDate: (_item: any) => void;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	"qty-change": [item: CartItem, event: any];
	/** The picker is a register-level overlay (z-index 31) and this form
	 *  lives inside a Vuetify dialog (z-index 2400+): the dialog must step
	 *  aside or the picker opens underneath it. */
	"request-close": [];
}>();

const __ = (window as any).__ || ((s: string, args?: any[]) => {
	if (!args?.length) return s;
	return args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), s);
});
const frappe = (window as any).frappe || { _: (s: string) => s };

/**
 * The lot picker's edit door. `movil:edit-lots` is the phone line sheet's
 * event, but its listener (`ItemsSelector.movilEditLots`) knows nothing of
 * phones: it finds the row, seeds the picker with the row's current choice
 * and re-shapes the row on confirm through `movil:line-edit`. The desk rings
 * the same bell — the second door, not a second picker.
 */
const eventBus = inject<BusLike | null>("eventBus", null);

const tracksLots = computed(
	() => !!(props.item?.has_serial_no || props.item?.serial_no || props.item?.has_batch_no || props.item?.batch_no),
);
const chosenSerials = computed<string[]>(() =>
	Array.isArray(props.item?.serial_no_selected)
		? props.item.serial_no_selected.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
		: String(props.item?.serial_no || "")
				.split("\n")
				.map((s: string) => s.trim())
				.filter(Boolean),
);
const lotsTitle = computed(() => {
	if (props.item?.has_serial_no && props.item?.has_batch_no) return "Serial & batch";
	return props.item?.has_serial_no ? "Serial Numbers" : "Batch Information";
});
const requestedQty = computed(() => Math.abs(Number(props.item?.qty)) || 0);
const lotState = computed<"complete" | "partial" | "missing">(() => {
	if (props.item?.has_serial_no) {
		if (!chosenSerials.value.length) return "missing";
		return chosenSerials.value.length >= requestedQty.value ? "complete" : "partial";
	}
	return props.item?.batch_no ? "complete" : "missing";
});
const lotStateLabel = computed(() => {
	if (props.item?.has_serial_no) {
		return __("{0} of {1} chosen", [chosenSerials.value.length, props.formatFloat(requestedQty.value, 0)]);
	}
	return props.item?.batch_no ? __("Chosen") : __("Pending");
});
const pickLabel = computed(() => {
	if (props.item?.has_serial_no) return chosenSerials.value.length ? "Change serial numbers" : "Choose a serial number";
	return props.item?.batch_no ? "Change batch" : "Choose a batch";
});
const canPick = computed(() => !!eventBus && !!props.item?.posa_row_id);

const openPicker = () => {
	if (!canPick.value) return;
	eventBus!.emit("movil:edit-lots", {
		rowId: String(props.item.posa_row_id),
		itemCode: String(props.item.item_code || ""),
	});
	emit("request-close");
};

const onQtyChange = (item: CartItem, event: any) => {
	emit("qty-change", item, event);
};
</script>

<style scoped>
.line-detail {
	gap: 14px;
}

.line-detail__lots {
	border-color: var(--reg-accent-edge, #9fdde6);
}

.line-detail__lots[data-state="missing"] {
	border-color: var(--reg-tone-warning-border, #ffd9a0);
	background: var(--reg-tone-warning-bg, #fff8ea);
}

.line-detail__lots-head {
	margin-bottom: 12px;
}

.line-detail__lots-state {
	margin-left: auto;
	font-size: 12px;
	font-weight: 700;
	color: var(--reg-text-secondary, #56606e);
}

.line-detail__lots[data-state="complete"] .line-detail__lots-state {
	color: var(--reg-tone-positive-label, #1b7f4b);
}

.line-detail__lots[data-state="partial"] .line-detail__lots-state,
.line-detail__lots[data-state="missing"] .line-detail__lots-state {
	color: var(--reg-tone-warning-label, #8a5a00);
}

.line-detail__chips,
.line-detail__batch {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.line-detail__chip {
	display: inline-flex;
	align-items: center;
	height: 32px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid var(--reg-accent-edge, #9fdde6);
	background: var(--reg-accent-soft, #e0f7fa);
	color: var(--reg-accent-ink, #00646f);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.02em;
}

.line-detail__meta {
	font-size: 12.5px;
	color: var(--reg-text-secondary, #56606e);
}

.line-detail__meta[data-expired="true"] {
	color: var(--reg-tone-negative-label, #a12626);
	font-weight: 700;
}

.line-detail__none {
	margin: 0 0 12px;
	font-size: 13px;
	color: var(--reg-tone-warning-label, #8a5a00);
}

.line-detail__lots-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

.line-detail__pick {
	min-height: var(--reg-touch-min, 44px);
	text-transform: none;
	letter-spacing: 0.01em;
	font-weight: 700;
}

.line-detail__row {
	margin-bottom: 10px;
}

.line-detail__field {
	min-width: 180px;
}

.line-detail__total {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 2px;
}

.line-detail__total-label {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--reg-text-muted, #8b93a0);
}

.line-detail__total-value {
	font-size: 20px;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.line-detail__facts {
	display: grid;
	grid-template-columns: repeat(3, auto 1fr);
	gap: 8px 12px;
	margin: 0;
	font-size: 13px;
}

.line-detail__facts dt {
	color: var(--reg-text-muted, #8b93a0);
	font-size: 12px;
	white-space: nowrap;
}

.line-detail__facts dd {
	margin: 0;
	color: var(--reg-text-primary, #212121);
	overflow-wrap: anywhere;
}

@media (max-width: 767.98px) {
	.line-detail__facts {
		grid-template-columns: auto 1fr;
	}

	.line-detail__field {
		min-width: 100%;
	}
}
</style>
