/**
 * Client for the per-site QZ Tray installer bundle.
 *
 * The server (`posawesome.posawesome.api.qz`) deploys one archive per
 * platform under `private/qz/bundle/` alongside a manifest describing them.
 * `get_qz_bundle_info` reports what is deployed; `download_qz_bundle`
 * streams it. Both are gated to the same roles as `sign_message` — the
 * operator who installs QZ Tray on a till is the one who prints from it.
 *
 * Why this exists at all: a till whose QZ Tray was never installed (or was
 * installed before the last certificate rotation) fails EVERY silent print,
 * and the operator's only remedy used to be finding the right installer on
 * someone's USB stick. Serving the tenant's own bundle — already carrying
 * the matching certificate — from the POS itself turns that into one click.
 */
import { track } from "../utils/telemetry";

declare const frappe: any;

export type QzBundlePlatform = "win" | "linux";

export interface QzBundlePlatformInfo {
	filename: string;
	size: number;
	sha256: string;
	/** A manifest can describe an archive a half-finished deploy never
	 * landed; only `present` means the download would actually succeed. */
	present: boolean;
}

export interface QzBundleInfo {
	/** At least one archive is really on disk. `false` is the normal
	 * first-run state, not an error. */
	available: boolean;
	qz_version: string;
	built_at: string;
	cert_fingerprint: string;
	platforms: Partial<Record<QzBundlePlatform, QzBundlePlatformInfo>>;
}

export const EMPTY_BUNDLE_INFO: QzBundleInfo = {
	available: false,
	qz_version: "",
	built_at: "",
	cert_fingerprint: "",
	platforms: {},
};

const BUNDLE_INFO_METHOD = "posawesome.posawesome.api.qz.get_qz_bundle_info";
const BUNDLE_DOWNLOAD_METHOD =
	"posawesome.posawesome.api.qz.download_qz_bundle";

/**
 * Best guess at which installer this terminal needs.
 *
 * Only used to preselect a button — the operator can always pick the other
 * one, so a wrong guess costs a click, never a failed install. macOS is not
 * a bundled platform; those terminals fall back to the Windows entry being
 * offered and simply won't find it useful, which is the honest state.
 */
export function detectQzPlatform(): QzBundlePlatform {
	if (typeof navigator === "undefined") return "win";
	const haystack = `${navigator.userAgent || ""} ${
		(navigator as any).platform || ""
	}`.toLowerCase();
	// Check Windows first: "X11; Linux" and "Windows NT" never co-occur, but
	// Android reports "linux" and should not be offered a .deb either.
	if (haystack.includes("win")) return "win";
	if (haystack.includes("linux") && !haystack.includes("android")) {
		return "linux";
	}
	return "win";
}

function normalisePlatformInfo(raw: any): QzBundlePlatformInfo | null {
	if (!raw || typeof raw !== "object") return null;
	const filename = String(raw.filename || "");
	if (!filename) return null;
	return {
		filename,
		size: Number(raw.size) || 0,
		sha256: String(raw.sha256 || ""),
		present: Boolean(raw.present),
	};
}

/**
 * Read the deployed bundle description.
 *
 * Never throws: a site with no bundle, a role the endpoint refuses, and a
 * dead network are all "no installer to offer here", and the wizard has to
 * keep working (connect, printer, self-test) in every one of those states.
 */
export async function fetchQzBundleInfo(): Promise<QzBundleInfo> {
	try {
		const response = await frappe.call({ method: BUNDLE_INFO_METHOD });
		const message = response?.message ?? response;
		if (!message || typeof message !== "object") return EMPTY_BUNDLE_INFO;

		const platforms: QzBundleInfo["platforms"] = {};
		const rawPlatforms = message.platforms;
		if (rawPlatforms && typeof rawPlatforms === "object") {
			for (const platform of ["win", "linux"] as QzBundlePlatform[]) {
				const info = normalisePlatformInfo(rawPlatforms[platform]);
				if (info) platforms[platform] = info;
			}
		}

		return {
			available: Boolean(message.available),
			qz_version: String(message.qz_version || ""),
			built_at: String(message.built_at || ""),
			cert_fingerprint: String(message.cert_fingerprint || ""),
			platforms,
		};
	} catch (error) {
		console.warn("Unable to read QZ bundle info", error);
		return EMPTY_BUNDLE_INFO;
	}
}

export function getQzBundleDownloadUrl(platform: QzBundlePlatform): string {
	return `/api/method/${BUNDLE_DOWNLOAD_METHOD}?platform=${encodeURIComponent(platform)}`;
}

export function formatBundleSize(bytes: number): string {
	if (!bytes || bytes < 0) return "";
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${Math.round(mb)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Guards against a double-click starting a second ~100 MB transfer. */
let _downloadInFlight = false;

export function isQzBundleDownloadInFlight(): boolean {
	return _downloadInFlight;
}

/**
 * Fetch the installer and hand it to the browser as a file download.
 *
 * Goes through `fetch` + blob rather than pointing the browser at the URL so
 * a 403 (wrong role) or 404 (nothing deployed) surfaces as a thrown error
 * the wizard can explain, instead of silently swapping the SPA for a JSON
 * error page. The whole archive lands in memory — ~103 MB for the Windows
 * build — which is why this is an install-time action behind an explicit
 * button and never anything the print path touches.
 */
export async function downloadQzBundle(
	platform: QzBundlePlatform,
	fallbackFilename = "qz-tray-bundle.zip",
): Promise<void> {
	if (_downloadInFlight) return;
	_downloadInFlight = true;
	const startedAt = Date.now();
	let objectUrl = "";
	try {
		const response = await fetch(getQzBundleDownloadUrl(platform), {
			credentials: "include",
		});
		if (!response.ok) {
			throw new Error(
				response.status === 403
					? "You do not have permission to download the QZ Tray installer."
					: `The QZ Tray installer could not be downloaded (HTTP ${response.status}).`,
			);
		}

		const blob = await response.blob();
		const filename =
			filenameFromContentDisposition(
				response.headers?.get?.("content-disposition") || "",
			) || fallbackFilename;

		objectUrl = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = objectUrl;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);

		try {
			track("pos:qz_bundle_download", Math.round((Date.now() - startedAt) / 1000), {
				platform,
				bytes: blob.size,
			});
		} catch {
			// telemetry dispatch must never bubble
		}
	} finally {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		_downloadInFlight = false;
	}
}

function filenameFromContentDisposition(header: string): string {
	if (!header) return "";
	const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
	// Basename it: the header is server-controlled, but a filename with a
	// path in it has no business reaching an anchor's download attribute.
	return match?.[1] ? match[1].split(/[/\\]/).pop() || "" : "";
}
