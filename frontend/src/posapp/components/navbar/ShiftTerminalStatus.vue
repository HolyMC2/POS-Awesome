<template>
	<div class="shift-terminal-status">
	<section class="offline-status-panel__warning" data-test="shift-terminal-status" v-if="openingName">
		<strong>{{ __("Selling terminal") }}</strong>
		<p>{{ status?.owned ? __("This browser owns the shift.") : __("This shift must be registered to this browser before selling.") }}</p>
		<p v-if="status && !status.owned && !status.can_manage">{{ __("Ask a supervisor to sign in on this replacement browser, authorize your shift, then sign back in here. Saved sales remain with their original cashier.") }}</p>
		<p v-if="status?.recovery_pending">{{ __("Previous-browser sales need manager review before this shift can close. Saved work has not been deleted or reassigned.") }}</p>
		<p v-if="fenced">{{ __("Selling is paused after a closing or release attempt. Check the result, then resume only if the shift is still open.") }}</p>
		<label v-if="!status?.owned || status?.recovery_pending">
			<input type="checkbox" v-model="acknowledged" data-test="terminal-recovery-ack" />
			{{ __("I understand previous browsers may still contain unsynced sales and must be checked.") }}
		</label>
		<label v-if="status?.can_manage && (!status?.owned || status?.recovery_pending)">
			{{ __("Recovery reason or reconciliation record") }}
			<textarea v-model="reason" maxlength="1000" rows="2" data-test="terminal-recovery-reason" />
		</label>
		<div class="offline-status-panel__actions">
			<button @click="refresh" :disabled="busy">{{ __("Check terminal status") }}</button>
			<button v-if="status && !status.terminal_id" @click="act('claim_terminal')" :disabled="busy || !acknowledged" data-test="terminal-claim">{{ __("Register this browser") }}</button>
			<button v-if="status?.owned && !status?.recovery_pending && !fenced" @click="act('release_terminal')" :disabled="busy" data-test="terminal-release">{{ __("Sync complete — release terminal") }}</button>
			<button v-if="status?.owned && fenced" @click="act('resume_terminal')" :disabled="busy" data-test="terminal-resume">{{ __("Resume selling") }}</button>
			<button v-if="status?.can_manage && !status?.owned && status?.terminal_id" @click="act('transfer_terminal')" :disabled="busy || !acknowledged || reason.trim().length < 8" data-test="terminal-transfer">{{ __("Manager: transfer to this browser") }}</button>
			<button v-if="status?.can_manage && status?.recovery_pending" @click="act('resolve_terminal_recovery')" :disabled="busy || !acknowledged || reason.trim().length < 8" data-test="terminal-resolve">{{ __("Manager: record completed review") }}</button>
		</div>
		<p v-if="error" role="alert">{{ error }}</p>
		<TerminalInvoiceRecovery v-if="status?.can_manage" />
	</section>
    <section v-if="managerAllowed" class="offline-status-panel__warning" data-test="manager-terminal-selector">
        <strong>{{ __("Manager: authorize a replacement browser") }}</strong>
        <p>{{ __("Select the cashier's open shift. Authorization uses this browser; afterward the cashier must sign in here. Previous browsers cannot submit new sales.") }}</p>
        <label>{{ __("Cashier shift") }}
            <select v-model="selectedShift" @change="selectManagerShift" data-test="manager-shift-select">
                <option value="">{{ __("Select an open shift") }}</option>
                <option v-for="shift in managerShifts" :key="shift.name" :value="shift.name">{{ shift.user }} — {{ shift.pos_profile }} — {{ shift.name }}</option>
            </select>
        </label>
        <template v-if="selectedShift">
            <label>{{ __("Recovery reason or reconciliation record") }}<textarea v-model="managerReason" maxlength="1000" rows="2" data-test="manager-shift-reason" /></label>
            <label><input type="checkbox" v-model="managerAcknowledged" data-test="manager-shift-ack" />{{ __("I understand previous browsers may still contain unsynced sales and must be checked.") }}</label>
            <button @click="manageSelected('transfer_terminal')" :disabled="busy || !managerAcknowledged || managerReason.trim().length < 8" data-test="manager-shift-transfer">{{ __("Authorize this browser for the selected cashier") }}</button>
            <button v-if="managerStatus?.recovery_pending" @click="manageSelected('resolve_terminal_recovery')" :disabled="busy || !managerAcknowledged || managerReason.trim().length < 8" data-test="manager-shift-resolve">{{ __("Manager: record completed review") }}</button>
            <p v-if="managerStatus?.owned" data-test="manager-shift-handoff">{{ __("This browser is authorized. Sign out and let the selected cashier sign in here. Review saved work before closing their shift.") }}</p>
        </template>
        <p v-if="managerError" role="alert">{{ managerError }}</p>
    </section>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import TerminalInvoiceRecovery from "./TerminalInvoiceRecovery.vue";
