// @vitest-environment jsdom

/**
 * Órdenes de servicio on the phone (artboard `MovilOrden.dc.html`).
 *
 * Four things this screen must not do, each of which is a way of charging the
 * customer for something they should not pay for or of handing out something
 * they should keep:
 *
 *   1. drop the zero-priced line that IS their own part;
 *   2. print a full IMEI, or leave one recoverable in an attribute;
 *   3. show the order total where the balance belongs;
 *   4. look usable while the server it reads from is unreachable.
 *
 * The money-figure count is the same idea as `registerSaysItOnce.spec.ts`:
 * a line list plus a three-part balance is nine figures on one card, and each
 * one has to declare what it is or the ninth becomes a second total.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import MovilOrdenView from "../src/posapp/components/pos/mobile/orders/MovilOrdenView.vue";
import {
	toServiceOrderView,
	type ServiceOrderPayload,
} from "../src/posapp/components/pos/mobile/orders/serviceOrderLines";

const CANVAS_IMEI = "356938035644821";

const CANVAS: ServiceOrderPayload = {
	name: "CR-00042",
	source_label: "RS-2048",
	customer: "CUST-0007",
	customer_name: "Alejandra Ríos Bautista",
	device_label: "Samsung Galaxy A54 5G",
	device_id: CANVAS_IMEI,
	technician: "Téc. Iván M.",
	advance: 600,
	fiscal: true,
	evidence: { deviceIdVerified: true, photoCount: 6, invoicedBefore: false, warrantyDays: 90 },
	items: [
		{
			item_code: "SERV-PANT",
			description: "Cambio de pantalla — A54",
			qty: 1,
			rate: 1450,
			kind: "labour",
		},
		{
			item_code: "IPN002218",
			description: "Pantalla OLED Samsung A54",
			qty: 1,
			rate: 980,
			kind: "part",
		},
		{
			item_code: "IPN003614",
			description: "Mica Cristal instalada",
			qty: 1,
			rate: 80,
			kind: "item",
		},
		{
			item_code: "",
			description: "Cristal trasero del cliente",
			qty: 1,
			rate: 0,
			kind: "customer_part",
		},
		{
			item_code: "ACC-MAGSAFE-S24",
			description: "Case Magsafe humo S24 Negro",
			qty: 1,
			rate: 220,
			kind: "counter",
		},
	],
};

/**
 * A marker no formatter would produce, so counting it counts MONEY FIGURES
 * rather than incidental digits — the reason `registerSaysItOnce.spec.ts`
 * uses the same trick.
 */
const MONEY = "¤";
const money = (value: number) => `${MONEY}${value.toFixed(2)}`;

const mountOrden = (props: Record<string, unknown> = {}) =>
	mount(MovilOrdenView, {
		props: {
			view: toServiceOrderView(CANVAS),
			title: "Órdenes de servicio",
			who: "Caja 2 · Jenni",
			readyCount: 4,
			online: true,
			formatCurrency: money,
			formatLineAmount: money,
			...props,
		},
		global: { plugins: [createVuetify()] },
	});

const countMoney = (html: string) => (html.match(new RegExp(MONEY, "g")) || []).length;

beforeEach(() => {
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args?.length
			? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m))
			: text,
	);
});

describe("the lines, each labelled by what it is", () => {
	it("renders all five of the canvas's lines", () => {
		const wrapper = mountOrden();

		expect(wrapper.findAll("[data-line-kind]")).toHaveLength(5);
	});

	it("says which kind each line is, in the DOM as well as on screen", () => {
		const wrapper = mountOrden();

		expect(wrapper.findAll("[data-line-kind]").map((row) => row.attributes("data-line-kind"))).toEqual([
			"labour",
			"part",
			"item",
			"customerPart",
			"counter",
		]);
	});

	it("prints the kind next to the item code, as the artboard draws it", () => {
		const wrapper = mountOrden();
		const rows = wrapper.findAll("[data-line-kind]");

		expect(rows[0].text()).toContain("SERV-PANT");
		expect(rows[0].text()).toContain("labour");
		expect(rows[1].text()).toContain("part");
		// The plain catalogue line carries its code and no qualifier.
		expect(rows[2].text()).toContain("IPN003614");
		expect(rows[2].text()).not.toContain("part");
	});
});

