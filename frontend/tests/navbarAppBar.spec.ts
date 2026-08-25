// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: false,
		rtlStyles: {},
		rtlClasses: [],
	}),
}));

import NavbarAppBar from "../src/posapp/components/navbar/NavbarAppBar.vue";

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const ButtonStub = defineComponent({
	props: {
		disabled: {
			type: Boolean,
			default: false,
		},
	},
	emits: ["click"],
	setup(props, { attrs, slots, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					disabled: props.disabled,
					"data-test": attrs["data-test"],
					onClick: () => emit("click"),
				},
				slots.default?.(),
			);
	},
});

describe("NavbarAppBar", () => {
	beforeEach(() => {
		vi.stubGlobal("frappe", {
			session: {
				user: "cashier@example.com",
				user_fullname: "Main Cashier",
			},
		});
		vi.stubGlobal("__", (value: string) => value);
		Object.defineProperty(window, "innerWidth", {
			writable: true,
			configurable: true,
			value: 1280,
		});
	});

	it("shows one actionable cashier chip instead of duplicate user chips", async () => {
		const wrapper = mount(NavbarAppBar, {
			props: {
				posProfile: { name: "Main POS" },
				cashierName: "Backup Cashier",
				pendingInvoices: 0,
				loadingProgress: 0,
				loadingActive: false,
				loadingMessage: "",
			},
			global: {
				mocks: {
					__: (value: string) => value,
					$theme: { isDark: { value: false } },
				},
				components: {
					VAppBar: BoxStub,
					VAppBarNavIcon: ButtonStub,
					VImg: BoxStub,
					VToolbarTitle: BoxStub,
					VSpacer: BoxStub,
					VBtn: ButtonStub,
					VBadge: BoxStub,
					VTooltip: BoxStub,
					VChip: ButtonStub,
					VIcon: BoxStub,
					VProgressLinear: BoxStub,
					NavbarInfoGadgets: BoxStub,
				},
			},
		});

		expect(wrapper.findAll('[data-test="cashier-chip"]')).toHaveLength(1);
		expect(wrapper.find('[data-test="profile-chip-secondary"]').exists()).toBe(false);
		// The chip is a control labelled by the cashier's FIRST name — the full
		// name spent ~150px of the bar restating what the cashier knows about
		// themselves, and lives on the tooltip instead (08-24).
		const chip = wrapper.get('[data-test="cashier-chip"]');
		expect(chip.text()).toContain("Backup");
		expect(chip.text()).not.toContain("Backup Cashier");
		expect(chip.attributes("title")).toBe("Backup Cashier");
		expect(wrapper.text()).toContain("Main POS");
		expect(chip.attributes("role")).toBe("button");
	});
});
