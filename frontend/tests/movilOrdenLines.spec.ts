/**
 * The service order's arithmetic and its disclosure, against the artboard's
 * own numbers (`muelle-site/design/register-hifi/MovilOrden.dc.html`).
 *
 * Node env, no mount: everything worth getting wrong on this screen is a sum
 * or a mask, and neither needs a DOM to be wrong in.
 *
 * The fixture is the canvas verbatim — 1,450 + 980 + 80 + 0 = 2,510 order,
 * 220 counter, 600 anticipo, 2,130 saldo — so a drift between the code and
 * the design reference shows up as a failing number rather than as an
 * argument about which document is current.
 */
import { describe, expect, it } from "vitest";

import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import {
	LINE_KINDS,
	deviceIdTail,
	evidenceBlocks,
	maskDeviceId,
	resolveLineKind,
	serviceOrderBandInput,
	serviceOrderEvidence,
	serviceOrderTotals,
	toServiceOrderLines,
	toServiceOrderView,
	type ServiceOrderLineInput,
	type ServiceOrderPayload,
} from "../src/posapp/components/pos/mobile/orders/serviceOrderLines";

/** `#RS-2048`, exactly as the canvas draws it. */
const CANVAS_LINES: ServiceOrderLineInput[] = [
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
	{ item_code: "IPN003614", description: "Mica Cristal instalada", qty: 1, rate: 80, kind: "item" },
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
];

const CANVAS_IMEI = "356938035644821";

const CANVAS_PAYLOAD: ServiceOrderPayload = {
	name: "CR-00042",
	source_label: "RS-2048",
	customer: "CUST-0007",
	customer_name: "Alejandra Ríos Bautista",
	device_label: "Samsung Galaxy A54 5G",
	device_id: CANVAS_IMEI,
	technician: "Téc. Iván M.",
	advance: 600,
	fiscal: true,
	items: CANVAS_LINES,
	evidence: { deviceIdVerified: true, photoCount: 6, invoicedBefore: false, warrantyDays: 90 },
};

describe("every line the workshop wrote down reaches the ticket", () => {
	it("keeps all five, in the order Taller sent them", () => {
		const lines = toServiceOrderLines(CANVAS_LINES);

		expect(lines.map((line) => line.description)).toEqual([
			"Cambio de pantalla — A54",
			"Pantalla OLED Samsung A54",
			"Mica Cristal instalada",
			"Cristal trasero del cliente",
			"Case Magsafe humo S24 Negro",
		]);
	});

	it("keeps the customer's own part on the ticket, priced at nothing", () => {
		// The failure this guards is silent: filter zero amounts "to tidy the
		// list" and the glass the customer supplied vanishes from the document
		// they are handed, which reads as though the shop supplied it.
		const lines = toServiceOrderLines(CANVAS_LINES);
		const own = lines.find((line) => line.kind === "customerPart");

		expect(own, "the customer's own part must be visible").toBeDefined();
		expect(own!.amount).toBe(0);
		expect(own!.chargeable).toBe(false);
		expect(own!.kindLabelKey).toBe("customer's part");
		expect(own!.noteKey).toBe("no charge");
	});

	it("labels each line by kind, and leaves the plain catalogue line unqualified", () => {
		const lines = toServiceOrderLines(CANVAS_LINES);

		expect(lines.map((line) => line.kind)).toEqual([
			"labour",
			"part",
			"item",
			"customerPart",
			"counter",
		]);
		// The artboard draws `IPN003614` alone between two qualified lines. A
		// qualifier on every line stops qualifying anything.
		expect(lines[2].kindLabelKey).toBeNull();
	});

	it("prices from qty × rate — the same arithmetic the invoice will use", () => {
		// `prepare_charge_request_invoice` builds each invoice line from qty and
		// rate, so those two ARE what the customer pays. A supplied `amount`
		// that disagreed would put a number on screen nobody is about to charge.
		const [line] = toServiceOrderLines([{ item_code: "X", qty: 3, rate: 33.33 }]);

		expect(line.amount).toBe(99.99);
	});
});

