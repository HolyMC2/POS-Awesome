<!-- eslint-disable vue/multi-word-component-names -->
<template>
	<div v-if="posProfile?.posa_allow_reconcile_payments">
		<v-row>
			<v-col md="7" cols="12">
				<p>
					<strong>{{ resolvedSectionTitle }}</strong>
					<span v-if="totalUnallocated" class="text-primary">
						{{ __("- Total Unallocated") }} :
						{{ currencySymbol(posProfile.currency) }}
						{{ formatCurrency(totalUnallocated) }}
					</span>
				</p>
			</v-col>
			<v-col md="5" cols="12">
				<p v-if="totalSelected" class="golden--text text-end">
					<span>{{ __("Total Selected :") }}</span>
					<span>
						{{ currencySymbol(posProfile.currency) }}
						{{ formatCurrency(totalSelected) }}
					</span>
				</p>
			</v-col>
		</v-row>
		<v-data-table
			:headers="tableHeaders"
			:items="payments"
			item-key="name"
			class="elevation-1 mt-0"
			:loading="loading"
			:row-props="paymentRowProps"
		>
			<template v-slot:item.select="{ item }">
				<v-checkbox
					v-model="internalSelectedPayments"
					:value="item"
					color="primary"
					hide-details
					@click.stop
				></v-checkbox>
			</template>
			<template v-slot:item.mode_of_payment="{ item }">
				<span>
					{{ item?.is_credit_note ? __("Credit Note") : item?.mode_of_payment }}
				</span>
			</template>
			<template v-slot:item.reference_invoice="{ item }">
				<span v-if="item?.is_credit_note && item?.reference_invoice">
					{{ item.reference_invoice }}
				</span>
			</template>
			<template v-slot:item.paid_amount="{ item }">
				{{ currencySymbol(item.currency) }}
				{{ formatCurrency(item.paid_amount) }}
			</template>
			<template v-slot:item.unallocated_amount="{ item }">
				<span class="text-primary"
					>{{ currencySymbol(item.currency) }} {{ formatCurrency(item.unallocated_amount) }}</span
				>
			</template>
			<template v-slot:item.refund="{ item }">
				<v-btn v-if="allowRefund && !item.is_credit_note && Number(item.unallocated_amount) > 0"
					size="small" variant="text" @click.stop="refundPayment = item">{{ __("Refund unused advance") }}</v-btn>
			</template>
		</v-data-table>
		<AdvanceRefundDialog v-if="refundPayment" :payment="refundPayment" :pos-profile="posProfile"
			:opening-shift="openingShift" :customer="customer" @close="refundPayment = null" @refunded="emit('refunded', $event)" />
		<v-divider></v-divider>
	</div>
</template>

<script setup>
import { computed, ref } from "vue";
import AdvanceRefundDialog from "./AdvanceRefundDialog.vue";

const __ = (text) => (window.__ ? window.__(text) : text);

const props = defineProps({
	payments: Array,
	selectedPayments: Array,
	posProfile: Object,
	totalUnallocated: Number,
	totalSelected: Number,
	loading: Boolean,
	headers: Array,
	sectionTitle: String,
	currencySymbol: Function,
	formatCurrency: Function,
	paymentRowClass: Function,
	partyType: String,
	customer: String,
	openingShift: Object,
});

const emit = defineEmits(["update:selectedPayments", "refunded"]);
const refundPayment = ref(null);
const allowRefund = computed(() => props.partyType === "Customer" && props.posProfile?.posa_allow_make_new_payments);
const tableHeaders = computed(() => allowRefund.value
	? [...(props.headers || []), { title: __("Actions"), key: "refund", sortable: false }]
	: props.headers);

const internalSelectedPayments = computed({
	get: () => props.selectedPayments,
	set: (val) => emit("update:selectedPayments", val),
});

const resolvedSectionTitle = computed(() => props.sectionTitle || __("Payments"));

const paymentRowProps = ({ item }) => {
	if (!props.paymentRowClass) {
		return {};
	}
	const rowClass = props.paymentRowClass(item);
	return rowClass ? { class: rowClass } : {};
};
</script>
