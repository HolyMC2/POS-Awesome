// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import SOURCE from "../../posawesome/posawesome/doctype/pos_cash_bag/pos_cash_bag_list.js?raw";
let settings: any, list: any, printBags: any, filters: any[];
beforeEach(() => {
	document.body.replaceChildren();
	const escape = (value: string) => {
		const span = document.createElement("span");
		span.textContent = value;
		return span.innerHTML;
	};
	const frappe: any = {
		listview_settings: {},
		user_info: () => null,
		utils: { escape_html: escape },
		datetime: { str_to_user: (v: string) => v },
		require: (_: string, ready: () => void) => ready(),
		msgprint: vi.fn(),
	};
	printBags = vi.fn();
	(window as any).posaCashCustody = { printBags };
	(window as any).format_currency = (v: number) => "$" + v;
	new Function("frappe", "__", SOURCE)(frappe, (s: string) => s);
	settings = frappe.listview_settings["POS Cash Bag"];
	filters = [
		["POS Cash Bag", "safe", "=", "SAFE-1"],
		["POS Cash Bag", "state", "in", ["Unverified"]],
	];
	list = {
		settings,
		list_view_settings: {},
		page: { main: { addClass: vi.fn() }, add_actions_menu_item: vi.fn() },
		$result: { before: (node: HTMLElement) => document.body.append(node) },
		filter_area: {
			get: () => filters,
			remove: (field: string) => {
				filters = filters.filter((f) => f[1] !== field);
			},
			add: async (rows: any[]) => {
				filters.push(...rows);
			},
		},
		refresh: vi.fn(),
		get_checked_items: () => [{ name: "BAG-1" }, { name: "BAG-2" }],
		get_subject_element: (_doc: any, title: string) => {
			const node = document.createElement("div");
			const parent = document.createElement("span"),
				link = document.createElement("a");
			link.textContent = title;
			parent.append(link);
			node.append(parent);
			return node;
		},
	};
	settings.onload(list);
});
it("renders bag details as text and a native HTML column, including email-only users", () => {
	const node = list.get_subject_element(
		{
			name: "BAG-1",
			seal: "<img src=x onerror=alert(1)>",
			amount: 1000,
			currency: "MXN",
			state: "Unverified",
			purpose: "Float",
			prepared_by: "worker@example.test",
			creation: "2026-09-23",
		},
		"BAG-1",
	);
	expect(node.querySelector("img")).toBeNull();
	expect(node.textContent).toContain("Awaiting verification · $1000 · Float");
	expect(node.textContent).toContain("worker@example.test");
	const column = document.createElement("template");
	column.innerHTML = settings.formatters.prepared_by("worker@example.test");
	expect(column.content.firstElementChild?.textContent).toBe(
		"worker@example.test",
	);
	expect(list.list_view_settings.disable_scrolling).toBe(true);
});
it("changes only the state queue, preserving safe scope, and prints selected IDs", async () => {
	const buttons = Array.from(document.querySelectorAll("nav button"));
	(
		buttons.find(
			(b) => b.textContent === "Available in the safe",
		) as HTMLButtonElement
	).click();
	await Promise.resolve();
	expect(filters).toEqual([
		["POS Cash Bag", "safe", "=", "SAFE-1"],
		["POS Cash Bag", "state", "in", ["Available"]],
	]);
	(
		buttons.find((b) => b.textContent === "All bags") as HTMLButtonElement
	).click();
	await Promise.resolve();
	expect(filters).toEqual([["POS Cash Bag", "safe", "=", "SAFE-1"]]);
	list.page.add_actions_menu_item.mock.calls[0][1]();
	expect(printBags).toHaveBeenCalledWith(["BAG-1", "BAG-2"]);
});
