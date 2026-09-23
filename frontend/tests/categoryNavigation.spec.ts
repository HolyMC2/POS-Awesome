// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { defineComponent, nextTick } from "vue";
import MobileBrowseScreen from "../src/posapp/components/pos/mobile/browse/MobileBrowseScreen.vue";
import ItemSettingsDialog from "../src/posapp/components/pos/items/ItemSettingsDialog.vue";
import { categoryChoices } from "../src/posapp/composables/pos/items/useCategoryNavigation";
import { saveItemSelectorSettings } from "../src/posapp/utils/itemSelectorSettings";
import { useItemsSelectorSettings } from "../src/posapp/composables/pos/items/useItemsSelectorSettings";

const wrappers: ReturnType<typeof mount>[] = [];
const setTouch = (touch: boolean) =>
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: touch,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
beforeEach(() => {
	localStorage.clear();
	setTouch(true);
});
afterEach(() => {
	wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
	vi.unstubAllGlobals();
});
function browse(overrides = {}) {
	const select = vi.fn();
	const wrapper = mount(MobileBrowseScreen, {
		props: {
			items: [
				{
					item_code: "CASE",
					item_name: "Case",
					item_group: "Fundas",
					rate: 100,
				},
			],
			itemGroups: ["ALL", "Fundas", "Audio"],
			formatCurrency: String,
			onSelectGroup: select,
			...overrides,
		},
		global: { plugins: [createVuetify()] },
	});
	wrappers.push(wrapper);
	return { wrapper, select };
}

describe("category navigation", () => {
	it("uses the complete category list and loads a category absent from the product page", async () => {
		const { wrapper, select } = browse();
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			true,
		);
		await wrapper.get('[data-category="Audio"]').trigger("click");
		expect(select).toHaveBeenCalledWith("Audio");
		await wrapper.setProps({
			itemGroup: "Audio",
			items: [
				{
					item_code: "SPEAKER",
					item_name: "Speaker",
					item_group: "Audio",
					rate: 20,
				},
			],
		});
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			false,
		);
		expect(wrapper.text()).toContain("Speaker");
		await wrapper
			.findAll("button")
			.find((button) => button.text().includes("All categories"))!
			.trigger("click");
		expect(select).toHaveBeenLastCalledWith("ALL");
		await wrapper.setProps({ itemGroup: "ALL" });
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			true,
		);
	});
	it("shows products immediately for search and barcode-first profiles", () => {
		expect(
			browse({ query: "CASE" })
				.wrapper.find('[data-testid="category-tiles"]')
				.exists(),
		).toBe(false);
		expect(
			browse({ barcodeFirst: true })
				.wrapper.find('[data-testid="category-tiles"]')
				.exists(),
		).toBe(false);
	});
	it("allows all products without changing the stored starting preference", async () => {
		const { wrapper } = browse();
		await wrapper
			.findAll("button")
			.find((button) => button.text() === "All products")!
			.trigger("click");
		expect(wrapper.find('[data-testid="browse-grid"]').exists()).toBe(true);
		expect(
			localStorage.getItem("posawesome_item_selector_settings"),
		).toBeNull();
	});
	it("defaults to products on desktop and applies saved changes to mounted catalogues", async () => {
		setTouch(false);
		const { wrapper } = browse();
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			false,
		);
		saveItemSelectorSettings({ category_navigation: "categories" });
		await nextTick();
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			true,
		);
		saveItemSelectorSettings({ category_navigation: "products" });
		await nextTick();
		expect(wrapper.find('[data-testid="category-tiles"]').exists()).toBe(
			false,
		);
	});
	it("restores a saved preference on remount and ignores invalid values", () => {
		saveItemSelectorSettings({ category_navigation: "products" });
		expect(
			browse().wrapper.find('[data-testid="category-tiles"]').exists(),
		).toBe(false);
		expect(
			categoryChoices(["ALL", "Fundas", "Fundas", "", "Audio"]),
		).toEqual([
			{ id: "Fundas", label: "Fundas" },
			{ id: "Audio", label: "Audio" },
		]);
	});
});

describe("catalogue settings", () => {
	it("initializes an already-open dialog and stages display changes until Save", async () => {
		const saved = vi.fn();
		const view = vi.fn();
		const wrapper = mount(ItemSettingsDialog, {
			props: {
				modelValue: true,
				itemsView: "card",
				initialSettings: {
					category_navigation: "products",
					hide_qty_decimals: true,
				},
				onSave: saved,
				"onUpdate:itemsView": view,
			},
			global: {
				components: {
					VDialog: { template: "<div><slot /></div>" },
					VRadioGroup: defineComponent({
						name: "VRadioGroup",
						props: ["modelValue"],
						template: "<div><slot /></div>",
					}),
					VBtnToggle: defineComponent({
						name: "VBtnToggle",
						props: ["modelValue"],
						template: "<div><slot /></div>",
					}),
					VBtn: { template: "<button><slot /></button>" },
				},
			},
		});
		wrappers.push(wrapper);
		expect(
			wrapper.findComponent({ name: "VRadioGroup" }).props("modelValue"),
		).toBe("products");
		wrapper
			.findComponent({ name: "VBtnToggle" })
			.vm.$emit("update:modelValue", "list");
		expect(view).not.toHaveBeenCalled();
		await wrapper
			.findAll("button")
			.find((button) => button.text() === "Cancel")!
			.trigger("click");
		expect(saved).not.toHaveBeenCalled();
		expect(view).not.toHaveBeenCalled();
		await wrapper.setProps({ modelValue: false });
		await wrapper.setProps({ modelValue: true });
		expect(
			wrapper.findComponent({ name: "VBtnToggle" }).props("modelValue"),
		).toBe("card");
		await wrapper
			.findAll("button")
			.find((button) => button.text() === "Save Settings")!
			.trigger("click");
		expect(saved).toHaveBeenCalledWith(
			expect.objectContaining({
				category_navigation: "products",
				hide_qty_decimals: true,
			}),
		);
		expect(view).toHaveBeenCalledWith("card");
	});
	it("saving display preferences never writes a shared POS Profile", () => {
		const write = vi.fn();
		vi.stubGlobal("frappe", { db: { set_value: write } });
		const vm = {
			localStorageAvailable: true,
			pos_profile: { name: "Retail", posa_force_server_items: 1 },
			clearLastInvoiceRateCache: vi.fn(),
			scheduleLastInvoiceRateRefresh: vi.fn(),
		};
		useItemsSelectorSettings({
			getVM: () => vm,
			itemSync: { startBackgroundSyncScheduler: vi.fn() },
		}).applyItemSettings({ category_navigation: "categories" });
		expect(write).not.toHaveBeenCalled();
		expect(vm.pos_profile.posa_force_server_items).toBe(1);
		expect(
			JSON.parse(
				localStorage.getItem("posawesome_item_selector_settings")!,
			).category_navigation,
		).toBe("categories");
	});
});
