<template>
	<tr class="posa-cart-item-row" v-memo="memoDeps">
		<template v-for="column in visibleColumns" :key="column.key">
			<!-- Item Name Column -->
			<td v-if="column.key === 'item_name'" class="text-start" :data-column-key="'item_name'">
				<div class="d-flex align-center posa-cart-item-row__name-cell">
					<span class="posa-cart-item-row__name" :title="item.item_name">{{
						item.item_name
					}}</span>
					<v-chip v-if="item.is_bundle" color="secondary" size="x-small" class="ml-1">
						{{ __("Bundle") }}
					</v-chip>
					<v-chip v-if="item.name_overridden" color="primary" size="x-small" class="ml-1">
						{{ __("Edited") }}
					</v-chip>
					<v-chip
						v-if="item.batch_no_is_expired"
						color="error"
						size="x-small"
						variant="flat"
						class="ml-1"
					>
						{{ __("Expired") }}
					</v-chip>
					<v-chip
						v-if="item.has_batch_no && item.batch_no"
						color="info"
						size="x-small"
						variant="tonal"
						class="ml-1"
					>
						{{ __("Batch") }}: {{ item.batch_no }}
					</v-chip>
					<v-chip
						v-if="item.posa_is_offer || item.is_free_item"
						color="success"
						size="x-small"
						variant="flat"
						class="me-1"
					>
						{{ __("Offer Item") }}
					</v-chip>
					<v-tooltip v-if="item.pricing_rule_badge" location="bottom">
						<template #activator="{ props }">
							<v-chip v-bind="props" color="primary" size="x-small" class="ml-1">
								{{ item.pricing_rule_badge.label }}
							</v-chip>
						</template>
						<span>{{ item.pricing_rule_badge.tooltip }}</span>
					</v-tooltip>
					<v-btn
						v-if="posProfile.posa_allow_line_item_name_override && !item.posa_is_replace"
						icon
						size="x-small"
						variant="text"
						class="ml-1"
						@click.stop="$emit('open-name-dialog', item)"
						:aria-label="__('Edit item name')"
					>
						<v-icon size="small">mdi-pencil</v-icon>
					</v-btn>
					<v-btn
						v-if="item.name_overridden"
						icon
						size="x-small"
						variant="text"
						class="ml-1"
						@click.stop="$emit('reset-item-name', item)"
						:aria-label="__('Reset item name')"
					>
						<v-icon size="small">mdi-undo</v-icon>
					</v-btn>
				</div>
			</td>

			<!-- Quantity Column -->
			<td v-else-if="column.key === 'qty'" class="text-center" :data-column-key="'qty'">
				<div class="posa-cart-table__qty-counter" :class="{ 'rtl-layout': isRTL }">
					<v-btn
						:disabled="disableDecrement"
						size="small"
						variant="flat"
						class="posa-cart-table__qty-btn posa-cart-table__qty-btn--minus minus-btn qty-control-btn"
						@click.stop="handleMinusClick"
						:aria-label="__('Decrease quantity')"
					>
						<v-icon size="small">mdi-minus</v-icon>
					</v-btn>
					<div
						v-if="!isEditingQty"
						class="posa-cart-table__qty-display amount-value number-field-rtl"
						:class="{
							'negative-number': isNegative(item.qty),
							'large-number': qtyLength > 6,
						}"
						:data-length="qtyLength"
						:title="formatFloat(item.qty, hideQtyDecimals ? 0 : undefined)"
						@click.stop="openQtyEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-qty"
						role="button"
						:aria-label="__('Edit quantity')"
						@keydown.enter.prevent="openQtyEdit"
						@keydown.space.prevent="openQtyEdit"
					>
						{{ formatFloat(item.qty, hideQtyDecimals ? 0 : undefined) }}
					</div>
					<v-text-field
						v-else
						v-model="editingQtyValue"
						density="compact"
						variant="outlined"
						class="posa-cart-table__qty-input"
						@blur="closeQtyEdit"
						@keydown.enter.prevent="closeQtyEdit({ focusDiscountPercent: true })"
						@keydown.esc.prevent="cancelQtyEdit"
						@click.stop
						ref="qtyInput"
						:autofocus="true"
						type="number"
						inputmode="decimal"
						enterkeyhint="next"
						:disabled="disableInput"
					></v-text-field>
					<v-btn
						:disabled="disableIncrement"
						size="small"
						variant="flat"
						class="posa-cart-table__qty-btn posa-cart-table__qty-btn--plus plus-btn qty-control-btn"
						@click.stop="$emit('add-one', item)"
						:aria-label="__('Increase quantity')"
					>
						<v-icon size="small">mdi-plus</v-icon>
					</v-btn>
				</div>
			</td>

			<!-- UOM Column (Optional) -->
			<td v-else-if="column.key === 'uom'" class="text-center" :data-column-key="'uom'">
				<div class="posa-cart-table__editor-box uom-editor" @click.stop>
					<v-btn
						size="x-small"
						variant="flat"
						class="posa-cart-table__editor-btn uom-arrow"
						@click.stop="changeUom(-1)"
						:aria-label="__('Previous unit of measure')"
						:disabled="disableUomEdit || !item.item_uoms || item.item_uoms.length <= 1"
					>
						<v-icon size="small">mdi-chevron-left</v-icon>
					</v-btn>

					<div
						v-if="!isEditingUom"
						class="posa-cart-table__editor-display"
						@click.stop="openUomEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-uom"
						role="button"
						:aria-label="__('Edit unit of measure')"
					>
						<span>{{ item.uom }}</span>
					</div>

					<v-select
						v-else
						ref="uomSelect"
						:model-value="item.uom"
						@update:model-value="handleUomSelect"
						:items="item.item_uoms"
						item-title="uom"
						item-value="uom"
						density="compact"
						variant="outlined"
						class="posa-cart-table__editor-input uom-select"
						hide-details
						menu-icon=""
						:autofocus="true"
						:disabled="disableUomEdit"
						@blur="isEditingUom = false"
						@keydown.esc.prevent="isEditingUom = false"
					></v-select>

					<v-btn
						size="x-small"
						variant="flat"
						class="posa-cart-table__editor-btn uom-arrow"
						@click.stop="changeUom(1)"
						:aria-label="__('Next unit of measure')"
						:disabled="disableUomEdit || !item.item_uoms || item.item_uoms.length <= 1"
					>
						<v-icon size="small">mdi-chevron-right</v-icon>
					</v-btn>
				</div>
			</td>

			<!-- Price List Rate (Optional) -->
			<td
				v-else-if="column.key === 'price_list_rate'"
				class="text-end"
				:data-column-key="'price_list_rate'"
			>
				<div class="currency-display right-aligned" :title="priceListRateLabel">
					<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
					<span
						class="amount-value"
						:class="{ 'negative-number': isNegative(item.price_list_rate) }"
					>
						{{ formatCurrency(item.price_list_rate) }}
					</span>
				</div>
			</td>

			<!-- Discount % (Optional) -->
			<td
				v-else-if="column.key === 'discount_percentage'"
				class="text-center"
				:data-column-key="'discount_percentage'"
			>
				<div class="posa-cart-table__editor-box">
					<div
						v-if="!isEditingDiscountPercent"
						class="posa-cart-table__editor-display"
						@click.stop="openDiscountPercentEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-discount-percent"
						role="button"
						:aria-label="__('Edit discount percentage')"
						@keydown.enter.prevent="openDiscountPercentEdit"
						@keydown.space.prevent="openDiscountPercentEdit"
					>
						<span class="amount-value">
							{{
								formatFloat(
									Math.abs(
										item.discount_percentage ||
											(item.price_list_rate
												? (item.discount_amount / item.price_list_rate) * 100
												: 0),
									),
								)
							}}%
						</span>
					</div>
					<v-text-field
						v-else
						v-model="editingDiscountPercentValue"
						density="compact"
						variant="outlined"
						class="posa-cart-table__editor-input"
						@blur="closeDiscountPercentEdit"
						@keydown.enter.prevent="submitDiscountPercentEdit"
						@keydown.esc.prevent="cancelDiscountPercentEdit"
						@click.stop
						ref="discountPercentInput"
						:autofocus="true"
						type="number"
						inputmode="decimal"
						enterkeyhint="done"
						:disabled="disableDiscountEdit"
					></v-text-field>
				</div>
			</td>

			<!-- Discount Amount (Optional) -->
			<td
				v-else-if="column.key === 'discount_amount'"
				class="text-center"
				:data-column-key="'discount_amount'"
			>
				<div class="posa-cart-table__editor-box">
					<div
						v-if="!isEditingDiscountAmount"
						class="posa-cart-table__editor-display"
						@click.stop="openDiscountAmountEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-discount-amount"
						role="button"
						:aria-label="__('Edit discount amount')"
						@keydown.enter.prevent="openDiscountAmountEdit"
						@keydown.space.prevent="openDiscountAmountEdit"
					>
						<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
						<span class="amount-value">{{
							formatCurrency(Math.abs(item.discount_amount || 0))
						}}</span>
					</div>
					<v-text-field
						v-else
						v-model="editingDiscountAmountValue"
						density="compact"
						variant="outlined"
						class="posa-cart-table__editor-input"
						@blur="closeDiscountAmountEdit"
						@keydown.enter.prevent="closeDiscountAmountEdit"
						@keydown.esc.prevent="cancelDiscountAmountEdit"
						@click.stop
						ref="discountAmountInput"
						:autofocus="true"
						type="number"
						inputmode="decimal"
						enterkeyhint="done"
						:disabled="disableDiscountEdit"
					></v-text-field>
				</div>
			</td>

			<!-- Rate Column -->
			<td v-else-if="column.key === 'rate'" class="text-center" :data-column-key="'rate'">
				<div class="posa-cart-table__editor-box">
					<div
						v-if="!isEditingRate"
						class="posa-cart-table__editor-display"
						@click.stop="openRateEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-rate"
						role="button"
						:title="rateLabel"
						:aria-label="__('Edit rate')"
						@keydown.enter.prevent="openRateEdit"
						@keydown.space.prevent="openRateEdit"
					>
						<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
						<span class="amount-value" :class="{ 'negative-number': isNegative(item.rate) }">
							{{ formatCurrency(item.rate) }}
						</span>
					</div>
					<v-text-field
						v-else
						v-model="editingRateValue"
						density="compact"
						variant="outlined"
						class="posa-cart-table__editor-input"
						@blur="closeRateEdit"
						@keydown.enter.prevent="closeRateEdit"
						@keydown.esc.prevent="cancelRateEdit"
						@click.stop
						ref="rateInput"
						:autofocus="true"
						type="number"
						inputmode="decimal"
						enterkeyhint="done"
						:disabled="disableRateEdit"
					></v-text-field>
				</div>
			</td>

			<!-- Amount Column -->
			<td v-else-if="column.key === 'amount'" class="text-center" :data-column-key="'amount'">
				<div class="currency-display right-aligned" :title="amountLabel">
					<span class="currency-symbol">{{ currencySymbol(displayCurrency) }}</span>
					<span
						class="amount-value"
						:class="{ 'negative-number': isNegative(item.qty * item.rate) }"
					>
						{{ formatCurrency(item.qty * item.rate) }}
					</span>
				</div>
			</td>

			<!-- Offer Toggle (Optional) -->
			<td
				v-else-if="column.key === 'posa_is_offer'"
				class="text-center"
				:data-column-key="'posa_is_offer'"
			>
				<v-btn
					size="x-small"
					color="primary"
					variant="tonal"
					class="ma-0 pa-0"
					@click.stop="$emit('toggle-offer', item)"
				>
					{{ item.posa_offer_applied ? __("Remove Offer") : __("Apply Offer") }}
				</v-btn>
			</td>

			<!-- Actions -->
			<td v-else-if="column.key === 'actions'" class="text-center" :data-column-key="'actions'">
				<!-- Touch: first tap arms (turns red), second tap within 2.5s
				     deletes — a stray tap 4px from the row's tap-to-add area
				     must not silently drop a line. Mouse deletes in one click
				     as before. -->
				<v-btn
					:disabled="!!item.posa_is_replace"
					size="small"
					variant="flat"
					class="posa-cart-table__delete-btn delete-action-btn"
					:class="{ 'delete-action-btn--armed': deleteArmed }"
					@click.stop="handleDeleteClick"
					:aria-label="deleteArmed ? __('Tap again to remove') : __('Remove item')"
				>
					<v-icon size="small">{{ deleteArmed ? "mdi-delete-alert" : "mdi-delete-outline" }}</v-icon>
				</v-btn>
			</td>

			<td
				v-else-if="column.key === 'data-table-expand'"
				class="text-center"
				:data-column-key="'data-table-expand'"
			>
				<v-btn
					icon
					size="small"
					variant="text"
					class="posa-cart-table__expand-btn"
					@click.stop="$emit('toggle-expand')"
					:aria-label="isExpanded ? __('Collapse item details') : __('Expand item details')"
				>
					<v-icon size="small">
						{{ isExpanded ? "mdi-chevron-up" : "mdi-chevron-down" }}
					</v-icon>
				</v-btn>
			</td>
		</template>
	</tr>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { debugLog } from "../../../utils/debug";

