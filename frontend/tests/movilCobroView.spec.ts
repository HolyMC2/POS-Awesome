// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import MovilCobroView from "../src/posapp/components/pos/mobile/pay/MovilCobroView.vue";
import { armTender, resetTenderSelection } from "../src/posapp/components/pos/invoice/armedTender";
import { resolveTenderChips } from "../src/posapp/components/pos/invoice/tenderChips";

/**
 * The phone's payment screen, mounted — `MovilCobro.dc.html` (§12 G).
 *
 * What this file guards, in the order the screen fails if it stops:
 *
 *   1. every money figure DECLARES what it is (`data-money-role`), and the
 *      screen carries exactly one total. Six figures is a lot for 390 px, and
 *      `registerSaysItOnce.spec.ts` exists because an undeclared seventh is
 *      precisely how three totals once reached a live register;
 *   2. shortfall and change never appear twice or together;
 *   3. the tender armed on the sale screen pre-selects, and a STALE one does
 *      not get resurrected onto a method the register can no longer honour;
 *   4. hardware readiness claims nothing it cannot prove;
 *   5. one saturated accent, on `COBRAR Y CERRAR`.
 *
 * `wrapper.emitted()` does not record component emits in this repo (build plan
 * §10), so intents are asserted through listener props.
 */

/** A marker no formatter would produce, so counting it counts MONEY. */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${value.toFixed(2)}`;
const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

const PROFILE = {
	payments: [
		{ mode_of_payment: "Efectivo", default: 1 },
		{ mode_of_payment: "Tarjeta", default: 0 },
		{ mode_of_payment: "Transferencia", default: 0 },
	],
};

const mountView = (props: Record<string, unknown> = {}) =>
	mount(MovilCobroView, {
		props: {
			title: "Cobro · B-04812",
			customerName: "Alejandra Ríos Bautista",
			total: 1129,
			currency: "MXN",
			formatCurrency: money,
			profile: PROFILE,
			itemCount: 9,
			...props,
		},
	});

/** Tap a sequence of pad keys on a mounted screen. */
const tap = async (wrapper: ReturnType<typeof mountView>, keys: string) => {
	for (const key of keys.split(" ").filter(Boolean)) {
		await wrapper.find(`[data-testid="movil-key-${key}"]`).trigger("click");
	}
};

beforeEach(() => {
	// The armed tender lives in a module singleton shared with the sale
	// screen; a pick leaking between tests would read as a passing pre-select.
	resetTenderSelection();
	vi.stubGlobal("__", (value: string) => value);
});

describe("every money figure declares what it is", () => {
	it("leaves no unlabelled figure on the screen", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		expect(
			countMoney(wrapper.html()),
			"a money figure with no data-money-role is exactly how the third total got on screen",
		).toBe(wrapper.findAll("[data-money-role]").length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		for (const element of wrapper.findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("claims exactly one total", () => {
		// No `ActionBand` mounts on this screen, so the change card is the lane
		// and the total is stated here — once.
		expect(mountView().findAll('[data-money-role="total"]')).toHaveLength(1);
	});

	it("renders the roles the artboard draws and no others", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		const roles = wrapper
			.findAll("[data-money-role]")
			.map((element) => element.attributes("data-money-role"));

		expect(roles.filter((role) => role === "total")).toHaveLength(1);
		expect(roles.filter((role) => role === "received")).toHaveLength(1);
		expect(roles.filter((role) => role === "change")).toHaveLength(1);
		expect(roles.filter((role) => role === "shortfall")).toHaveLength(1);
		expect(roles.filter((role) => role === "keyed")).toHaveLength(1);
		expect(roles.filter((role) => role === "change-note")).toHaveLength(3);
	});
});

describe("the change to hand back", () => {
	it("breaks $71.00 into 1 × $50 · 1 × $20 · 1 × $1", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		expect(wrapper.find('[data-testid="movil-change-amount"]').text()).toBe(money(71));

		const notes = wrapper.findAll('[data-testid="movil-change-note"]');
		expect(notes.map((note) => note.attributes("data-face-minor"))).toEqual([
			"5000",
			"2000",
			"100",
		]);
		expect(notes.map((note) => note.text().replace(/\s+/g, " "))).toEqual([
			`1 × ${money(50)}`,
			`1 × ${money(20)}`,
			`1 × ${money(1)}`,
		]);
	});

	it("draws no note strip while nothing is owed back", () => {
		const wrapper = mountView();
		expect(wrapper.find('[data-testid="movil-change-notes"]').exists()).toBe(false);
	});

	it("says so when the drawer has no coin for the remainder", async () => {
		const wrapper = mountView({ total: 8.7 });
		await tap(wrapper, "1 0");

		// $1.30 of change: one peso, and thirty centavos the MXN count list has
		// no coin for. Stated, not rounded into a note that does not exist.
		expect(wrapper.find('[data-testid="movil-change-unbreakable"]').text()).toContain(money(0.3));
		expect(wrapper.findAll('[data-testid="movil-change-note"]')).toHaveLength(1);
	});
});

describe("shortfall and change are mutually exclusive, and stated once each", () => {
	it("leads with the shortfall while the sale is short", () => {
		const wrapper = mountView();
		const headline = wrapper.find('[data-testid="movil-change-amount"]');

		expect(wrapper.find('[data-testid="movil-change-card"]').attributes("data-tone")).toBe(
			"warning",
		);
		expect(headline.attributes("data-money-role")).toBe("shortfall");
		expect(headline.text()).toBe(money(1129));
		// …and the counterpart slot then carries the change, which is nothing.
		const counterpart = wrapper.find('[data-testid="movil-pay-counterpart"]');
		expect(counterpart.attributes("data-money-role")).toBe("change");
		expect(counterpart.text()).toBe(money(0));
	});

	it("leads with the change once the customer has over-paid", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		expect(wrapper.find('[data-testid="movil-change-card"]').attributes("data-tone")).toBe(
			"positive",
		);
		expect(wrapper.find('[data-testid="movil-change-amount"]').attributes("data-money-role")).toBe(
			"change",
		);
		expect(wrapper.find('[data-testid="movil-pay-counterpart"]').attributes("data-money-role")).toBe(
			"shortfall",
		);
	});

	it("never renders the same figure in both places", async () => {
		const wrapper = mountView();
		for (const keys of ["", "5 00", "1 1 2 9", "1 2 00"]) {
			await tap(wrapper, keys);
			const roles = wrapper
				.findAll("[data-money-role]")
				.map((element) => element.attributes("data-money-role"));
			expect(roles.filter((role) => role === "shortfall")).toHaveLength(1);
			expect(roles.filter((role) => role === "change")).toHaveLength(1);
		}
	});
});

describe("the keypad", () => {
	it("renders all fourteen targets", () => {
		expect(mountView().findAll(".pay-keypad__key")).toHaveLength(14);
	});

	it("composes $1,200.00 from 1 · 2 · 00", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00");

		expect(wrapper.find('[data-testid="movil-keyed-amount"]').text()).toBe(money(1200));
		expect(wrapper.find('[data-testid="movil-pay-received"]').text()).toBe(money(1200));
	});

	it("deletes the last digit rather than the whole amount", async () => {
		const wrapper = mountView();
		await tap(wrapper, "1 2 00 backspace");

		expect(wrapper.find('[data-testid="movil-keyed-amount"]').text()).toBe(money(120));
	});
});

describe("`Dividir pago`", () => {
	it("stays disabled until a part-payment is actually possible", async () => {
		const wrapper = mountView();
		const key = () => wrapper.find('[data-testid="movil-key-split"]');

		expect(key().attributes("disabled")).toBeDefined();
		await tap(wrapper, "5 00");
		expect(key().attributes("disabled")).toBeUndefined();
		// Keying the whole sale is not a split; it is the sale.
		await tap(wrapper, "backspace backspace backspace 1 1 2 9");
		expect(key().attributes("disabled")).toBeDefined();
	});

	it("hands the amount and the armed tender to the host, and clears the pad", async () => {
		const onSplit = vi.fn();
		const wrapper = mountView({ onSplit });
		await tap(wrapper, "5 00 split");

		// It divides nothing itself — it closes this tender at the keyed amount
		// and re-opens the pad for the next one. The payment row is the host's.
		expect(onSplit).toHaveBeenCalledTimes(1);
		expect(onSplit).toHaveBeenCalledWith({ mode: "Efectivo", amount: 500, amountMinor: 50_000 });
		expect(wrapper.find('[data-testid="movil-keyed-amount"]').text()).toBe(money(0));
	});

	it("is not offered on a register with a single tender", async () => {
		const wrapper = mountView({ profile: { payments: [{ mode_of_payment: "Efectivo", default: 1 }] } });
		await tap(wrapper, "5 00");

		expect(wrapper.find('[data-testid="movil-key-split"]').attributes("disabled")).toBeDefined();
	});
});

describe("the tender armed on the sale screen", () => {
	it("pre-selects the register's default when the strip was never touched", () => {
		const wrapper = mountView();
		expect(wrapper.find('[data-testid="movil-tender-Efectivo"]').attributes("data-armed")).toBe(
			"true",
		);
		expect(wrapper.findAll('[data-armed="true"]')).toHaveLength(1);
	});

	it("pre-selects what the cashier actually picked", () => {
		armTender("Tarjeta", resolveTenderChips(PROFILE), { cartHasItems: true, isReturn: false });

		const wrapper = mountView();
		expect(wrapper.find('[data-testid="movil-tender-Tarjeta"]').attributes("data-armed")).toBe(
			"true",
		);
		expect(wrapper.findAll('[data-armed="true"]')).toHaveLength(1);
	});

	it("does not resurrect a stale pick, and does not substitute the default", () => {
		// Armed against a profile that carried `Monedero`; this register's does
		// not. Silently arming Efectivo instead is the one failure a cashier
		// would not notice, so nothing lights up and they are asked again.
		const stale = { payments: [{ mode_of_payment: "Monedero", default: 1 }] };
		armTender("Monedero", resolveTenderChips(stale), { cartHasItems: true, isReturn: false });

		const wrapper = mountView();
		expect(wrapper.findAll('[data-armed="true"]')).toHaveLength(0);
		expect(wrapper.find('[data-testid="movil-key-split"]').attributes("disabled")).toBeDefined();
	});

	it("arms nothing on a return, which is not a `cobrar con`", () => {
		expect(mountView({ isReturn: true }).findAll('[data-armed="true"]')).toHaveLength(0);
	});

	it("deselects back to mixed when the lit chip is tapped again", async () => {
		const onUpdateTender = vi.fn();
		const wrapper = mountView({ "onUpdate:tender": onUpdateTender });
		await wrapper.find('[data-testid="movil-tender-Efectivo"]').trigger("click");

		expect(onUpdateTender).toHaveBeenCalledWith(null);
		expect(wrapper.findAll('[data-armed="true"]')).toHaveLength(0);
	});

	it("renders the register's own tenders, not a hardcoded four", () => {
		const wrapper = mountView({ profile: { payments: [{ mode_of_payment: "Efectivo", default: 1 }] } });
		expect(wrapper.findAll(".movil-cobro__tender")).toHaveLength(1);
	});
});

describe("hardware readiness claims nothing it cannot prove", () => {
	it("renders no chip at all when the register knows nothing", () => {
		expect(mountView().findAll(".movil-cobro__chip")).toHaveLength(0);
		expect(mountView({ hardware: {} }).findAll(".movil-cobro__chip")).toHaveLength(0);
	});

	it("stays silent while the print health check has not answered", () => {
		const wrapper = mountView({
			hardware: { usesSilentPrint: true, printerStatus: "unknown" },
		});
		expect(wrapper.find('[data-testid="movil-readiness-printer"]').exists()).toBe(false);
	});

	it("claims the printer ready only on a real ok", () => {
		const wrapper = mountView({ hardware: { usesSilentPrint: true, printerStatus: "ok" } });
		expect(wrapper.find('[data-testid="movil-readiness-printer"]').attributes("data-state")).toBe(
			"ready",
		);
	});

	it("says a terminal is ready by name once a probe has answered", () => {
		const wrapper = mountView({
			hardware: { terminalsAvailable: 1, terminalName: "BBVA" },
		});
		expect(wrapper.find('[data-testid="movil-readiness-terminal"]').text()).toContain("BBVA");
	});

	it("shows nothing for the drawer, which nothing in this app can measure", () => {
		const wrapper = mountView({ hardware: { drawerConnected: null } });
		expect(wrapper.find('[data-testid="movil-readiness-drawer"]').exists()).toBe(false);
	});
});

describe("closing the sale", () => {
	it("refuses by default, because enabling it is the payment path's call", () => {
		const wrapper = mountView();
		expect(wrapper.find('[data-testid="movil-collect"]').attributes("disabled")).toBeDefined();
	});

	it("hands the host the amount and the tender, and settles nothing itself", async () => {
		const onCollect = vi.fn();
		const wrapper = mountView({ canCollect: true, onCollect });
		await tap(wrapper, "1 2 00");
		await wrapper.find('[data-testid="movil-collect"]').trigger("click");

		expect(onCollect).toHaveBeenCalledWith({
			mode: "Efectivo",
			amount: 1200,
			amountMinor: 120_000,
		});
	});

	it("states only the promises the register was told it will keep", () => {
		expect(mountView().findAll(".movil-cobro__promise")).toHaveLength(1); // the piece count
		const wrapper = mountView({ printsTicket: true, stampsCfdi: true, sendsWhatsapp: true });
		expect(wrapper.find('[data-testid="movil-promise-print"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="movil-promise-cfdi"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="movil-promise-whatsapp"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="movil-promise-pieces"]').text()).toBe("9 pcs");
	});
});

describe("the screen stops where the shell begins", () => {
	it("renders no dock of its own", () => {
		// The mobile shell owns the dock; this screen stops short of it exactly
		// as `MobileOfflineOverlay` does.
		const html = mountView().html();
		expect(html).not.toContain("dock");
	});

	it("renders the folio and the customer only when the host supplies them", () => {
		const wrapper = mountView({ title: "", customerName: "" });
		expect(wrapper.find('[data-testid="movil-cobro-title"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="movil-cobro-customer"]').exists()).toBe(false);
	});
});
