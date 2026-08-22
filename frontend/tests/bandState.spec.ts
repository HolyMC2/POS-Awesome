/**
 * The band, walked against the design canvas's own money (roadmap §17.7).
 *
 * These numbers are read off muelle-site/design/register-hifi, not invented
 * here. That is the point: §17.7 promises the artboards reconcile as ONE
 * register, so if a future edit moves a total on either side, this suite says
 * so instead of letting the reference quietly become a lie.
 *
 * Source of truth is the ARTBOARD, not `_rail.txt`. The note file drifted by
 * one peso on the corte (see the drift test at the bottom) and the artboards
 * are the copies that reconcile with each other.
 */
import { describe, expect, it } from "vitest";

import { resolveBandState, tintForTone, type BandTone } from "../src/posapp/composables/pos/shell/bandState";

describe("Venta · Main.dc.html · ticket B-04812", () => {
	const state = resolveBandState({ kind: "sale", total: 973.28 + 155.72, itemCount: 9 });

	it("shows the total the canvas shows", () => {
		// 973.28 + 155.72 is 1129.0000000000002 unrounded; the band must not
		// leak IEEE noise into a price.
		expect(state.value).toBe(1129);
	});

	it("is neutral — selling is not a state that needs a colour", () => {
		expect(state.tone).toBe("neutral");
	});

	it("names the piece count, which is 9 and not the 6 line count", () => {
		expect(state.labelParams).toEqual([9]);
	});

	it("offers exactly one action, and it is PAY", () => {
		expect(state.primaryAction.id).toBe("sale.pay");
		expect(state.primaryEnabled).toBe(true);
	});

	it("refuses to be payable on an empty cart", () => {
		expect(resolveBandState({ kind: "sale", total: 0 }).primaryEnabled).toBe(false);
	});
});

describe("Cobro · Cobro.dc.html · the change", () => {
	const state = resolveBandState({ kind: "tender", total: 1129, received: 1200 });

	it("shows $71.00 — received less total", () => {
		expect(state.kind).toBe("change");
		expect(state.value).toBe(71);
	});

	it("is green, because change owed is the good state", () => {
		expect(state.tone).toBe("positive");
		expect(state.primaryEnabled).toBe(true);
	});
});

describe("Cobro · the boundary where a shortfall becomes change", () => {
	const total = 1129;

	it("one cent short is a shortfall, amber, and cannot close", () => {
		const state = resolveBandState({ kind: "tender", total, received: 1128.99 });
		expect(state.kind).toBe("shortfall");
		expect(state.tone).toBe("warning");
		expect(state.value).toBe(0.01);
		expect(state.primaryEnabled).toBe(false);
	});

	it("exact money is NOT a shortfall — nothing is missing", () => {
		const state = resolveBandState({ kind: "tender", total, received: total });
		expect(state.kind).toBe("change");
		expect(state.tone).toBe("positive");
		expect(state.value).toBe(0);
		expect(state.primaryEnabled).toBe(true);
	});

	it("one cent over is change", () => {
		const state = resolveBandState({ kind: "tender", total, received: 1129.01 });
		expect(state.kind).toBe("change");
		expect(state.value).toBe(0.01);
	});

	it("keeps the same action id across the boundary, so the key never moves", () => {
		const short = resolveBandState({ kind: "tender", total, received: 1 });
		const over = resolveBandState({ kind: "tender", total, received: 9999 });
		expect(short.primaryAction.id).toBe(over.primaryAction.id);
	});
});

describe("Orden de servicio · Orden.dc.html · #RS-2048", () => {
	const state = resolveBandState({
		kind: "balanceDue",
		orderTotal: 2510,
		advance: 600,
		counterSales: 220,
		orderId: "RS-2048",
	});

	it("shows the saldo the canvas shows: 2,510 − 600 + 220", () => {
		expect(state.value).toBe(2130);
	});

	it("is neutral and names the order", () => {
		expect(state.tone).toBe("neutral");
		expect(state.labelParams).toEqual(["RS-2048"]);
		expect(state.primaryAction.id).toBe("order.collectAndDeliver");
	});

	it("a fully-advanced order is not payable", () => {
		const paid = resolveBandState({ kind: "balanceDue", orderTotal: 2510, advance: 2510 });
		expect(paid.value).toBe(0);
		expect(paid.primaryEnabled).toBe(false);
	});
});

describe("Devolución · Devolucion.dc.html · ticket B-04788", () => {
	const state = resolveBandState({ kind: "refund", amount: 149, ticketId: "B-04788" });

	it("shows $149.00 against the ticket the corte also lists", () => {
		expect(state.value).toBe(149);
		expect(state.labelParams).toEqual(["B-04788"]);
	});

	it("is amber — money leaving against an earlier sale is an exception (§5.4)", () => {
		expect(state.tone).toBe("warning");
	});

	it("names the amount in the button, so the CTA cannot disagree with the figure", () => {
		expect(state.primaryAction.labelParams).toEqual([149]);
	});
});

describe("Corte · Corte.dc.html · Caja 2", () => {
	// Fondo 1,500 + ventas efectivo 5,120 + anticipos 600 − salidas 1,829.
	const expected = 1500 + 5120 + 600 - 1829;
	const state = resolveBandState({ kind: "closing", expected, counted: 5366 });

	it("the artboard's own arithmetic lands on 5,391 expected", () => {
		expect(expected).toBe(5391);
	});

	it("shows a −25 difference", () => {
		expect(state.value).toBe(-25);
		expect(state.tone).toBe("warning");
		expect(state.labelKey).toContain("short");
	});

	it("a surplus is an exception too, not a success", () => {
		const over = resolveBandState({ kind: "closing", expected: 5391, counted: 5400 });
		expect(over.value).toBe(9);
		expect(over.tone).toBe("warning");
		expect(over.labelKey).toContain("over");
	});

	it("only a clean zero is calm", () => {
		const square = resolveBandState({ kind: "closing", expected: 5391, counted: 5391 });
		expect(square.value).toBe(0);
		expect(square.tone).toBe("positive");
	});
});

