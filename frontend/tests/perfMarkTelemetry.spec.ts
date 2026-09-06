// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/utils/telemetry", () => ({
	trackCustomMark: vi.fn(),
}));

import { perfMarkEnd, perfMarkStart, withPerf } from "../src/posapp/utils/perf";
import { trackCustomMark } from "../src/posapp/utils/telemetry";

const tracked = trackCustomMark as unknown as ReturnType<typeof vi.fn>;

describe("perfMark pair ambient telemetry", () => {
	beforeEach(() => {
		tracked.mockClear();
		(window as any).__PROF__ = false;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("emits sampled duration telemetry with __PROF__ off", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.05);
		const nowSpy = vi
			.spyOn(performance, "now")
			.mockReturnValueOnce(1000)
			.mockReturnValueOnce(1042);

		const token = perfMarkStart("pos:scan-process");
		perfMarkEnd("pos:scan-process", token);

		expect(tracked).toHaveBeenCalledWith("pos:scan-process", 42);
		nowSpy.mockRestore();
	});

	it("drops samples outside the 10% window", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const token = perfMarkStart("pos:scan-process");
		perfMarkEnd("pos:scan-process", token);
		expect(tracked).not.toHaveBeenCalled();
	});

	it.each([0.05, 0.5])("emits one event per wrapped operation with sample %s", (sample) => {
		vi.spyOn(Math, "random").mockReturnValue(sample);
		vi.spyOn(performance, "now").mockReturnValueOnce(1000)
			.mockReturnValueOnce(1000).mockReturnValue(1010);
		expect(withPerf("pos:add-item", () => 42)()).toBe(42);
		expect(tracked).toHaveBeenCalledTimes(1);
		expect(tracked).toHaveBeenCalledWith("pos:add-item", 10);
	});

	it("emits one event when a wrapped async operation settles", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		vi.spyOn(performance, "now").mockReturnValueOnce(1000)
			.mockReturnValueOnce(1000).mockReturnValue(1020);
		await expect(withPerf("pos:load", async () => "loaded")()).resolves.toBe("loaded");
		expect(tracked).toHaveBeenCalledTimes(1);
		expect(tracked).toHaveBeenCalledWith("pos:load", 20);
	});

	it("drops sub-threshold durations", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.0);
		const nowSpy = vi
			.spyOn(performance, "now")
			.mockReturnValueOnce(1000)
			.mockReturnValueOnce(1000.4);
		const token = perfMarkStart("pos:totals-gross");
		perfMarkEnd("pos:totals-gross", token);
		expect(tracked).not.toHaveBeenCalled();
		nowSpy.mockRestore();
	});

	it("tolerates the legacy string start-mark without telemetry", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.0);
		expect(() => perfMarkEnd("pos:legacy", "pos:legacy-start")).not.toThrow();
		expect(() => perfMarkEnd("pos:legacy", null)).not.toThrow();
		expect(tracked).not.toHaveBeenCalled();
	});

	it("still records DevTools measures under __PROF__", () => {
		(window as any).__PROF__ = true;
		vi.spyOn(Math, "random").mockReturnValue(0.05);
		const measure = vi.spyOn(performance, "measure");

		const token = perfMarkStart("pos:scan-process");
		expect(token.mark).toBe("pos:scan-process-start");
		perfMarkEnd("pos:scan-process", token);

		expect(measure).toHaveBeenCalledWith(
			"pos:scan-process",
			"pos:scan-process-start",
			"pos:scan-process-end",
		);
		// telemetry emission under __PROF__ follows the same sampling rules
		// asserted above; real performance.now here makes elapsed <1ms, so
		// no tracked call is expected in this test.
	});
});
