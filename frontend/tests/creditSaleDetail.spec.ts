// @vitest-environment jsdom
/**
 * One credit sale as the register shows it.
 *
 * The facts come from the server in the sale's own currency; the management
 * figures (provider commission, expected settlement, bonus, seller
 * commission) never reach the screen even when a payload carries them; the
 * lock is offered only when the server says this user may lock, and asks
 * first. Listeners ride as props: VTU does not record component emits here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const api = vi.hoisted(() => ({
	getCreditSale: vi.fn(),
	loadCreditContext: vi.fn(),
	updateCreditSale: vi.fn(),
	lockCreditSale: vi.fn(),
	getCreditSaleExpenses: vi.fn(),
	attachCreditDocument: vi.fn(),
	removeCreditDocument: vi.fn(),
}));
vi.mock("../src/posapp/components/pos/credit/creditApi", () => api);

const cash = vi.hoisted(() => ({ loadContext: vi.fn(), submitMovement: vi.fn() }));
vi.mock("../src/posapp/composables/pos/cash/useCashMovement", async () => {
	const { ref } = await import("vue");
	return {
		useCashMovement: () => {
			const context = ref<any>(null);
			return {
				context,
				submitting: ref(false),
				loadContext: async (...args: unknown[]) => {
					context.value = await cash.loadContext(...args);
					return context.value;
				},
				submitMovement: cash.submitMovement,
			};
		},
	};
});

import CreditSaleDetail from "../src/posapp/components/pos/credit/CreditSaleDetail.vue";
import type { CreditSale } from "../src/posapp/components/pos/credit/creditApi";
import { formatMoney } from "../src/posapp/components/pos/credit/creditFormat";
import { useUIStore } from "../src/posapp/stores/uiStore";

const INVOICE = "ACC-SINV-2026-00042";

const sale = (extra: Partial<CreditSale> & Record<string, unknown> = {}): CreditSale =>
	({
		name: INVOICE,
		docstatus: 1,
		pos_profile: "Doco Ventas",
		company: "Doco",
		currency: "MXN",
		posting_date: "2026-09-24",
		customer: "CUST-0001",
		customer_name: "Ana López",
		owner_name: "Beto Cajero",
		is_financed: 1,
		credit_provider: "Payjoy",
		provider_label: "PayJoy",
		shape: "enganche",
		customer_offered_price: 6499,
		enganche: 1200,
		financed_amount: 0,
		credit_amount: 5299,
		plan_months: 12,
		plan_monthly: 540.5,
		notes: "Paga los viernes",
		compliance: "Faltante",
		items: [
			{ item_code: "MOTO-G54", item_name: "Moto G54", qty: 1, serial_no: "359876000000001", financed: true },
			{ item_code: "MICA-01", item_name: "Mica", qty: 1, serial_no: null, financed: false },
		],
		documents: {
			required: [{ kind: "ine", label: "INE", satisfied: false, via_serial: false, file: null }],
			extra: [],
			missing: 1,
			total: 1,
			complete: false,
		},
		can_edit: true,
		can_lock: false,
		...extra,
	}) as CreditSale;

const complete = {
	required: [
		{
			kind: "ine",
			label: "INE",
			satisfied: true,
			via_serial: false,
			file: { name: "F-1", file_name: "ine.jpg", file_url: "/private/files/ine.jpg", is_image: true, can_remove: true },
		},
	],
	extra: [],
	missing: 0,
	total: 1,
	complete: true,
};

const listeners = { onChanged: vi.fn(), onLoaded: vi.fn(), onPrint: vi.fn(), onClose: vi.fn() };

const render = (mode: "after-sale" | "queue" = "queue") =>
	mount(CreditSaleDetail, {
		props: { invoice: INVOICE, mode, ...listeners },
		global: { stubs: { "v-icon": true } },
	});

const money = (value: number) => formatMoney(value, "MXN");

beforeEach(() => {
	setActivePinia(createPinia());
	const ui = useUIStore();
	ui.posProfile = { name: "Doco Ventas", currency: "MXN", company: "Doco" } as any;
	ui.posOpeningShift = { name: "SHIFT-1" } as any;
	(window as any).__ = undefined;
	for (const mock of [...Object.values(api), ...Object.values(cash), ...Object.values(listeners)]) mock.mockReset();
	api.getCreditSale.mockResolvedValue(sale());
	api.loadCreditContext.mockResolvedValue({ enabled: true, document_kinds: ["Contract"], max_upload_mb: 8 });
	api.getCreditSaleExpenses.mockResolvedValue([]);
	cash.loadContext.mockResolvedValue({
		enable_cash_movement: true,
		allow_pos_expense: true,
		default_expense_account: "Gastos varios - D",
		allowed_expense_accounts: [],
	});
});

describe("CreditSaleDetail", () => {
	it("shows the sale's facts in its own currency, with who sold it and what is on credit", async () => {
		const wrapper = render();
		await flushPromises();
		expect(api.getCreditSale).toHaveBeenCalledWith(INVOICE);
		expect(listeners.onLoaded).toHaveBeenCalledWith(expect.objectContaining({ name: INVOICE }));
		expect(wrapper.get('[data-testid="credit-detail-customer"]').text()).toBe("Ana López");
		expect(wrapper.text()).toContain("Sold by Beto Cajero");
		expect(wrapper.text()).toContain(INVOICE);
		expect(wrapper.get('[data-testid="credit-detail-compliance"]').text()).toBe("Paperwork pending");

		expect(wrapper.get('[data-testid="credit-fact-price"]').text()).toBe(money(6499));
		expect(wrapper.get('[data-testid="credit-fact-enganche"]').text()).toBe(money(1200));
		expect(wrapper.get('[data-testid="credit-fact-financed"]').text()).toBe(money(5299));
		expect(wrapper.get('[data-testid="credit-detail-facts"]').text()).toContain("Financed by PayJoy");
		expect(wrapper.get('[data-testid="credit-fact-term"]').text()).toBe("12 months");
		expect(wrapper.get('[data-testid="credit-fact-monthly"]').text()).toBe(money(540.5));

		expect(wrapper.findAll('[data-testid="credit-item-financed"]')).toHaveLength(1);
		expect(wrapper.text()).toContain("Serial no. 359876000000001");
		// The document checklist is fed the context's kinds and upload limit.
		const panel = wrapper.findComponent({ name: "CreditDocumentsPanel" });
		expect(panel.props()).toMatchObject({ invoice: INVOICE, editable: true, documentKinds: ["Contract"], maxUploadMb: 8 });
		expect(api.loadCreditContext).toHaveBeenCalledWith("Doco Ventas");
	});

	it("never shows commission, settlement or bonus figures, even when the payload carries them", async () => {
		api.getCreditSale.mockResolvedValue(
			sale({
				expected_commission: 777.77,
				expected_settlement: 4888.88,
				expected_bonus: 99.99,
				seller_commission: 150.25,
				commission: 321.45,
			}),
		);
		const wrapper = render();
		await flushPromises();
		const text = wrapper.text();
		const html = wrapper.html();
		for (const figure of [777.77, 4888.88, 99.99, 150.25, 321.45]) {
			expect(text).not.toContain(money(figure));
			expect(html).not.toContain(String(figure));
		}
		expect(text).not.toMatch(/commission|settlement|bonus|comisi[oó]n|liquidaci[oó]n|bono/i);
	});

	it("offers the lock only when the server allows it", async () => {
		const wrapper = render();
		await flushPromises();
		expect(wrapper.find('[data-testid="credit-detail-lock"]').exists()).toBe(false);

		api.getCreditSale.mockResolvedValue(sale({ can_lock: true, compliance: "Completo", documents: complete }));
		const locked = render();
		await flushPromises();
		expect(locked.find('[data-testid="credit-detail-lock"]').exists()).toBe(false);
	});

	it("explains why the lock waits while documents are missing", async () => {
		api.getCreditSale.mockResolvedValue(sale({ can_lock: true }));
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-detail-lock"]').attributes("disabled")).toBeDefined();
		expect(wrapper.get('[data-testid="credit-detail-lock-blocked"]').text()).toContain("Attach the missing documents");
	});

	it("confirms before marking the paperwork complete, then adopts the server's answer", async () => {
		api.getCreditSale.mockResolvedValue(sale({ can_lock: true, documents: complete }));
		const lockedSale = sale({ can_lock: false, compliance: "Completo", documents: complete });
		api.lockCreditSale.mockResolvedValue(lockedSale);
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-detail-lock"]').trigger("click");
		expect(api.lockCreditSale).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="credit-detail-lock-confirm-box"]').text()).toContain("attached and legible");
		await wrapper.get('[data-testid="credit-detail-lock-confirm"]').trigger("click");
		await flushPromises();
		expect(api.lockCreditSale).toHaveBeenCalledWith(INVOICE);
		expect(listeners.onChanged).toHaveBeenCalledWith(lockedSale);
		expect(wrapper.get('[data-testid="credit-detail-compliance"]').text()).toBe("Paperwork complete");
		expect(wrapper.find('[data-testid="credit-detail-lock"]').exists()).toBe(false);
	});

	it("shows why the lock failed and keeps the sale as it was", async () => {
		api.getCreditSale.mockResolvedValue(sale({ can_lock: true, documents: complete }));
		api.lockCreditSale.mockRejectedValue(new Error("Solo un gerente puede cerrar el expediente."));
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-detail-lock"]').trigger("click");
		await wrapper.get('[data-testid="credit-detail-lock-confirm"]').trigger("click");
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-detail-lock-error"]').text()).toBe("Solo un gerente puede cerrar el expediente.");
		expect(wrapper.get('[data-testid="credit-detail-compliance"]').text()).toBe("Paperwork pending");
		expect(listeners.onChanged).not.toHaveBeenCalled();
	});

	it("asks for the down-payment ticket with the invoice name", async () => {
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-detail-print"]').trigger("click");
		expect(listeners.onPrint).toHaveBeenCalledWith(INVOICE);
	});

	it("saves the plan and notes through update_credit_sale", async () => {
		const saved = sale({ plan_months: 18, plan_monthly: 400, notes: "Paga los lunes" });
		api.updateCreditSale.mockResolvedValue(saved);
		const wrapper = render();
		await flushPromises();
		const save = wrapper.get('[data-testid="credit-plan-save"]');
		expect(save.attributes("disabled")).toBeDefined();
		await wrapper.get('[data-testid="credit-plan-months"]').setValue("18");
		await wrapper.get('[data-testid="credit-plan-monthly"]').setValue("400");
		await wrapper.get('[data-testid="credit-plan-notes"]').setValue("Paga los lunes ");
		await wrapper.get("form.credit-detail__plan").trigger("submit");
		await flushPromises();
		expect(api.updateCreditSale).toHaveBeenCalledWith(INVOICE, {
			plan_months: 18,
			plan_monthly: 400,
			notes: "Paga los lunes",
		});
		expect(listeners.onChanged).toHaveBeenCalledWith(saved);
		expect(wrapper.get('[data-testid="credit-fact-term"]').text()).toBe("18 months");
	});

	it("refuses a fractional term before calling the server", async () => {
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-plan-months"]').setValue("6.5");
		await wrapper.get("form.credit-detail__plan").trigger("submit");
		await flushPromises();
		expect(api.updateCreditSale).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="credit-plan-error"]').text()).toContain("whole number of months");
	});

	it("shows notes read-only when the sale cannot be edited", async () => {
		api.getCreditSale.mockResolvedValue(sale({ can_edit: false }));
		const wrapper = render();
		await flushPromises();
		expect(wrapper.find('[data-testid="credit-plan-save"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="credit-plan-readonly"]').text()).toBe("Paga los viernes");
		expect(wrapper.findComponent({ name: "CreditDocumentsPanel" }).props("editable")).toBe(false);
	});

	it("keeps the documents answer and reports the sale as changed", async () => {
		const wrapper = render();
		await flushPromises();
		wrapper.findComponent({ name: "CreditDocumentsPanel" }).vm.$emit("update:documents", complete);
		await flushPromises();
		expect(listeners.onChanged).toHaveBeenCalledWith(expect.objectContaining({ documents: complete }));
		expect(wrapper.findComponent({ name: "CreditDocumentsPanel" }).props("documents")).toEqual(complete);
	});

	it("offers Try again and Close when the sale cannot be read", async () => {
		api.getCreditSale.mockRejectedValueOnce(new Error("No tienes acceso a esta venta."));
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-detail-error"]').text()).toContain("No tienes acceso a esta venta.");
		await wrapper.get('[data-testid="credit-detail-close"]').trigger("click");
		expect(listeners.onClose).toHaveBeenCalledTimes(1);
		await wrapper.get('[data-testid="credit-detail-retry"]').trigger("click");
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-detail-customer"]').text()).toBe("Ana López");
	});

	it("leads with the checklist right after the sale", async () => {
		const wrapper = render("after-sale");
		await flushPromises();
		const html = wrapper.html();
		expect(wrapper.text()).toContain("Attach the documents now, while the customer is still here.");
		expect(html.indexOf('data-testid="credit-documents"')).toBeLessThan(html.indexOf('data-testid="credit-detail-facts"'));
		const queue = render("queue");
		await flushPromises();
		const queueHtml = queue.html();
		expect(queueHtml.indexOf('data-testid="credit-detail-facts"')).toBeLessThan(queueHtml.indexOf('data-testid="credit-documents"'));
	});
});
