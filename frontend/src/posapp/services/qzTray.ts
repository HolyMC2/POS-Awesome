import qz from "qz-tray";
import { ref } from "vue";
import { useToastStore } from "../stores/toastStore";
import { useUIStore } from "../stores/uiStore";
import { track } from "../utils/telemetry";

declare const frappe: any;

// Capped failure-emitter so a wedged QZ Tray doesn't drown the
// telemetry pipeline. We only need a few rows per terminal per session
// to diagnose; after that the rest are dropped silently.
let _qzFailureCount = 0;
const QZ_FAILURE_REPORT_CAP = 10;
function reportQzFailure(stage: string, error: unknown, meta: Record<string, unknown> = {}) {
	if (_qzFailureCount >= QZ_FAILURE_REPORT_CAP) return;
	_qzFailureCount += 1;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: String(error);
	try {
		track("qz:failure", 1, {
			stage,
			message: message.slice(0, 280),
			cert: qzCertStatus.value,
			ws_active: qzConnected.value,
			...meta,
		});
	} catch {
		// telemetry dispatch must never bubble
	}
}

export type QzCertStatus = "unknown" | "trusted" | "untrusted";

export interface QzPrintHtmlOptions {
	printerName?: string;
	widthMm?: number;
	orientation?: "portrait" | "landscape";
	// Rasterizer interpolation. Default `nearest-neighbor` causes
	// banding on 203 DPI thermal printers when HTML rasterizes at
	// ~150 DPI; `bicubic` smooths it out. POS Profile field
	// `posa_qz_interpolation` controls per-tenant choice.
	interpolation?: "nearest-neighbor" | "bilinear" | "bicubic";
	// Output density in DPI; matches printer native (e.g. 203 for
	// Epson TM-T88, 180 for TM-T20III). Undefined → QZ auto-detect
	// (often ~150 — root cause of stripes). POS Profile field
	// `posa_qz_density` controls per-tenant choice.
	density?: number | string;
	// Append an ESC/POS cut command after the rendered HTML. Needed
	// when the CUPS PPD driver doesn't auto-cut between jobs (common
	// for generic-text drivers). POS Profile field
	// `posa_qz_cut_after_print` controls per-tenant choice.
	cutAfterPrint?: boolean | number;
	// ESC/POS cut command bytes. Default GS V B 0 = partial cut with
	// 1 line feed. Override if printer needs full cut (\x1Di) or
	// different feed (\x0A * n) before the cut byte.
	cutCommand?: string;
}

export interface QzPrintDocumentOptions extends QzPrintHtmlOptions {
	doctype: string;
	name: string;
	printFormat?: string;
	letterhead?: string | null;
	noLetterhead?: string | number | null;
	// Q8 — opt-in escape hatch for the in-flight dedupe guard at the
	// bottom of this module. Default behaviour (undefined / false) is
	// unchanged: same `(doctype, name, printFormat)` collapses into a
	// single promise. Test-print A/B helpers and any future caller
	// that legitimately needs back-to-back prints of the same document
	// can pass `bypassDedupe: true`.
	bypassDedupe?: boolean;
}

const PRINTER_STORAGE_KEY = "posa_qz_printer_name";
const CERT_READY_STORAGE_KEY = "posa_qz_cert_ready";
const MANUAL_DISCONNECT_STORAGE_KEY = "posa_qz_manual_disconnect";
const DEFAULT_PRINT_FORMAT = "Standard";
const PROFILE_PRINTER_FIELD = "posa_qz_printer_name";

export const qzConnected = ref(false);
export const qzConnecting = ref(false);
export const qzCertStatus = ref<QzCertStatus>("unknown");
export const qzPrinters = ref<string[]>([]);
export const selectedQzPrinter = ref(getSavedPrinterName());
export const qzCertReady = ref(loadCertReady());
export const qzReconnectPaused = ref(loadReconnectPaused());

let securityInitialized = false;
let cachedCertificate: string | null = null;
let certificateProvided = false;
let connectPromise: Promise<boolean> | null = null;
let certificateChecked = false;

function extractMessage<T>(value: any): T {
	if (value && typeof value === "object" && "message" in value) {
		return value.message as T;
	}
	return value as T;
}

async function callServer<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
	const response = await frappe.call({
		method,
		args,
	});
	return extractMessage<T>(response);
}

