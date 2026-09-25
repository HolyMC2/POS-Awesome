import { ref, type Ref } from "vue";

import { resetNewItemDialogState } from "../../../components/pos/items/newItemDialogState";
import type { CatalogPrefill } from "../../../services/catalogScanService";

type UseItemsSelectorScannerBridgeArgs = {
	cameraScannerActive: Ref<boolean>;
	startCameraScanning: () => void;
	requestForegroundItemSearchFocus: () => void;
	onBarcodeScannedFromScannerInput?: ((_code: string) => void) | null;
	reloadItems: () => Promise<unknown> | unknown;
	// Called instead of reloadItems when the dialog was opened from an
	// unknown scan, so the new item lands on the cart/purchase lines.
	onScanItemCreated?: (_barcode: string, _item: unknown) => Promise<unknown> | unknown;
};

export function useItemsSelectorScannerBridge({
	cameraScannerActive,
	startCameraScanning,
	requestForegroundItemSearchFocus,
	onBarcodeScannedFromScannerInput,
	reloadItems,
	onScanItemCreated,
}: UseItemsSelectorScannerBridgeArgs) {
	const newItemDialog = ref(false);
	const newItemDialogScannedBarcode = ref("");
	const newItemDialogAwaitingScan = ref(false);
	const newItemDialogPrefill = ref<CatalogPrefill | null>(null);

	const openNewItemDialog = () => {
		resetNewItemDialogState(newItemDialogScannedBarcode, newItemDialogAwaitingScan);
		newItemDialogPrefill.value = null;
		newItemDialog.value = true;
	};

	const openNewItemDialogFromScan = (prefill: CatalogPrefill) => {
		resetNewItemDialogState(newItemDialogScannedBarcode, newItemDialogAwaitingScan);
		newItemDialogPrefill.value = prefill;
		newItemDialogScannedBarcode.value = prefill.barcode;
		newItemDialog.value = true;
	};

	const startNewItemBarcodeScan = () => {
		newItemDialogScannedBarcode.value = "";
		newItemDialogAwaitingScan.value = true;
		startCameraScanning();
	};

	const onBarcodeScanned = async (code: string) => {
		if (newItemDialog.value && newItemDialogAwaitingScan.value) {
			newItemDialogScannedBarcode.value = code;
			newItemDialogAwaitingScan.value = false;
			return;
		}

		requestForegroundItemSearchFocus();
		onBarcodeScannedFromScannerInput?.(code);
	};

	const onScannerOpened = () => {
		cameraScannerActive.value = true;
	};

	const onScannerClosed = () => {
		cameraScannerActive.value = false;
		newItemDialogAwaitingScan.value = false;
	};

	const handleItemCreated = (item: unknown) => {
		const scanPrefill = newItemDialogPrefill.value;
		newItemDialog.value = false;
		newItemDialogPrefill.value = null;
		resetNewItemDialogState(newItemDialogScannedBarcode, newItemDialogAwaitingScan);
		if (scanPrefill && onScanItemCreated) {
			void onScanItemCreated(scanPrefill.barcode, item);
			return;
		}
		void reloadItems();
	};

	return {
		newItemDialog,
		newItemDialogScannedBarcode,
		newItemDialogAwaitingScan,
		newItemDialogPrefill,
		openNewItemDialog,
		openNewItemDialogFromScan,
		startNewItemBarcodeScan,
		onBarcodeScanned,
		onScannerOpened,
		onScannerClosed,
		handleItemCreated,
	};
}
