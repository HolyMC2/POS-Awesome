<template>
	<v-dialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		max-width="640px"
		scrollable
	>
		<v-card>
			<v-card-title class="text-h6 pa-4">
				{{ catalogMode ? __("Register product") : __("Create New Item") }}
			</v-card-title>
			<v-card-text class="pa-4">
				<p v-if="catalogHint" class="text-body-2 mb-3" data-test="new-item-catalog-hint">
					{{ catalogHint }}
				</p>
				<v-form ref="formRef" @submit.prevent="submit">
					<v-row dense>
						<!-- ── identity ─────────────────────────────────────── -->
						<v-col cols="12" :sm="catalogMode ? 12 : 7">
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
						<v-col v-if="!catalogMode" cols="12" sm="5">
							<v-text-field
								v-model="form.item_code"
								data-test="new-item-code"
								:label="frappe._('Item Code')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
								@update:model-value="codeTouched = true"
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
									:readonly="catalogMode"
									density="compact"
									variant="outlined"
									class="pos-themed-input flex-grow-1"
								></v-text-field>
								<v-btn
									v-if="cameraEnabled && !catalogMode"
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
								:items="groupOptions"
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
								:items="uomOptions"
								:label="frappe._('Stock UOM')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
							></v-autocomplete>
						</v-col>
						<template v-if="catalogMode">
							<v-col cols="12" sm="6">
								<v-text-field
									v-model="form.brand"
									data-test="new-item-brand"
									:label="__('Brand')"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
							</v-col>
							<v-col v-if="satSuggestions.length" cols="12" sm="6">
								<v-text-field
									v-model="form.mx_product_service_key"
									data-test="new-item-sat-key"
									:label="__('SAT product key')"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
							</v-col>
							<v-col v-if="satSuggestions.length" cols="12">
								<div class="d-flex flex-wrap ga-2 mt-n2 mb-2">
									<v-chip
										v-for="suggestion in satSuggestions"
										:key="suggestion.key"
										data-test="new-item-sat-suggestion"
										size="small"
										:color="form.mx_product_service_key === suggestion.key ? 'primary' : undefined"
										:title="suggestion.description || suggestion.key"
										@click="form.mx_product_service_key = suggestion.key"
									>
										{{ suggestion.key }}{{ suggestion.description ? ` · ${suggestion.description}` : "" }}
									</v-chip>
								</div>
							</v-col>
						</template>

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
import catalogScanService from "../../../services/catalogScanService";
import { unwrapApiResult } from "../../../services/api";
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
	// doco scan-to-catalog payload (prefill_for_barcode). When present the
	// dialog creates through doco's single creation path instead of
	// frappe.client.insert.
	prefill: {
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
	brand: "",
	mx_product_service_key: "",
});

const catalogMode = computed(() => Boolean(props.prefill && props.prefill.barcode));

const satSuggestions = computed(() => {
	const list = props.prefill?.suggested_sat_keys;
	return Array.isArray(list) ? list.filter((s) => s && s.key) : [];
});

const catalogHint = computed(() => {
	if (!catalogMode.value) return "";
	const source = props.prefill.found_in;
	if (source === "central" || source === "reference") {
		return __("Unregistered code. Details suggested by the catalog; review them before saving.");
	}
	return __("Unregistered code. Fill in the details to register it.");
});

const groupOptions = computed(() => {
	const groups = props.itemsGroup.filter((g) => g !== "ALL");
	const suggested = props.prefill?.item_group;
	if (catalogMode.value && suggested && !groups.includes(suggested)) {
		groups.push(suggested);
	}
	return groups;
});

const uomOptions = computed(() => {
	const current = form.stock_uom;
	if (current && !uomList.value.includes(current)) {
		return [...uomList.value, current];
	}
	return uomList.value;
});

const catalogItemName = (prefill) => {
	const name = String(prefill.product_name || "").trim();
	const size = String(prefill.size || "").trim();
	if (name && size && !name.toLowerCase().includes(size.toLowerCase())) {
		return `${name} ${size}`;
	}
	return name;
};

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
	form.brand = "";
	form.mx_product_service_key = "";
	codeTouched.value = false;
	if (catalogMode.value) {
		const prefill = props.prefill;
		form.barcode = String(prefill.barcode).trim();
		form.item_name = catalogItemName(prefill);
		// doco keys the Item by the barcode; the code field is hidden.
		form.item_code = form.barcode;
		codeTouched.value = true;
		form.item_group = prefill.item_group || form.item_group;
		form.stock_uom = prefill.stock_uom || form.stock_uom;
		form.brand = prefill.brand || "";
		form.mx_product_service_key = satSuggestions.value[0]?.key || "";
	}
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
	() => props.prefill,
	() => {
		if (props.modelValue) resetForm();
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
	if (catalogMode.value) {
		await submitCatalogItem();
		return;
	}
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

const toNumberOrNull = (value) => {
	if (value === "" || value === null || value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const submitCatalogItem = async () => {
	const openingQty = toNumberOrNull(form.opening_stock);
	const hasOpening = openingQty !== null && openingQty > 0;
	try {
		const envelope = await catalogScanService.createItemFromScan({
			barcode: form.barcode,
			item_name: form.item_name,
			item_group: form.item_group,
			stock_uom: form.stock_uom,
			brand: form.brand || null,
			selling_price: toNumberOrNull(form.standard_rate) || null,
			buying_price: toNumberOrNull(form.valuation_rate),
			item_tax_template: form.item_tax_template || null,
			mx_product_service_key: form.mx_product_service_key || null,
			opening_qty: hasOpening ? openingQty : null,
			warehouse: hasOpening ? warehouse.value : null,
			company: company.value,
		});
		const result = unwrapApiResult(envelope);

		frappe.show_alert({
			message: result.created ? __("Product registered") : __("The product was already registered"),
			indicator: "green",
		});

		emit("item-created", {
			...result,
			barcode: form.barcode,
			actual_qty: hasOpening ? openingQty : 0,
			_from_scan: true,
		});
		close();
	} catch (e) {
		console.error(e);
		const detail = e && e.message ? e.message : "";
		frappe.msgprint(
			detail
				? `${__("Could not register the product")}: ${detail}`
				: __("Could not register the product"),
		);
	} finally {
		loading.value = false;
	}
};

onMounted(() => {
	getUOMs();
	// The parent mounts this dialog with v-if, so it is usually born open and
	// the modelValue watcher never fires for the first open.
	if (props.modelValue) {
		resetForm();
		loadTaxTemplates();
	}
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
