import catalogScanService, {
	type CatalogPrefill,
} from "../../../services/catalogScanService";
import type { NotificationData } from "../../../stores/toastStore";

declare const __: (_str: string, _args?: any[]) => string;

type ToastLike = {
	show: (_data: NotificationData) => void;
};

type UseUnknownScanCatalogArgs = {
	isOffline: () => boolean;
	openCreateDialog: (_prefill: CatalogPrefill) => void;
	toastStore: ToastLike;
	playScanTone?: (_tone: "success" | "error") => void;
};

/**
 * Unknown-barcode flow for the POS and purchase item selectors, backed by
 * doco's scan-to-catalog service: stock roles get the create dialog
 * pre-filled from the local/central catalog, everyone else can file a
 * «pedir alta» request. Resolves `false` whenever the stock POS behavior
 * should run instead (offline, doco absent, lookup failed, or the barcode
 * already belongs to an Item this profile cannot see).
 */
export function useUnknownScanCatalog({
	isOffline,
	openCreateDialog,
	toastStore,
	playScanTone,
}: UseUnknownScanCatalogArgs) {
	const requestItem = async (barcode: string) => {
		const envelope = await catalogScanService.requestItemForBarcode(barcode);
		if (envelope.ok) {
			toastStore.show({
				title: __("Solicitud enviada"),
				detail: barcode,
				color: "success",
				key: `catalog-request::${barcode}`,
			});
			return;
		}
		toastStore.show({
			title: __("No se pudo enviar la solicitud"),
			detail: envelope.error.message,
			color: "error",
			key: `catalog-request::${barcode}`,
		});
	};

	const handleUnknownBarcode = async (barcode: string): Promise<boolean> => {
		const code = String(barcode || "").trim();
		if (!code || isOffline() || !catalogScanService.isAvailable()) {
			return false;
		}

		let prefill: CatalogPrefill | null = null;
		try {
			prefill = await catalogScanService.prefillForBarcode(code);
		} catch (error) {
			console.error("Catalog prefill failed:", error);
			return false;
		}
		if (!prefill || prefill.found_in === "item") {
			return false;
		}

		playScanTone?.("error");

		if (prefill.can_create) {
			openCreateDialog({ ...prefill, barcode: prefill.barcode || code });
			return true;
		}

		toastStore.show({
			title: __("Producto no dado de alta"),
			detail: prefill.product_name ? `${code} · ${prefill.product_name}` : code,
			color: "warning",
			timeout: 8000,
			key: `catalog-unknown::${code}`,
			action: {
				label: __("Pedir alta"),
				handler: () => {
					void requestItem(code);
				},
			},
		});
		return true;
	};

	return {
		handleUnknownBarcode,
		requestItem,
	};
}
