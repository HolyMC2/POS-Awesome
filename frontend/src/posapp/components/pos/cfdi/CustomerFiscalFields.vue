<template>
	<v-row dense>
		<v-col cols="12" sm="6">
			<v-text-field
				:model-value="modelValue.tax_id"
				density="compact"
				color="primary"
				class="pos-themed-input cfdi-rfc-input"
				:label="__('RFC') + ' *'"
				autocomplete="off"
				spellcheck="false"
				:error-messages="rfcErrors"
				:hint="rfcHint"
				persistent-hint
				@update:model-value="onRfcInput"
			/>
			<v-alert
				v-if="existingOwner && existingOwner.customer !== modelValue.customer"
				type="info"
				variant="tonal"
				density="compact"
				class="mt-1 cfdi-existing-alert"
			>
				{{ __("This RFC belongs to") }} <strong>{{ existingOwner.customer_name }}</strong>
				<v-btn
					size="small"
					variant="text"
					color="primary"
					class="ml-1"
					@click="$emit('select-existing', existingOwner)"
				>
					{{ __("Use that customer") }}
				</v-btn>
			</v-alert>
		</v-col>
		<v-col v-if="showName" cols="12" sm="6">
			<v-text-field
				:model-value="modelValue.customer_name"
				density="compact"
				color="primary"
				class="pos-themed-input"
				:label="__('Razón Social') + ' *'"
				:hint="__('As registered with SAT, without SA DE CV suffix')"
				@update:model-value="update('customer_name', $event)"
			/>
		</v-col>
		<v-col cols="12" sm="6">
			<v-autocomplete
				:model-value="modelValue.tax_regime"
				density="compact"
				color="primary"
				class="pos-themed-input"
				:label="__('Régimen Fiscal') + ' *'"
				:items="regimeItems"
				item-title="title"
				item-value="value"
				auto-select-first
				:no-data-text="__('No matching régimen')"
				@update:model-value="update('tax_regime', $event)"
			/>
		</v-col>
		<v-col cols="12" sm="6">
			<v-autocomplete
				:model-value="modelValue.mx_cfdi_use"
				density="compact"
				color="primary"
				class="pos-themed-input"
				:label="__('Uso CFDI') + ' *'"
				:items="useItems"
				item-title="title"
				item-value="value"
				auto-select-first
				:no-data-text="__('No compatible uso for this régimen')"
				@update:model-value="update('mx_cfdi_use', $event)"
			/>
		</v-col>
		<v-col cols="12" sm="6">
			<v-text-field
				:model-value="modelValue.zip_code"
				density="compact"
				color="primary"
				class="pos-themed-input"
				:label="__('Código Postal (SAT)') + ' *'"
				inputmode="numeric"
				maxlength="5"
				:error-messages="zipErrors"
				@update:model-value="update('zip_code', $event)"
			/>
		</v-col>
	</v-row>
</template>

<script>
/**
 * Reusable fiscal-data field group (RFC, razón social, régimen, uso, CP).
 *
 * Controlled component: parent owns the value object; every keystroke emits
 * update:modelValue with a patched copy. RFC feedback is layered: the pure
 * TS validator answers on keystroke (shape/date/checksum), and a debounced
 * server check adds the duplicate-owner lookup — collisions surface as a
 * "use that customer" action, mirroring emc's hard uniqueness guard.
 */
import { checkCustomerRfc } from "../../../api/cfdi";
import { isGenericRfc, normalizeRfc, validateRfc } from "../../../utils/rfc";

export default {
	name: "CustomerFiscalFields",
	props: {
		modelValue: { type: Object, required: true },
		catalogs: { type: Object, required: true },
		usesForRegime: { type: Function, required: true },
		// The customer dialog already has its own name field — hide ours there.
		showName: { type: Boolean, default: true },
	},
	emits: ["update:modelValue", "select-existing"],
	data() {
		return {
			existingOwner: null,
			rfcCheckTimer: null,
		};
	},
	computed: {
		rfcErrors() {
			const rfc = this.modelValue.tax_id || "";
			if (!rfc) return [];
			return validateRfc(rfc).map((issue) => issue.message);
		},
		rfcHint() {
			const rfc = normalizeRfc(this.modelValue.tax_id);
			if (!rfc) return "";
			if (isGenericRfc(rfc)) {
				return __("Generic RFC (público en general): régimen 616 + uso S01 apply.");
			}
			if (!validateRfc(rfc).length) {
				return rfc.length === 12 ? __("Persona moral") : __("Persona física");
			}
			return "";
		},
		zipErrors() {
			const zip = this.modelValue.zip_code || "";
			if (!zip) return [];
			return /^\d{5}$/.test(zip) ? [] : [__("The código postal must be 5 digits")];
		},
		regimeItems() {
			return (this.catalogs.tax_regimes || []).map((row) => ({
				value: row.key,
				title: `${row.key} — ${row.description}`,
			}));
		},
		useItems() {
			return this.usesForRegime(this.modelValue.tax_regime || "").map((row) => ({
				value: row.key,
				title: `${row.key} — ${row.description}`,
			}));
		},
	},
	beforeUnmount() {
		if (this.rfcCheckTimer) clearTimeout(this.rfcCheckTimer);
	},
	methods: {
		update(field, value) {
			this.$emit("update:modelValue", { ...this.modelValue, [field]: value });
		},
		onRfcInput(value) {
			const normalized = normalizeRfc(value);
			const patch = { ...this.modelValue, tax_id: normalized };
			// The generic RFC pins régimen/uso by SAT rule — prefill them so
			// the operator doesn't have to know the 616/S01 pairing.
			if (isGenericRfc(normalized)) {
				patch.tax_regime = "616";
				patch.mx_cfdi_use = "S01";
			}
			this.$emit("update:modelValue", patch);
			this.existingOwner = null;
			if (this.rfcCheckTimer) clearTimeout(this.rfcCheckTimer);
			if (!normalized || validateRfc(normalized).length || isGenericRfc(normalized)) {
				return;
			}
			this.rfcCheckTimer = setTimeout(() => this.runServerRfcCheck(normalized), 450);
		},
		async runServerRfcCheck(rfc) {
			try {
				const result = await checkCustomerRfc(rfc, this.modelValue.customer || "");
				// Stale response guard — the operator kept typing.
				if (normalizeRfc(this.modelValue.tax_id) !== result.tax_id) return;
				this.existingOwner = result.existing;
			} catch (error) {
				// Lookup is advisory; the save path re-checks server-side.
				console.warn("cfdi: rfc check failed", error);
			}
		},
	},
};
</script>
