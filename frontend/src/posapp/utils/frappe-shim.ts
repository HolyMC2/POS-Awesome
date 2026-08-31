/**
 * `frappe` global shim for the POSAwesome SPA when running outside
 * the Frappe Desk shell (web route `/posapp`).
 *
 * The Desk shell sets up `(window as any).frappe` with hundreds of helpers
 * (formatters, ui widgets, route stack, search, model layer, etc.).
 * The POS only reads a small subset; this shim implements that
 * subset against the public `/api/method/...` HTTP surface + a
 * direct `socket.io-client` connection.
 *
 * Surface implemented (audited from `git grep frappe\\.`):
 *
 *   frappe.call({method, args, type, freeze, callback, error})
 *   frappe._(text, args?)            translation lookup against boot.__messages
 *   frappe.show_alert({message, indicator}, seconds?) → toast
 *   frappe.msgprint({message, title, indicator}|string)  → toast
 *   frappe.throw(message)            throws an Error
 *   frappe.provide(path)             ensures nested namespace exists
 *
 *   frappe.session.user
 *   frappe.session.user_fullname
 *
 *   frappe.boot.*                    seeded from window.posawesome_boot
 *   frappe.csrf_token                from window.posawesome_csrf_token
 *
 *   frappe.datetime.nowdate()        ISO yyyy-mm-dd
 *
 *   frappe.realtime.on(event, cb)    socket.io-client direct
 *   frappe.realtime.off(event, cb?)
 *   frappe.realtime.emit(event, …args)
 *   frappe.realtime.socket           the underlying socket
 *
 *   frappe.client.get_list(opts)     /api/method/frappe.client.get_list
 *   frappe.client.get_value(opts)    /api/method/frappe.client.get_value
 *   frappe.client.get(doctype,name)  /api/resource/<doctype>/<name>
 *   frappe.db.get_doc(...)           alias of frappe.client.get
 *
 *   frappe.defaults.get_default(k)
 *   frappe.defaults.get_user_default(k)
 *
 *   frappe.urllib.get_base_url()     window.location.origin
 *   frappe.urllib.get_full_url(p)    window.location.origin + p
 *
 *   frappe.utils.flt(value, prec?)
 *   frappe.utils.is_rtl()
 *   frappe.utils.strip_html(html)
 *   frappe.utils.play_sound(name)
 *
 *   frappe.set_route(route)          window.location for now (no Desk router)
 *
 *   frappe.ui.Dialog                 minimal DOM-modal (HTML/Select fields,
 *                                    primary_action, onhide, $wrapper) — the
 *                                    two SPA call sites only
 *
 * Not implemented:
 *
 *   frappe.www.printview             print — handled separately
 *   frappe.desk.search               (the search_link SERVER method works via
 *                                    frappe.call; only the Desk widget is absent)
 */

import { trackApiTiming } from "./telemetry";

declare global {
	interface Window {
		posawesome_boot?: any;
		posawesome_csrf_token?: string;
		posawesome_build_version?: string;
		posawesome_site_name?: string;
	}
}

type CallOpts = {
	method: string;
	args?: Record<string, unknown>;
	type?: "GET" | "POST";
	freeze?: boolean;
	callback?: (response: any) => void;
	error?: (err: any) => void;
};

const SHIM_INSTALLED_KEY = "__posa_shim_installed";

function nowDateIso(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${dd}`;
}

// Mirror Desk's `frappe.datetime.obj_to_str` — coerces a JS Date,
// moment-like object, or ISO string into MariaDB DATETIME format
// (`YYYY-MM-DD HH:mm:ss`, local time, no timezone suffix). Desk's
// implementation feeds the value through `frappe.boot.lang`-aware
// moment helpers; the SPA only needs the string format so we
// reimplement directly without pulling moment into the bundle.
function objToStr(value: unknown): string {
	if (value === null || value === undefined || value === "") return "";
	let d: Date;
	if (value instanceof Date) {
		d = value;
	} else if (typeof value === "string") {
		// Already a Frappe-shaped date string → pass through.
		if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(value)) {
			return value.length === 10 ? `${value} 00:00:00` : value;
		}
		d = new Date(value);
	} else if (
		typeof value === "object" &&
		value !== null &&
		typeof (value as any).toDate === "function"
	) {
		// moment-like: { toDate(): Date }
		d = (value as any).toDate();
	} else {
		return "";
	}
	if (Number.isNaN(d.getTime())) return "";
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mi = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${dd} ${hh}:${mi}:${ss}`;
}

