// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";

import ActionBand from "../src/posapp/components/pos/shell/band/ActionBand.vue";
import { resolveBandState } from "../src/posapp/composables/pos/shell/bandState";

/**
 * The two band states this round adds, and the lane that carries a mesa sale's
 * other two verbs.
 *
 * `bandState.spec.ts` walks the shipped eight against the canvas; these are the
 * ninth and tenth, and they are the ones that decide the golden flow's central
 * claim — the register's primary verb is CONTEXTUAL. A walk-up pays; a cuenta
 * on a table saves and goes back to the room.
 */

describe("the salón band", () => {
	it("charges the SELECTED cuenta, and names it", () => {
		const state = resolveBandState({
			kind: "floorAccount",
			total: 351,
			accountLabel: "Mesa 7 · Sofía",
			chargeable: true,
		});

		expect(state.value).toBe(351);
		expect(state.labelParams).toEqual(["Mesa 7 · Sofía"]);
		expect(state.primaryAction.id).toBe("floor.chargeAccount");
		expect(state.primaryEnabled).toBe(true);
	});

	it("refuses Charge on an empty cuenta (UX map §5)", () => {
		const state = resolveBandState({
			kind: "floorAccount",
			total: 0,
			accountLabel: "Mesa 1",
			chargeable: false,
		});

		// The button keeps its place — a band that changes shape while a waiter
		// taps around the room is a moving target — and refuses the press.
		expect(state.primaryAction.id).toBe("floor.chargeAccount");
		expect(state.primaryEnabled).toBe(false);
	});

	it("has a caption for the state a waiter walks in on", () => {
		const state = resolveBandState({ kind: "floorAccount", total: 0 });

		// Not «Cuenta abierta · », two separators around nothing.
		expect(state.labelKey).toBe("No account selected");
		expect(state.labelParams).toBeUndefined();
	});

	it("never offers PAY: no floor state carries the sale's action", () => {
		for (const chargeable of [true, false]) {
			const state = resolveBandState({ kind: "floorAccount", total: 100, chargeable });
			expect(state.primaryAction.id).not.toBe("sale.pay");
		}
	});
});

describe("the mesa-owned sale band", () => {
	it("saves and goes back to the room instead of paying", () => {
		const state = resolveBandState({
			kind: "tableSale",
			total: 191,
			accountLabel: "Mesa 1 · Sofía",
			lineCount: 4,
		});

		expect(state.kind).toBe("tableSale");
		expect(state.value).toBe(191);
		expect(state.labelParams).toEqual(["Mesa 1 · Sofía", 4]);
		expect(state.primaryAction.id).toBe("table.saveAndReturn");
		expect(state.primaryAction.labelKey).toBe("SAVE · BACK TO FLOOR");
	});

	it("stays pressable on an empty cuenta — going back is always allowed", () => {
		const state = resolveBandState({ kind: "tableSale", total: 0, lineCount: 0 });

		expect(state.primaryEnabled).toBe(true);
	});

	it("leaves the walk-up sale exactly as it shipped", () => {
		const state = resolveBandState({ kind: "sale", total: 96, itemCount: 2 });

		expect(state.primaryAction.id).toBe("sale.pay");
		expect(state.primaryAction.labelKey).toBe("PAY");
	});
});

describe("the band's actions lane", () => {
	const saleState = resolveBandState({ kind: "sale", total: 96, itemCount: 2 });

	it("draws no box at all for a register that passes no secondaries", () => {
		const wrapper = mount(ActionBand, { props: { state: saleState } });

		// `display: contents` on the unfilled lanes is the reason an empty band
		// looks untouched; an actions wrapper must be absent, not empty, or it
		// takes one of the band's 22px gaps.
		expect(wrapper.find(".action-band__actions").exists()).toBe(false);
		expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(1);
	});

	it("keeps ONE primary while carrying two secondaries", () => {
		const wrapper = mount(ActionBand, {
			props: { state: resolveBandState({ kind: "tableSale", total: 191, lineCount: 4 }) },
			slots: {
				actions: () => [
					h("button", { class: "action-band__secondary", "data-testid": "band-fire-course" }, "ENVIAR"),
					h("button", { class: "action-band__secondary", "data-testid": "band-charge-account" }, "COBRAR"),
				],
			},
		});

		// §17.7 invariant 1 is one NUMBER and one PRIMARY action, not one
		// button — the DOM count is what makes that assertable from outside.
		expect(wrapper.findAll('[data-testid="band-value"]')).toHaveLength(1);
		expect(wrapper.findAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(wrapper.findAll(".action-band__secondary")).toHaveLength(2);
	});

	it("puts the secondaries after the spacer, against the primary", () => {
		const wrapper = mount(ActionBand, {
			props: { state: resolveBandState({ kind: "tableSale", total: 191, lineCount: 4 }) },
			slots: { actions: () => h("button", { class: "action-band__secondary" }, "ENVIAR") },
		});

		const children = Array.from(wrapper.element.children).map((el) => el.className);
		const spacer = children.findIndex((cls) => cls.includes("action-band__spacer"));
		const actions = children.findIndex((cls) => cls.includes("action-band__actions"));
		const primary = children.findIndex((cls) => cls.includes("action-band__primary"));

		// Adjacency is the whole argument: a «Cobrar» stranded beside the
		// breakdown reads as a figure, not a verb.
		expect(spacer).toBeGreaterThanOrEqual(0);
		expect(actions).toBeGreaterThan(spacer);
		expect(primary).toBeGreaterThan(actions);
	});

	it("emits the primary's action id, whichever state is up", async () => {
		// Asserted through the LISTENER, not `wrapper.emitted()`: this repo has
		// been bitten before by `emitted()` recording nothing for a component
		// whose emit goes through a named handler in `<script setup>`.
		const onPrimary = vi.fn();
		const wrapper = mount(ActionBand, {
			props: { state: resolveBandState({ kind: "tableSale", total: 191, lineCount: 4 }), onPrimary },
		});

		await wrapper.find('[data-testid="band-primary"]').trigger("click");

		expect(onPrimary).toHaveBeenCalledWith("table.saveAndReturn");
	});
});

// The band renders `__(labelKey)`; a missing global would print "undefined".
vi.stubGlobal("__", (value: string) => value);
