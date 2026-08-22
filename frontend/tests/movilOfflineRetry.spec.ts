// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

/**
 * `Reintentar` on the phone — the one control on this screen and the one place
 * on it where a mistake costs money.
 *
 * The queue already drains itself. `syncStore.syncPendingInvoices()` is what
 * the resume hook, the navbar and every dead-letter requeue call, and
 * `syncOfflineInvoices()` under it is single-flight and claims each entry
 * under a lease before it touches the server. A phone button that walked the
 * rows itself would be a SECOND writer over the same money — the failure is a
 * sale submitted twice, and it is silent.
 *
 * `offlineQueueRetry.spec.ts` proves that of the composable. This file proves
 * it of the SURFACE — from a finger on a 390 px screen — and then proves the
 * proof: the same contract is run against three mutants of the retry path,
 * each of which is a way this has actually been got wrong, and each of which
 * must FAIL it. A contract no mutant can break is a contract that is not
 * checking anything.
 */

/** Read by the mock factory at call time; `vi.hoisted` so it exists first. */
const mutation = vi.hoisted(() => ({ mode: "none" as Mutant }));

type Mutant = "none" | "noGuard" | "secondWriter" | "noDispatch";

const syncPendingInvoices = vi.fn(async () => {});
vi.mock("../src/posapp/stores/syncStore", () => ({
	useSyncStore: () => ({ syncPendingInvoices }),
}));

vi.mock("../src/posapp/components/pos/offline/useOfflineQueue", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../src/posapp/components/pos/offline/useOfflineQueue")
		>();
	return {
		...actual,
		useOfflineQueue: (options: Record<string, any> = {}) => {
			const real = actual.useOfflineQueue(options);
			switch (mutation.mode) {
				case "none":
					return real;
				/** The in-flight guard deleted: an impatient double tap drains twice. */
				case "noGuard":
					return {
						...real,
						retry: async () => {
							await options.probe?.();
							await options.drain?.();
							await real.refresh();
						},
					};
				/** The hazard itself: a retry that submits the rows on its own. */
				case "secondWriter":
					return {
						...real,
						retry: async () => {
							for (const row of real.rows.value) {
								await (globalThis as any).frappe.call({
									method: "posawesome.posawesome.api.invoices.update_invoice",
									args: { key: row.key },
								});
							}
						},
					};
				/** A button that spins and dispatches nothing at all. */
				case "noDispatch":
					return { ...real, retry: async () => {} };
			}
		},
	};
});

import MovilOfflineSurface from "../src/posapp/components/pos/mobile/offline/MovilOfflineSurface.vue";

type AnyRecord = Record<string, any>;

const snapshot = (queueId: number): AnyRecord => ({
	queue_id: queueId,
	status: "pending",
	created_at: `2026-08-22T19:${String(queueId).padStart(2, "0")}:00.000Z`,
	retry_count: 0,
	idempotency_key: `inv-1755900000000-key${queueId}`,
	invoice: {
		name: `B-048${queueId}`,
		customer_name: "Alejandra Ríos",
		grand_total: 1129,
		items: [{ item_name: "Funda", qty: 1 }],
		payments: [{ mode_of_payment: "Efectivo", amount: 1129 }],
	},
	data: {},
});

const mountSurface = (props: Record<string, unknown> = {}) =>
	mount(MovilOfflineSurface, {
		props: {
			readHeld: () => [snapshot(31), snapshot(44)],
			now: new Date("2026-08-22T21:31:00.000Z"),
			formatCurrency: (value: number) => String(value),
			...props,
		},
		global: { plugins: [createVuetify()] },
	});

/**
 * Let the retry settle. `trigger()` resolves on Vue's next tick, which is one
 * microtask; the drain path crosses a dynamic `import()` and therefore a
 * macrotask, so a bare `await trigger()` reads "nothing was dispatched" while
 * the dispatch is a turn away.
 */
const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await nextTick();
};

/**
 * What Reintentar must be, stated once and run against every candidate.
 *
 * Identity and arity, not "something happened": WHICH drain was dispatched and
 * exactly how many times.
 */
