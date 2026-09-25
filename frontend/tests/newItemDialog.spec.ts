// @vitest-environment jsdom

import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewItemDialog from "../src/posapp/components/pos/items/NewItemDialog.vue";
import itemService from "../src/posapp/services/itemService";

vi.mock("../src/posapp/services/itemService", () => ({
	default: {
		getUOMsData: vi.fn(),
		createItemData: vi.fn(),
	},
}));

vi.mock("../src/posapp/services/catalogScanService", () => ({
	default: {
		createItemFromScan: vi.fn(),
	},
}));

import catalogScanService from "../src/posapp/services/catalogScanService";

const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: {
		modelValue: {
			type: Boolean,
			default: false,
		},
	},
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const VFormStub = defineComponent({
	name: "VFormStub",
	setup(_, { slots, expose }) {
		expose({
			validate: () => Promise.resolve({ valid: true }),
		});
		return () => h("form", {}, slots.default?.());
	},
});

const createInputStub = (name: string) =>
	defineComponent({
		name,
		props: {
			modelValue: {
				type: [String, Number],
				default: "",
			},
			label: {
				type: String,
				default: "",
			},
		},
		emits: ["update:modelValue"],
		setup(props, { attrs, emit }) {
			return () =>
				h("input", {
					value: props.modelValue ?? "",
					"data-test": attrs["data-test"],
					"aria-label": props.label,
					onInput: (event: Event) =>
						emit("update:modelValue", (event.target as HTMLInputElement).value),
				});
		},
	});

