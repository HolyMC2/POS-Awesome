// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import RecargasView from "../src/posapp/components/pos/recargas/RecargasView.vue";

/**
 * The Recargas destination, mounted (build plan §12 item F, `Recargas.dc.html`).
 *
 * Two things this screen has to get right, and they pull against each other.
 * It must show what the register genuinely knows — the pouch, the day's rows,
 * the companies and the amounts that can actually be sent — and it must show
 * NOTHING where the artboard drew a figure the stack cannot source. The second
 * half is the one a screenshot never catches, so most of what follows asserts
 * an absence.
 *
 * Nothing here reaches saldo or TAECEL. Every payload is a literal, the way a
 * server would have returned it.
 */

/** A marker no formatter produces, so counting it counts MONEY, not digits. */
const MONEY = "¤";
const currency = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;
const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

const TODAY = "2026-08-22";

const CATALOG = {
	categorias: [
		{
			name: "Tiempo Aire",
			carriers: [
				{
					name: "Telcel",
					label: "Telcel",
					tipo: "0",
					products: [
						{ codigo: "TEL050", nombre: "Telcel $50", monto: 50 },
						{ codigo: "TEL200", nombre: "Telcel $200", monto: 200 },
					],
				},
				{
					name: "Bait",
					label: "Bait",
					tipo: "0",
					products: [{ codigo: "BAI050", nombre: "Bait $50", monto: 50 }],
				},
			],
		},
		{
			name: "Servicios",
			carriers: [{ name: "CFE", label: "CFE", tipo: "1", products: [] }],
		},
	],
};

const ROWS = [
	{
		name: "SLDO-0001",
		status: "Success",
		requested_at: `${TODAY} 19:41:00`,
		referencia: "5528416390",
		monto: 200,
		saldo_carrier: "Telcel",
		saldo_product: "Telcel $200",
	},
	{
		name: "SLDO-0002",
		status: "Refunded",
		requested_at: `${TODAY} 16:12:00`,
		referencia: "5511117716",
		monto: 20,
		saldo_carrier: "Unefon",
		saldo_product: "Unefon $20",
	},
];

const mountView = (props: Record<string, unknown> = {}) =>
	mount(RecargasView, {
		props: {
			today: TODAY,
			ledgerLimit: 200,
			formatCurrency: currency,
			posProfile: { saldo_enabled: 1 },
			catalogTree: CATALOG,
			rows: ROWS,
			bolsaPayload: { visible: true, balance: 1240, as_of: `${TODAY} 19:45:00` },
			...props,
		},
	});

beforeEach(() => {
	vi.stubGlobal("__", (value: string) => value);
});

describe("the capability gate hides the whole surface", () => {
	it("renders nothing at all on a register that does not sell airtime", () => {
		// Ruling R3: gated destinations are ABSENT, not disabled. A carnicería
		// gets no Recargas screen, not an empty one.
		const view = mountView({ posProfile: { saldo_enabled: 0 } });
		expect(view.find('[data-testid="recargas-view"]').exists()).toBe(false);
		expect(view.text()).toBe("");
	});

	it("renders on the POS Profile flag the saldo app installs", () => {
		expect(mountView().find('[data-testid="recargas-view"]').exists()).toBe(true);
	});

	it("renders on the capability alone, so the two gates cannot disagree", () => {
		const view = mountView({ posProfile: {}, hasCapability: (c: string) => c === "saldo" });
		expect(view.find('[data-testid="recargas-view"]').exists()).toBe(true);
	});
});

describe("it draws the catalogue the register actually has", () => {
	it("builds its tabs from the real categories, not the artboard's three", () => {
		const view = mountView();
		expect(view.find('[data-testid="recargas-tab-Tiempo Aire"]').exists()).toBe(true);
		expect(view.find('[data-testid="recargas-tab-Servicios"]').exists()).toBe(true);
		expect(view.findAll('[data-testid^="recargas-tab-"]')).toHaveLength(2);
	});

	it("shows the companies of the open tab", () => {
		const view = mountView();
		expect(view.find('[data-testid="recargas-carrier-Telcel"]').text()).toBe("Telcel");
		expect(view.find('[data-testid="recargas-carrier-CFE"]').exists()).toBe(false);
	});

	it("offers only amounts that exist as a product on the chosen company", async () => {
		// The artboard draws $10–$500 for everybody. An amount with no product
		// behind it has no Item and could never be sent.
		const view = mountView();
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		expect(view.findAll('[data-money-role="amount-preset"]').map((b) => b.text())).toEqual([
			currency(50),
			currency(200),
		]);
	});

	it("gives an open-amount company a typed field instead of preset buttons", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-tab-Servicios"]').trigger("click");
		await view.find('[data-testid="recargas-carrier-CFE"]').trigger("click");
		expect(view.findAll('[data-money-role="amount-preset"]')).toHaveLength(0);
		expect(view.find('[data-testid="recargas-free-amount"]').exists()).toBe(true);
	});

	it("forgets the amount when the company changes", async () => {
		// A $200 left highlighted on a company with no $200 product would arm the
		// band for a recharge that cannot be sent.
		const onIntent = vi.fn();
		const view = mountView({ onIntent });
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		await view.find('[data-testid="recargas-amount-TEL200"]').trigger("click");
		await view.find('[data-testid="recargas-carrier-Bait"]').trigger("click");
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({ intent: expect.objectContaining({ amount: null, itemCode: null }) }),
		);
	});
});

