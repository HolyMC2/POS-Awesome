<template>
	<section class="orden-surface" data-testid="orden-surface">
		<v-alert
			v-if="errorMessage"
			type="error"
			variant="tonal"
			density="compact"
			class="orden-surface__error"
			data-testid="orden-error"
		>
			{{ errorMessage }}
		</v-alert>

		<div class="orden-surface__body">
			<OrdenQueue
				ref="queueRef"
				:cards="visibleCards"
				:chips="chips"
				:query="query"
				:selected="selectedName"
				:loading="loadingQueue"
				:bucket="bucket"
				:format-currency="formatCurrency"
				@update:query="query = $event"
				@bucket="chooseBucket"
				@select="select"
			/>

			<OrdenDetail
				:order="detail"
				:format-currency="formatCurrency"
				:format-float="formatFloat"
			/>

			<!-- The artboard's third column is «Equipo y candados» — evidence
			     chips this round builds no read model for. The story goes where
			     it would have stood, because it answers the same question the
			     chips were there to answer («can I hand this over, and what
			     happened to it») with facts the server can actually source.
			     Absent entirely when the request is not a repair: a counter
			     ticket from another vertical has no bench log to tell. -->
			<OrderStory
				v-if="repairName"
				class="orden-surface__story"
				doctype="Repair Order"
				:name="repairName"
				:title="__('What happened')"
				:empty-key="'Nothing has been recorded on this order yet.'"
				:format-currency="formatCurrency"
			/>
		</div>
	</section>
</template>

<script setup lang="ts">
/**
 * Órdenes de servicio as a rail DESTINATION (artboard `Orden.dc.html`).
 *
 * It REPLACES `ChargeRequestsDialog.vue` as the `serviceOrder` destination.
 * The dialog itself stays and is unchanged: it is still the navbar's Pending
 * Charges entry on the layouts that have no rail, exactly as the other flows
 * keep their floating copies. What changed is what the rail opens.
 *
 * Why a view rather than another hosted dialog: `useHostedSheet` exists to
 * make a MODAL behave as a surface — open itself, hand `close` up, lower its
 * store flag. This has no modal and no store flag, so it needs none of that.
 * It renders straight into the host, which is the whole point of the artboard:
 * a queue, a bill and a band, all on screen at once, instead of a 640px card
 * floating over the sale.
 *
 * THE MONEY PATH IS UNCHANGED. `collect` calls the same
 * `prepare_charge_request_invoice` the dialog has always called, hands the
 * draft to the cart through the same `triggerLoadInvoice`, and closes. The
 * invoice is still born in the cashier's own shift, still priced on the server
 * from `items_json`, and the request is still completed by the existing
 * mark-charged path when the sale submits. Nothing here computes a price.
 *
 * The band is published UP, never drawn here (§17.7 invariant 1: one number,
 * one action). `Pos.vue` adopts `balanceDue` and answers
 * `order.collectAndDeliver` by sending `orden:collect` back down the bus —
 * the same arm-and-send shape `RecargasDestination` uses for `recharge.submit`.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import OrdenDetail from "./OrdenDetail.vue";
import OrdenQueue from "./OrdenQueue.vue";
import OrderStory from "./OrderStory.vue";
import { describeBuckets, matchesQuery, ordenBandInput, type OrdenBucketId } from "./ordenModel";
import { resolveBandState, type BandState } from "../../../../composables/pos/shell/bandState";
import { useFormat } from "../../../../format";
import {
	fetchServiceOrderDetail,
	fetchServiceOrderQueue,
	getServiceOrderCountsCached,
	invalidateServiceOrderCounts,
	type ServiceOrderCard,
	type ServiceOrderCounts,
	type ServiceOrderDetail,
} from "../../../../services/serviceOrderService";
import { useInvoiceStore } from "../../../../stores/invoiceStore";
import { useToastStore } from "../../../../stores/toastStore";
import { useUIStore } from "../../../../stores/uiStore";
import { coarsePointer } from "../../../../utils/pointer";

interface BusLike {
	emit: (event: string, payload?: unknown) => void;
	on: (event: string, handler: (payload?: unknown) => void) => void;
	off: (event: string, handler?: (payload?: unknown) => void) => void;
}

const emit = defineEmits<{
	band: [BandState];
	close: [];
	/** The loaded selection, for the movil chrome that fronts this surface on
	 *  phones (null when nothing is selected). Same publish-up move as the
	 *  band: the surface keeps owning selection and the charge. */
	"update:selectedDetail": [ServiceOrderDetail | null];
}>();

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const eventBus = inject<BusLike | null>("eventBus", null);
const uiStore = useUIStore();
const { posProfile } = storeToRefs(uiStore);
const { formatCurrency, formatFloat } = useFormat();

