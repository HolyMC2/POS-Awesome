// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { checkStoragePersistence, storagePersistenceStatus } from "../src/offline/storagePersistence";

describe("browser storage persistence", () => {
	it("checks an existing grant without requesting it again", async () => {
		const persist = vi.fn();
		Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: async () => true, persist } });
		expect(await checkStoragePersistence(true)).toBe("persistent");
		expect(persist).not.toHaveBeenCalled();
	});
	it("reports denial honestly and allows a later successful retry", async () => {
		const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: async () => false, persist } });
		expect(await checkStoragePersistence(true)).toBe("denied");
		expect(storagePersistenceStatus.value).toBe("denied");
		expect(await checkStoragePersistence(true)).toBe("persistent");
	});
	it("handles unsupported browsers and failures without throwing", async () => {
		Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
		expect(await checkStoragePersistence(true)).toBe("unsupported");
		Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: async () => { throw new Error("blocked"); } } });
		expect(await checkStoragePersistence(true)).toBe("error");
	});
});