defineOptions({
	name: "CartItemRow",
});

const props = defineProps({
	item: {
		type: Object,
		required: true,
	},
	visibleColumns: {
		type: Array,
		default: () => [],
	},
	posProfile: {
		type: Object,
		required: true,
	},
	isReturnInvoice: Boolean,
	invoiceType: String,
	displayCurrency: String,
	formatFloat: Function,
	formatCurrency: Function,
	currencySymbol: Function,
	isNumber: Function,
	isNegative: Function,
	hideQtyDecimals: Boolean,
	isRTL: Boolean,
	isExpanded: Boolean,
});

const emit = defineEmits([
	"open-name-dialog",
	"reset-item-name",
	"add-one",
	"update-qty",
	"minus-click",
	"calc-uom",
	"update-rate",
	"update-discount-percent",
	"update-discount-amount",
	"qty-edit-submitted",
	"discount-percent-edit-submitted",
	"toggle-offer",
	"toggle-expand",
	"remove-item",
]);

const __ = window.__ || ((text) => text);

const COARSE_POINTER =
	typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches === true;
const deleteArmed = ref(false);
let deleteArmTimer = null;
const handleDeleteClick = () => {
	if (!COARSE_POINTER) {
		emit("remove-item", props.item);
		return;
	}
	if (deleteArmed.value) {
		window.clearTimeout(deleteArmTimer);
		deleteArmed.value = false;
		emit("remove-item", props.item);
		return;
	}
	deleteArmed.value = true;
	deleteArmTimer = window.setTimeout(() => {
		deleteArmed.value = false;
	}, 2500);
};

