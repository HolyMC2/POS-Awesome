<template>
	<v-dialog :model-value="true" max-width="960" scrollable @update:model-value="emit('close')">
		<v-card class="pos-themed-card money-exceptions" data-testid="money-exceptions">
			<v-card-title class="money-exceptions__header">
				<h2>{{ __("Money needing attention") }}</h2>
				<v-btn variant="text" :aria-label="__('Close')" @click="emit('close')">{{ __("Close") }}</v-btn>
			</v-card-title>
			<v-card-text class="money-exceptions__body">
				<p>{{ __("Check the original transaction before taking payment or issuing a refund again.") }}</p>
				<div class="money-exceptions__toolbar">
					<v-select v-if="!activeShift" v-model="profile" :items="profiles" :label="__('POS Profile')"
						:disabled="busy" hide-details density="compact" data-testid="exception-profile" />
					<p v-else><strong>{{ profile }}</strong> · {{ activeShift }}</p>
					<v-btn variant="tonal" :loading="busy" :disabled="busy" @click="refresh" data-testid="exception-refresh">{{ __("Refresh status") }}</v-btn>
				</div>
				<p class="money-exceptions__muted">{{ __("Server records are scoped to the selected register. Local records belong to this browser and cashier.") }}</p>
				<v-alert v-if="!online" type="info" variant="tonal" data-testid="exception-offline">
					{{ __("Reconnect to check server records. Saved work on this browser is shown below.") }}
				</v-alert>
				<v-alert v-for="error in errors" :key="error" type="warning" variant="tonal" role="alert" data-testid="exception-error">{{ __(error) }}</v-alert>
				<p v-if="checkedAt" class="money-exceptions__muted">{{ __("Last checked") }}: {{ checkedAt }}</p>
				<p v-if="!busy && !rows.length" data-testid="exception-empty">{{ __("No pending records found in the sources checked.") }}</p>
				<article v-for="row in rows" :key="row.id" class="money-exceptions__row" :data-testid="`exception-row-${row.origin || 'server'}`">
					<div class="money-exceptions__row-head">
						<h3>{{ __(exceptionKindLabel(row.kind)) }}</h3>
						<v-chip size="small" :color="row.severity === 'warning' ? 'warning' : 'info'" variant="tonal">{{ __(row.status) }}</v-chip>
						<strong v-if="amountLabel(row)">{{ amountLabel(row) }}</strong>
					</div>
					<p>{{ __(row.message_key) }}</p>
					<p class="money-exceptions__next">{{ __(nextStep(row)) }}</p>
					<p class="money-exceptions__muted money-exceptions__identity">
						{{ row.origin === 'browser' ? __("This browser") : __("Server record") }}
						· {{ row.document?.name || row.client_request_id || row.id }}
						<time v-if="row.modified"> · {{ row.modified }}</time>
					</p>
					<div class="money-exceptions__actions">
						<template v-for="action in visibleActions(row)" :key="action.type">
							<a v-if="documentAction(action) && documentHref(row, action)" :href="documentHref(row, action)!"
								target="_blank" rel="noopener noreferrer" :aria-disabled="!online || undefined"
								@click="guardDocument($event)">{{ __(actionLabel(action)) }}</a>
							<v-btn v-else variant="tonal" size="small" :disabled="busy || actionDisabled(action)"
								@click="act(row, action)">{{ __(actionLabel(action)) }}</v-btn>
						</template>
					</div>
				</article>
				<p v-if="hasMore" data-testid="exception-more">{{ __("More records need review. This list is limited; open the source records to review the rest.") }}</p>
				<details class="money-exceptions__coverage" data-testid="exception-coverage">
					<summary>{{ __("Sources checked") }}</summary>
					<p>{{ __("Saved browser work") }}: {{ __(localChecked ? "Checked" : "Not verified") }}</p>
					<p v-if="!feed">{{ __("Server records") }}: {{ __("Not verified") }}</p>
					<p v-for="(source, key) in feed?.sources" :key="key">
						{{ __(exceptionSourceLabel(String(key))) }}: {{ __(sourceLabel(source.status)) }}
					</p>
				</details>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { memory, isOffline, initPromise } from "../../../../../offline/db";
import { readLocalMoneyExceptions } from "../../../../../offline/moneyExceptions";
import { currentQueueOwner } from "../../../../../offline/queueOwnership";
import { useOnlineStatus } from "../../../../composables/core/useOnlineStatus";
import { useSyncStore } from "../../../../stores/syncStore";
import { bus } from "../../../../bus";
import { fetchMoneyExceptions, type MoneyException, type MoneyExceptionFeed, type ExceptionAction } from "../../../../services/moneyExceptionsService";
import { exceptionDocumentHref, exceptionKindLabel, exceptionSourceLabel } from "./moneyExceptionModel";

