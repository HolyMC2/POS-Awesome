<template>
	<v-dialog v-model="dialogModel" v-bind="dialogProps">
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
								<v-btn v-if="request.can_release" size="small" variant="tonal" class="mr-2"
									data-testid="release-charge-draft" :disabled="!!loadingRequest"
									@click.stop="releaseCandidate = request">{{ __("Release draft") }}</v-btn>
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
	<v-dialog :model-value="!!releaseCandidate" max-width="520" @update:model-value="releaseCandidate = null">
		<v-card v-if="releaseCandidate" data-testid="release-charge-confirmation">
			<v-card-title>{{ __("Release unsubmitted charge draft?") }}</v-card-title>
			<v-card-text>{{ __("The draft is retained and cannot collect this retired request. Saved or processing payments must be reviewed first. Reload the current source quote after release.") }}
				<p>{{ releaseCandidate.invoice }}</p>
			</v-card-text>
			<v-card-actions><v-btn @click="releaseCandidate = null" :disabled="!!loadingRequest">{{ __("Keep draft") }}</v-btn>
				<v-btn color="warning" variant="outlined" :loading="!!loadingRequest" @click="releaseDraft">{{ __("Release draft") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { isOffline } from "../../../offline/db";
import { getQueueEntries } from "../../../offline/writeQueue";
import { getInvoiceOutboxRows } from "../../../offline/invoiceOutbox";
import { currentQueueOwner } from "../../../offline/queueOwnership";
import { getShiftTerminalContext } from "../../../offline/shiftTerminal";
import { computed, ref, watch } from "vue";
import { useDialogFullscreen } from "../../composables/core/useDialogFullscreen";
import { useHostedSheet } from "../../composables/pos/shell/useHostedSheet";
import { useInvoiceStore } from "../../stores/invoiceStore";
import { useUIStore } from "../../stores/uiStore";
import { useToastStore } from "../../stores/toastStore";

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	posProfile: { type: Object, default: () => ({}) },
});
// `close` is only emitted while hosted as the rail's Orden de servicio
// destination (see `useHostedSheet`); the navbar copy uses `update:modelValue`.
const emit = defineEmits(["update:modelValue", "close"]);

// Same geometry as before (640 wide, fullscreen on phones); when hosted the
// helper swaps it for the destination surface beside the rail.
const { dialogProps } = useDialogFullscreen({ maxWidth: 640 });

// Hosted, the open state is OURS: nobody outside passes `modelValue` to a
// component the rail mounted, and the rail choosing the destination is the
// open request. Floating (navbar), it stays the parent's v-model.
const hostedOpen = ref(false);
const hosted = useHostedSheet({
	open: hostedOpen,
	openSheet: () => {
		hostedOpen.value = true;
	},
	emit,
});

// Stores are resolved lazily inside the handlers: the invoice store touches
// frappe.datetime at init, which must not run just because the navbar
// mounted this (closed) dialog — e.g. in navbar unit tests.
const __ = window.__ || ((t) => t);

const dialogModel = computed({
	get: () => (hosted.isHosted ? hostedOpen.value : props.modelValue),
	set: (value) => {
		if (hosted.isHosted) {
			hostedOpen.value = value;
			return;
		}
		emit("update:modelValue", value);
	},
});

