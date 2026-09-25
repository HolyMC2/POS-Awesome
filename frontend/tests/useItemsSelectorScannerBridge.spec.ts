import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import { useItemsSelectorScannerBridge } from "../src/posapp/composables/pos/items/useItemsSelectorScannerBridge";

const setup = () => {
	const reloadItems = vi.fn();
	const onScanItemCreated = vi.fn();
	const bridge = useItemsSelectorScannerBridge({
		cameraScannerActive: ref(false),
		startCameraScanning: vi.fn(),
		requestForegroundItemSearchFocus: vi.fn(),
		reloadItems,
		onScanItemCreated,
	});
	return { bridge, reloadItems, onScanItemCreated };
};

const prefill = { barcode: "7501055300075", found_in: "none" as const, can_create: true };

describe("useItemsSelectorScannerBridge unknown-scan creation", () => {
	it("opens the dialog with the catalog prefill and scanned barcode", () => {
		const { bridge } = setup();
		bridge.openNewItemDialogFromScan(prefill);

		expect(bridge.newItemDialog.value).toBe(true);
		expect(bridge.newItemDialogPrefill.value).toEqual(prefill);
		expect(bridge.newItemDialogScannedBarcode.value).toBe("7501055300075");
	});

	it("re-scans the created item instead of reloading the catalog", () => {
		const { bridge, reloadItems, onScanItemCreated } = setup();
		bridge.openNewItemDialogFromScan(prefill);
		const item = { item_code: "7501055300075" };
		bridge.handleItemCreated(item);

		expect(onScanItemCreated).toHaveBeenCalledWith("7501055300075", item);
		expect(reloadItems).not.toHaveBeenCalled();
		expect(bridge.newItemDialogPrefill.value).toBeNull();
		expect(bridge.newItemDialog.value).toBe(false);
	});

	it("keeps the manual New Item flow unchanged", () => {
		const { bridge, reloadItems, onScanItemCreated } = setup();
		bridge.openNewItemDialogFromScan(prefill);
		bridge.newItemDialog.value = false;
		bridge.openNewItemDialog();

		expect(bridge.newItemDialogPrefill.value).toBeNull();
		bridge.handleItemCreated({ item_code: "X" });
		expect(reloadItems).toHaveBeenCalledTimes(1);
		expect(onScanItemCreated).not.toHaveBeenCalled();
	});
});