const queueRef = ref<InstanceType<typeof OrdenQueue> | null>(null);

const bucket = ref<OrdenBucketId>("ready");
const query = ref("");
const cards = ref<ServiceOrderCard[]>([]);
const counts = ref<ServiceOrderCounts>({ ready: 0, working: null, delivered: 0 });
const selectedName = ref<string | null>(null);
const detail = ref<ServiceOrderDetail | null>(null);
const loadingQueue = ref(false);
const collecting = ref(false);
const errorMessage = ref("");

const profileName = computed(() => posProfile.value?.name ?? null);

const chips = computed(() => describeBuckets(counts.value, bucket.value));

const visibleCards = computed(() => cards.value.filter((card) => matchesQuery(card, query.value)));

/**
 * The selected card, as the QUEUE currently sees it.
 *
 * Read from the list rather than from `detail` so the band arms the moment a
 * card is chosen, without waiting for the detail round trip. The two carry the
 * same money — the detail endpoint returns the card fields plus the lines —
 * so there is no moment where they disagree about the balance.
 */
const selectedCard = computed(
	() => visibleCards.value.find((card) => card.name === selectedName.value) ?? null,
);

/**
 * The Repair Order behind the selected request, or null.
 *
 * Read off the card rather than off `detail` so the story starts loading in
 * the same breath as the bill, and taken from `reference_doctype` rather than
 * from a taller capability flag: a request that does not POINT at a repair
 * order has no repair story regardless of what the tenant has installed.
 */
const repairName = computed(() =>
	selectedCard.value?.reference_doctype === "Repair Order"
		? (selectedCard.value.reference_name ?? null)
		: null,
);

const reportFailure = (error: unknown, fallback: string) => {
	const failure = error as { serverMessage?: string; message?: string } | null;
	errorMessage.value = failure?.serverMessage || failure?.message || fallback;
};

async function loadCounts() {
	const profile = profileName.value;
	if (!profile) return;
	try {
		counts.value = await getServiceOrderCountsCached(profile, true);
	} catch (error) {
		// The chips go quiet rather than the surface going down: the queue
		// below is the thing the cashier came for, and it loads separately.
		counts.value = { ready: 0, working: null, delivered: 0 };
		reportFailure(error, __("Could not count the service orders."));
	}
}

async function loadQueue() {
	const profile = profileName.value;
	if (!profile) return;
	// `working` is not a list — see `ORDEN_BUCKETS`. Nothing can select it.
	const listed = bucket.value === "delivered" ? "delivered" : "ready";
	loadingQueue.value = true;
	try {
		cards.value = await fetchServiceOrderQueue(profile, listed);
		errorMessage.value = "";
	} catch (error) {
		cards.value = [];
		reportFailure(error, __("Could not load the service orders."));
	} finally {
		loadingQueue.value = false;
	}
}

async function loadDetail(name: string) {
	const profile = profileName.value;
	if (!profile) return;
	try {
		const loaded = await fetchServiceOrderDetail(profile, name);
		// The cashier may have moved on while this was in flight; a detail
		// panel that fills in with the PREVIOUS order is worse than an empty
		// one, because it looks authoritative.
		if (selectedName.value === name) detail.value = loaded;
	} catch (error) {
		if (selectedName.value === name) detail.value = null;
		reportFailure(error, __("Could not open this service order."));
	}
}

const select = (name: string) => {
	selectedName.value = name;
	detail.value = null;
	void loadDetail(name);
};

const chooseBucket = (id: OrdenBucketId) => {
	if (id === bucket.value) return;
	bucket.value = id;
	selectedName.value = null;
	detail.value = null;
	void loadQueue();
};

/**
 * COBRAR Y ENTREGAR.
 *
 * The same three steps the dialog has always taken, in the same order, against
 * the same endpoint. The surface closes afterwards because the ticket is now
 * in the cart and the cart is where the cashier has to look next — the same
 * move `RecargasDestination` makes once its line is on the sale.
 */
