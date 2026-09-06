<template>
	<v-dialog :model-value="true" max-width="480" :persistent="busy" @update:model-value="emit('close')">
		<v-card class="pos-themed-card">
			<v-card-title>{{ __("Refund unused advance") }}</v-card-title>
			<v-card-text class="advance-refund-fields">
				<p>{{ payment.name }} · {{ payment.currency }}</p>
				<p v-if="savedIntent">{{ __("This refund has a saved request. Check or retry it before starting another.") }}</p>
				<v-text-field v-model="amount" type="number" min="0.01" step="0.01" :label="__('Refund amount')"
					:suffix="payment.currency" :disabled="busy || !!savedIntent" hide-details />
				<v-select v-model="mode" :items="modes" :label="__('Mode of Payment')"
					:disabled="busy || !!savedIntent" hide-details />
				<v-textarea v-model="reason" :label="__('Refund reason')" rows="2" maxlength="1000"
					:disabled="busy || !!savedIntent" hide-details />
				<v-alert v-if="quote" type="info" variant="tonal">
					{{ __("Cash or bank payout") }}: {{ quote.paid_amount }} {{ quote.paid_currency }}
				</v-alert>
				<p>{{ __("Hand out cash only after the refund is confirmed. An uncertain response remains in pending payments.") }}</p>
				<v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
			</v-card-text>
			<v-card-actions>
				<v-btn :disabled="busy" @click="emit('close')">{{ __("Close") }}</v-btn>
				<v-spacer />
				<v-btn v-if="!quote && !savedIntent" color="primary" :loading="busy" :disabled="!valid"
					@click="preview">{{ __("Review refund") }}</v-btn>
				<v-btn v-else color="primary" :loading="busy" @click="submit" data-test="advance-refund-confirm">
					{{ savedIntent ? __("Check or retry refund") : __("Confirm refund") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { isOffline } from "../../../offline/db";
import { getShiftTerminalContext } from "../../../offline/shiftTerminal";
import { ensurePaymentClientRequestId } from "../../../offline/idempotency";
import { getPendingAdvanceRefund, submitAdvanceRefund } from "../../../offline/payments";

const props = defineProps<{ payment: Record<string, any>; posProfile: Record<string, any>; openingShift: Record<string, any>; customer: string }>();
const emit = defineEmits<{ close: []; refunded: [result: Record<string, any>] }>();
const __ = (text: string) => window.__ ? window.__(text) : text;
const amount = ref(String(props.payment.unallocated_amount || ""));
const modes = computed(() => (props.posProfile.payments || []).map((row: any) => row.mode_of_payment).filter(Boolean));
const mode = ref(modes.value.includes(props.payment.mode_of_payment) ? props.payment.mode_of_payment : modes.value[0] || "");
const reason = ref("");
const busy = ref(false);
const error = ref("");
const quote = ref<any>(null);
const savedIntent = ref<Record<string, any> | null>(null);
const valid = computed(() => Number.isFinite(Number(amount.value)) && Number(amount.value) > 0
	&& Number(amount.value) <= Number(props.payment.unallocated_amount) && !!mode.value && reason.value.trim().length >= 8);

watch([amount, mode, reason], () => { if (!savedIntent.value) quote.value = null; });

function payload() {
	return {
		operation: "refund_customer_advance", original_payment_entry: props.payment.name,
		customer: props.customer, party: props.customer, party_type: "Customer", payment_type: "Pay",
		company: props.posProfile.company, pos_profile: props.posProfile.name, pos_profile_name: props.posProfile.name,
		pos_opening_shift: props.openingShift.name, pos_opening_shift_name: props.openingShift.name,
		amount: Number(amount.value), mode_of_payment: mode.value, reason: reason.value.trim(),
		...getShiftTerminalContext(),
	};
}

async function restorePending() {
	const pending = await getPendingAdvanceRefund(props.payment.name);
	if (pending) {
		savedIntent.value = pending.payload.args.payload;
		amount.value = String(savedIntent.value!.amount);
		mode.value = savedIntent.value!.mode_of_payment;
		reason.value = savedIntent.value!.reason;
		quote.value = { paid_amount: savedIntent.value!.expected_paid_amount, paid_currency: savedIntent.value!.expected_paid_currency };
	}
}

async function preview() {
	busy.value = true; error.value = "";
	try {
		if (isOffline()) throw new Error(__("Reconnect to refund an unused advance."));
		await restorePending();
		if (savedIntent.value) return;
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.payment_entry.preview_customer_advance_refund", args: { payload: payload() },
		});
		if (!Number.isFinite(Number(response.message?.paid_amount)) || Number(response.message.paid_amount) <= 0 || !response.message.paid_currency)
			throw new Error(__("A valid refund quote is required."));
		quote.value = response.message;
	} catch (failure) { error.value = String((failure as Error).message); }
	finally { busy.value = false; }
}

async function submit() {
	busy.value = true; error.value = "";
	try {
		if (!savedIntent.value) {
			if (!valid.value || !quote.value) throw new Error(__("Review the refund before confirming."));
			const intent = { ...payload(), expected_paid_amount: quote.value.paid_amount, expected_paid_currency: quote.value.paid_currency };
			ensurePaymentClientRequestId(intent);
			savedIntent.value = intent;
		}
		const result = await submitAdvanceRefund(savedIntent.value!);
		emit("refunded", result);
		emit("close");
	} catch (failure) { error.value = String((failure as Error).message); }
	finally { busy.value = false; }
}

onMounted(() => restorePending().catch((failure) => { error.value = String(failure.message); }));
</script>

<style scoped>
.advance-refund-fields { display: grid; gap: 16px; }
</style>
