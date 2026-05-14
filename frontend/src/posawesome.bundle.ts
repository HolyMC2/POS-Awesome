import "./toConsole";
import { mountPosApp } from "./posapp/posapp";
export * from "./posapp/posapp";
import "./utils/clearAllCaches";

// Vite/esbuild minifier renames every named export to a single letter
// (see posawesome-<hash>.js: `export{to as _, ... Kt as z}`). The Desk
// loader (loader.ts:319) uses a `frappe.PosApp.posapp` fallback when
// `module.mountPosApp` is undefined; the web-route entry (web-entry.ts)
// has no such fallback. Pin the function on window so /posapp can call
// it without depending on a minifier-stable export name.
if (typeof window !== "undefined") {
	(window as any).__posaMountPosApp = mountPosApp;
}