describe("Apertura · Apertura.dc.html", () => {
	it("shows the $1,500 float that the corte hands forward", () => {
		const state = resolveBandState({ kind: "opening", float: 1500, blockingIssues: 0 });
		expect(state.value).toBe(1500);
		expect(state.tone).toBe("neutral");
		expect(state.primaryEnabled).toBe(true);
	});

	it("§5.1 verifies rather than asks — one blocker and the register cannot open", () => {
		const blocked = resolveBandState({ kind: "opening", float: 1500, blockingIssues: 1 });
		expect(blocked.primaryEnabled).toBe(false);
	});

	it("an optional warning is not a blocker (the canvas opens at 9 of 10)", () => {
		// The artboard reads "Revisión 9 de 10 · 1 opcional" and still opens.
		const state = resolveBandState({ kind: "opening", float: 1500, blockingIssues: 0 });
		expect(state.primaryEnabled).toBe(true);
	});
});

describe("Sin conexión · Offline.dc.html", () => {
	// Efectivo 4,286 + tarjeta 3,127 + transferencia 1,600.
	const queued = 4286 + 3127 + 1600;
	const state = resolveBandState({ kind: "queued", amount: queued, ticketCount: 23 });

	it("the artboard's tender split sums to the $9,013 on the band", () => {
		expect(queued).toBe(9013);
		expect(state.value).toBe(9013);
	});

	it("carries its own tone but renders NEUTRAL — queued money is not wrong money", () => {
		expect(state.tone).toBe("queued");
		expect(tintForTone(state.tone)).toBe("neutral");
	});

	it("sends the cashier back to selling rather than asking them to fix the queue", () => {
		expect(state.primaryAction.id).toBe("offline.keepSelling");
		expect(state.primaryEnabled).toBe(true);
	});
});

describe("Recargas · Recargas.dc.html", () => {
	it("shows the $200 recharge with carrier and line", () => {
		const state = resolveBandState({
			kind: "recharge",
			amount: 200,
			carrier: "Telcel",
			msisdn: "55 2841 6390",
		});
		expect(state.value).toBe(200);
		expect(state.tone).toBe("neutral");
		expect(state.labelParams).toEqual(["Telcel", "55 2841 6390"]);
	});
});

describe("Cafetería · Cafeteria.dc.html · ticket C-0184", () => {
	it("2 capuchino + latte + 2 concha + combo desayuno = 351.00", () => {
		const state = resolveBandState({ kind: "sale", total: 96 + 58 + 68 + 129, itemCount: 6 });
		expect(state.value).toBe(351);
	});
});

describe("the invariant, structurally", () => {
	const everyKind = [
		resolveBandState({ kind: "sale", total: 1129, itemCount: 9 }),
		resolveBandState({ kind: "tender", total: 1129, received: 1200 }),
		resolveBandState({ kind: "tender", total: 1129, received: 100 }),
		resolveBandState({ kind: "balanceDue", orderTotal: 2510, advance: 600, counterSales: 220 }),
		resolveBandState({ kind: "refund", amount: 149 }),
		resolveBandState({ kind: "recharge", amount: 200 }),
		resolveBandState({ kind: "opening", float: 1500 }),
		resolveBandState({ kind: "closing", expected: 5391, counted: 5366 }),
		resolveBandState({ kind: "queued", amount: 9013, ticketCount: 23 }),
	];

	it("every state yields exactly one number and one action", () => {
		for (const state of everyKind) {
			expect(typeof state.value).toBe("number");
			expect(Number.isFinite(state.value)).toBe(true);
			// `primaryAction` is a single object by type; assert it is not a
			// list at runtime too, since that is the shape a future edit would
			// reach for when someone wants "just one more button".
			expect(Array.isArray(state.primaryAction)).toBe(false);
			expect(state.primaryAction.id).toBeTruthy();
		}
	});

	it("covers all nine numbers §17.7 names", () => {
		expect(new Set(everyKind.map((s) => s.kind)).size).toBe(9);
	});

	it("only three tints exist, though four tones do", () => {
		const tones: BandTone[] = ["neutral", "positive", "warning", "queued"];
		expect(new Set(tones.map(tintForTone)).size).toBe(3);
	});

	it("survives junk input rather than rendering NaN at the counter", () => {
		const state = resolveBandState({ kind: "sale", total: undefined, itemCount: null });
		expect(state.value).toBe(0);
		expect(state.labelParams).toEqual([0]);
	});
});

describe("canvas note drift", () => {
	it("records that _rail.txt is one peso off the corte artboards", () => {
		// _rail.txt says salidas 1,830 / esperado 5,390 / contado 5,365.
		// Corte.dc.html says 1,829 / 5,391 / 5,366, and Apertura.dc.html's
		// "Ayer cerró con" is 5,366 — so the ARTBOARDS reconcile and the note
		// is the stale copy. Both agree the difference is −25, which is why
		// the drift went unnoticed. Pinned here so fixing the note does not
		// silently "fix" the code to the wrong number.
		const artboard = { expected: 1500 + 5120 + 600 - 1829, counted: 5366 };
		const note = { expected: 1500 + 5120 + 600 - 1830, counted: 5365 };
		expect(artboard.expected).toBe(5391);
		expect(note.expected).toBe(5390);
		expect(resolveBandState({ kind: "closing", ...artboard }).value).toBe(-25);
		expect(resolveBandState({ kind: "closing", ...note }).value).toBe(-25);
	});
});