import { db, memory, isOffline } from "../../../offline/db";
import { getPendingShiftWorkCount } from "../../../offline/shiftQueueGuard";
import { currentQueueOwner } from "../../../offline/queueOwnership";
import { applyTerminalStatus, getShiftTerminalContext, getTerminalCredentials, refreshTerminalStatus, terminalFenceKey } from "../../../offline/shiftTerminal";

const __ = (window as any).__ || ((value: string) => value);
const openingName = memory.pos_opening_storage?.pos_opening_shift?.name;
const status = ref<any>(memory.pos_opening_storage?.terminal_status || null);
const busy = ref(false);
const fenced = ref(false);
const error = ref("");
const acknowledged = ref(false);
const reason = ref("");
const managerAllowed = ref(false);
const managerShifts = ref<any[]>([]);
const selectedShift = ref("");
const managerStatus = ref<any>(null);
const managerReason = ref("");
const managerAcknowledged = ref(false);
const managerError = ref("");

async function loadManagerShifts() {
    if (isOffline()) return;
    try {
        const response = await (window as any).frappe.call({ method: "posawesome.posawesome.api.shift_terminal.list_manageable_open_shifts" });
        managerAllowed.value = response.message?.can_manage === true;
        managerShifts.value = response.message?.shifts || [];
    } catch (failure) { managerError.value = String((failure as Error).message); }
}
async function selectManagerShift() {
    managerStatus.value = null;
    managerAcknowledged.value = false;
    managerError.value = "";
    if (!selectedShift.value) return;
    try {
        const response = await (window as any).frappe.call({
            method: "posawesome.posawesome.api.shift_terminal.get_terminal_status",
            args: { opening_shift: selectedShift.value, ...getTerminalCredentials() },
        });
        managerStatus.value = response.message;
    } catch (failure) { managerError.value = String((failure as Error).message); }
}
async function manageSelected(action: string) {
    if (isOffline()) { managerError.value = __("Reconnect to manage this terminal."); return; }
    busy.value = true;
    managerError.value = "";
    try {
        const response = await (window as any).frappe.call({
            method: `posawesome.posawesome.api.shift_terminal.${action}`,
            args: { opening_shift: selectedShift.value, ...getTerminalCredentials(),
                reason: managerReason.value, acknowledge_saved_work: Number(managerAcknowledged.value) },
        });
        managerStatus.value = response.message;
        if (selectedShift.value === openingName) { applyTerminalStatus(response.message); await refresh(); }
    } catch (failure) { managerError.value = String((failure as Error).message); }
    finally { busy.value = false; }
}

async function refresh() {
	busy.value = true;
	error.value = "";
	try {
		fenced.value = !!(await db.table("keyval").get(terminalFenceKey(openingName)))?.value;
		if (!isOffline()) status.value = await refreshTerminalStatus();
	} catch (failure) { error.value = String((failure as Error).message); }
	finally { busy.value = false; }
}

