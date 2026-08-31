// @vitest-environment jsdom

/**
 * The register's haptics (native-feel round 2, owner 2026-08-30: «a short
 * haptic tick on add / step / cobrar»).
 *
 * Two halves, and the second is the one that matters on a shop floor:
 *
 *  1. The PATTERNS — a tick is one pulse, a confirm is a light double, a warn
 *     is a heavier one, and each fires only where the register already treats
 *     something as having happened.
 *  2. The GUARDS. `navigator.vibrate` does not exist on any iOS browser, a
 *     desk register on a mouse must never buzz, and a shop that turns haptics
 *     off must stay off. Every one of those is a crash or a complaint on the
 *     ADD path — the hottest code in the app — so they are asserted as
 *     behaviour, not documented as intent.
 *
 * The call sites are pinned by source rather than driven through a mount: the
 * claim is "the buzz happens where the engine decided, and nowhere else", and
 * a render can only ever show that one path did it today.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `?raw` and not `node:fs`: this suite needs jsdom for `navigator.vibrate` and
// `localStorage`, and `node:fs`/`node:path` named imports do not interop under
// it (build plan §10 — the reason `movilExplorarSource.spec.ts` is a separate
// file from `movilExplorarScreen.spec.ts`).
import ShellSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import LineSheetSource from "../src/posapp/components/pos/mobile/line/MovilLineSheet.vue?raw";
import LotPickerSource from "../src/posapp/components/pos/items/lot/LotPicker.vue?raw";
import PaymentsSource from "../src/posapp/components/pos/Payments.vue?raw";
import HapticsSource from "../src/posapp/utils/haptics.ts?raw";

type Vibrate = ReturnType<typeof vi.fn>;

/**
 * The module caches nothing, so a fresh import per test is not needed — but
 * the guards read `window.matchMedia`, `localStorage` and `navigator.vibrate`
 * at CALL time, and each test rebuilds exactly the environment it is about.
 */
const loadHaptics = async () => await import("../src/posapp/utils/haptics");

const setPointer = (kind: "coarse" | "fine" | "none") => {
	if (kind === "none") {
		// jsdom ships no matchMedia at all unless a spec installs one; that is
		// also the state a bare offline shell boots in.
		delete (window as unknown as Record<string, unknown>).matchMedia;
		return;
	}
	window.matchMedia = ((query: string) => ({
		matches: query.includes(`pointer: ${kind}`),
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	})) as unknown as typeof window.matchMedia;
};

const installVibrate = (): Vibrate => {
	const vibrate = vi.fn(() => true);
	Object.defineProperty(navigator, "vibrate", {
		value: vibrate,
		configurable: true,
		writable: true,
	});
	return vibrate;
};

const removeVibrate = () => {
	Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
};

beforeEach(() => {
	localStorage.clear();
	setPointer("coarse");
});

afterEach(() => {
	removeVibrate();
	vi.restoreAllMocks();
});

describe("a hand on the glass gets the pattern", () => {
	it("ticks once, briefly, for an add or a step", async () => {
		const vibrate = installVibrate();
		const { tick, HAPTIC_TICK } = await loadHaptics();

		expect(tick()).toBe(true);
		expect(vibrate).toHaveBeenCalledTimes(1);
		expect(vibrate).toHaveBeenCalledWith(HAPTIC_TICK);
		// Short enough to read as a tick rather than a buzz.
		expect(HAPTIC_TICK).toBeLessThanOrEqual(15);
	});

	it("doubles for money landing", async () => {
		const vibrate = installVibrate();
		const { confirm, HAPTIC_CONFIRM } = await loadHaptics();

		expect(confirm()).toBe(true);
		expect(vibrate).toHaveBeenCalledWith([...HAPTIC_CONFIRM]);
		expect(HAPTIC_CONFIRM).toEqual([10, 30, 10]);
	});

	it("says something heavier for a line leaving the ticket", async () => {
		const vibrate = installVibrate();
		const { warn, HAPTIC_WARN } = await loadHaptics();

		expect(warn()).toBe(true);
		expect(vibrate).toHaveBeenCalledWith([...HAPTIC_WARN]);
		// Distinguishable from the confirm by feel, not only by name.
		expect(HAPTIC_WARN).not.toEqual([10, 30, 10]);
	});

	it("hands `vibrate` a copy, never the exported constant", async () => {
		// Some engines have historically kept the array they were given. A
		// mutated `HAPTIC_CONFIRM` would silently change every later buzz.
		const vibrate = installVibrate();
		const { confirm, HAPTIC_CONFIRM } = await loadHaptics();

		confirm();
		const handed = vibrate.mock.calls[0]?.[0] as number[];
		expect(handed).not.toBe(HAPTIC_CONFIRM);
		expect(handed).toEqual([...HAPTIC_CONFIRM]);
	});
});

