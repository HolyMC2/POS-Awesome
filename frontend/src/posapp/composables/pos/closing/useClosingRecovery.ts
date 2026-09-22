import { computed, ref } from "vue";
import { isOffline } from "../../../../offline/db";
import {
	getTerminalCredentials,
	refreshTerminalStatus,
} from "../../../../offline/shiftTerminal";

/** Refresh cached possession proof automatically; human review is always explicit. */
export function useClosingRecovery() {
	const status = ref<any>(null);
	const busy = ref(false);
	const error = ref("");
	const reviewed = ref(false);
	const reason = ref("");
	const ready = computed(
		() =>
			!busy.value &&
			!error.value &&
			status.value?.owned === true &&
			!status.value.recovery_pending &&
			status.value.status === "Open",
	);
	const __ = (text: string) => (window as any).__?.(text) || text;

	async function refresh() {
		busy.value = true;
		error.value = "";
		try {
			if (isOffline())
				throw new Error(
					__(
						"Connect to the internet, then check again. Your count stays on this screen.",
					),
				);
			status.value = await refreshTerminalStatus();
			if (!status.value)
				throw new Error(
					__(
						"The open shift could not be found. Reload the register and try again.",
					),
				);
		} catch (failure) {
			error.value = (failure as Error).message;
		} finally {
			busy.value = false;
		}
	}

	const canRegisterReleased = computed(() =>
		status.value?.status === "Open" && !status.value.owned &&
		!status.value.terminal_id && Number(status.value.terminal_generation) > 0 &&
		!status.value.recovery_pending,
	);

	async function registerReleased() {
		if (busy.value || !canRegisterReleased.value) return;
		const opening = status.value.opening_shift;
		busy.value = true;
		error.value = "";
		try {
			if (isOffline()) throw new Error(__("Connect to the internet, then check again. Your count stays on this screen."));
			status.value = await refreshTerminalStatus();
			if (status.value?.opening_shift !== opening || !canRegisterReleased.value)
				throw new Error(__("The shift changed. Check its status before continuing."));
			await (window as any).frappe.call({
				method: "posawesome.posawesome.api.shift_terminal.claim_terminal",
				args: { opening_shift: opening, ...getTerminalCredentials() },
			});
			status.value = await refreshTerminalStatus();
		} catch (failure) { error.value = (failure as Error).message; }
		finally { busy.value = false; }
	}

	async function recover() {
		if (
			busy.value ||
			!status.value?.can_manage ||
			!reviewed.value ||
			reason.value.trim().length < 8
		)
			return;
		busy.value = true;
		error.value = "";
		try {
			if (isOffline())
				throw new Error(
					__("Connect to the internet before recording the review."),
				);
			const opening = status.value.opening_shift;
			const call = async (action: string) =>
				(window as any).frappe.call({
					method: `posawesome.posawesome.api.shift_terminal.${action}`,
					args: {
						opening_shift: opening,
						...getTerminalCredentials(),
						reason: reason.value.trim(),
						acknowledge_legacy: 1,
						acknowledge_saved_work: 1,
					},
				});
			// Refresh first: another browser may have completed recovery since this screen opened.
			status.value = await refreshTerminalStatus();
			if (
				!status.value ||
				status.value.opening_shift !== opening ||
				status.value.status !== "Open"
			) {
				throw new Error(
					__(
						"The shift changed. Check its status before continuing.",
					),
				);
			}
			if (!status.value.owned) {
				await call(
					status.value.terminal_id
						? "transfer_terminal"
						: "claim_terminal",
				);
				status.value = await refreshTerminalStatus();
			}
			if (status.value?.recovery_pending) {
				await call("resolve_terminal_recovery");
				status.value = await refreshTerminalStatus();
			}
		} catch (failure) {
			error.value = (failure as Error).message;
		} finally {
			busy.value = false;
		}
	}
	return { status, busy, error, reviewed, reason, ready, refresh, recover, canRegisterReleased, registerReleased };
}
