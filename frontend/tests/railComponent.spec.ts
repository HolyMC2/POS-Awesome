// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";

import RegisterRail from "../src/posapp/components/pos/shell/rail/RegisterRail.vue";
import type { RegisterRailContext } from "../src/posapp/composables/pos/shell/useRegisterRail";
import {
	RAIL_OFFLINE_ATTR_VALUES,
	type RailGateMap,
} from "../src/posapp/composables/pos/shell/railDestinations";

const ALL_GATES: RailGateMap = {
	floor: true,
	externalDocumentCheckout: true,
	saldo: true,
	closingShift: true,
};

/**
 * Render-function stub, not a `template:` one: these specs run against the
 * runtime-only Vue build, where a string template silently renders nothing.
 */
const IconStub = defineComponent({ setup: () => () => h("span", { class: "v-icon" }) });

function mountRail(
	overrides: {
		shiftOpen?: boolean;
		offline?: boolean;
		active?: string;
		gates?: Partial<RailGateMap>;
		counts?: Record<string, number>;
	} = {},
) {
	const navigate = vi.fn();
	const context: RegisterRailContext = {
		__: (key) => key,
		t: (key) => key,
		gates: ref<RailGateMap>({ ...ALL_GATES, ...(overrides.gates || {}) }),
		activeDestinationId: ref(overrides.active ?? "sale"),
		shiftOpen: ref(overrides.shiftOpen ?? true),
		offline: ref(overrides.offline ?? false),
		counts: {
			serviceOrderOpenCount: ref(overrides.counts?.serviceOrderOpenCount ?? 0),
			floorOpenOrdersCount: ref(overrides.counts?.floorOpenOrdersCount ?? 0),
			draftInvoicesCount: ref(overrides.counts?.draftInvoicesCount ?? 0),
		},
		navigate,
	};

	const wrapper = mount(RegisterRail, {
		props: { context },
		global: {
			stubs: { VIcon: IconStub },
		},
	});

	return { wrapper, navigate, context };
}

const button = (wrapper: ReturnType<typeof mountRail>["wrapper"], id: string) =>
	wrapper.get(`[data-rail-destination="${id}"]`);

describe("RegisterRail — landmark and semantics", () => {
	it("is a labelled nav landmark, not a styled column of divs", () => {
		const { wrapper } = mountRail();
		const nav = wrapper.get("nav.register-rail");
		expect(nav.attributes("aria-label")).toBe("Register navigation");
	});

	it("renders every destination as a real button", () => {
		const { wrapper } = mountRail();
		const buttons = wrapper.findAll("button.register-rail__item");
		// Nine primary pills, Corte, and the "More" pill that fronts the tools
		// group (its five members render inside the flyout, not as pills).
		expect(buttons).toHaveLength(11);
		expect(buttons.every((b) => b.attributes("type") === "button")).toBe(true);
	});

	it("marks the active destination with aria-current, not colour alone", () => {
		const { wrapper } = mountRail({ active: "drafts" });
		expect(button(wrapper, "drafts").attributes("aria-current")).toBe("page");
		expect(button(wrapper, "drafts").classes()).toContain("register-rail__item--on");
		expect(button(wrapper, "sale").attributes("aria-current")).toBeUndefined();
	});

	it("asks the icon set for the artboard's glyph", () => {
		// Asserted on the button rather than on a stubbed <v-icon>: these
		// specs run without the Vuetify plugin, so a stub is the only thing
		// that would answer, and a test that only proves its own stub works
		// is worse than no test.
		const { wrapper } = mountRail();
		expect(button(wrapper, "sale").attributes("data-icon")).toBe("mdi-point-of-sale");
		expect(button(wrapper, "closing").attributes("data-icon")).toBe("mdi-finance");
		expect(button(wrapper, "floor").attributes("data-icon")).toBe("mdi-table-furniture");
	});
});

describe("RegisterRail — badges", () => {
	it("renders the count pill and hides it from the accessibility tree", () => {
		const { wrapper } = mountRail({ counts: { serviceOrderOpenCount: 4 } });
		const badge = button(wrapper, "serviceOrder").get(".register-rail__badge");
		expect(badge.text()).toBe("4");
		// The number is already inside the button's aria-label; announcing it
		// twice reads as "Service Order 4 4".
		expect(badge.attributes("aria-hidden")).toBe("true");
		expect(button(wrapper, "serviceOrder").attributes("aria-label")).toBe("Service Order — 4");
	});

	it("renders no pill at zero", () => {
		const { wrapper } = mountRail();
		expect(button(wrapper, "serviceOrder").find(".register-rail__badge").exists()).toBe(false);
	});
});

