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

async function evictStaleServiceWorkers(): Promise<boolean> {
	// The /posapp web route NEVER registers a service worker. Any SW present is
	// stale — left by a prior Desk-era build — and, scoped at "/", it intercepts
	// same-origin requests including `/files/*` item images, returning a
	// cache-miss 404 on the web route. The Desk loader self-heals via
	// `loader.ts performAssetRecovery`; the web route had no equivalent, so
	// operators saw broken item pictures until a manual DevTools unregister.
	//
	// Mirror that cleanup here. A CONTROLLING worker keeps intercepting for the
	// life of the current page even after `unregister()` (it detaches only on
	// the next navigation), so when we actually evict one we reload once —
	// guarded by a session sentinel so a re-registering SW can't loop us.
	//
	// Returns true if a reload was triggered (caller should stop booting).
	try {
		if (
			typeof navigator === "undefined" ||
			!navigator.serviceWorker ||
			typeof navigator.serviceWorker.getRegistrations !== "function"
		) {
			return false;
		}
		const registrations = await navigator.serviceWorker.getRegistrations();
		if (!registrations.length) return false; // nothing stale — leave caches alone

		await Promise.all(
			registrations.map(async (registration) => {
				registration.active?.postMessage({ type: "CLIENT_FORCE_UNREGISTER" });
				registration.waiting?.postMessage({ type: "CLIENT_FORCE_UNREGISTER" });
				registration.installing?.postMessage({ type: "CLIENT_FORCE_UNREGISTER" });
				await registration.unregister();
			}),
		);

		if (typeof caches !== "undefined") {
			// Only drop the stale SW's own caches (posawesome-cache-*, see
			// www/sw.js CACHE_PREFIX) — wiping ALL Cache Storage keys would
			// also destroy caches owned by unrelated same-origin pages.
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith("posawesome-cache-"))
					.map((key) => caches.delete(key)),
			);
		}

		if (
			navigator.serviceWorker.controller &&
			!sessionStorage.getItem("posa_sw_evicted")
		) {
			sessionStorage.setItem("posa_sw_evicted", "1");
			location.reload();
			return true;
		}
	} catch (err) {
		console.warn("[POSA][web-entry] stale service worker cleanup failed", err);
	}
	return false;
}

async function boot() {
	// Evict any stale Desk-era service worker BEFORE booting — it would
	// otherwise 404 same-origin `/files/*` item images on this route.
	if (await evictStaleServiceWorkers()) return; // reloading to drop the SW

	try {
		installFrappeShim();
	} catch (err) {
		showFailure("Could not install frappe shim", err);
		return;
	}

	const manifest = await fetchManifest();
	const bundleUrl = resolveBundleUrl(manifest);

	try {
		await import(/* @vite-ignore */ bundleUrl);
	} catch (err) {
		showFailure("Could not load POS bundle", err);
		return;
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