describe("the money guard on the customer's own part", () => {
	it("never bills the customer's own part, even when the order arrives with a price on it", () => {
		// A mis-keyed order, a template that carried a rate over, a Taller bug:
		// the register must refuse the charge rather than render it. This is
		// the one that catches the mutation — with the canvas fixture the line
		// is worth 0 either way, so an arithmetic-only test would pass while
		// the guard was gone.
		const priced: ServiceOrderLineInput[] = CANVAS_LINES.map((line) =>
			line.kind === "customer_part" ? { ...line, rate: 1200 } : line,
		);
		const lines = toServiceOrderLines(priced);
		const own = lines.find((line) => line.kind === "customerPart")!;

		expect(own.amount, "a customer's part reads zero on screen").toBe(0);
		expect(serviceOrderTotals(lines).orderTotal, "and adds zero to the order").toBe(2510);
	});

	it("routes an unknown kind to the order rather than making it free", () => {
		// The safe direction: the payload carries no `kind` today, and every
		// line already bills to the order server-side. Guessing "customer's
		// part" from a missing field would under-charge the shop.
		expect(resolveLineKind(undefined)).toBe("item");
		expect(resolveLineKind("something Taller invented")).toBe("item");
		expect(LINE_KINDS.item.billsTo).toBe("order");
	});

	it("accepts the spellings Taller is likely to send", () => {
		expect(resolveLineKind("customer_part")).toBe("customerPart");
		expect(resolveLineKind("Pieza_Del_Cliente")).toBe("customerPart");
		expect(resolveLineKind("mano_de_obra")).toBe("labour");
		expect(resolveLineKind("refaccion")).toBe("part");
		expect(resolveLineKind("mostrador")).toBe("counter");
	});

	it("keeps exactly one kind out of every sum", () => {
		const free = Object.entries(LINE_KINDS).filter(([, rule]) => rule.billsTo === "none");

		expect(free.map(([id]) => id)).toEqual(["customerPart"]);
	});
});

describe("the balance is not the order total", () => {
	it("splits the canvas into order, counter and uncharged", () => {
		const totals = serviceOrderTotals(toServiceOrderLines(CANVAS_LINES));

		expect(totals.orderTotal).toBe(2510);
		expect(totals.counterSales).toBe(220);
		expect(totals.uncharged).toBe(1);
		expect(totals.lineCount).toBe(5);
	});

	it("hands resolveBandState the three parts and gets the canvas saldo back", () => {
		const state = resolveBandState(
			serviceOrderBandInput(toServiceOrderLines(CANVAS_LINES), {
				advance: 600,
				orderId: "RS-2048",
			}),
		);

		// 2,510 − 600 + 220 = 2,130. The subtraction is the point: the anticipo
		// was taken on a different day, against the quote, and the counter sale
		// was not part of that quote.
		expect(state.value).toBe(2130);
		expect(state.kind).toBe("balanceDue");
		expect(state.primaryAction.id).toBe("order.collectAndDeliver");
		expect(state.primaryAction.labelKey).toBe("COLLECT AND DELIVER");
	});

	it("moves the balance when the advance moves, not the order total", () => {
		const lines = toServiceOrderLines(CANVAS_LINES);
		const paidMore = resolveBandState(serviceOrderBandInput(lines, { advance: 1000 }));

		expect(paidMore.value).toBe(1730);
		expect(serviceOrderTotals(lines).orderTotal).toBe(2510);
	});

	it("lets the caller refuse the charge outright", () => {
		const state = resolveBandState(
			serviceOrderBandInput(toServiceOrderLines(CANVAS_LINES), {
				advance: 600,
				payable: false,
			}),
		);

		expect(state.primaryEnabled).toBe(false);
		expect(state.value, "refusing to charge does not change what is owed").toBe(2130);
	});
});

