// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";

import FractionalQtyPad from "../src/posapp/components/pos/invoice/FractionalQtyPad.vue";

// `v-dialog` and `v-card` stay unresolved here (the app registers Vuetify
// globally; importing `vuetify/components` under vitest drags in raw .css that
// the SSR transform cannot load). Their slot content still renders, which is
// why the pad's own fields are plain elements: the numbers are the point, and
// they have to be typeable in a test.
const vuetify = () => createVuetify();

const money = (value: any) =>
	Number(value ?? 0).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

const float = (value: any, precision?: number) =>
	Number(value ?? 0).toFixed(precision === undefined ? 3 : precision);

const JAMON = {
	item_code: "JAMON",
	item_name: "Jamón de pierna",
	uom: "Kg",
	rate: 160,
	qty: 1,
	must_be_whole_number: 0,
};

const KG_FACTS = { uom: "Kg", mustBeWholeNumber: 0, precision: 3 };

beforeEach(() => {
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args?.length ? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m)) : text,
	);
});

let onConfirm = vi.fn();

const confirmed = () => onConfirm.mock.calls[0]?.[0] as any;

/**
 * `onConfirm` is a listener PROP rather than `wrapper.emitted("confirm")`: VTU
 * records only what bubbles to the root, and this component emits from inside
 * `<script setup>` — the same reason comboCartLine.spec.ts asserts this way.
 */
const mountPad = (props: Record<string, any> = {}) => {
	onConfirm = vi.fn();
	return mount(FractionalQtyPad, {
		props: {
			onConfirm,
			modelValue: true,
			item: JAMON,
			uomFacts: KG_FACTS,
			displayCurrency: "MXN",
			currencyPrecision: 2,
			formatFloat: float,
			formatCurrency: money,
			currencySymbol: () => "$",
			...props,
		},
		global: { plugins: [vuetify()] },
		attachTo: document.body,
	});
};

const readout = (wrapper: any) => wrapper.get('[data-testid="fracc-readout"]').text();

describe("the weighing pad", () => {
	it("opens on «type weight», the gesture a scale display produces", () => {
		const wrapper = mountPad();

		expect(wrapper.find('[data-testid="fracc-gross"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="fracc-importe"]').exists()).toBe(false);
	});

	it("names the item and its rate per unit", () => {
		const wrapper = mountPad();

		expect(wrapper.text()).toContain("Jamón de pierna");
		expect(wrapper.get('[data-testid="fracc-rate"]').text()).toBe("$160.00/Kg");
	});

	it("says nothing at all before anything is typed", () => {
		// A pad that complains at an empty field teaches the operator to ignore
		// the line where the real answer is about to appear.
		expect(readout(mountPad())).toBe("");
	});
});

describe("weighing by hand", () => {
	const typeWeight = async (gross: string, tara?: string) => {
		const wrapper = mountPad();
		await wrapper.get('[data-testid="fracc-gross"]').setValue(gross);
		if (tara !== undefined) {
			await wrapper.get('[data-testid="fracc-tara"]').setValue(tara);
		}
		return wrapper;
	};

	it("shows the weight and what it costs", async () => {
		const wrapper = await typeWeight("0.475");

		expect(readout(wrapper)).toBe("0.475 Kg · $76.00");
	});

	it("subtracts the tray and shows the subtraction", async () => {
		// The golden flow's second case: 0.020 tare on 0.495 gross is the same
		// line as a hand-typed 0.475.
		const wrapper = await typeWeight("0.495", "0.020");

		expect(readout(wrapper)).toBe("0.495 − 0.020 = 0.475 Kg · $76.00");
	});

	it("refuses a tare heavier than what is on the scale", async () => {
		const wrapper = await typeWeight("0.020", "0.500");

		expect(readout(wrapper)).toBe("The tare is heavier than what is on the scale.");
		expect(wrapper.get('[data-testid="fracc-confirm"]').attributes("disabled")).toBeDefined();
	});

	it("refuses a tare that leaves nothing", async () => {
		const wrapper = await typeWeight("0.020", "0.020");

		expect(readout(wrapper)).toBe("Nothing left after the tare.");
	});

	it("records a plain qty, with the weighing on the note", async () => {
		const wrapper = await typeWeight("0.495", "0.020");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(confirmed().qty).toBe(0.475);
		expect(confirmed().note).toBe("Weighed 0.475 Kg · gross 0.495 · tare 0.020");
	});

	it("leaves no note when there was no tare to explain", async () => {
		const wrapper = await typeWeight("0.475");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(confirmed().note).toBe("");
	});
});

describe("selling by amount", () => {
	const typeImporte = async (amount: string, props: Record<string, any> = {}) => {
		const wrapper = mountPad(props);
		await wrapper.get('[data-testid="fracc-mode-importe"]').trigger("click");
		await wrapper.get('[data-testid="fracc-importe"]').setValue(amount);
		return wrapper;
	};

	it("is the golden flow's sentence, verbatim", async () => {
		const wrapper = await typeImporte("50");

		expect(readout(wrapper)).toBe("$50.00 → 0.312 Kg · charged $49.92");
	});

	it("states the charge even when it equals the ask", async () => {
		// So the sentence always tells the truth, rather than only appearing
		// when something was taken off — which is what makes it readable.
		const wrapper = await typeImporte("32");

		expect(readout(wrapper)).toBe("$32.00 → 0.200 Kg · charged $32.00");
	});

	it("puts a plain qty on the line, never the amount", async () => {
		const wrapper = await typeImporte("50");
		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");

		expect(confirmed().qty).toBe(0.312);
		expect(confirmed()).not.toHaveProperty("importe");
		expect(confirmed()).not.toHaveProperty("rate");
	});

	it("refuses when the item has no price to divide by", async () => {
		const wrapper = await typeImporte("50", { item: { ...JAMON, rate: 0 } });

		expect(readout(wrapper)).toBe("This item has no price on this register.");
	});

	it("refuses an amount that buys less than the register can sell", async () => {
		const wrapper = await typeImporte("0.01", { item: { ...JAMON, rate: 999999 } });

		expect(readout(wrapper)).toBe(
			"That amount buys less than the smallest quantity this register can sell.",
		);
	});
});

describe("the register's precision", () => {
	it("quotes only the decimals the line will actually keep", async () => {
		// A site on float_precision 2 stores 0.31, not 0.312 — quoting the
		// third decimal would print a weight and a total the invoice does not
		// contain.
		const wrapper = mountPad({
			uomFacts: { uom: "Kg", mustBeWholeNumber: 0, precision: 2 },
			formatFloat: (value: any, precision?: number) =>
				Number(value ?? 0).toFixed(precision === undefined ? 2 : precision),
		});
		await wrapper.get('[data-testid="fracc-mode-importe"]').trigger("click");
		await wrapper.get('[data-testid="fracc-importe"]').setValue("50");

		expect(readout(wrapper)).toBe("$50.00 → 0.31 Kg · charged $49.60");

		await wrapper.get('[data-testid="fracc-confirm"]').trigger("click");
		expect(confirmed().qty).toBe(0.31);
	});
});

describe("reopening", () => {
	it("starts empty rather than replaying the last weighing", async () => {
		const wrapper = mountPad();
		await wrapper.get('[data-testid="fracc-gross"]').setValue("0.475");
		expect(readout(wrapper)).not.toBe("");

		await wrapper.setProps({ modelValue: false });
		await wrapper.setProps({ modelValue: true });

		expect(readout(wrapper)).toBe("");
	});
});