function buildPrintHtml(html: string, style: string, widthMm: number = 80): string {
	// Pin the viewport to the printer's paper width. Without this, QZ Tray's
	// HTML renderer uses a default (A4/Letter) viewport then scales the raster
	// down to fit — text lands ~half size and logos hit full paper width.
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@page { size: ${widthMm}mm auto; margin: 0; }
html { width: ${widthMm}mm; margin: 0; padding: 0; }
body { width: ${widthMm}mm; margin: 0; padding: 0 4mm; box-sizing: border-box; font-size: 10pt; line-height: 1.3; }
* { box-sizing: border-box; }
img { max-width: 100%; height: auto; }
.print-format { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
table { width: 100% !important; max-width: 100% !important; border-collapse: collapse; }
${style || ""}
</style>
</head>
<body>${html}</body>
</html>`;
}

// QZ Tray's HTML renderer has no base URL, so relative asset URLs (letterhead
// logo, signature images) render as broken placeholders. Fetch each image
// client-side (the browser carries the session cookie) and inline it as a
// base64 data URL so QZ receives a self-contained document. Also keeps silent
// printing working when the terminal has no internet — critical for rural POS
// deployments where the tienda keeps selling during outages.
const inlinedImageCache = new Map<string, string>();

async function fetchImageAsDataUrl(url: string, timeoutMs = 5000): Promise<string | null> {
	if (url.startsWith("data:")) return url;
	const cached = inlinedImageCache.get(url);
	if (cached) return cached;

	// Q5 — same-origin gate. The legacy `credentials: "include"` sent
	// the Frappe session cookie to ANY image URL embedded in the print
	// format Jinja — including attacker-controlled CDN URLs. Switch to
	// `omit` for cross-origin so the cookie never leaves our domain.
	// Same-origin requests still carry the cookie (needed for private
	// /files/ uploads gated by Frappe auth).
	let sameOrigin = true;
	try {
		sameOrigin = new URL(url, window.location.href).origin === window.location.origin;
	} catch {
		// Malformed URL — treat as cross-origin (defensive).
		sameOrigin = false;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			credentials: sameOrigin ? "include" : "omit",
			signal: controller.signal,
		});
		if (!response.ok) return null;
		const blob = await response.blob();
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
		inlinedImageCache.set(url, dataUrl);
		return dataUrl;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function inlineImagesForQz(html: string): Promise<string> {
	if (!html || !html.includes("<img")) return html;
	const doc = new DOMParser().parseFromString(`<div id="qz-inline-root">${html}</div>`, "text/html");
	const container = doc.getElementById("qz-inline-root");
	if (!container) return html;

	await Promise.all(
		Array.from(container.querySelectorAll("img")).map(async (img) => {
			const src = img.getAttribute("src");
			if (!src) return;
			let absolute: string;
			try {
				absolute = new URL(src, window.location.href).href;
			} catch {
				return;
			}
			const dataUrl = await fetchImageAsDataUrl(absolute);
			if (dataUrl) img.setAttribute("src", dataUrl);
		}),
	);

	return container.innerHTML;
}

function loadCertReady() {
	try {
		return localStorage.getItem(CERT_READY_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function loadReconnectPaused() {
	try {
		return localStorage.getItem(MANUAL_DISCONNECT_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function saveCertReady(value: boolean) {
	try {
		if (value) {
			localStorage.setItem(CERT_READY_STORAGE_KEY, "1");
		} else {
			localStorage.removeItem(CERT_READY_STORAGE_KEY);
		}
	} catch {
		// ignore localStorage errors
	}
}

function saveReconnectPaused(value: boolean) {
	try {
		if (value) {
			localStorage.setItem(MANUAL_DISCONNECT_STORAGE_KEY, "1");
		} else {
			localStorage.removeItem(MANUAL_DISCONNECT_STORAGE_KEY);
		}
	} catch {
		// ignore localStorage errors
	}
}

function setReconnectPaused(value: boolean) {
	qzReconnectPaused.value = value;
	saveReconnectPaused(value);
}

function getProfileDefaultPrinterName() {
	try {
		const uiStore = useUIStore();
		const profile =
			uiStore?.posProfile && typeof uiStore.posProfile === "object" && "value" in uiStore.posProfile
				? uiStore.posProfile.value
				: uiStore?.posProfile;

		if (!profile || typeof profile !== "object") {
			return "";
		}

		const value = profile[PROFILE_PRINTER_FIELD];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	} catch {
		// ignore store access issues outside app context
	}

	return "";
}

function setResolvedQzPrinter(name: string) {
	selectedQzPrinter.value = name || "";
}

function resolvePreferredPrinter(printers: string[]) {
	const saved = getSavedPrinterName();
	if (saved && printers.includes(saved)) {
		return saved;
	}

	const profileDefault = getProfileDefaultPrinterName();
	if (profileDefault && printers.includes(profileDefault)) {
		return profileDefault;
	}

	if (selectedQzPrinter.value && printers.includes(selectedQzPrinter.value)) {
		return selectedQzPrinter.value;
	}

	return printers[0] || "";
}

function setupSecurity() {
	if (securityInitialized) return;
	securityInitialized = true;

	qz.security.setCertificatePromise((resolve) => {
		if (cachedCertificate) {
			certificateProvided = true;
			resolve(cachedCertificate);
			return;
		}

		callServer<string>("posawesome.posawesome.api.qz.get_certificate")
			.then((certificate) => {
				if (certificate) {
					cachedCertificate = certificate;
					certificateProvided = true;
					qzCertReady.value = true;
					saveCertReady(true);
				} else {
					certificateProvided = false;
					qzCertStatus.value = "untrusted";
					reportQzFailure("cert_empty", new Error("get_certificate returned empty"));
				}
				resolve(certificate || undefined);
			})
			.catch((error) => {
				console.warn("Unable to fetch QZ certificate", error);
				certificateProvided = false;
				qzCertStatus.value = "untrusted";
				reportQzFailure("cert_fetch", error);
				resolve(undefined);
			});
	});

	qz.security.setSignatureAlgorithm("SHA512");
	qz.security.setSignaturePromise((toSign) => {
		return (resolve) => {
			callServer<string>("posawesome.posawesome.api.qz.sign_message", {
				message: toSign,
			})
				.then((signature) => {
					if (signature && certificateProvided) {
						qzCertStatus.value = "trusted";
						qzCertReady.value = true;
						saveCertReady(true);
					} else {
						qzCertStatus.value = "untrusted";
						if (!signature) {
							reportQzFailure("sign_empty", new Error("sign_message returned empty"));
						}
					}
					resolve(signature || undefined);
				})
				.catch((error) => {
					console.warn("Unable to sign QZ payload", error);
					qzCertStatus.value = "untrusted";
					reportQzFailure("sign_fetch", error);
					resolve(undefined);
				});
		};
	});
}

export function getSavedPrinterName() {
	try {
		return localStorage.getItem(PRINTER_STORAGE_KEY) || "";
	} catch {
		return "";
	}
}

export function savePrinterName(name: string) {
	try {
		if (name) {
			localStorage.setItem(PRINTER_STORAGE_KEY, name);
		} else {
			localStorage.removeItem(PRINTER_STORAGE_KEY);
		}
	} catch {
		// ignore localStorage errors
	}
}

export function setSelectedQzPrinter(name: string) {
	setResolvedQzPrinter(name);
	savePrinterName(name);
}

export async function connectQzTray(options: { userInitiated?: boolean } = {}): Promise<boolean> {
	if (options.userInitiated) {
		setReconnectPaused(false);
	}

	if (qz.websocket.isActive()) {
		qzConnected.value = true;
		return true;
	}

	if (qzReconnectPaused.value) {
		qzConnected.value = false;
		qzConnecting.value = false;
		return false;
	}

	if (connectPromise) {
		return connectPromise;
	}

	connectPromise = (async () => {
		setupSecurity();
		qzConnecting.value = true;

		qz.websocket.setClosedCallbacks(() => {
			qzConnected.value = false;
			qzConnecting.value = false;
			qzCertStatus.value = "unknown";
			// Re-prewarm. QZ Tray's WS drops on long idles + machine
			// sleep; without re-prewarm the next print pays the full
			// handshake (cert fetch + sign + ws connect = several
			// seconds), which is the dominant tail of the print-lag
			// pathology. Fire-and-forget; if reconnect fails the next
			// print falls through to its own connect attempt as before.
			if (!qzReconnectPaused.value) {
				setTimeout(() => {
					connectQzTray().catch(() => undefined);
				}, 2000);
			}
		});

		try {
			await qz.websocket.connect();
			qzConnected.value = true;
			qz.printers.find().catch(() => undefined);
			return true;
		} catch (error) {
			console.warn("Unable to connect to QZ Tray", error);
			qzConnected.value = false;
			return false;
		} finally {
			qzConnecting.value = false;
		}
	})();

	try {
		return await connectPromise;
	} finally {
		connectPromise = null;
	}
}

export async function disconnectQzTray(options: { manual?: boolean } = {}) {
	if (options.manual !== false) {
		setReconnectPaused(true);
	}

	if (!qz.websocket.isActive()) {
		qzConnected.value = false;
		qzConnecting.value = false;
		return;
	}

	try {
		await qz.websocket.disconnect();
	} catch (error) {
		console.warn("Unable to disconnect from QZ Tray", error);
	} finally {
		qzConnected.value = false;
		qzConnecting.value = false;
	}
}

export async function findQzPrinters(): Promise<string[]> {
	if (!qz.websocket.isActive()) {
		if (qzReconnectPaused.value) {
			qzConnected.value = false;
			return qzPrinters.value;
		}

		const connected = await connectQzTray();
		if (!connected) {
			return qzPrinters.value;
		}
	}

	try {
		const result = await qz.printers.find();
		const printers = Array.isArray(result)
			? result
			: result
				? [String(result)]
				: [];

		qzPrinters.value = printers;
		setResolvedQzPrinter(resolvePreferredPrinter(printers));
		validateProfilePinnedPrinter(printers);

		return printers;
	} catch (error) {
		console.error("Unable to load QZ printers", error);
		qzPrinters.value = [];
		return [];
	}
}

// Tracks the last warned pin so a tab that re-fetches printers (every
// dialog open + every print) doesn't spam toasts.
let _lastWarnedMissingPin: string | null = null;

function validateProfilePinnedPrinter(printers: string[]) {
	// Catches the silent-queue pathology: POS Profile's
	// posa_qz_printer_name pins a printer that doesn't exist on this
	// terminal (or is uninstalled/renamed). Without this gate the SPA
	// falls back to printers[0] and the operator sees "print succeeded"
	// while paper never moves. Surface via toast + qz:failure
	// telemetry row so it shows on the Q10 panel.
	const pinned = getProfileDefaultPrinterName();
	if (!pinned) return;
	if (printers.includes(pinned)) {
		_lastWarnedMissingPin = null;
		return;
	}
	if (_lastWarnedMissingPin === pinned) return;
	_lastWarnedMissingPin = pinned;

	const t = (s: string) =>
		typeof window !== "undefined" && (window as any).__
			? (window as any).__(s)
			: s;
	const message = t(
		"POS Profile pins printer {0} but it is not installed on this terminal. " +
			"Receipts will be sent to {1} instead.",
	)
		.replace("{0}", pinned)
		.replace("{1}", printers[0] || t("(no printer available)"));
	try {
		useToastStore().show({
			title: t("Printer mismatch"),
			message,
			color: "warning",
			timeout: 14000,
		});
	} catch {
		// toast store may not be ready during boot; the telemetry row
		// below survives.
	}
	reportQzFailure("profile_printer_missing", new Error(message), {
		pinned,
		available: printers.slice(0, 6),
	});
}

export async function checkQzCertificateOnce() {
	if (certificateChecked) {
		return qzCertReady.value;
	}

	certificateChecked = true;
	if (qzCertReady.value) {
		return true;
	}

	try {
		const certificate = await callServer<string>("posawesome.posawesome.api.qz.get_certificate");
		if (certificate) {
			cachedCertificate = certificate;
			qzCertReady.value = true;
			saveCertReady(true);
		}
	} catch {
		// certificate may not exist yet
	}

	return qzCertReady.value;
}

export async function setupQzCertificate() {
	const result = await callServer<{
		status: "exists" | "created";
		message?: string;
		cert_path?: string;
	}>("posawesome.posawesome.api.qz.setup_qz_certificate");

	qzCertReady.value = true;
	saveCertReady(true);
	return result;
}

export async function getQzCertificateDownload() {
	const result = await callServer<{ pem?: string; company?: string }>(
		"posawesome.posawesome.api.qz.get_certificate_download",
	);
	if (!result?.pem) {
		throw new Error("QZ certificate is not available.");
	}
	qzCertReady.value = true;
	saveCertReady(true);
	return result;
}

export function getQzCertificateFilename(company?: string | null) {
	const clean = (company || "").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
	return clean ? `${clean}.crt` : "certificate.crt";
}

export async function printHtmlViaQz(html: string, options: QzPrintHtmlOptions = {}) {
	if (!html) {
		throw new Error("Nothing to print.");
	}

	if (!qz.websocket.isActive()) {
		const connected = await connectQzTray();
		if (!connected) {
			if (qzReconnectPaused.value) {
				throw new Error("QZ Tray is manually disconnected. Press Connect to enable it again.");
			}
			throw new Error("QZ Tray is not available.");
		}
	}

	let printer =
		options.printerName ||
		selectedQzPrinter.value ||
		getSavedPrinterName() ||
		getProfileDefaultPrinterName();
	if (!printer) {
		const printers = await findQzPrinters();
		const firstPrinter = printers[0];
		if (firstPrinter) {
			printer = firstPrinter;
			setResolvedQzPrinter(firstPrinter);
		}
	}

	if (!printer) {
		throw new Error("No QZ printer selected.");
	}

	const configOptions: Record<string, any> = {
		size: {
			width: options.widthMm || 80,
			height: null,
		},
		units: "mm",
		orientation: options.orientation || "portrait",
		margins: { top: 0, right: 0, bottom: 0, left: 0 },
		colorType: "grayscale",
		interpolation: options.interpolation || "nearest-neighbor",
	};
	if (options.density !== undefined && options.density !== null && options.density !== "") {
		configOptions.density = options.density;
	}
	const config = qz.configs.create(printer, configOptions);

	const data: any[] = [
		{
			type: "pixel",
			format: "html",
			flavor: "plain",
			data: html,
		},
	];

	// Cutter: append raw ESC/POS bytes after the rendered raster.
	// QZ Tray supports mixed pixel + raw in a single print job.
	//
	// Encoded as `hex` flavor not `plain` — JS string serialization to
	// the QZ websocket transport can mangle high-bit bytes (0x1D, 0x56)
	// through UTF-8 conversion, leaving the printer with garbage that
	// it ignores. Hex bypasses any string-encoding round-trip.
	//
	// Default sequence breakdown:
	//   0A 0A 0A   = 3 line feeds (push paper past the cutter blade)
	//   1D 56 42 00 = GS V B 0 = partial cut (1mm strip remaining)
	// Safe across Epson TM-T20/T88, Star TSP100/TSP143, SNBC heads.
	// Operators needing FULL cut can pass cutCommand="0A0A0A1D564100"
	// (GS V A 0). Legacy printers: "0A0A0A1B6942" (ESC i B).
	if (options.cutAfterPrint) {
		const hexCmd = options.cutCommand || "0A0A0A1D564200";
		data.push({
			type: "raw",
			format: "command",
			flavor: "hex",
			data: hexCmd,
		});
	}

	await qz.print(config, data);
}

// In-flight registry. Closes the "two paper copies" bug at the
// services layer too — if any caller (`useLastInvoicePrinting`,
// `PrintMenu.vue`, `NavbarMenu.vue`, etc.) re-invokes
// `printDocumentViaQz` for the same (doctype, name) while a print
// is mid-flight, the second invocation joins the existing promise
// instead of starting a new job.
const _qzPrintInFlight = new Map<string, Promise<void>>();

export async function printDocumentViaQz(options: QzPrintDocumentOptions) {
	if (!options?.doctype || !options?.name) {
		throw new Error("Invalid print document details.");
	}

	const dedupeKey = `${options.doctype}:${options.name}:${options.printFormat || ""}`;
	if (!options.bypassDedupe) {
		const inflight = _qzPrintInFlight.get(dedupeKey);
		if (inflight) {
			return inflight;
		}
	}

	const printFormat = options.printFormat || DEFAULT_PRINT_FORMAT;
	const noLetterhead =
		options.letterhead && String(options.letterhead).trim() ? 0 : options.noLetterhead ?? 1;

	// Read per-POS-Profile rasterizer hints (Q3). When absent we
	// preserve legacy `nearest-neighbor` + QZ auto-density so this
	// fix is opt-in via the POS Profile fields.
	if (
		options.interpolation === undefined ||
		options.density === undefined ||
		options.cutAfterPrint === undefined
	) {
		try {
			const uiStore = useUIStore();
			const profile = uiStore.posProfile as any;
			if (profile) {
				if (options.interpolation === undefined && profile.posa_qz_interpolation) {
					options.interpolation = profile.posa_qz_interpolation;
				}
				if (options.density === undefined && profile.posa_qz_density) {
					options.density = profile.posa_qz_density;
				}
				if (
					options.cutAfterPrint === undefined &&
					profile.posa_qz_cut_after_print !== undefined
				) {
					options.cutAfterPrint = profile.posa_qz_cut_after_print;
				}
			}
		} catch {
			// Pinia not initialised in some test harnesses — ignore.
		}
	}

	const startedAt = performance.now();
	// Q9 — per-stage timing. Populated inside the IIFE on each
	// successful stage; emitted alongside the end-to-end
	// `perf:qz_print` rollup after the full pipeline returns. NaN
	// means the stage didn't complete (we don't emit those events).
	const stageMs = {
		fetch_html: NaN,
		inline: NaN,
		send: NaN,
	};
	const exec = (async (): Promise<void> => {

	let html: string | undefined;
	let style = "";
	const tFetchStart = performance.now();
	try {
		const response = await frappe.call({
			method: "frappe.www.printview.get_html_and_style",
			args: {
				doc: options.doctype,
				name: options.name,
				print_format: printFormat,
				no_letterhead: noLetterhead,
				letterhead: options.letterhead || undefined,
			},
		});
		html = response?.html || response?.message?.html;
		style = response?.style || response?.message?.style || "";
		stageMs.fetch_html = performance.now() - tFetchStart;
	} catch (err) {
		reportQzFailure("fetch_html", err, {
			doctype: options.doctype,
			name: options.name,
			print_format: printFormat,
		});
		throw err;
	}

	if (!html) {
		const err = new Error("Unable to load print HTML from server.");
		reportQzFailure("empty_html", err, {
			doctype: options.doctype,
			name: options.name,
			print_format: printFormat,
		});
		throw err;
	}

	try {
		const tInlineStart = performance.now();
		const inlinedHtml = await inlineImagesForQz(html);
		stageMs.inline = performance.now() - tInlineStart;
		const tSendStart = performance.now();
		await printHtmlViaQz(buildPrintHtml(inlinedHtml, style, options.widthMm || 80), options);
		stageMs.send = performance.now() - tSendStart;
	} catch (err) {
		reportQzFailure("send_to_printer", err, {
			doctype: options.doctype,
			name: options.name,
			printer: options.printerName || selectedQzPrinter.value || "",
		});
		throw err;
	}
	})();

	if (!options.bypassDedupe) {
		_qzPrintInFlight.set(dedupeKey, exec);
	}
	try {
		await exec;
		// Q4 + Q9 — emit per-stage + end-to-end timing. Per-stage
		// events let the dashboard split where the lag lives
		// (server-side Jinja → image inlining → QZ Tray send). The
		// end-to-end rollup stays as the primary SLO signal.
		const baseMeta = {
			doctype: options.doctype,
			print_format: printFormat,
			interpolation: options.interpolation || "nearest-neighbor",
			density: options.density ?? null,
		};
		try {
			if (Number.isFinite(stageMs.fetch_html)) {
				track("perf:qz_fetch_html_ms", Math.round(stageMs.fetch_html), baseMeta);
			}
			if (Number.isFinite(stageMs.inline)) {
				track("perf:qz_inline_ms", Math.round(stageMs.inline), baseMeta);
			}
			if (Number.isFinite(stageMs.send)) {
				track("perf:qz_send_ms", Math.round(stageMs.send), baseMeta);
			}
			track("perf:qz_print", Math.round(performance.now() - startedAt), baseMeta);
		} catch {
			// telemetry dispatch must never bubble
		}
	} finally {
		if (!options.bypassDedupe) {
			_qzPrintInFlight.delete(dedupeKey);
		}
	}
}
