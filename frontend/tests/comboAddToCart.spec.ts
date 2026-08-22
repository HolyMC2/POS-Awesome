// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	attachComboComponents,
	isAttachableComponentList,
	normalizeComboComponent,
	COMBO_COMPONENTS_FIELD,
	COMBO_BROKEN_FIELD,
} from "../src/posapp/composables/pos/items/comboLineAttachment";
import {
	useComboComponents,
	clearComboComponentsCache,
} from "../src/posapp/composables/pos/items/useComboComponents";
import { priceCombo } from "../src/posapp/composables/pos/combos/comboPricing";
import {
	readAvailabilityProbe,
	resetAvailabilityProbe,
} from "../src/posapp/composables/pos/combos/comboAvailability";

// Raw source: the field-name contract is a property of what is WRITTEN on both
// sides, and W25-A owns the reader. A runtime test cannot catch the two
// spelling themselves apart, because each side would still pass in isolation.
import itemsTableSource from "../src/posapp/components/pos/invoice/ItemsTable.vue?raw";

/**
 * The wire between wave 1's combo modules and the cart (roadmap §17.6).
 *
 * `ComboCartLine` and its render path were proven by tests before anything
 * populated `posa_combo_components`, so `isComboLine()` was false for every
 * line in the product. These specs cover the half that was missing: an add
 * that marks the line, an add that does not, and the guarantee that the still
 * unresolved availability decision was not quietly answered on the way.
 */

/** The artboard's combo: case + mica + instalación at 299. */
const CASE = { item_code: "IPN001758", item_name: "Case negro", qty: 1, rate: 200, uom: "Nos", actual_qty: 12 };
const MICA = { item_code: "IPN002611", item_name: "Mica Cristal", qty: 1, rate: 80, uom: "Nos", actual_qty: 40 };
const INSTALL = { item_code: "SRV-INST", item_name: "Instalación", qty: 1, rate: 60, uom: "Nos", actual_qty: 0 };
const COMBO_COMPONENTS = [CASE, MICA, INSTALL];

describe("attaching components marks the line without repricing it", () => {
	beforeEach(() => resetAvailabilityProbe());

	it("marks a combo add as one line carrying its components", () => {
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		expect(attachComboComponents(line, COMBO_COMPONENTS)).toBe(true);
		expect(line[COMBO_COMPONENTS_FIELD]).toHaveLength(3);
		expect(line[COMBO_BROKEN_FIELD]).toBe(0);
	});

	it("leaves a plain add unmarked", () => {
		const line: any = { item_code: "IPN001758", qty: 1, rate: 200 };
		expect(attachComboComponents(line, [])).toBe(false);
		expect(line[COMBO_COMPONENTS_FIELD]).toBeUndefined();
		expect(line[COMBO_BROKEN_FIELD]).toBeUndefined();
	});

	it("never touches the rate the shop set", () => {
		// The combo price is the bundle item's own Item Price. Deriving a rate
		// from components here would overwrite what the shop actually charges —
		// note the parts total 340 and the combo sells for 299.
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		attachComboComponents(line, COMBO_COMPONENTS);
		expect(line.rate).toBe(299);
	});

	it("yields the saving the ticket promises", () => {
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		attachComboComponents(line, COMBO_COMPONENTS);
		const pricing = priceCombo(line[COMBO_COMPONENTS_FIELD], line.rate);
		expect(pricing.listPrice).toBe(340);
		expect(pricing.saving).toBe(41);
	});

	it("adds no cart lines of its own", () => {
		// One combo at the combo price, not three lines at allocated shares —
		// splitting would reprice on the next edit and break comboReturns.
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		const cart: any[] = [line];
		attachComboComponents(line, COMBO_COMPONENTS);
		expect(cart).toHaveLength(1);
	});

	it("refuses a component list with nothing in it", () => {
		expect(isAttachableComponentList([])).toBe(false);
		expect(isAttachableComponentList([{ item_code: "  " }])).toBe(false);
		expect(isAttachableComponentList(null)).toBe(false);
		// One component is a real combo — the repair giro sells an installation
		// bundle of exactly one service.
		expect(isAttachableComponentList([CASE])).toBe(true);
	});

	it("coerces a resumed or cached line's string numbers", () => {
		// Offline cache and draft resume both hand back strings; a string qty
		// makes priceCombo concatenate instead of multiply.
		const c = normalizeComboComponent({ item_code: "X", qty: "2", rate: "80.50" });
		expect(c.qty).toBe(2);
		expect(c.rate).toBe(80.5);
	});
});