const isEditingQty = ref(false);
const editingQtyValue = ref("");
const isEditingUom = ref(false);
const isEditingRate = ref(false);
const editingRateValue = ref("");
const isEditingDiscountPercent = ref(false);
const editingDiscountPercentValue = ref("");
const isEditingDiscountAmount = ref(false);
const editingDiscountAmountValue = ref("");

const qtyInput = ref(null);
const rateInput = ref(null);
const discountPercentInput = ref(null);
const discountAmountInput = ref(null);
const uomSelect = ref(null);

const memoDeps = computed(() => {
	const deps = [
		props.item.qty,
		props.item.rate,
		props.item.amount,
		props.item.discount_amount,
		props.item.discount_percentage,
		props.item.uom,
		props.item.item_name,
		props.item.name_overridden,
		props.item.pricing_rule_badge,
		props.item.batch_no_is_expired,
		props.item.batch_no,
		props.item.posa_is_offer,
		props.item.posa_offer_applied,
		props.item.is_free_item,
		props.item.price_list_rate,
		props.isExpanded,
		props.visibleColumns.map((column) => column?.key).join("|"),
		// Include edit states to ensure UI updates when switching modes
		isEditingQty.value,
		isEditingRate.value,
		isEditingUom.value,
		isEditingDiscountPercent.value,
		isEditingDiscountAmount.value,
		// v-memo would swallow the armed-delete repaint without this
		deleteArmed.value,
	];
	debugLog(`[CartItemRow] memoDeps updated for ${props.item.item_code}`, {
		uom: props.item.uom,
		rate: props.item.rate,
		price_list_rate: props.item.price_list_rate,
		qty: props.item.qty,
	});
	return deps;
});

