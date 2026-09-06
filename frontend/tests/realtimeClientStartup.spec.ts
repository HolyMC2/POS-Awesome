// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import template from "../../posawesome/www/posapp.html?raw";

describe("realtime does not block register startup", () => {
	let onlineListeners: EventListener[];
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		document.head.innerHTML = "";
		delete (window as any).io;
		onlineListeners = [];
		const addEventListener = window.addEventListener.bind(window);
		vi.spyOn(window, "addEventListener").mockImplementation((event, handler, options) => {
			if (event === "online") onlineListeners.push(handler as EventListener);
			addEventListener(event, handler, options);
		});
	});
	afterEach(() => {
		for (const listener of onlineListeners) window.removeEventListener("online", listener);
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		delete (window as any).io;
	});

	function installFactory() {
		const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
		const factory = vi.fn((_url: string, _options: Record<string, unknown>) => socket);
		(window as any).io = factory;
		return { socket, factory };
	}

	it("keeps the noncritical socket script out of the module execution queue", () => {
		expect(template).not.toMatch(/<script[^>]+src=["']\/socket\.io/);
	});

	it("loads one async client, creates one socket, and attaches each pending callback once", async () => {
		const { makeRealtime } = await import("../src/posapp/utils/realtime-client");
		const realtime = makeRealtime();
		const first = vi.fn();
		const second = vi.fn();
		realtime.on("stock", first);
		realtime.on("stock", first);
		realtime.on("invoice", second);
		realtime.emit("join", "invoice-1");
		const scripts = document.head.querySelectorAll("script");
		expect(scripts).toHaveLength(1);
		expect(scripts[0].async).toBe(true);
		expect(realtime.socket).toBeNull();
		const { factory, socket } = installFactory();
		scripts[0].dispatchEvent(new Event("load"));
		await vi.advanceTimersByTimeAsync(0);
		expect(factory).toHaveBeenCalledOnce();
		expect(socket.on.mock.calls.filter(([event]) => event === "stock")).toEqual([["stock", first]]);
		expect(socket.on.mock.calls.filter(([event]) => event === "invoice")).toEqual([["invoice", second]]);
		expect(socket.emit).toHaveBeenCalledWith("join", "invoice-1");
		expect(factory.mock.calls[0][1]).not.toHaveProperty("reconnectionAttempts");
	});

	it("does not resurrect handlers removed while the client is loading", async () => {
		const { makeRealtime } = await import("../src/posapp/utils/realtime-client");
		const realtime = makeRealtime();
		const callback = vi.fn();
		realtime.on("invoice", callback);
		realtime.off("invoice", callback);
		const { socket } = installFactory();
		document.head.querySelector("script")!.dispatchEvent(new Event("load"));
		await vi.advanceTimersByTimeAsync(0);
		expect(socket.on).not.toHaveBeenCalledWith("invoice", callback);
		realtime.on("invoice", callback);
		realtime.on("invoice", callback);
		expect(socket.on.mock.calls.filter(([event]) => event === "invoice")).toHaveLength(1);
	});

	it("retries a failed client download without reloading the register", async () => {
		const { makeRealtime } = await import("../src/posapp/utils/realtime-client");
		const realtime = makeRealtime();
		const callback = vi.fn();
		realtime.on("stock", callback);
		document.head.querySelector("script")!.dispatchEvent(new Event("error"));
		await vi.advanceTimersByTimeAsync(0);
		realtime.on("another-event", vi.fn());
		expect(document.head.querySelector("script")).toBeNull();
		await vi.advanceTimersByTimeAsync(1000);
		const retry = document.head.querySelector("script");
		expect(retry).not.toBeNull();
		const { socket, factory } = installFactory();
		retry!.dispatchEvent(new Event("load"));
		await vi.advanceTimersByTimeAsync(0);
		expect(factory).toHaveBeenCalledOnce();
		expect(socket.on).toHaveBeenCalledWith("stock", callback);
	});

	it("bounds stalled client loading and recovers on a later attempt", async () => {
		const { loadRealtimeClient } = await import("../src/posapp/utils/realtime-client");
		const pending = loadRealtimeClient();
		await vi.advanceTimersByTimeAsync(15000);
		await expect(pending).resolves.toBeNull();
		expect(document.head.querySelector("script")).toBeNull();
		const retry = loadRealtimeClient();
		const { factory } = installFactory();
		document.head.querySelector("script")!.dispatchEvent(new Event("load"));
		await expect(retry).resolves.toBe(factory);
	});
});
