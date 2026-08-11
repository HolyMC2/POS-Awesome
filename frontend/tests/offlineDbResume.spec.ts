// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	db,
	ensureOfflineDbOpen,
	initPromise,
	isOfflineDbConnectionClosed,
	isOfflineStorageDegraded,
	quickDbHealthCheck,
	setOfflineDbConnectionClosedForTests,
	setOfflineStorageDegraded,
} from "../src/offline/db";

describe("offline DB resume", () => {
	beforeEach(async () => {
		vi.useRealTimers();
		await initPromise;
		setOfflineDbConnectionClosedForTests(false);
		setOfflineStorageDegraded(false);
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		setOfflineDbConnectionClosedForTests(false);
		setOfflineStorageDegraded(false);
		if (!db.isOpen()) {
			await db.open();
		}
	});

	it("is a cheap no-op while the connection is healthy", async () => {
		const result = await ensureOfflineDbOpen();

		expect(result).toEqual({ ok: true, reopened: false });
		expect(db.isOpen()).toBe(true);
	});

	it("reopens a connection the browser closed under us", async () => {
		await db.table("keyval").put({ key: "resume_probe", value: 1 });
		db.close();

		const result = await ensureOfflineDbOpen();

		expect(result.ok).toBe(true);
		expect(result.reopened).toBe(true);
		expect(db.isOpen()).toBe(true);
		const row = await db.table("keyval").get("resume_probe");
		expect(row?.value).toBe(1);
	});

	it("reopens when only the close latch is set — db.isOpen() lies after an unexpected close", async () => {
		// This is the prod shape: Dexie fires `close`, keeps `idbdb`, and every
		// `if (!db.isOpen())` guard in the layer stays blind to the dead handle.
		setOfflineDbConnectionClosedForTests(true);
		expect(db.isOpen()).toBe(true);
		expect(isOfflineDbConnectionClosed()).toBe(true);

		const result = await ensureOfflineDbOpen();

		expect(result.reopened).toBe(true);
		expect(isOfflineDbConnectionClosed()).toBe(false);
		await expect(db.table("keyval").get("missing_key")).resolves.toBeUndefined();
	});

	it("clears the degraded flag once the store is back", async () => {
		setOfflineStorageDegraded(true);
		setOfflineDbConnectionClosedForTests(true);

		await ensureOfflineDbOpen();

		expect(isOfflineStorageDegraded()).toBe(false);
	});

	it("makes the health check honour the close latch", async () => {
		setOfflineDbConnectionClosedForTests(true);

		await expect(quickDbHealthCheck()).resolves.toBe(true);
		expect(isOfflineDbConnectionClosed()).toBe(false);
	});
});
