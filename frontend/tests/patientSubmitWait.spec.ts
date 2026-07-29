import { describe, expect, it } from "vitest";

import { waitForLateSubmission } from "../src/posapp/composables/pos/payments/usePatientSubmitWait";

// Deterministic clock: `now` advances only when `sleep` is awaited, so the
// loop's timing is fully scripted and the suite never actually waits.
function makeClock() {
	let t = 0;
	return {
		now: () => t,
		sleep: async (ms: number) => {
			t += ms;
		},
	};
}

const never = () => new Promise<any>(() => {});

describe("waitForLateSubmission", () => {
	it("prints as soon as the DB shows docstatus 1", async () => {
		const clock = makeClock();
		const statuses = [0, 0, 1];
		const result = await waitForLateSubmission("INV-1", "Sales Invoice", {
			waitForProcessed: never,
			getDocstatus: async () => statuses.shift() ?? 1,
			...clock,
			ceilingMs: 100_000,
			pollMs: 10_000,
		});
		expect(result).toEqual({ doctype: "Sales Invoice" });
		expect(statuses.length).toBe(0);
	});

	it("honors the socket event's doctype once the DB confirms docstatus 1", async () => {
		// First (immediate) poll runs before the event's microtask lands and
		// sees a draft; the post-sleep confirm then carries the event doctype.
		const clock = makeClock();
		const asked: string[] = [];
		const result = await waitForLateSubmission("INV-2", "Sales Invoice", {
			waitForProcessed: async () => ({ doctype: "POS Invoice" }),
			getDocstatus: async (dt) => {
				asked.push(dt);
				return asked.length >= 2 ? 1 : 0;
			},
			...clock,
			ceilingMs: 100_000,
			pollMs: 10_000,
		});
		expect(result).toEqual({ doctype: "POS Invoice" });
		expect(asked[asked.length - 1]).toBe("POS Invoice");
	});

	it("distrusts a socket 'processed' the DB contradicts — never prints a draft", async () => {
		// socketStore fabricates {status:"processed"} while disconnected; if
		// the DB still says draft, the wait must keep polling, not print.
		const clock = makeClock();
		const statuses = [0, 0, 0, 1];
		const result = await waitForLateSubmission("INV-2b", "Sales Invoice", {
			waitForProcessed: async () => ({}),
			getDocstatus: async () => statuses.shift() ?? 1,
			...clock,
			ceilingMs: 100_000,
			pollMs: 10_000,
		});
		expect(result).toEqual({ doctype: "Sales Invoice" });
		expect(statuses.length).toBe(0);
	});

	it("surfaces a server-reported submit failure instead of polling on", async () => {
		const clock = makeClock();
		await expect(
			waitForLateSubmission("INV-3", "Sales Invoice", {
				waitForProcessed: async () => {
					throw new Error("Valuation rate missing");
				},
				getDocstatus: async () => 0,
				...clock,
				ceilingMs: 100_000,
				pollMs: 10_000,
			}),
		).rejects.toThrow("Valuation rate missing");
	});

	it("aborts when the invoice was cancelled server-side", async () => {
		const clock = makeClock();
		await expect(
			waitForLateSubmission("INV-4", "Sales Invoice", {
				waitForProcessed: never,
				getDocstatus: async () => 2,
				...clock,
				ceilingMs: 100_000,
				pollMs: 10_000,
			}),
		).rejects.toThrow(/cancelled/);
	});

	it("keeps polling through transient DB read failures (null)", async () => {
		const clock = makeClock();
		const statuses: Array<number | null> = [null, null, 1];
		const result = await waitForLateSubmission("INV-5", "Sales Invoice", {
			waitForProcessed: never,
			getDocstatus: async () => statuses.shift() ?? 1,
			...clock,
			ceilingMs: 100_000,
			pollMs: 10_000,
		});
		expect(result).toEqual({ doctype: "Sales Invoice" });
	});

	it("gives up at the ceiling when the invoice never lands", async () => {
		const clock = makeClock();
		await expect(
			waitForLateSubmission("INV-6", "Sales Invoice", {
				waitForProcessed: never,
				getDocstatus: async () => 0,
				...clock,
				ceilingMs: 30_000,
				pollMs: 10_000,
			}),
		).rejects.toThrow(/did not finish submitting/);
	});
});