// Inverse of obj_to_str. Returns null on parse failure so callers
// don't blow up with NaN-date side-effects.
function strToObj(value: unknown): Date | null {
	if (!value) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value !== "string") return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

function getCsrfToken(): string {
	return (
		(typeof window !== "undefined" && window.posawesome_csrf_token) || ""
	);
}

// Extract the human-readable text Frappe puts in `_server_messages` on a
// thrown response. Desk surfaces this; the SPA was showing the bare
// `HTTP 417` status instead because the shim ignored it. `_server_messages`
// is a JSON-encoded array of JSON-encoded `{message,title}` objects, so it
// needs two parse passes. Mirrors `extractServerMessage` in services/api.ts.
function extractServerMessage(payload: any): string | null {
	const serverMessages = payload?._server_messages || payload?.server_messages;
	if (!serverMessages) {
		return null;
	}
	// ERPNext emits a benign POS toast ("Payment methods refreshed…", orange)
	// on every POS draft (posawesome leaves is_created_using_pos=0 by design).
	// It lands FIRST in _server_messages, so picking parsed[0] surfaced it as
	// the Error.message — masking the real failure (CFDI/stock/account). Skip
	// the benign toast + info-level messages; surface the real error-level one.
	const BENIGN = /Payment methods refreshed/i;
	const INFO = new Set(["orange", "yellow", "blue", "green"]);
	try {
		const parsed = JSON.parse(serverMessages);
		if (Array.isArray(parsed) && parsed.length) {
			const deferred: string[] = [];
			for (const entry of parsed) {
				let text = "";
				let indicator = "";
				if (typeof entry === "string") {
					try {
						const obj = JSON.parse(entry);
						text = obj.message || obj.title || entry;
						indicator = (obj.indicator || "").toLowerCase();
					} catch {
						text = entry;
					}
				} else if (entry && typeof entry === "object") {
					text = entry.message || entry.title || "";
					indicator = (entry.indicator || "").toLowerCase();
				}
				text = (text || "").trim();
				if (!text || BENIGN.test(text)) continue;
				if (INFO.has(indicator)) {
					deferred.push(text);
					continue;
				}
				return text;
			}
			if (deferred.length) return deferred[0] ?? null;
			return null;
		}
	} catch {
		return String(serverMessages);
	}
	return null;
}

