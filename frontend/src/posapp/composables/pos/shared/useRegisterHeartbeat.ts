import { onBeforeUnmount, watch, type Ref } from "vue";
import { heartbeat } from "../../../components/pos/registers/foundationApi";
import { getTerminalCredentials } from "../../../../offline/shiftTerminal";

export const HEARTBEAT_MS = 30_000;
export const HEARTBEAT_JITTER_MS = 5_000;

/**
 * Connectivity observation for a caja shift (spec 02 §4): every 30 s ± 5 s
 * while the tab is visible, paused in background tabs. It reports presence
 * only — the server never grants possession or availability from it, and a
 * failed beat is silently retried on the next tick.
 */
export function useRegisterHeartbeat(openingShift: Ref<any>, clientVersion?: string | null) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let register: string | null = null;

	const stop = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const schedule = () => {
		stop();
		if (!register) return;
		const delay = HEARTBEAT_MS + Math.round((Math.random() * 2 - 1) * HEARTBEAT_JITTER_MS);
		timer = setTimeout(beat, delay);
	};
	async function beat() {
		if (!register) return;
		if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule();
		try {
			await heartbeat(register, getTerminalCredentials(), clientVersion || undefined);
		} catch {
			/* Presence is best-effort; the next tick retries. */
		}
		schedule();
	}
	const onVisibility = () => {
		if (document.visibilityState === "visible" && register) void beat();
	};

	watch(
		() => openingShift.value?.posa_register || null,
		(value) => {
			register = value;
			if (register) void beat();
			else stop();
		},
		{ immediate: true },
	);
	if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
	onBeforeUnmount(() => {
		stop();
		register = null;
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
	});
	return { stop };
}
