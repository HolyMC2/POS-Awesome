/**
 * Stores and cajas (spec 01). Reads are scoped and paged server-side; commands
 * carry a stable request ID that survives a lost response, so a retry returns
 * the original result instead of executing twice. Terminal secrets are passed
 * through but never persisted with the pending instruction.
 */
const BASE = "posawesome.posawesome.api.register_foundation";
const __ = (text: string) => (window as any).__?.(text) || text;

export type Lifecycle = "Draft" | "Ready" | "Suspended" | "Retired";
export type WorkState = "Available" | "Open" | "Handover" | "Closing" | "Recovery";
export type Connectivity = "Fresh" | "Stale" | "Unknown";

export interface StoreRow {
	name: string;
	store_code: string;
	store_name: string;
	company: string;
	status: string;
	timezone: string;
	revision: string;
	registers: number;
	open: number;
	attention: number;
	can_configure: boolean;
	can_supervise: boolean;
}
export interface StorePage {
	stores: StoreRow[];
	can_create_in: string[];
	as_of: string;
	next_cursor: string | null;
}
export interface CajaRow {
	name: string;
	register_code: string;
	label: string;
	store: string;
	store_code: string;
	store_name: string;
	company: string;
	pos_profile: string;
	mode: "Cash" | "Cashless";
	lifecycle: Lifecycle;
	work_state: WorkState;
	connectivity: Connectivity;
	last_seen_at: string | null;
	opening_shift: string | null;
	cashier: string | null;
	cashier_name: string | null;
	opened_at: string | null;
	is_mine: boolean;
	attention: string[];
	severity: "none" | "info" | "action";
	device_connected: boolean;
	revision: string;
	this_device?: boolean;
	can_open?: boolean;
}
export type CajaFilter = "all" | "attention" | "open" | "available" | "setup";
export interface CajaPage {
	registers: CajaRow[];
	summary: { total: number; open: number; attention: number; setup: number };
	as_of: string;
	coverage: string;
	next_cursor: string | null;
}
export interface ActionDescriptor {
	action_id: string;
	enabled: boolean;
	blocking_reason: string | null;
	required_capability: string | null;
}
export interface ReadinessItem {
	key: string;
	message: string;
	owner: "store" | "register" | "device" | "custody";
}
export interface CajaDetail {
	name: string;
	register_code: string;
	label: string;
	store: string;
	store_name: string;
	store_code: string;
	company: string;
	pos_profile: string;
	mode: "Cash" | "Cashless";
	lifecycle: Lifecycle;
	revision: string;
	configuration_revision: string;
	requires_enrolled_device: boolean;
	work_state: WorkState;
	runtime_revision: string;
	connectivity: Connectivity;
	last_seen_at: string | null;
	shift: null | {
		name: string;
		cashier: string;
		cashier_name: string | null;
		opened_at: string;
		business_date: string;
		status: string;
		recovery_pending: boolean;
		is_mine: boolean;
	};
	device: null | { binding: string; device: string; label: string; generation: string; since: string; last_version: string | null };
	readiness: ReadinessItem[];
	pending_configuration: boolean;
	legacy_profile_route: boolean;
	route_change_approved: boolean;
	actions: ActionDescriptor[];
	capabilities: string[];
	as_of: string;
	drawer_account?: string | null;
	default_safe?: string | null;
}
export interface SetupOptions {
	store: string;
	company: string;
	profiles: string[];
	drawer_accounts: { name: string; account_name: string; conflicts: string[] }[];
	safes: { name: string; title: string; enabled: number }[];
}
export interface CommandError {
	message: string;
	code: string;
	retryable: boolean;
	correlationId: string | null;
	nextActions: string[];
}

async function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
	const result = await (window as any).frappe.call({ method: `${BASE}.${method}`, args });
	return result?.message as T;
}

/** Normalize a rejected call into the server's typed envelope (spec 01 §6). */
export function commandError(error: unknown): CommandError {
	const err = error as any;
	const envelope = err?.response?.posa_error || {};
	const offline = !err?.response && !err?.status;
	return {
		message: offline
			? __("No connection. The action was not confirmed; retry when back online.")
			: String(err?.message || __("The action could not be completed.")),
		code: envelope.code || (offline ? "outcome_unknown" : "validation_failed"),
		retryable: offline || Boolean(envelope.retryable),
		correlationId: envelope.correlation_id || null,
		nextActions: Array.isArray(envelope.next_actions) ? envelope.next_actions : [],
	};
}

