/**
 * The settings group in the rail's «Más» flyout (§17.7 addendum).
 *
 * The rail replaced the hamburger drawer as the desktop navigation, but the
 * settings the drawer used to reach stayed in the navbar's actions menu — so a
 * cashier standing at the rail had to go back up to the top bar to change the
 * language or check for an update. The flyout now carries four of those
 * entries and none of their dialogs: each names a `NavbarMenu` action id and
 * that menu opens its own.
 *
 * This file covers the pure half — which entries exist, and what the register's
 * state does to them. The routing (`run_menu_action` → the navbar menu's own
 * handler) is `railSettingsRouting.spec.ts`, which needs a component.
 *
 * No jsdom: the module is pure, and the template scans below read real files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	RAIL_SETTING_IDS,
	RAIL_SETTINGS,
	resolveRailSettings,
	visibleRailSettings,
} from "../src/posapp/composables/pos/shell/railSettings";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

const resolveWith = (overrides: Partial<Parameters<typeof resolveRailSettings>[0]> = {}) =>
	resolveRailSettings({
		__: (key) => key,
		silentPrint: true,
		offline: false,
		railDisabled: false,
		...overrides,
	});

describe("what the settings group offers", () => {
	it("renders the four entries in registry order", () => {
		expect(resolveWith().map((setting) => setting.id)).toEqual([...RAIL_SETTING_IDS]);
	});

	it("gives every entry a label and a line saying what it is for", () => {
		// A tools-flyout row is 54px of copy, not a pill: an entry with no hint
		// is a row that looks broken beside the four that have one.
		for (const setting of resolveWith()) {
			expect(setting.label.trim().length).toBeGreaterThan(0);
			expect(setting.hint.trim().length).toBeGreaterThan(0);
		}
	});

	it("hides the printer entry on a register that does not print through QZ", () => {
		// Absent, not disabled — the same rule the destinations follow: a
		// register that cannot do a thing should not advertise it.
		expect(visibleRailSettings(false).map((s) => s.id)).not.toContain("qz-tray-setup");
		expect(visibleRailSettings(true).map((s) => s.id)).toContain("qz-tray-setup");
		expect(resolveWith({ silentPrint: false }).map((s) => s.id)).not.toContain("qz-tray-setup");
	});

	it("translates through the caller, never through a global of its own", () => {
		// Same rule as railDestinations.ts: the registry stays free of `__()` so
		// it can be read in a test and resolved on the server later.
		const shouted = resolveWith({ __: (key) => key.toUpperCase() });
		expect(shouted[0]!.label).toBe(shouted[0]!.label.toUpperCase());
		expect(shouted[0]!.hint).toBe(shouted[0]!.hint.toUpperCase());
	});
});

describe("what the register's state does to them", () => {
	it("dims only what genuinely needs the server while offline", () => {
		const offline = resolveWith({ offline: true });
		const byId = new Map(offline.map((setting) => [setting.id, setting]));

		expect(byId.get("check-for-updates")!.dimmed).toBe(true);
		expect(byId.get("check-for-updates")!.disabled).toBe(true);
		// QZ is a local websocket and About reads the boot payload. Dimming
		// them would teach the cashier that the dot means "probably broken".
		expect(byId.get("qz-tray-setup")!.dimmed).toBe(false);
		expect(byId.get("about")!.dimmed).toBe(false);
		expect(byId.get("language")!.dimmed).toBe(false);
	});

	it("says why in words, because the amber dot is aria-hidden", () => {
		const offline = resolveWith({ offline: true });
		const updates = offline.find((setting) => setting.id === "check-for-updates")!;
		expect(updates.ariaLabel).toContain("Needs connection");
		expect(offline.find((s) => s.id === "about")!.ariaLabel).toBe("About");
	});

	it("goes inert with the rest of the rail until the shift opens", () => {
		const closed = resolveWith({ railDisabled: true });
		for (const setting of closed) {
			expect(setting.disabled).toBe(true);
			expect(setting.ariaLabel).toContain("Shift not open");
		}
		// The closed shift is the louder reason: reporting "needs connection"
		// there would send a cashier to fix the network instead of opening up.
		const both = resolveWith({ railDisabled: true, offline: true });
		expect(both.find((s) => s.id === "check-for-updates")!.ariaLabel).not.toContain(
			"Needs connection",
		);
	});
});

describe("the flyout draws them as a second group", () => {
	const TOOLS_MENU = read("../src/posapp/components/pos/shell/rail/RailToolsMenu.vue");

	it("separates them from the tools with a rule and a title", () => {
		// The group above is pages; this one is dialogs. Running them together
		// would make "About" look like a destination the rail can go to.
		expect(TOOLS_MENU).toContain('class="register-rail__flyout-divider"');
		expect(TOOLS_MENU).toMatch(/register-rail__flyout-title">\{\{ __\("Settings"\) \}\}/);
	});

	it("marks each row for the evidence lane the way the tools rows are marked", () => {
		expect(TOOLS_MENU).toContain(':data-rail-setting="setting.id"');
		expect(TOOLS_MENU).toContain(':aria-label="setting.ariaLabel"');
	});

	it("opens no dialog of its own", () => {
		// The whole reason the entries are ids: one copy of each dialog, in the
		// navbar menu that already owns it and already gates it.
		for (const forbidden of ["QzTrayDialog", "AboutDialog", "v-dialog", "showLanguageDialog"]) {
			expect(TOOLS_MENU, `the flyout must name an action, not raise ${forbidden}`).not.toContain(
				forbidden,
			);
		}
	});
});

describe("the shell carries the choice, and nothing else does", () => {
	const SHELL = read("../src/posapp/components/pos/shell/Pos.vue");
	const NAVBAR_MENU = read("../src/posapp/components/navbar/NavbarMenu.vue");

	it("emits the id on the injected bus rather than a module-imported one", () => {
		// A module-imported `bus` inside a lazily-loaded chunk is a SECOND mitt
		// instance, and the navbar would never hear it.
		expect(SHELL).toMatch(/eventBus\.emit\("run_menu_action"/);
		expect(SHELL).toMatch(/<RegisterRail[\s\S]{0,120}@setting="openRegisterSetting"/);
	});

	it("registers and releases the listener with the same handler", () => {
		// A bare `off("run_menu_action")` would take every listener for the
		// event with it, including one another component registered.
		expect(NAVBAR_MENU).toMatch(/on\?\.\("run_menu_action", this\.menuActionHandler\)/);
		expect(NAVBAR_MENU).toMatch(/off\?\.\("run_menu_action", this\.menuActionHandler\)/);
	});

	it("asks the same flag the navbar menu asks about the printer", () => {
		// Two menus offering different printer entries on one register is the
		// drift this pins: both read `posa_silent_print`.
		expect(SHELL).toMatch(/silentPrint:\s*computed\(\(\)\s*=>[\s\S]{0,80}posa_silent_print/);
		expect(NAVBAR_MENU).toContain("posa_silent_print");
		expect(RAIL_SETTINGS.find((s) => s.id === "qz-tray-setup")!.gate).toBe("silentPrint");
	});
});
