import { describe, expect, it, vi } from "vitest";
import type { Page, Route } from "@playwright/test";

// Only the common value assertions are needed; no browser or server runs here.
vi.mock("@playwright/test", async () => ({ expect: (await import("vitest")).expect }));
import { loseFirstAck } from "./e2e/support/registerDrill";

async function fixture(status: number, message: Record<string, unknown>) {
	let handler!: (route: Route) => Promise<unknown>;
	const page = {
		route: vi.fn(async (_url, callback) => { handler = callback; }),
		unroute: vi.fn(),
	};
	const response = { status: () => status, json: async () => ({ message }) };
	const route = {
		request: () => ({ postDataJSON: () => ({ invoice: JSON.stringify({ posa_client_request_id: "inv-fixture" }) }) }),
		fetch: vi.fn(async () => response), fulfill: vi.fn(), abort: vi.fn(), continue: vi.fn(),
	};
	const afterBooked = vi.fn();
	const ack = loseFirstAck(page as unknown as Page, afterBooked);
	await ack.install();
	return { ack, route, afterBooked, response, run: () => handler(route as unknown as Route) };
}

describe("ACK-loss fixture verifies the upstream booking", () => {
	it("passes a server rejection back without pretending its acknowledgment was lost", async () => {
		const f = await fixture(403, {});
		await expect(f.run()).rejects.toThrow("upstream submit must succeed");
		expect(f.route.fulfill).toHaveBeenCalledWith({ response: f.response });
		expect(f.route.abort).not.toHaveBeenCalled();
		expect(f.afterBooked).not.toHaveBeenCalled();
	});

	it("rejects a successful HTTP response that has not submitted an invoice", async () => {
		const f = await fixture(200, { name: "DRAFT", docstatus: 0 });
		await expect(f.run()).rejects.toThrow("upstream must confirm a submitted invoice");
		expect(f.route.abort).not.toHaveBeenCalled();
		expect(f.afterBooked).not.toHaveBeenCalled();
	});

	it("drops only the first confirmed booking and lets later requests through", async () => {
		const f = await fixture(200, { name: "INVOICE", docstatus: 1 });
		await f.run();
		expect(f.afterBooked).toHaveBeenCalledOnce();
		expect(f.route.abort).toHaveBeenCalledWith("connectionreset");
		await f.run();
		expect(f.route.fetch).toHaveBeenCalledOnce();
		expect(f.route.abort).toHaveBeenCalledOnce();
		expect(f.route.continue).toHaveBeenCalledOnce();
		expect(f.ack.seen).toEqual(["inv-fixture", "inv-fixture"]);
	});
});
