import { describe, expect, it } from "vitest";

import { roundMoney, type ComboComponent } from "../src/posapp/composables/pos/combos/comboPricing";
import {
	planComboReturn,
	planWholeComboReturn,
} from "../src/posapp/composables/pos/combos/comboReturns";

const REFERENCE: ComboComponent[] = [
	{ item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200 },
	{ item_code: "MICA15P", item_name: "Mica Cristal", qty: 1, rate: 80 },
	{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
];

describe("returning a whole combo", () => {
	it("refunds exactly what was charged, to the cent", () => {
		const plan = planWholeComboReturn(REFERENCE, 299, 1);
		expect(plan.refundTotal).toBe(299);
		expect(plan.isWholeCombo).toBe(true);
		expect(plan.broken).toBe(false);
		expect(plan.remaining).toEqual([]);
	});

	it("refunds a multi-combo line without drift", () => {
		const plan = planWholeComboReturn(REFERENCE, 299, 3);
		expect(plan.refundTotal).toBe(897);
	});
});

describe("returning one component of a combo", () => {
	it("refunds the allocated share, NOT the list price", () => {
		// The mica lists at 80 but was bought inside a discounted combo; its
		// share of the 299 actually paid is 70.35.
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA15P: 1 },
		});
		expect(plan.refundTotal).toBe(70.35);
		expect(plan.refundTotal).toBeLessThan(80);
	});

	it("closes the arbitrage: parts refunded can never exceed what was paid", () => {
		// Buy the combo for 299, return every part one at a time. If each part
		// refunded at LIST the customer would collect 340 — 41 more than they
		// paid — and could repeat it indefinitely.
		const perPart = REFERENCE.map(
			(component) =>
				planComboReturn({
					components: REFERENCE,
					comboPrice: 299,
					soldQty: 1,
					returning: { [component.item_code]: 1 },
				}).refundTotal,
		);
		expect(roundMoney(perPart.reduce((a, b) => a + b, 0))).toBe(299);
	});

	it("marks the line broken so it stops calling itself a combo", () => {
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA15P: 1 },
		});
		expect(plan.broken).toBe(true);
		expect(plan.isWholeCombo).toBe(false);
		expect(plan.remaining.map((r) => r.item_code)).toEqual(["IPN001758", "SRV-INST"]);
	});

	it("lets the customer keep the discount on what they kept", () => {
		// The survivors stay at their allocated rates: a return must never
		// silently raise the price of goods the customer is keeping.
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA15P: 1 },
		});
		const kept = plan.remaining.find((r) => r.item_code === "IPN001758");
		expect(kept?.rate).toBe(175.88);
		expect(kept?.rate).toBeLessThan(200);
	});
});

describe("return guards", () => {
	it("cannot return more units than were sold", () => {
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA15P: 99 },
		});
		expect(plan.lines[0]?.qty).toBe(1);
		expect(plan.refundTotal).toBe(70.35);
	});

	it("ignores a negative return quantity", () => {
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA15P: -5 },
		});
		expect(plan.lines).toEqual([]);
		expect(plan.refundTotal).toBe(0);
		expect(plan.broken).toBe(false);
	});

	it("returning nothing refunds nothing and breaks nothing", () => {
		const plan = planComboReturn({
			components: REFERENCE,
			comboPrice: 299,
			soldQty: 1,
			returning: {},
		});
		expect(plan.refundTotal).toBe(0);
		expect(plan.isWholeCombo).toBe(false);
		expect(plan.broken).toBe(false);
	});

	it("refunds a partial quantity of a multi-unit component proportionally", () => {
		const twoMicas: ComboComponent[] = [
			{ item_code: "CASE", qty: 1, rate: 200 },
			{ item_code: "MICA", qty: 2, rate: 80 },
		];
		// 299 over weights 200 and 160: allocation 166.11 / 132.89.
		const plan = planComboReturn({
			components: twoMicas,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA: 1 },
		});
		expect(plan.lines[0]?.qty).toBe(1);
		// Half of the mica's 132.89 share. 66.445 lands on 66.44 rather than
		// 66.45 because 66.445 has no exact binary form — which is precisely
		// why the LAST unit carries the residual instead of every unit
		// carrying a rounded rate; see the next assertion.
		expect(plan.lines[0]?.refund).toBe(66.44);
		expect(plan.broken).toBe(true);
	});

	it("returning every unit of a component refunds its whole share, not n × a rounded rate", () => {
		const twoMicas: ComboComponent[] = [
			{ item_code: "CASE", qty: 1, rate: 200 },
			{ item_code: "MICA", qty: 2, rate: 80 },
		];
		const plan = planComboReturn({
			components: twoMicas,
			comboPrice: 299,
			soldQty: 1,
			returning: { MICA: 2 },
		});
		// 2 × 66.44 would be 132.88 and lose a cent; the allocation is 132.89.
		expect(plan.lines[0]?.refund).toBe(132.89);
	});
});
