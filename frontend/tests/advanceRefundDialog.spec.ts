// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdvanceRefundDialog from "../src/posapp/components/pos_pay/AdvanceRefundDialog.vue";
import { db, initPromise, memory } from "../src/offline/db";
import { getTerminalCredentials } from "../src/offline/shiftTerminal";
import { getPendingAdvanceRefund } from "../src/offline/payments";

const Box = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
const Field = defineComponent({
	props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"],
	setup: (props, { emit }) => () => h("input", {
		value: props.modelValue, "aria-label": props.label, disabled: props.disabled,
		onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
	}),
});
const Button = defineComponent({
	props: ["disabled", "loading"],
	setup: (props, { slots }) => () => h("button", { disabled: props.disabled || props.loading }, slots.default?.()),
});
const call = vi.fn();
const refunded = vi.fn();
const close = vi.fn();
const wrappers: VueWrapper[] = [];
const shift = { name: "SHIFT-REFUND-UI", user: "cashier@example.com", pos_profile: "COUNTER" };
const quote = { paid_amount: 40, paid_currency: "MXN" };

function openDialog() {
	const wrapper = mount(AdvanceRefundDialog, {
		props: {
			payment: { name: "RECEIPT-UI", unallocated_amount: 100, currency: "MXN", mode_of_payment: "Cash" },
			posProfile: { name: "COUNTER", company: "COMPANY", payments: [{ mode_of_payment: "Cash" }, { mode_of_payment: "Bank" }] },
			openingShift: shift, customer: "CUSTOMER", onRefunded: refunded, onClose: close,
		},
		global: { components: {
			VDialog: Box, VCard: Box, VCardTitle: Box, VCardText: Box, VCardActions: Box,
			VAlert: Box, VSpacer: Box, VBtn: Button, VTextField: Field, VSelect: Field, VTextarea: Field,
		} },
	});
	wrappers.push(wrapper);
	return wrapper;
}

function button(wrapper: VueWrapper, label: string) {
	const result = wrapper.findAll("button").find((node) => node.text() === label);
	if (!result) throw new Error(`Missing button ${label}`);
	return result;
}

async function review(wrapper: VueWrapper) {
	await flushPromises();
	await wrapper.get('[aria-label="Refund amount"]').setValue("40");
	await wrapper.get('[aria-label="Refund reason"]').setValue("Customer requests unused cash back");
	await button(wrapper, "Review refund").trigger("click");
	await vi.waitFor(() => expect(wrapper.find('[data-test="advance-refund-confirm"]').exists()).toBe(true));
}

beforeEach(async () => {
	await initPromise;
	for (const table of ["write_queue", "invoice_outbox", "keyval", "queue"]) await db.table(table).clear();
	localStorage.clear();
	Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
	(globalThis as any).__ = (value: string) => value;
	(globalThis as any).frappe = { session: { user: shift.user }, call };
	call.mockReset(); refunded.mockReset(); close.mockReset();
	for (const key of ["offline_invoices", "offline_customers", "offline_payments", "offline_cash_movements"]) memory[key] = [];
	const credentials = getTerminalCredentials();
	memory.pos_opening_storage = { pos_profile: { name: shift.pos_profile }, terminal_status: { owned: true },
		pos_opening_shift: { ...shift, posa_terminal_id: credentials.terminal_id, posa_terminal_generation: 1 } };
	call.mockResolvedValue({ message: quote });
});

afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); });

describe("advance refund operator confirmation", () => {
	it("requires valid input and a server quote before showing confirmation or persisting a refund", async () => {
		const wrapper = openDialog();
		await flushPromises();
		expect(button(wrapper, "Review refund").attributes("disabled")).toBeDefined();
		expect(wrapper.find('[data-test="advance-refund-confirm"]').exists()).toBe(false);
		await review(wrapper);
		expect(call).toHaveBeenCalledTimes(1);
		expect(call).toHaveBeenCalledWith(expect.objectContaining({
			method: "posawesome.posawesome.api.payment_entry.preview_customer_advance_refund",
			args: { payload: expect.objectContaining({ amount: 40, original_payment_entry: "RECEIPT-UI", terminal_generation: 1 }) },
		}));
		expect(wrapper.text()).toContain("40 MXN");
		expect(await db.table("write_queue").count()).toBe(0);
		expect(refunded).not.toHaveBeenCalled();
	});

	it.each([["Refund amount", "30"], ["Mode of Payment", "Bank"], ["Refund reason", "A different requested refund"]])(
		"clears the reviewed quote when %s changes", async (label, value) => {
			const wrapper = openDialog();
			await review(wrapper);
			await wrapper.get(`[aria-label="${label}"]`).setValue(value);
			expect(wrapper.find('[data-test="advance-refund-confirm"]').exists()).toBe(false);
			expect(wrapper.text()).not.toContain("Cash or bank payout");
			expect(button(wrapper, "Review refund").exists()).toBe(true);
			expect(await db.table("write_queue").count()).toBe(0);
		},
	);

	it("does not allow confirmation when the quote is not a valid positive payout", async () => {
		call.mockResolvedValue({ message: { paid_amount: "NaN", paid_currency: "MXN" } });
		const wrapper = openDialog();
		await flushPromises();
		await wrapper.get('[aria-label="Refund reason"]').setValue("Customer requests unused cash back");
		await button(wrapper, "Review refund").trigger("click");
		await vi.waitFor(() => expect(wrapper.text()).toContain("A valid refund quote is required."));
		expect(wrapper.find('[data-test="advance-refund-confirm"]').exists()).toBe(false);
		expect(await db.table("write_queue").count()).toBe(0);
	});

	it("keeps an unknown response pending and restores the exact request and proof on reopen", async () => {
		const wrapper = openDialog();
		await review(wrapper);
		call.mockImplementationOnce(async () => {
			expect(await db.table("write_queue").count()).toBe(1);
			return { message: { status: "accepted" } };
		});
		await button(wrapper, "Confirm refund").trigger("click");
		await vi.waitFor(() => expect(wrapper.text()).toContain("Refund is not confirmed."));
		expect(refunded).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		const pending = await getPendingAdvanceRefund("RECEIPT-UI");
		const original = JSON.parse(JSON.stringify(pending!.payload.args.payload));
		expect(original.client_request_id).toMatch(/^pay-/);
		wrapper.unmount();
		memory.pos_opening_storage.pos_opening_shift.posa_terminal_generation = 9;
		const reopened = openDialog();
		await vi.waitFor(() => expect(reopened.text()).toContain("Check or retry refund"));
		for (const label of ["Refund amount", "Mode of Payment", "Refund reason"]) {
			expect(reopened.get(`[aria-label="${label}"]`).attributes("disabled")).toBeDefined();
		}
		expect((reopened.get('[aria-label="Refund amount"]').element as HTMLInputElement).value).toBe("40");
		const result = { docstatus: 1, client_request_id: original.client_request_id,
			original_payment_entry: "RECEIPT-UI", refund_payment_entry: "REFUND-UI", refunded_amount: 40 };
		call.mockResolvedValueOnce({ message: result });
		await button(reopened, "Check or retry refund").trigger("click");
		await vi.waitFor(() => expect(refunded).toHaveBeenCalledWith(result));
		expect(refunded).toHaveBeenCalledTimes(1);
		expect(call.mock.lastCall![0].args.payload).toEqual(original);
		expect(call.mock.lastCall![0].args.payload.terminal_generation).toBe(1);
		expect(close).toHaveBeenCalledTimes(1);
		expect(await getPendingAdvanceRefund("RECEIPT-UI")).toBeNull();
	});
});