describe("the add path asks the availability question, it does not answer it", () => {
	beforeEach(() => resetAvailabilityProbe());

	/**
	 * UPDATED 2026-08-22. This block used to assert `probe.resolved === 0` —
	 * that nothing could answer availability WHILE `min(components)` was an
	 * open decision (§17.6). The owner decided the rule, so that assertion now
	 * describes a condition that no longer exists.
	 *
	 * It has not been weakened. The guarantee it was really protecting is that
	 * the add path goes THROUGH the choke point rather than deciding for
	 * itself, and that survives the decision unchanged — a surface computing
	 * its own min() would still oversell, which §11 treats as zero-tolerance.
	 * Only the expected answer moved from "unresolved" to "resolved".
	 */
	it("asks through the choke point rather than deciding for itself", () => {
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		attachComboComponents(line, COMBO_COMPONENTS);

		const probe = readAvailabilityProbe();
		expect(probe.calls, "the add path must reach the resolver").toBeGreaterThan(0);
		expect(
			probe.calls,
			"one question per attach — a second means a surface asked on its own",
		).toBe(1);
	});

	it("does not block the sale when the register did not ask it to", () => {
		// Instalación has actual_qty 0. Labour never caps, and with no
		// `posa_block_sale_beyond_available_qty` in this context there is no
		// ceiling either — the shop's own warn-and-sell default.
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		expect(attachComboComponents(line, COMBO_COMPONENTS)).toBe(true);
		expect(line.max_qty).toBeUndefined();
	});

	it("writes no availability figure onto the line", () => {
		const line: any = { item_code: "COMBO-CASE-299", qty: 1, rate: 299 };
		attachComboComponents(line, COMBO_COMPONENTS);
		expect(line.posa_combo_available).toBeUndefined();
		expect(line.available_qty).toBeUndefined();
	});
});

describe("field names match the reader that renders the row", () => {
	it("uses the spelling ItemsTable.vue tests for", () => {
		// A silent divergence here renders the combo row for nobody, and reads
		// as "combos don't work" rather than as a typo.
		expect(itemsTableSource).toContain(COMBO_COMPONENTS_FIELD);
		expect(itemsTableSource).toContain(COMBO_BROKEN_FIELD);
	});
});

describe("the priced read model, not the packing one", () => {
	const call = vi.fn();

	beforeEach(() => {
		clearComboComponentsCache();
		call.mockReset();
		(globalThis as any).frappe = { call };
	});
	afterEach(() => {
		delete (globalThis as any).frappe;
	});

	it("asks combos.get_combo_components, which carries rates", async () => {
		// api.bundles.get_bundle_components answers the PACKING question and has
		// no rate; using it would price every combo's list at 0 and print
		// "ahorra $0" under a real discount.
		call.mockResolvedValue({ message: { "COMBO-A": COMBO_COMPONENTS } });
		const { getComboComponents } = useComboComponents();
		const components = await getComboComponents("COMBO-A", { pos_profile: { name: "P1" } });

		expect(call.mock.calls[0][0].method).toBe(
			"posawesome.posawesome.api.combos.get_combo_components",
		);
		expect(components).toHaveLength(3);
		expect(components[0].rate).toBe(200);
	});

	it("returns nothing for an item that is not a combo", async () => {
		call.mockResolvedValue({ message: {} });
		const { getComboComponents } = useComboComponents();
		expect(await getComboComponents("PLAIN-ITEM", {})).toEqual([]);
	});

	it("lets the sale through when the lookup fails", async () => {
		// A combo whose components cannot be fetched must still sell at the
		// price the shop set. The badge is what degrades, never the sale.
		call.mockRejectedValue(new Error("network"));
		const { getComboComponents } = useComboComponents();
		expect(await getComboComponents("COMBO-B", {})).toEqual([]);
	});

	it("does not quote one customer's price to the next", async () => {
		// Rates come from the active price list, and a customer may carry their
		// own — so the cache key has to include them.
		call.mockResolvedValue({ message: { "COMBO-C": COMBO_COMPONENTS } });
		const { getComboComponents } = useComboComponents();
		const profile = { name: "P1", selling_price_list: "Standard Selling" };
		await getComboComponents("COMBO-C", { pos_profile: profile, customer: "ALEJANDRA" });
		await getComboComponents("COMBO-C", { pos_profile: profile, customer: "MAYOREO" });
		expect(call).toHaveBeenCalledTimes(2);
	});

	it("does not re-ask for the same bundle and customer", async () => {
		call.mockResolvedValue({ message: { "COMBO-D": COMBO_COMPONENTS } });
		const { getComboComponents } = useComboComponents();
		const ctx = { pos_profile: { name: "P1" }, customer: "ALEJANDRA" };
		await getComboComponents("COMBO-D", ctx);
		await getComboComponents("COMBO-D", ctx);
		expect(call).toHaveBeenCalledTimes(1);
	});
});
