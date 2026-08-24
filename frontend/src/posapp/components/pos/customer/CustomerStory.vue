<template>
	<v-dialog v-model="open" v-bind="dialogProps" scrollable>
		<v-card class="customer-story pos-themed-card">
			<v-card-title class="customer-story__head">
				<div class="customer-story__identity">
					<span class="customer-story__who">{{ heading }}</span>
					<span class="customer-story__scope" data-testid="customer-story-scope">{{
						scopeLabel
					}}</span>
				</div>
				<v-btn
					icon="mdi-close"
					variant="text"
					color="medium-emphasis"
					:aria-label="__('Close history')"
					@click="open = false"
				/>
			</v-card-title>

			<v-card-text class="customer-story__body">
				<p v-if="loading" class="customer-story__note">{{ __("Reading what happened…") }}</p>

				<v-alert
					v-else-if="errorMessage"
					type="error"
					variant="tonal"
					density="compact"
					data-testid="customer-story-error"
				>
					{{ errorMessage }}
				</v-alert>

				<OrderStory
					v-else
					:payload="story"
					:format-currency="formatCurrency"
					:empty-key="'Nothing in this window.'"
					:title="''"
				/>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * «Historial» — what has happened with THIS customer, opened from the ticket.
 *
 * No rail entry and no route, on purpose: the question is asked WITH the
 * customer standing there and the sale still open, so the answer has to arrive
 * over the ticket and leave again without touching it. A destination would
 * mean navigating away from a cart mid-sale, which is exactly the move this is
 * meant to replace.
 *
 * It reuses `OrderStory` untouched, fed through its `payload` prop — the seam
 * that exists so a caller with its OWN endpoint does not have to re-implement
 * the timeline. The rows here come from `get_customer_story`; the rendering is
 * identical to a repair order's, which is the point: a cashier learns to read
 * one timeline, not three.
 *
 * THE WINDOW IS STATED. Ninety days and fifty events is a scope, not a
 * complete account, and a customer's history that quietly stops looks like a
 * customer who quietly stopped buying.
 */
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import OrderStory from "../flows/orden/OrderStory.vue";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useFormat } from "../../../format";
import {
	fetchCustomerStory,
	type CustomerStoryPayload,
} from "../../../services/serviceOrderService";
import { useCustomersStore } from "../../../stores/customersStore";
import { useUIStore } from "../../../stores/uiStore";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const { dialogProps } = useDialogFullscreen({ maxWidth: 640 });
const { formatCurrency } = useFormat();

const customersStore = useCustomersStore();
const uiStore = useUIStore();
const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
const { posProfile } = storeToRefs(uiStore);

const open = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const story = ref<CustomerStoryPayload | null>(null);
const loading = ref(false);
const errorMessage = ref("");

/** The customer id, which is what the endpoint takes — not the display name. */
const customerId = computed(() => {
	const info = customerInfo.value as Record<string, unknown>;
	const fromInfo = typeof info?.name === "string" ? info.name : null;
	return selectedCustomer.value || fromInfo || null;
});

const heading = computed(() => {
	const info = customerInfo.value as Record<string, unknown>;
	const label = typeof info?.customer_name === "string" ? info.customer_name : "";
	return label || customerId.value || __("Customer");
});

const scopeLabel = computed(() => {
	const days = story.value?.days ?? 90;
	const cap = story.value?.cap ?? 50;
	return __("Last {0} days · up to {1} events")
		.replace("{0}", String(days))
		.replace("{1}", String(cap));
});

async function load() {
	const customer = customerId.value;
	const profile = posProfile.value?.name;
	if (!customer || !profile) {
		errorMessage.value = __("Choose a customer on the ticket first.");
		story.value = null;
		return;
	}
	loading.value = true;
	errorMessage.value = "";
	try {
		story.value = await fetchCustomerStory(customer, profile);
	} catch (error) {
		const failure = error as { serverMessage?: string; message?: string } | null;
		story.value = null;
		errorMessage.value =
			failure?.serverMessage || failure?.message || __("Could not read this customer's history.");
	} finally {
		loading.value = false;
	}
}

// Re-read on every open rather than caching: a customer's history changes
// while the register is open — this very sale is about to be on it — and a
// cached one would be wrong in the direction that matters.
watch(
	() => props.modelValue,
	(isOpen) => {
		if (isOpen) void load();
	},
	{ immediate: true },
);
</script>

<style scoped>
.customer-story {
	display: flex;
	flex-direction: column;
}

.customer-story__head {
	display: flex;
	align-items: flex-start;
	gap: var(--reg-space-md, 10px);
}

.customer-story__identity {
	display: flex;
	flex-direction: column;
	gap: 2px;
	flex: 1;
	min-width: 0;
}

.customer-story__who {
	font-size: 1.05rem;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.customer-story__scope {
	font-size: 0.75rem;
	font-weight: 400;
	color: var(--reg-text-muted, #667085);
}

.customer-story__body {
	min-height: 0;
}

.customer-story__note {
	margin: 0;
	padding: 16px 0;
	font-size: 12.5px;
	color: var(--reg-text-muted, #9aa2ae);
}
</style>
