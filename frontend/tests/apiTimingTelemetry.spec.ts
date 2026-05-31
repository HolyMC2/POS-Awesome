import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// As of the 2026-05 relocation, per-method API latency timing lives at
// the single universal chokepoint: the /posapp frappe-shim `frappeCall`,
// via `telemetry.trackApiTiming`. This covers ALL call paths — both the
// few services that go through `api.callEnvelope` AND the ~50 direct
// `frappe.call` sites (update_invoice / submit_invoice / get_items / …)
// that never touched callEnvelope. Before this, only callEnvelope emitted
// timings, so the telemetry table had ZERO perf:api rows.
//
// This suite locks the callEnvelope side of that contract: callEnvelope
// MUST NOT emit timing itself anymore (the shim it calls into already
// times — self-timing here would double-count on /posapp). The shim's
// trackApiTiming behavior is covered in `trackApiTiming.spec.ts`.

const trackCustomMarkMock = vi.fn();
const trackApiTimingMock = vi.fn();

vi.mock("../src/posapp/utils/telemetry", () => ({
	trackCustomMark: (...args: unknown[]) => trackCustomMarkMock(...args),
	trackApiTiming: (...args: unknown[]) => trackApiTimingMock(...args),
	track: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
	updateContext: vi.fn(),
}));

let frappeCallMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	trackCustomMarkMock.mockClear();
	trackApiTimingMock.mockClear();
	frappeCallMock = vi.fn();
	(globalThis as any).frappe = { call: frappeCallMock };
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("api callEnvelope no longer self-times (single source = shim)", () => {
	it("does NOT emit a per-method timing mark on success", async () => {
		const apiModule = await import("../src/posapp/services/api");
		const api = apiModule.default;

		frappeCallMock.mockImplementation((opts: any) => {
			opts.callback({ message: { ok: true, data: { value: 1 } } });
		});

		const envelope = await api.callEnvelope(
			"posawesome.posawesome.api.items.search_items",
			{},
		);

		expect(envelope.ok).toBe(true);
		// No double-counting: timing belongs to the shim frappeCall.
		expect(trackCustomMarkMock).not.toHaveBeenCalled();
		expect(trackApiTimingMock).not.toHaveBeenCalled();
	});

	it("does NOT emit a per-method timing mark on HTTP error", async () => {
		const apiModule = await import("../src/posapp/services/api");
		const api = apiModule.default;

		frappeCallMock.mockImplementation((opts: any) => {
			opts.error({ status: 417, message: "fail" });
		});

		const envelope = await api.callEnvelope(
			"posawesome.posawesome.api.items.get_items",
			{},
		);

		expect(envelope.ok).toBe(false);
		expect(trackCustomMarkMock).not.toHaveBeenCalled();
		expect(trackApiTimingMock).not.toHaveBeenCalled();
	});
});
