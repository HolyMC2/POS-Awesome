/**
 * Stable per-browser device id, used to suppress a device's own realtime echo.
 *
 * The floor subscribes to `posa_floor_update` on the floor's doc room and
 * ignores events whose `source_device` matches its own id (spec §6.3, §6.7).
 * That only works if the id also rides the WRITE, so the server has something
 * to echo — hence this lives in the offline layer, where `dispatchOrderMutation`
 * stamps every mutation with it.
 *
 * ONE localStorage key, shared with the floor store's `getDeviceIdentifier()`
 * (which re-exports this): two keys would mean a device failing to recognise
 * its own broadcasts, which is exactly the bug the field exists to prevent.
 *
 * Coarse device id only, no PII — same shape as the telemetry terminal id
 * (`posapp/utils/telemetry.ts:64`).
 *
 * @module offline/deviceIdentity
 */

const DEVICE_ID_KEY = "posa_device_identifier";

let cachedDeviceId: string | null = null;

export function getDeviceIdentifier(): string {
	if (cachedDeviceId) {
		return cachedDeviceId;
	}
	if (typeof window === "undefined") {
		return "";
	}
	try {
		let id = window.localStorage?.getItem(DEVICE_ID_KEY) || "";
		if (!id) {
			const uuid =
				typeof crypto !== "undefined" &&
				typeof crypto.randomUUID === "function"
					? crypto.randomUUID()
					: `d-${Date.now().toString(36)}-${Math.floor(
							Math.random() * 1e9,
						).toString(36)}`;
			id = uuid.replace(/-/g, "").slice(0, 24);
			window.localStorage?.setItem(DEVICE_ID_KEY, id);
		}
		cachedDeviceId = id;
		return id;
	} catch {
		// Private-browsing / storage-denied: echo suppression degrades to
		// "process my own broadcast too", which costs one extra refresh.
		return "";
	}
}
