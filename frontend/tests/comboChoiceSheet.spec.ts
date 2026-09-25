// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

import ComboChoiceSheet from "../src/posapp/components/pos/combos/ComboChoiceSheet.vue";
import {
	normalizeChoiceCombo,
	type ChoiceCombo,
	type ComboChoiceResult,
} from "../src/posapp/composables/pos/combos/comboChoice";
import {
	requestComboChoice,
	resetComboChoiceState,
} from "../src/posapp/composables/pos/combos/comboChoiceRequest";

// `v-dialog` / `v-icon` stay unresolved (see fractionalQtyPad.spec.ts): their
// slot content renders, which is all this sheet's behaviour lives in.
const vuetify = () => createVuetify();

const money = (value: number) => `$${value.toFixed(2)}`;

const paquete = normalizeChoiceCombo({
	kind: "choice",
	item_code: "PAQ",
	item_name: "Combo Desayuno",
	rate: 129,
	groups: [
		{ name: "Bebida", min: 1, max: 1, options: [
			{ item_code: "AMERICANO", item_name: "Americano", qty: 1, extra_price: 0, is_default: 1, rate: 35 },
			{ item_code: "LATTE", item_name: "Latte", qty: 1, extra_price: 10, rate: 55 },
		] },
		{ name: "Pan", min: 1, max: 2, options: [
			{ item_code: "CONCHA", item_name: "Concha", qty: 1, extra_price: 0, rate: 18, is_stock_item: 1, actual_qty: 5 },
			{ item_code: "CUERNO", item_name: "Cuerno", qty: 1, extra_price: 0, rate: 22, is_stock_item: 1, actual_qty: 0 },
		] },
		{ name: "Incluye", min: 1, max: 1, options: [
			{ item_code: "MOLLETES", item_name: "Molletes", qty: 1, extra_price: 0, rate: 60 },
		] },
	],
}) as ChoiceCombo;

let wrapper: VueWrapper | null = null;

const mountSheet = async (props: Record<string, unknown> = {}) => {
	wrapper = mount(ComboChoiceSheet, {
		props: { formatCurrency: money, ...props },
		global: { plugins: [vuetify()] },
		attachTo: document.body,
	});
	await nextTick();
	return wrapper;
};

const ask = async (options: Parameters<typeof requestComboChoice>[1] = {}) => {
	const result = requestComboChoice(paquete, options);
	await nextTick();
	await nextTick();
	return result;
};

const confirm = () => wrapper!.get('[data-testid="combo-choice-confirm"]');
const option = (code: string) => wrapper!.get(`[data-testid="combo-choice-option-${code}"]`);

beforeEach(() => {
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args?.length ? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m)) : text,
	);
	setActivePinia(createPinia());
	resetComboChoiceState();
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
	resetComboChoiceState();
});

describe("the paquete picker", () => {
	it("draws nothing until the add path asks", async () => {
		await mountSheet();
		expect(wrapper!.find('[data-testid="combo-choice-sheet"]').exists()).toBe(false);
	});

	it("opens on the defaults, with the included group drawn as included", async () => {
		await mountSheet();
		void ask();
		await nextTick();
		const sheet = wrapper!.get('[data-testid="combo-choice-sheet"]');
		expect(sheet.text()).toContain("Combo Desayuno");
		expect(option("AMERICANO").attributes("aria-pressed")).toBe("true");
		expect(wrapper!.find('[data-testid="combo-choice-option-MOLLETES"]').exists()).toBe(false);
		expect(sheet.text()).toContain("Molletes");
	});

	it("a blocked confirm names the missing group and marks it instead of adding", async () => {
		await mountSheet();
		let settled = false;
		void ask().then(() => (settled = true));
		await nextTick();
		expect(confirm().text()).toContain("Choose Pan");
		await confirm().trigger("click");
		await nextTick();
		expect(settled).toBe(false);
		expect(wrapper!.get('[data-group="Pan"]').classes()).toContain("paquete-group--missing");
	});

	it("confirms the picks and the quantity", async () => {
		await mountSheet();
		const pending = ask();
		await nextTick();
		await option("LATTE").trigger("click");
		await option("CONCHA").trigger("click");
		await wrapper!.get('[data-testid="combo-choice-qty-plus"]').trigger("click");
		await nextTick();
		// (129 + 10) × 2
		expect(confirm().text()).toContain("$278.00");
		await confirm().trigger("click");
		const result = (await pending) as ComboChoiceResult;
		expect(result).toEqual({
			selection: { Bebida: { LATTE: 1 }, Pan: { CONCHA: 1 }, Incluye: { MOLLETES: 1 } },
			qty: 2,
		});
	});

	it("shows an option's extra charge and counts repeats in a multi-pick group", async () => {
		await mountSheet();
		void ask();
		await nextTick();
		expect(option("LATTE").text()).toContain("+$10.00");
		await option("CONCHA").trigger("click");
		await wrapper!.get('[data-testid="combo-choice-plus-CONCHA"]').trigger("click");
		await nextTick();
		expect(wrapper!.get('[data-group="Pan"]').text()).toContain("2");
		// Max 2: the stepper's + is now closed.
		expect(wrapper!.get('[data-testid="combo-choice-plus-CONCHA"]').attributes("disabled")).toBeDefined();
	});

	it("refuses a sold-out pick only where the register refuses overselling", async () => {
		await mountSheet({ blockSaleBeyondAvailable: true });
		void ask();
		await nextTick();
		expect(option("CUERNO").attributes("disabled")).toBeDefined();
		expect(option("CUERNO").text()).toContain("Sold out");
		wrapper!.unmount();
		resetComboChoiceState();
		await mountSheet({ blockSaleBeyondAvailable: false });
		void ask();
		await nextTick();
		expect(option("CUERNO").attributes("disabled")).toBeUndefined();
	});

	it("answers the keyboard: digits pick in the unanswered group, Enter confirms", async () => {
		await mountSheet();
		const pending = ask();
		await nextTick();
		const sheet = wrapper!.get('[data-testid="combo-choice-sheet"]');
		await sheet.trigger("keydown", { key: "1" }); // Pan → Concha
		await sheet.trigger("keydown", { key: "Enter" });
		expect(((await pending) as ComboChoiceResult).selection.Pan).toEqual({ CONCHA: 1 });
	});

	it("opens an edit on the line's own picks and says Update", async () => {
		await mountSheet();
		void ask({ selection: { Bebida: { LATTE: 1 }, Pan: { CUERNO: 2 }, Incluye: { MOLLETES: 1 } }, qty: 3, editing: true });
		await nextTick();
		expect(option("LATTE").attributes("aria-pressed")).toBe("true");
		expect(wrapper!.get('[data-testid="combo-choice-qty"]').text()).toBe("3");
		expect(confirm().text()).toContain("Update");
	});

	it("closing answers null — the add is abandoned", async () => {
		await mountSheet();
		const pending = ask();
		await nextTick();
		await wrapper!.get('[data-testid="combo-choice-close"]').trigger("click");
		await expect(pending).resolves.toBeNull();
		await nextTick();
		expect(wrapper!.find('[data-testid="combo-choice-sheet"]').exists()).toBe(false);
	});
});
