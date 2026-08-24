<template>
	<v-dialog v-model="open" v-bind="dialogProps" persistent>
		<v-card class="cliente-deposit pos-themed-card">
			<v-card-title class="cliente-deposit__head">
				<span class="cliente-deposit__title">{{ __("Deposit to the wallet") }}</span>
				<v-btn
					icon="mdi-close"
					variant="text"
					color="medium-emphasis"
					:aria-label="__('Cancel')"
					:disabled="busy"
					@click="close"
				/>
			</v-card-title>

			<v-card-text class="cliente-deposit__body">
				<p class="cliente-deposit__who" data-testid="cliente-deposit-who">
					{{ customerLabel }}
				</p>

				<v-text-field
					v-model="amountText"
					type="text"
					inputmode="decimal"
					autofocus
					density="comfortable"
					variant="outlined"
					hide-details="auto"
					class="pos-themed-input"
					data-testid="cliente-deposit-amount"
					:label="__('Amount')"
					:disabled="busy"
					@keyup.enter="submit"
				/>

				<v-select
					v-model="mode"
					density="comfortable"
					variant="outlined"
					hide-details="auto"
					class="pos-themed-input"
					data-testid="cliente-deposit-mode"
					:items="tenders"
					:label="__('Mode of Payment')"
					:disabled="busy"
				/>

				<!-- The register's own honesty line, repeated where the money
				     actually moves: a cash deposit is drawer cash, and the corte
				     will expect it. -->
				<p class="cliente-deposit__note">
					{{ __("The deposit lands in this register's count.") }}
				</p>

				<v-alert
					v-if="errorMessage"
					type="error"
					variant="tonal"
					density="compact"
					data-testid="cliente-deposit-error"
				>
					{{ errorMessage }}
				</v-alert>
			</v-card-text>

			<v-card-actions class="cliente-deposit__actions">
				<v-btn variant="text" :disabled="busy" @click="close">{{ __("Cancel") }}</v-btn>
				<v-spacer />
				<v-btn
					variant="flat"
					color="primary"
					:loading="busy"
					data-testid="cliente-deposit-submit"
					@click="submit"
				>
					{{ __("Make a deposit") }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * «DEPOSITAR» — money into the customer's monedero, from this register.
 *
 * Two fields and one act, because that is the whole transaction: how much, and
 * what the customer is handing over. Everything else the Payment Entry needs —
 * the party, the account behind the tender, the company, whether this shift may
 * take money at all — is the server's to decide, and this dialog deliberately
 * cannot pass any of it (`CUSTOMER_CARDS_GOLDEN_FLOW.md` §4: "no deposit,
 * enrolment or redemption endpoint trusts the client for gating").
 *
 * THE REFUSAL IS THE POINT. A closed shift, a tender that is not on this
 * profile, a zero amount and a customer outside the register's groups all come
 * back as a sentence the cashier can act on, and it is printed VERBATIM and
 * IN PLACE — not as a toast that is gone by the time they look up, and not
 * translated into a friendlier guess at what went wrong. The dialog stays open
 * with the amount still in it, so the fix is one edit rather than a retype.
 *
 * The amount is parsed from TEXT rather than bound to `type="number"`: a number
 * input silently yields an empty string for "1,200" and for a stray "$", and a
 * deposit that quietly becomes zero is the failure mode with a customer's cash
 * already on the counter.
 */
import { computed, ref, watch } from "vue";

import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useToastStore } from "../../../stores/toastStore";
import { depositStoredValue, refusalText } from "./customerCardService";

const props = defineProps<{
	modelValue: boolean;
	posProfile: string;
	customer: string;
	customerLabel: string;
	/** Mode-of-payment names from the profile — the only tenders allowed. */
	tenders: string[];
}>();

const emit = defineEmits<{ "update:modelValue": [boolean]; deposited: [] }>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const { dialogProps } = useDialogFullscreen({ maxWidth: 420 });

const open = computed({
	get: () => props.modelValue,
	set: (value: boolean) => emit("update:modelValue", value),
});

const amountText = ref("");
const mode = ref("");
const busy = ref(false);
const errorMessage = ref("");

/**
 * Read a peso figure out of whatever was typed.
 *
 * Thousands separators and a currency symbol are what a cashier types; a
 * COMMA as the decimal mark is not, on a Mexican register, and treating it as
 * one would turn 1,200 into 1.2. So separators come out and the dot stays.
 */
const parseAmount = (text: string): number => {
	const cleaned = String(text ?? "")
		.replace(/[^\d.,-]/g, "")
		.replace(/,/g, "");
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : 0;
};

const amount = computed(() => parseAmount(amountText.value));

// Reset on every open rather than on close: a dialog that keeps the last
// amount would let a second «Depositar» submit the first one by reflex.
watch(
	() => props.modelValue,
	(isOpen) => {
		if (!isOpen) return;
		amountText.value = "";
		errorMessage.value = "";
		busy.value = false;
		mode.value = props.tenders[0] ?? "";
	},
	{ immediate: true },
);

function close() {
	if (busy.value) return;
	open.value = false;
}

async function submit() {
	if (busy.value) return;
	if (!(amount.value > 0)) {
		errorMessage.value = __("Enter an amount greater than zero.");
		return;
	}
	if (!mode.value) {
		errorMessage.value = __("Choose how the customer is paying.");
		return;
	}
	busy.value = true;
	errorMessage.value = "";
	try {
		await depositStoredValue(props.posProfile, props.customer, amount.value, mode.value);
		useToastStore().show({
			title: __("Deposit"),
			message: __("The wallet has the deposit."),
			color: "success",
		});
		// The parent re-reads the wallet rather than being handed a balance:
		// the deposit is one of several things that could have moved it, and
		// the figure on screen should be the one the server holds.
		emit("deposited");
		open.value = false;
	} catch (error) {
		errorMessage.value = refusalText(error, __("The deposit did not go through."));
	} finally {
		busy.value = false;
	}
}
</script>

<style scoped>
.cliente-deposit {
	display: flex;
	flex-direction: column;
}

.cliente-deposit__head {
	display: flex;
	align-items: center;
	gap: var(--reg-space-md, 10px);
}

.cliente-deposit__title {
	flex: 1;
	min-width: 0;
	font-size: 1.05rem;
	font-weight: 700;
	color: var(--reg-text-primary, #212121);
}

.cliente-deposit__body {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-lg, 14px);
}

.cliente-deposit__who {
	margin: 0;
	font-size: 0.82rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-deposit__note {
	margin: 0;
	font-size: 0.72rem;
	color: var(--reg-text-muted, #667085);
}

.cliente-deposit__actions {
	padding: var(--reg-space-md, 10px) var(--reg-space-lg, 14px) var(--reg-space-lg, 14px);
}
</style>
