<template>
	<tr class="posa-cart-item-row" v-memo="memoDeps">
		<template v-for="column in visibleColumns" :key="column.key">
			<!--
				EVERY cell below takes its alignment from `cartAlignClass(column)`
				and nothing else. A literal `class="text-end"` here is what let
				`Stock` point right while its header pointed at the middle, and
				what let `discount_amount` render centred while the column that
				declared it said `end`. See `cartColumnAlign.ts`.
			-->
			<!-- Item Name Column -->
			<td v-if="column.key === 'item_name'" :class="cartAlignClass(column)" :data-column-key="'item_name'">
				<div class="d-flex align-center posa-cart-item-row__name-cell">
					<span class="posa-cart-item-row__name" :title="item.item_name">{{
						item.item_name
					}}</span>
					<v-chip v-if="item.is_bundle" size="x-small" variant="tonal" class="ml-1">
						{{ __("Bundle") }}
					</v-chip>
					<v-chip v-if="item.name_overridden" size="x-small" variant="tonal" class="ml-1">
						{{ __("Edited") }}
					</v-chip>
					<v-chip
						v-if="item.batch_no_is_expired"
						color="error"
						size="x-small"
						variant="tonal"
						class="ml-1"
					>
						{{ __("Expired") }}
					</v-chip>
					<v-chip
						v-if="item.has_batch_no && item.batch_no"
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
						variant="tonal"
						class="me-1"
					>
						{{ __("Offer Item") }}
					</v-chip>
					<v-tooltip v-if="item.pricing_rule_badge" location="bottom">
						<template #activator="{ props }">
							<v-chip v-bind="props" size="x-small" variant="tonal" class="ml-1">
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
				<!-- `IPN001545 · Accesorios` — how an operator confirms they
				     scanned the RIGHT variant. This shop sells near-identical
				     cases differing only by model and colour, so the name alone
				     cannot settle it. Rendered only when there is something to
				     say; never a fabricated category. -->
				<div
					v-if="lineIdentity"
					class="posa-cart-item-row__identity"
					data-testid="cart-line-identity"
				>
					{{ lineIdentity }}
				</div>
			</td>

			<!-- Quantity Column -->
			<td v-else-if="column.key === 'qty'" :class="cartAlignClass(column)" :data-column-key="'qty'">
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
							'posa-cart-item-row__qty--weighable': offersFractionalPad,
						}"
						:data-length="qtyLength"
						:data-weighable="offersFractionalPad ? 'true' : undefined"
						:title="formatFloat(item.qty, hideQtyDecimals ? 0 : undefined)"
						@click.stop="openQtyEdit"
						tabindex="0"
						data-pos-keyboard-target="cart-qty"
						role="button"
						:aria-label="offersFractionalPad ? __('Weigh or set amount') : __('Edit quantity')"
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

			<!-- Existencia. Absence renders NOTHING, never 0 — see
			     cartLineStock.ts. A 0 is a claim the cashier will repeat to a
			     customer; not knowing is not the same as having none. -->
			<td
				v-else-if="column.key === 'stock'"
				:class="cartAlignClass(column)"
				:data-column-key="'stock'"
				:data-stock-reason="lineStock.reason"
			>
				<span
					v-if="lineStock.show"
					class="posa-cart-item-row__stock"
					:class="{ 'posa-cart-item-row__stock--low': lineStock.isLow }"
					data-testid="cart-line-stock"
				>
					{{ __("remaining {0}", [formatFloat(lineStock.value, hideQtyDecimals ? 0 : undefined)]) }}
				</span>
			</td>

			<!-- UOM Column (Optional) -->
			<td v-else-if="column.key === 'uom'" :class="cartAlignClass(column)" :data-column-key="'uom'">
				<div class="posa-cart-table__editor-box uom-editor" :class="cartJustifyClass(column)" @click.stop>
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
				:class="cartAlignClass(column)"
				:data-column-key="'price_list_rate'"
			>
				<div class="currency-display" :class="cartJustifyClass(column)" :title="priceListRateLabel">
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
				:class="cartAlignClass(column)"
				:data-column-key="'discount_percentage'"
			>
				<div class="posa-cart-table__editor-box" :class="cartJustifyClass(column)">
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
				:class="cartAlignClass(column)"
				:data-column-key="'discount_amount'"
			>
				<div class="posa-cart-table__editor-box" :class="cartJustifyClass(column)">
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
			<td v-else-if="column.key === 'rate'" :class="cartAlignClass(column)" :data-column-key="'rate'">
				<div class="posa-cart-table__editor-box" :class="cartJustifyClass(column)">
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
			<td v-else-if="column.key === 'amount'" :class="cartAlignClass(column)" :data-column-key="'amount'">
				<div class="currency-display" :class="cartJustifyClass(column)" :title="amountLabel">
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
				:class="cartAlignClass(column)"
				:data-column-key="'posa_is_offer'"
			>
				<v-btn
					size="x-small"
					variant="tonal"
					class="ma-0 pa-0"
					@click.stop="$emit('toggle-offer', item)"
				>
					{{ item.posa_offer_applied ? __("Remove Offer") : __("Apply Offer") }}
				</v-btn>
			</td>

			<!-- Actions -->
			<td v-else-if="column.key === 'actions'" :class="cartAlignClass(column)" :data-column-key="'actions'">
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
				:class="cartAlignClass(column)"
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
		<FractionalQtyPad
			v-if="offersFractionalPad"
			v-model="fractionalPadOpen"
			:item="item"
			:uom-facts="uomFacts"
			:display-currency="displayCurrency"
			:currency-precision="registerPrecision"
			:format-float="formatFloat"
			:format-currency="formatCurrency"
			:currency-symbol="currencySymbol"
			@confirm="applyFractionalQty"
		/>
	</tr>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { debugLog } from "../../../utils/debug";