describe("the number is typed twice", () => {
	it("arms nothing until the second field matches, and names the mismatch", async () => {
		const onIntent = vi.fn();
		const view = mountView({ onIntent });
		await view.find('[data-testid="recargas-reference"]').setValue("5528416390");
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({ intent: expect.objectContaining({ reference: "" }) }),
		);
		expect(view.find('[data-testid="recargas-reference-mismatch"]').exists()).toBe(false);

		await view.find('[data-testid="recargas-reference-confirm"]').setValue("5528416391");
		expect(view.find('[data-testid="recargas-reference-mismatch"]').exists()).toBe(true);
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({ intent: expect.objectContaining({ reference: "" }) }),
		);

		await view.find('[data-testid="recargas-reference-confirm"]').setValue("5528416390");
		expect(view.find('[data-testid="recargas-reference-mismatch"]').exists()).toBe(false);
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({ intent: expect.objectContaining({ reference: "5528416390" }) }),
		);
	});
});

describe("what the number field says, and what it refuses to say", () => {
	it("says nothing at all about an empty field", () => {
		expect(mountView().find('[data-testid="recargas-hint"]').exists()).toBe(false);
	});

	it("asks the operator to keep typing while the number is short", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-reference"]').setValue("552841");
		expect(view.find('[data-testid="recargas-hint"]').attributes("data-hint-reason")).toBe(
			"incomplete",
		);
	});

	it("asks WHICH company for a complete number nothing recognises", async () => {
		// The shipped prefix table is empty on purpose (full portability since
		// 2019), so this is the ordinary case on a number never seen here.
		const view = mountView({ rows: [] });
		await view.find('[data-testid="recargas-reference"]').setValue("5599990000");
		expect(view.find('[data-testid="recargas-hint"]').attributes("data-hint-reason")).toBe(
			"no-source",
		);
		expect(view.find('[data-testid="recargas-hint"]').text()).toContain("Which company?");
	});

	it("selects NO company from a hint the operator has not pressed", async () => {
		const onIntent = vi.fn();
		const view = mountView({ onIntent });
		await view.find('[data-testid="recargas-reference"]').setValue("5528416390");
		// The hint names Telcel — this number was recharged here before — and the
		// intent still carries no company, because a hint is not a choice.
		expect(view.find('[data-testid="recargas-hint"]').attributes("data-hint-source")).toBe(
			"history",
		);
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				intent: expect.objectContaining({ carrier: null }),
				band: expect.objectContaining({ ready: false }),
			}),
		);
	});

	it("lets the operator take the hint with one press", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-reference"]').setValue("5528416390");
		await view.find('[data-testid="recargas-hint"]').trigger("click");
		expect(
			view.find('[data-testid="recargas-carrier-Telcel"]').attributes("aria-pressed"),
		).toBe("true");
	});
});

describe("the band carries the number, and it is armed only by a real choice", () => {
	it("publishes an armed recharge once company, number and product are all set", async () => {
		const onIntent = vi.fn();
		const view = mountView({ onIntent });
		await view.find('[data-testid="recargas-reference"]').setValue("5528416390");
		await view.find('[data-testid="recargas-reference-confirm"]').setValue("5528416390");
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		await view.find('[data-testid="recargas-amount-TEL200"]').trigger("click");
		expect(onIntent).toHaveBeenLastCalledWith({
			intent: {
				carrier: "Telcel",
				carrierLabel: "Telcel",
				reference: "5528416390",
				amount: 200,
				itemCode: "TEL200",
			},
			band: { kind: "recharge", amount: 200, carrier: "Telcel", msisdn: "5528416390", ready: true },
		});
	});

	it("renders no total of its own — the band owns the one number", () => {
		// `registerSaysItOnce.spec.ts`'s rule, applied here: the artboard's 60px
		// $200.00 and its RECARGAR button live in the band card, which is
		// shell/band's, not this view's.
		expect(mountView().findAll('[data-money-role="total"]')).toHaveLength(0);
	});
});

