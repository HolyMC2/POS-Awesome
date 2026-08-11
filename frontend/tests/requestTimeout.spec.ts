import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEFAULT_REQUEST_TIMEOUT_MS,
	RequestTimeoutError,
	isRequestTimeoutError,
	withRequestTimeout,
} from "../src/posapp/utils/requestTimeout";

describe("withRequestTimeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("passes a response straight through", async () => {
		await expect(
			withRequestTimeout(Promise.resolve({ message: "ok" }), "probe"),
		).resolves.toEqual({ message: "ok" });
	});

	it("rejects when the request never settles — the wedge this exists for", async () => {
		const neverSettles = new Promise(() => {});
		const pending = withRequestTimeout(neverSettles as Promise<never>, "items.get_items", 1_000);
		const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);

		await vi.advanceTimersByTimeAsync(1_000);
		await assertion;
	});

	it("names the call it gave up on", async () => {
		const pending = withRequestTimeout(new Promise(() => {}) as Promise<never>, "sync_items", 500);
		const assertion = pending.catch((error) => error);

		await vi.advanceTimersByTimeAsync(500);
		const error = await assertion;

		expect(isRequestTimeoutError(error)).toBe(true);
		expect(error.label).toBe("sync_items");
		expect(error.timeoutMs).toBe(500);
	});

	it("propagates a real failure unchanged", async () => {
		const failure = new Error("ValidationError");
		await expect(withRequestTimeout(Promise.reject(failure), "probe")).rejects.toBe(
			failure,
		);
	});

	it("accepts a factory so the call starts inside the race", async () => {
		const factory = vi.fn(async () => "late");
		await expect(withRequestTimeout(factory, "probe")).resolves.toBe("late");
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("leaves no timer behind when the request wins", async () => {
		await withRequestTimeout(Promise.resolve(1), "probe", DEFAULT_REQUEST_TIMEOUT_MS);
		expect(vi.getTimerCount()).toBe(0);
	});
});
