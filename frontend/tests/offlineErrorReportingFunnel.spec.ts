/**
 * `reportOfflineFailure` — the offline layer's door into the client-error funnel
 * (LOGGING_MAP gap G10).
 *
 * It reuses the same dedupe map, payload builder and transport as the global
 * window/rejection/vue handlers, so an offline failure is bounded exactly the
 * way a JS crash is: 10 s per signature in the tab, then signature dedupe, a
 * 20-per-site-per-minute insert budget and an hour-long storm latch on the
 * server (`api/utilities.py::log_client_error`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportOfflineFailure } from "../src/posapp/utils/errorReporting";

const ERROR_LOG_METHOD = "posawesome.posawesome.api.utilities.log_client_error";

const frappeCall = vi.fn(() => Promise.resolve({}));

/** The payloads actually handed to the server, decoded. */
function sentPayloads() {
	return frappeCall.mock.calls.map((call: any) =>
		JSON.parse(call[0].args.payload),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	(globalThis as any).frappe = { call: frappeCall };
	// Every case uses a distinct scope: the dedupe map is module state that
	// survives between tests, exactly as it does between sales in one tab.
});

afterEach(() => {
	delete (globalThis as any).frappe;
});

describe("the payload", () => {
	it("is sent to log_client_error with the offline_error kind", () => {
		reportOfflineFailure("t.kind", new Error("indexeddb is gone"));

		expect(frappeCall).toHaveBeenCalledTimes(1);
		expect(frappeCall.mock.calls[0][0]).toMatchObject({
			method: ERROR_LOG_METHOD,
			quiet: true,
		});
		expect(sentPayloads()[0].kind).toBe("offline_error");
	});

	it("puts the scope in filename, which is what the server dedupes on", () => {
		reportOfflineFailure("t.scope", new Error("boom"));

		const payload = sentPayloads()[0];
		expect(payload.filename).toBe("t.scope");
		expect(payload.message).toContain("t.scope");
		expect(payload.message).toContain("Error");
		expect(payload.message).toContain("boom");
	});

	it("carries the context as short key=value pairs", () => {
		reportOfflineFailure("t.context", new Error("boom"), {
			queueLength: 4,
			clientId: "inv-abc",
			queueId: 12,
			entityType: "invoice",
			reason: "draft_fallback_failed",
		});

		const info = sentPayloads()[0].info;
		expect(info).toContain("queueLength=4");
		expect(info).toContain("clientId=inv-abc");
		expect(info).toContain("queueId=12");
		expect(info).toContain("entityType=invoice");
		expect(info).toContain("reason=draft_fallback_failed");
	});

	it("omits context keys that were not supplied", () => {
		reportOfflineFailure("t.sparse", new Error("boom"), { reason: "x" });

		expect(sentPayloads()[0].info).toBe("reason=x");
	});

	it("keeps the stack when there is one", () => {
		reportOfflineFailure("t.stack", new Error("boom"));

		expect(String(sentPayloads()[0].stack)).toContain("Error: boom");
	});

	it("stays small: one clipped line plus a stack, no payload echo", () => {
		reportOfflineFailure("t.small", new Error("x".repeat(5000)), {
			clientId: "y".repeat(5000),
		});

		const payload = sentPayloads()[0];
		expect(payload.message.length).toBeLessThanOrEqual(800);
		expect(payload.info.length).toBeLessThanOrEqual(200);
	});
});

describe("bounds", () => {
	it("drops a repeat of the same failure inside the tab's dedupe window", () => {
		reportOfflineFailure("t.dedupe", new Error("same"));
		reportOfflineFailure("t.dedupe", new Error("same"));
		reportOfflineFailure("t.dedupe", new Error("same"));

		expect(frappeCall).toHaveBeenCalledTimes(1);
	});

	it("still reports a different scope with the same message", () => {
		reportOfflineFailure("t.scope.a", new Error("same"));
		reportOfflineFailure("t.scope.b", new Error("same"));

		expect(frappeCall).toHaveBeenCalledTimes(2);
	});
});

describe("it never becomes the failure", () => {
	it("does not throw when the error is not an Error", () => {
		const circular: any = { name: "weird" };
		circular.self = circular;

		expect(() =>
			reportOfflineFailure("t.circular", circular),
		).not.toThrow();
		expect(frappeCall).toHaveBeenCalledTimes(1);
	});

	it("does not throw when the transport itself rejects", async () => {
		frappeCall.mockImplementationOnce(() =>
			Promise.reject(new Error("offline")),
		);

		expect(() =>
			reportOfflineFailure("t.transport", new Error("boom")),
		).not.toThrow();
		await Promise.resolve();
	});

	it("does not throw when there is no transport at all", () => {
		delete (globalThis as any).frappe;
		const realFetch = (globalThis as any).fetch;
		(globalThis as any).fetch = undefined;
		try {
			expect(() =>
				reportOfflineFailure("t.no-transport", new Error("boom")),
			).not.toThrow();
		} finally {
			(globalThis as any).fetch = realFetch;
		}
	});

	it("falls back to fetch when frappe is not on the page", () => {
		delete (globalThis as any).frappe;
		const fetchMock = vi.fn(() => Promise.resolve({} as Response));
		const realFetch = (globalThis as any).fetch;
		(globalThis as any).fetch = fetchMock;
		try {
			reportOfflineFailure("t.fetch", new Error("boom"));

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0][0])).toContain(
				ERROR_LOG_METHOD,
			);
		} finally {
			(globalThis as any).fetch = realFetch;
		}
	});
});