describe("RegisterRail — shift gate", () => {
	it("draws the whole rail inert before the shift opens", () => {
		const { wrapper } = mountRail({ shiftOpen: false });
		expect(wrapper.get("nav").classes()).toContain("register-rail--disabled");
		expect(wrapper.get("nav").attributes("data-rail-state")).toBe("disabled");
		// `aria-disabled`, NOT the native attribute. This assertion used to read
		// `attributes("disabled") !== undefined`, which encoded the defect A1
		// found in wave 3: the native attribute drops the element from the tab
		// order, so the rail announced itself as inert to sighted users and as
		// nothing at all to everyone else. See a11yRailDisabledFocus.spec.ts.
		expect(
			wrapper
				.findAll("button.register-rail__item")
				.every((b) => b.attributes("aria-disabled") === "true"),
		).toBe(true);
	});

	it("does not navigate on a click while closed", async () => {
		const { wrapper, navigate } = mountRail({ shiftOpen: false });
		await button(wrapper, "sale").trigger("click");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("keeps the rail visible, so the destinations are still discoverable", () => {
		const { wrapper } = mountRail({ shiftOpen: false });
		expect(wrapper.find("nav.register-rail").isVisible()).toBe(true);
		expect(wrapper.findAll("button.register-rail__item").length).toBe(11);
	});
});

describe("RegisterRail — offline", () => {
	it("dims a blocked destination and marks it aria-disabled", () => {
		const { wrapper } = mountRail({ offline: true });
		const invoices = button(wrapper, "invoices");
		expect(invoices.classes()).toContain("register-rail__item--dimmed");
		expect(invoices.attributes("aria-disabled")).toBe("true");
		expect(invoices.get(".register-rail__dot").exists()).toBe(true);
	});

	it("leaves the sale undimmed and clickable", async () => {
		const { wrapper, navigate } = mountRail({ offline: true });
		const sale = button(wrapper, "sale");
		expect(sale.classes()).not.toContain("register-rail__item--dimmed");
		await sale.trigger("click");
		expect(navigate).toHaveBeenCalledWith("sale");
	});
});

describe("RegisterRail — roving tabindex", () => {
	it("keeps exactly one item in the tab order", () => {
		const { wrapper } = mountRail();
		const tabbable = wrapper
			.findAll("button.register-rail__item")
			.filter((b) => b.attributes("tabindex") === "0");
		expect(tabbable).toHaveLength(1);
		expect(tabbable[0].attributes("data-rail-destination")).toBe("sale");
	});

	it("moves the tab stop with the arrow keys", async () => {
		const { wrapper } = mountRail();
		await wrapper.get("nav").trigger("keydown", { key: "ArrowDown" });
		expect(button(wrapper, "browse").attributes("tabindex")).toBe("0");
		expect(button(wrapper, "sale").attributes("tabindex")).toBe("-1");
	});

	it("jumps to the footer entry with End", async () => {
		const { wrapper } = mountRail();
		await wrapper.get("nav").trigger("keydown", { key: "End" });
		expect(button(wrapper, "closing").attributes("tabindex")).toBe("0");
	});

	it("navigates on Enter", async () => {
		const { wrapper, navigate } = mountRail();
		await wrapper.get("nav").trigger("keydown", { key: "ArrowDown" });
		await wrapper.get("nav").trigger("keydown", { key: "Enter" });
		expect(navigate).toHaveBeenCalledWith("browse");
	});

	it("follows a click with the tab stop, so the two agree", async () => {
		const { wrapper } = mountRail();
		await button(wrapper, "drafts").trigger("click");
		expect(button(wrapper, "drafts").attributes("tabindex")).toBe("0");
	});
});

describe("RegisterRail — preset shape", () => {
	it("drops Recarga and keeps Salón on a table-service preset", () => {
		const { wrapper } = mountRail({ gates: { saldo: false } });
		expect(wrapper.find('[data-rail-destination="recharge"]').exists()).toBe(false);
		expect(wrapper.find('[data-rail-destination="floor"]').exists()).toBe(true);
	});

	it("drops Salón on a retail preset", () => {
		const { wrapper } = mountRail({ gates: { floor: false } });
		expect(wrapper.find('[data-rail-destination="floor"]').exists()).toBe(false);
		expect(wrapper.find('[data-rail-destination="recharge"]').exists()).toBe(true);
	});

	it("renders the avatar slot without making it a destination", () => {
		const navigate = vi.fn();
		const wrapper = mount(RegisterRail, {
			props: {
				context: {
					__: (k: string) => k,
					t: (k: string) => k,
					gates: ref<RailGateMap>(ALL_GATES),
					activeDestinationId: ref("sale"),
					shiftOpen: ref(true),
					offline: ref(false),
					counts: {},
					navigate,
				} satisfies RegisterRailContext,
			},
			slots: { avatar: '<img alt="cashier" src="#" />' },
			global: { stubs: { VIcon: IconStub } },
		});
		expect(wrapper.get(".register-rail__avatar img").attributes("alt")).toBe("cashier");
		expect(wrapper.findAll("button.register-rail__item")).toHaveLength(11);
	});
});

describe("RegisterRail — state hooks for the evidence lane and wave-3 audit", () => {
	it("reports the shift gate on the root, readable without the CSS", () => {
		expect(mountRail({ shiftOpen: true }).wrapper.get("nav").attributes("data-rail-state")).toBe(
			"enabled",
		);
		expect(mountRail({ shiftOpen: false }).wrapper.get("nav").attributes("data-rail-state")).toBe(
			"disabled",
		);
	});

	it("carries a stable testid alongside the landmark", () => {
		expect(mountRail().wrapper.get('[data-testid="register-rail"]').exists()).toBe(true);
	});

	it("emits each destination's declared offline standing", () => {
		const { wrapper } = mountRail();
		expect(button(wrapper, "sale").attributes("data-offline")).toBe("available");
		expect(button(wrapper, "expense").attributes("data-offline")).toBe("queued");
		expect(button(wrapper, "browse").attributes("data-offline")).toBe("cachedReadOnly");
		expect(button(wrapper, "invoices").attributes("data-offline")).toBe("blocked");
	});

	it("emits only tokens from the exported vocabulary, so audits can enumerate", () => {
		const { wrapper } = mountRail();
		for (const item of wrapper.findAll("button.register-rail__item")) {
			expect(RAIL_OFFLINE_ATTR_VALUES).toContain(item.attributes("data-offline"));
		}
	});

	it("keeps data-offline as the DECLARATION, not the live condition", () => {
		// Reads `blocked` whether or not the register is offline right now —
		// `--dimmed` is the live state. An audit that conflated the two would
		// report every register as broken while online.
		const online = mountRail({ offline: false }).wrapper;
		const offline = mountRail({ offline: true }).wrapper;
		expect(button(online, "invoices").attributes("data-offline")).toBe("blocked");
		expect(button(offline, "invoices").attributes("data-offline")).toBe("blocked");
		expect(button(online, "invoices").classes()).not.toContain("register-rail__item--dimmed");
		expect(button(offline, "invoices").classes()).toContain("register-rail__item--dimmed");
	});
});

/**
 * The other half of dropping the native `disabled` attribute (A1, wave 3).
 *
 * Removing it bought keyboard reachability — an offline-blocked item can now
 * be focused so its "— Needs connection" name is announced, and the rail is
 * still traversable before the shift opens. The price is that the browser no
 * longer refuses activation for us, so `activate()`'s guard is the ONLY thing
 * standing between a dimmed item and a navigation. These assertions are that
 * guard's contract, one per route in.
 */
describe("an unavailable item is reachable but never activatable", () => {
	const blockedButtons = (wrapper: ReturnType<typeof mountRail>["wrapper"]) =>
		wrapper
			.findAll("button.register-rail__item")
			.filter((button) => button.attributes("aria-disabled") === "true");

	it("does not navigate when an offline-blocked item is clicked", async () => {
		const { wrapper, navigate } = mountRail({ offline: true });
		const blocked = blockedButtons(wrapper);
		expect(blocked.length, "expected an offline-blocked item").toBeGreaterThan(0);

		await blocked[0]!.trigger("click");
		expect(navigate, "a dimmed destination must not navigate on click").not.toHaveBeenCalled();
	});

	it("does not navigate on Enter or Space with the shift closed", async () => {
		const { wrapper, navigate } = mountRail({ shiftOpen: false });
		const nav = wrapper.find("nav.register-rail");

		await nav.trigger("keydown", { key: "Enter" });
		await nav.trigger("keydown", { key: " " });

		expect(
			navigate,
			"§5.1: until the shift opens the register cannot do anything, and the " +
				"keyboard must not be the way around that",
		).not.toHaveBeenCalled();
	});

	it("still navigates for an item that IS available", async () => {
		// The guard must refuse the disabled case without refusing everything —
		// a test that only proves refusal would pass on a rail that navigates
		// nowhere at all.
		const { wrapper, navigate } = mountRail();
		const usable = wrapper
			.findAll("button.register-rail__item")
			.filter((button) => button.attributes("aria-disabled") !== "true");
		expect(usable.length).toBeGreaterThan(0);

		await usable[usable.length - 1]!.trigger("click");
		expect(navigate).toHaveBeenCalledTimes(1);
	});

	it("keeps every item in the tab order while the shift is closed", () => {
		const { wrapper } = mountRail({ shiftOpen: false });
		const items = wrapper.findAll("button.register-rail__item");

		expect(items.length).toBeGreaterThan(0);
		expect(
			items.every((button) => button.attributes("disabled") === undefined),
			"the only desktop navigation must not have zero keyboard-reachable " +
				"controls at the one moment a cashier needs to find Close Shift",
		).toBe(true);
		expect(
			items.every((button) => button.attributes("tabindex") !== undefined),
			"every item carries a roving tabindex",
		).toBe(true);
	});
});
