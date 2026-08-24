// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

import GiftCardsView from "../src/posapp/components/pos/wallet/GiftCardsView.vue";
import { useEmployeeStore } from "../src/posapp/stores/employeeStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

/**
 * Tarjeta de regalo, lookup-first (`TarjetaRegalo.dc.html`).
 *
 * The surface this replaced was a marketing page: a hero, three access badges
 * and three stat cards narrating the permission model around one code field.
 * These cases hold the contract that replaced it — the field is always there,
 * a resolved card paints its own ledger, and the supervisor gate is written on
 * the verb rather than deleting it.
 */

const VIconStub = defineComponent({
	name: "VIconStub",
	props: { icon: { type: String, default: "" } },
	setup(props) {
		return () => h("i", { "data-icon": props.icon });
	},
});

const CARD = {
	gift_card_code: "GC-7Q4M2X",
	current_balance: 350,
	status: "Active",
	currency: "MXN",
	expiry_date: "2027-02-12",
	issued_by: "vanessa@example.com",
	issued_on: "2026-08-12 09:00:00",
	last_redeemed_on: "2026-08-23 10:22:00",
	transactions_limit: 20,
	transactions: [
		{
			transaction_type: "Redeem",
			amount: -120,
			balance_after: 350,
			posting_datetime: "2026-08-23 10:22:00",
			cashier: "vanessa@example.com",
			reference_doctype: "Sales Invoice",
			reference_name: "ACC-SINV-2026-00212",
		},
		{
			transaction_type: "Top Up",
			amount: 200,
			balance_after: 470,
			posting_datetime: "2026-08-20 11:00:00",
			cashier: "marco@example.com",
		},
	],
};

const flushPromises = async () => {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

let call: ReturnType<typeof vi.fn>;

const mountView = () =>
	mount(GiftCardsView, { global: { stubs: { "v-icon": VIconStub } } });

const asSupervisor = (isSupervisor: boolean) => {
	useEmployeeStore().setCurrentCashier({
		user: "vanessa@example.com",
		full_name: "Vanessa",
		is_supervisor: isSupervisor,
	} as any);
};

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	vi.stubGlobal("__", (value: string, params?: unknown[]) =>
		Array.isArray(params)
			? params.reduce<string>(
					(text, param, index) => text.replace(`{${index}}`, String(param)),
					value,
				)
			: value,
	);
	vi.stubGlobal("format_currency", (value: number) => `$${Number(value).toFixed(2)}`);
	vi.stubGlobal("flt", (value: unknown) => Number(value || 0));
	call = vi.fn(async () => ({ message: CARD }));
	vi.stubGlobal("frappe", {
		_: (value: string) => value,
		call,
		datetime: { get_today: () => "2026-08-23" },
	});
	useUIStore().setPosProfile({
		name: "Doco Ventas",
		company: "Doco SA",
		currency: "MXN",
		posa_use_gift_cards: 1,
	} as any);
	asSupervisor(true);
});

describe("the lookup field is the screen", () => {
	it("renders the code field before any card is resolved", () => {
		const wrapper = mountView();

		expect(wrapper.find('[data-testid="gift-card-lookup-input"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="gift-card-panel"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="gift-card-empty"]').text()).toContain(
			"Scan or type a code",
		);
	});

	it("keeps none of the marketing surface it replaced", () => {
		const text = mountView().text();

		expect(text).not.toContain("Gift Card Management");
		expect(text).not.toContain("Scan-Ready");
		expect(text).not.toContain("Supervisor Access");
		expect(text).not.toContain("Cashier Access");
	});

	it("submitting the field looks the card up and asks for its ledger", async () => {
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-7Q4M2X");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		expect(call).toHaveBeenCalledTimes(1);
		const args = call.mock.calls[0][0];
		expect(args.method).toBe(
			"posawesome.posawesome.api.gift_cards.check_gift_card_balance",
		);
		expect(args.args.gift_card_code).toBe("GC-7Q4M2X");
		expect(args.args.company).toBe("Doco SA");
		// The panel draws a ledger, so the lookup asks for one.
		expect(args.args.include_transactions).toBe(1);
	});

	it("says which code it could not find, and offers to issue it", async () => {
		call.mockRejectedValueOnce({ message: "Gift card GC-NOPE does not exist." });
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-NOPE");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		expect(wrapper.find('[data-testid="gift-card-empty"]').text()).toContain("GC-NOPE");
		expect(wrapper.find('[data-testid="gift-card-issue-missing"]').exists()).toBe(true);
	});

	it("reads the refusal out of _server_messages, not the transport error", async () => {
		call.mockRejectedValueOnce({
			message: "Internal Server Error",
			_server_messages: JSON.stringify([
				JSON.stringify({ message: "<div>Gift cards are not enabled in POS Profile</div>" }),
			]),
		});
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-X");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		const message = wrapper.find('[role="status"]').text();
		expect(message).toContain("Gift cards are not enabled in POS Profile");
		expect(message).not.toContain("Internal Server Error");
	});
});

