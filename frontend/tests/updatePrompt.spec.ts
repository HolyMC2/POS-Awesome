// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";

import UpdatePrompt from "../src/posapp/components/ui/UpdatePrompt.vue";
import { useUpdateStore } from "../src/posapp/stores/updateStore";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: { value: false },
		rtlClasses: {},
		rtlStyles: {},
	}),
}));

const VDialogStub = defineComponent({
	name: "VDialogStub",
	emits: ["update:modelValue"],
	props: {
		modelValue: {
			type: Boolean,
			default: false,
		},
		persistent: {
			type: Boolean,
			default: false,
		},
		retainFocus: {
			type: Boolean,
			default: true,
		},
		scrim: {
			type: [Boolean, String],
			default: true,
		},
		maxWidth: {
			type: [String, Number],
			default: undefined,
		},
	},
	setup(props, { slots }) {
		return () =>
			h(
				"div",
				{
					"data-test": "update-dialog",
					"data-model-value": String(props.modelValue),
					"data-persistent": String(props.persistent),
					"data-retain-focus": String(props.retainFocus),
					"data-scrim": String(props.scrim),
					"data-max-width": String(props.maxWidth ?? ""),
				},
				slots.default?.(),
			);
	},
});

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const VButtonStub = defineComponent({
	name: "VButtonStub",
	emits: ["click"],
	setup(_, { slots, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					onClick: () => emit("click"),
				},
				slots.default?.(),
			);
	},
});

const mountPrompt = () =>
	mount(UpdatePrompt, {
		global: {
			components: {
				VDialog: VDialogStub,
				VCard: BoxStub,
				VCardTitle: BoxStub,
				VCardText: BoxStub,
				VCardActions: BoxStub,
				VIcon: BoxStub,
				VSpacer: BoxStub,
				VBtn: VButtonStub,
			},
		},
	});

describe("UpdatePrompt", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(globalThis as any).__ = (value: string) => value;
		// invoiceStore reads frappe.datetime at setup; the idle probe needs it.
		(globalThis as any).frappe = {
			datetime: { nowdate: () => "2026-08-23" },
		};
		window.sessionStorage.removeItem("posa_update_auto_applied");
	});

	it("renders the update prompt as a non-blocking dialog", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);

		const wrapper = mountPrompt();
		const dialog = wrapper.get('[data-test="update-dialog"]');

		expect(dialog.attributes("data-model-value")).toBe("true");
		expect(dialog.attributes("data-persistent")).toBe("false");
		expect(dialog.attributes("data-retain-focus")).toBe("false");
		expect(dialog.attributes("data-scrim")).toBe("false");
	});

	it("dismisses the update when the dialog closes externally", async () => {
		const updateStore = useUpdateStore();
		updateStore.setCurrentVersion("build-1000", 1000);
		updateStore.setAvailableVersion("build-2000", 2000);

		const wrapper = mountPrompt();

		wrapper.getComponent(VDialogStub).vm.$emit("update:modelValue", false);
		await wrapper.vm.$nextTick();

		expect(updateStore.dismissedVersion).toBe("build-2000");
		expect(updateStore.shouldPrompt).toBe(false);
		expect(wrapper.get('[data-test="update-dialog"]').attributes("data-model-value")).toBe("false");
	});

	it("auto-applies a waiting update once the register is idle", async () => {
		vi.useFakeTimers();
		try {
			const updateStore = useUpdateStore();
			const reloadAction = vi.fn();
			updateStore.setReloadAction(reloadAction);
			updateStore.setCurrentVersion("build-1000", 1000);
			updateStore.setAvailableVersion("build-2000", 2000);

			mountPrompt();
			await vi.advanceTimersByTimeAsync(15_000);

			expect(reloadAction).toHaveBeenCalledTimes(1);
			expect(window.sessionStorage.getItem("posa_update_auto_applied")).toBe("build-2000");
		} finally {
			vi.useRealTimers();
		}
	});

	it("auto-applies each version at most once per tab", async () => {
		vi.useFakeTimers();
		try {
			window.sessionStorage.setItem("posa_update_auto_applied", "build-2000");
			const updateStore = useUpdateStore();
			const reloadAction = vi.fn();
			updateStore.setReloadAction(reloadAction);
			updateStore.setCurrentVersion("build-1000", 1000);
			updateStore.setAvailableVersion("build-2000", 2000);

			mountPrompt();
			await vi.advanceTimersByTimeAsync(120_000);

			// The stamp says this version already got its reload; the manual
			// prompt stands so a failed activation cannot loop the register.
			expect(reloadAction).not.toHaveBeenCalled();
			expect(updateStore.shouldPrompt).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
