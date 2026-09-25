<template>
	<v-dialog
		:model-value="modelValue"
		@update:model-value="$emit('update:modelValue', $event)"
		max-width="500px"
	>
		<v-card>
			<v-card-title class="text-h6 pa-4">
				{{ catalogMode ? __("Dar de alta producto") : __("Create New Item") }}
			</v-card-title>
			<v-card-text class="pa-4">
				<p v-if="catalogHint" class="text-body-2 mb-3" data-test="new-item-catalog-hint">
					{{ catalogHint }}
				</p>
				<v-form ref="formRef" @submit.prevent="submit">
					<v-row dense>
						<v-col v-if="!catalogMode" cols="12">
							<v-text-field
								v-model="form.item_code"
								data-test="new-item-code"
								:label="frappe._('Item Code')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
							></v-text-field>
						</v-col>
						<v-col cols="12">
							<v-text-field
								v-model="form.item_name"
								data-test="new-item-name"
								:label="frappe._('Item Name')"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
								:rules="[(v) => !!v || __('* Required')]"
							></v-text-field>
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
						<v-col cols="12">
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
						<v-col cols="6">
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
						<v-col cols="6">
							<v-text-field
								v-model="form.standard_rate"
								data-test="new-item-standard-rate"
								:label="frappe._('Standard Rate')"
								type="number"
								density="compact"
								variant="outlined"
								class="pos-themed-input"
							></v-text-field>
						</v-col>
						<template v-if="catalogMode">
							<v-col cols="6">
								<v-text-field
									v-model="form.brand"
									data-test="new-item-brand"
									:label="__('Marca')"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
							</v-col>
							<v-col cols="6">
								<v-text-field
									v-model="form.buying_price"
									data-test="new-item-buying-price"
									:label="__('Costo')"
									type="number"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
							</v-col>
							<v-col v-if="satSuggestions.length" cols="12">
								<v-text-field
									v-model="form.mx_product_service_key"
									data-test="new-item-sat-key"
									:label="__('Clave SAT')"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
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
							<v-col v-if="allowOpeningStock" cols="12">
								<v-text-field
									v-model="form.opening_qty"
									data-test="new-item-opening-qty"
									:label="__('Existencia inicial')"
									:hint="openingWarehouse || ''"
									persistent-hint
									type="number"
									min="0"
									density="compact"
									variant="outlined"
									class="pos-themed-input"
								></v-text-field>
							</v-col>
						</template>
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
				>
					{{ __("Create") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { ref, reactive, watch, onMounted, computed } from "vue";
import itemService from "../../../services/itemService";
import catalogScanService from "../../../services/catalogScanService";
import { unwrapApiResult } from "../../../services/api";

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
	// doco scan-to-catalog payload (prefill_for_barcode). When present the
	// dialog creates through doco's single creation path instead of
	// frappe.client.insert.
	prefill: {
		type: Object,
		default: null,
	},
	allowOpeningStock: {
		type: Boolean,
		default: false,
	},
	openingWarehouse: {
		type: String,
		default: "",
	},
	company: {
		type: String,
		default: "",
	},
});

const emit = defineEmits(["update:modelValue", "item-created", "request-camera-scan"]);

const loading = ref(false);
const formRef = ref(null);
const uomList = ref([]);

const form = reactive({
	item_code: "",
	item_name: "",
	barcode: "",
	item_group: "",
	stock_uom: "Nos",
	standard_rate: 0,
	brand: "",
	buying_price: "",
	mx_product_service_key: "",
	opening_qty: "",
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
		return __("Código no registrado. Datos sugeridos del catálogo; revísalos antes de guardar.");
	}
	return __("Código no registrado. Captura los datos para darlo de alta.");
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

const defaultGroup = () =>
	props.itemsGroup.length > 1 && props.itemsGroup[1] !== "ALL"
		? props.itemsGroup[1]
		: props.itemsGroup[0] !== "ALL"
			? props.itemsGroup[0]
			: "";

const catalogItemName = (prefill) => {
	const name = String(prefill.product_name || "").trim();
	const size = String(prefill.size || "").trim();
	if (name && size && !name.toLowerCase().includes(size.toLowerCase())) {
		return `${name} ${size}`;
	}
	return name;
};

const resetForm = () => {
	form.item_code = "";
	form.item_name = "";
	form.barcode = (props.scannedBarcode || "").trim();
	// Auto-select a sensible item group
	form.item_group = defaultGroup();
	form.stock_uom = "Nos";
	form.standard_rate = 0;
	form.brand = "";
	form.buying_price = "";
	form.mx_product_service_key = "";
	form.opening_qty = "";
	if (catalogMode.value) {
		const prefill = props.prefill;
		form.barcode = String(prefill.barcode).trim();
		form.item_name = catalogItemName(prefill);
		form.item_group = prefill.item_group || form.item_group;
		form.stock_uom = prefill.stock_uom || form.stock_uom;
		form.brand = prefill.brand || "";
		form.mx_product_service_key = satSuggestions.value[0]?.key || "";
	}
};

// The parent mounts this dialog with v-if, so it is usually born open:
// reset on mount as well as on every reopen.
watch(
	() => props.modelValue,
	(val) => {
		if (val) {
			resetForm();
		}
	},
	{ immediate: true },
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

	loading.value = true;
	if (catalogMode.value) {
		await submitCatalogItem();
		return;
	}
	try {
		const res = await itemService.createItemData({
			item_code: form.item_code,
			item_name: form.item_name,
			barcode: form.barcode,
			item_group: form.item_group,
			stock_uom: form.stock_uom,
			standard_rate: form.standard_rate,
		});

		const newItem = res.message || res;
		newItem.actual_qty = 0; // Initialize stock

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
	const openingQty = props.allowOpeningStock ? toNumberOrNull(form.opening_qty) : null;
	try {
		const envelope = await catalogScanService.createItemFromScan({
			barcode: form.barcode,
			item_name: form.item_name,
			item_group: form.item_group,
			stock_uom: form.stock_uom,
			brand: form.brand || null,
			selling_price: toNumberOrNull(form.standard_rate) || null,
			buying_price: toNumberOrNull(form.buying_price),
			mx_product_service_key: form.mx_product_service_key || null,
			opening_qty: openingQty && openingQty > 0 ? openingQty : null,
			warehouse: openingQty && openingQty > 0 ? props.openingWarehouse || null : null,
			company: props.company || null,
		});
		const result = unwrapApiResult(envelope);

		frappe.show_alert({
			message: result.created ? __("Producto dado de alta") : __("El producto ya estaba dado de alta"),
			indicator: "green",
		});

		emit("item-created", {
			...result,
			barcode: form.barcode,
			actual_qty: openingQty && openingQty > 0 ? openingQty : 0,
			_from_scan: true,
		});
		close();
	} catch (e) {
		console.error(e);
		const detail = e && e.message ? e.message : "";
		frappe.msgprint(detail ? `${__("No se pudo dar de alta el producto")}: ${detail}` : __("No se pudo dar de alta el producto"));
	} finally {
		loading.value = false;
	}
};

onMounted(() => {
	getUOMs();
});
</script>
