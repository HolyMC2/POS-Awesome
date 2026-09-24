// @vitest-environment jsdom
/**
 * «Credit sales» as a destination: the pending-paperwork queue and its
 * detail.
 *
 * Below 1100 px the detail is a step of its own with a way back to the same
 * list; above it the two sit side by side. When credit sales are off on the
 * register, the server's reason is the screen. Listeners ride as props: VTU
 * does not record component emits in this repo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";

const api = vi.hoisted(() => ({ loadCreditContext: vi.fn(), listCreditSales: vi.fn() }));
vi.mock("../src/posapp/components/pos/credit/creditApi", () => api);

const printing = vi.hoisted(() => ({ printInvoiceByName: vi.fn() }));
vi.mock("../src/posapp/utils/printInvoiceByName", () => printing);

vi.mock("../src/posapp/components/pos/credit/CreditSaleDetail.vue", () => ({
	default: defineComponent({
		name: "CreditSaleDetail",
		props: { invoice: { type: String, required: true }, mode: { type: String, required: true } },
		emits: ["changed", "close", "print"],
		setup(props) {
			return () => h("div", { "data-testid": "detail-stub", "data-mode": props.mode }, props.invoice);
		},
	}),
}));

import CreditSalesSurface from "../src/posapp/components/pos/credit/CreditSalesSurface.vue";
import type { CreditSaleRow } from "../src/posapp/components/pos/credit/creditApi";
import { formatMoney } from "../src/posapp/components/pos/credit/creditFormat";
import { useToastStore } from "../src/posapp/stores/toastStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const USER = "cajera@doco.test";
const PROFILE = "Doco Ventas";

const row = (name: string, extra: Partial<CreditSaleRow> = {}): CreditSaleRow => ({
	name,
	posting_date: "2026-09-24",
	customer_name: "Ana López",
	credit_provider: "Payjoy",
	customer_offered_price: 6499,
	enganche: 1200,
	documents: "2/4",
	missing: 2,
	compliance: "Faltante",
	owner_name: "Beto Cajero",
	...extra,
});

const page = (rows: CreditSaleRow[] = [row("SINV-1"), row("SINV-2", { customer_name: "Carla Ruiz", missing: 0, documents: "4/4" })], counts = { pending: 2, all: 7 }) => ({
	rows,
	counts,
});

const listeners = { onBand: vi.fn(), onClose: vi.fn() };

const setWidth = (width: number) =>
	Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });

const render = (props: Record<string, unknown> = {}) =>
	mount(CreditSalesSurface, {
		props: { ...listeners, ...props },
		global: { stubs: { "v-icon": true } },
	});

beforeEach(() => {
	setActivePinia(createPinia());
	useUIStore().posProfile = { name: PROFILE, currency: "MXN", company: "Doco" } as any;
	(window as any).frappe = { ...(window as any).frappe, session: { user: USER } };
	(window as any).__ = undefined;
	sessionStorage.clear();
	setWidth(1280);
	for (const mock of [...Object.values(api), ...Object.values(printing), ...Object.values(listeners)]) mock.mockReset();
	printing.printInvoiceByName.mockResolvedValue(undefined);
	api.loadCreditContext.mockResolvedValue({ enabled: true, reason: null, providers: [], document_kinds: [], max_upload_mb: 10 });
	api.listCreditSales.mockResolvedValue(page());
});

afterEach(() => {
	setWidth(1024);
});

describe("CreditSalesSurface", () => {
	it("opens on the pending queue with both counts, and switches to All", async () => {
		const wrapper = render();
		await flushPromises();
		expect(api.loadCreditContext).toHaveBeenCalledWith(PROFILE, { force: true });
		expect(api.listCreditSales).toHaveBeenLastCalledWith({ posProfile: PROFILE, status: "pending", search: "", limit: 50 });
		expect(wrapper.get('[data-testid="credit-tab-pending"]').attributes("aria-pressed")).toBe("true");
		expect(wrapper.get('[data-testid="credit-count-pending"]').text()).toBe("2");
		expect(wrapper.get('[data-testid="credit-count-all"]').text()).toBe("7");

		const first = wrapper.get('[data-credit-sale="SINV-1"]');
		expect(first.text()).toContain("Ana López");
		expect(first.text()).toContain("Documents 2/4");
		expect(first.text()).toContain("Paperwork pending");
		expect(first.text()).toContain("Sold by Beto Cajero");
		expect(first.text()).toContain(formatMoney(1200, "MXN"));

		api.listCreditSales.mockResolvedValue(page([row("SINV-9")]));
		await wrapper.get('[data-testid="credit-tab-all"]').trigger("click");
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenLastCalledWith({ posProfile: PROFILE, status: "all", search: "", limit: 50 });
		expect(wrapper.get('[data-testid="credit-tab-all"]').attributes("aria-pressed")).toBe("true");
		expect(wrapper.find('[data-credit-sale="SINV-9"]').exists()).toBe(true);
	});

	it("searches, and says so plainly when nothing matches", async () => {
		const wrapper = render();
		await flushPromises();
		api.listCreditSales.mockResolvedValue(page([], { pending: 2, all: 7 }));
		await wrapper.get('[data-testid="credit-search"]').setValue("  zamora ");
		await wrapper.get("form.credit-sales__search").trigger("submit");
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenLastCalledWith({ posProfile: PROFILE, status: "pending", search: "zamora", limit: 50 });
		expect(wrapper.get('[data-testid="credit-sales-empty"]').text()).toContain("No credit sales match “zamora”");
	});

	it("tells the cashier when nothing is pending and offers the full list", async () => {
		api.listCreditSales.mockResolvedValue(page([], { pending: 0, all: 3 }));
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-sales-empty"]').text()).toContain("No paperwork pending");
		await wrapper.get('[data-testid="credit-view-all"]').trigger("click");
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenLastCalledWith(expect.objectContaining({ status: "all" }));
	});

	it("shows the server's reason when credit sales are off here, and nothing else", async () => {
		api.loadCreditContext.mockResolvedValue({ enabled: false, reason: "Ventas a crédito no está activo en esta tienda." });
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-sales-off-reason"]').text()).toBe("Ventas a crédito no está activo en esta tienda.");
		expect(api.listCreditSales).not.toHaveBeenCalled();
		expect(wrapper.find('[data-testid="credit-tab-pending"]').exists()).toBe(false);
		await wrapper.get('[data-testid="credit-sales-close"]').trigger("click");
		expect(listeners.onClose).toHaveBeenCalledTimes(1);
	});

	it("offers Try again when the list or the context cannot be read", async () => {
		api.listCreditSales.mockRejectedValueOnce(new Error("Sin conexión con el servidor."));
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-list-error"]').text()).toContain("Sin conexión con el servidor.");
		await wrapper.get('[data-testid="credit-list-error"] button').trigger("click");
		await flushPromises();
		expect(wrapper.find('[data-testid="credit-list-error"]').exists()).toBe(false);
		expect(wrapper.find('[data-credit-sale="SINV-1"]').exists()).toBe(true);

		api.loadCreditContext.mockRejectedValueOnce(new Error("Permiso denegado."));
		const denied = render();
		await flushPromises();
		expect(denied.get('[data-testid="credit-context-error"]').text()).toContain("Permiso denegado.");
		await denied.get('[data-testid="credit-context-error"] button').trigger("click");
		await flushPromises();
		expect(denied.find('[data-credit-sale="SINV-1"]').exists()).toBe(true);
	});

	it("on a phone, makes the detail its own step with a way back to the same list", async () => {
		setWidth(390);
		const wrapper = render();
		await flushPromises();
		expect(wrapper.find('[data-testid="detail-stub"]').exists()).toBe(false);
		await wrapper.get('[data-credit-sale="SINV-2"]').trigger("click");
		await flushPromises();
		expect(wrapper.get('[data-testid="detail-stub"]').text()).toBe("SINV-2");
		expect(wrapper.get('[data-testid="detail-stub"]').attributes("data-mode")).toBe("queue");
		expect(wrapper.find('[data-testid="credit-tab-pending"]').exists()).toBe(false);
		expect(wrapper.find("h1").exists()).toBe(false);
		expect(wrapper.get('[data-testid="credit-back"]').text()).toContain("Back to credit sales");

		await wrapper.get('[data-testid="credit-back"]').trigger("click");
		await flushPromises();
		expect(wrapper.find('[data-testid="detail-stub"]').exists()).toBe(false);
		expect(wrapper.find('[data-credit-sale="SINV-2"]').exists()).toBe(true);
		expect(api.listCreditSales).toHaveBeenCalledTimes(1);
	});

	it("on a desk, keeps the list beside the chosen sale", async () => {
		const wrapper = render();
		await flushPromises();
		expect(wrapper.text()).toContain("Choose a credit sale");
		await wrapper.get('[data-credit-sale="SINV-1"]').trigger("click");
		await flushPromises();
		expect(wrapper.get('[data-testid="detail-stub"]').text()).toBe("SINV-1");
		expect(wrapper.get('[data-credit-sale="SINV-1"]').attributes("aria-pressed")).toBe("true");
		expect(wrapper.find('[data-testid="credit-tab-pending"]').exists()).toBe(true);
	});

	it("re-reads the list when the detail changes a sale", async () => {
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-credit-sale="SINV-1"]').trigger("click");
		wrapper.findComponent({ name: "CreditSaleDetail" }).vm.$emit("changed", { name: "SINV-1" });
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenCalledTimes(2);
		expect(wrapper.find('[data-credit-sale="SINV-1"]').exists()).toBe(true);
	});

	it("prints the down-payment ticket itself, since the host relays no print", async () => {
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-credit-sale="SINV-1"]').trigger("click");
		wrapper.findComponent({ name: "CreditSaleDetail" }).vm.$emit("print", "SINV-1");
		await flushPromises();
		expect(printing.printInvoiceByName).toHaveBeenCalledWith(
			expect.objectContaining({ name: PROFILE }),
			"Sales Invoice",
			"SINV-1",
		);
	});

	it("tells the cashier when the ticket could not be printed", async () => {
		const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
		printing.printInvoiceByName.mockRejectedValueOnce(new Error("printer offline"));
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-credit-sale="SINV-1"]').trigger("click");
		wrapper.findComponent({ name: "CreditSaleDetail" }).vm.$emit("print", "SINV-1");
		await flushPromises();
		expect(useToastStore().history[0]).toMatchObject({ title: "Unable to print submitted invoice", color: "error" });
		quiet.mockRestore();
	});

	it("remembers the tab, the search and the sale for this user in this browser session", async () => {
		const first = render();
		await flushPromises();
		await first.get('[data-testid="credit-tab-all"]').trigger("click");
		await first.get('[data-testid="credit-search"]').setValue("ana");
		await first.get("form.credit-sales__search").trigger("submit");
		await flushPromises();
		await first.get('[data-credit-sale="SINV-1"]').trigger("click");
		first.unmount();
		expect(JSON.parse(sessionStorage.getItem(`posa:credit-sales:navigation:${USER}:${PROFILE}`) || "{}")).toMatchObject({
			status: "all",
			search: "ana",
			selected: "SINV-1",
		});

		api.listCreditSales.mockClear();
		const again = render();
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenLastCalledWith({ posProfile: PROFILE, status: "all", search: "ana", limit: 50 });
		expect(again.get('[data-testid="detail-stub"]').text()).toBe("SINV-1");
		again.unmount();

		(window as any).frappe.session.user = "otra@doco.test";
		api.listCreditSales.mockClear();
		const someoneElse = render();
		await flushPromises();
		expect(api.listCreditSales).toHaveBeenLastCalledWith(expect.objectContaining({ status: "pending", search: "" }));
		expect(someoneElse.find('[data-testid="detail-stub"]').exists()).toBe(false);
	});

	it("publishes a band with no money action, and withdraws it on leaving", async () => {
		const wrapper = render();
		await flushPromises();
		expect(listeners.onBand).toHaveBeenCalledWith(
			expect.objectContaining({
				labelKey: "Credit sales",
				value: 0,
				primaryAction: expect.objectContaining({ id: "sale.return" }),
				primaryEnabled: true,
			}),
		);
		wrapper.unmount();
		expect(listeners.onBand).toHaveBeenLastCalledWith(null);
	});

	it("opens the sale it was sent to", async () => {
		const wrapper = render({ focusInvoice: "SINV-7" });
		await flushPromises();
		expect(wrapper.get('[data-testid="detail-stub"]').text()).toBe("SINV-7");
	});
});
