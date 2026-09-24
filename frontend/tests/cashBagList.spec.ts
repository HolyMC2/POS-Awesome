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
		require: (asset: string, ready: () => void) => {
            // Native Frappe's loader determines the handler from the supplied path;
            // it adds its own cache version after that. A query breaks extension detection.
            expect(asset).toBe("/assets/posawesome/js/cash_custody.js");
            ready();
        },
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
it("shows where a moved bag went and files it under Completed and its own queue", async () => {
	const node = list.get_subject_element(
		{
			name: "BAG-4",
			seal: "SOBRANTE23",
			amount: 2211,
			currency: "MXN",
			state: "Transferred",
			purpose: "Takings",
			prepared_by: "cajera@example.test",
			creation: "2026-09-20",
			transfer_account: "Caja fuerte casa - D",
			transferred_by: "dueno@example.test",
		},
		"BAG-4",
	);
	expect(node.textContent).toContain("Moved to the off-site safe · $2211 · Takings");
	expect(node.textContent).toContain("Moved to: Caja fuerte casa - D · dueno@example.test");
	expect(node.textContent).toContain("Never independently verified");
	expect(settings.get_indicator({ state: "Transferred" })).toEqual([
		"Moved to the off-site safe",
		"gray",
		"state,=,Transferred",
	]);
	const buttons = Array.from(document.querySelectorAll("nav button")) as HTMLButtonElement[];
	buttons.find((b) => b.textContent === "Completed")!.click();
	await Promise.resolve();
	expect(filters).toContainEqual(["POS Cash Bag", "state", "in", ["Deposited", "Unpacked", "Transferred"]]);
	buttons.find((b) => b.textContent === "Moved to the off-site safe")!.click();
	await Promise.resolve();
	expect(filters).toContainEqual(["POS Cash Bag", "state", "in", ["Transferred"]]);
});
it("does not mark a verified moved bag as unverified", () => {
	const node = list.get_subject_element(
		{ name: "BAG-5", seal: "S5", amount: 10, state: "Transferred", purpose: "Float", verified_by: "v@example.test", transfer_account: "Casa" },
		"BAG-5",
	);
	expect(node.textContent).not.toContain("Never independently verified");
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
