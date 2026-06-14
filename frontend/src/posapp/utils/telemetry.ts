/**
 * Browser RUM client for POSAwesome.
 *
 * Responsibilities
 * - Observe Long-Task / event (INP) / LCP / CLS / paint via
 *   PerformanceObserver, push each as a RUM event.
 * - Accept custom marks from `utils/perf.ts` (`mark`) via `track(name, ms)`.
 * - Catch `error` + `unhandledrejection` + SW `messageerror`, push a
 *   `crash:*` event.
 * - Watch `performance.memory.usedJSHeapSize`; emit a `warn:heap_pressure`
 *   when usage crosses 70% of the limit.
 * - Buffer events in memory; flush every `FLUSH_INTERVAL_MS` (30 s) or
 *   on `visibilitychange → hidden` / `pagehide` via `sendBeacon` when
 *   available so the last batch survives a tab close.
 *
 * Non-goals
 * - Replacement for server logs. This is RUM data, not error tracking
 *   with full stack traces. Crash events carry only a short message
 *   string (`error.message` truncated to 256 chars).
 * - PII leakage. We never serialise customer / invoice / payment
 *   identifiers in event names; the SPA's call sites are responsible
 *   for keeping values numeric or coarse enums.
 */

declare const frappe: any;

const FLUSH_INTERVAL_MS = 30_000;
const MAX_BUFFER_BEFORE_FLUSH = 200;
const MAX_BUFFER_BEFORE_DROP = 1000;
const HEAP_PRESSURE_RATIO = 0.7;
const HEAP_SAMPLE_INTERVAL_MS = 30_000;

interface TelemetryEvent {
	event_name: string;
	value?: number;
	terminal?: string | null;
	pos_profile?: string | null;
	build_version?: string | null;
	user_agent?: string | null;
	event_timestamp: string;
	metadata?: Record<string, unknown> | null;
}

let buffer: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let heapTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let warned_heap_pressure = false;
let terminal = "";
let buildVersion = "";
let posProfile: string | null = null;
const userAgent =
	typeof navigator === "undefined" ? "" : (navigator.userAgent || "").slice(0, 256);

function nowIso(): string {
	return new Date().toISOString();
}

