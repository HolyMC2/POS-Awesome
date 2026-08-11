// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChangeDueDialog from "../src/posapp/components/pos/payments/ChangeDueDialog.vue";

// Vuetify is not installed here, so v-dialog and v-btn are stubbed with real
// elements — same approach as tests/qzTrayDialog.spec.ts. The dialog stub
// publishes the two things that decide whether the cashier can miss the
// amount: whether it is open, and whether it is persistent.
const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: {
		modelValue: { type: Boolean, default: false },
		persistent: { type: Boolean, default: false },
	},
	setup(props, { slots }) {
		return () =>
			h(
				"div",
				{
					"data-testid": "change-due-overlay",
					"data-persistent": props.persistent ? "true" : "false",
				},
				props.modelValue ? slots.default?.() : undefined,
			);
	},
});

// No `emits: ["click"]` — the parent's @click then falls through as an attr
// onto the real button, so a native click runs the confirm handler.
const VBtnStub = defineComponent({
	name: "VBtnStub",
	setup(_props, { slots }) {
		return () => h("button", { type: "button" }, slots.default?.());
	},
});

beforeEach(() => {
	(window as any).__ = (value: string) => value;
	vi.stubGlobal("__", (value: string) => value);
});

const mountDialog = (props: Record<string, unknown> = {}) =>
	mount(ChangeDueDialog, {
		props: {
			modelValue: true,
			amount: 1234.5,
			currencySymbol: "$",
			formatAmount: (value: number) => value.toFixed(2),
			...props,
		},
		global: {
			// v-card is left as an unknown element on purpose: it renders its
			// children through, and nothing here asserts on it.
			components: { "v-dialog": VDialogStub, "v-btn": VBtnStub },
			mocks: { __: (value: string) => value },
		},
	});

describe("ChangeDueDialog", () => {
	it("renders the amount through the supplied formatter, with the symbol", () => {
		const wrapper = mountDialog();
		expect(wrapper.get('[data-testid="change-due-amount"]').text()).toBe(
			"$1234.50",
		);
	});

	it("falls back to the raw amount when no formatter is supplied", () => {
		const wrapper = mountDialog({
			formatAmount: undefined,
			currencySymbol: "",
		});
		expect(wrapper.get('[data-testid="change-due-amount"]').text()).toBe(
			"1234.5",
		);
	});

	it("blocks every exit except the confirm button", () => {
		// `persistent` is what swallows outside-click and Esc. Without it the
		// amount can leave the screen before the cashier has read it, which is
		// the failure this dialog exists to fix.
		expect(
			mountDialog().get('[data-testid="change-due-overlay"]').attributes(
				"data-persistent",
			),
		).toBe("true");
	});

	it("closes and reports the handover when confirmed", async () => {
		// Listener props rather than wrapper.emitted(): the dialog's own root is
		// a component, and VTU records only the native click that bubbles to it.
		const onConfirm = vi.fn();
		const onUpdate = vi.fn();
		const wrapper = mountDialog({
			onConfirm,
			"onUpdate:modelValue": onUpdate,
		});

		await wrapper.get('[data-testid="change-due-confirm"]').trigger("click");

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onUpdate).toHaveBeenCalledWith(false);
	});

	it("shows nothing when the sale owes no change", () => {
		// Zero change is a non-event: the cashier's hand is already on the next
		// order, so not even an empty dialog may appear.
		const wrapper = mountDialog({ amount: 0 });
		expect(wrapper.find('[data-testid="change-due-card"]').exists()).toBe(
			false,
		);
	});

	it("stays closed while the parent has not asked for it", () => {
		const wrapper = mountDialog({ modelValue: false });
		expect(wrapper.find('[data-testid="change-due-card"]').exists()).toBe(
			false,
		);
	});

	it("never reaches for the POS formatter while closed", () => {
		// The formatter depends on an active POS Profile, which does not exist
		// yet when the shell first mounts.
		const formatAmount = vi.fn((value: number) => value.toFixed(2));
		mountDialog({ modelValue: false, formatAmount });
		expect(formatAmount).not.toHaveBeenCalled();
	});

	it("labels the amount and the confirm action through the translator", () => {
		const wrapper = mountDialog();
		expect(wrapper.text()).toContain("Change due");
		expect(wrapper.get('[data-testid="change-due-confirm"]').text()).toBe(
			"Change given",
		);
	});
});