import { describeLineStock, describeLineIdentity } from "./cartLineStock";
import { cartAlignClass, cartJustifyClass } from "./cartColumnAlign";
import FractionalQtyPad from "./FractionalQtyPad.vue";
import { isFractionEligible } from "../../../utils/fractionalMath";
import { useVerticalStore } from "../../../stores/verticalStore";

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
	"update-line-note",
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

const verticalStore = useVerticalStore();

const isEditingQty = ref(false);
const fractionalPadOpen = ref(false);
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
		// Key AND align: the row is `v-memo`'d, and now that the cell classes
		// are computed from `column.align` a re-aligned column that kept its
		// key would leave the whole row pinned to the old side.
		props.visibleColumns.map((column) => `${column?.key}:${column?.align}`).join("|"),
		// Include edit states to ensure UI updates when switching modes
		isEditingQty.value,
		isEditingRate.value,
		isEditingUom.value,
		isEditingDiscountPercent.value,
		isEditingDiscountAmount.value,
		// v-memo would swallow the armed-delete repaint without this
		deleteArmed.value,
		// Stock and identity are rendered cells, so they must be dependencies
		// or v-memo pins a stale `quedan` on a line whose UOM just changed —
		// the figure is divided by conversion_factor, so a box/single switch
		// moves it without touching qty or rate.
		props.item.actual_qty,
		props.item._base_actual_qty,
		props.item.conversion_factor,
		props.item.item_code,
		props.item.item_group,
		// The pad's open state, for the same reason as deleteArmed: it
		// teleports to the body, but the flag that opens it lives in this
		// row's scope. `must_be_whole_number` rides along because a UOM change
		// flips whether the row offers a pad at all.
		fractionalPadOpen.value,
		props.item.must_be_whole_number,
	];
	debugLog(`[CartItemRow] memoDeps updated for ${props.item.item_code}`, {
		uom: props.item.uom,
		rate: props.item.rate,
		price_list_rate: props.item.price_list_rate,
		qty: props.item.qty,
	});
	return deps;
});

/**
 * `quedan N` for this line, and the `IPN… · Grupo` subtitle beneath its name.
 *
 * Both derive from data the line already carries — `useItemAddition` puts
 * `actual_qty` / `_base_actual_qty` on every added item and clamps against the
 * same figure. Nothing here fetches: a per-line request would be N round trips
 * on the hottest path in the product.
 */
const lineStock = computed(() =>
	describeLineStock(props.item, {
		lowStockThreshold: props.posProfile?.posa_low_stock_alert_threshold,
	}),
);

const lineIdentity = computed(() => describeLineIdentity(props.item));

