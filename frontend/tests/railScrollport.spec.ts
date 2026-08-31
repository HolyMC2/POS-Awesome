// @vitest-environment jsdom

/**
 * THE RAIL DOES NOT CLIP «CERRAR TURNO» ON A SHORT WINDOW.
 *
 * 11 fixed-height 66px entries ≈ 720px of content in a rail sized to the
 * viewport. On any window shorter than ~854px the box was shorter than that,
 * carried `overflow: hidden`, and had no inner scrollport — so the footer
 * («Cerrar Turno») was clipped off the bottom, unreachable by pointer, and
 * `.focus()` scrolled the whole rail with no way back (measured on the live
 * mirror: 1366×768 → 86px clipped and the close-shift button unclickable;
 * 1143×656 → 197px). Same class as the shipped ledger-finder fix.
 *
 * The fix, pinned here at the source (jsdom computes no layout, so the two
 * halves are: the modifier classes are really on the two groups — asserted on
 * the mounted component — and the scrollport rules are really in the stylesheet
 * — asserted on the `<style>` text).
 */

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";

import RegisterRail from "../src/posapp/components/pos/shell/rail/RegisterRail.vue";
import railSource from "../src/posapp/components/pos/shell/rail/RegisterRail.vue?raw";
import type { RegisterRailContext } from "../src/posapp/composables/pos/shell/useRegisterRail";
import type { RailGateMap } from "../src/posapp/composables/pos/shell/railDestinations";

const IconStub = defineComponent({ setup: () => () => h("span", { class: "v-icon" }) });

function mountRail() {
	const context: RegisterRailContext = {
		__: (key) => key,
		t: (key) => key,
		gates: ref<RailGateMap>({ floor: true, externalDocumentCheckout: true, saldo: true, closingShift: true, quotations: true }),
		activeDestinationId: ref("sale"),
		shiftOpen: ref(true),
		offline: ref(false),
		counts: {
			serviceOrderOpenCount: ref(0),
			floorOpenOrdersCount: ref(0),
			draftInvoicesCount: ref(0),
		},
		navigate: vi.fn(),
	};
	return mount(RegisterRail, { props: { context }, global: { stubs: { VIcon: IconStub } } });
}

const style = railSource.slice(railSource.indexOf("<style"), railSource.lastIndexOf("</style>"));
const rule = (selector: string) => {
	const at = style.indexOf(`${selector} {`);
	expect(at, `${selector} has no rule`).toBeGreaterThan(-1);
	return style.slice(at, style.indexOf("}", at));
};

describe("the register rail keeps «Cerrar Turno» reachable when the window is short", () => {
	it("marks the primary and footer groups, with the close-shift button pinned in the footer", () => {
		const wrapper = mountRail();
		expect(wrapper.find(".register-rail__group--primary").exists()).toBe(true);
		const footer = wrapper.find(".register-rail__group--footer");
		expect(footer.exists()).toBe(true);
		// closing is a footer destination — it must live in the pinned group.
		expect(footer.find('[data-rail-destination="closing"]').exists()).toBe(true);
	});

	it("gives only the primary group a scrollport, and one that touch and wheel can drive", () => {
		const body = rule(".register-rail__group--primary");
		// flex-grow 0 keeps the tall-window layout identical; shrink 1 + min-height 0
		// let it give up height and scroll on a short one.
		expect(body).toMatch(/flex:\s*0 1 auto/);
		expect(body).toMatch(/min-height:\s*0/);
		expect(body).toMatch(/overflow-y:\s*auto/);
	});

	it("pins the footer so the close-shift button never scrolls out of reach", () => {
		expect(rule(".register-rail__group--footer")).toMatch(/flex:\s*0 0 auto/);
	});

	it("clips the rail itself with `clip` after the `hidden` fallback (no phantom focus-scroll)", () => {
		const body = rule(".register-rail");
		expect(body).toMatch(/overflow:\s*hidden;[\s\S]*overflow:\s*clip;/);
	});
});
