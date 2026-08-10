import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useVerticalStore } from "../src/posapp/stores/verticalStore";
import { useUIStore } from "../src/posapp/stores/uiStore";
import type { POSProfile } from "../src/posapp/types/models";

const profileWith = (fields: Record<string, unknown>): POSProfile =>
	({
		name: "Test Profile",
		company: "Doco",
		currency: "MXN",
		warehouse: "W",
		selling_price_list: "Standard Selling",
		income_account: "I",
		expense_account: "E",
		...fields,
	}) as POSProfile;

describe("verticalStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("answers has() from the retail-phones preset", () => {
		const vertical = useVerticalStore();
		expect(vertical.profile.name).toBe("retail-phones");
		expect(vertical.has("saldo")).toBe(true);
		expect(vertical.has("offers")).toBe(true);
		expect(vertical.has("kitchen_ticket")).toBe(false);
	});

	it("resolves layout defaults with no profile loaded", () => {
		const vertical = useVerticalStore();
		expect(vertical.layout.items_view.default).toBe("list");
		expect(vertical.layout.items_view.allow).toContain("card");
		expect(vertical.leanVerticalLayout).toBe(false);
	});

	it("keeps lean layout off when the flag is absent or falsy", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.posProfile = profileWith({});
		expect(vertical.leanVerticalLayout).toBe(false);
		ui.posProfile = profileWith({ posa_lean_vertical_layout: 0 });
		expect(vertical.leanVerticalLayout).toBe(false);
	});

	it("turns lean layout on from the POS Profile flag", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.posProfile = profileWith({ posa_lean_vertical_layout: 1 });
		expect(vertical.leanVerticalLayout).toBe(true);
		expect(vertical.layout.lean_vertical).toBe(true);
	});
});
