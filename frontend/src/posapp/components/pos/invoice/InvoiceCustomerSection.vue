<template>
	<v-row align="center" class="items px-3 py-2 customer-section-row">
		<v-col class="pb-0 pr-0 customer-section-col">
			<!-- Customer selection component (flexes to fill; full width when
			     the Type select is hidden) -->
			<Customer ref="customerComponent" />
		</v-col>
		<!-- Invoice Type Selection (Only shown if sales orders are allowed).
		     Fixed width so the value (Invoice/Order/Quotation) isn't clipped;
		     cols=3 was only ~35px of text room → "In…". -->
		<v-col
			v-if="pos_profile.posa_allow_sales_order"
			cols="auto"
			class="pb-4 customer-section-type-col"
		>
			<v-select
				density="compact"
				hide-details
				variant="solo"
				color="primary"
				style="width: 125px"
				class="sleek-field pos-themed-input"
				:items="invoiceTypes"
				:label="frappe._('Type')"
				:model-value="modelValue"
				@update:model-value="$emit('update:modelValue', $event)"
				:disabled="modelValue == 'Return'"
			></v-select>
		</v-col>
	</v-row>
</template>

<script setup>
import { ref } from "vue";
import Customer from "../customer/Customer.vue";

defineProps({
	pos_profile: {
		type: Object,
		required: true,
		default: () => ({}),
	},
	invoiceTypes: {
		type: Array,
		default: () => ["Invoice", "Order", "Quotation"],
	},
	modelValue: {
		type: String,
		default: "Invoice",
	},
});

defineEmits(["update:modelValue"]);
const customerComponent = ref(null);

// Expose focus method for parent
const focusCustomerSearch = () => {
	if (customerComponent.value && typeof customerComponent.value.focusCustomerSearch === "function") {
		customerComponent.value.focusCustomerSearch();
	}
};

const selectFirstCustomer = () => {
	if (customerComponent.value && typeof customerComponent.value.selectFirstCustomer === "function") {
		customerComponent.value.selectFirstCustomer();
	}
};

const openNewCustomer = () => {
	if (customerComponent.value && typeof customerComponent.value.openNewCustomer === "function") {
		customerComponent.value.openNewCustomer();
	}
};

defineExpose({
	focusCustomerSearch,
	selectFirstCustomer,
	openNewCustomer,
});

const frappe = window.frappe;
</script>

<style scoped>
/* Below 500px the two columns split ~187px of usable width between them
   and the customer field lost. Type is a three-item select the cashier
   touches once a shift; the customer field is the control of the sale, so
   it takes the whole line and Type drops underneath. */
@media (max-width: 499px) {
	.customer-section-row > .customer-section-col,
	.customer-section-row > .customer-section-type-col {
		flex: 1 1 100%;
		max-width: 100%;
	}

	.customer-section-row > .customer-section-type-col {
		padding-top: 4px;
		padding-bottom: 8px;
	}
}
</style>
