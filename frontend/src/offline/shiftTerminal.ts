import { db, memory, persist } from "./db";
import { getDeviceIdentifier } from "./deviceIdentity";

const __ = (text: string) => ((globalThis as any).__ || (globalThis as any).frappe?._ || ((value: string) => value))(text);

const SECRET_KEY = "posa_terminal_secret";
const terminalError = () => new Error(__("This browser must own the shift before saving work. Open Offline Status to register or recover this terminal."));

/** Random possession proof stays in this browser; never log it. */
export function getTerminalCredentials() {
	const terminal_id = getDeviceIdentifier();
	let terminal_token = localStorage.getItem(SECRET_KEY);
	if (!terminal_token) {
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		terminal_token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		localStorage.setItem(SECRET_KEY, terminal_token);
	}
	if (!terminal_id || !terminal_token) throw terminalError();
	return { terminal_id, terminal_token };
}

export function getShiftTerminalContext(): { terminal_id?: string; terminal_token?: string; terminal_generation?: number } {
	const opening = memory.pos_opening_storage;
	const shift = opening?.pos_opening_shift;
	if (!shift?.name) return {};
	const credentials = getTerminalCredentials();
	if (!shift.posa_terminal_generation || shift.posa_terminal_id !== credentials.terminal_id ||
		opening.terminal_status?.owned !== true) throw terminalError();
	return { ...credentials, terminal_generation: Number(shift.posa_terminal_generation) };
}

export function terminalFenceKey(shiftName: string) {
	return `posa_terminal_fence:${shiftName}`;
}

/** Called inside the same Dexie transaction as each new monetary queue write. */
export async function assertTerminalEnqueueAllowed(payload: Record<string, any>) {
	const shift = memory.pos_opening_storage?.pos_opening_shift;
	const nested = payload.invoice || payload.args?.payload || payload.payload || payload.args || payload;
	const shiftName = nested.posa_pos_opening_shift || nested.pos_opening_shift || nested.pos_opening_shift_name || shift?.name;
	if (!shiftName) return;
	const fence = await db.table("keyval").get(terminalFenceKey(shiftName));
	if (fence?.value) throw new Error(__("This terminal is closing or being released. Reconnect and check its status before saving more work."));
	if (shift?.name) getShiftTerminalContext();
}

/** Preserve credentials captured when work was created, including old generations. */
export function stampTerminalPayload(payload: Record<string, any>) {
	if (!memory.pos_opening_storage?.pos_opening_shift?.name) return payload;
	const context = getShiftTerminalContext();
	if (payload.invoice) {
		payload.data = { ...context, ...(payload.data || {}) };
	} else {
		const target = payload.args?.payload || payload.payload || payload.args || payload;
		for (const [key, value] of Object.entries(context)) if (target[key] == null) target[key] = value;
	}
	return payload;
}

export function applyTerminalStatus(status: Record<string, any>) {
	const opening = memory.pos_opening_storage;
	if (!opening?.pos_opening_shift || opening.pos_opening_shift.name !== status.opening_shift) return;
	opening.terminal_status = status;
	Object.assign(opening.pos_opening_shift, { posa_terminal_id: status.terminal_id,
		posa_terminal_generation: status.terminal_generation, posa_terminal_recovery_pending: Number(status.recovery_pending) });
	persist("pos_opening_storage");
}

export async function refreshTerminalStatus() {
	const name = memory.pos_opening_storage?.pos_opening_shift?.name;
	if (!name) return null;
	const response = await (globalThis as any).frappe.call({
		method: "posawesome.posawesome.api.shift_terminal.get_terminal_status",
		args: { opening_shift: name, ...getTerminalCredentials() },
	});
	const status = response.message;
	applyTerminalStatus(status);
	return status;
}