const VButtonStub = defineComponent({
	name: "VButtonStub",
	emits: ["click"],
	setup(_, { slots, attrs, emit }) {
		return () =>
			h(
				"button",
				{
					type: "button",
					"data-test": attrs["data-test"],
					onClick: () => emit("click"),
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

const globalComponents = {
	VDialog: VDialogStub,
	VCard: BoxStub,
	VCardTitle: BoxStub,
	VCardText: BoxStub,
	VCardActions: BoxStub,
	VRow: BoxStub,
	VCol: BoxStub,
	VSpacer: defineComponent({ setup: () => () => h("div") }),
	VForm: VFormStub,
	VTextField: createInputStub("VTextFieldStub"),
	VSelect: createInputStub("VSelectStub"),
	VAutocomplete: createInputStub("VAutocompleteStub"),
	VBtn: VButtonStub,
	VChip: VButtonStub,
};

const mountDialog = (props: Record<string, unknown> = {}) =>
	mount(NewItemDialog, {
		props: {
			modelValue: true,
			itemsGroup: ["ALL", "Products"],
			cameraEnabled: false,
			scannedBarcode: "",
			...props,
		},
		global: {
			components: globalComponents,
			config: {
				globalProperties: {
					__: (value: string) => value,
					frappe: {
						_: (value: string) => value,
					},
				},
			},
		},
	});

describe("NewItemDialog", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = {
			_: (value: string) => value,
			msgprint: vi.fn(),
			show_alert: vi.fn(),
		};
		vi.mocked(itemService.getUOMsData).mockResolvedValue([{ name: "Nos" }]);
		vi.mocked(itemService.createItemData).mockResolvedValue({
			item_code: "ITEM-001",
			item_name: "Item 001",
		} as any);
	});

	it("renders a barcode field", async () => {
		const wrapper = mountDialog();
		await flushPromises();

		expect(wrapper.find('[data-test="new-item-barcode"]').exists()).toBe(true);
	});

	it("shows the camera button only when camera scanning is enabled", async () => {
		const disabledWrapper = mountDialog({ cameraEnabled: false });
		const enabledWrapper = mountDialog({ cameraEnabled: true });
		await flushPromises();

		expect(disabledWrapper.find('[data-test="new-item-camera-scan"]').exists()).toBe(false);
		expect(enabledWrapper.find('[data-test="new-item-camera-scan"]').exists()).toBe(true);
	});

	it("updates the barcode field from scanned barcode props", async () => {
		const wrapper = mountDialog({ cameraEnabled: true, scannedBarcode: "" });
		await flushPromises();

		await wrapper.setProps({ scannedBarcode: "99887766" });
		await nextTick();

		expect(
			(wrapper.get('[data-test="new-item-barcode"]').element as HTMLInputElement).value,
		).toBe("99887766");
	});

	it("submits the entered barcode through item creation", async () => {
		const wrapper = mountDialog();
		await flushPromises();

		await wrapper.get('[data-test="new-item-code"]').setValue("ITEM-001");
		await wrapper.get('[data-test="new-item-name"]').setValue("Item 001");
		await wrapper.get('[data-test="new-item-group"]').setValue("Products");
		await wrapper.get('[data-test="new-item-stock-uom"]').setValue("Nos");
		await wrapper.get('[data-test="new-item-standard-rate"]').setValue("10");
		await wrapper.get('[data-test="new-item-barcode"]').setValue("123456789");

		await wrapper.get('[data-test="new-item-submit"]').trigger("click");
		await flushPromises();

		expect(itemService.createItemData).toHaveBeenCalledWith(
			expect.objectContaining({
				item_code: "ITEM-001",
				item_name: "Item 001",
				barcode: "123456789",
			}),
		);
	});
});

describe("NewItemDialog catalog mode", () => {
	const prefill = {
		barcode: "7501055300075",
		found_in: "central",
		product_name: "Agua natural",
		size: "1 L",
		brand: "Bonafont",
		item_group: "Bebidas",
		stock_uom: "Pieza",
		suggested_sat_keys: [{ key: "50202301", description: "Agua embotellada" }],
		can_create: true,
	};

	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = {
			_: (value: string) => value,
			msgprint: vi.fn(),
			show_alert: vi.fn(),
		};
		vi.mocked(itemService.getUOMsData).mockResolvedValue([{ name: "Nos" }]);
		vi.mocked(itemService.createItemData).mockClear();
		vi.mocked(catalogScanService.createItemFromScan).mockReset();
		vi.mocked(catalogScanService.createItemFromScan).mockResolvedValue({
			ok: true,
			data: { item_code: "7501055300075", item_name: "Agua natural 1 L", created: true },
			error: null,
			requestId: "r",
			serverTime: null,
		});
	});

	const value = (wrapper: any, test: string) =>
		(wrapper.get(`[data-test="${test}"]`).element as HTMLInputElement).value;

	it("pre-fills from the catalog and hides the item code", async () => {
		const wrapper = mountDialog({ prefill, scannedBarcode: prefill.barcode });
		await flushPromises();

		expect(wrapper.find('[data-test="new-item-code"]').exists()).toBe(false);
		expect(value(wrapper, "new-item-name")).toBe("Agua natural 1 L");
		expect(value(wrapper, "new-item-barcode")).toBe("7501055300075");
		expect(value(wrapper, "new-item-brand")).toBe("Bonafont");
		expect(value(wrapper, "new-item-group")).toBe("Bebidas");
		expect(value(wrapper, "new-item-stock-uom")).toBe("Pieza");
		expect(value(wrapper, "new-item-sat-key")).toBe("50202301");
		expect(wrapper.find('[data-test="new-item-opening-qty"]').exists()).toBe(false);
	});

	it("creates through doco and emits the item flagged as from-scan", async () => {
		// Emits are not captured under the prod Vue runtime; listen via props.
		const onItemCreated = vi.fn();
		const wrapper = mountDialog({
			prefill,
			allowOpeningStock: true,
			openingWarehouse: "Tienda - D",
			company: "Doco",
			onItemCreated,
		});
		await flushPromises();

		await wrapper.get('[data-test="new-item-standard-rate"]').setValue("15");
		await wrapper.get('[data-test="new-item-buying-price"]').setValue("9.5");
		await wrapper.get('[data-test="new-item-opening-qty"]').setValue("6");
		await wrapper.get('[data-test="new-item-submit"]').trigger("click");
		await flushPromises();

		expect(itemService.createItemData).not.toHaveBeenCalled();
		expect(catalogScanService.createItemFromScan).toHaveBeenCalledWith(
			expect.objectContaining({
				barcode: "7501055300075",
				item_name: "Agua natural 1 L",
				item_group: "Bebidas",
				stock_uom: "Pieza",
				brand: "Bonafont",
				selling_price: 15,
				buying_price: 9.5,
				mx_product_service_key: "50202301",
				opening_qty: 6,
				warehouse: "Tienda - D",
				company: "Doco",
			}),
		);
		expect(onItemCreated).toHaveBeenCalledTimes(1);
		expect(onItemCreated.mock.calls[0][0]).toMatchObject({ item_code: "7501055300075", _from_scan: true });
	});

	it("keeps the dialog open and reports the server message on failure", async () => {
		vi.mocked(catalogScanService.createItemFromScan).mockResolvedValue({
			ok: false,
			data: null,
			error: { code: "HTTP_ERROR", message: "Not permitted", retryable: false },
			requestId: "r",
			serverTime: null,
		});
		const onItemCreated = vi.fn();
		const wrapper = mountDialog({ prefill, onItemCreated });
		await flushPromises();

		await wrapper.get('[data-test="new-item-submit"]').trigger("click");
		await flushPromises();

		expect(onItemCreated).not.toHaveBeenCalled();
		expect((globalThis as any).frappe.msgprint).toHaveBeenCalledWith(
			expect.stringContaining("Not permitted"),
		);
	});
});
