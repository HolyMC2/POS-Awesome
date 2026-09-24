import { getShiftTerminalContext } from "../../../../offline/shiftTerminal";
export const emptyCount = () => ({
	source: "denominations",
	denominations: [] as any[],
	reason: "",
	amount: "",
});
export const amount = (c: any) =>
	c.source === "manual"
		? Number(c.amount) || 0
		: (c.denominations || []).reduce(
				(sum: number, r: any) =>
					sum +
					Math.round(Number(r.value) * 100) * Number(r.quantity),
				0,
			) / 100;
export async function read(method: string, args: any) {
	const result = await (window as any).frappe.call({
		method: `posawesome.posawesome.api.cash_custody.service.${method}`,
		args,
	});
	return result.message;
}
const __ = (message: string) => (window as any).__?.(message) || message;
const recoveryError = () =>
	new Error(
		__(
			"Saved cash recovery details cannot be read. Keep this browser’s data and ask a supervisor to review cash history before continuing.",
		),
	);
function loadRequest(key: string) {
	let raw: string | null;
	try {
		raw = localStorage.getItem(key);
	} catch {
		throw recoveryError();
	}
	if (raw === null) return null;
	try {
		const saved = JSON.parse(raw);
		if (
			typeof saved.body !== "string" ||
			typeof saved.request_id !== "string" ||
			!/^[A-Za-z0-9_-]{16,80}$/.test(saved.request_id)
		)
			throw Error();
		const body = JSON.parse(saved.body);
		if (!body || typeof body !== "object" || Array.isArray(body))
			throw Error();
		return saved;
	} catch {
		throw recoveryError();
	}
}
const prefix = (profile: string) =>
	`cash-custody-request:${(window as any).frappe.session.user}:${profile}:`;
export function pendingActions(
	profile: string,
): { action: string; payload: any }[] {
	const found: { action: string; payload: any }[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (!key?.startsWith(prefix(profile))) continue;
		const saved = loadRequest(key);
		if (!saved) continue;
		found.push({
			action: key.slice(prefix(profile).length),
			payload: JSON.parse(saved.body),
		});
	}
	return found;
}
/** Persist business instructions and request ID; never persist terminal credentials here. */
export async function command(action: string, payload: any) {
	const {
		terminal_token: _terminalToken,
		terminal_generation: _terminalGeneration,
		terminal_id: _terminalId,
		...instructions
	} = payload;
	const key = prefix(instructions.pos_profile) + action;
	const body = JSON.stringify(instructions);
	const pending = loadRequest(key);
	if (pending && pending.body !== body)
		throw Error(
			__(
				"A previous cash action has an unconfirmed result. Use Retry unconfirmed action before starting a different action.",
			),
		);
	const request_id = pending?.request_id || crypto.randomUUID();
	const terminal = instructions.opening_shift
		? getShiftTerminalContext()
		: {};
	try {
		localStorage.setItem(key, JSON.stringify({ body, request_id }));
	} catch {
		throw new Error(
			__(
				"This browser cannot save cash recovery details. No cash action was sent. Enable browser storage and retry.",
			),
		);
	}
	try {
		const result = await read("command", {
			action,
			payload: {
				...instructions,
				request_id,
				...terminal,
			},
		});
		localStorage.removeItem(key);
		return result;
	} catch (error: any) {
		if (
			error?.serverMessage ||
			error?._server_messages ||
			(error?.status && error.status >= 400 && error.status < 500)
		)
			localStorage.removeItem(key);
		throw error;
	}
}

export async function printEvidence(
	doctype: string,
	name: string,
	layout: "slip" | "label" | "ticket" = "slip",
) {
	return printDocument("evidence", { doctype, name, layout });
}

export function printClosingEvidence(closing_shift: string, layout = "ticket") {
	return printDocument("closing_labels", { closing_shift, layout });
}

async function printDocument(method: string, args: Record<string, unknown>) {
	const popup = window.open("", "_blank");
	if (!popup)
		throw Error(__("Allow pop-ups to print cash custody evidence."));
	try {
		const r = await (window as any).frappe.call({
			method: `posawesome.posawesome.api.cash_custody.printing.${method}`,
			args,
		});
		popup.opener = null;
		popup.document.open();
		popup.document.write(r.message);
		popup.document.close();
		popup.focus();
		popup.print();
	} catch (error) {
		popup.close();
		throw error;
	}
}