const props = defineProps<{ posProfile?: Record<string, any> }>();
const emit = defineEmits<{ close: []; savedWork: []; terminalStatus: [] }>();
const __ = (key: string) => window.__ ? window.__(key) : key;
const opening = () => memory.pos_opening_storage?.pos_opening_shift;
const activeShift = ref(opening()?.name || "");
const profile = ref(props.posProfile?.name || memory.pos_opening_storage?.pos_profile?.name || "");
const profiles = ref<string[]>(profile.value ? [profile.value] : []);
const { isOnline } = useOnlineStatus();
const online = computed(() => isOnline.value && !isOffline());
const rows = shallowRef<MoneyException[]>([]);
const feed = shallowRef<MoneyExceptionFeed | null>(null);
const errors = ref<string[]>([]);
const busy = ref(false), localChecked = ref(false), hasMore = ref(false), checkedAt = ref("");
let generation = 0;
let displayedOwner = "";
let disposed = false;

async function refresh() {
	if (disposed) return;
	const request = ++generation;
	await initPromise;
	if (disposed || request !== generation) return;
	const owner = JSON.stringify(currentQueueOwner());
	displayedOwner = owner;
	const selected = profile.value;
	const shift = opening()?.pos_profile === selected ? opening()?.name : undefined;
	activeShift.value = shift || "";
	busy.value = true; errors.value = []; rows.value = []; feed.value = null; localChecked.value = false;
	hasMore.value = false; checkedAt.value = "";
	const localPromise = readLocalMoneyExceptions();
	const serverPromise = online.value && selected ? fetchMoneyExceptions(selected, shift) : Promise.resolve(null);
	const [local, server] = await Promise.allSettled([localPromise, serverPromise]);
	if (request !== generation) return;
	if (owner !== JSON.stringify(currentQueueOwner())) {
		busy.value = false; errors.value = ["The cashier or register changed. Reopen the exception report."]; return;
	}
	const result: MoneyException[] = [];
	if (local.status === "fulfilled") {
		result.push(...local.value.rows); hasMore.value = local.value.has_more;
		localChecked.value = !local.value.errors.length;
	}
	if (!localChecked.value) errors.value.push("Some saved browser work could not be read. Keep this browser's data and retry.");
	if (server.status === "fulfilled" && server.value) {
		feed.value = server.value;
		result.push(...server.value.rows.map(row => ({ ...row, origin: "server" as const })));
		hasMore.value ||= server.value.has_more;
		if (Object.values(server.value.sources).some(source => source.status === "error"))
			errors.value.push("Some server sources could not be checked. This is not an all-clear report.");
	} else if (online.value) errors.value.push(selected
		? "Server records could not be checked for this register. Refresh or ask a supervisor."
		: "Select a POS profile to check server records. A supervisor can review a profile without an open shift.");
	rows.value = result;
	checkedAt.value = new Date().toLocaleTimeString(); busy.value = false;
}

function amountLabel(row: MoneyException) {
	if (row.amount === null || !Number.isFinite(Number(row.amount)) || !/^[A-Z]{3}$/.test(row.currency || "")) return "";
	return new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency! }).format(Number(row.amount));
}
function nextStep(row: MoneyException) {
	if (row.kind === "charge_callback") return "Review the source update. Do not take payment for this order again.";
	if (row.origin === "browser") return row.next_action_key;
	return "Review the existing record and its history before retrying. Do not create a replacement transaction.";
}
const sourceLabel = (state: string) => state === "supported" ? "Checked" : state === "error" ? "Could not check" : "Not enabled or unavailable";
const documentAction = (action: ExceptionAction) => ["open_document", "open_fiscal"].includes(action.type);
const documentHref = (row: MoneyException, action: ExceptionAction) => exceptionDocumentHref(action.doctype || row.document?.doctype, action.name || row.document?.name);
function visibleActions(row: MoneyException) {
	const supported = new Set(["open_document", "open_fiscal", "open_payments", "open_recargas", "open_offline_status", "open_saved_work", "retry_saved_queue"]);
	return row.actions.filter((action, index, all) => supported.has(action.type) && all.findIndex(other => other.type === action.type) === index
		&& (!documentAction(action) || !!documentHref(row, action))
		&& (action.type !== "retry_saved_queue" || row.origin === "browser"));
}
const actionLabel = (action: ExceptionAction) => ({
	open_document: "Open source record", open_fiscal: "Review fiscal document", open_payments: "Open payments",
	open_recargas: "Open recargas", open_offline_status: "Review terminal and saved work", open_saved_work: "Review saved work",
	retry_saved_queue: "Check all saved work of this type",
} as Record<string, string>)[action.type] || "Review";
const actionDisabled = (action: ExceptionAction) =>
	(["retry_saved_queue", "open_payments", "open_recargas"].includes(action.type) && !online.value) ||
	(["open_payments", "open_recargas"].includes(action.type) && !activeShift.value);
