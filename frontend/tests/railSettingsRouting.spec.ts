// @vitest-environment jsdom

/**
 * The rail names a setting; the navbar's actions menu runs it.
 *
 * The load-bearing claim is that there is exactly ONE list. `NavbarMenu` owns
 * the dialogs AND the gating that decides an entry exists — silent print for
 * the QZ setup, supervisor for the dashboard — so the rail's «Más» flyout
 * carries ids and nothing else. If `RAIL_SETTING_IDS` ever stops matching that
 * menu's action ids, four rail entries become four rows that do nothing at
 * all, silently, and no type would notice: the ids are strings on both sides.
 *
 * The computeds are called with a fake `this` rather than mounted, the same
 * technique as `cfdiNavbarGating.spec.ts` — mounting drags Vuetify, the print
 * health monitor and a language round trip in for a lookup table.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import NavbarMenu from "../src/posapp/components/navbar/NavbarMenu.vue";
import {
	RAIL_SETTING_IDS,
	visibleRailSettings,
} from "../src/posapp/composables/pos/shell/railSettings";

const options = NavbarMenu as unknown as {
	computed: Record<string, (this: Record<string, unknown>) => unknown>;
	methods: Record<string, (this: Record<string, unknown>, ...args: unknown[]) => unknown>;
};

type Action = { id: string; handler: string; disabled?: boolean };

/** The menu's own action list, computed the way the component computes it. */
function menuActions(posProfile: Record<string, unknown>, isSupervisor = true): Action[] {
	const ctx: Record<string, unknown> = {
		posProfile,
		cashierName: "Ana",
		manualOffline: false,
		networkOnline: true,
		serverOnline: true,
		currentCashier: { is_supervisor: isSupervisor },
		externalDocumentCheckout: false,
		verticalStore: { externalDocumentCheckout: false },
		$theme: { isDark: { value: false } },
		isEnabledSetting: (value: unknown) => Boolean(Number(value)),
		__: (text: string) => text,
	};
	ctx.quickActions = options.computed.quickActions.call(ctx);
	ctx.settingsSections = options.computed.settingsSections.call(ctx);
	ctx.showSupervisorSection = options.computed.showSupervisorSection.call(ctx);
	ctx.supervisorSections = options.computed.supervisorSections.call(ctx);
	return options.computed.menuActions.call(ctx) as Action[];
}

describe("every rail setting id is a navbar menu action id", () => {
	beforeEach(() => {
		(globalThis as { __?: (t: string) => string }).__ = (text: string) => text;
	});

	it("resolves all four on a register that prints through QZ", () => {
		const ids = menuActions({ posa_silent_print: 1 }).map((action) => action.id);
		for (const id of RAIL_SETTING_IDS) {
			expect(ids, `the rail offers "${id}" and the navbar menu has no such action`).toContain(id);
		}
	});

	it("drops the printer entry on both sides of the same flag", () => {
		// The gate lives in NavbarMenu; the rail must not carry a second copy
		// that could answer differently on the same register.
		const ids = menuActions({ posa_silent_print: 0 }).map((action) => action.id);
		expect(ids).not.toContain("qz-tray-setup");
		expect(visibleRailSettings(false).map((setting) => setting.id)).not.toContain("qz-tray-setup");
	});
});

describe("running an action named from elsewhere", () => {
	const run = (id: unknown, actions: Action[]) => {
		const handleAction = vi.fn();
		options.methods.runMenuAction.call({ menuActions: actions, handleAction }, id);
		return handleAction;
	};

	it("routes the id through this menu's own handler", () => {
		const actions = menuActions({ posa_silent_print: 1 });
		const handleAction = run({ id: "about" }, actions);

		expect(handleAction).toHaveBeenCalledTimes(1);
		// The action object, not the id: `handleAction` switches on `handler`,
		// which is what keeps the dialog in one place.
		expect((handleAction.mock.calls[0]![0] as Action).handler).toBe("showAboutAction");
	});

	it("takes the id bare as well as wrapped, since the bus carries a payload", () => {
		const actions = menuActions({ posa_silent_print: 1 });
		expect(run("language", actions)).toHaveBeenCalledTimes(1);
	});

	it("does nothing for an entry this register has gated off", () => {
		// A browser-print terminal has no QZ setup action. Naming it must be a
		// no-op, not a dialog for a printer that is not there.
		const actions = menuActions({ posa_silent_print: 0 });
		expect(run("qz-tray-setup", actions)).not.toHaveBeenCalled();
		expect(run("not-an-action", actions)).not.toHaveBeenCalled();
		expect(run(undefined, actions)).not.toHaveBeenCalled();
	});
});
