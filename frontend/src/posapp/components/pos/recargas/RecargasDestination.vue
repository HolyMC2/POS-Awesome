<template>
	<!-- The surface is `RecargasView`'s; this wrapper is the wiring the rail
	     needs around it and nothing visible of its own. -->
	<RecargasView
		:bolsa-payload="snapshot.bolsa.value"
		:rows="snapshot.rows.value"
		:catalog-tree="snapshot.catalog.value"
		:today="snapshot.today.value"
		:ledger-limit="snapshot.limit"
		:format-currency="formatCurrency"
		:pos-profile="posProfile"
		:has-capability="hasCapability"
		:customer-phone="customerPhone"
		@intent="onIntent"
	/>
</template>

<script setup lang="ts">
/**
 * Recargas as a rail DESTINATION (build plan §12 item F, `Recargas.dc.html`).
 *
 * `RecargasView` was built and then mounted by nothing: the registry kept
 * pointing the `recharge` destination at the saldo catalogue picker, a modal
 * that waits for a `modelValue` the host never sets — so the rail lit Recarga
 * over an empty surface. This wrapper is what the view's own header promised:
 * *"the band arms it and `Pos.vue`'s SALDO-INTEGRATION-POINT sends it through
 * the saldo app's own capture flow."*
 *
 * Three seams, and the money stays on the path it was already on:
 *
 *   READ   `useRecargasSnapshot` — three reads, guarded by name; nothing here
 *          can reach `requestTXN`.
 *   ARM    every `intent` becomes a band state and is handed UP through
 *          `DestinationHost`'s `band` relay. The shell shows it on the one
 *          band; this surface draws no second number and no second button.
 *   SEND   the band's `recharge.submit` comes back as a bus event. The
 *          reference is validated by the SAME read the picker calls
 *          (`validate_referencia`), and the line is handed to the cart by the
 *          SAME event the picker emits (`saldo:picker-add`). From there the
 *          recharge is charged at submit, by saldo's hooks, exactly as a
 *          picker-added line is. Nothing new touches TAECEL.
 *
 * Then the surface closes itself: the line is on the ticket, and the ticket is
 * where the cashier has to look next.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";

import RecargasView from "./RecargasView.vue";
import { buildCatalogTabs, findCarrier } from "./recargasCatalog";
import type { RechargeIntent, rechargeBandInput } from "./recargasModel";
import { useRecargasSnapshot } from "./useRecargasSnapshot";
import { resolveBandState, type BandState } from "../../../composables/pos/shell/bandState";
import { useFormat } from "../../../format";
import { useCustomersStore } from "../../../stores/customersStore";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";
import { useVerticalStore } from "../../../stores/verticalStore";

type AnyRecord = Record<string, any>;

interface IntentPayload {
	intent: RechargeIntent;
	band: ReturnType<typeof rechargeBandInput>;
}

interface BusLike {
	emit: (event: string, payload?: unknown) => void;
	on: (event: string, handler: (payload?: unknown) => void) => void;
	off: (event: string, handler?: (payload?: unknown) => void) => void;
}

/** The one read the picker makes before handing a line over. A validation,
 * not a purchase — `saldo/api/transactions.py` says so: "POSAwesome calls
 * before submit. Returns {ok, error}. Never throws on validation miss." */
const RECARGAS_VALIDATE_METHOD = "saldo.api.transactions.validate_referencia";

const emit = defineEmits<{ band: [BandState]; close: [] }>();

const __ = (window as AnyRecord).__ || ((value: string) => value);

const eventBus = inject<BusLike | null>("eventBus", null);
const uiStore = useUIStore();
const customersStore = useCustomersStore();
const verticalStore = useVerticalStore();
const toastStore = useToastStore();
const { formatCurrency } = useFormat();

const { posProfile } = storeToRefs(uiStore);
const { customerInfo } = storeToRefs(customersStore);

const hasCapability = (capability: string) => verticalStore.has(capability);

/** The phone of whoever is already on the ticket, so the number field can
 * offer it — the view treats it as a suggestion, never as the reference. */
const customerPhone = computed(() => {
	const phone = (customerInfo.value as AnyRecord)?.mobile_no;
	return typeof phone === "string" && phone.trim() ? phone.trim() : null;
});

const snapshot = useRecargasSnapshot({
	posProfile: () => posProfile.value?.name ?? null,
});

const lastIntent = ref<RechargeIntent | null>(null);
const lastReady = ref(false);
const submitting = ref(false);

function onIntent(payload: IntentPayload): void {
	const band = payload.band;
	lastIntent.value = payload.intent;
	// `ready` is the recharge input's own strictness (a company chosen, a
	// reference, a positive amount, an Item behind it); the band disables its
	// button on it and this wrapper refuses to send on it — the same gate twice.
	lastReady.value = band.kind === "recharge" && Boolean(band.ready);
	emit("band", resolveBandState(band));
}

/** Product label for the cart line, from the catalogue the view is showing.
 * Falls back to the carrier and the amount rather than the bare code — the
 * ticket is read by the customer, and `TEL050` means nothing to them. */
function lineName(intent: RechargeIntent): string {
	const tabs = buildCatalogTabs(snapshot.catalog.value);
	const carrier = findCarrier(tabs, intent.carrier);
	const product = carrier?.products.find((candidate) => candidate.code === intent.itemCode);
	if (product?.label) {
		return product.label;
	}
	const carrierLabel = intent.carrierLabel ?? intent.carrier ?? "";
	return `${carrierLabel} ${formatCurrency(intent.amount ?? 0)}`.trim();
}

async function submit(): Promise<void> {
	const intent = lastIntent.value;
	if (submitting.value || !intent || !lastReady.value || !intent.itemCode || !eventBus) {
		return;
	}
	const frappe = (globalThis as AnyRecord)?.frappe;
	if (!frappe?.call) {
		return;
	}
	submitting.value = true;
	try {
		const response = await frappe.call({
			method: RECARGAS_VALIDATE_METHOD,
			args: {
				item_code: intent.itemCode,
				referencia: intent.reference,
				monto: intent.amount,
			},
		});
		const verdict = (response?.message ?? {}) as AnyRecord;
		if (!verdict.ok) {
			toastStore.show({
				title: __("Recharge not added"),
				message: String(verdict.error || __("The reference did not pass validation.")),
				color: "error",
			});
			return;
		}
		const amount = Number(intent.amount ?? 0);
		eventBus.emit("saldo:picker-add", {
			item_code: intent.itemCode,
			item_name: lineName(intent),
			rate: amount,
			price_list_rate: amount,
			saldo_referencia: intent.reference,
		});
		// The line is on the ticket now; the ticket is the next screen.
		emit("close");
	} catch (error) {
		console.error("Recargas could not validate the reference", error);
		toastStore.show({
			title: __("Recharge not added"),
			message: __("The register could not validate the reference. Try again."),
			color: "error",
		});
	} finally {
		submitting.value = false;
	}
}

const onSubmitRequested = () => {
	void submit();
};

onMounted(() => {
	void snapshot.refresh();
	eventBus?.on("recharge:submit", onSubmitRequested);
});

onBeforeUnmount(() => {
	// Always with the handler: a bare `off` would strip every listener.
	eventBus?.off("recharge:submit", onSubmitRequested);
});
</script>