describe("the customer's own part", () => {
	it("is on screen, named, and worth nothing", () => {
		const wrapper = mountOrden();
		const own = wrapper.get('[data-line-kind="customerPart"]');

		expect(own.text()).toContain("Cristal trasero del cliente");
		expect(own.text()).toContain("customer's part");
		expect(own.text()).toContain("no charge");
		expect(own.get("[data-money-role='line']").text()).toBe(money(0));
	});

	it("declares itself unchargeable so nothing downstream has to infer it", () => {
		const own = mountOrden().get('[data-line-kind="customerPart"]');

		expect(own.attributes("data-line-chargeable")).toBe("false");
		expect(own.attributes("data-line-bills-to")).toBe("none");
	});

	it("stays out of the order total even when the order priced it", () => {
		const priced = {
			...CANVAS,
			items: CANVAS.items!.map((line) =>
				line.kind === "customer_part" ? { ...line, rate: 1200 } : line,
			),
		};
		const wrapper = mountOrden({ view: toServiceOrderView(priced) });
		const own = wrapper.get('[data-line-kind="customerPart"]');

		// Both halves, because they fail separately: `billsTo` keeps the line
		// out of the sum, and `lineAmount` keeps the price off the screen.
		// Drop the second and the ticket reads "$1,200" beside a line the
		// customer is not being charged for, while every total stays right.
		expect(own.get("[data-money-role='line']").text()).toBe(money(0));
		expect(wrapper.get('[data-testid="orden-part-order"]').text()).toBe(money(2510));
		expect(wrapper.get('[data-testid="orden-balance-value"]').text()).toBe(money(2130));
	});
});

describe("the balance arithmetic", () => {
	it("shows order, advance and counter as the three parts they are", () => {
		const wrapper = mountOrden();

		expect(wrapper.get('[data-testid="orden-part-order"]').text()).toBe(money(2510));
		expect(wrapper.get('[data-testid="orden-part-advance"]').text()).toBe(money(600));
		expect(wrapper.get('[data-testid="orden-part-counter"]').text()).toBe(money(220));
	});

	it("shows the balance the band resolved, not the order total", () => {
		const wrapper = mountOrden();
		const saldo = wrapper.get('[data-testid="orden-balance-value"]');

		expect(saldo.text()).toBe(money(2130));
		expect(saldo.attributes("data-band-kind")).toBe("balanceDue");
	});

	it("carries exactly one total, whatever else is on the card", () => {
		const wrapper = mountOrden();

		expect(
			wrapper.findAll('[data-money-role="total"]'),
			"a line list and a three-part balance is nine figures; only one is the total",
		).toHaveLength(1);
	});

	it("leaves no money figure without a declared role", () => {
		const wrapper = mountOrden();
		const figures = countMoney(wrapper.html());

		// Pinned, not just compared: `0 === 0` is how a counting test stops
		// counting anything. Five lines plus three parts plus the balance.
		expect(figures, "five lines, three parts and the balance").toBe(9);
		expect(figures).toBe(wrapper.findAll("[data-money-role]").length);
	});

	it("declares one role per figure, so a role cannot cover two numbers", () => {
		for (const element of mountOrden().findAll("[data-money-role]")) {
			expect(countMoney(element.html())).toBe(1);
		}
	});

	it("names the primary with the band's own label", () => {
		// The phone and the desktop must not call the same act two things.
		const primary = mountOrden().get('[data-testid="orden-primary"]');

		expect(primary.text()).toContain("COLLECT AND DELIVER");
		expect(primary.attributes("data-band-action")).toBe("order.collectAndDeliver");
	});

	it("emits the band's action id when pressed", () => {
		// Listener prop, not `wrapper.emitted()` — VTU records only the native
		// event that bubbles to the root here (build plan §10).
		const onPrimary = vi.fn();
		mountOrden({ onPrimary }).get('[data-testid="orden-primary"]').trigger("click");

		expect(onPrimary).toHaveBeenCalledWith("order.collectAndDeliver");
	});
});

