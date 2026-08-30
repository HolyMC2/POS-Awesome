import { describe, expect, it } from "vitest";
import { resolveStaleShiftNotice } from "../src/posapp/components/pos/shift/staleShiftNotice";

describe("staleShiftNotice · the corte insists, never seizes (critique E4)", () => {
	it("a fresh shift raises nothing", () => {
		expect(resolveStaleShiftNotice(false, false)).toBeNull();
		expect(resolveStaleShiftNotice(false, true)).toBeNull();
	});

	it("a stale shift the profile tolerates warns without insisting", () => {
		const notice = resolveStaleShiftNotice(true, false);
		expect(notice?.tone).toBe("warning");
		expect(notice?.insist).toBe(false);
	});

	it("an enforced stale shift escalates and insists — sales are blocked", () => {
		const notice = resolveStaleShiftNotice(true, true);
		expect(notice?.tone).toBe("error");
		expect(notice?.insist).toBe(true);
		expect(notice?.messageKey).toContain("Sales are blocked");
	});

	it("the contract cannot express a seizure — insist is the strongest verb", () => {
		// The old behavior auto-opened the fullscreen corte from boot. The fix
		// is not "we no longer call it" but "the shape has no way to say it":
		// a future field like `autoOpenCorte` would have to widen this exact
		// key set, and this test is the tripwire that makes that a decision
		// rather than a drive-by.
		const notice = resolveStaleShiftNotice(true, true)!;
		expect(Object.keys(notice).sort()).toEqual([
			"insist",
			"messageKey",
			"titleKey",
			"tone",
		]);
	});
});
