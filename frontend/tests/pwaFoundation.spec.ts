// @vitest-environment node
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import menuSource from "../src/posapp/components/navbar/NavbarMenu.vue?raw";
import bootSource from "../src/posapp/posapp.ts?raw";

/**
 * PWA foundation — native-feel round 1 (Marco, 2026-08-30: «make the feeling
 * like a native android/ios app, snappy, solid, secure, reliable, polished»,
 * «start with the pwa foundation»).
 *
 * What an installed register needs, pinned at the source so it cannot drift
 * back: an installable manifest (Chrome demands a 192 AND a 512 PNG — the 192
 * used to be a `.txt` placeholder), a padded maskable icon, the register's
 * own light colours on the splash and title bar, Spanish shortcuts that point
 * at routes that exist, an opaque iOS status bar (the page does not pad for
 * the notch), and the touch chrome: no double-tap zoom, no pull-to-refresh,
 * no text selection on the chrome, the dock above the home indicator.
 */
const root = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const manifest = JSON.parse(read("posawesome/www/manifest.json"));
const html = read("posawesome/www/posapp.html");
const theme = read("frontend/src/posapp/styles/theme.css");
const es = read("posawesome/translations/es.csv");

/** Width × height straight out of a PNG's IHDR chunk — no image library. */
const pngSize = (rel: string): [number, number] => {
	const buf = readFileSync(new URL(rel, root));
	expect(buf.subarray(0, 8).toString("hex"), `${rel} is a PNG`).toBe("89504e470d0a1a0a");
	return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

describe("manifest — installable, in the register's own voice", () => {
	it("is Spanish, standalone, and paints the register's light ground on the splash", () => {
		expect(manifest.lang).toBe("es-MX");
		expect(manifest.display).toBe("standalone");
		expect(manifest.start_url).toBe("/posapp");
		expect(manifest.id).toBe("/posapp");
		// theme.css :root --pos-navbar-bg / --pos-bg-secondary (light scheme).
		expect(manifest.theme_color.toLowerCase()).toBe("#ffffff");
		expect(manifest.background_color.toLowerCase()).toBe("#f8f9fa");
		expect(manifest.launch_handler?.client_mode).toBe("focus-existing");
	});

	it("ships the 192 and 512 `any` icons Chrome requires plus a dedicated maskable one", () => {
		const bySize = (purpose: string, size: string) =>
			manifest.icons.find((i: any) => i.purpose === purpose && i.sizes === size);
		expect(bySize("any", "192x192")).toBeTruthy();
		expect(bySize("any", "512x512")).toBeTruthy();
		expect(bySize("maskable", "512x512")).toBeTruthy();
		// `any maskable` on one file is the anti-pattern the old manifest had.
		expect(manifest.icons.some((i: any) => /any.*maskable|maskable.*any/.test(i.purpose))).toBe(false);
		for (const icon of manifest.icons) {
			const rel = icon.src.replace("/assets/posawesome/", "posawesome/public/");
			expect(existsSync(new URL(rel, root)), `${icon.src} exists`).toBe(true);
			const [w, h] = pngSize(rel);
			expect(`${w}x${h}`).toBe(icon.sizes);
		}
		expect(existsSync(new URL("posawesome/public/icons/logo-192.txt", root))).toBe(false);
	});

	it("shortcuts are Spanish and point at routes the SPA serves", () => {
		expect(manifest.shortcuts.length).toBeGreaterThan(0);
		const routerSource = read("frontend/src/posapp/router/index.ts");
		const registrySource = read("frontend/src/posapp/composables/pos/shell/destinationRegistry.ts");
		for (const shortcut of manifest.shortcuts) {
			expect(shortcut.url.startsWith("/posapp/")).toBe(true);
			const path = shortcut.url.slice("/posapp".length);
			expect(
				routerSource.includes(`path: "${path}"`) || registrySource.includes(`path: "${path}"`),
				`${shortcut.url} is a served route`,
			).toBe(true);
			expect(shortcut.name).not.toMatch(/^(Open POS|Dashboard|Cash Movement)$/);
		}
	});
});

describe("posapp.html — the installed shell's head", () => {
	it("names a theme colour per scheme and an opaque iOS status bar", () => {
		expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />');
		expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e1e1e" />');
		expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />');
		// (The word survives in the explanatory comment; the ATTRIBUTE must not.)
		expect(html).not.toContain('content="black-translucent"');
		expect(html).toMatch(/viewport-fit=cover/);
	});

	it("links the brand icons, not the built favicon nor the 512 as touch icon", () => {
		expect(html).toContain('href="/assets/posawesome/icons/logo-192.png"');
		expect(html).toContain('href="/assets/posawesome/icons/apple-touch-icon-180.png"');
		expect(html).not.toContain("pos-BuGonphY.png");
		expect(pngSize("posawesome/public/icons/apple-touch-icon-180.png")).toEqual([180, 180]);
	});
});

describe("theme.css — the touch chrome", () => {
	const rule = (selector: string) => {
		const start = theme.indexOf(`\n${selector} {`);
		if (start < 0) return "";
		return theme.slice(start, theme.indexOf("}", start));
	};

	it("kills double-tap zoom on the root and the grey tap flash", () => {
		const root = rule(".posapp");
		expect(root).toMatch(/touch-action:\s*manipulation/);
		expect(root).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
	});

	it("refuses pull-to-refresh / rubber-band on the shell", () => {
		expect(theme).toMatch(
			/html:has\(body\[data-page-route="posapp"\]\),\s*body\[data-page-route="posapp"\]\s*\{[^}]*overscroll-behavior-y:\s*none/,
		);
	});

	it("the chrome is not selectable text and has no iOS callout", () => {
		const idx = theme.indexOf("-webkit-touch-callout: none");
		expect(idx).toBeGreaterThan(0);
		const block = theme.slice(theme.lastIndexOf("\n\n", idx), idx);
		for (const sel of [".v-app-bar", ".register-rail", ".mobile-dock", ".action-band", ".card-item-card", ".pay-keypad"]) {
			expect(block, `${sel} is in the no-select block`).toContain(`.posapp ${sel}`);
		}
	});

	it("publishes the safe-area insets and lifts the dock above the home indicator", () => {
		expect(theme).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
		expect(rule(".posapp .mobile-dock")).toMatch(/padding-bottom:\s*var\(--safe-bottom\)/);
	});
});

describe("install affordance — wired once at boot, offered from the menu", () => {
	it("boot binds the deferred prompt before the app mounts", () => {
		expect(bootSource).toContain('import { bindInstallPrompt } from "./composables/core/useInstallPrompt";');
		expect(bootSource.indexOf("bindInstallPrompt();")).toBeLessThan(bootSource.indexOf("this.app = createApp(App);"));
	});

	it("the menu offers install on Chromium and the Share-sheet hint on iOS, each behind its gate", () => {
		expect(menuSource).toContain("installCanInstall: installPrompt.canInstall");
		expect(menuSource).toContain("installShowsIosHint: installPrompt.showsIosHint");
		expect(menuSource).toMatch(/this\.installCanInstall\s*\?\s*\{[\s\S]*?id: "install-app"/);
		expect(menuSource).toMatch(/this\.installShowsIosHint\s*\?\s*\{[\s\S]*?id: "add-to-home-screen"/);
		expect(menuSource).toContain('case "installApp":');
		for (const source of [
			"Install the app",
			"Open the register full screen, like an app",
			"Add to Home Screen",
			"Share → Add to Home Screen puts the register on your phone",
		]) {
			expect(menuSource).toContain(`__("${source}")`);
			expect(es.includes(`${source},`) || es.includes(`"${source}",`), `${source} has a Spanish row`).toBe(true);
		}
	});
});
