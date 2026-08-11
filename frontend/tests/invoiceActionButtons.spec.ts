// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import InvoiceActionButtons from "../src/posapp/components/pos/invoice/InvoiceActionButtons.vue";

describe("InvoiceActionButtons layout contract", () => {
	beforeEach(() => {
		(window as any).__ = (value: string) => value;
		vi.stubGlobal("__", (value: string) => value);
	});

	const mountButtons = (width = 400, profile: Record<string, unknown> = {}) => {
		(window as any).innerWidth = width;
		(window as any).innerHeight = 740;
		return mount(InvoiceActionButtons, {
			props: { pos_profile: profile },
			global: { mocks: { __: (value: string) => value } },
		});
	};

	it("puts PAY first, full width, and on the keyboard target", () => {
		const wrapper = mountButtons();
		const firstColumn = wrapper.findAll("v-col")[0];
		expect(firstColumn.attributes("cols")).toBe("12");

		const pay = wrapper.find(".pay-btn");
		expect(pay.exists()).toBe(true);
		expect(pay.attributes("block")).toBeDefined();
		expect(pay.attributes("data-pos-keyboard-target")).toBe("pay");
		expect(pay.classes()).toContain("summary-btn");

		// Nothing may render above it — that ordering is what keeps PAY in view
		// when a profile enables the optional secondary actions.
		expect(wrapper.findAll("v-btn")[0].classes()).toContain("pay-btn");
	});

	it("is the tonal variant on a phone — the case the colour rule exists for", () => {
		expect(mountButtons(400).find(".pay-btn").attributes("variant")).toBe("tonal");
		expect(mountButtons(1440).find(".pay-btn").attributes("variant")).toBe("elevated");
	});
});