function user(): string {
	return (window as any).frappe?.session?.user || "Guest";
}

const PENDING = "posa:caja-command:";

function newRequestId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function storage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/**
 * Reuse the request ID for an identical, still-unconfirmed instruction.
 * The pending record holds business data only — no terminal secret.
 */
export async function command<T>(method: string, key: string, args: Record<string, unknown>,
	secrets: Record<string, unknown> = {}): Promise<T> {
	const store = storage();
	const slot = `${PENDING}${user()}:${method}:${key}`;
	const body = JSON.stringify(args);
	let requestId = newRequestId();
	try {
		const saved = store ? JSON.parse(store.getItem(slot) || "null") : null;
		if (saved && saved.body === body && /^[A-Za-z0-9_-]{16,80}$/.test(saved.request_id)) requestId = saved.request_id;
	} catch {
		/* A corrupt pending record is replaced by a fresh instruction. */
	}
	try {
		store?.setItem(slot, JSON.stringify({ body, request_id: requestId, at: Date.now() }));
	} catch {
		/* Storage may be unavailable; the request still carries its ID. */
	}
	try {
		const result = await call<T>(method, { ...args, ...secrets, request_id: requestId, schema_version: 1 });
		store?.removeItem(slot);
		return result;
	} catch (error) {
		const parsed = commandError(error);
		// Keep the ID only while the outcome is unknown or retryable.
		if (!parsed.retryable) store?.removeItem(slot);
		throw parsed;
	}
}

export const listStores = (cursor?: string | null, search = "") =>
	call<StorePage>("queries.list_stores", { cursor, search });
export const listCajas = (store: string | null, filter: CajaFilter, search: string, cursor?: string | null) =>
	call<CajaPage>("queries.list_registers", { store, filter, search, cursor });
export const cajaDetail = (register: string) => call<CajaDetail>("queries.register_detail", { register });
export const setupOptions = (store: string) => call<SetupOptions>("queries.setup_options", { store });
export const myCajas = (terminal_id?: string) =>
	call<{ registers: CajaRow[]; truncated: boolean; as_of: string }>("queries.my_registers", { terminal_id });

export const createStore = (values: Record<string, unknown>) =>
	command<{ name: string }>("commands.create_store", `new-store:${values.store_code}`, values);
export const createCaja = (store: string, values: Record<string, unknown>) =>
	command<CajaDetail>("commands.create_register", `new:${store}:${values.register_code}`, { store, ...values });
export const configureCaja = (register: string, expected_revision: string, values: Record<string, unknown>) =>
	command<CajaDetail>("commands.configure_register", `configure:${register}:${expected_revision}`,
		{ register, expected_revision, values: JSON.stringify(values) });
export const setLifecycle = (register: string, target: Lifecycle, expected_revision: string, reason?: string) =>
	command<CajaDetail>("commands.set_register_lifecycle", `lifecycle:${register}:${target}`,
		{ register, target, expected_revision, reason });
export const approveRoute = (register: string, expected_revision: string, reason: string) =>
	command<CajaDetail>("commands.approve_route_change", `route:${register}`, { register, expected_revision, reason });
/** Codes are shown once and are not idempotent by design: each call issues a new code. */
export const issueChallenge = (register: string, purpose: "Enroll" | "Replace", extra: Record<string, unknown> = {}) =>
	call<{ code: string; expires_at: string; label: string; store_name: string; purpose: string }>(
		"commands.issue_device_challenge", { register, purpose, ...extra });
export const previewChallenge = (code: string) =>
	call<{ register: string; label: string; register_code: string; store_name: string; store_code: string; purpose: string }>(
		"commands.preview_device_challenge", { code });
export const enrollDevice = (code: string, label: string, credentials: { terminal_id: string; terminal_token: string }) =>
	command<{ register: string; label: string; store_name: string; generation: string; replaced: boolean }>(
		"commands.enroll_device", `enroll:${code.replace(/[\s-]/g, "").toUpperCase()}`, { code, label }, credentials);
export const openCaja = (register: string, balance_details: { mode_of_payment: string; amount: number }[],
	credentials: { terminal_id: string; terminal_token: string }) =>
	command<any>("commands.open_register", `open:${register}`,
		{ register, balance_details: JSON.stringify(balance_details) }, credentials);
export const heartbeat = (register: string, credentials: { terminal_id: string; terminal_token: string }, client_version?: string) =>
	call<{ observed: boolean }>("commands.heartbeat", { register, ...credentials, client_version });