describe("the device id leaves as a mask", () => {
	it("masks the canvas IMEI exactly as the artboard draws it", () => {
		expect(maskDeviceId(CANVAS_IMEI)).toBe("35•••••••••4821");
	});

	it("keeps the middle out of the result entirely", () => {
		const masked = maskDeviceId(CANVAS_IMEI);

		expect(masked).not.toContain("6938035");
		expect(masked.replace(/•/g, "")).toBe("354821");
	});

	it("normalises the spacing a scanner or a technician adds", () => {
		expect(maskDeviceId("35-6938 035644821")).toBe("35•••••••••4821");
	});

	it("masks a short id completely rather than mostly revealing it", () => {
		// Head plus tail on a six-character serial leaves nothing hidden, so
		// the rule inverts rather than degrading.
		expect(maskDeviceId("A1B2C3")).toBe("••••••");
		expect(deviceIdTail("A1B2C3")).toBe("");
	});

	it("returns nothing for nothing, so the row hides instead of showing bullets", () => {
		expect(maskDeviceId("")).toBe("");
		expect(maskDeviceId(null)).toBe("");
		expect(maskDeviceId(undefined)).toBe("");
	});

	it("gives a screen reader the last four instead of a run of bullets", () => {
		expect(deviceIdTail(CANVAS_IMEI)).toBe("4821");
	});

	it("has no field on the view model that could carry the raw id back", () => {
		const view = toServiceOrderView(CANVAS_PAYLOAD)!;

		expect(Object.values(view).some((value) => value === CANVAS_IMEI)).toBe(false);
		expect(JSON.stringify(view)).not.toContain(CANVAS_IMEI);
		expect(view.deviceIdMasked).toBe("35•••••••••4821");
	});
});

describe("evidence states what was checked, and what was not", () => {
	it("reads the canvas chips as verified", () => {
		const chips = serviceOrderEvidence(CANVAS_PAYLOAD.evidence!);

		expect(chips.map((chip) => `${chip.id}:${chip.state}`)).toEqual([
			"deviceId:ok",
			"photos:ok",
			"invoiced:ok",
			"warranty:ok",
		]);
		expect(evidenceBlocks(chips)).toBe(false);
	});

	it("never ticks a check nobody ran", () => {
		// `unknown` is not a synonym for fine. A green tick for a verification
		// that did not happen tells the cashier something false about the phone
		// in their hand.
		const chips = serviceOrderEvidence({});

		expect(chips.every((chip) => chip.state === "unknown")).toBe(true);
		expect(chips.some((chip) => chip.state === "ok")).toBe(false);
	});

	it("separates 'no photos' from 'photos not recorded'", () => {
		expect(serviceOrderEvidence({ photoCount: 0 }).find((c) => c.id === "photos")?.state).toBe(
			"attention",
		);
		expect(
			serviceOrderEvidence({ photoCount: null }).find((c) => c.id === "photos")?.state,
		).toBe("unknown");
	});

	it("blocks on an order that was already invoiced (§4.6)", () => {
		const chips = serviceOrderEvidence({ invoicedBefore: true });

		expect(chips.find((chip) => chip.id === "invoiced")?.blocking).toBe(true);
		expect(evidenceBlocks(chips)).toBe(true);
	});

	it("does not block merely because nothing was checked", () => {
		// The server's own guard (`prepare_charge_request_invoice` money guard
		// 1) still stands behind this. Refusing every unchecked order would
		// stop the counter dead on a payload that has no evidence block at all,
		// which is every payload today.
		expect(evidenceBlocks(serviceOrderEvidence({}))).toBe(false);
	});
});

describe("the view model degrades honestly on today's payload", () => {
	it("builds from what load_charge_request actually returns", () => {
		// name, customer, source_label, amount_total and items — nothing else.
		const view = toServiceOrderView({
			name: "CR-00042",
			source_label: "RS-2048",
			customer: "CUST-0007",
			items: CANVAS_LINES.map(({ kind: _kind, ...rest }) => rest),
		})!;

		expect(view.orderId).toBe("RS-2048");
		expect(view.customerName).toBe("CUST-0007");
		expect(view.deviceIdMasked, "no device id means no row, not a fake one").toBe("");
		expect(view.advance, "an absent anticipo is zero, never a guess").toBe(0);
		// Every line falls back to `item`, which is exactly what the server
		// does with them today: all five bill to the order.
		expect(view.totals.orderTotal).toBe(2730);
		expect(view.totals.counterSales).toBe(0);
		expect(view.evidence.every((chip) => chip.state === "unknown")).toBe(true);
	});

	it("falls back to the request name when Taller sent no folio", () => {
		expect(toServiceOrderView({ name: "CR-00042" })!.orderId).toBe("CR-00042");
	});

	it("returns null rather than an empty shell when there is no order", () => {
		expect(toServiceOrderView(null)).toBeNull();
	});
});
