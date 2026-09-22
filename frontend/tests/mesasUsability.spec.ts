// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

const table = { name: "table-12", table_label: "12", seats: 4, floor: "salon" };
const orders = [
	{
		order_uid: "order-a",
		tab_name: "Sofía Hernández",
		total: 120,
		items_count: 2,
		unsent_count: 1,
	},
];
const tables = [table, { ...table, name: "table-dirty", table_label: "Patio", needs_cleaning: 1 },
	{ ...table, name: "table-terrace", floor: "terrace" },
	{ ...table, name: "table-disabled", is_active: 0 }];
vi.mock("../src/posapp/stores/floorStore", () => ({
	useFloorStore: () => ({
		activeFloorTables: tables.slice(0, 2),
		tables,
		floors: [{ name: "salon", floor_name: "Salón" }, { name: "terrace", floor_name: "Terraza" }],
		ordersForTable: (name: string) => (name === table.name ? orders : []),
		unsentCountForTable: () => 1,
		transferOrder: null,
	}),
}));
vi.mock("../src/posapp/stores/verticalStore", () => ({
	useVerticalStore: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${value}` }),
}));
import JumpPad from "../src/posapp/components/floor/JumpPad.vue";
import FloorKanban from "../src/posapp/components/floor/FloorKanban.vue";

const PassThrough = defineComponent({
	setup(_, { slots }) {
		return () => h("div", slots.default?.());
	},
});
const global = {
	components: Object.fromEntries(
		[
			"VDialog",
			"VCard",
			"VCardTitle",
			"VCardText",
			"VCardActions",
			"VBtn",
			"VIcon",
			"VSpacer",
		].map((name) => [name, PassThrough]),
	),
};
beforeEach(() => vi.stubGlobal("__", (text: string) => text));

describe("named accounts", () => {
	it("creates a named account even when its name matches a table number", async () => {
		const onOpenTab = vi.fn(),
			onOpenTable = vi.fn();
		const wrapper = mount(JumpPad, {
			global,
			props: { modelValue: true, mode: "tab", onOpenTab, onOpenTable },
		});
		await wrapper.find("input").setValue("12");
		await wrapper.find("input").trigger("keydown", { key: "Enter" });
		expect(onOpenTab).toHaveBeenCalledWith("12");
		expect(onOpenTable).not.toHaveBeenCalled();
		wrapper.unmount();
	});
	it("ignores an empty name and trims a real name", async () => {
		const onOpenTab = vi.fn();
		const wrapper = mount(JumpPad, {
			global,
			props: { modelValue: true, mode: "tab", onOpenTab },
		});
		await wrapper.find("input").setValue("  ");
		await wrapper.find("input").trigger("keydown", { key: "Enter" });
		expect(onOpenTab).not.toHaveBeenCalled();
		await wrapper.find("input").setValue(" Sofía 12 ");
		await wrapper.find("input").trigger("keydown", { key: "Enter" });
		expect(onOpenTab).toHaveBeenCalledWith("Sofía 12");
		wrapper.unmount();
	});
});

describe("finding tables", () => {
	it("finds an accented account name and hands back its actual table", async () => {
		const onOpen = vi.fn();
		const wrapper = mount(FloorKanban, { global, props: { onOpen } });
		await wrapper.find("input").setValue("sofia");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(1);
		await wrapper.find(".floor-kanban__card").trigger("click");
		expect(onOpen).toHaveBeenCalledWith(table);
		wrapper.unmount();
	});
	it("searches other floors, names the location, and excludes inactive tables", async () => {
		const onOpen = vi.fn();
		const wrapper = mount(FloorKanban, { global, props: { onOpen } });
		await wrapper.find("input").setValue("terraza");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(1);
		expect(wrapper.find(".floor-kanban__card").text()).toContain("Terraza");
		await wrapper.find(".floor-kanban__card").trigger("click");
		expect(onOpen).toHaveBeenCalledWith(tables[2]);
		await wrapper.find("input").setValue("12");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(2);
		wrapper.unmount();
	});
	it("names the party on the card and marks the selected table", () => {
		const wrapper = mount(FloorKanban, { global, props: { selectedTable: table.name } });
		const card = wrapper.find('[data-test="kanban-card-12"]');
		expect(card.text()).toContain("Sofía Hernández");
		expect(card.attributes("aria-pressed")).toBe("true");
		wrapper.unmount();
	});
	it("filters cleaning tables and recovers from a search with no results", async () => {
		const wrapper = mount(FloorKanban, { global });
		await wrapper
			.find('[data-test="floor-filter-cleaning"]')
			.trigger("click");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(1);
		expect(wrapper.find(".floor-kanban__card").text()).toContain("Patio");
		await wrapper.find("input").setValue("missing");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(0);
		await wrapper.find(".floor-kanban__no-results button").trigger("click");
		expect(wrapper.findAll(".floor-kanban__card")).toHaveLength(2);
		wrapper.unmount();
	});
});
