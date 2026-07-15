// @vitest-environment jsdom
//
// Regression guard for the hold-until-confirm AUTO-PRINT race (prod 2026-07-12..14).
//
// SaldoHoldsBadge mounts (via Navbar → DefaultLayout) BEFORE the POS profile
// loads, so `enabled` is false at mount. The bug: onMounted gated ALL of the
// auto-print machinery (poll timers, realtime, bus) behind
// `if (!enabled.value) return`, one-shot — so when the profile arrived a beat
// later the chip rendered but nothing ever polled `list_printable` and the
// ticket never auto-printed. The fix arms on the enabled→true transition.
//
// This test reproduces exactly that ordering: mount with posProfile=null (the
// real boot order), then set the profile after mount, and asserts the poll +
// print trigger now fire. Under the old code these assertions fail.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import SaldoHoldsBadge from "@saldo/SaldoHoldsBadge.vue";
import { saldoBus } from "@saldo/useSaldoCapture";

const PRINTABLE = { invoice: "ACC-SINV-2026-99001", doctype: "Sales Invoice" };

function makeFrappe() {
	const call = vi.fn(async ({ method }: { method: string }) => {
		if (method === "saldo.api.holds.list_held") return { message: [] };
		if (method === "saldo.api.holds.list_printable") return { message: [PRINTABLE] };
		if (method === "saldo.api.status.get_pos_available_balance")
			return { message: { visible: false } };
		return { message: null };
	});
	return {
		call,
		session: { user: "cashier@example.com" },
		realtime: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
	};
}

function mountBadge(posProfile: any) {
	return mount(SaldoHoldsBadge as any, {
		props: { posProfile },
		global: {
			renderStubDefaultSlot: true,
			// Template compiles `__("…")` to `_ctx.__` — resolve it off the
			// instance (globalThis.__ only covers the bare `__` in <script>).
			config: { globalProperties: { __: (s: string) => s } },
		},
		shallow: true, // exercise setup/onMounted/timers, stub Vuetify + child views
	});
}

describe("SaldoHoldsBadge auto-print arming", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		window.localStorage?.clear();
		(globalThis as any).__ = (s: string) => s;
		(globalThis as any).frappe = makeFrappe();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("stays inert while the profile is unloaded (enabled=false at mount)", async () => {
		mountBadge(null);
		await vi.advanceTimersByTimeAsync(9000);
		const methods = (globalThis as any).frappe.call.mock.calls.map((c: any[]) => c[0].method);
		expect(methods).not.toContain("saldo.api.holds.list_printable");
		expect(methods).not.toContain("saldo.api.holds.list_held");
	});

	it("arms polling + fires the print trigger when the profile loads AFTER mount", async () => {
		const printed: any[] = [];
		saldoBus.on("saldo:hold_print", (p: any) => printed.push(p));

		// Real boot order: mount before the profile is known...
		const wrapper = mountBadge(null);
		await vi.advanceTimersByTimeAsync(100);
		expect((globalThis as any).frappe.call).not.toHaveBeenCalled();

		// ...profile hydrates a beat later → enabled flips true → must arm.
		await wrapper.setProps({ posProfile: { name: "P1", saldo_enabled: 1 } });
		await vi.advanceTimersByTimeAsync(0); // flush arm()'s immediate refresh + pollPrints

		const methods = (globalThis as any).frappe.call.mock.calls.map((c: any[]) => c[0].method);
		expect(methods).toContain("saldo.api.holds.list_printable");

		// list_printable returned a submitted recarga → print trigger emitted once.
		expect(printed).toHaveLength(1);
		expect(printed[0].invoice).toBe(PRINTABLE.invoice);

		saldoBus.off("saldo:hold_print");
	});

	it("keeps polling on the 8s fallback tick after arming", async () => {
		const wrapper = mountBadge({ name: "P1", saldo_enabled: 1 });
		await vi.advanceTimersByTimeAsync(0);
		(globalThis as any).frappe.call.mockClear();
		window.localStorage?.clear(); // let the same invoice re-emit is irrelevant; count polls
		await vi.advanceTimersByTimeAsync(8000);
		const methods = (globalThis as any).frappe.call.mock.calls.map((c: any[]) => c[0].method);
		expect(methods).toContain("saldo.api.holds.list_printable");
		wrapper.unmount();
	});
});
