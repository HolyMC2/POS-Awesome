// @vitest-environment jsdom

/**
 * A1 (wave 3) — FINDING FIXED 2026-08-22 (W4-A). Kept as the REGRESSION GUARD
 * for the defect it was written to prove, so re-adding the native attribute
 * fails here by name rather than being rediscovered by a cashier who cannot
 * tab to their own navigation.
 *
 * ORIGINAL FINDING: `RegisterRail.vue` applied BOTH the native `disabled` attribute and
 * `aria-disabled` to every rail item whose destination is unavailable. Native
 * `disabled` removes an element from the tab order AND makes `.focus()` a
 * no-op, so the two intents in the codebase contradict each other:
 *
 *   useRegisterRail.ts     — implements a roving tabindex and arrow-key
 *                            navigation across ALL items, deliberately NOT
 *                            skipping disabled ones. T1's stated reason:
 *                            skipping "would reshape the rail under the
 *                            operator's fingers the moment the connection
 *                            drops".
 *   RegisterRail.vue:27    — `:disabled="item.disabled"`, which removes them
 *                            from the keyboard entirely.
 *
 * The second wins, so the first is dead code today.
 *
 * Two user-visible consequences, in order of severity:
 *
 * 1. An offline-blocked destination carries an `ariaLabel` of the form
 *    "Devolución — Needs connection". That sentence is the ONLY non-colour
 *    carrier of why the item is unavailable — the amber dot beside it is
 *    `aria-hidden`. Because the button is natively disabled, a keyboard or
 *    screen-reader user cannot focus it, so the explanation built for them is
 *    the one thing they cannot reach. The dot they cannot see is all that is
 *    left.
 *
 * 2. Before the shift opens, `railDisabled` makes EVERY item disabled, so the
 *    register's only desktop navigation has zero keyboard-reachable controls.
 *
 * The fix is not to drop `aria-disabled`: it is to drop the NATIVE `disabled`
 * and keep `aria-disabled="true"`, which is the standard pattern for a
 * composite widget that must stay traversable — `activate()` in
 * useRegisterRail.ts already refuses a disabled item (line 179), so the
 * behaviour is already guarded without the attribute.
 */

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";

import RegisterRail from "../src/posapp/components/pos/shell/rail/RegisterRail.vue";
import type { RegisterRailContext } from "../src/posapp/composables/pos/shell/useRegisterRail";
import type { RailGateMap } from "../src/posapp/composables/pos/shell/railDestinations";

const ALL_GATES: RailGateMap = {
	floor: true,
	externalDocumentCheckout: true,
	saldo: true,
	closingShift: true,
};

const IconStub = defineComponent({ setup: () => () => h("span", { class: "v-icon" }) });

function mountRail(overrides: { shiftOpen?: boolean; offline?: boolean } = {}) {
	const context: RegisterRailContext = {
		__: (key) => key,
		t: (key) => key,
		gates: ref<RailGateMap>({ ...ALL_GATES }),
		activeDestinationId: ref("sale"),
		shiftOpen: ref(overrides.shiftOpen ?? true),
		offline: ref(overrides.offline ?? false),
		counts: {
			serviceOrderOpenCount: ref(0),
			floorOpenOrdersCount: ref(0),
			draftInvoicesCount: ref(0),
		},
		navigate: vi.fn(),
	};
	const wrapper = mount(RegisterRail, {
		props: { context },
		global: { stubs: { VIcon: IconStub } },
	});
	return { wrapper };
}

describe("A1 regression — the rail's unavailable items stay keyboard-reachable", () => {
	it("keeps an offline-blocked destination focusable so its reason can be heard", () => {
		const { wrapper } = mountRail({ offline: true });

		const blocked = wrapper
			.findAll("button.register-rail__item")
			.filter((b) => b.attributes("data-offline") === "blocked");

		expect(blocked.length, "expected at least one offline-blocked rail item").toBeGreaterThan(0);

		// The accessible name carries the explanation. A natively-disabled
		// button cannot be focused, so that name is never announced.
		const first = blocked[0]!;
		expect(
			first.attributes("aria-label"),
			"the blocked item should explain itself in words",
		).toMatch(/—/);

		expect(
			first.attributes("disabled"),
			"native `disabled` removes the item from the tab order, so the " +
				"screen-reader explanation built for this case cannot be reached; " +
				"use aria-disabled alone",
		).toBeUndefined();
	});

	it("leaves the rail keyboard-traversable before the shift opens", () => {
		const { wrapper } = mountRail({ shiftOpen: false });

		const items = wrapper.findAll("button.register-rail__item");
		const reachable = items.filter((b) => b.attributes("disabled") === undefined);

		expect(
			reachable.length,
			"with the shift closed every item is natively disabled, so the only " +
				"desktop navigation has no keyboard-reachable control at all",
		).toBeGreaterThan(0);
	});

	it("honours its own roving-tabindex contract on a disabled item", () => {
		// useRegisterRail deliberately does not skip disabled entries when
		// moving focus. That contract is unobservable while the items are
		// natively disabled, because .focus() on them is a no-op.
		const { wrapper } = mountRail({ offline: true });

		const blocked = wrapper
			.findAll("button.register-rail__item")
			.filter((b) => b.attributes("data-offline") === "blocked");

		expect(
			blocked.every((b) => b.attributes("tabindex") !== undefined),
			"every item carries a roving tabindex",
		).toBe(true);

		expect(
			blocked.some((b) => b.attributes("disabled") !== undefined),
			"…but native `disabled` overrides tabindex entirely, so the roving " +
				"model cannot reach them — the two mechanisms contradict",
		).toBe(false);
	});
});
