import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useUIStore } from "../src/posapp/stores/uiStore";

describe("uiStore parked orders", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	it("keeps parked orders cached when drafts are opened", () => {
		const store = useUIStore();
		const drafts = [
			{ name: "ACC-SINV-0001", customer_name: "Walk-in Customer" },
			{ name: "ACC-SINV-0002", customer_name: "Acme Store" },
		];

		store.openDrafts(drafts);

		expect(store.draftsDialog).toBe(true);
		expect(store.draftsData).toEqual(drafts);
		expect(store.parkedOrders).toEqual(drafts);
		expect(store.parkedOrdersCount).toBe(2);
		expect(store.hasParkedOrders).toBe(true);
	});

	it("can update parked orders without forcing the drafts dialog open", () => {
		const store = useUIStore();
		const drafts = [{ name: "ACC-SINV-0003" }];

		store.setParkedOrders(drafts);

		expect(store.draftsDialog).toBe(false);
		expect(store.parkedOrders).toEqual(drafts);
		expect(store.parkedOrdersCount).toBe(1);
	});

	it("can cache drafts data without opening the legacy drafts dialog", () => {
		const store = useUIStore();
		const drafts = [{ name: "ACC-SINV-0004" }];

		store.setDraftsData(drafts);

		expect(store.draftsDialog).toBe(false);
		expect(store.draftsData).toEqual(drafts);
		expect(store.parkedOrders).toEqual([]);
	});

	it("can open invoice management directly on the drafts tab", () => {
		const store = useUIStore();

		store.openInvoiceManagement("drafts");

		expect(store.invoiceManagementDialog).toBe(true);
		expect(store.invoiceManagementTargetTab).toBe("drafts");
	});

	it("can preserve the selected drafts source when invoice management opens", () => {
		const store = useUIStore();

		store.openInvoiceManagement("drafts", "quote");

		expect(store.invoiceManagementDialog).toBe(true);
		expect(store.invoiceManagementTargetTab).toBe("drafts");
		expect(store.invoiceManagementDraftSource).toBe("quote");
	});
});

// setRegisterData is the only production write path for the capability
// payload (the opening data carries it as a sibling — plan C7), so its
// presence-check semantics decide whether a preset can ever be cleared.
describe("uiStore capability payload", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
	});

	const opening = { pos_profile: { name: "P1" } as any, pos_opening_shift: { name: "S1" } };

	it("stores a payload the opening carries", () => {
		const store = useUIStore();

		store.setRegisterData({ ...opening, capability_profile: { name: "cafe" } });

		expect(store.capabilityPayload).toEqual({ name: "cafe" });
	});

	it("CLEARS a prior preset when the opening carries an explicit null", () => {
		const store = useUIStore();
		store.setRegisterData({ ...opening, capability_profile: { name: "cafe" } });

		// Register moved off the preset — leaving the old one in place would
		// keep the counter in a vertical the profile no longer names.
		store.setRegisterData({ ...opening, capability_profile: null });

		expect(store.capabilityPayload).toBe(null);
	});

	it("KEEPS the prior preset when the key is absent entirely", () => {
		const store = useUIStore();
		store.setRegisterData({ ...opening, capability_profile: { name: "cafe" } });

		// A partial register update (older server, or a payload-free path)
		// must not blank a resolved preset.
		store.setRegisterData(opening);

		expect(store.capabilityPayload).toEqual({ name: "cafe" });
	});

	it("replaces the prior preset when a new one arrives", () => {
		const store = useUIStore();
		store.setRegisterData({ ...opening, capability_profile: { name: "cafe" } });

		store.setRegisterData({ ...opening, capability_profile: { name: "taller-repair" } });

		expect(store.capabilityPayload).toEqual({ name: "taller-repair" });
	});
});
