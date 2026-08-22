import { describe, expect, it } from "vitest";

import {
	allocateComboPrice,
	describeComponents,
	priceCombo,
	projectComponentDecrement,
	roundMoney,
	totalPiecesForCombo,
	type ComboComponent,
} from "../src/posapp/composables/pos/combos/comboPricing";

/**
 * The reference combo from the design canvas
 * (muelle-site/design/register-hifi/Main.dc.html): "Combo Protección iPhone 15
 * Pro" — Case negro 200 + Mica Cristal 80 + Instalación 60 = lista 340.00,
 * sells at 299.00, "ahorra $41". Testing against the artboard's own numbers is
 * what stops the code and the reference drifting apart (§17.7).
 */
const REFERENCE: ComboComponent[] = [
	{ item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200 },
	{ item_code: "MICA15P", item_name: "Mica Cristal", qty: 1, rate: 80 },
	{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
];

describe("combo pricing against the design canvas", () => {
	it("prices the reference combo exactly as the artboard states it", () => {
		const pricing = priceCombo(REFERENCE, 299);
		expect(pricing.listPrice).toBe(340);
		expect(pricing.comboPrice).toBe(299);
		expect(pricing.saving).toBe(41);
		expect(pricing.isDiscounted).toBe(true);
	});

	it("writes the component summary the artboard puts under the name", () => {
		expect(describeComponents(REFERENCE)).toBe("Case negro + Mica Cristal + Instalación");
	});

	it("names a multi-unit component with its quantity, and a single one without", () => {
		expect(
			describeComponents([
				{ item_code: "A", item_name: "Mica", qty: 2, rate: 80 },
				{ item_code: "B", item_name: "Case", qty: 1, rate: 200 },
			]),
		).toBe("2 × Mica + Case");
	});

	it("matches the second combo the canvas draws — Honor X8A at 289, ahorra 36", () => {
		const honor: ComboComponent[] = [
			{ item_code: "IPN002611", item_name: "Case rojo", qty: 1, rate: 185 },
			{ item_code: "MICAX8A", item_name: "Mica", qty: 1, rate: 80 },
			{ item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60 },
		];
		expect(priceCombo(honor, 289).saving).toBe(36);
	});
});

describe("a combo that is not a discount", () => {
	it("reports zero saving rather than a negative one", () => {
		// Bundling for convenience is legitimate; printing "ahorra -$20" reads
		// as a surcharge the customer never agreed to.
		const pricing = priceCombo(REFERENCE, 360);
		expect(pricing.saving).toBe(0);
		expect(pricing.isDiscounted).toBe(false);
		expect(pricing.savingPercent).toBe(0);
	});

	it("survives an empty component list without dividing by zero", () => {
		const pricing = priceCombo([], 100);
		expect(pricing.listPrice).toBe(0);
		expect(pricing.savingPercent).toBe(0);
	});
});

describe("allocating the combo price across components", () => {
	it("sums to exactly the line total — no cent created or destroyed", () => {
		// 299 over 200/80/60 is the case naive rounding gets wrong:
		// 175.88 + 70.35 + 52.76 = 298.99.
		const allocation = allocateComboPrice(REFERENCE, 299, 1);
		const total = roundMoney(allocation.reduce((sum, a) => sum + a.allocated, 0));
		expect(total).toBe(299);
	});

	it("gives the residual cent to the largest remainder, deterministically", () => {
		const first = allocateComboPrice(REFERENCE, 299, 1);
		const second = allocateComboPrice(REFERENCE, 299, 1);
		expect(first).toEqual(second);
		// In cents: 17588.235 / 7035.294 / 5276.471. The floors sum to 29899,
		// one cent short of 29900, and the largest fractional remainder
		// (.471, Instalación) takes it.
		expect(first.map((a) => a.allocated)).toEqual([175.88, 70.35, 52.77]);
	});

	it("keeps summing exactly across a multi-combo line", () => {
		const allocation = allocateComboPrice(REFERENCE, 299, 3);
		const total = roundMoney(allocation.reduce((sum, a) => sum + a.allocated, 0));
		expect(total).toBe(897);
		expect(allocation[0]?.qty).toBe(3);
	});

	it("spreads by quantity when every component is priced at zero", () => {
		const free: ComboComponent[] = [
			{ item_code: "A", qty: 1, rate: 0 },
			{ item_code: "B", qty: 3, rate: 0 },
		];
		const allocation = allocateComboPrice(free, 100, 1);
		expect(roundMoney(allocation.reduce((s, a) => s + a.allocated, 0))).toBe(100);
		expect(allocation[0]?.allocated).toBe(25);
		expect(allocation[1]?.allocated).toBe(75);
	});

	it("returns nothing for a combo with no components", () => {
		expect(allocateComboPrice([], 299, 1)).toEqual([]);
	});
});

describe("stock projection", () => {
	it("projects the units each component loses per combo sold", () => {
		const decrement = projectComponentDecrement(REFERENCE, 2);
		expect(decrement).toEqual([
			{ item_code: "IPN001758", qty: 2 },
			{ item_code: "MICA15P", qty: 2 },
			{ item_code: "SRV-INST", qty: 2 },
		]);
	});

	it("counts total pieces the way the artboard's footer does", () => {
		expect(totalPiecesForCombo(REFERENCE, 1)).toBe(3);
		expect(
			totalPiecesForCombo([{ item_code: "A", qty: 2, rate: 10 }], 3),
		).toBe(6);
	});
});
