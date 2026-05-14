const POSA_VERSION_ENDPOINT = "/assets/posawesome/dist/js/version.json";
const POSA_LOADER_LEGACY_URL = "/assets/posawesome/dist/js/loader.js";
const POSA_LOADER_SCRIPT_ID = "posa-loader-script";

const fetchPosBuildManifest = async () => {
	try {
		const response = await fetch(`${POSA_VERSION_ENDPOINT}?t=${Date.now()}`, {
			cache: "no-store",
		});
		if (!response.ok) {
			return null;
		}
		const payload = await response.json();
		const version = payload?.version || payload?.buildVersion;
		const assets = payload?.assets && typeof payload.assets === "object" ? payload.assets : {};
		return {
			version: typeof version === "string" && version.trim().length ? version.trim() : null,
			assets,
		};
	} catch (error) {
		console.warn("Unable to fetch POS build manifest", error);
		return null;
	}
};

const buildVersionedLoaderUrl = (version) =>
	version ? `${POSA_LOADER_LEGACY_URL}?v=${encodeURIComponent(version)}` : POSA_LOADER_LEGACY_URL;

const resolveLoaderUrl = (manifest) => {
	// Prefer the hashed loader URL published in version.json. Falls
	// back to the legacy un-hashed path (with `?v=`) for transitional
	// deploys where an old build is still serving the manifest.
	const fromAssets = manifest?.assets?.loader;
	if (typeof fromAssets === "string" && fromAssets.trim().length) {
		return fromAssets.trim();
	}
	return buildVersionedLoaderUrl(manifest?.version);
};

const ensurePosBootController = async () => {
	const manifest = await fetchPosBuildManifest();
	const version = manifest?.version || "";
	const loaderUrl = resolveLoaderUrl(manifest);
	const existingScript = document.getElementById(POSA_LOADER_SCRIPT_ID);

	// `data-build-version` survives across page mounts; reuse the in-flight
	// boot controller when the requested version + URL match.
	if (
		existingScript &&
		existingScript.getAttribute("data-build-version") === version &&
		existingScript.getAttribute("src") === loaderUrl &&
		typeof window.startPosBoot === "function"
	) {
		return;
	}

	if (existingScript) {
		existingScript.remove();
	}

	await new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.id = POSA_LOADER_SCRIPT_ID;
		script.type = "module";
		script.async = true;
		script.src = loaderUrl;
		script.setAttribute("data-build-version", version);
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error(`Failed to load POS boot controller (${version || "unversioned"})`));
		document.head.appendChild(script);
	});
};

// Phase 1.F: when any POS Profile the user is assigned to has the
// `posa_use_web_route` flag set, surface a "POS has moved to /posapp"
// banner and auto-navigate after 10 s. Users on the legacy boot path
// see no change. We check the flag via the same call the SPA itself
// uses (cheap; cached server-side) so toggling it from the POS
// Profile form takes effect on the next /app/posapp load.
const WEB_ROUTE_DEST = "/posapp";
const REDIRECT_DELAY_MS = 10_000;

const userOptedIntoWebRoute = async () => {
	try {
		const r = await frappe.call({
			method: "posawesome.posawesome.api.utilities.posa_user_opted_into_web_route",
			args: {},
		});
		return Boolean(r?.message);
	} catch (e) {
		// Pre-deploy of the helper endpoint, or any error → stay on
		// the legacy boot path. The flag is opt-in; failing closed is
		// the right default.
		return false;
	}
};

const showWebRouteRedirectNotice = (pageRef) => {
	const wrapper = pageRef?.wrapper || document.querySelector(".page-container");
	if (!wrapper) return;
	const banner = document.createElement("div");
	banner.id = "posa-web-route-redirect-banner";
	banner.style.cssText = [
		"position:relative",
		"margin:8px 0",
		"padding:10px 14px",
		"background:#1e293b",
		"color:#e2e8f0",
		"border-left:4px solid #38bdf8",
		"border-radius:4px",
		"font-size:13px",
		"display:flex",
		"align-items:center",
		"gap:12px",
	].join(";");
	const text = document.createElement("div");
	text.style.flex = "1";
	text.innerHTML =
		'<strong>POS Awesome has moved.</strong> Redirecting to <code>/posapp</code> in <span data-countdown>10</span> s — ' +
		'<a href="#" data-cancel style="color:#7dd3fc">stay here</a>.';
	const goBtn = document.createElement("button");
	goBtn.textContent = "Go now";
	goBtn.style.cssText =
		"padding:4px 10px;border:1px solid #475569;background:#0f172a;color:#e2e8f0;border-radius:4px;cursor:pointer;font-size:12px";
	banner.appendChild(text);
	banner.appendChild(goBtn);
	wrapper.insertBefore(banner, wrapper.firstChild);

	let cancelled = false;
	const counter = text.querySelector("[data-countdown]");
	const cancelLink = text.querySelector("[data-cancel]");
	const startedAt = Date.now();
	const tick = () => {
		if (cancelled) return;
		const left = Math.max(
			0,
			Math.ceil((REDIRECT_DELAY_MS - (Date.now() - startedAt)) / 1000),
		);
		if (counter) counter.textContent = String(left);
		if (left <= 0) {
			window.location.href = WEB_ROUTE_DEST;
			return;
		}
		setTimeout(tick, 250);
	};
	tick();

	const cancel = (e) => {
		if (e) e.preventDefault();
		cancelled = true;
		banner.remove();
	};
	cancelLink?.addEventListener("click", cancel);
	goBtn.addEventListener("click", () => {
		cancelled = true;
		window.location.href = WEB_ROUTE_DEST;
	});
};

frappe.pages["posapp"].on_page_load = async function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "POS Awesome",
		single_column: true,
	});
	const pageRef = (wrapper && wrapper.page) || page;

	// Check the flag first. If opted in, show the banner and let the
	// legacy boot continue in parallel so the user can still cancel
	// the redirect without seeing a broken page.
	userOptedIntoWebRoute().then((opted) => {
		if (opted) showWebRouteRedirectNotice(pageRef);
	});

	try {
		await ensurePosBootController();
		await window.startPosBoot({ pageRef });
	} catch (error) {
		console.error("Unable to start POS boot controller", error);
		frappe.msgprint({
			title: "POS Awesome",
			indicator: "red",
			message:
				"POS app failed to start before the boot controller could run. Reload /app/posapp and try again.",
		});
	}
};

frappe.pages["posapp"].on_page_unload = function (wrapper) {
	if (
		wrapper &&
		wrapper.page &&
		wrapper.page._posaTaxInclusiveHandler &&
		frappe.realtime &&
		typeof frappe.realtime.off === "function"
	) {
		frappe.realtime.off("pos_profile_registered", wrapper.page._posaTaxInclusiveHandler);
		wrapper.page._posaTaxInclusiveHandler = null;
	}

	if (
		wrapper &&
		wrapper.page &&
		wrapper.page.$PosApp &&
		typeof wrapper.page.$PosApp.unmount === "function"
	) {
		wrapper.page.$PosApp.unmount();
		wrapper.page.$PosApp = null;
	}
};
