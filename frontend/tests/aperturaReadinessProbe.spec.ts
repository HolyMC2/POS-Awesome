// @vitest-environment jsdom

/**
 * The Apertura panel's one round trip (`OpeningReadiness.vue`).
 *
 * The verdict is proved on plain objects in `readinessVerdict.spec.ts` and the
 * merge in `openingReadinessServer.spec.ts`. What is left is the probe, and
 * every question below is a way one server call becomes four, or lands on the
 * wrong till:
 *
 *   1. `refresh()` runs on mount and on every prop that settles — the company
 *      resolves, the profile auto-selects, the payment rows arrive. Unguarded
 *      that is three or four calls to open one register.
 *   2. A refusal will refuse again. A register whose user is not assigned to
 *      it, or a server too old to carry the endpoint, must be asked ONCE — the
 *      floors/tables 403 loop is what this rule is named after.
 *   3. The answer must never outlive the register it was asked about. The
 *      cashier can switch profile while the call is out, and register A's
 *      accounting accounts under register B's name is exactly the green tick
 *      this panel exists to refuse.
 *   4. The network must not hold the paint. Ten unverified rows now beat ten
 *      correct rows after a timeout, because a checklist that waits reads as a
 *      spinner.
 *
 * The verdict listener is a PROP, not `wrapper.emitted()`: VTU does not record
 * component emits in this repo (build plan §10).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import type { ReadinessInput } from "../src/posapp/components/pos/shift/openingReadiness";
import type { OpeningReadinessPayload } from "../src/posapp/services/openingReadinessService";

const collectReadinessInput = vi.fn(async (_sources: any): Promise<ReadinessInput> => ({}));
const fetchOpeningReadiness = vi.fn(async (_profile: string) => null as any);

vi.mock("../src/posapp/components/pos/shift/readinessSnapshot", () => ({
	collectReadinessInput: (sources: unknown) => collectReadinessInput(sources),
}));

vi.mock("../src/posapp/services/openingReadinessService", () => ({
	fetchOpeningReadiness: (profile: string) => fetchOpeningReadiness(profile),
}));

import OpeningReadiness from "../src/posapp/components/pos/shift/OpeningReadiness.vue";

const answerFor = (profile: string): OpeningReadinessPayload => ({
	pos_profile: profile,
	company: "Grupo Doco",
	tenders: { accounts_reported: true, rows: [{ mode: "Cash", account: "Caja Tienda - GD" }] },
});

/** Drains the probe's promise chain and the re-render it triggers. */
const settle = async () => {
	for (let i = 0; i < 6; i += 1) await nextTick();
};

const mountPanel = (props: Record<string, unknown> = {}) =>
	mount(OpeningReadiness, {
		props: { company: "Grupo Doco", posProfile: "Doco Ventas", paymentRows: [], ...props },
	});

const serverArgs = () =>
	collectReadinessInput.mock.calls.map((call) => (call[0] as any)?.server ?? null);

describe("the Apertura panel's server probe", () => {
	beforeEach(() => {
		collectReadinessInput.mockReset();
		collectReadinessInput.mockResolvedValue({});
		fetchOpeningReadiness.mockReset();
		fetchOpeningReadiness.mockResolvedValue(null);
	});

	it("asks once per register however many times the props settle", async () => {
		fetchOpeningReadiness.mockResolvedValue(answerFor("Doco Ventas"));
		const wrapper = mountPanel();
		await settle();

		await wrapper.setProps({ company: "Grupo Doco " });
		await wrapper.setProps({ paymentRows: [{ parent: "Doco Ventas" }] });
		await settle();

		expect(fetchOpeningReadiness).toHaveBeenCalledTimes(1);
		expect(fetchOpeningReadiness).toHaveBeenCalledWith("Doco Ventas");
	});

	it("hands the answer to the collector once it lands, and not before", async () => {
		fetchOpeningReadiness.mockResolvedValue(answerFor("Doco Ventas"));
		mountPanel();
		await settle();

		// The first collection is the one that paints; it carries no server
		// answer because none had arrived. A later one does.
		expect(serverArgs()[0]).toBeNull();
		expect(serverArgs().at(-1)).toMatchObject({ pos_profile: "Doco Ventas" });
	});

	it("never asks again after a refusal, and still renders ten points", async () => {
		fetchOpeningReadiness.mockRejectedValue(new Error("403 not your register"));
		const onVerdict = vi.fn();
		const wrapper = mountPanel({ onVerdict });
		await settle();

		await wrapper.setProps({ paymentRows: [{ parent: "Doco Ventas" }] });
		await wrapper.setProps({ company: "Grupo Doco  " });
		await settle();

		expect(fetchOpeningReadiness).toHaveBeenCalledTimes(1);
		expect(wrapper.findAll("[data-testid^='readiness-check-']")).toHaveLength(10);
		// A refusal is not a reason to keep a shop shut.
		expect(onVerdict.mock.calls.at(-1)?.[0].canOpen).toBe(true);
		expect(serverArgs().every((value) => value === null)).toBe(true);
	});

	it("asks again — once — when the cashier changes register", async () => {
		fetchOpeningReadiness.mockImplementation(async (profile: string) => answerFor(profile));
		const wrapper = mountPanel();
		await settle();

		await wrapper.setProps({ posProfile: "Doco Taller" });
		await settle();

		expect(fetchOpeningReadiness.mock.calls.map((call) => call[0])).toEqual([
			"Doco Ventas",
			"Doco Taller",
		]);
		expect(serverArgs().at(-1)).toMatchObject({ pos_profile: "Doco Taller" });
	});

	it("refuses to read register A's answer under register B's name", async () => {
		// The server echoes back the register it was asked about, and a payload
		// that names a different one is dropped rather than merged. This is the
		// same rule `readinessSnapshot` applies to the cached opening payload.
		fetchOpeningReadiness.mockResolvedValue(answerFor("Doco Taller"));
		mountPanel();
		await settle();

		expect(serverArgs().every((value) => value === null)).toBe(true);
	});

	it("paints its ten rows without waiting for the server", async () => {
		// A call that never comes back must not hold the screen: the panel is
		// the first thing a cashier sees in the morning.
		fetchOpeningReadiness.mockReturnValue(new Promise(() => {}) as any);
		const onVerdict = vi.fn();
		const wrapper = mountPanel({ onVerdict });
		await settle();

		expect(wrapper.findAll("[data-testid^='readiness-check-']")).toHaveLength(10);
		expect(onVerdict).toHaveBeenCalled();
		expect(collectReadinessInput).toHaveBeenCalled();
		expect(serverArgs()[0]).toBeNull();
	});

	it("does not ask at all until a register is chosen", async () => {
		mountPanel({ posProfile: "" });
		await settle();

		expect(fetchOpeningReadiness).not.toHaveBeenCalled();
	});
});
