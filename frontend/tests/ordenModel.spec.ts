import { describe, expect, it } from "vitest";

import {
	describeAdvance,
	describeBalance,
	describeBuckets,
	describeCardState,
	describeDeviceIds,
	describeLine,
	matchesQuery,
	ordenBandInput,
	ORDEN_BUCKETS,
} from "../src/posapp/components/pos/flows/orden/ordenModel";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";
import type {
	ServiceOrderCard,
	ServiceOrderLine,
} from "../src/posapp/services/serviceOrderService";

/**
 * The Orden surface, as rules (artboard `Orden.dc.html`).
 *
 * No jsdom and no mount: every assertion here is about a decision the surface
 * makes, and a decision that can only be observed by rendering is a decision
 * nobody can check when it changes. The three that matter most are all about
 * REFUSING something — charging an order twice, showing a raw IMEI, and
 * claiming a workshop exists on a tenant that has none.
 */

const card = (overrides: Partial<ServiceOrderCard> = {}): ServiceOrderCard => ({
	name: "PCR-2026-00031",
	folio: "RO-00048",
	customer: "CUST-0001",
	customer_name: "Alejandra Ríos Bautista",
	serials: [],
	title: "Samsung A54 · pantalla rota",
	amount_total: 1910,
	advance: 600,
	invoiced: false,
	warranty: false,
	no_charge: false,
	...overrides,
});

const line = (overrides: Partial<ServiceOrderLine> = {}): ServiceOrderLine => ({
	item_code: "IPN002218",
	item_name: "Pantalla OLED Samsung A54",
	qty: 1,
	rate: 980,
	amount: 980,
	kind: "part",
	provenance: "stock",
	billable: true,
	...overrides,
});

describe("the chips over the queue", () => {
	it("drops «En trabajo» entirely on a tenant with no repair app", () => {
		// Absent, not zero. "En trabajo 0" reads as an idle bench; the honest
		// statement is that this register has no workshop to report on.
		const chips = describeBuckets({ ready: 4, working: null, delivered: 2 }, "ready");
		expect(chips.map((chip) => chip.id)).toEqual(["ready", "delivered"]);
	});

	it("keeps «En trabajo» when the workshop genuinely has nothing on the bench", () => {
		const chips = describeBuckets({ ready: 4, working: 0, delivered: 2 }, "ready");
		expect(chips.map((chip) => chip.id)).toEqual(["ready", "working", "delivered"]);
	});

	it("marks only the open bucket active", () => {
		const chips = describeBuckets({ ready: 4, working: 9, delivered: 2 }, "delivered");
		expect(chips.filter((chip) => chip.active).map((chip) => chip.id)).toEqual(["delivered"]);
	});

	it("refuses to make «En trabajo» a door", () => {
		// Those orders are on a bench in Taller and the only verb here is
		// COBRAR Y ENTREGAR. A chip that opens a list of unchargeable work is a
		// dead end the artboard does not draw.
		expect(ORDEN_BUCKETS.find((bucket) => bucket.id === "working")?.selectable).toBe(false);
	});

	it("keeps its own keys for Listas and Entregadas", () => {
		// `Ready` and `Delivered` are already translated masculine elsewhere
		// ("Listo", "Entregado"); every noun on this surface is *una orden*.
		const keys = ORDEN_BUCKETS.map((bucket) => bucket.labelKey);
		expect(keys).not.toContain("Ready");
		expect(keys).not.toContain("Delivered");
	});
});

describe("what a card says about itself", () => {
	it("puts already-invoiced above every other state", () => {
		// A warranty claim that has been billed is still a double-charge risk,
		// and that is the one mistake on this surface that costs a customer
		// money. It outranks the more interesting fact.
		const state = describeCardState(card({ invoiced: true, warranty: true, no_charge: true }));
		expect(state.labelKey).toBe("Already invoiced");
		expect(state.chargeable).toBe(false);
	});

	it("says WHY an invoiced card is dimmed", () => {
		expect(describeCardState(card({ invoiced: true })).noteKey).toBe(
			"It cannot be charged twice",
		);
	});

	it("names the warranty window on a no-charge order", () => {
		const state = describeCardState(card({ no_charge: true, warranty: true, warranty_days: 90 }));
		expect(state.noteKey).toBe("No charge · {0} d");
		expect(state.noteParams).toEqual([90]);
	});

	it("still lets a no-charge order be handed over", () => {
		// Zero to collect is not "nothing to do": the phone still has to leave
		// with its owner, and COBRAR Y ENTREGAR is what does that.
		expect(describeCardState(card({ no_charge: true, amount_total: 0 })).chargeable).toBe(true);
	});

	it("says nothing about an advance that does not exist", () => {
		expect(describeAdvance(card({ advance: 0 }))).toBeNull();
		expect(describeAdvance(card({ advance: 600 }))?.amount).toBe(600);
	});
});