const loading = ref(false);
const loadingRequest = ref(null);
const requests = ref([]);
const errorMessage = ref("");
const releaseCandidate = ref(null);
let loadedScope = "";
let readVersion = 0;
function currentScope() {
	const owner = currentQueueOwner();
	const shift = useUIStore().posOpeningShift;
	return owner && owner.queue_profile === props.posProfile?.name
		? JSON.stringify([owner, props.posProfile.name, shift?.name ?? shift, getShiftTerminalContext()]) : "";
}
function assertScope(scope) {
	if (!scope || currentScope() !== scope) {
		requests.value = []; releaseCandidate.value = null; loadedScope = "";
		throw new Error(__("The cashier or register changed. Reopen pending charges."));
	}
}

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
	const version = ++readVersion;
	const scope = currentScope();
	errorMessage.value = "";
	loading.value = true;
	try {
		const r = await frappe.call({
			method: "posawesome.posawesome.api.charge_requests.get_open_charge_requests",
			args: { pos_profile: props.posProfile?.name },
		});
		if (version !== readVersion) return;
		assertScope(scope);
		loadedScope = scope;
		requests.value = Array.isArray(r?.message) ? r.message : [];
	} catch (err) {
		if (version !== readVersion) return;
		// Never silent: the cashier must know the list could not load.
		errorMessage.value =
			err?.serverMessage || err?.message || __("Could not load pending charges.");
		requests.value = [];
	} finally {
		if (version === readVersion) loading.value = false;
	}
}

async function selectRequest(request) {
	if (loadingRequest.value) return;
	const scope = loadedScope;
	errorMessage.value = "";
	loadingRequest.value = request.name;
	try {
		assertScope(scope);
		const uiStore = useUIStore();
		const r = await frappe.call({
			method: "posawesome.posawesome.api.charge_requests.prepare_charge_request_invoice",
			args: {
				...getShiftTerminalContext(),
				name: request.name,
				pos_profile: props.posProfile?.name,
				// The server resolves this with db.exists({"name": ...}), so it
				// must be the shift NAME — posting the whole doc matched
				// nothing and every pending charge failed to load.
				pos_opening_shift: uiStore.posOpeningShift?.name ?? uiStore.posOpeningShift ?? null,
			},
		});
		assertScope(scope);
		if (r?.message?.already_charged) {
			useToastStore().show({ title: __("This request has already been charged"),
				message: r.message.name, color: "info" });
			await refresh();
			return;
		}
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

async function releaseDraft() {
	const request = releaseCandidate.value;
	if (!request || loadingRequest.value) return;
	const scope = loadedScope;
	errorMessage.value = "";
	loadingRequest.value = request.name;
	try {
		assertScope(scope);
		if (isOffline()) throw new Error(__("Reconnect before releasing a charge draft."));
		const [invoices, payments, outbox] = await Promise.all([
			getQueueEntries("invoice"), getQueueEntries("payment"), getInvoiceOutboxRows(),
		]);
		assertScope(scope);
		const current = useInvoiceStore().invoiceDoc;
		const tendered = current?.name === request.invoice && (Number(current.paid_amount || 0) !== 0 ||
			(current.payments || []).some(row => Number(row.amount || 0) !== 0));
		if (invoices.length || payments.length || outbox.some(row => row.status !== "acknowledged" || row.server_verified !== true) || tendered)
			throw new Error(__("Review saved or processing payments before releasing a charge draft."));
		const ui = useUIStore();
		const response = await frappe.call({
			method: "posawesome.posawesome.api.charge_request_integrity.release_charge_request_draft",
			args: { ...getShiftTerminalContext(), name: request.name, invoice_name: request.invoice,
				pos_profile: props.posProfile?.name, pos_opening_shift: ui.posOpeningShift?.name ?? ui.posOpeningShift ?? null },
		});
		assertScope(scope);
		if (!response?.message?.released || response.message.invoice !== request.invoice)
			throw new Error(__("Release could not be verified. Refresh pending charges before retrying."));
		releaseCandidate.value = null;
		useToastStore().show({ title: __("Draft released"), message: __("Reload the current source quote before collecting payment."), color: "info" });
		await refresh();
	} catch (error) {
		errorMessage.value = error?.serverMessage || error?.message || __("Could not release this charge draft.");
		releaseCandidate.value = null;
	} finally { loadingRequest.value = null; }
}

watch(() => props.posProfile?.name, () => {
	requests.value = []; releaseCandidate.value = null; loadedScope = "";
	if (dialogModel.value) refresh();
});
watch(
	() => dialogModel.value,
	(open) => {
		if (open) refresh();
	},
);
</script>