// Stable per-browser terminal id. Persisted in localStorage so the same
// physical device keeps one id across reloads/builds. Prod telemetry had
// `terminal` 100% empty (start() only ever passed buildVersion), so all
// per-device grouping was dead — this gives every row a device key even
// before a POS profile is known. Coarse device id only; no PII.
function getOrCreateTerminalId(): string {
	if (typeof window === "undefined") return "";
	try {
		const KEY = "posa_terminal_id";
		let id = window.localStorage?.getItem(KEY) || "";
		if (!id) {
			const uuid =
				typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
					? crypto.randomUUID()
					: `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
			id = uuid.replace(/-/g, "").slice(0, 24);
			window.localStorage?.setItem(KEY, id);
		}
		return id;
	} catch {
		return "";
	}
}

function getRumEnabled(): boolean {
	if (typeof window === "undefined") return false;
	// Opt-out hatch: any operator can disable RUM by setting
	// localStorage.posa_rum=off (zero ceremony, zero deploy).
	try {
		return window.localStorage?.getItem("posa_rum") !== "off";
	} catch {
		return true;
	}
}

function setContext(opts: {
	terminal?: string;
	buildVersion?: string;
	posProfile?: string | null;
}) {
	if (opts.terminal !== undefined) terminal = opts.terminal || "";
	if (opts.buildVersion !== undefined) buildVersion = opts.buildVersion || "";
	if (opts.posProfile !== undefined) posProfile = opts.posProfile || null;
}

function push(event_name: string, value = 0, metadata?: Record<string, unknown>) {
	if (!getRumEnabled()) return;
	if (buffer.length >= MAX_BUFFER_BEFORE_DROP) {
		// Backpressure: drop new events rather than grow unbounded if
		// the network has been down for hours. The dashboard summary
		// is statistical — losing the tail of a flood is acceptable.
		return;
	}
	buffer.push({
		event_name: String(event_name || "").slice(0, 64),
		value: Number.isFinite(value) ? Number(value) : 0,
		terminal: terminal || null,
		pos_profile: posProfile,
		build_version: buildVersion || null,
		user_agent: userAgent,
		event_timestamp: nowIso(),
		metadata: metadata || null,
	});
	if (buffer.length >= MAX_BUFFER_BEFORE_FLUSH) {
		flush().catch(() => {});
	}
}

function flushSync(): boolean {
	if (!buffer.length) return false;
	if (typeof navigator === "undefined" || !("sendBeacon" in navigator)) {
		return false;
	}
	const payload = buffer;
	buffer = [];
	try {
		const blob = new Blob(
			[
				new URLSearchParams({
					cmd: "posawesome.posawesome.api.telemetry.ingest",
					events: JSON.stringify(payload),
				}).toString(),
			],
			{ type: "application/x-www-form-urlencoded" },
		);
		const ok = navigator.sendBeacon("/api/method/posawesome.posawesome.api.telemetry.ingest", blob);
		if (!ok) {
			// Beacon rejected — put events back on the buffer for the
			// next flush attempt. Cap re-queue depth at the buffer max.
			buffer = payload.concat(buffer).slice(0, MAX_BUFFER_BEFORE_DROP);
		}
		return ok;
	} catch {
		buffer = payload.concat(buffer).slice(0, MAX_BUFFER_BEFORE_DROP);
		return false;
	}
}

async function flush(): Promise<void> {
	if (!buffer.length) return;
	if (typeof frappe === "undefined" || typeof frappe.call !== "function") {
		return;
	}
	const payload = buffer;
	buffer = [];
	try {
		await frappe.call({
			method: "posawesome.posawesome.api.telemetry.ingest",
			args: { events: payload },
			freeze: false,
		});
	} catch (err) {
		// Re-queue on failure. Never bubble up.
		buffer = payload.concat(buffer).slice(0, MAX_BUFFER_BEFORE_DROP);
	}
}

// Web-vital readings above this are physically implausible for a real
// interaction or paint. They come from a tab throttled in the background
// then resumed: the spec measures wall-clock, so the throttle gap lands
// in `entry.duration` (INP/longtask) or `entry.startTime` (LCP/FCP). Prod
// saw rum:inp max 4,971,552 ms (82 min) and rum:lcp 3,568,076 ms (59 min)
// — single garbage samples that trashed max/p99 on the low-count vitals.
// Drop at source (mirrored server-side in api/telemetry.py for stale tabs
// on old builds). Time-based vitals only: CLS is a unitless score and
// heap_used_mb is megabytes, so neither is subject to this cap.
const MAX_WEBVITAL_MS = 60_000;

export function isPlausibleVitalMs(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= MAX_WEBVITAL_MS;
}

function pushVital(
	event_name: string,
	valueMs: number,
	metadata?: Record<string, unknown>,
) {
	if (!isPlausibleVitalMs(valueMs)) return;
	push(event_name, valueMs, metadata);
}

function trackLongTask(entry: PerformanceEntry) {
	pushVital("rum:longtask", entry.duration, {
		startTime: Math.round(entry.startTime),
	});
}

function trackEvent(entry: any /* PerformanceEventTiming */) {
	if (!entry || typeof entry.duration !== "number") return;
	// Only sample high-INP events to limit volume; the
	// PerformanceObserver gives us hundreds per minute otherwise.
	if (entry.duration < 50) return;
	// Drop background-throttle artifacts before building rich metadata.
	if (!isPlausibleVitalMs(entry.duration)) return;

	// Rich context for tail diagnosis. The bare event payload
	// (name+target.tagName) was not enough to identify why operator
	// hits a 2.8s keydown freeze — could be cart search during bg
	// item sync, drawer open, or pricing-rule recalc. Adding route,
	// nearest data-perf-tag ancestor, attribution (clickTarget
	// nodeName + id/class snippet), and the active route so the
	// dashboard can group by view + interaction surface.
	const tagName =
		entry.target && typeof entry.target.tagName === "string"
			? entry.target.tagName.toLowerCase()
			: null;
	let perfTag: string | null = null;
	let elementId: string | null = null;
	let elementClass: string | null = null;
	try {
		const t = entry.target as HTMLElement | null;
		if (t) {
			if (t.id) elementId = t.id.slice(0, 60);
			if (t.className && typeof t.className === "string") {
				// First two class tokens — keeps payload bounded.
				elementClass = t.className.trim().split(/\s+/).slice(0, 2).join(" ").slice(0, 80);
			}
			// Walk up looking for a `data-perf-tag="<label>"` marker.
			// Components that wrap expensive interactions can opt in
			// by adding the attribute on the wrapper — gives a stable
			// semantic name even after refactors rename CSS classes.
			let node: HTMLElement | null = t;
			for (let i = 0; i < 6 && node; i++) {
				const v = node.getAttribute?.("data-perf-tag");
				if (v) { perfTag = v.slice(0, 40); break; }
				node = node.parentElement;
			}
		}
	} catch {
		/* attribution is best-effort */
	}
	const route =
		(typeof window !== "undefined" &&
			(window.location?.pathname || "") +
				(window.location?.hash?.slice(0, 60) || "")) || "";

	pushVital("rum:inp", entry.duration, {
		name: entry.name,
		startTime: Math.round(entry.startTime || 0),
		processingStart: Math.round(entry.processingStart || 0),
		target: tagName,
		// New fields — backwards-compatible (older dashboards just
		// ignore unknown keys; the ingest endpoint stores metadata
		// as opaque JSON).
		perfTag,
		elementId,
		elementClass,
		route: route.slice(0, 120),
	});
}

function trackLcp(entry: any /* LargestContentfulPaint */) {
	pushVital("rum:lcp", entry.startTime, {
		size: entry.size || null,
		url: entry.url || null,
	});
}

function trackCls(entry: any /* LayoutShift */) {
	if (!entry || entry.hadRecentInput) return;
	push("rum:cls", entry.value);
}

function trackPaint(entry: PerformanceEntry) {
	if (entry.name === "first-contentful-paint") {
		pushVital("rum:fcp", entry.startTime);
	}
}

function safeObserve(type: string, cb: (entry: any) => void, opts: PerformanceObserverInit = {}) {
	if (typeof PerformanceObserver === "undefined") return;
	try {
		const supportedTypes = (PerformanceObserver as any).supportedEntryTypes || [];
		if (supportedTypes.length && !supportedTypes.includes(type)) {
			return;
		}
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				try {
					cb(entry);
				} catch {
					// Swallow — telemetry must never raise.
				}
			}
		});
		observer.observe({ type, ...opts });
	} catch {
		// Some browsers reject unknown types; ignore.
	}
}

function startObservers() {
	safeObserve("longtask", trackLongTask, { buffered: true });
	safeObserve("event", trackEvent as any, { buffered: true, durationThreshold: 40 } as any);
	safeObserve("largest-contentful-paint", trackLcp, { buffered: true });
	safeObserve("layout-shift", trackCls, { buffered: true });
	safeObserve("paint", trackPaint, { buffered: true });
}

// Benign browser/runtime noise that fires as a global `error` event but is
// NOT a real crash. "ResizeObserver loop …" in particular floods the channel
// (212 events over 3 days on prod, drowning real crashes) — it's a harmless
// notification the spec itself says can be ignored. Dropped at the source so
// it never costs a network round-trip or a telemetry row.
const IGNORED_CRASH_SUBSTRINGS = [
	"ResizeObserver loop completed with undelivered notifications",
	"ResizeObserver loop limit exceeded",
];

function isIgnoredCrashMessage(message: string): boolean {
	if (!message) return false;
	return IGNORED_CRASH_SUBSTRINGS.some((s) => message.includes(s));
}

function startCrashHooks() {
	if (typeof window === "undefined") return;
	window.addEventListener("error", (ev: ErrorEvent) => {
		const message = (ev.message || "").slice(0, 256);
		if (isIgnoredCrashMessage(message)) return;
		push("crash:error", 1, {
			message,
			filename: (ev.filename || "").slice(0, 256),
			lineno: ev.lineno || 0,
		});
	});
	window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
		const reason: any = ev.reason;
		const rawMessage =
			(reason && reason.message) || (typeof reason === "string" ? reason : "");
		const message = String(rawMessage || "").slice(0, 256);
		if (isIgnoredCrashMessage(message)) return;
		push("crash:unhandledrejection", 1, { message });
	});
}

function sampleHeap() {
	const mem = (performance as any).memory;
	if (!mem || !mem.usedJSHeapSize || !mem.jsHeapSizeLimit) return;
	const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
	push("rum:heap_used_mb", Math.round(mem.usedJSHeapSize / (1024 * 1024)), {
		ratio: Math.round(ratio * 100) / 100,
	});
	if (ratio > HEAP_PRESSURE_RATIO && !warned_heap_pressure) {
		warned_heap_pressure = true;
		push("warn:heap_pressure", ratio, {
			used_mb: Math.round(mem.usedJSHeapSize / (1024 * 1024)),
			limit_mb: Math.round(mem.jsHeapSizeLimit / (1024 * 1024)),
		});
	}
}

function startLifecycleHooks() {
	if (typeof document === "undefined") return;
	const flushOnHide = () => {
		if (document.visibilityState === "hidden") {
			// Best effort: sendBeacon works after the tab is closing.
			flushSync();
		}
	};
	document.addEventListener("visibilitychange", flushOnHide);
	if (typeof window !== "undefined") {
		window.addEventListener("pagehide", () => {
			flushSync();
		});
	}
}

export function track(eventName: string, value = 0, metadata?: Record<string, unknown>) {
	push(eventName, value, metadata);
}

export function trackCustomMark(name: string, durationMs: number) {
	push(`perf:${name}`, durationMs);
}

// --- Per-method API latency -------------------------------------------
// Single source of truth for app-perf timing. Both api.ts callEnvelope
// and the /posapp frappe-shim frappeCall feed timings through here, so
// perf:api.* lands in telemetry regardless of which call path a caller
// used. Before this, only callEnvelope (a few services) emitted timings;
// the ~50 direct frappe.call sites — incl update_invoice / submit_invoice
// — were invisible, so the telemetry table had ZERO perf:api rows.
const API_HOT_METHODS = new Set<string>([
	"posawesome.posawesome.api.invoices.submit_invoice",
	"posawesome.posawesome.api.invoices.update_invoice",
	"posawesome.posawesome.api.invoices.validate_cart_items",
	"posawesome.posawesome.api.shifts.check_opening_shift",
	"posawesome.posawesome.api.items.search_items",
	"posawesome.posawesome.api.items.get_items",
	"posawesome.posawesome.api.customers.search_customers",
	"posawesome.posawesome.api.utilities.get_active_pricing_rules",
]);

function apiMethodLabel(method: string): string {
	const prefix = "posawesome.posawesome.api.";
	return method.startsWith(prefix) ? method.slice(prefix.length) : method;
}

// Hot methods always tracked; cold ones sampled at 10% to bound volume.
// Telemetry must never throw.
export function trackApiTiming(
	method: string,
	ok: boolean,
	elapsedMs: number,
): void {
	try {
		if (!method) return;
		if (!API_HOT_METHODS.has(method) && Math.random() >= 0.1) return;
		push(`perf:api.${apiMethodLabel(method)}.${ok ? "ok" : "err"}`, elapsedMs);
	} catch {
		/* telemetry must never throw */
	}
}

export function start(opts: {
	terminal?: string;
	buildVersion?: string;
	posProfile?: string | null;
} = {}) {
	if (started) {
		setContext(opts);
		return;
	}
	started = true;
	// Default the terminal to the stable per-device id when the caller
	// doesn't supply one (boot only passes buildVersion). Later
	// updateContext() calls that omit `terminal` leave this in place.
	if (opts.terminal === undefined) {
		opts = { ...opts, terminal: getOrCreateTerminalId() };
	}
	setContext(opts);
	if (!getRumEnabled()) return;
	startObservers();
	startCrashHooks();
	startLifecycleHooks();
	flushTimer = setInterval(() => {
		flush().catch(() => {});
	}, FLUSH_INTERVAL_MS);
	heapTimer = setInterval(sampleHeap, HEAP_SAMPLE_INTERVAL_MS);
}

export function stop() {
	if (flushTimer) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
	if (heapTimer) {
		clearInterval(heapTimer);
		heapTimer = null;
	}
	flush().catch(() => {});
	started = false;
}

export function updateContext(opts: {
	terminal?: string;
	buildVersion?: string;
	posProfile?: string | null;
}) {
	setContext(opts);
}

// Test-only — exposed for unit tests to inspect the buffer.
export function __getBufferForTest() {
	return buffer.slice();
}
