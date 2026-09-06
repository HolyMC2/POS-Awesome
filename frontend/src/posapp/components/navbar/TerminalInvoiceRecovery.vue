<template>
	<section v-if="rows.length || error" data-test="terminal-sale-recovery">
		<strong>{{ __("Manager: review saved sales individually") }}</strong>
		<p>{{ __("Existing server invoices will be verified. An unsent sale will post into this open shift using its original request ID:") }} {{ openingName }}</p>
		<label>{{ __("Recovery reason or reconciliation record") }}
			<textarea v-model="reason" rows="2" maxlength="1000" data-test="saved-sale-recovery-reason" />
		</label>
		<label><input type="checkbox" v-model="confirmed" data-test="saved-sale-recovery-confirm" />
			{{ __("I reviewed this sale, its customer, collected money and original request ID.") }}
		</label>
		<div v-for="row in rows" :key="row.queue_id" class="offline-status-panel__resource">
			<span>{{ row.payload.invoice.customer_name || row.payload.invoice.customer }}</span>
			<span>{{ row.payload.invoice.grand_total }} {{ row.payload.invoice.currency }}</span>
			<small>{{ row.payload.invoice.posa_client_request_id || row.idempotency_key }}</small>
			<button @click="recover(row.queue_id)" :disabled="busy || !confirmed || reason.trim().length < 8" data-test="saved-sale-recover">
				{{ __("Verify or recover this sale") }}
			</button>
		</div>
		<p v-if="error" role="alert">{{ error }}</p>
	</section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { memory, isOffline } from "../../../offline/db";
import { getTerminalRecoverySales, recoverTerminalSale } from "../../../offline/terminalRecovery";
const __ = (window as any).__ || ((text: string) => text);
const rows = ref<any[]>([]);
const reason = ref("");
const confirmed = ref(false);
const busy = ref(false);
const error = ref("");
const openingName = memory.pos_opening_storage?.pos_opening_shift?.name;
async function load() { rows.value = await getTerminalRecoverySales(); }
async function recover(queueId: number) {
	if (isOffline()) { error.value = __("Reconnect to recover saved sales."); return; }
	busy.value = true;
	error.value = "";
	try {
		await recoverTerminalSale(queueId, reason.value);
		confirmed.value = false;
		await load();
	} catch (failure) { error.value = String((failure as Error).message); }
	finally { busy.value = false; }
}
onMounted(() => load().catch((failure) => { error.value = String(failure.message); }));
</script>