const qtyLength = computed(() => String(Math.abs(props.item.qty || 0)).replace(".", "").length);

// Narrow cart panels truncate the money cells with an ellipsis rather
// than letting them paint over the next column, so every amount also
// carries its full value as a hover title.
const currencyLabel = (value) =>
	`${props.currencySymbol(props.displayCurrency)}${props.formatCurrency(value)}`;
const priceListRateLabel = computed(() => currencyLabel(props.item.price_list_rate));
const rateLabel = computed(() => currencyLabel(props.item.rate));
const amountLabel = computed(() => currencyLabel(props.item.qty * props.item.rate));

const disableDecrement = computed(
	() =>
		!!props.item.posa_is_replace ||
		(props.isReturnInvoice &&
			(props.item.is_free_item || props.item.posa_is_offer || props.item.posa_is_replace)),
);

const disableIncrement = computed(
	() =>
		!!props.item.posa_is_replace ||
		props.item.disable_increment ||
		(props.isReturnInvoice &&
			(props.item.is_free_item || props.item.posa_is_offer || props.item.posa_is_replace)),
);

const disableInput = computed(
	() =>
		props.isReturnInvoice &&
		(props.item.is_free_item || props.item.posa_is_offer || props.item.posa_is_replace),
);

const disableUomEdit = computed(() => !!props.item.posa_is_replace);