describe("the guards", () => {
	it("never buzzes a mouse", async () => {
		const vibrate = installVibrate();
		setPointer("fine");
		const { tick, confirm, warn, hapticsAvailable } = await loadHaptics();

		expect(hapticsAvailable()).toBe(false);
		expect(tick()).toBe(false);
		expect(confirm()).toBe(false);
		expect(warn()).toBe(false);
		expect(vibrate).not.toHaveBeenCalled();
	});

	it("stays quiet where the shop opted out", async () => {
		const vibrate = installVibrate();
		const { tick, HAPTICS_OPT_OUT_KEY, HAPTICS_OPT_OUT_VALUE } = await loadHaptics();
		localStorage.setItem(HAPTICS_OPT_OUT_KEY, HAPTICS_OPT_OUT_VALUE);

		expect(tick()).toBe(false);
		expect(vibrate).not.toHaveBeenCalled();
	});

	it("treats any other stored value as consent", async () => {
		const vibrate = installVibrate();
		const { tick, HAPTICS_OPT_OUT_KEY } = await loadHaptics();
		localStorage.setItem(HAPTICS_OPT_OUT_KEY, "on");

		expect(tick()).toBe(true);
		expect(vibrate).toHaveBeenCalledTimes(1);
	});

	it("does not throw where the API is missing — every iOS browser", async () => {
		removeVibrate();
		const { tick, confirm, warn, hapticsAvailable } = await loadHaptics();

		expect(hapticsAvailable()).toBe(false);
		expect(() => tick()).not.toThrow();
		expect(() => confirm()).not.toThrow();
		expect(() => warn()).not.toThrow();
		expect(tick()).toBe(false);
	});

	it("does not throw where `matchMedia` is missing", async () => {
		installVibrate();
		setPointer("none");
		const { tick } = await loadHaptics();

		expect(() => tick()).not.toThrow();
		// No way to know a finger is on the glass — so it does not guess.
		expect(tick()).toBe(false);
	});

	it("does not throw when the platform rejects the pattern", async () => {
		Object.defineProperty(navigator, "vibrate", {
			value: () => {
				throw new TypeError("nope");
			},
			configurable: true,
		});
		const { confirm } = await loadHaptics();

		expect(() => confirm()).not.toThrow();
		expect(confirm()).toBe(false);
	});

	it("does not throw when storage itself throws — a Safari private window", async () => {
		const vibrate = installVibrate();
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("denied", "SecurityError");
		});
		const { tick } = await loadHaptics();

		expect(() => tick()).not.toThrow();
		// Storage failing is not consent withdrawn.
		expect(tick()).toBe(true);
		expect(vibrate).toHaveBeenCalled();
	});
});

describe("the call sites are the engine's own events", () => {
	it("ticks on the phone's ONE tap-add, beside the `add_item` emit", () => {
		const shell = ShellSource;

		expect(shell).toContain('import { tick as hapticTick } from "../../../utils/haptics";');
		// The doorbell branches above it — a template opens the variant picker,
		// a lot-tracked row opens the lot picker — must NOT buzz: nothing has
		// been added yet. So the tick has to sit on the emit, not on the click.
		expect(shell).toMatch(
			/hapticTick\(\);\n\t*eventBus\.emit\("add_item", row \? \{ \.\.\.row \} : \{ item_code: code \}\);/,
		);
		expect(shell.match(/hapticTick\(\)/g) ?? []).toHaveLength(1);
	});

	it("ticks on the line sheet's ± and warns on its remove, AFTER the gate", () => {
		const sheet = LineSheetSource;

		expect(sheet).toContain('import { tick, warn } from "../../../../utils/haptics";');
		// A disabled ± that buzzes tells the hand a quantity moved when it did
		// not — the gate has to come first.
		expect(sheet).toMatch(
			/if \(delta > 0 \? !props\.line\.canStepUp : !props\.line\.canStepDown\) return;\n\ttick\(\);/,
		);
		expect(sheet).toMatch(/const remove = \(\) => \{\n\twarn\(\);/);
	});

	it("ticks on the lot picker's confirm, behind `canAdd`", () => {
		const picker = LotPickerSource;

		expect(picker).toContain('import { tick } from "../../../../utils/haptics";');
		expect(picker).toMatch(/if \(!canAdd\.value\) return;[\s\S]{0,400}?\n\ttick\(\);\n\temit\("confirm"/);
	});

	it("confirms on the phone's collect only once the invoice actually exists", () => {
		const payments = PaymentsSource;

		expect(payments).toContain(
			'import { confirm as hapticConfirm } from "../../utils/haptics";',
		);
		// `submitInvoiceWrapper` swallows a failure into a toast, so awaiting
		// `submit` cannot tell success from failure. `onSuccess` can.
		expect(payments).toMatch(/movilCollectPending = true;\n\tnextTick\(\(\) => \{\n\t\tsubmit\(/);
		expect(payments).toMatch(
			/if \(movilCollectPending\) \{\n\t*movilCollectPending = false;\n\t*hapticConfirm\(\);/,
		);
		// Disarmed on every exit, or the NEXT submission inherits the buzz.
		expect(payments).toMatch(/} finally \{[\s\S]{0,400}?movilCollectPending = false;/);
	});

	it("is the only thing in the app that calls `navigator.vibrate`", () => {
		// One guarded door. A second call site is a second place to forget the
		// pointer check, and it would buzz a desk register.
		const module = HapticsSource;
		expect(module.match(/navigator\.vibrate\(/g) ?? []).toHaveLength(1);
	});
});
