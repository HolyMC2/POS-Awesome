// @vitest-environment jsdom
//
// Asserts that `api.callEnvelope` emits a `perf:api.<short-method>.<ok|err>`
// telemetry event after every settle. Telemetry table was missing app-perf
// events entirely before this wiring landed (only RUM web-vitals were
// flowing) — operators had no visibility into which API methods were
// slow. Regression here = back to flying blind.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trackCustomMarkMock = vi.fn();

vi.mock("../src/posapp/utils/telemetry", () => ({
	trackCustomMark: (...args: any[]) => trackCustomMarkMock(...args),
}));

// Import AFTER the mock so api.ts picks up the stub.
import api from "../src/posapp/services/api";

describe("api callEnvelope telemetry timing", () => {
	beforeEach(() => {
		trackCustomMarkMock.mockReset();
		vi.stubGlobal("frappe", {
			call: vi.fn(),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("emits perf:api.<method>.ok on success for a hot method", async () => {
		(frappe.call as any).mockImplementation(({ callback }: any) => {
			callback({ message: { foo: "bar" } });
		});

		await api.callEnvelope("posawesome.posawesome.api.invoices.submit_invoice");

		expect(trackCustomMarkMock).toHaveBeenCalledTimes(1);
		const [label, ms] = trackCustomMarkMock.mock.calls[0];
		expect(label).toBe("api.posa.invoices.submit_invoice.ok");
		expect(typeof ms).toBe("number");
		expect(ms).toBeGreaterThanOrEqual(0);
	});

	it("emits perf:api.<method>.err on HTTP error", async () => {
		(frappe.call as any).mockImplementation(({ error }: any) => {
			error({ status: 403, response: { exception: "PermissionError: nope" } });
		});

		await api.callEnvelope("posawesome.posawesome.api.invoices.update_invoice");

		expect(trackCustomMarkMock).toHaveBeenCalledTimes(1);
		expect(trackCustomMarkMock.mock.calls[0][0]).toBe(
			"api.posa.invoices.update_invoice.err",
		);
	});

	it("samples cold methods at ~10% to bound telemetry volume", async () => {
		(frappe.call as any).mockImplementation(({ callback }: any) => callback({ message: {} }));
		// Force-deterministic: always 0.5 → above 0.1 threshold, cold method drops.
		const rand = vi.spyOn(Math, "random").mockReturnValue(0.5);
		await api.callEnvelope("posawesome.posawesome.api.something.cold");
		expect(trackCustomMarkMock).not.toHaveBeenCalled();
		// Force-deterministic: 0.05 → below threshold, cold method emits.
		rand.mockReturnValue(0.05);
		await api.callEnvelope("posawesome.posawesome.api.something.cold");
		expect(trackCustomMarkMock).toHaveBeenCalledTimes(1);
	});

	it("never throws when telemetry itself raises (must not poison the request)", async () => {
		trackCustomMarkMock.mockImplementation(() => {
			throw new Error("telemetry blew up");
		});
		(frappe.call as any).mockImplementation(({ callback }: any) => callback({ message: { ok: 1 } }));

		// MUST resolve, not reject. Telemetry failures cannot kill submit.
		const r = await api.callEnvelope("posawesome.posawesome.api.invoices.submit_invoice");
		expect(r.ok).toBe(true);
	});
});
