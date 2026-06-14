import { describe, it, expect } from "vitest";
import { isPlausibleVitalMs } from "../src/posapp/utils/telemetry";

// Web-vital sanity cap (MAX_WEBVITAL_MS = 60_000). Prod telemetry showed
// background-throttle artifacts (rum:inp 4,971,552 ms / 82 min, rum:lcp
// 3,568,076 ms / 59 min) that trashed max/p99 on the low-count vitals.
// The cap drops these at source; the server mirrors it in api/telemetry.py.
describe("isPlausibleVitalMs", () => {
	it("keeps realistic interaction/paint latencies", () => {
		expect(isPlausibleVitalMs(0)).toBe(true);
		expect(isPlausibleVitalMs(72)).toBe(true);
		expect(isPlausibleVitalMs(2578)).toBe(true);
		expect(isPlausibleVitalMs(60_000)).toBe(true);
	});

	it("drops background-throttle artifacts above the cap", () => {
		expect(isPlausibleVitalMs(60_000.1)).toBe(false);
		expect(isPlausibleVitalMs(4_971_552)).toBe(false); // real prod INP outlier
		expect(isPlausibleVitalMs(3_568_076)).toBe(false); // real prod LCP outlier
	});

	it("drops impossible values", () => {
		expect(isPlausibleVitalMs(-1)).toBe(false);
		expect(isPlausibleVitalMs(NaN)).toBe(false);
		expect(isPlausibleVitalMs(Infinity)).toBe(false);
	});
});
