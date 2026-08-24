<template>
	<!-- Absent, not empty. A register with no CRM has nothing to say here, and
	     a placeholder row would cost the same height as a fact. -->
	<div v-if="context" class="crm-strip" data-testid="crm-strip">
		<span
			v-for="deal in deals"
			:key="deal.name"
			class="crm-strip__fact"
			data-testid="crm-strip-deal"
		>
			<span class="crm-strip__status">{{ deal.status }}</span>
			<span v-if="deal.amount" class="crm-strip__amount mono">{{
				formatCurrency(deal.amount)
			}}</span>
		</span>

		<span v-if="lead" class="crm-strip__fact" data-testid="crm-strip-lead">
			{{ __("Lead · {0}").replace("{0}", String(lead.status || "")) }}
		</span>

		<span v-if="!deals.length && !lead" class="crm-strip__fact" data-testid="crm-strip-none">
			{{ __("Not in the CRM") }}
		</span>

		<span v-if="lastActivity" class="crm-strip__fact" data-testid="crm-strip-activity">
			{{ __("Last activity {0}").replace("{0}", lastActivity) }}
		</span>

		<button
			type="button"
			class="crm-strip__action"
			data-testid="crm-strip-seguimiento"
			:disabled="asking"
			@click="askForFollowUp"
		>
			{{ asking ? __("Asking…") : __("Follow up") }}
		</button>
	</div>
</template>

<script setup lang="ts">
/**
 * What the back office already knows about the customer on the ticket.
 *
 * PASSIVE BY DESIGN, with exactly one act on it. The strip reads — open deals,
 * their stage and value, when anyone last touched them, a lead status when
 * there is no deal — and «Seguimiento» is the only thing that writes. That
 * split is the owner's: a register should never quietly create records in
 * another team's system, and a cashier should be able to hand one over when
 * the customer asks.
 *
 * IT IS GATED ON A PROBE, NOT ON A TRY. `crmService` disables itself for the
 * session the first time the server answers "not installed", so a register
 * without a CRM makes ONE request in its life rather than one per ticket. A
 * failure hides the strip and says nothing: a context strip that could not
 * load is not something a cashier can act on mid-sale, and a toast about it
 * would be noise over a live ticket.
 *
 * WHAT IT DOES NOT DO: navigate. Same rule as `OrderStory` — it is read with a
 * customer waiting, and the one control on it must not cost the sale.
 */
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";

import { useFormat } from "../../../format";
import {
	createSeguimiento,
	fetchCrmContext,
	type CrmContext,
} from "../../../services/crmService";
import { useCustomersStore } from "../../../stores/customersStore";
import { useToastStore } from "../../../stores/toastStore";
import { useUIStore } from "../../../stores/uiStore";

const __ = (window as Record<string, any>).__ || ((value: string) => value);

const customersStore = useCustomersStore();
const uiStore = useUIStore();
const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
const { posProfile } = storeToRefs(uiStore);
const { formatCurrency } = useFormat();

const context = ref<CrmContext | null>(null);
const asking = ref(false);

const customerId = computed(() => {
	const info = customerInfo.value as Record<string, unknown>;
	const fromInfo = typeof info?.name === "string" ? info.name : null;
	return selectedCustomer.value || fromInfo || null;
});

const profileName = computed(() => posProfile.value?.name ?? null);

const deals = computed(() => context.value?.deals ?? []);
const lead = computed(() => context.value?.lead ?? null);

/**
 * The day someone last touched this customer's record — the DATE only.
 *
 * Split off the string rather than parsed: `new Date("2026-08-19 …")` is a
 * timezone trap and the hour is not the question anybody is asking here.
 */
const lastActivity = computed(() => {
	const stamps = [...deals.value.map((deal) => deal.modified), lead.value?.modified]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.sort();
	const latest = stamps[stamps.length - 1];
	return latest ? String(latest).split(" ")[0] : "";
});

async function load() {
	const customer = customerId.value;
	const profile = profileName.value;
	if (!customer || !profile) {
		context.value = null;
		return;
	}
	context.value = await fetchCrmContext(customer, profile);
}

async function askForFollowUp() {
	const customer = customerId.value;
	const profile = profileName.value;
	if (!customer || !profile || asking.value) return;
	asking.value = true;
	try {
		const result = await createSeguimiento(customer, profile);
		useToastStore().show({
			title: __("Follow-up asked for"),
			message:
				result.action === "updated"
					? __("Today's request was updated — the back office sees one, not two.")
					: __("The back office will pick it up."),
			color: "info",
		});
		// The strip's own facts just changed: re-read rather than patching the
		// list here, so what is on screen is what the server holds.
		await load();
	} catch (error) {
		const failure = error as { serverMessage?: string; message?: string } | null;
		useToastStore().show({
			title: __("Could not ask for a follow-up"),
			message: failure?.serverMessage || failure?.message || "",
			color: "error",
		});
	} finally {
		asking.value = false;
	}
}

watch([customerId, profileName], () => void load(), { immediate: true });
</script>

<style scoped>
.crm-strip {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 5px 12px;
	min-width: 0;
	padding-top: 2px;
}

.crm-strip__fact {
	display: inline-flex;
	align-items: baseline;
	gap: 5px;
	font-size: 0.72rem;
	color: var(--pos-text-muted, #667085);
	white-space: nowrap;
	min-width: 0;
}

.crm-strip__status {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.crm-strip__amount {
	font-variant-numeric: tabular-nums;
	color: var(--pos-text-primary, #212121);
}

/* A text affordance, like «change» and «history» beside it. The accent on this
   screen belongs to the band's primary; a filled button here would compete
   with the one thing the cashier is meant to press. */
.crm-strip__action {
	flex: none;
	border: 0;
	background: none;
	padding: 2px 4px;
	font: inherit;
	font-size: 0.72rem;
	color: var(--pos-text-muted, #667085);
	text-decoration: underline;
	cursor: pointer;
}

.crm-strip__action:hover:not(:disabled),
.crm-strip__action:focus-visible {
	color: var(--pos-text-primary, #212121);
}

.crm-strip__action:disabled {
	cursor: default;
	opacity: 0.6;
}
</style>