async function collect() {
	const profile = profileName.value;
	const card = selectedCard.value;
	if (!profile || !card || collecting.value || card.invoiced) return;
	collecting.value = true;
	errorMessage.value = "";
	try {
		const response = await (window as any).frappe.call({
			method: "posawesome.posawesome.api.charge_requests.prepare_charge_request_invoice",
			args: {
				name: card.name,
				pos_profile: profile,
				// The server resolves this with `db.exists({"name": ...})`, so it
				// must be the shift NAME — posting the whole doc matches nothing.
				pos_opening_shift: uiStore.posOpeningShift?.name ?? uiStore.posOpeningShift ?? null,
			},
		});
		if (!response?.message?.name) {
			throw new Error(__("Server returned no invoice for this order."));
		}
		useInvoiceStore().triggerLoadInvoice(response.message);
		invalidateServiceOrderCounts();
		useToastStore().show({
			title: __("Service order loaded"),
			message: `${card.folio} — ${__("charge it like any sale; the order completes on payment.")}`,
			color: "info",
		});
		emit("close");
	} catch (error) {
		reportFailure(error, __("Could not load this service order into the sale."));
	} finally {
		collecting.value = false;
	}
}

const onCollectRequested = () => {
	void collect();
};

// Arming the band is a description of the selection, not an act: the shell
// decides whether to show it and answers the press. `immediate` because the
// surface is mounted BECAUSE the rail chose it, and a band still showing the
// sale's total under a repair queue is the wrong number on the one line the
// register reserves for the right one.
watch(
	[selectedCard, () => collecting.value],
	() => {
		const input = ordenBandInput(selectedCard.value);
		if (!input) return;
		const state = resolveBandState(input);
		emit("band", collecting.value ? { ...state, primaryEnabled: false } : state);
	},
	{ immediate: true },
);

watch(profileName, () => {
	invalidateServiceOrderCounts();
	void loadCounts();
	void loadQueue();
});

watch(detail, (loaded) => emit("update:selectedDetail", loaded), { immediate: true });

// The phone's back chip: return to the queue. The movil view has no queue of
// its own, so "back" means clearing the selection HERE, where it lives.
const onDeselectRequested = () => {
	selectedName.value = null;
	detail.value = null;
};

onMounted(() => {
	eventBus?.on("orden:collect", onCollectRequested);
	eventBus?.on("orden:deselect", onDeselectRequested);
	void loadCounts();
	void loadQueue();
	// Desk only: on a tablet this focus summons the keyboard over the queue.
	if (!coarsePointer()) queueRef.value?.focusSearch?.();
});

onBeforeUnmount(() => {
	eventBus?.off("orden:collect", onCollectRequested);
	eventBus?.off("orden:deselect", onDeselectRequested);
});
</script>

<style scoped>
.orden-surface {
	display: flex;
	flex-direction: column;
	gap: var(--reg-space-md, 10px);
	flex: 1 1 auto;
	min-height: 0;
	padding: 16px;
	background: var(--reg-surface-sunken, #f8f9fa);
}

.orden-surface__error {
	flex: none;
}

.orden-surface__body {
	display: flex;
	gap: var(--reg-space-lg, 14px);
	flex: 1 1 auto;
	min-height: 0;
}

/* The artboard's third column, at the artboard's width. */
.orden-surface__story {
	width: 330px;
	flex: none;
	min-height: 0;
	padding: var(--reg-space-lg, 14px) 16px;
	background: var(--reg-surface, #fff);
	border: 1px solid var(--reg-border-light, rgba(0, 0, 0, 0.06));
	border-radius: var(--reg-radius-md, 14px);
}

/* Below the artboard's width the queue stops being a column and becomes the
   top third: a 330px queue beside a four-column bill leaves neither readable
   on a 1,024px register. Same boundary the ledger surface uses. */
@media (max-width: 1180px) {
	.orden-surface__body {
		flex-direction: column;
	}

	.orden-surface__body :deep(.orden-queue) {
		width: auto;
		max-height: 40%;
	}

	.orden-surface__story {
		width: auto;
		max-height: 30%;
	}
}

/* On a phone the queue IS the screen. A selection is fronted fullscreen by
   MovilOrdenView (the shell v-shows it over this surface), so the detail
   panel and the story here can only ever show their idle placeholders —
   which squeezed the queue to a strip a card and a half tall (owner's live
   phone test, 2026-08-26: "a small scroll with all data"). */
@media (max-width: 767.98px) {
	.orden-surface {
		padding: 10px;
	}

	.orden-surface__body :deep(.orden-queue) {
		flex: 1 1 auto;
		max-height: none;
		min-height: 0;
	}

	.orden-surface__body :deep(.orden-detail),
	.orden-surface__story {
		display: none;
	}
}
</style>
