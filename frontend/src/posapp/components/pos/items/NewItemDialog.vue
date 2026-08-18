<template>
	<v-dialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		max-width="640px"
		scrollable
	>
		<v-card>
			<v-card-title class="text-h6 pa-4">
				{{ __("Create New Item") }}
			</v-card-title>
			<v-card-text class="pa-4">
				<v-form ref="formRef" @submit.prevent="submit">
					<v-row dense>
						<!-- ── identity ─────────────────────────────────────── -->
						<v-col cols="12" sm="7">
							<v-text-field
								v-model="form.item_name"
								data-test="new-item-name"
								:label="frappe._('Item Name')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								autofocus
								:rules="[(v) => !!v || __('* Required')]"
							></v-text-field>
						</v-col>
						<v-col cols="12" sm="5">
							<v-text-field
								v-model="form.item_code"
								data-test="new-item-code"
								:label="frappe._('Item Code')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
								@input="codeTouched = true"
							></v-text-field>
						</v-col>
						<v-col cols="12">
							<v-textarea
								v-model="form.description"
								data-test="new-item-description"
								:label="frappe._('Description')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								rows="2"
								auto-grow
							></v-textarea>
						</v-col>
						<v-col cols="12">
							<div class="d-flex flex-wrap align-center ga-2">
								<v-text-field
									v-model="form.barcode"
									data-test="new-item-barcode"
									:label="frappe._('Barcode')"
									density="compact"
									variant="outlined"
									class="pos-themed-input flex-grow-1"
								></v-text-field>
								<v-btn
									v-if="cameraEnabled"
									data-test="new-item-camera-scan"
									color="secondary"
									variant="tonal"
									class="mb-4"
									@click="emit('request-camera-scan')"
								>
									{{ __("Scan with Camera") }}
								</v-btn>
							</div>
						</v-col>
						<v-col cols="12" sm="6">
							<v-select
								v-model="form.item_group"
								data-test="new-item-group"
								:items="itemsGroup.filter((g) => g !== 'ALL')"
								:label="frappe._('Item Group')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
							></v-select>
						</v-col>
						<v-col cols="12" sm="6">
							<v-autocomplete
								v-model="form.stock_uom"
								data-test="new-item-stock-uom"
								:items="uomList"
								:label="frappe._('Stock UOM')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
							></v-autocomplete>
						</v-col>

						<!-- ── money ────────────────────────────────────────── -->
						<v-col cols="12" class="pt-2">
							<div class="quick-item-section">{{ __("Price") }}</div>
						</v-col>
						<v-col cols="12" sm="4">
							<v-text-field
								v-model="form.valuation_rate"
								data-test="new-item-cost"
								:label="frappe._('Purchase Price')"
								type="number"
								inputmode="decimal"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								@update:model-value="onCostInput"
							></v-text-field>
						</v-col>
						<v-col cols="12" sm="4">
							<v-text-field
								v-model="form.margin_pct"
								data-test="new-item-margin"
								:label="frappe._('Margin % over cost')"
								type="number"
								inputmode="decimal"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:disabled="!hasCost"
								:hint="hasCost ? profitHint : __('Enter a purchase price first')"
								persistent-hint
								@update:model-value="onMarginInput"
							></v-text-field>
						</v-col>
						<v-col cols="12" sm="4">
							<v-text-field
								v-model="form.standard_rate"
								data-test="new-item-standard-rate"
								:label="frappe._('Selling Price')"
								type="number"
								inputmode="decimal"
								enterkeyhint="done"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								@update:model-value="onSellInput"
							></v-text-field>
						</v-col>
						<v-col cols="12" sm="6">
							<v-select
								v-model="form.item_tax_template"
								data-test="new-item-tax"
								:items="taxTemplates"
								:label="frappe._('Tax (IVA)')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								clearable
							></v-select>
						</v-col>

						<!-- ── opening stock ────────────────────────────────── -->
						<v-col cols="12" sm="6">
							<v-text-field
								v-model="form.opening_stock"
								data-test="new-item-opening-qty"
								:label="frappe._('Opening Quantity')"
								type="number"
								inputmode="decimal"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:disabled="!warehouse"
								:hint="openingHint"
								persistent-hint
							></v-text-field>
						</v-col>
						<v-col v-if="blockerMessages.length" cols="12">
							<v-alert
								type="warning"
								variant="tonal"
								density="compact"
								data-test="new-item-blockers"
							>
								<div v-for="msg in blockerMessages" :key="msg">{{ msg }}</div>
							</v-alert>
						</v-col>
					</v-row>
				</v-form>
			</v-card-text>
			<v-card-actions class="pa-4 pt-0">
				<v-spacer></v-spacer>
				<v-btn color="error" variant="text" @click="close">
					{{ __("Cancel") }}
				</v-btn>
				<v-btn
					data-test="new-item-submit"
					color="primary"
					variant="tonal"
					@click="submit"
					:loading="loading"
					:disabled="blockerMessages.length > 0"
				>
					{{ __("Create") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
/**
 * Quick item creation — "alta rápida de artículo" (roadmap §17.2).
 *
 * A shop adding stock at the counter needs cost, price, margin, quantity,
 * description and tax in ONE pass; before this it got six fields and then a
 * trip to Desk. The money arithmetic lives in itemPricing.ts and is unit
 * tested — cost/price/margin is what the shopkeeper actually checks, and a
 * rounding slip here becomes a mispriced shelf.
 */
import { computed, ref, reactive, watch, onMounted } from "vue";
import itemService from "../../../services/itemService";
import {
	buildQuickItemPayload,
	marginFromSell,
	profitAmount,
	quickItemBlockers,
	sellFromMargin,
} from "./itemPricing";

const props = defineProps({
	modelValue: {
		type: Boolean,
		default: false,
	},
	itemsGroup: {
		type: Array,
		default: () => [],
	},
	cameraEnabled: {
		type: Boolean,
		default: false,
	},
	scannedBarcode: {
		type: String,
		default: "",
	},
	// The register's context, supplied by the parent exactly like its
	// siblings receive it. A prop rather than a store read keeps this dialog
	// mountable on its own — and the opening-stock warehouse is the register's
	// business, not a global.
	posProfile: {
		type: Object,
		default: null,
	},
});

const emit = defineEmits(["update:modelValue", "item-created", "request-camera-scan"]);

const loading = ref(false);
const formRef = ref(null);
const uomList = ref([]);
const taxTemplates = ref([]);
/** Once the operator edits the code we stop deriving it from the name. */
const codeTouched = ref(false);

const company = computed(() => props.posProfile?.company || null);
const warehouse = computed(() => props.posProfile?.warehouse || null);

const form = reactive({
	item_code: "",
	item_name: "",
	description: "",
	barcode: "",
	item_group: "",
	stock_uom: "Nos",
	valuation_rate: "",
	margin_pct: "",
	standard_rate: 0,
	item_tax_template: "",
	opening_stock: "",
});

const hasCost = computed(() => parseFloat(form.valuation_rate) > 0);

const profitHint = computed(() => {
	const profit = profitAmount(form.valuation_rate, form.standard_rate);
	return `${__("Profit")}: ${profit.toFixed(2)}`;
});

const openingHint = computed(() =>
	warehouse.value
		? `${__("Posts opening stock to")} ${warehouse.value}`
		: __("This register has no warehouse — opening stock is unavailable"),
);

const BLOCKER_TEXT = {
	opening_needs_cost: () =>
		__("Opening quantity needs a purchase price — ERPNext values the stock with it."),
	opening_needs_warehouse: () =>
		__("Opening quantity needs a warehouse on this POS Profile."),
	opening_negative: () => __("Opening quantity cannot be negative."),
};

/** Only the blockers worth SHOWING: empty required fields are already marked
 * inline by the form rules, and repeating them as an alert is noise. */
const blockerMessages = computed(() =>
	quickItemBlockers(form, { warehouse: warehouse.value })
		.filter((key) => BLOCKER_TEXT[key])
		.map((key) => BLOCKER_TEXT[key]()),
);

// --- price/margin coupling -------------------------------------------------
// Only ever write the field the operator is NOT typing in. Recomputing the
// edited field would make a typed "22" jump to "22.01" once the price rounds
// to a cent (see itemPricing.spec.ts).
const onCostInput = () => {
	if (String(form.margin_pct) !== "") {
		const sell = sellFromMargin(form.valuation_rate, form.margin_pct);
		if (sell !== null) form.standard_rate = sell;
		return;
	}
	const margin = marginFromSell(form.valuation_rate, form.standard_rate);
	form.margin_pct = margin === null ? "" : margin;
};

const onMarginInput = () => {
	const sell = sellFromMargin(form.valuation_rate, form.margin_pct);
	if (sell !== null) form.standard_rate = sell;
};

const onSellInput = () => {
	const margin = marginFromSell(form.valuation_rate, form.standard_rate);
	form.margin_pct = margin === null ? "" : margin;
};

// Derive a code from the name until the operator takes over: one less field
// to think about when a queue is forming, and still fully editable.
watch(
	() => form.item_name,
	(name) => {
		if (codeTouched.value) return;
		form.item_code = String(name || "")
			.trim()
			.toUpperCase()
			.replace(/\s+/g, "-")
			.replace(/[^A-Z0-9\-.]/g, "")
			.slice(0, 40);
	},
);

const resetForm = () => {
	form.item_code = "";
	form.item_name = "";
	form.description = "";
	form.barcode = (props.scannedBarcode || "").trim();
	// Auto-select a sensible item group
	form.item_group =
		props.itemsGroup.length > 1 && props.itemsGroup[1] !== "ALL"
			? props.itemsGroup[1]
			: props.itemsGroup[0] !== "ALL"
				? props.itemsGroup[0]
				: "";
	form.stock_uom = "Nos";
	form.valuation_rate = "";
	form.margin_pct = "";
	form.standard_rate = 0;
	form.item_tax_template = "";
	form.opening_stock = "";
	codeTouched.value = false;
};

watch(
	() => props.modelValue,
	(val) => {
		if (val) {
			resetForm();
			loadTaxTemplates();
		}
	},
);

watch(
	() => props.scannedBarcode,
	(barcode) => {
		const normalizedBarcode = (barcode || "").trim();
		if (normalizedBarcode) {
			form.barcode = normalizedBarcode;
		}
	},
);

const getUOMs = async () => {
	if (uomList.value.length) return;
	try {
		const r = await itemService.getUOMsData();
		if (r) {
			uomList.value = r.map((d) => d.name);
		}
	} catch (e) {
		console.error("Failed to fetch UOMs", e);
		// Fallback
		uomList.value = ["Nos", "Kg", "Meter", "Box"];
	}
};

const loadTaxTemplates = async () => {
	if (taxTemplates.value.length) return;
	try {
		const rows = await itemService.getItemTaxTemplatesData(company.value);
		taxTemplates.value = (rows || []).map((d) => d.name);
	} catch (e) {
		// A missing tax list must not block creating an item — the field is
		// optional and the item can be taxed later.
		console.warn("Failed to fetch item tax templates", e);
		taxTemplates.value = [];
	}
};

const close = () => {
	emit("update:modelValue", false);
};

const submit = async () => {
	if (!formRef.value) return;

	const { valid } = await formRef.value.validate();
	if (!valid) {
		frappe.msgprint(__("Please fill all required fields"));
		return;
	}
	if (blockerMessages.value.length) {
		frappe.msgprint(blockerMessages.value.join("<br>"));
		return;
	}

	loading.value = true;
	try {
		const res = await itemService.createItemData(
			buildQuickItemPayload(form, {
				company: company.value,
				warehouse: warehouse.value,
			}),
		);

		const newItem = res.message || res;
		// Opening stock posts a real entry; anything else starts at zero.
		newItem.actual_qty = parseFloat(form.opening_stock) > 0 ? parseFloat(form.opening_stock) : 0;

		frappe.show_alert({
			message: __("Item created successfully"),
			indicator: "green",
		});

		emit("item-created", newItem);
		close();
	} catch (e) {
		console.error(e);
		frappe.msgprint(__("Failed to create item"));
	} finally {
		loading.value = false;
	}
};

onMounted(() => {
	getUOMs();
});
</script>

<style scoped>
.quick-item-section {
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.65;
}
</style>
