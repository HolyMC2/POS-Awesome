<!-- MP-INTEGRATION-POINT: "Cobrar con terminal MP" button + status modal.
     Flag-gated (frappe.boot.mercadopago.enabled + POS Profile mp_point_enabled);
     renders nothing when off. Polls point_order_status (~2s) as primary, with
     mercadopago_order realtime as an optional short-circuit. The connector owns
     the money + auto-matches; this only confirms the terminal charge.
     See MERCADOPAGO_POINT_INTEGRATION.md. -->
<template>
	<div v-if="enabled" class="mp-point-wrap mt-2">
		<v-btn
			block
			color="primary"
			variant="flat"
			prepend-icon="mdi-credit-card-wireless-outline"
			:loading="busy"
			:disabled="busy || amountNum <= 0"
			@click="start"
		>
			{{ __("Cobrar con terminal MP") }}
		</v-btn>

		<v-dialog v-model="modal" persistent max-width="420">
			<v-card>
				<v-card-title class="text-h6 d-flex align-center">
					<v-icon class="mr-2" color="primary">mdi-credit-card-wireless</v-icon>
					{{ __("Terminal MercadoPago") }}
				</v-card-title>
				<v-card-text class="text-center py-6">
					<v-progress-circular
						v-if="spinner"
						indeterminate
						color="primary"
						size="52"
						class="mb-4"
					/>
					<v-icon v-else-if="phase === 'approved'" color="success" size="60" class="mb-3">
						mdi-check-circle
					</v-icon>
					<v-icon v-else-if="phase === 'failed'" color="error" size="60" class="mb-3">
						mdi-close-circle
					</v-icon>
					<div class="text-body-1">{{ message }}</div>
					<div v-if="amountNum > 0" class="text-h6 font-weight-bold mt-3">
						{{ currency }} {{ amountNum.toFixed(2) }}
					</div>
				</v-card-text>
				<v-card-actions>
					<v-btn v-if="phase === 'waiting'" variant="text" color="error" @click="cancel">
						{{ __("Cancelar") }}
					</v-btn>
					<v-spacer />
					<v-btn
						v-if="phase === 'approved' || phase === 'failed'"
						variant="text"
						@click="close"
					>
						{{ __("Cerrar") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from "vue";
import { useUIStore } from "../../stores/uiStore";
import { useInvoiceStore } from "../../stores/invoiceStore";
import {
	createPointOrder,
	pointOrderStatus,
	cancelPointOrder,
	listEnabledTerminals,
} from "../../services/mp_point";

const props = defineProps({
	amount: { type: [Number, String], default: 0 },
	mopName: { type: String, default: "" },
});
const emit = defineEmits(["approved", "failed"]);

const uiStore = useUIStore();
const invoiceStore = useInvoiceStore();
const __ = window.__ || ((s) => s);

const POLL_MS = 2000;
const TIMEOUT_MS = 15 * 60 * 1000;

const modal = ref(false);
const busy = ref(false);
const phase = ref("idle"); // idle | sending | waiting | processing | approved | failed
const message = ref("");
const orderName = ref(null);
let pollTimer = null;
let deadline = 0;
let realtimeOff = null;

const amountNum = computed(() => Number(props.amount) || 0);
const currency = computed(() => invoiceStore.invoiceDoc?.currency || "");
const spinner = computed(() => ["sending", "waiting", "processing"].includes(phase.value));

const enabled = computed(() => {
	const boot = window.frappe?.boot?.mercadopago;
	const prof = uiStore.posProfile;
	if (!boot || !boot.enabled || !prof || Number(prof.mp_point_enabled) !== 1) return false;
	// Only on the configured Point Mode of Payment row.
	const pointMop = boot.point_mode_of_payment || "MercadoPago Point";
	return props.mopName === pointMop;
});

const setPhase = (p, m) => {
	phase.value = p;
	message.value = m;
};

const stopPolling = () => {
	if (pollTimer) {
		clearTimeout(pollTimer);
		pollTimer = null;
	}
	if (typeof realtimeOff === "function") {
		realtimeOff();
		realtimeOff = null;
	}
};

const resolveTerminal = async () => {
	try {
		const terminals = await listEnabledTerminals();
		if (Array.isArray(terminals) && terminals.length) {
			return terminals[0].terminal_id;
		}
	} catch (e) {
		/* fall back to the connector's Settings default terminal */
	}
	return undefined;
};

const start = async () => {
	if (busy.value || amountNum.value <= 0) return;
	busy.value = true;
	modal.value = true;
	setPhase("sending", __("Enviando a la terminal…"));
	// The connector requires a saved invoice (external_reference = its name) so
	// the booked payment auto-matches. POSAwesome must have named the draft by
	// payment time; if not, tell the cashier to save first rather than 500.
	const pos_invoice = invoiceStore.invoiceDoc?.name;
	if (!pos_invoice) {
		return fail(__("Guarda la venta antes de cobrar en la terminal"));
	}
	try {
		const terminal_id = await resolveTerminal();
		const res = await createPointOrder({ pos_invoice, amount: amountNum.value, terminal_id });
		if (!res || !res.ok || !res.order || !res.order.name) {
			return fail((res && res.order && res.order.error_message) || __("No se pudo enviar a la terminal"));
		}
		orderName.value = res.order.name;
		deadline = Date.now() + TIMEOUT_MS;
		setPhase("waiting", __("Esperando que el cliente pague en la terminal…"));
		subscribeRealtime(res.order.name);
		schedulePoll();
	} catch (e) {
		fail((e && e.message) || __("Error de conexión"));
	}
};

const subscribeRealtime = (order) => {
	// Optional latency optimisation — poll stays authoritative.
	try {
		const rt = window.frappe?.realtime;
		if (!rt || typeof rt.on !== "function") return;
		const handler = (data) => {
			if (data && data.order === order) poll();
		};
		rt.on("mercadopago_order", handler);
		realtimeOff = () => {
			try {
				rt.off && rt.off("mercadopago_order", handler);
			} catch (e) {
				/* ignore */
			}
		};
	} catch (e) {
		/* realtime is best-effort */
	}
};

const schedulePoll = () => {
	if (pollTimer) clearTimeout(pollTimer);
	pollTimer = setTimeout(poll, POLL_MS);
};

const poll = async () => {
	if (!orderName.value || phase.value === "approved" || phase.value === "failed") return;
	if (Date.now() > deadline) return fail(__("Tiempo agotado — verifica la terminal"));
	try {
		const st = await pointOrderStatus(orderName.value);
		const s = st && st.order_status;
		if (s === "processing") {
			setPhase("processing", __("Procesando…"));
		} else if (s === "created" || s === "at_terminal") {
			setPhase("waiting", __("Esperando que el cliente pague en la terminal…"));
		}
		if (s === "finished") {
			if (st.payment && st.payment.status === "Approved") return approve();
			return fail(__("La terminal no aprobó el pago"));
		}
		if (s === "expired" || s === "canceled" || s === "error") {
			return fail((st && st.error) || __("No se completó el cobro"));
		}
		schedulePoll();
	} catch (e) {
		// Transient — keep polling until the deadline.
		schedulePoll();
	}
};

const approve = () => {
	stopPolling();
	busy.value = false;
	setPhase("approved", __("✅ Pago aprobado"));
	emit("approved", { order: orderName.value, amount: amountNum.value });
};

const fail = (msg) => {
	stopPolling();
	busy.value = false;
	setPhase("failed", msg || __("No se completó"));
	emit("failed", { order: orderName.value });
};

const cancel = async () => {
	if (orderName.value) {
		try {
			await cancelPointOrder(orderName.value);
		} catch (e) {
			/* ignore — fall through to failed state */
		}
	}
	fail(__("Cobro cancelado"));
};

const close = () => {
	stopPolling();
	modal.value = false;
	phase.value = "idle";
	orderName.value = null;
	busy.value = false;
};

onBeforeUnmount(stopPolling);
</script>
