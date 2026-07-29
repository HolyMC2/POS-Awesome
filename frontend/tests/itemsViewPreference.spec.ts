// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
	loadItemSelectorSettings,
	loadItemsViewPreference,
	saveItemSelectorSettings,
	saveItemsViewPreference,
} from "../src/posapp/utils/itemSelectorSettings";

const SETTINGS_KEY = "posawesome_item_selector_settings";

describe("items view preference", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns null when nothing has been chosen yet, so the caller keeps its default", () => {
		expect(loadItemsViewPreference()).toBeNull();
	});

	it("round-trips the card choice", () => {
		expect(saveItemsViewPreference("card")).toBe(true);
		expect(loadItemsViewPreference()).toBe("card");
	});

	it("round-trips the list choice", () => {
		saveItemsViewPreference("card");
		saveItemsViewPreference("list");

		expect(loadItemsViewPreference()).toBe("list");
	});

	it("refuses to store anything that is not a known view", () => {
		expect(saveItemsViewPreference("grid")).toBe(false);
		expect(saveItemsViewPreference(undefined)).toBe(false);
		expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
	});

	it("ignores a stored value that is not a known view", () => {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify({ display_mode: "mosaic" }));

		expect(loadItemsViewPreference()).toBeNull();
	});

	it("survives corrupt storage instead of throwing into the render", () => {
		localStorage.setItem(SETTINGS_KEY, "{not json");

		expect(loadItemsViewPreference()).toBeNull();
	});
});

describe("item selector settings merge", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("keeps the view preference when the settings dialog saves its own keys", () => {
		saveItemsViewPreference("card");

		// What ItemSettingsDialog writes — a blob with no display_mode in it.
		saveItemSelectorSettings({
			new_line: true,
			hide_qty_decimals: false,
			items_per_page: 50,
		});

		expect(loadItemsViewPreference()).toBe("card");
		expect(loadItemSelectorSettings()?.items_per_page).toBe(50);
	});

	it("keeps the dialog's settings when the view preference changes", () => {
		saveItemSelectorSettings({ items_per_page: 200, new_line: true });
		saveItemsViewPreference("list");

		const saved = loadItemSelectorSettings();
		expect(saved?.items_per_page).toBe(200);
		expect(saved?.new_line).toBe(true);
		expect(saved?.display_mode).toBe("list");
	});

	it("still overwrites a key the caller does own", () => {
		saveItemSelectorSettings({ items_per_page: 50 });
		saveItemSelectorSettings({ items_per_page: 200 });

		expect(loadItemSelectorSettings()?.items_per_page).toBe(200);
	});
});
