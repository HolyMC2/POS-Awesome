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
			<div style="font-size:18px;margin-bottom:8px">POS Awesome failed to start</div>
			<div style="color:#cbd5e1">${message}</div>
			<button
				style="margin-top:16px;padding:8px 16px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;border-radius:6px;cursor:pointer"
				onclick="location.reload()"
			>Reload</button>
		</div>`;
	if (err) console.error("[POSA][web-entry]", err);
}

async function boot() {
	try {
		installFrappeShim();
	} catch (err) {
		showFailure("Could not install frappe shim", err);
		return;
	}

	const manifest = await fetchManifest();
	const bundleUrl = resolveBundleUrl(manifest);

	let bundle: any;
	try {
		bundle = await import(/* @vite-ignore */ bundleUrl);
	} catch (err) {
		showFailure("Could not load POS bundle", err);
		return;
	}

	if (!bundle || typeof bundle.mountPosApp !== "function") {
		showFailure("POS bundle did not export mountPosApp");
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
		await bundle.mountPosApp(pageRef);
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
