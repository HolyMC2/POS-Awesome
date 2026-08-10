// @vitest-environment jsdom

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

	it("stays on retail-phones when no capability payload is present", () => {
		const vertical = useVerticalStore();
		expect(vertical.profile.name).toBe("retail-phones");
		expect(vertical.layout.dock_tabs).toEqual(["browse", "offers", "cart", "coupons", "pay"]);
	});

	it("resolves a linked preset from the capability payload", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.setCapabilityPayload({
				name: "coffee-quickserve",
				layout: {
					items_view: { default: "card", allow: ["card"] },
					items_panel: "standard",
					cart_style: "table",
					dock_tabs: ["browse", "cart", "pay"],
				},
				capabilities: ["quick_modifiers"],
				version: 1,
			});
		expect(vertical.profile.name).toBe("coffee-quickserve");
		expect(vertical.layout.items_view.default).toBe("card");
		expect(vertical.layout.dock_tabs).toEqual(["browse", "cart", "pay"]);
		expect(vertical.has("quick_modifiers")).toBe(true);
		expect(vertical.has("saldo")).toBe(false);
	});

	it("falls back to retail defaults for fields a sparse preset omits", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.setCapabilityPayload({ name: "sparse", capabilities: ["x"] });
		expect(vertical.profile.name).toBe("sparse");
		// layout omitted entirely → retail defaults
		expect(vertical.layout.dock_tabs).toEqual(["browse", "offers", "cart", "coupons", "pay"]);
		expect(vertical.layout.cart_style).toBe("table");
	});

	it("degrades to retail-phones on a malformed (non-object) payload", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.setCapabilityPayload("not an object" as any);
		expect(vertical.profile.name).toBe("retail-phones");
	});

	it("resolves external-document checkout from the legacy flag", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.posProfile = profileWith({ posa_use_charge_requests: 1 });
		expect(vertical.externalDocumentCheckout).toBe(true);
	});

	it("resolves external-document checkout from the capability", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.setCapabilityPayload({
				name: "taller-repair",
				capabilities: ["external_document_checkout", "repair_intake"],
			});
		expect(vertical.externalDocumentCheckout).toBe(true);
		expect(vertical.has("repair_intake")).toBe(true);
	});

	it("keeps external-document checkout off for plain retail", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.posProfile = profileWith({});
		expect(vertical.externalDocumentCheckout).toBe(false);
	});

	it("t() falls back to the global translator when no preset override", () => {
		const prev = (globalThis as any).__;
		(globalThis as any).__ = (k: string) => (k === "Customer" ? "Cliente" : k);
		(window as any).__ = (globalThis as any).__;
		const vertical = useVerticalStore();
		// No labels loaded → falls through to __()
		expect(vertical.t("Customer")).toBe("Cliente");
		(globalThis as any).__ = prev;
		(window as any).__ = prev;
	});

	it("t() applies a preset's label override", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		ui.setCapabilityPayload({
				name: "restaurant",
				labels: { Customer: "Mesa", Order: "Comanda" },
			});
		expect(vertical.t("Customer")).toBe("Mesa");
		expect(vertical.t("Order")).toBe("Comanda");
		// Unlisted key still falls through
		expect(vertical.t("Pay")).toBe("Pay");
	});

	it("exposes the preset's default print format", () => {
		const ui = useUIStore();
		const vertical = useVerticalStore();
		expect(vertical.printFormat).toBe(null);
		ui.setCapabilityPayload({
				name: "taller-repair",
				print_format: "Repair Ticket 80mm",
			});
		expect(vertical.printFormat).toBe("Repair Ticket 80mm");
	});

	it("role-gates a capability with capability:role syntax", () => {
		const ui = useUIStore();
		(window as any).frappe = { boot: { user: { roles: ["Sales User"] } } };
		const vertical = useVerticalStore();
		ui.setCapabilityPayload({
				name: "restaurant",
				capabilities: ["kitchen_ticket", "void_kitchen_ticket:Restaurant Manager"],
			});
		// plain capability → true for anyone
		expect(vertical.has("kitchen_ticket")).toBe(true);
		// role-gated, user lacks the role → false
		expect(vertical.has("void_kitchen_ticket")).toBe(false);
		// grant the role → true
		(window as any).frappe.boot.user.roles = ["Sales User", "Restaurant Manager"];
		expect(vertical.has("void_kitchen_ticket")).toBe(true);
		delete (window as any).frappe;
	});
});
