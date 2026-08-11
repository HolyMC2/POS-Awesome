<template>
	<v-dialog v-model="dialogModel" max-width="640">
		<v-card>
			<v-card-title class="d-flex align-center">
				<v-icon start color="primary">mdi-cash-register</v-icon>
				{{ __("Pending Charges") }}
			</v-card-title>

			<v-card-text>
				<v-alert
					v-if="errorMessage"
					type="error"
					variant="tonal"
					density="comfortable"
					class="mb-3"
				>
					{{ errorMessage }}
				</v-alert>

				<div v-if="loading" class="d-flex justify-center py-6">
					<v-progress-circular indeterminate color="primary" />
				</div>

				<template v-else>
					<v-list v-if="requests.length" density="comfortable" lines="two">
						<v-list-item
							v-for="request in requests"
							:key="request.name"
							:disabled="loadingRequest === request.name"
							@click="selectRequest(request)"
						>
							<template #prepend>
								<v-icon color="warning">mdi-progress-clock</v-icon>
							</template>
							<v-list-item-title>
								{{ request.source_label || request.name }}
							</v-list-item-title>
							<v-list-item-subtitle>
								{{ request.customer_name }}
							</v-list-item-subtitle>
							<template #append>
								<span class="text-subtitle-2">
									{{ formatAmount(request.amount_total) }}
								</span>
							</template>
						</v-list-item>
					</v-list>
					<div v-else class="text-body-2 text-medium-emphasis py-6 text-center">
						{{ __("No pending charges. Requests from repairs and other modules appear here.") }}
					</div>
				</template>
			</v-card-text>

			<v-card-actions>
				<v-spacer />
				<v-btn variant="text" :disabled="loading" @click="refresh">
					{{ __("Refresh") }}
				</v-btn>
				<v-btn variant="text" @click="dialogModel = false">
					{{ __("Close") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useInvoiceStore } from "../../stores/invoiceStore";
import { useUIStore } from "../../stores/uiStore";
import { useToastStore } from "../../stores/toastStore";

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	posProfile: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["update:modelValue"]);

// Stores are resolved lazily inside the handlers: the invoice store touches
// frappe.datetime at init, which must not run just because the navbar
// mounted this (closed) dialog — e.g. in navbar unit tests.
const __ = window.__ || ((t) => t);

const dialogModel = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const loading = ref(false);
const loadingRequest = ref(null);
const requests = ref([]);
const errorMessage = ref("");

function formatAmount(value) {
	const num = Number(value || 0);
	try {
		return num.toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	} catch {
		return String(num);
	}
}

async function refresh() {
	errorMessage.value = "";
	loading.value = true;
	try {
		const r = await frappe.call({
			method: "posawesome.posawesome.api.charge_requests.get_open_charge_requests",
			args: { pos_profile: props.posProfile?.name },
		});
		requests.value = Array.isArray(r?.message) ? r.message : [];
	} catch (err) {
		// Never silent: the cashier must know the list could not load.
		errorMessage.value =
			err?.serverMessage || err?.message || __("Could not load pending charges.");
		requests.value = [];
	} finally {
		loading.value = false;
	}
}

async function selectRequest(request) {
	errorMessage.value = "";
	loadingRequest.value = request.name;
	try {
		const uiStore = useUIStore();
		const r = await frappe.call({
			method: "posawesome.posawesome.api.charge_requests.prepare_charge_request_invoice",
			args: {
				name: request.name,
				pos_profile: props.posProfile?.name,
				// The server resolves this with db.exists({"name": ...}), so it
				// must be the shift NAME — posting the whole doc matched
				// nothing and every pending charge failed to load.
				pos_opening_shift: uiStore.posOpeningShift?.name ?? uiStore.posOpeningShift ?? null,
			},
		});
		if (!r?.message?.name) {
			throw new Error(__("Server returned no invoice for this request."));
		}
		useInvoiceStore().triggerLoadInvoice(r.message);
		useToastStore().show({
			title: __("Charge loaded"),
			message: `${request.source_label || request.name} — ${__("charge it like any sale; the request completes automatically on payment.")}`,
			color: "info",
		});
		dialogModel.value = false;
	} catch (err) {
		errorMessage.value =
			err?.serverMessage || err?.message || __("Could not load this charge request.");
	} finally {
		loadingRequest.value = null;
	}
}

watch(
	() => props.modelValue,
	(open) => {
		if (open) refresh();
	},
);
</script>
