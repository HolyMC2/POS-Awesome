import { describe, expect, it, vi } from "vitest";
import { fetchAllSyncPages } from "../src/offline/sync/pagination";

describe("bounded offline sync pagination", () => {
	it("drains >200 equal/out-of-order timestamps before exposing the watermark", async () => {
		const rows = Array.from({ length: 405 }, (_, index) => ({
			key: `item::${index}`,
			modified: index < 200 ? "2026-09-06 10:00:00" : "2026-09-06 09:00:00",
			data: { item_code: String(index) },
		}));
		const fetcher = vi.fn(async (cursor: string | null) => {
			const offset = Number(cursor || 0);
			return {
				changes: rows.slice(offset, offset + 200),
				deleted: offset === 400 ? [{ key: "item::removed" }] : [],
				has_more: offset < 400,
				next_cursor: offset < 400 ? String(offset + 200) : null,
				next_watermark: offset < 400 ? "old" : "2026-09-06 11:00:00",
			};
		});
		const response = await fetchAllSyncPages(fetcher);
		expect(response.changes).toEqual(rows);
		expect(response.deleted).toEqual([{ key: "item::removed" }]);
		expect(response.next_watermark).toBe("2026-09-06 11:00:00");
		expect(fetcher.mock.calls.map(([cursor]) => cursor)).toEqual([null, "200", "400"]);
	});

	it("rejects a failed later page instead of returning a partial success", async () => {
		const fetcher = vi.fn().mockResolvedValueOnce({ changes: [{ key: "A" }], has_more: true, next_cursor: "page2" })
			.mockRejectedValueOnce(new Error("offline"));
		await expect(fetchAllSyncPages(fetcher)).rejects.toThrow("offline");
	});

	it("fails explicitly before a complete catalog can exceed the device buffer limit", async () => {
		await expect(fetchAllSyncPages(async () => ({ changes: Array.from({ length: 50_001 }, () => ({ key: "A" })) })))
			.rejects.toThrow("50,000-record device limit");
	});

	it.each([null, "same"])("rejects a missing or stalled cursor (%s)", async (next) => {
		await expect(fetchAllSyncPages(async () => ({ has_more: true, next_cursor: next })))
			.rejects.toThrow("did not advance");
	});
});
