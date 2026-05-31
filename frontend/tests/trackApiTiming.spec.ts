// @vitest-environment jsdom
//
// trackApiTiming pushes onto the telemetry buffer via the module-private
// `push`, which early-returns unless a `window` exists (RUM opt-in gate).
// jsdom supplies that window so the buffer actually fills under test.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
	trackApiTiming,
	__getBufferForTest,
} from "../src/posapp/utils/telemetry";

// Locks the single source of per-method API latency timing:
// telemetry.trackApiTiming, which the /posapp frappe-shim frappeCall
// feeds on every call. Hot methods are always recorded; cold methods are
// sampled at ~10% to bound volume; the function must never throw into the
// caller (telemetry is best-effort).
//
// trackApiTiming pushes onto the module-internal telemetry buffer; we
// assert via the exported __getBufferForTest() inspector. No network /
// flush is involved here — the buffer is the unit boundary.

// __getBufferForTest() returns a copy, so we assert on relative
// before/after lengths + the last pushed event rather than clearing.
afterEach(() => {
	vi.restoreAllMocks();
});

function lastEvent(): { event_name: string; value?: number } | undefined {
	const buf = __getBufferForTest();
	return buf[buf.length - 1];
}

describe("telemetry.trackApiTiming — single timing source", () => {
	it("emits perf:api.<label>.ok for a hot method, prefix stripped", () => {
		const before = __getBufferForTest().length;
		trackApiTiming(
			"posawesome.posawesome.api.items.search_items",
			true,
			12,
		);
		const buf = __getBufferForTest();
		expect(buf.length).toBe(before + 1);
		expect(lastEvent()?.event_name).toBe("perf:api.items.search_items.ok");
		expect(typeof lastEvent()?.value).toBe("number");
	});

	it("emits perf:api.<label>.err for a hot method on failure", () => {
		trackApiTiming(
			"posawesome.posawesome.api.invoices.submit_invoice",
			false,
			34,
		);
		expect(lastEvent()?.event_name).toBe(
			"perf:api.invoices.submit_invoice.err",
		);
	});

	it("always records hot methods regardless of the sample roll", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.99); // would skip a cold one
		const before = __getBufferForTest().length;
		trackApiTiming(
			"posawesome.posawesome.api.invoices.update_invoice",
			true,
			7,
		);
		expect(__getBufferForTest().length).toBe(before + 1);
		expect(lastEvent()?.event_name).toBe(
			"perf:api.invoices.update_invoice.ok",
		);
	});

	it("samples cold methods at ~10% — skips when roll >= 0.1", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const before = __getBufferForTest().length;
		trackApiTiming("posawesome.posawesome.api.utilities.ping", true, 5);
		expect(__getBufferForTest().length).toBe(before);
	});

	it("records cold methods when the roll passes (< 0.1)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.0);
		trackApiTiming("posawesome.posawesome.api.utilities.ping", true, 5);
		expect(lastEvent()?.event_name).toBe("perf:api.utilities.ping.ok");
	});

	it("leaves non-posawesome method labels unstripped", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.0);
		trackApiTiming("frappe.client.get_value", true, 3);
		expect(lastEvent()?.event_name).toBe("perf:api.frappe.client.get_value.ok");
	});

	it("never throws on a falsy method name and records nothing", () => {
		const before = __getBufferForTest().length;
		expect(() => trackApiTiming("", true, 1)).not.toThrow();
		expect(__getBufferForTest().length).toBe(before);
	});
});
