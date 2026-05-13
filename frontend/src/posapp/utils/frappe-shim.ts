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

async function frappeCall(opts: CallOpts | string): Promise<any> {
	const o: CallOpts =
		typeof opts === "string" ? { method: opts } : { ...opts };
	const method = o.method;
	const type = (o.type || "POST").toUpperCase();
	const headers: Record<string, string> = {
		"X-Frappe-CSRF-Token": getCsrfToken(),
		"X-Requested-With": "XMLHttpRequest",
	};

	let url = `/api/method/${method}`;
	let body: BodyInit | undefined;

	if (type === "GET") {
		const qs = new URLSearchParams();
		Object.entries(o.args || {}).forEach(([k, v]) => {
			if (v == null) return;
			qs.set(
				k,
				typeof v === "string" ? v : JSON.stringify(v),
			);
		});
		const q = qs.toString();
		if (q) url += `?${q}`;
	} else {
		const params = new URLSearchParams();
		Object.entries(o.args || {}).forEach(([k, v]) => {
			if (v == null) return;
			params.set(
				k,
				typeof v === "string" ? v : JSON.stringify(v),
			);
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
		const mod = await import("socket.io-client");
		const ioFactory: any = (mod as any).io || (mod as any).default || mod;
		const siteName =
			(typeof window !== "undefined" && window.posawesome_site_name) || "";
		const namespace = siteName ? `/${siteName}` : "";
		const url = `${window.location.origin}${namespace}`;
		socket = ioFactory(url, {
			transports: ["websocket"],
			withCredentials: true,
			reconnection: true,
		});
		// Re-attach all pending handlers when the socket settles.
		for (const [event, set] of handlers.entries()) {
			set.forEach((cb) => socket.on(event, cb));
		}
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
			ensureSocket().then((s) => s.on(event, cb));
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
			ensureSocket().then((s) => s.emit(event, ...args));
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

	(window as any).frappe = frappe;
	(window as any).__ = (text: string, _args?: any[]) => frappe._(text);
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
