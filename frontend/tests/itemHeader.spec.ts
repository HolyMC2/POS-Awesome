// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ItemHeader from "../src/posapp/components/pos/items/ItemHeader.vue";

const VRowStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", { class: "v-row-stub" }, slots.default?.());
	},
});

const VColStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", { class: "v-col-stub" }, slots.default?.());
	},
});

const VBtnStub = defineComponent({
	setup(_, { attrs, slots }) {
		return () =>
			h(
				"button",
				{
					...attrs,
					type: "button",
				},
				slots.default?.(),
			);
	},
});

const VExpandTransitionStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", { class: "expand-transition-stub" }, slots.default?.());
	},
});

const VProgressLinearStub = defineComponent({
	props: {
		modelValue: { type: Number, default: 0 },
	},
	setup(props, { attrs }) {
		return () =>
			h("div", {
				...attrs,
				class: ["v-progress-linear-stub", attrs.class],
				"data-model-value": String(props.modelValue),
			});
	},
});

const VTextFieldStub = defineComponent({
	props: {
		modelValue: { type: String, default: "" },
		label: { type: String, default: "" },
		disabled: { type: Boolean, default: false },
	},
	emits: ["update:modelValue", "keydown"],
	setup(props, { attrs, emit, slots }) {
		return () =>
			h("label", { class: "v-text-field-stub" }, [
				h("span", { class: "field-label" }, props.label),
				h("input", {
					...attrs,
					"data-test": attrs["data-test"] ?? "text-field-input",
					value: props.modelValue,
					disabled: props.disabled,
					onInput: (event: Event) =>
						emit(
							"update:modelValue",
							(event.target as HTMLInputElement).value,
						),
					onKeydown: (event: KeyboardEvent) => emit("keydown", event),
				}),
				slots["append-inner"]?.(),
			]);
	},
});

const mountHeader = (props: Record<string, unknown> = {}) =>
	mount(ItemHeader, {
		props: {
			searchInput: "",
			qtyInput: 1,
			posProfile: {
				posa_input_qty: false,
				posa_enable_camera_scanning: false,
			},
			...props,
		},
		global: {
			mocks: {
				frappe: { _: (value: string) => value },
				__: (value: string) => value,
			},
			components: {
				VRow: VRowStub,
				VCol: VColStub,
				VBtn: VBtnStub,
				VExpandTransition: VExpandTransitionStub,
				VProgressLinear: VProgressLinearStub,
				VTextField: VTextFieldStub,
			},
		},
	});

describe("ItemHeader", () => {
	it("shows a non-blocking sync progress bar while keeping search input enabled", () => {
		const wrapper = mount(ItemHeader, {
			props: {
				searchInput: "tea",
				qtyInput: 1,
				posProfile: {
					posa_input_qty: false,
					posa_enable_camera_scanning: false,
				},
				enableBackgroundSync: true,
				showSyncProgress: true,
				syncProgress: 42,
				syncItemsCount: 128,
				syncStatus: "Syncing offline catalog...",
			},
			global: {
				mocks: {
					frappe: { _: (value: string) => value },
					__: (value: string) => value,
				},
				components: {
					VRow: VRowStub,
					VCol: VColStub,
					VBtn: VBtnStub,
					VExpandTransition: VExpandTransitionStub,
					VProgressLinear: VProgressLinearStub,
					VTextField: VTextFieldStub,
				},
			},
		});

		const input = wrapper.get('input[data-test="text-field-input"]');
		expect((input.element as HTMLInputElement).disabled).toBe(false);

		const progressBar = wrapper.get('[data-test="item-search-sync-bar"]');
		expect(progressBar.attributes("data-model-value")).toBe("42");
		expect(wrapper.text()).toContain("Syncing offline catalog...");
		expect(wrapper.text()).toContain("128 items synced");
	});

	it("asks the soft keyboard for a search key and stops it mangling barcodes", () => {
		const wrapper = mountHeader();
		const input = wrapper.get('input[data-test="text-field-input"]');

		// Barcodes and SKUs are the usual query: autocapitalise and
		// autocorrect turn "ab-1200x" into "Ab-1200 x" on a phone, and the
		// default Enter key says "Go" instead of "Search".
		expect(input.attributes("enterkeyhint")).toBe("search");
		expect(input.attributes("autocapitalize")).toBe("off");
		expect(input.attributes("autocorrect")).toBe("off");
		expect(input.attributes("spellcheck")).toBe("false");
	});

	it("tags the in-field camera and tools buttons for coarse-pointer sizing", () => {
		const wrapper = mountHeader({
			posProfile: { posa_input_qty: false, posa_enable_camera_scanning: true },
		});

		// Vuetify's size="small" icon button is a 28px square; the class is
		// what the pointer:coarse rule grows to 40px.
		expect(wrapper.findAll("button.search-field-action").length).toBe(2);
	});
});