describe("every money figure declares what it is", () => {
	it("leaves nothing on screen unlabelled", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		await view.find('[data-testid="recargas-amount-TEL200"]').trigger("click");
		expect(countMoney(view.html())).toBe(view.findAll("[data-money-role]").length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		for (const element of view.findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("names the pouch and what is left of it after this top-up", async () => {
		const view = mountView();
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		await view.find('[data-testid="recargas-amount-TEL200"]').trigger("click");
		expect(view.find('[data-money-role="pouch-available"]').text()).toBe(currency(1240));
		expect(view.find('[data-money-role="pouch-after"]').text()).toBe(currency(1040));
	});
});

describe("it renders nothing where a source is missing", () => {
	it("shows no commission anywhere, at any state", async () => {
		// `Recargas.dc.html` draws "Comisión de hoy $321", "comisión 5 %" and
		// "te quedan $10.00". `list_transactions` does not select
		// `Saldo Transaction.comision` and the carrier's `ComisionCliente` is not
		// exposed to the POS at all, so none of the three has a source.
		const view = mountView();
		await view.find('[data-testid="recargas-carrier-Telcel"]').trigger("click");
		await view.find('[data-testid="recargas-amount-TEL200"]').trigger("click");
		expect(view.text()).not.toMatch(/comisi|commission|%/i);
	});

	it("drops the whole pouch card when the manager hid the balance", () => {
		const view = mountView({ bolsaPayload: { visible: false } });
		expect(view.find('[data-testid="recargas-bolsa"]').exists()).toBe(false);
	});

	it("keeps the pouch card but shows no figure when the balance is unknown", () => {
		// A zero would read as an empty pouch and stop a cashier selling against
		// money that is actually there.
		const view = mountView({ bolsaPayload: { visible: true, balance: null, error: "creds" } });
		expect(view.find('[data-testid="recargas-bolsa-amount"]').exists()).toBe(false);
		expect(view.find('[data-testid="recargas-bolsa-unknown"]').exists()).toBe(true);
	});

	it("shows no day count and no day total when the page was capped", () => {
		const view = mountView({ ledgerLimit: 2 });
		expect(view.find('[data-testid="recargas-today-count"]').exists()).toBe(false);
		expect(view.find('[data-testid="recargas-ledger-tally"]').exists()).toBe(false);
		// The rows themselves are still there — the counters are what cannot be
		// trusted from a truncated page, not the evidence.
		expect(view.findAll('[data-testid="recargas-ledger-row"]')).toHaveLength(2);
	});

	it("offers no receipt scan, because there is no receipt-scanning path", () => {
		// The artboard's third quick affordance. A dead button on a money screen
		// is worse than no button.
		expect(mountView().text()).not.toMatch(/scan/i);
	});
});

describe("today's rows are the evidence for the day's claims", () => {
	it("lists today's recharges with a masked number and an outcome", () => {
		const view = mountView();
		const rows = view.findAll('[data-testid="recargas-ledger-row"]');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.text()).toContain("55 •••• 6390");
		expect(rows[0]?.find("[data-outcome]").attributes("data-outcome")).toBe("applied");
		expect(rows[1]?.find("[data-outcome]").attributes("data-outcome")).toBe("refunded");
	});

	it("counts the day and sums only what was delivered", () => {
		const view = mountView();
		expect(view.find('[data-testid="recargas-today-count"]').text()).toContain("2");
		expect(view.find('[data-money-role="day-sold"]').text()).toBe(currency(200));
	});

	it("says the pouch got a refund back, once, and only when it did", () => {
		expect(mountView().find('[data-testid="recargas-ledger-refunded"]').exists()).toBe(true);
		expect(
			mountView({ rows: [ROWS[0]] }).find('[data-testid="recargas-ledger-refunded"]').exists(),
		).toBe(false);
	});

	it("says so plainly on a day with no recharges yet", () => {
		const view = mountView({ rows: [] });
		expect(view.find('[data-testid="recargas-ledger-empty"]').exists()).toBe(true);
	});

	it("refills the form from the last recharge without sending anything", async () => {
		const onIntent = vi.fn();
		const view = mountView({ onIntent });
		await view.find('[data-testid="recargas-repeat-last"]').trigger("click");
		// The unmasked number, because the masked one on screen cannot be typed
		// back into the field.
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				intent: expect.objectContaining({
					reference: "5528416390",
					carrier: "Telcel",
					itemCode: "TEL200",
				}),
			}),
		);
	});

	it("takes the phone off the customer already open on the register", async () => {
		const onIntent = vi.fn();
		const view = mountView({ onIntent, customerPhone: "5533221100" });
		await view.find('[data-testid="recargas-customer-phone"]').trigger("click");
		expect(onIntent).toHaveBeenLastCalledWith(
			expect.objectContaining({ intent: expect.objectContaining({ reference: "5533221100" }) }),
		);
	});

	it("offers neither shortcut when there is nothing behind it", () => {
		const view = mountView({ rows: [], customerPhone: null });
		expect(view.find('[data-testid="recargas-repeat-last"]').exists()).toBe(false);
		expect(view.find('[data-testid="recargas-customer-phone"]').exists()).toBe(false);
	});
});
