/**
 * Vite entry for the `/posapp` web route (no Frappe Desk shell).
 *
 * Sequence
 * --------
 * 1. Install the `frappe` global shim against the boot payload the
 *    server-side Jinja seeded into `window.posawesome_boot`.
 * 2. Dynamically import the SPA bundle. The bundle exports
 *    `mountPosApp(pageRef)`; we pass a synthesized page-ref pointing
 *    at the `<div id="posa-app">` element the template carries.
 * 3. Hide the loading splash once mount returns.
 *
 * If anything throws before the SPA mounts, render a visible failure
 * banner so operators see the cause instead of a blank page.
 */

import { installFrappeShim } from "./posapp/utils/frappe-shim";
import { BRAND } from "./brand";

declare const __BUILD_VERSION__: string;

interface WebEntryWindow extends Window {
	startPosBoot?: (options?: { pageRef?: any }) => Promise<unknown>;
}

const DEFAULT_BUNDLE_PATH = "/assets/posawesome/dist/js/posawesome.js";
const VERSION_ENDPOINT = "/assets/posawesome/dist/js/version.json";

async function fetchManifest(): Promise<any | null> {
	try {
		const res = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, {
			cache: "no-store",
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

function resolveBundleUrl(manifest: any | null): string {
	const fromManifest =
		manifest && manifest.assets && manifest.assets.posawesome;
	if (typeof fromManifest === "string" && fromManifest.length) return fromManifest;
	return DEFAULT_BUNDLE_PATH;
}

function showFailure(message: string, err?: unknown) {
	const el = document.getElementById("posa-app-loading");
	if (!el) return;
	el.innerHTML = `
		<div style="max-width:560px;text-align:center;line-height:1.5">
			<div style="font-size:18px;margin-bottom:8px">${BRAND.name} failed to start</div>
			<div style="color:#cbd5e1">${message}</div>
			<button
				style="margin-top:16px;padding:8px 16px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;border-radius:6px;cursor:pointer"
				onclick="location.reload()"
			>Reload</button>
		</div>`;
	if (err) console.error("[POSA][web-entry]", err);
}

function injectedBundleUrl(): string | null {
	// posapp.py resolves the bundle URL server-side and rides it on the
	// entry <script> tag — skips the version.json round-trip that used to
	// sit in the LCP path on every boot (2026-07-11 audit).
	const el = document.querySelector("script[data-posa-bundle]");
	const url = (el?.getAttribute("data-posa-bundle") || "").trim();
	return url.length ? url : null;
}

async function boot() {
	try {
		installFrappeShim();
	} catch (err) {
		showFailure("Could not install frappe shim", err);
		return;
	}

	const injected = injectedBundleUrl();
	let bundleUrl = injected;
	if (!bundleUrl) {
		const manifest = await fetchManifest();
		bundleUrl = resolveBundleUrl(manifest);
	}

	try {
		await import(/* @vite-ignore */ bundleUrl);
	} catch (err) {
		// Injected URL can go stale mid-deploy (template cached, assets
		// swapped). Recover once through the manifest before failing.
		if (injected) {
			try {
				const manifest = await fetchManifest();
				const fresh = resolveBundleUrl(manifest);
				if (fresh && fresh !== bundleUrl) {
					await import(/* @vite-ignore */ fresh);
				} else {
					throw err;
				}
			} catch (recoveryErr) {
				showFailure("Could not load POS bundle", recoveryErr);
				return;
			}
		} else {
			showFailure("Could not load POS bundle", err);
			return;
		}
	}

	// The bundle minifier renames every named export to a single letter
	// (`export{to as _, ... Kt as z}`). The bundle pins the real
	// `mountPosApp` reference on `window.__posaMountPosApp` as a
	// side-effect — see posawesome.bundle.ts. Read it from there
	// instead of the unstable named export.
	const mount: ((pageRef: any) => unknown) | undefined = (window as any)
		.__posaMountPosApp;
	if (typeof mount !== "function") {
		showFailure("POS bundle did not expose __posaMountPosApp on window");
		return;
	}

	// Synthesize a page-ref shaped like the Frappe Desk page-ref the
	// SPA uses inside Desk. Only the fields the SPA actually reads
	// are populated.
	const root = document.getElementById("posa-app");
	if (!root) {
		showFailure("Mount node #posa-app missing from template");
		return;
	}
	const pageRef = {
		main: root,
		body: root,
		wrapper: root,
		page: root,
		$el: root,
	};

	try {
		await mount(pageRef);
	} catch (err) {
		showFailure("POS mount failed", err);
		return;
	}

	const loading = document.getElementById("posa-app-loading");
	if (loading) loading.remove();

	// Expose a tiny diagnostic for ops triage.
	const win = window as WebEntryWindow;
	(win as any).__posawesomeWebEntry = {
		buildVersion:
			typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "",
		mountedAt: new Date().toISOString(),
		mode: "web-route",
	};
}

if (typeof window !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			void boot();
		});
	} else {
		void boot();
	}
}