const disableRateEdit = computed(
	() => !props.posProfile.posa_allow_user_to_edit_rate || !!props.item.posa_is_replace,
);

const disableDiscountEdit = computed(
	() =>
		!props.posProfile.posa_allow_user_to_edit_item_discount ||
		!!props.item.posa_is_replace ||
		!!props.item.posa_offer_applied,
);

// These refs point at <v-text-field> COMPONENT instances, not DOM nodes.
// Vuetify 3 does not expose `.focus()` on the public instance, so a bare
// `ref.value?.focus()` threw "y.value?.focus is not a function" (the `?.`
// guards null, not wrong-type) — surfaced in prod telemetry as
// crash:unhandledrejection. Reach the inner <input> like openUomEdit does.
function focusInput(r) {
	const el = r?.value?.$el?.querySelector?.("input") || r?.value;
	el?.focus?.();
}

function openQtyEdit() {
	if (disableInput.value) return;
	isEditingQty.value = true;
	editingQtyValue.value = "";
	nextTick(() => {
		focusInput(qtyInput);
	});
}

function openUomEdit() {
	if (disableUomEdit.value) return;
	isEditingUom.value = true;
	nextTick(() => {
		const target = uomSelect.value?.$el?.querySelector?.("input") || uomSelect.value;
		target?.focus?.();
	});
}

function closeQtyEdit(options = {}) {
	if (isEditingQty.value) {
		let didUpdate = false;
		if (editingQtyValue.value !== "" && editingQtyValue.value != null) {
			const newQty = parseFloat(editingQtyValue.value);
			// Emit event to update parent state
			const val = !newQty || newQty <= 0 ? 1 : newQty;
			emit("update-qty", props.item, val);
			didUpdate = true;
		}
		isEditingQty.value = false;
		editingQtyValue.value = "";
		if (didUpdate && options?.focusDiscountPercent) {
			emit("qty-edit-submitted", props.item);
		}
	}
}

function cancelQtyEdit() {
	isEditingQty.value = false;
	editingQtyValue.value = "";
}

function handleMinusClick() {
	emit("minus-click", props.item);
}

function changeUom(direction) {
	if (disableUomEdit.value) return;
	const uoms = props.item.item_uoms.map((u) => u.uom);
	const currentIndex = uoms.indexOf(props.item.uom);
	let newIndex = currentIndex + direction;

	if (newIndex < 0) {
		newIndex = uoms.length - 1;
	} else if (newIndex >= uoms.length) {
		newIndex = 0;
	}

	const newUom = uoms[newIndex];
	if (newUom !== props.item.uom) {
		emit("calc-uom", props.item, newUom);
	}
}

function handleUomSelect(newUom) {
	if (disableUomEdit.value) return;
	if (newUom && newUom !== props.item.uom) {
		emit("calc-uom", props.item, newUom);
	}
	// Find the correct component instance to blur - ref is local now
	uomSelect.value?.blur();
}

function openRateEdit() {
	if (disableRateEdit.value) return;
	isEditingRate.value = true;
	editingRateValue.value = "";
	nextTick(() => {
		focusInput(rateInput);
	});
}

function closeRateEdit() {
	if (isEditingRate.value) {
		if (editingRateValue.value !== "" && editingRateValue.value != null) {
			const newRate = parseFloat(editingRateValue.value);
			if (Number.isFinite(newRate) && newRate !== props.item.rate) {
				// We need to pass the "event-like" object that useDiscounts expects or handle it in parent
				// For isolation, let's emit value and let parent handler construct event if needed
				// But ItemsTable methods expect (item, value, event)
				emit("update-rate", props.item, newRate);
			}
		}
		isEditingRate.value = false;
		editingRateValue.value = "";
	}
}

function cancelRateEdit() {
	isEditingRate.value = false;
	editingRateValue.value = "";
}

