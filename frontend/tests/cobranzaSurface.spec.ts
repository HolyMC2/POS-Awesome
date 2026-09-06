// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import CobranzaSurface from "../src/posapp/components/pos/payments/cobranza/CobranzaSurface.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";
import { bus } from "../src/posapp/bus";

const call = vi.fn();

vi.mock("../src/posapp/components/pos/shell/PayView.vue", () => ({
	default: { name: "PayViewProbe", props: ["lockedParty"], template: '<div data-testid="pay-view-probe" />' },
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => String(value) }),
}));

vi.mock("../src/posapp/services/api", () => ({
 default: { call: (...args: unknown[]) => call(...args) },
}));

describe("payments and advances without an invoice", () => {
	let wrapper: VueWrapper | undefined;
	beforeEach(() => {
		setActivePinia(createPinia());
		call.mockReset();
		call.mockResolvedValue({ rows: [], total: 0 });
		(window as any).__ = (text: string) => text;
		(window as any).serverOnline = true;
		Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
	});
	afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

	async function openSurface(flag: number | string | undefined = 1) {
		const store = useUIStore();
		store.posProfile = { name: "COUNTER", posa_use_pos_awesome_payments: flag } as any;
		wrapper = mount(CobranzaSurface, {
			global: {
				stubs: { CobranzaDetail: true },
				components: {
					VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
					VAlert: { template: '<div><slot /></div>' },
				},
			},
		});
		window.dispatchEvent(new Event("online"));
		await flushPromises();
		return { surface: wrapper, store };
	}

	it("opens unlocked capture from an empty worklist and returns to the refreshed list", async () => {
		const { surface, store } = await openSurface("1");
		expect(surface.get('[data-testid="cobranza-empty"]').exists()).toBe(true);
		// A route armed after mount must not accidentally lock this general entry.
		store.setPaymentRouteTarget({ invoiceName: "STALE-INVOICE", customer: "OTHER-CUSTOMER", currency: "MXN" });
		const entry = surface.get('[data-testid="cobranza-manual-payment"]');
		expect(entry.text()).toBe("Payments and advances");
		expect(entry.attributes("disabled")).toBeUndefined();
		await entry.trigger("click");
		expect(store.paymentRouteTarget).toBeNull();
		expect(surface.findComponent({ name: "PayViewProbe" }).props("lockedParty")).toBeUndefined();
		expect(surface.get('[data-testid="cobranza-capture-target"]').text()).toBe("Payments and advances");
		expect(surface.find('[data-testid="cobranza-list"]').exists()).toBe(false);
		call.mockClear();
		await surface.get('[data-testid="cobranza-back"]').trigger("click");
		await flushPromises();
		expect(surface.find('[data-testid="pay-view-probe"]').exists()).toBe(false);
		expect(surface.get('[data-testid="cobranza-empty"]').exists()).toBe(true);
		expect(surface.get('[data-testid="cobranza-manual-payment"]').exists()).toBe(true);
		expect(call).toHaveBeenCalledWith(expect.stringContaining("get_receivables"), expect.objectContaining({ pos_profile: "COUNTER" }));
	});

	it.each([0, "0"])("hides the general payment entry when the profile flag is %s", async (flag) => {
		const { surface } = await openSurface(flag);
		expect(surface.find('[data-testid="cobranza-manual-payment"]').exists()).toBe(false);
		expect(surface.find('[data-testid="pay-view-probe"]').exists()).toBe(false);
	});

	it("keeps the entry visible but disabled while the server is unreachable", async () => {
		const { surface } = await openSurface();
		(window as any).serverOnline = false;
		window.dispatchEvent(new Event("posa:network-status"));
		await flushPromises();
		const entry = surface.get('[data-testid="cobranza-manual-payment"]');
		expect(entry.attributes("disabled")).toBeDefined();
		await entry.trigger("click");
		expect(surface.find('[data-testid="pay-view-probe"]').exists()).toBe(false);
		expect(surface.get('[data-testid="cobranza-list"]').exists()).toBe(true);
	});

	it("opens the shared exception screen even when new payment capture is disabled", async () => {
		const open = vi.fn(); bus.on("open_money_exceptions", open);
		try {
			const { surface } = await openSurface(0);
			await surface.get('[data-testid="cobranza-money-exceptions"]').trigger("click");
			expect(open).toHaveBeenCalledTimes(1);
			expect(surface.find('[data-testid="pay-view-probe"]').exists()).toBe(false);
		} finally { bus.off("open_money_exceptions", open); }
	});
});
