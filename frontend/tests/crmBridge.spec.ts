import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The CRM probe gate.
 *
 * One rule, and it is the whole reason this file exists: a register with no
 * CRM must ask ONCE and never again. The floors/tables lesson was a client
 * that kept calling an endpoint which kept refusing; the fix there — and here
 * — is to gate on a capability the server states, not on a request that fails.
 *
 * `api.call` is mocked because what is under test is the CALLING, not the
 * transport: how many times it happens, and on what evidence it stops.
 */

const call = vi.fn();

vi.mock("../src/posapp/services/api", () => ({
	default: { call: (...args: unknown[]) => call(...args) },
}));

const service = await import("../src/posapp/services/crmService");

beforeEach(() => {
	call.mockReset();
	service.resetCrmAvailability();
});

describe("asking whether there is a CRM at all", () => {
	it("asks once on a register that has none, and never again", async () => {
		call.mockResolvedValue({ installed: false });

		expect(await service.fetchCrmContext("CUST-1", "Profile A")).toBeNull();
		expect(await service.fetchCrmContext("CUST-2", "Profile A")).toBeNull();
		expect(await service.fetchCrmContext("CUST-3", "Profile A")).toBeNull();

		expect(call).toHaveBeenCalledTimes(1);
		expect(service.crmIsUnavailable()).toBe(true);
	});

	it("keeps asking per customer where there IS one", async () => {
		call.mockResolvedValue({ installed: true, deals: [], lead: null });

		await service.fetchCrmContext("CUST-1", "Profile A");
		await service.fetchCrmContext("CUST-2", "Profile A");

		expect(call).toHaveBeenCalledTimes(2);
		expect(service.crmIsUnavailable()).toBe(false);
	});

	it("hands back the context when the server says it is installed", async () => {
		call.mockResolvedValue({
			installed: true,
			deals: [{ name: "CRM-DEAL-1", status: "Aprobado", amount: 1900 }],
			lead: null,
		});

		const context = await service.fetchCrmContext("CUST-1", "Profile A");
		expect(context?.deals?.[0]?.status).toBe("Aprobado");
	});
});

describe("a failure is not the same as an absence", () => {
	it("does not mark the app missing because one request threw", async () => {
		// A dead network and a customer-scope refusal both throw, and marking
		// the whole app absent for either would hide a strip that works.
		call.mockRejectedValueOnce(new Error("offline"));
		expect(await service.fetchCrmContext("CUST-1", "Profile A")).toBeNull();
		expect(service.crmIsUnavailable()).toBe(false);

		call.mockResolvedValue({ installed: true, deals: [], lead: null });
		expect(await service.fetchCrmContext("CUST-1", "Profile A")).not.toBeNull();
	});

	it("gives up after three consecutive failures, so it cannot become a loop", async () => {
		call.mockRejectedValue(new Error("offline"));

		await service.fetchCrmContext("CUST-1", "Profile A");
		await service.fetchCrmContext("CUST-2", "Profile A");
		await service.fetchCrmContext("CUST-3", "Profile A");
		await service.fetchCrmContext("CUST-4", "Profile A");

		expect(call).toHaveBeenCalledTimes(3);
		expect(service.crmIsUnavailable()).toBe(true);
	});

	it("forgets the failures as soon as one call succeeds", async () => {
		call.mockRejectedValueOnce(new Error("offline"));
		call.mockRejectedValueOnce(new Error("offline"));
		await service.fetchCrmContext("CUST-1", "Profile A");
		await service.fetchCrmContext("CUST-2", "Profile A");

		call.mockResolvedValue({ installed: true, deals: [], lead: null });
		await service.fetchCrmContext("CUST-3", "Profile A");

		call.mockRejectedValue(new Error("offline"));
		await service.fetchCrmContext("CUST-4", "Profile A");
		expect(service.crmIsUnavailable()).toBe(false);
	});
});

describe("it never asks for nothing", () => {
	it("makes no request without a customer or a profile", async () => {
		expect(await service.fetchCrmContext("", "Profile A")).toBeNull();
		expect(await service.fetchCrmContext("CUST-1", "")).toBeNull();
		expect(call).not.toHaveBeenCalled();
	});
});

describe("asking for a follow-up", () => {
	it("posts the customer and the profile the server scopes on", async () => {
		call.mockResolvedValue({ action: "created", doctype: "CRM Task", name: "T-1" });

		await service.createSeguimiento("CUST-1", "Profile A", { note: "Quiere cotización" });

		expect(call).toHaveBeenCalledWith(
			"posawesome.posawesome.api.crm_bridge.create_seguimiento",
			{ customer: "CUST-1", pos_profile: "Profile A", note: "Quiere cotización" },
		);
	});

	it("does NOT go through the availability gate", async () => {
		// It is a deliberate act on a strip that is only on screen because the
		// probe already said yes. Gating it again would mean a cashier pressing
		// a visible button and nothing happening.
		call.mockResolvedValue({ installed: false });
		await service.fetchCrmContext("CUST-1", "Profile A");
		expect(service.crmIsUnavailable()).toBe(true);

		call.mockResolvedValue({ action: "created", doctype: "CRM Lead", name: "L-1" });
		await expect(service.createSeguimiento("CUST-1", "Profile A")).resolves.toMatchObject({
			action: "created",
		});
	});
});