async function retryContract() {
	const drain = vi.fn(async () => {});
	const wrapper = mountSurface({ drain });
	await wrapper.vm.$nextTick();
	const button = wrapper.get('[data-testid="movil-offline-retry"]');

	// One press, one dispatch of the drain that already exists.
	await button.trigger("click");
	await settle();
	expect(drain, "the press must reach the shared drain").toHaveBeenCalledTimes(1);
	expect(
		(globalThis as any).frappe.call,
		"a submit issued from this surface bypasses the queue's lease and its idempotency bookkeeping",
	).not.toHaveBeenCalled();

	// Two presses in one frame — the DOM has not repainted the disabled state
	// yet, so this tests the guard rather than the button.
	drain.mockClear();
	const first = button.trigger("click");
	const second = button.trigger("click");
	await Promise.all([first, second]);
	await settle();
	expect(drain, "two drains over one queue is how a sale gets billed twice").toHaveBeenCalledTimes(
		1,
	);

	wrapper.unmount();
}

beforeEach(() => {
	mutation.mode = "none";
	syncPendingInvoices.mockClear();
	vi.stubGlobal("__", (value: string) => value);
	vi.stubGlobal("frappe", { call: vi.fn() });
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the phone's Reintentar reuses the drain that already exists", () => {
	it("dispatches the shared sync-store drain when nothing is injected", async () => {
		// The whole path, with no seam propped open: a tap on the phone ends in
		// the same call the resume hook makes.
		const wrapper = mountSurface();
		await wrapper.vm.$nextTick();

		await wrapper.get('[data-testid="movil-offline-retry"]').trigger("click");
		await settle();

		expect(syncPendingInvoices).toHaveBeenCalledTimes(1);
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();
	});

	it("satisfies the contract", async () => {
		await expect(retryContract()).resolves.toBeUndefined();
	});

	it("re-reads the queue after the drain, so the list cannot go stale", async () => {
		const readHeld = vi.fn(() => [snapshot(31)]);
		const wrapper = mountSurface({ readHeld, drain: async () => {} });
		await wrapper.vm.$nextTick();

		await wrapper.get('[data-testid="movil-offline-retry"]').trigger("click");
		await settle();

		// Once on mount, once after the drain.
		expect(readHeld).toHaveBeenCalledTimes(2);
	});

	it("stays pressable after a drain that failed", async () => {
		const wrapper = mountSurface({
			drain: async () => {
				throw new Error("network");
			},
		});
		await wrapper.vm.$nextTick();
		const button = wrapper.get('[data-testid="movil-offline-retry"]');

		await button.trigger("click");
		await settle();

		expect(button.attributes("disabled")).toBeUndefined();
	});
});

/**
 * Mutation testing, by hand and on purpose.
 *
 * Each mutant replaces the retry the surface is wired to with a version that
 * is wrong in one specific, historically real way. The contract above is run
 * unchanged against each. If any mutant PASSES, the contract is decorative and
 * this file has caught it before a queue does.
 */
describe("the contract has teeth — every mutant of the retry path fails it", () => {
	const mutants: Array<[Mutant, string]> = [
		["noGuard", "the in-flight guard deleted — a double tap drains twice"],
		["secondWriter", "a retry that submits the rows itself, behind the queue's lease"],
		["noDispatch", "a button that spins and dispatches nothing"],
	];

	for (const [mode, why] of mutants) {
		it(`rejects: ${why}`, async () => {
			mutation.mode = mode;

			await expect(retryContract()).rejects.toThrow();
		});
	}

	it("and the mutants are actually reached — the switch is not dead code", async () => {
		mutation.mode = "noDispatch";
		const drain = vi.fn(async () => {});
		const wrapper = mountSurface({ drain });
		await wrapper.vm.$nextTick();

		await wrapper.get('[data-testid="movil-offline-retry"]').trigger("click");
		await settle();

		expect(drain).not.toHaveBeenCalled();
	});
});
