import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearIndexedDB } from "../src/utils/clearAllCaches";

/**
 * Audit r2 P0 (A1): the Ctrl+Shift+R shortcut and the low-level cache
 * helper could delete `posawesome_offline` — the last local copy of
 * unsynced sales. clearIndexedDB must preserve that transactional DB
 * unless the caller explicitly opts into its deletion.
 */

type DeleteReq = { onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null };

describe("clearIndexedDB transactional guard", () => {
	let deleted: string[];

	beforeEach(() => {
		deleted = [];
		const fake = {
			databases: vi.fn(async () => [
				{ name: "posawesome_offline" },
				{ name: "posawesome-derived-cache" },
			]),
			deleteDatabase: (name: string): DeleteReq => {
				deleted.push(name);
				const req: DeleteReq = { onsuccess: null, onerror: null, onblocked: null };
				// Resolve asynchronously like a real IDBOpenDBRequest.
				Promise.resolve().then(() => req.onsuccess && req.onsuccess());
				return req;
			},
		};
		vi.stubGlobal("indexedDB", fake);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves posawesome_offline by default", async () => {
		await clearIndexedDB();
		expect(deleted).toContain("posawesome-derived-cache");
		expect(deleted).not.toContain("posawesome_offline");
	});

	it("preserves posawesome_offline even when named explicitly", async () => {
		await clearIndexedDB(["posawesome_offline", "posawesome-derived-cache"]);
		expect(deleted).toContain("posawesome-derived-cache");
		expect(deleted).not.toContain("posawesome_offline");
	});

	it("deletes posawesome_offline only when the caller opts in", async () => {
		await clearIndexedDB(["posawesome_offline"], true);
		expect(deleted).toContain("posawesome_offline");
	});
});
