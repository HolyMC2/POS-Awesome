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
 * Not implemented (throws if called — surfaces gaps):
 *
 *   frappe.ui.Dialog                 modal — POS uses Vuetify dialogs
 *   frappe.www.printview             print — handled separately
 *   frappe.desk.search               search — Desk-only widget
 */

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

function getCsrfToken(): string {
	return (
		(typeof window !== "undefined" && window.posawesome_csrf_token) || ""
	);
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
		const err = new Error(
			(data && (data._error_message || data.message)) ||
				`HTTP ${response.status}`,
		);
		(err as any).response = data;
		(err as any).status = response.status;
		if (o.error) o.error(err);
		throw err;
	}

	if (o.callback) {
		try {
			o.callback(data);
		} catch (cbErr) {
			console.warn("[POSA][shim] callback raised", cbErr);
		}
	}
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
		const ioOpts: Record<string, unknown> = {
			withCredentials: true,
			reconnectionAttempts: 3,
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
			get_today: nowDateIso,
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
			Dialog: function () {
				throw new Error(
					"frappe.ui.Dialog is not available outside Desk; use a Vuetify <v-dialog>",
				);
			},
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
