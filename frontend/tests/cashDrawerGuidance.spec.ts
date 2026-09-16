// @vitest-environment jsdom

/**
 * Excess drawer cash, as the cashier meets it.
 *
 * `docs/POS-CASH-CUSTODY.md` makes the drawer limit guidance and NOT a sales
 * block, and `docs/POS-CASH-CUSTODY-UX-REVIEW.md` asks for a useful alert
 * rather than an alert framework. So the contract this file pins is narrow and
 * mostly about SILENCE: the component renders nothing unless the server said
 * so, never invents or repeats a money figure the server withheld, and never
 * carries one register's figure onto another.
 *
 * `api.ts` is mocked — its transport and request recovery belong to
 * `cashCustodyRequests.spec.ts`, not here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const read = vi.fn();
vi.mock("../src/posapp/components/pos/custody/api", () => ({
	read: (...args: any[]) => read(...args),
}));

import CashDrawerGuidance from "../src/posapp/components/pos/custody/CashDrawerGuidance.vue";

const OVER = {
	show: true,
	reason: "ok",
	currency: "MXN",
	safe_title: "Caja Doco",
	expected_amount: 5200,
	drawer_limit: 5000,
	float_target: 1000,
	keep_amount: 1000,
	suggested_return: 4200,
	over_limit: true,
	as_of: "2026-09-15 14:35:00.000000",
};

const mountGuidance = (props: Record<string, any> = {}) =>
	mount(CashDrawerGuidance, {
		props: { profile: "Doco Ventas", opening: "POS-OPEN-0009", ...props },
	});

beforeEach(() => {
	read.mockReset().mockResolvedValue(OVER);
	(window as any).__ = undefined;
});

describe("drawer-limit guidance", () => {
	it("asks for a bag back, with the amount and what it is", async () => {
		const wrapper = mountGuidance();
		await flushPromises();

		expect(read).toHaveBeenCalledWith("drawer_guidance", {
			pos_profile: "Doco Ventas",
			opening_shift: "POS-OPEN-0009",
		});
		const text = wrapper.text();
		// The next action is a thing to DO with the cash, not a severity word.
		expect(wrapper.find('[data-testid="drawer-guidance-return"]').text()).toContain(
			"Return bag to safe",
		);
		expect(wrapper.find('[data-testid="drawer-guidance-suggested"]').text()).toContain("4,200");
		// Never pretend the ledger figure is the money in the tray.
		expect(text).toContain("not a count");
		expect(text).toContain("Checked");
		expect(text).toContain("Caja Doco");
	});

	it("emits the return request instead of moving or filling anything", async () => {
		// Listener prop rather than wrapper.emitted(): the idiom this repo
		// already documents in tests/actionBand.spec.ts.
		const onRequestReturn = vi.fn();
		const wrapper = mountGuidance({ onRequestReturn });
		await flushPromises();
		await wrapper.find('[data-testid="drawer-guidance-return"]').trigger("click");

		expect(onRequestReturn).toHaveBeenCalledTimes(1);
		// No payload to autofill a count with, one read, and no command: the
		// parent owns starting the drop and the cashier counts the cash.
		expect(onRequestReturn).toHaveBeenCalledWith();
		expect(read).toHaveBeenCalledTimes(1);
	});

	// Exactly at the limit is within it. A register whose takings land on the
	// round number every day would otherwise nag through the whole shift.
	it("is calm at the limit and asks one cent over it", async () => {
		read.mockResolvedValue({ ...OVER, expected_amount: 5000, suggested_return: 0, over_limit: false });
		const atLimit = mountGuidance();
		await flushPromises();
		expect(atLimit.find('[data-testid="drawer-guidance-ok"]').exists()).toBe(true);
		expect(atLimit.find('[data-testid="drawer-guidance-return"]').exists()).toBe(false);

		read.mockResolvedValue({ ...OVER, expected_amount: 5000.01, suggested_return: 4000.01 });
		const over = mountGuidance();
		await flushPromises();
		expect(over.find('[data-testid="drawer-guidance-return"]').exists()).toBe(true);
	});

	// Blind count, no safe, no shift, no configured limit: one answer, and the
	// payload carries no amounts to leak.
	it.each([
		["a blind-count register", { show: false, reason: "expected_cash_hidden" }],
		["a register with no custody", { show: false, reason: "not_configured" }],
		["no configured limit", { show: false, reason: "no_limit" }],
		["no open shift", { show: false, reason: "no_open_shift" }],
	])("renders nothing for %s", async (_label, response) => {
		read.mockResolvedValue(response);
		const wrapper = mountGuidance();
		await flushPromises();

		expect(wrapper.find('[data-testid="drawer-guidance"]').exists()).toBe(false);
		expect(wrapper.text()).toBe("");
	});

	it("does not read at all without a register or an open drawer", async () => {
		const wrapper = mountGuidance({ opening: null });
		await flushPromises();

		expect(read).not.toHaveBeenCalled();
		expect(wrapper.text()).toBe("");
	});

	it("says it could not check, and retries on request", async () => {
		read.mockRejectedValueOnce(new Error("Network"));
		const wrapper = mountGuidance();
		await flushPromises();

		const failure = wrapper.find('[data-testid="drawer-guidance-error"]');
		expect(failure.text()).toContain("unavailable");
		// A failed READ must not read as a cash event.
		expect(failure.text()).toContain("Nothing was counted or moved");
		expect(wrapper.text()).not.toContain("$");

		read.mockResolvedValue(OVER);
		await wrapper.find("button").trigger("click");
		await flushPromises();
		expect(wrapper.find('[data-testid="drawer-guidance-return"]').exists()).toBe(true);
	});

	// A permission refusal is the same nonblocking failure: guidance is never
	// the thing that explains somebody else's shift to this cashier.
	it("treats a refused shift as simply not checkable", async () => {
		read.mockRejectedValue(new Error("You are not allowed to access this shift."));
		const wrapper = mountGuidance();
		await flushPromises();

		expect(wrapper.find('[data-testid="drawer-guidance-error"]').exists()).toBe(true);
		expect(wrapper.text()).not.toContain("Return bag to safe");
	});

	it("re-reads when the register or drawer changes", async () => {
		const wrapper = mountGuidance();
		await flushPromises();
		read.mockResolvedValue({ ...OVER, expected_amount: 9000, suggested_return: 8000 });

		await wrapper.setProps({ profile: "Doco Cafetería", opening: "POS-OPEN-0010" });
		await flushPromises();

		expect(read).toHaveBeenLastCalledWith("drawer_guidance", {
			pos_profile: "Doco Cafetería",
			opening_shift: "POS-OPEN-0010",
		});
		expect(wrapper.find('[data-testid="drawer-guidance-suggested"]').text()).toContain("8,000");
	});

	it("drops a slow answer that belongs to the previous register", async () => {
		let releaseFirst: (_value: any) => void = () => {};
		read.mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)));
		const wrapper = mountGuidance();

		read.mockResolvedValue({ show: false, reason: "no_limit" });
		await wrapper.setProps({ profile: "Doco Cafetería" });
		releaseFirst(OVER);
		await flushPromises();

		// The stale over-limit alert for «Doco Ventas» must not appear on the
		// register the cashier switched to.
		expect(wrapper.find('[data-testid="drawer-guidance"]').exists()).toBe(false);
	});
});
