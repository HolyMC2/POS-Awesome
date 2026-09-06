import { ref } from "vue";

export type StoragePersistenceStatus =
	"unknown" | "checking" | "persistent" | "best_effort" | "denied" | "unsupported" | "error";

export const storagePersistenceStatus = ref<StoragePersistenceStatus>("unknown");
let inFlight: Promise<StoragePersistenceStatus> | null = null;

/** Persistence reduces automatic eviction; it never replaces an acknowledged IDB write. */
export function checkStoragePersistence(request = false): Promise<StoragePersistenceStatus> {
	if (inFlight) return inFlight;
	storagePersistenceStatus.value = "checking";
	inFlight = (async (): Promise<StoragePersistenceStatus> => {
		try {
			const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
			if (typeof storage?.persisted !== "function") return "unsupported";
			if (await storage.persisted()) return "persistent";
			if (!request) return "best_effort";
			if (typeof storage.persist !== "function") return "unsupported";
			return await storage.persist() ? "persistent" : "denied";
		} catch {
			return "error";
		}
	})().then((status) => {
		storagePersistenceStatus.value = status;
		return status;
	}).finally(() => { inFlight = null; });
	return inFlight;
}