function ownerChanged() {
	if (displayedOwner === JSON.stringify(currentQueueOwner())) return false;
	generation++; rows.value = []; feed.value = null; checkedAt.value = "";
	localChecked.value = false; hasMore.value = false; busy.value = false;
	errors.value = ["The cashier or register changed. Reopen the exception report."];
	return true;
}
function checkSession() { ownerChanged(); }
function guardDocument(event: MouseEvent) {
	if (ownerChanged() || !online.value || isOffline()) event.preventDefault();
}
async function act(row: MoneyException, action: ExceptionAction) {
	if (ownerChanged() || busy.value || actionDisabled(action)) return;
	if (["retry_saved_queue", "open_payments", "open_recargas"].includes(action.type) && isOffline()) return;
	if (action.type === "open_saved_work") { emit("savedWork"); emit("close"); }
	else if (action.type === "open_offline_status") { emit("terminalStatus"); emit("close"); }
	else if (action.type === "open_payments" || action.type === "open_recargas") {
		bus.emit("open_destination", action.type === "open_payments" ? "payments" : "recharge"); emit("close");
	} else if (action.type === "retry_saved_queue" && row.origin === "browser") {
		busy.value = true;
		let failed = false;
		try { await useSyncStore().drainEntityQueue(row.entity_type as any); }
		catch { failed = true; }
		finally { await refresh(); }
		if (failed) errors.value.push("Saved work could not be checked. Keep the original request and review its status before retrying.");
	}
}

watch(profile, () => { void refresh(); });
watch(online, () => { void refresh(); });
watch(() => props.posProfile?.name, name => { if (name && name !== profile.value) profile.value = name; });
onMounted(async () => {
	window.addEventListener("focus", checkSession);
	document.addEventListener("visibilitychange", checkSession);
	await initPromise;
	if (disposed) return;
	if (!profile.value) profile.value = props.posProfile?.name || memory.pos_opening_storage?.pos_profile?.name || "";
	void refresh();
	if (!activeShift.value && online.value) {
		try {
			const response = await window.frappe.call({ method: "frappe.client.get_list", args: { doctype: "POS Profile", fields: ["name"], filters: { disabled: 0 }, limit_page_length: 100 } });
			profiles.value = (response.message || []).map((row: any) => row.name);
		} catch { /* The explicit profile/server warning remains visible. */ }
	}
});
onBeforeUnmount(() => {
	disposed = true;
	generation++;
	window.removeEventListener("focus", checkSession);
	document.removeEventListener("visibilitychange", checkSession);
});
</script>

<style scoped>
.money-exceptions { color: var(--pos-text-primary); }
.money-exceptions__header, .money-exceptions__toolbar, .money-exceptions__row-head, .money-exceptions__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.money-exceptions__header { justify-content: space-between; white-space: normal; }
.money-exceptions h2 { font-size: 1.25rem; }
.money-exceptions h3 { font-size: 1rem; }
.money-exceptions__body { display: grid; gap: 14px; }
.money-exceptions__toolbar > :first-child { flex: 1; min-width: 180px; }
.money-exceptions__row { padding: 16px; border: 1px solid var(--pos-border); border-radius: 12px; display: grid; gap: 8px; }
.money-exceptions__row-head strong { margin-inline-start: auto; }
.money-exceptions__muted { color: var(--pos-text-secondary); font-size: .85rem; }
.money-exceptions__identity { overflow-wrap: anywhere; }
.money-exceptions__next { font-weight: 500; }
.money-exceptions__actions a { color: var(--pos-primary); min-height: 44px; display: inline-flex; align-items: center; }
.money-exceptions__actions a[aria-disabled] { opacity: .5; cursor: not-allowed; }
.money-exceptions__actions :deep(button), .money-exceptions__header :deep(button) { min-height: 44px; }
.money-exceptions__actions :deep(button) { max-width: 100%; height: auto; padding-block: 8px; white-space: normal; }
.money-exceptions__actions :deep(.v-btn__content) { white-space: normal; overflow-wrap: anywhere; }
.money-exceptions__coverage { padding-block: 10px; border-top: 1px solid var(--pos-border); }
.money-exceptions__coverage summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }
.money-exceptions__coverage p { padding-block: 4px; }
</style>
