/**
 * Browser-facing plumbing the floor store leans on: persisted preferences, the
 * device identity that makes socket echoes ignorable, and uid minting.
 *
 * Split out of `floorStore.ts` so the store itself stays about floor state.
 *
 * @module posapp/stores/floor/floorRuntime
 */

export const VIEW_MODE_KEY = "posa_floor_view_mode";
export const ACTIVE_FLOOR_KEY = "posa_floor_active_floor";

export const readLocal = (key: string): string | null => {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

export const writeLocal = (key: string, value: string) => {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		/* private mode / quota — the preference just does not persist */
	}
};

/** UUID where available; the fallback only has to be collision-free per device. */
export const newUid = (prefix = "uid"): string =>
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Stable per-browser id so a device can ignore the echo of its own write
 * (spec §6.3).
 *
 * Re-exported from the offline layer rather than minted here: the id only works
 * if the SAME value also rides the write, and `dispatchOrderMutation` is what
 * stamps it. Two mintings would mean two localStorage writers racing for one
 * key, and a device that fails to recognise its own broadcast — precisely the
 * bug the field exists to prevent.
 */
export { getDeviceIdentifier } from "../../../offline/deviceIdentity";

/** `layout` arrives as a JSON string from some Frappe read paths. */
export const parseLayout = <T>(raw: unknown): T | null => {
	if (!raw) return null;
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}
	return raw as T;
};