describe("the IMEI is shown, not disclosed", () => {
	it("draws the mask the artboard draws", () => {
		expect(mountOrden().get('[data-testid="orden-device-id"]').text()).toBe(
			"IMEI 35•••••••••4821",
		);
	});

	it("has no copy of the full id anywhere in the rendered DOM", () => {
		const html = mountOrden().html();

		expect(html).not.toContain(CANVAS_IMEI);
		expect(html, "nor the hidden middle on its own").not.toContain("6938035");
	});

	it("cannot be undone from an attribute — no title, no data-*, no aria label", () => {
		// Masking in the template would be a convention someone later works
		// around with a tooltip. `ServiceOrderView` has no raw field at all,
		// and this is the assertion that keeps it that way.
		const wrapper = mountOrden();
		const leaks: string[] = [];
		for (const element of wrapper.element.querySelectorAll("*")) {
			for (const attribute of Array.from(element.attributes)) {
				if (attribute.value.includes("6938035")) {
					leaks.push(`${element.tagName}[${attribute.name}]`);
				}
			}
		}

		expect(leaks, leaks.join(", ")).toEqual([]);
		// Not vacuous: the masked form IS in the DOM, so the scan ran over a
		// screen that actually carries the device id.
		expect(wrapper.get('[data-testid="orden-device-id"]').text()).toContain("4821");
	});

	it("reads the last four to a screen reader instead of a run of bullets", () => {
		expect(mountOrden().get('[data-testid="orden-device-id"]').attributes("aria-label")).toBe(
			"IMEI ending 4821",
		);
	});

	it("hides the row entirely when the workshop recorded no id", () => {
		const wrapper = mountOrden({
			view: toServiceOrderView({ ...CANVAS, device_id: null }),
		});

		expect(wrapper.find('[data-testid="orden-device-id"]').exists()).toBe(false);
	});
});

describe("the screen states its offline requirement", () => {
	it("says so, rather than looking usable", () => {
		const wrapper = mountOrden({ online: false });
		const notice = wrapper.get('[data-testid="orden-offline-notice"]');

		expect(notice.text()).toContain("Service orders need a connection");
		expect(wrapper.get('[data-testid="movil-orden"]').attributes("data-connection")).toBe(
			"offline",
		);
	});

	it("takes its answer from railDestinations rather than restating it", () => {
		// `serviceOrder` is `blocked` there because the POS PULLS a Charge
		// Request off the server. A wave-3 correction to that module must
		// reach this screen without an edit here.
		expect(
			mountOrden({ online: false })
				.get('[data-testid="orden-offline-notice"]')
				.attributes("data-offline-availability"),
		).toBe("blocked");
	});

	it("refuses the charge and says why", () => {
		const wrapper = mountOrden({ online: false });

		expect(
			(wrapper.get('[data-testid="orden-primary"]').element as HTMLButtonElement).disabled,
		).toBe(true);
		expect(wrapper.get('[data-testid="orden-blocked-reason"]').text()).toContain(
			"needs a connection",
		);
	});

	it("stops the finder too, since there is nothing to search", () => {
		const wrapper = mountOrden({ online: false });

		expect(
			(wrapper.get('[data-testid="orden-finder"]').element as HTMLInputElement).disabled,
		).toBe(true);
	});

	it("keeps the order that was already pulled on screen", () => {
		// It was fetched while the signal was up and it is still true. Blanking
		// it would lose the cashier's place for no gain.
		const wrapper = mountOrden({ online: false });

		expect(wrapper.get('[data-testid="orden-balance-value"]').text()).toBe(money(2130));
	});

	it("shows none of that, and charges, while the signal is up", () => {
		const wrapper = mountOrden({ online: true });

		expect(wrapper.find('[data-testid="orden-offline-notice"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="orden-blocked-reason"]').exists()).toBe(false);
		expect(
			(wrapper.get('[data-testid="orden-primary"]').element as HTMLButtonElement).disabled,
		).toBe(false);
		expect(wrapper.get('[data-testid="orden-connection"]').text()).toBe("Online");
	});
});