/**
 * Does this line get the weighing affordances?
 *
 * Two independent gates, and both must hold. The REGISTER has to be one that
 * weighs (`fractional`) — a phone shop never grows a grams pad, whatever its
 * catalogue happens to contain. And the LINE's own UOM has to accept decimals,
 * which is ERPNext's answer (`UOM.must_be_whole_number`), not ours: the server
 * refuses a fractional piece at save, so an affordance that disagreed would
 * only build carts the shop cannot invoice.
 *
 * The fact arrives on the item payload — `must_be_whole_number`, added to the
 * items wire for exactly this. When it is ABSENT (an offline row cached before
 * the field shipped, a draft resumed from an older build) `isFractionEligible`
 * answers no, and the row keeps the plain qty field it has always had.
 */
const registerPrecision = computed(() => {
	const declared = Number.parseInt(String(props.posProfile?.posa_decimal_precision ?? ""), 10);
	return Number.isInteger(declared) && declared >= 0 ? declared : 2;
});

const uomFacts = computed(() => ({
	uom: props.item.uom || props.item.stock_uom,
	mustBeWholeNumber: props.item.must_be_whole_number,
	precision: registerPrecision.value,
}));

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

// Declared after `disableInput` on purpose: a returned free line already has no
// editable qty, and it must not gain one by weighing.
const offersFractionalPad = computed(
	() => verticalStore.has("fractional") && isFractionEligible(uomFacts.value) && !disableInput.value,
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
	// A weighable line opens the pad; everything else keeps the inline number
	// field it has always had, down to the focus behaviour.
	if (offersFractionalPad.value) {
		fractionalPadOpen.value = true;
		return;
	}
	isEditingQty.value = true;
	editingQtyValue.value = "";
	nextTick(() => {
		focusInput(qtyInput);
	});
}

/**
 * The pad resolved a weight or an amount into a quantity; the line takes it the
 * same way it takes a typed one. `update-qty` is the SAME event the inline
 * field emits — no second write path for weighed lines, so every clamp,
 * pricing pass and stock check downstream sees one kind of quantity change.
 */
function applyFractionalQty(payload) {
	const qty = Number(payload?.qty);
	if (!Number.isFinite(qty) || qty <= 0) return;
	emit("update-qty", props.item, qty);
	const note = String(payload?.note || "").trim();
	if (note && !String(props.item.posa_notes || "").trim()) {
		emit("update-line-note", props.item, note);
	}
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
/* The line's identity subtitle and its stock figure.
 *
 * Both resolve through `--pos-*` rather than literal hex, so they follow the
 * theme. The combo line still carries literals here (`#667085`, `#8a5a0d`) —
 * it predates the dark-mode sweep and is not this file's to change, but the
 * values below are the same colours by their token names, so the two rows read
 * identically in light and, unlike the combo, stay legible in dark. */
.posa-cart-item-row__identity {
	font-size: 11.5px;
	line-height: 1.25;
	color: var(--pos-text-muted, #667085);
	margin-top: 1px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* A weighable line's quantity opens a pad, not a text box, so it is drawn as
   something you press: a dotted underline, the one hint that fits inside a cell
   already carrying two buttons and a figure. Deliberately not a colour — amber
   is state and the single saturated accent belongs to the primary button. */
.posa-cart-item-row__qty--weighable {
	text-decoration: underline dotted;
	text-underline-offset: 3px;
	cursor: pointer;
}

.posa-cart-item-row__stock {
	font-size: 12.5px;
	color: var(--pos-text-muted, #667085);
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}

/* Amber is STATE, and this is a tint on text — never a fill. §17.7's second
   invariant spends the one saturated accent on the primary button. */
.posa-cart-item-row__stock--low {
	color: var(--pos-button-warning-text, #e65100);
	font-weight: 600;
}

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

/*
 * WHERE A FLEX CELL POINTS — the column's answer, not the cell's.
 *
 * `text-align` does not move a flex child, so the money cells and the inline
 * editors need this as well as the `text-…` class on the `<td>`. What stood
 * here was `.currency-display.right-aligned { justify-content: center }`: a
 * class NAMED right-aligned that centred, which is why `price_list_rate`
 * carried `text-end` on its cell and still drew its figure in the middle.
 *
 * Specificity: scoped compiles these to `(0,2,0)`, which beats the global
 * `.posa-cart-table__editor-box` `(0,1,0)` in `items-table-styles.css` (a file
 * this task does not own) and ties with `.currency-display` above — so they
 * must stay BELOW it in source order.
 */
.posa-cart-cell--start {
	justify-content: flex-start;
}

.posa-cart-cell--center {
	justify-content: center;
}

.posa-cart-cell--end {
	justify-content: flex-end;
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