function openDiscountPercentEdit() {
	if (disableDiscountEdit.value) return;
	isEditingDiscountPercent.value = true;
	editingDiscountPercentValue.value = "";
	nextTick(() => {
		focusInput(discountPercentInput);
	});
}

function closeDiscountPercentEdit() {
	if (isEditingDiscountPercent.value) {
		if (editingDiscountPercentValue.value !== "" && editingDiscountPercentValue.value != null) {
			const newDiscount = parseFloat(editingDiscountPercentValue.value);
			if (Number.isFinite(newDiscount) && newDiscount !== props.item.discount_percentage) {
				emit("update-discount-percent", props.item, newDiscount);
			}
		}
		isEditingDiscountPercent.value = false;
		editingDiscountPercentValue.value = "";
	}
}

function submitDiscountPercentEdit() {
	closeDiscountPercentEdit();
	emit("discount-percent-edit-submitted", props.item);
}

function cancelDiscountPercentEdit() {
	isEditingDiscountPercent.value = false;
	editingDiscountPercentValue.value = "";
}

function openDiscountAmountEdit() {
	if (disableDiscountEdit.value) return;
	isEditingDiscountAmount.value = true;
	editingDiscountAmountValue.value = "";
	nextTick(() => {
		focusInput(discountAmountInput);
	});
}

function closeDiscountAmountEdit() {
	if (isEditingDiscountAmount.value) {
		if (editingDiscountAmountValue.value !== "" && editingDiscountAmountValue.value != null) {
			const newDiscount = parseFloat(editingDiscountAmountValue.value);
			if (Number.isFinite(newDiscount) && newDiscount !== props.item.discount_amount) {
				emit("update-discount-amount", props.item, newDiscount);
			}
		}
		isEditingDiscountAmount.value = false;
		editingDiscountAmountValue.value = "";
	}
}

function cancelDiscountAmountEdit() {
	isEditingDiscountAmount.value = false;
	editingDiscountAmountValue.value = "";
}
</script>

<style scoped>
/* Local styles specific to the row only */
.delete-action-btn--armed {
	background: rgb(var(--v-theme-error)) !important;
	color: #fff !important;
}

.currency-display {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	min-width: 0;
	height: 100%;
	padding: 0;
	margin: 0;
	overflow: hidden;
}

/* Name cell: the item name is the one field allowed to take two
   lines. Without a shrinkable span the flex row kept it at its full
   intrinsic width, so a narrow cart cut it mid-word with no ellipsis
   to say so. Chips and the edit buttons keep their intrinsic size. */
.posa-cart-item-row__name-cell {
	min-width: 0;
}

.posa-cart-item-row__name {
	min-width: 0;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	overflow-wrap: anywhere;
	line-height: 1.25;
	text-align: start;
}

.currency-display.right-aligned {
	justify-content: center;
}

.amount-value {
	font-weight: 500;
	text-align: left;
	font-family:
		"SF Pro Display", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans Arabic", "Tahoma",
		sans-serif;
	font-variant-numeric: lining-nums tabular-nums;
	font-feature-settings:
		"tnum" 1,
		"lnum" 1,
		"kern" 1;
}

.amount-value.right-aligned {
	text-align: center;
}

/* Money cells truncate rather than paint over the next column; the
   full amount stays on the cell's `title`. Scoped to
   .currency-display so it can't reach the qty display, which carries
   .amount-value too but must keep its own minimum width. */
.currency-display .amount-value {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.currency-symbol {
	opacity: 0.7;
	margin-right: 2px;
	font-size: 0.85em;
	flex: 0 0 auto;
}

.negative-number {
	color: var(--pos-error) !important;
	font-weight: 600;
}

/* Add minimal padding for table cells as per ItemsTable.vue styles.
   Side padding follows the container breakpoint (--cell-padding-x,
   set on .posa-responsive-table-container) so a phone-width cart
   spends its width on the fields instead of on gutters. */
td {
	padding: 12px var(--cell-padding-x, 10px);
	vertical-align: middle;
	height: 60px;
	text-align: center;
	color: var(--pos-text-primary);
	position: relative;
	overflow: hidden;
}

/* Keyboard focus styles */
/* Keyboard focus styles */
.posa-cart-table__qty-display:focus-visible,
.posa-cart-table__editor-display:focus-visible {
	outline: 2px solid var(--pos-primary);
	outline-offset: 2px;
	z-index: 10;
}
</style>