async function act(action: string) {
	if (isOffline()) { error.value = __("Reconnect to manage this terminal."); return; }
	busy.value = true;
	error.value = "";
	try {
		const owner = currentQueueOwner();
		const draining = action === "release_terminal" || action === "resume_terminal";
		if (draining && await getPendingShiftWorkCount({ name: openingName }, true)) {
			throw new Error(__("Sync and review all saved sales and cash movements first."));
		}
		const response = await (window as any).frappe.call({
			method: `posawesome.posawesome.api.shift_terminal.${action}`,
			args: { opening_shift: openingName,
				...(draining ? getShiftTerminalContext() : getTerminalCredentials()),
				drained: 1, reason: reason.value, acknowledge_legacy: Number(acknowledged.value),
				acknowledge_saved_work: Number(acknowledged.value) },
		});
		applyTerminalStatus(response.message);
		status.value = await refreshTerminalStatus();
		const keyval = db.table("keyval");
		await db.transaction("rw", keyval, async () => {
			const fence = await keyval.get(terminalFenceKey(openingName));
			const currentOwner = currentQueueOwner();
			if (!owner || !currentOwner || owner.queue_user !== currentOwner.queue_user ||
				owner.queue_profile !== currentOwner.queue_profile ||
				memory.pos_opening_storage?.pos_opening_shift?.name !== openingName) return;
			// Ownership survives closure. Read and conditionally remove the old
			// fence atomically so another tab's new close cannot lose its fence.
			if (status.value?.owned && status.value.opening_shift === openingName && status.value.status === "Open" &&
				status.value.terminal_generation > Number(fence?.value?.generation || 0)) {
				await keyval.delete(terminalFenceKey(openingName));
			}
		});
		await refresh();
	} catch (failure) { error.value = String((failure as Error).message); }
	finally { busy.value = false; }
}

onMounted(() => { if (openingName) void refresh(); void loadManagerShifts(); });
</script>

<style scoped>
.shift-terminal-status,
.shift-terminal-status :deep(section),
.shift-terminal-status :deep(label) {
	display: grid;
	gap: 8px;
	min-width: 0;
}
.shift-terminal-status {
	font-size: 13px;
	line-height: 1.5;
	color: var(--pos-text-primary);
	overflow-wrap: anywhere;
}
.offline-status-panel__warning {
	padding: 12px;
	border: 1px solid var(--pos-border);
	border-radius: 14px;
	background: var(--pos-card-bg);
}
.shift-terminal-status :deep(p) { margin: 0; }
.shift-terminal-status :deep(label:has(input[type="checkbox"])) {
	display: flex;
	align-items: flex-start;
}
.shift-terminal-status :deep(input[type="checkbox"]) {
	margin-top: 4px;
	flex-shrink: 0;
	accent-color: var(--pos-primary);
}
.shift-terminal-status :deep(textarea),
.shift-terminal-status :deep(select) {
	width: 100%;
	min-width: 0;
	min-height: 44px;
	padding: 8px;
	border: 1px solid var(--pos-border);
	border-radius: 8px;
	background: var(--pos-card-bg);
	color: var(--pos-text-primary);
}
.offline-status-panel__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.shift-terminal-status :deep(button) {
	min-height: 44px;
	padding: 8px 12px;
	border: 1px solid var(--pos-border);
	border-radius: 12px;
	background: var(--pos-hover-bg);
	color: var(--pos-text-primary);
	font-weight: 600;
	white-space: normal;
}
.shift-terminal-status :deep(button:disabled) { opacity: 0.5; cursor: not-allowed; }
.shift-terminal-status :deep(:is(button, textarea, select, input):focus-visible) {
	outline: 2px solid var(--pos-primary);
	outline-offset: 2px;
}
.shift-terminal-status :deep([role="alert"]) { font-weight: 600; }
.shift-terminal-status :deep(.offline-status-panel__resource) {
	display: grid;
	gap: 6px;
	padding: 10px;
	border: 1px solid var(--pos-border);
	border-radius: 8px;
}
</style>
