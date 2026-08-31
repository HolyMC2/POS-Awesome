// The camera start-retry loop must be cancellable and must stop the instant the
// scanner opens — otherwise a retry still pending re-opens the scanner the
// cashier just dismissed (audit RUNTIME-F8). Source-pinned.
import { describe, expect, it } from "vitest";
import src from "../src/posapp/components/pos/items/ItemsSelector.vue?raw";

describe("the camera start-retry cannot re-open a dismissed scanner", () => {
	it("keeps the timer in a cancellable handle, not a bare setTimeout", () => {
		expect(src).toMatch(/cameraRetryHandle\s*=\s*setTimeout\(tryStartCamera, 200\)/);
		expect(src).toMatch(/const stopCameraRetry = \(\) => \{[\s\S]*clearTimeout\(cameraRetryHandle\)/);
	});
	it("cancels a pending retry the moment the scanner reports open", () => {
		expect(src).toMatch(/watch\(scannerInput\.cameraScannerActive,\s*\(active\)\s*=>\s*\{\s*if \(active\) stopCameraRetry\(\)/);
	});
	it("stops retrying if the scanner was torn down while waiting", () => {
		expect(src).toMatch(/if \(scannerInput\.cameraScannerActive\.value \|\| !shouldMountCameraScanner\.value\)/);
	});
});
