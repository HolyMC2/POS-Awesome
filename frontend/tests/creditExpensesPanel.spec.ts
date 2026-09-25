// @vitest-environment jsdom
/**
 * Expenses paid for one credit sale: the register's own «Gasto», linked to
 * the invoice, under the register's cash policy — and the reason on screen
 * when that policy says no. Listeners ride as props (VTU does not record
 * component emits in this repo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const api = vi.hoisted(() => ({ getCreditSaleExpenses: vi.fn() }));
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

import CreditExpensesPanel from "../src/posapp/components/pos/credit/CreditExpensesPanel.vue";
import { formatMoney } from "../src/posapp/components/pos/credit/creditFormat";
import { useToastStore } from "../src/posapp/stores/toastStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const INVOICE = "ACC-SINV-2026-00042";

const expense = (name: string, amount: number, docstatus: 1 | 2, extra = {}) => ({
	name,
	posting_date: "2026-09-24",
	amount,
	expense_account: "Fletes - D",
	remarks: `Envío ${name}`,
	docstatus,
	user: "cajera@doco.test",
	user_name: "Cajera Uno",
	pos_profile: "Doco Ventas",
	pos_opening_shift: "SHIFT-1",
	journal_entry: "JE-1",
	creation: "2026-09-24 10:00:00",
	...extra,
});

const policy = (extra = {}) => ({
	enable_cash_movement: true,
	allow_pos_expense: true,
	require_cash_movement_remarks: false,
	cash_movement_max_amount: 0,
	default_expense_account: "Fletes - D",
	allowed_expense_accounts: ["Activaciones - D", "Fletes - D"],
	...extra,
});

const onChanged = vi.fn();
const render = (props: Record<string, unknown> = {}) =>
	mount(CreditExpensesPanel, {
		props: { invoice: INVOICE, currency: "MXN", editable: true, onChanged, ...props },
		global: { stubs: { "v-icon": true } },
	});

beforeEach(() => {
	setActivePinia(createPinia());
	const ui = useUIStore();
	ui.posProfile = { name: "Doco Ventas", currency: "MXN" } as any;
	ui.posOpeningShift = { name: "SHIFT-1" } as any;
	(window as any).__ = undefined;
	api.getCreditSaleExpenses.mockReset().mockResolvedValue([]);
	cash.loadContext.mockReset().mockResolvedValue(policy());
	cash.submitMovement.mockReset().mockResolvedValue({ name: "PCM-9" });
	onChanged.mockReset();
});

describe("CreditExpensesPanel", () => {
	it("lists the sale's expenses and totals only the submitted ones", async () => {
		api.getCreditSaleExpenses.mockResolvedValue([expense("PCM-1", 150, 1), expense("PCM-2", 80, 2)]);
		const wrapper = render();
		await flushPromises();
		expect(api.getCreditSaleExpenses).toHaveBeenCalledWith(INVOICE);
		expect(wrapper.get('[data-testid="credit-expenses-total"]').text()).toBe(`Total ${formatMoney(150, "MXN")}`);
		expect(wrapper.get('[data-testid="credit-expense-PCM-1"]').text()).not.toContain("Cancelled");
		expect(wrapper.get('[data-testid="credit-expense-PCM-2"]').text()).toContain("Cancelled");
		expect(wrapper.get('[data-testid="credit-expense-PCM-1"]').text()).toContain("Cajera Uno");
	});

	it("records an expense from this register's shift, linked to the sale", async () => {
		const wrapper = render();
		await flushPromises();
		expect(cash.loadContext).toHaveBeenCalledWith("Doco Ventas", "SHIFT-1");
		await wrapper.get('[data-testid="credit-expense-add"]').trigger("click");
		expect((wrapper.get('[data-testid="credit-expense-account"]').element as HTMLSelectElement).value).toBe("Fletes - D");
		await wrapper.get('[data-testid="credit-expense-amount"]').setValue("150");
		await wrapper.get('[data-testid="credit-expense-account"]').setValue("Activaciones - D");
		await wrapper.get('[data-testid="credit-expense-remarks"]').setValue(" Activación del chip ");
		api.getCreditSaleExpenses.mockResolvedValue([expense("PCM-9", 150, 1)]);
		await wrapper.get('[data-testid="credit-expense-form"]').trigger("submit");
		await flushPromises();

		expect(cash.submitMovement).toHaveBeenCalledWith({
			movementType: "Expense",
			amount: 150,
			remarks: "Activación del chip",
			posProfileName: "Doco Ventas",
			posOpeningShiftName: "SHIFT-1",
			expenseAccount: "Activaciones - D",
			clientRequestId: expect.stringMatching(/^credit-expense-[0-9a-f-]{32,36}$/),
			salesInvoice: INVOICE,
		});
		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(wrapper.find('[data-testid="credit-expense-form"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="credit-expense-PCM-9"]').exists()).toBe(true);
		expect(useToastStore().history[0]?.title).toBe("Expense recorded");
	});

	it("re-sends a failed expense with the same request id, so it cannot be paid twice", async () => {
		cash.submitMovement.mockRejectedValueOnce(new Error("Amount exceeds profile cash movement max amount."));
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-expense-add"]').trigger("click");
		await wrapper.get('[data-testid="credit-expense-amount"]').setValue("90");
		await wrapper.get('[data-testid="credit-expense-form"]').trigger("submit");
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-expense-error"]').text()).toContain("max amount");
		expect(onChanged).not.toHaveBeenCalled();
		await wrapper.get('[data-testid="credit-expense-form"]').trigger("submit");
		await flushPromises();
		expect(cash.submitMovement).toHaveBeenCalledTimes(2);
		expect(cash.submitMovement.mock.calls[1][0].clientRequestId).toBe(cash.submitMovement.mock.calls[0][0].clientRequestId);
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it("asks for remarks when the register requires them", async () => {
		cash.loadContext.mockResolvedValue(policy({ require_cash_movement_remarks: true }));
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-expense-add"]').trigger("click");
		expect(wrapper.text()).toContain("Remarks (required)");
		await wrapper.get('[data-testid="credit-expense-amount"]').setValue("90");
		await wrapper.get('[data-testid="credit-expense-form"]').trigger("submit");
		await flushPromises();
		expect(cash.submitMovement).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="credit-expense-error"]').text()).toBe("Write what the expense was for.");
	});

	it.each([
		["no open shift", () => (useUIStore().posOpeningShift = null), "Open a shift on this register"],
		["cash movements off", () => cash.loadContext.mockResolvedValue(policy({ enable_cash_movement: false })), "Cash movements are turned off"],
		["expenses off", () => cash.loadContext.mockResolvedValue(policy({ allow_pos_expense: false })), "Expenses are turned off"],
		[
			"no expense account",
			() => cash.loadContext.mockResolvedValue(policy({ default_expense_account: null, allowed_expense_accounts: [] })),
			"no expense account set up",
		],
	])("explains why an expense cannot be added: %s", async (_case, arrange, reason) => {
		arrange();
		const wrapper = render();
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-expenses-blocked"]').text()).toContain(reason);
		expect(wrapper.find('[data-testid="credit-expense-add"]').exists()).toBe(false);
	});

	it("shows the only allowed account instead of a one-option list", async () => {
		cash.loadContext.mockResolvedValue(policy({ allowed_expense_accounts: [] }));
		const wrapper = render();
		await flushPromises();
		await wrapper.get('[data-testid="credit-expense-add"]').trigger("click");
		expect(wrapper.find('[data-testid="credit-expense-account"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="credit-expense-account-fixed"]').text()).toBe("Fletes - D");
	});

	it("only lists when it may not add", async () => {
		const wrapper = render({ editable: false });
		await flushPromises();
		expect(cash.loadContext).not.toHaveBeenCalled();
		expect(wrapper.find('[data-testid="credit-expense-add"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="credit-expenses-blocked"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="credit-expenses-empty"]').text()).toContain("No expenses recorded");
	});
});
