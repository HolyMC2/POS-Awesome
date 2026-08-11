// @vitest-environment jsdom
// jsdom because floorClock is imported alongside the floor components in the
// app, and the store module chain it sits next to reads `window.__` at import
// time.
import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	LATE_AFTER_MIN,
	RING_FULL_MIN,
	TICK_MS,
	WARM_AFTER_MIN,
	ageStep,
	ageTurn,
	formatIdleShort,
	idleMinutes,
	parseServerTime,
	useFloorClock,
} from "../src/posapp/components/floor/floorClock";

afterEach(() => {
	vi.useRealTimers();
});

describe("parseServerTime", () => {
	it("reads Frappe's space-separated stamp as LOCAL time", () => {
		// Frappe stores naive datetimes in the site's timezone and a POS terminal
		// sits in the venue it bills for. Building the expectation from a local
		// Date keeps this assertion true in every CI timezone — pinning a fixed
		// epoch would pass only where it was written.
		const local = new Date(2026, 7, 11, 12, 30, 0);
		expect(parseServerTime("2026-08-11 12:30:00")).toBe(local.getTime());
	});

	it("returns null for the absent and the unparseable", () => {
		expect(parseServerTime(null)).toBeNull();
		expect(parseServerTime(undefined)).toBeNull();
		expect(parseServerTime("")).toBeNull();
		expect(parseServerTime("not a date")).toBeNull();
	});
});

describe("idleMinutes", () => {
	const at = new Date(2026, 7, 11, 13, 0, 0).getTime();

	it("counts whole minutes since the row last changed", () => {
		expect(idleMinutes("2026-08-11 12:30:00", at)).toBe(30);
		expect(idleMinutes("2026-08-11 12:59:30", at)).toBe(0);
	});

	it("is null when the order has never been written by the server", () => {
		// An order queued offline carries no `modified`, and inventing an age for
		// it would put a red ring on a ticket nobody has been ignoring.
		expect(idleMinutes(null, at)).toBeNull();
	});

	it("floors clock skew at zero rather than showing a negative age", () => {
		expect(idleMinutes("2026-08-11 13:05:00", at)).toBe(0);
	});
});

describe("ageStep", () => {
	it("escalates at the two thresholds and treats unknown as fresh", () => {
		expect(ageStep(null)).toBe("fresh");
		expect(ageStep(0)).toBe("fresh");
		expect(ageStep(WARM_AFTER_MIN - 1)).toBe("fresh");
		expect(ageStep(WARM_AFTER_MIN)).toBe("warm");
		expect(ageStep(LATE_AFTER_MIN - 1)).toBe("warm");
		expect(ageStep(LATE_AFTER_MIN)).toBe("late");
	});
});

describe("ageTurn", () => {
	it("sweeps to a full turn and stops there", () => {
		expect(ageTurn(null)).toBe(0);
		expect(ageTurn(0)).toBe(0);
		expect(ageTurn(RING_FULL_MIN / 2)).toBeCloseTo(0.5);
		expect(ageTurn(RING_FULL_MIN)).toBe(1);
		// Past full the ring must not wrap — a two-hour ticket that reads as
		// "just seated" is worse than no ring at all.
		expect(ageTurn(RING_FULL_MIN * 4)).toBe(1);
	});
});

describe("formatIdleShort", () => {
	it("uses minutes up to the hour and h:mm past it", () => {
		expect(formatIdleShort(null)).toBe("");
		expect(formatIdleShort(0)).toBe("0′");
		expect(formatIdleShort(59)).toBe("59′");
		expect(formatIdleShort(60)).toBe("1:00");
		expect(formatIdleShort(125)).toBe("2:05");
	});
});

describe("useFloorClock", () => {
	it("shares one interval and stops it when the last watcher leaves", () => {
		vi.useFakeTimers();
		const intervals = vi.spyOn(globalThis, "setInterval");
		const clears = vi.spyOn(globalThis, "clearInterval");

		const first = effectScope();
		const second = effectScope();
		let now: ReturnType<typeof useFloorClock>["now"] | null = null;
		first.run(() => {
			now = useFloorClock().now;
		});
		second.run(() => {
			useFloorClock();
		});

		// Forty tiles must not mean forty wakeups a minute on a tablet that has
		// to stay responsive all shift.
		expect(intervals).toHaveBeenCalledTimes(1);

		const before = now!.value;
		vi.advanceTimersByTime(TICK_MS);
		expect(now!.value).toBeGreaterThan(before);

		first.stop();
		expect(clears).not.toHaveBeenCalled();
		second.stop();
		expect(clears).toHaveBeenCalled();
	});
});