describe("the guards a repair counter needs (§4.6)", () => {
	it("refuses an order that was already invoiced, and says so", () => {
		const wrapper = mountOrden({
			view: toServiceOrderView({
				...CANVAS,
				evidence: { ...CANVAS.evidence, invoicedBefore: true },
			}),
		});

		expect(
			(wrapper.get('[data-testid="orden-primary"]').element as HTMLButtonElement).disabled,
		).toBe(true);
		expect(wrapper.get('[data-testid="orden-blocked-reason"]').text()).toContain(
			"already invoiced",
		);
		expect(wrapper.get('[data-testid="orden-evidence-invoiced"]').attributes("data-evidence-state")).toBe(
			"attention",
		);
	});

	it("marks an unchecked IMEI as unknown rather than ticking it", () => {
		const wrapper = mountOrden({
			view: toServiceOrderView({ ...CANVAS, evidence: {} }),
		});

		expect(
			wrapper.get('[data-testid="orden-evidence-deviceId"]').attributes("data-evidence-state"),
		).toBe("unknown");
		expect(wrapper.get('[data-testid="orden-evidence"]').text()).toContain(
			"IMEI check not recorded",
		);
	});

	it("shows the canvas's evidence as verified when the workshop recorded it", () => {
		const evidence = mountOrden().get('[data-testid="orden-evidence"]');

		expect(evidence.text()).toContain("IMEI verified");
		expect(evidence.text()).toContain("6 photos");
		expect(evidence.text()).toContain("Not invoiced before");
		expect(evidence.text()).toContain("90 d warranty");
	});
});

describe("the header and the finder", () => {
	it("carries the register, the operator and how many are waiting", () => {
		const wrapper = mountOrden();

		expect(wrapper.get('[data-testid="orden-title"]').text()).toBe("Órdenes de servicio");
		expect(wrapper.get('[data-testid="orden-who"]').text()).toBe("Caja 2 · Jenni");
		expect(wrapper.get('[data-testid="orden-ready-count"]').text()).toBe("4 ready");
	});

	it("names the order, its status and whether it is fiscal", () => {
		const wrapper = mountOrden();

		expect(wrapper.get('[data-testid="orden-folio"]').text()).toBe("#RS-2048");
		expect(wrapper.get('[data-testid="orden-status"]').text()).toBe("Ready for pickup");
		expect(wrapper.get('[data-testid="orden-fiscal"]').text()).toBe("CFDI");
		expect(wrapper.get('[data-testid="orden-customer"]').text()).toBe("Alejandra Ríos Bautista");
	});

	it("hides the ready count rather than showing a zero", () => {
		expect(mountOrden({ readyCount: 0 }).find('[data-testid="orden-ready-count"]').exists()).toBe(
			false,
		);
	});

	it("hands the typed term back to the shell, which owns the search", () => {
		const onUpdateSearchTerm = vi.fn();
		const wrapper = mountOrden({ "onUpdate:searchTerm": onUpdateSearchTerm });
		const finder = wrapper.get('[data-testid="orden-finder"]');
		(finder.element as HTMLInputElement).value = "RS-2048";
		finder.trigger("input");

		expect(onUpdateSearchTerm).toHaveBeenCalledWith("RS-2048");
	});

	it("asks for a search on Enter", () => {
		const onSearch = vi.fn();
		mountOrden({ onSearch }).get('[data-testid="orden-finder"]').trigger("keyup.enter");

		expect(onSearch).toHaveBeenCalled();
	});

	it("teaches the empty state instead of showing an empty card", () => {
		const wrapper = mountOrden({ view: null });

		expect(wrapper.get('[data-testid="orden-empty"]').text()).toContain("Find an order");
		expect(wrapper.find('[data-testid="orden-balance"]').exists()).toBe(false);
	});
});