describe("the resolved card", () => {
	const resolve = async () => {
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-7Q4M2X");
		await wrapper.find("form").trigger("submit");
		await flushPromises();
		return wrapper;
	};

	it("paints the balance, the state and who issued it", async () => {
		const wrapper = await resolve();

		expect(wrapper.find('[data-testid="gift-card-balance"]').text()).toBe("$350.00");
		expect(wrapper.find('[data-testid="gift-card-status"]').text()).toBe("Active");
		expect(wrapper.find('[data-testid="gift-card-code"]').text()).toBe("GC-7Q4M2X");
		expect(wrapper.find('[data-testid="gift-card-panel"]').text()).toContain(
			"vanessa@example.com",
		);
	});

	it("draws the card's own movements, signed, newest first", async () => {
		const rows = (await resolve()).findAll('[data-testid="gift-card-ledger-row"]');

		expect(rows).toHaveLength(2);
		expect(rows[0].text()).toContain("−$120.00");
		expect(rows[0].text()).toContain("ACC-SINV-2026-00212");
		expect(rows[1].text()).toContain("+$200.00");
	});

	it("states the ledger cap rather than implying it drew everything", async () => {
		expect((await resolve()).find('[data-testid="gift-card-ledger"]').text()).toContain("20");
	});

	it("says where the money leaves — Cobro, as a payment method", async () => {
		expect((await resolve()).find('[data-testid="gift-card-panel"]').text()).toContain(
			"In Cobro · as a payment method",
		);
	});
});

describe("the supervisor gate is a chip, not a deletion", () => {
	it("shows the gated verbs to a cashier, disabled and labelled", async () => {
		asSupervisor(false);
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-7Q4M2X");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		const topUp = wrapper.find('[data-testid="gift-card-topup-mode"]');
		expect(topUp.exists()).toBe(true);
		expect(topUp.attributes("disabled")).toBeDefined();
		// A cashier who cannot see the verb learns the register is broken; one
		// who sees it greyed with «Supervisor» on it learns who to call.
		expect(topUp.text()).toContain("Supervisor");
		// And checking is never gated.
		expect(wrapper.find('[data-testid="gift-card-lookup"]').attributes("disabled")).toBeUndefined();
	});

	it("lets a supervisor top the card up through the panel", async () => {
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-lookup-input"]').setValue("GC-7Q4M2X");
		await wrapper.find("form").trigger("submit");
		await flushPromises();

		await wrapper.find('[data-testid="gift-card-topup-mode"]').trigger("click");
		await wrapper.find('[data-testid="gift-card-topup-amount"]').setValue("200");
		await wrapper.find('[data-testid="gift-card-topup-confirm"]').trigger("click");
		await flushPromises();

		const methods = call.mock.calls.map((entry) => entry[0].method);
		expect(methods).toContain("posawesome.posawesome.api.gift_cards.top_up_gift_card");
		// The write returns the lean serializer, so the ledger is re-read.
		expect(methods.filter((m) => m.endsWith("check_gift_card_balance"))).toHaveLength(2);
	});

	it("offers issue with a generated code or one that was scanned", async () => {
		const wrapper = mountView();
		await wrapper.find('[data-testid="gift-card-issue-mode"]').trigger("click");
		await wrapper.find('[data-testid="gift-card-issue-amount"]').setValue("300");
		await wrapper.find('[data-testid="gift-card-issue-confirm"]').trigger("click");
		await flushPromises();

		const issue = call.mock.calls.find(
			(entry) => entry[0].method === "posawesome.posawesome.api.gift_cards.issue_gift_card",
		);
		expect(issue).toBeTruthy();
		// Empty code = let the server generate one.
		expect(issue?.[0].args.gift_card_code).toBeNull();
		expect(issue?.[0].args.initial_amount).toBe(300);
	});
});