// Strip HTML tags Frappe wraps validation messages in (e.g. bold item
// names) so the toast shows clean text.
function stripHtml(s: string): string {
	return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ALL displayable `_server_messages` entries (not just the first error like
// extractServerMessage): Desk's frappe.call renders every entry regardless of
// HTTP status, so messages riding a 200 (backend frappe.msgprint without a
// throw — e.g. the payment-reconcile errors table) must reach the operator on
// the web route too, or they exist only on Desk.
function collectServerMessages(payload: any): Array<{ text: string; indicator: string }> {
	const serverMessages = payload?._server_messages || payload?.server_messages;
	if (!serverMessages) return [];
	const BENIGN = /Payment methods refreshed/i;
	const out: Array<{ text: string; indicator: string }> = [];
	try {
		const parsed = JSON.parse(serverMessages);
		if (!Array.isArray(parsed)) return [];
		for (const entry of parsed) {
			let text = "";
			let indicator = "";
			if (typeof entry === "string") {
				try {
					const obj = JSON.parse(entry);
					text = obj.message || obj.title || entry;
					indicator = (obj.indicator || "").toLowerCase();
				} catch {
					text = entry;
				}
			} else if (entry && typeof entry === "object") {
				text = entry.message || entry.title || "";
				indicator = (entry.indicator || "").toLowerCase();
			}
			text = (text || "").trim();
			if (!text || BENIGN.test(text)) continue;
			out.push({ text, indicator });
		}
	} catch {
		const text = String(serverMessages).trim();
		if (text) out.push({ text, indicator: "" });
	}
	return out;
}

async function frappeCall(
	opts: CallOpts | string,
	posArgs?: Record<string, unknown>,
	callback?: (response: any) => void,
	errback?: (err: any) => void,
): Promise<any> {
	// Desk's `frappe.call` accepts two shapes:
	//   1. `frappe.call({ method, args, callback, error, type, freeze })`
	//   2. `frappe.call("posawesome.api.foo", { arg1: 1 }, callback?, error?)`
	// The SPA uses both. Normalize before issuing the fetch — the
	// positional form was missing args entirely and the server saw
	// `user=undefined`, causing the check_opening_shift 500.
	let o: CallOpts;
	if (typeof opts === "string") {
		o = { method: opts, args: posArgs, callback, error: errback };
	} else {
		o = { ...opts };
	}
	const method = o.method;
	const __t0 =
		typeof performance !== "undefined" ? performance.now() : Date.now();
	const __emitTiming = (ok: boolean): void => {
		try {
			const now =
				typeof performance !== "undefined" ? performance.now() : Date.now();
			trackApiTiming(method, ok, now - __t0);
		} catch {
			/* telemetry must never throw */
		}
	};
	const type = (o.type || "POST").toUpperCase();
	const headers: Record<string, string> = {
		"X-Frappe-CSRF-Token": getCsrfToken(),
		"X-Requested-With": "XMLHttpRequest",
	};

	let url = `/api/method/${method}`;
	let body: BodyInit | undefined;

	// Desk's frappe.call serializes null/undefined as empty strings,
	// not as missing keys. Several SPA call sites pass `supplier: null`
	// expecting the server to receive `supplier=""`; if we drop the key
	// the server raises `TypeError: missing positional` (500).
	const encode = (v: unknown): string => {
		if (v === null || v === undefined) return "";
		return typeof v === "string" ? v : JSON.stringify(v);
	};
	if (type === "GET") {
		const qs = new URLSearchParams();
		Object.entries(o.args || {}).forEach(([k, v]) => {
			qs.set(k, encode(v));
		});
		const q = qs.toString();
		if (q) url += `?${q}`;
	} else {
		const params = new URLSearchParams();
		Object.entries(o.args || {}).forEach(([k, v]) => {
			params.set(k, encode(v));
		});
		body = params.toString();
		headers["Content-Type"] = "application/x-www-form-urlencoded";
	}

	let response: Response;
	try {
		response = await fetch(url, {
			method: type,
			credentials: "same-origin",
			headers,
			body,
		});
	} catch (networkErr) {
		__emitTiming(false);
		if (o.error) o.error(networkErr);
		throw networkErr;
	}

	let data: any = null;
	try {
		data = await response.json();
	} catch {
		data = null;
	}

	if (!response.ok) {
		__emitTiming(false);
		// Surface Frappe's real thrown message instead of the bare status.
		// Priority: _server_messages (the validation/throw text Desk shows)
		// → _error_message → message → "HTTP <status>". Without this an
		// operator hitting a server-side validate throw (e.g. "Valuation
		// Rate missing for Item …" on close-shift) only saw "HTTP 417" and
		// couldn't tell what to fix.
		const serverMsg = data ? extractServerMessage(data) : null;
		const errMessage =
			(serverMsg && stripHtml(serverMsg)) ||
			(data && (data._error_message || data.message)) ||
			`HTTP ${response.status}`;
		const err = new Error(errMessage);
		(err as any).response = data;
		(err as any).status = response.status;
		(err as any).serverMessage = serverMsg || null;
		// Frappe's `frappe.call` contract is callback-OR-promise, not
		// both. When the caller passed an `error` callback (e.g.
		// api.callEnvelope wraps every error path into the envelope
		// settle), the throw here ALSO rejects the promise — landing
		// in window.onunhandledrejection AFTER the envelope already
		// resolved. That noise polluted `crash:unhandledrejection`
		// telemetry + console with "Uncaught (in promise) Error: HTTP
		// 403/417" lines for errors that were already handled cleanly.
		// Honor the contract: if `error` callback fired, swallow the
		// throw — the caller chose the callback path.
		if (o.error) {
			o.error(err);
			return null;
		}
		throw err;
	}

	// Success responses can still carry _server_messages (backend
	// frappe.msgprint without a throw). Desk renders them; the shim must
	// too, or those messages exist only on Desk (bit prod: reconcile-error
	// tables invisible on /posapp). msgprint is toast-bound after mount.
	for (const m of collectServerMessages(data)) {
		try {
			(window as any).frappe?.msgprint?.({
				message: stripHtml(m.text),
				indicator: m.indicator || "blue",
			});
		} catch {
			// Surfacing must never break the call itself.
		}
	}

	if (o.callback) {
		try {
			o.callback(data);
		} catch (cbErr) {
			console.warn("[POSA][shim] callback raised", cbErr);
		}
	}
	__emitTiming(true);
	return data;
}

function makeRealtime() {
	let socket: any = null;
	const handlers = new Map<string, Set<(...args: any[]) => void>>();

	async function ensureSocket(): Promise<any> {
		if (socket) return socket;
		// Prefer the runtime `window.io` (the socket.io server
		// auto-serves a matching client at /socket.io/socket.io.js,
		// which the web-route template loads BEFORE this entry
		// runs). Fall back to a dynamic import only when running
		// inside the Desk shell where `io` may not have been
		// pre-loaded — Vite's `external: ["socket.io-client"]`
		// keeps the dynamic import out of the bundle.
		let ioFactory: any = (window as any).io;
		if (!ioFactory) {
			try {
				const mod: any = await import(
					/* @vite-ignore */ "socket.io-client"
				);
				ioFactory = mod.io || mod.default || mod;
			} catch {
				console.warn(
					"[POSA][shim] socket.io-client unavailable; realtime disabled",
				);
				return null;
			}
		}
		const siteName =
			(typeof window !== "undefined" && window.posawesome_site_name) || "";
		const namespace = siteName ? `/${siteName}` : "";
		const url = `${window.location.origin}${namespace}`;
		// Mirror Desk's `socketio_client.js` connection options
		// (apps/frappe/frappe/public/js/frappe/socketio_client.js).
		// Earlier this shim forced `transports: ["websocket"]` which
		// works on Desk's localhost dev server but failed silently
		// behind nginx/Frappe-Cloud proxies that didn't forward the
		// WebSocket Upgrade header for the /socket.io/ path → socket
		// stayed `connected:false` forever, so every realtime event
		// the SPA waited on timed out (45 s waitForPostSubmitPayments
		// gap before print). Defaulting transports lets engine.io
		// negotiate polling-first → WS upgrade, identical to Desk.
		// No `reconnectionAttempts` cap: socket.io defaults to Infinity (it backs
		// off exponentially, so it does not hammer), which is what Desk uses. An
		// earlier cap of 3 (~8s of trying) meant a till in the FOREGROUND on a
		// wifi whose uplink flaps — navigator.onLine stays true, the tab stays
		// visible, so no `online`/`visibilitychange` re-arm fires — burned its
		// three attempts and the socket was dead for the rest of the shift:
		// waitForInvoiceProcessed then takes its optimistic early-return, submit
		// errors never toast, and stock broadcasts stop (audit RUNTIME-F3).
		const ioOpts: Record<string, unknown> = {
			withCredentials: true,
		};
		if (window.location.protocol === "https:") {
			ioOpts.secure = true;
		}
		socket = ioFactory(url, ioOpts);
		// Re-attach all pending handlers when the socket settles.
		for (const [event, set] of handlers.entries()) {
			set.forEach((cb) => socket.on(event, cb));
		}
		// Surface connect-time errors. Earlier the silent
		// `connected:false` state was invisible because no
		// `connect_error` listener was attached.
		socket.on("connect_error", (err: any) => {
			console.warn(
				"[POSA][shim] socket connect_error:",
				err?.message || err,
			);
		});
		return socket;
	}

	return {
		get socket() {
			return socket;
		},
		on(event: string, cb: (...args: any[]) => void) {
			let set = handlers.get(event);
			if (!set) {
				set = new Set();
				handlers.set(event, set);
			}
			set.add(cb);
			ensureSocket().then((s) => {
				if (s) s.on(event, cb);
			});
		},
		off(event: string, cb?: (...args: any[]) => void) {
			const set = handlers.get(event);
			if (set) {
				if (cb) set.delete(cb);
				else set.clear();
			}
			if (socket) {
				if (cb) socket.off(event, cb);
				else socket.off(event);
			}
		},
		emit(event: string, ...args: any[]) {
			ensureSocket().then((s) => {
				if (s) s.emit(event, ...args);
			});
		},
	};
}

function makeClient() {
	return {
		async get_list(opts: any) {
			return (
				await frappeCall({
					method: "frappe.client.get_list",
					type: "GET",
					args: opts,
				})
			)?.message;
		},
		async get_value(opts: any) {
			return (
				await frappeCall({
					method: "frappe.client.get_value",
					type: "GET",
					args: opts,
				})
			)?.message;
		},
		async get(doctype: string, name: string) {
			const url = `/api/resource/${encodeURIComponent(
				doctype,
			)}/${encodeURIComponent(name)}`;
			const res = await fetch(url, {
				credentials: "same-origin",
				headers: { "X-Frappe-CSRF-Token": getCsrfToken() },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return (await res.json()).data;
		},
	};
}

function makeUtils() {
	function flt(value: unknown, precision?: number): number {
		const n = parseFloat(String(value ?? 0));
		if (!Number.isFinite(n)) return 0;
		if (precision == null) return n;
		const p = Math.max(0, Math.floor(precision));
		return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
	}
	function strip_html(html: unknown): string {
		const s = String(html ?? "");
		const div = document.createElement("div");
		div.innerHTML = s;
		return div.textContent || "";
	}
	function is_rtl(lang?: string): boolean {
		const l = (lang || ((window as any).frappe?.boot?.lang ?? "en")).toLowerCase();
		return ["ar", "he", "fa", "ur", "yi"].includes(l);
	}
	function play_sound(name: string) {
		try {
			const url = `/assets/frappe/sounds/${encodeURIComponent(name)}.mp3`;
			new Audio(url).play().catch(() => {});
		} catch {
			// Ignore — sounds are best-effort.
		}
	}
	return { flt, strip_html, is_rtl, play_sound };
}

function makeDefaults(boot: any) {
	const sysdefaults: Record<string, any> = boot?.sysdefaults || {};
	return {
		get_default(key: string) {
			return sysdefaults[key];
		},
		get_user_default(key: string) {
			return sysdefaults[key];
		},
	};
}

function makeUrllib() {
	return {
		get_base_url() {
			return window.location.origin;
		},
		get_full_url(path: string) {
			if (!path) return window.location.origin;
			if (path.startsWith("http")) return path;
			return window.location.origin + (path.startsWith("/") ? path : "/" + path);
		},
	};
}

function makeI18n(boot: any) {
	const messages: Record<string, string> =
		(boot && boot.__messages) || {};
	function _t(text: string): string {
		return messages[text] || text;
	}
	return _t;
}

function provide(path: string) {
	const f: any = (window as any).frappe;
	if (!f) return;
	const parts = String(path || "").split(".");
	let cur: any = f;
	for (let i = 1; i < parts.length; i++) {
		const key = parts[i];
		if (!key) continue;
		if (!cur[key]) cur[key] = {};
		cur = cur[key];
	}
	return cur;
}

type ShimDialogField = {
	fieldtype?: string;
	fieldname?: string;
	label?: string;
	options?: string;
	reqd?: boolean | number;
};
type ShimDialogOpts = {
	title?: string;
	fields?: ShimDialogField[];
	primary_action_label?: string;
	primary_action?: (values: Record<string, string>) => void;
	secondary_action_label?: string;
	secondary_action?: () => void;
};

// Minimal `frappe.ui.Dialog` for the /posapp web route. Desk's Dialog has a
// huge API; the SPA only ever constructs it in TWO utilities —
// `itemSelectionDialog` (HTML field + jQuery `$wrapper.find().on()`) and
// `useItemBatchSerial` (Select field + `primary_action(values)` + `onhide`).
// The previous shim THREW, so barcode-disambiguation + batch/serial entry
// crashed on /posapp. Implement exactly that surface as a themed DOM modal
// (styled via the --pos-* vars, which resolve from :root in theme.css) so the
// call sites work unchanged outside Desk.
function makeDialogClass(): any {
	const S = {
		overlay:
			"position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;" +
			"align-items:center;justify-content:center;z-index:99999;",
		box:
			"background:var(--pos-card-bg,#fff);color:var(--pos-text-primary,#212121);" +
			"border:1px solid var(--pos-border,#e0e0e0);border-radius:8px;min-width:320px;" +
			"max-width:90vw;max-height:85vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.35);",
		header:
			"font-size:18px;font-weight:600;padding:16px 20px;" +
			"border-bottom:1px solid var(--pos-border,#e0e0e0);",
		body: "padding:16px 20px;",
		label:
			"display:block;margin-bottom:6px;font-size:13px;color:var(--pos-text-secondary,#666);",
		field:
			"width:100%;padding:8px;border:1px solid var(--pos-border,#ccc);border-radius:6px;" +
			"background:var(--pos-card-bg,#fff);color:var(--pos-text-primary,#212121);font-size:14px;",
		footer:
			"padding:12px 20px;border-top:1px solid var(--pos-border,#e0e0e0);" +
			"display:flex;justify-content:flex-end;gap:8px;",
		btnPrimary:
			"padding:8px 16px;background:var(--pos-primary,#0097a7);color:#fff;border:none;" +
			"border-radius:6px;cursor:pointer;font-size:14px;",
		btnSecondary:
			"padding:8px 16px;background:transparent;color:var(--pos-text-primary,#212121);" +
			"border:1px solid var(--pos-border,#ccc);border-radius:6px;cursor:pointer;font-size:14px;",
	};

	return class ShimDialog {
		opts: ShimDialogOpts;
		onhide: (() => void) | null = null;
		wrapper: HTMLElement;
		$wrapper: any;
		private body: HTMLElement;
		private inputs: Record<string, HTMLSelectElement | HTMLInputElement> = {};
		private visible = false;

		constructor(opts: ShimDialogOpts) {
			this.opts = opts || {};
			const overlay = document.createElement("div");
			overlay.setAttribute("style", S.overlay);
			const box = document.createElement("div");
			box.setAttribute("style", S.box);

			const header = document.createElement("div");
			header.setAttribute("style", S.header);
			header.textContent = this.opts.title || "";
			box.appendChild(header);

			this.body = document.createElement("div");
			this.body.setAttribute("style", S.body);
			(this.opts.fields || []).forEach((f) => this.renderField(f));
			box.appendChild(this.body);

			const footer = document.createElement("div");
			footer.setAttribute("style", S.footer);
			if (this.opts.secondary_action_label) {
				const sb = document.createElement("button");
				sb.setAttribute("style", S.btnSecondary);
				sb.textContent = this.opts.secondary_action_label;
				sb.addEventListener("click", () => {
					if (this.opts.secondary_action) this.opts.secondary_action();
					this.hide();
				});
				footer.appendChild(sb);
			}
			const pb = document.createElement("button");
			pb.setAttribute("style", S.btnPrimary);
			pb.textContent = this.opts.primary_action_label || "OK";
			pb.addEventListener("click", () => this.onPrimary());
			footer.appendChild(pb);
			box.appendChild(footer);

			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) this.hide();
			});
			overlay.appendChild(box);
			this.wrapper = overlay;

			const jq = (window as any).$ || (window as any).jQuery;
			this.$wrapper = jq ? jq(box) : null;
		}

		private renderField(f: ShimDialogField) {
			const ft = f.fieldtype || "Data";
			if (ft === "HTML") {
				const div = document.createElement("div");
				div.innerHTML = f.options || "";
				this.body.appendChild(div);
				return;
			}
			if (f.label) {
				const lbl = document.createElement("label");
				lbl.setAttribute("style", S.label);
				lbl.textContent = f.label;
				this.body.appendChild(lbl);
			}
			if (ft === "Select") {
				const sel = document.createElement("select");
				sel.setAttribute("style", S.field);
				if (f.reqd) sel.dataset.reqd = "1";
				(f.options || "")
					.split("\n")
					.map((o) => o.trim())
					.filter(Boolean)
					.forEach((o) => {
						const opt = document.createElement("option");
						opt.value = o;
						opt.textContent = o;
						sel.appendChild(opt);
					});
				this.body.appendChild(sel);
				if (f.fieldname) this.inputs[f.fieldname] = sel;
				return;
			}
			const inp = document.createElement("input");
			inp.type = "text";
			inp.setAttribute("style", S.field);
			if (f.reqd) inp.dataset.reqd = "1";
			this.body.appendChild(inp);
			if (f.fieldname) this.inputs[f.fieldname] = inp;
		}

		get_values(): Record<string, string> {
			const v: Record<string, string> = {};
			Object.entries(this.inputs).forEach(([k, el]) => {
				v[k] = el.value;
			});
			return v;
		}

		private onPrimary() {
			for (const el of Object.values(this.inputs)) {
				if (el.dataset && el.dataset.reqd === "1" && !el.value) {
					el.style.outline = "2px solid #d32f2f";
					return;
				}
			}
			if (this.opts.primary_action) this.opts.primary_action(this.get_values());
		}

		show() {
			if (this.visible) return;
			document.body.appendChild(this.wrapper);
			this.visible = true;
		}

		hide() {
			if (!this.visible) return;
			this.visible = false;
			if (this.wrapper.parentNode) {
				this.wrapper.parentNode.removeChild(this.wrapper);
			}
			if (typeof this.onhide === "function") {
				try {
					this.onhide();
				} catch {
					/* onhide must not break teardown */
				}
			}
		}
	};
}

/**
 * Install the shim on (window as any).frappe. Idempotent.
 *
 * The toast / msgprint integration is wired by the SPA itself
 * later (it calls back into our toastStore). The shim only needs
 * to expose stub functions that the SPA can override post-mount.
 */
export function installFrappeShim() {
	if (typeof window === "undefined") return;
	if ((window as any)[SHIM_INSTALLED_KEY]) return;
	(window as any)[SHIM_INSTALLED_KEY] = true;

	const boot = window.posawesome_boot || {};
	const t = makeI18n(boot);

	const frappe: any = {
		boot,
		csrf_token: getCsrfToken(),
		session: {
			user: boot.user || "Guest",
			user_fullname: boot.user_fullname || boot.user || "",
		},
		datetime: {
			nowdate: nowDateIso,
			now_date: nowDateIso,
			get_today: nowDateIso,
			obj_to_str: objToStr,
			str_to_obj: strToObj,
		},
		call: frappeCall,
		realtime: makeRealtime(),
		client: makeClient(),
		db: {} as any,
		utils: makeUtils(),
		urllib: makeUrllib(),
		defaults: makeDefaults(boot),
		_(text: string) {
			return t(text);
		},
		throw(message: string) {
			throw new Error(message);
		},
		provide(path: string) {
			return provide(path);
		},
		set_route(...args: any[]) {
			// Desk's route stack doesn't exist here. Best-effort
			// fallback: navigate to /app/<route> if the caller passed
			// a doctype path; otherwise no-op.
			const path = args
				.map((a) => (typeof a === "string" ? a : ""))
				.filter(Boolean)
				.join("/");
			if (path) window.location.href = "/app/" + path;
		},
		show_alert(opts: any, _seconds?: number) {
			// Stubbed at install time — `posapp.bundle.ts` overrides
			// this once the toastStore is constructed.
			console.info(
				"[POSA][shim] show_alert (pre-toast)",
				typeof opts === "string" ? opts : opts?.message,
			);
		},
		msgprint(opts: any) {
			console.info(
				"[POSA][shim] msgprint (pre-toast)",
				typeof opts === "string" ? opts : opts?.message,
			);
		},
		ui: {
			// Minimal DOM-modal Dialog (HTML + Select fields, primary_action,
			// onhide, jQuery $wrapper) — enough for the SPA's two call sites.
			Dialog: makeDialogClass(),
			set_theme(_theme: string) {
				/* no-op outside Desk */
			},
		},
		www: {
			printview: {
				get_url(_doc: any, format?: string) {
					// Best-effort: route to the standard print page.
					const f = encodeURIComponent(format || "Standard");
					return `/printview?format=${f}`;
				},
			},
		},
	};

	frappe.db.get_doc = (doctype: string, name: string) =>
		frappe.client.get(doctype, name);
	// Desk exposes a subset of client helpers under both `frappe.client.*`
	// (server) and `frappe.db.*` (client). SPA call sites reach for
	// either — proxy db.* through client.* so both work.
	// Desk's `frappe.db.get_list` is overloaded:
	//   - `frappe.db.get_list({ doctype, ...opts })`  (object form)
	//   - `frappe.db.get_list("Customer Group", { fields: [...] })` (positional)
	// The SPA uses both. Without the positional handling, the doctype
	// string gets spread one character at a time into the query string
	// (`?0=C&1=u&2=s&3=t...`) and the server returns 500.
	frappe.db.get_list = (
		doctypeOrOpts: string | Record<string, unknown>,
		extra?: Record<string, unknown>,
	) => {
		const opts =
			typeof doctypeOrOpts === "string"
				? { doctype: doctypeOrOpts, ...(extra || {}) }
				: doctypeOrOpts;
		return frappe.client.get_list(opts);
	};
	frappe.db.get_value = (
		doctype: string,
		filters: Record<string, unknown> | string,
		fieldname: string | string[],
	) => frappe.client.get_value({ doctype, filters, fieldname });

	(window as any).frappe = frappe;
	// Desk's `__()` substitutes `{0}`, `{1}`, ... in the translated string
	// from the args array (frappe/translate.js `substitute_args`). The
	// previous shim discarded args, so error toasts like `"{0} has only
	// {1} in stock"` rendered with literal placeholders on `/posapp` —
	// every translated message with parameters was broken. Mirror the
	// Desk behavior: lookup, then substitute by index.
	(window as any).__ = (text: string, args?: any[]) => {
		const translated = frappe._(text);
		if (!args || !args.length) return translated;
		return translated.replace(/\{(\d+)\}/g, (match: string, idx: string) => {
			const value = args[Number(idx)];
			return value === undefined || value === null ? match : String(value);
		});
	};

	// Desk attaches a handful of formatter/number helpers to window
	// directly (frappe/public/js/frappe/form/formatters.js + utils).
	// SPA modules reference them as free globals (e.g. `flt(value)`,
	// `get_currency_symbol(currency)`); without these the SPA throws
	// `ReferenceError: get_currency_symbol is not defined` at first
	// reactive evaluation in Pos.vue. Mirror just the names the SPA
	// touches today, not the whole Desk surface.
	const utils = frappe.utils;
	const win = window as any;
	if (!win.flt) win.flt = utils.flt;
	if (!win.cint) {
		win.cint = (value: unknown) => {
			const n = parseInt(String(value ?? 0), 10);
			return Number.isFinite(n) ? n : 0;
		};
	}
	if (!win.cstr) win.cstr = (value: unknown) => String(value ?? "");
	if (!win.strip_html) win.strip_html = utils.strip_html;
	if (!win.get_currency_symbol) {
		win.get_currency_symbol = (currency?: string) => {
			const code = String(currency || boot?.sysdefaults?.currency || "USD");
			const symbols = (boot && boot.currency_symbols) || {};
			if (symbols[code]) return symbols[code];
			try {
				const parts = new Intl.NumberFormat(undefined, {
					style: "currency",
					currency: code,
				}).formatToParts(0);
				const sym = parts.find((p) => p.type === "currency");
				return sym ? sym.value : code;
			} catch {
				return code;
			}
		};
	}
	if (!win.format_number) {
		win.format_number = (value: unknown, _format?: string, precision?: number) => {
			const n = utils.flt(value, precision);
			return Number.isFinite(n) ? n.toLocaleString() : String(value ?? "");
		};
	}
	if (!win.format_currency) {
		win.format_currency = (value: unknown, currency?: string, precision?: number) => {
			const code = String(currency || boot?.sysdefaults?.currency || "USD");
			const n = utils.flt(value, precision == null ? 2 : precision);
			try {
				return new Intl.NumberFormat(undefined, {
					style: "currency",
					currency: code,
				}).format(Number.isFinite(n) ? n : 0);
			} catch {
				return `${win.get_currency_symbol(code)} ${n}`;
			}
		};
	}
}

/**
 * Override the placeholder show_alert / msgprint with a real
 * toast handler. Called by `posapp.bundle.ts` once the toastStore
 * is constructed so anything the shim received before mount also
 * gets surfaced.
 */
export function bindFrappeShimToasts(toast: {
	show: (data: { title?: string; detail?: string; color?: string; timeout?: number }) => void;
}) {
	if (typeof window === "undefined" || !(window as any).frappe) return;
	const toColor = (indicator?: string) => {
		const v = (indicator || "").toLowerCase();
		if (["red", "error", "danger"].includes(v)) return "error";
		if (["green", "success"].includes(v)) return "success";
		if (["orange", "yellow", "warning"].includes(v)) return "warning";
		return "info";
	};
	(window as any).frappe.show_alert = (opts: any, seconds = 6) => {
		const data =
			typeof opts === "string"
				? { message: opts }
				: opts || {};
		toast.show({
			title: data.title || data.message || "",
			detail: data.title ? data.message : undefined,
			color: toColor(data.indicator),
			timeout: seconds * 1000,
		});
	};
	(window as any).frappe.msgprint = (opts: any) => {
		const data =
			typeof opts === "string"
				? { message: opts }
				: opts || {};
		toast.show({
			title: data.title || "Notice",
			detail: data.message,
			color: toColor(data.indicator),
			timeout: 0,
		});
	};
}