describe("finding an order the way a customer describes it", () => {
	it("finds it by folio", () => {
		expect(matchesQuery(card(), "ro-00048")).toBe(true);
	});

	it("finds it by a name typed without accents", () => {
		// The ticket says "Ríos"; nobody types the accent at a counter.
		expect(matchesQuery(card(), "rios")).toBe(true);
	});

	it("finds it by the last digits of the IMEI, which is what is read out", () => {
		const found = card({ serials: ["356938035643821"] });
		expect(matchesQuery(found, "3821")).toBe(true);
		expect(matchesQuery(found, "356938")).toBe(false);
	});

	it("finds it by the tail of the phone number, dashes and all", () => {
		const found = card({ customer_phone: "999-123-4567" });
		expect(matchesQuery(found, "4567")).toBe(true);
	});

	it("refuses to match a one- or two-digit number against every phone in the shop", () => {
		expect(matchesQuery(card({ customer_phone: "9991234567" }), "67")).toBe(false);
	});

	it("shows everything while the box is empty", () => {
		expect(matchesQuery(card(), "")).toBe(true);
		expect(matchesQuery(card(), "   ")).toBe(true);
	});
});

describe("a line, and where it came from", () => {
	it("speaks the phone's vocabulary rather than inventing a second one", () => {
		// `mobile/orders/serviceOrderLines.ts` already owns these labels; the
		// same ticket must not read differently on two screens.
		expect(describeLine(line({ provenance: "labor" })).labelKey).toBe("labour");
		expect(describeLine(line()).labelKey).toBe("part");
		expect(describeLine(line({ provenance: "customer_supplied" })).labelKey).toBe(
			"customer's part",
		);
	});

	it("carries «no se cobra» on the customer's own part", () => {
		expect(describeLine(line({ provenance: "customer_supplied" })).noteKey).toBe("no charge");
	});

	it("tells a stocked part from one that had to be ordered in", () => {
		expect(describeLine(line({ provenance: "stock" })).noteKey).toBe("from stock");
		expect(describeLine(line({ provenance: "ordered" })).noteKey).toBe("ordered in");
	});

	it("masks a serial before it can reach a template", () => {
		const presentation = describeLine(line({ serial_no: "356938035643821" }));
		expect(presentation.handles).toEqual(["IPN002218", "35•••••••••3821"]);
		expect(presentation.handles.join(" ")).not.toContain("356938035643821");
	});

	it("masks every device id on the order too", () => {
		expect(describeDeviceIds(card({ serials: ["356938035643821"] }))).toEqual([
			"35•••••••••3821",
		]);
	});
});

describe("the balance, and the band under it", () => {
	it("is the order less what was already paid", () => {
		expect(describeBalance(card({ amount_total: 1910, advance: 600 }))).toEqual({
			orderTotal: 1910,
			advance: 600,
			saldo: 1310,
		});
	});

	it("never goes negative, because a refund is Devolución's job", () => {
		expect(describeBalance(card({ amount_total: 500, advance: 900 })).saldo).toBe(0);
	});

	it("arms nothing when no order is chosen", () => {
		expect(ordenBandInput(null)).toBeNull();
	});

	it("hands the band the same three figures it already models", () => {
		const state = resolveBandState(ordenBandInput(card())!);
		expect(state.kind).toBe("balanceDue");
		expect(state.value).toBe(1310);
		expect(state.primaryAction.id).toBe("order.collectAndDeliver");
		expect(state.primaryEnabled).toBe(true);
	});

	it("refuses to arm on an order that has already been billed", () => {
		const state = resolveBandState(ordenBandInput(card({ invoiced: true }))!);
		expect(state.primaryEnabled).toBe(false);
	});

	it("names the folio the customer holds, not the charge request", () => {
		const state = resolveBandState(ordenBandInput(card())!);
		expect(state.labelParams).toEqual(["RO-00048"]);
	});
});
