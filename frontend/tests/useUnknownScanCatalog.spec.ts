import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/services/catalogScanService", () => ({
	default: {
		isAvailable: vi.fn(() => true),
		prefillForBarcode: vi.fn(),
		requestItemForBarcode: vi.fn(),
	},
}));

import catalogScanService from "../src/posapp/services/catalogScanService";
import { useUnknownScanCatalog } from "../src/posapp/composables/pos/items/useUnknownScanCatalog";

const setup = (offline = false) => {
	const openCreateDialog = vi.fn();
	const toastStore = { show: vi.fn() };
	const playScanTone = vi.fn();
	const flow = useUnknownScanCatalog({
		isOffline: () => offline,
		openCreateDialog,
		toastStore,
		playScanTone,
	});
	return { flow, openCreateDialog, toastStore, playScanTone };
};

describe("useUnknownScanCatalog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(globalThis as any).__ = (text: string) => text;
		vi.mocked(catalogScanService.isAvailable).mockReturnValue(true);
	});

	it("keeps the stock behavior offline without calling the server", async () => {
		const { flow } = setup(true);
		await expect(flow.handleUnknownBarcode("123")).resolves.toBe(false);
		expect(catalogScanService.prefillForBarcode).not.toHaveBeenCalled();
	});

	it("keeps the stock behavior when doco is absent or the lookup fails", async () => {
		const { flow, openCreateDialog } = setup();
		vi.mocked(catalogScanService.prefillForBarcode).mockResolvedValue(null);
		await expect(flow.handleUnknownBarcode("123")).resolves.toBe(false);

		vi.mocked(catalogScanService.isAvailable).mockReturnValue(false);
		await expect(flow.handleUnknownBarcode("123")).resolves.toBe(false);
		expect(openCreateDialog).not.toHaveBeenCalled();
	});

	it("keeps the stock behavior when an Item already owns the barcode", async () => {
		const { flow, openCreateDialog, toastStore } = setup();
		vi.mocked(catalogScanService.prefillForBarcode).mockResolvedValue({
			barcode: "123",
			found_in: "item",
			item_code: "ITEM-1",
			can_create: true,
		});
		await expect(flow.handleUnknownBarcode("123")).resolves.toBe(false);
		expect(openCreateDialog).not.toHaveBeenCalled();
		expect(toastStore.show).not.toHaveBeenCalled();
	});

	it("opens the create dialog for stock roles", async () => {
		const { flow, openCreateDialog, playScanTone } = setup();
		const prefill = {
			barcode: "7501055300075",
			found_in: "central" as const,
			product_name: "Agua",
			can_create: true,
		};
		vi.mocked(catalogScanService.prefillForBarcode).mockResolvedValue(prefill);

		await expect(flow.handleUnknownBarcode("7501055300075")).resolves.toBe(true);
		expect(openCreateDialog).toHaveBeenCalledWith(prefill);
		expect(playScanTone).toHaveBeenCalledWith("error");
	});

	it("offers «Pedir alta» to other roles and confirms the request", async () => {
		const { flow, openCreateDialog, toastStore } = setup();
		vi.mocked(catalogScanService.prefillForBarcode).mockResolvedValue({
			barcode: "123",
			found_in: "none",
			can_create: false,
		});
		vi.mocked(catalogScanService.requestItemForBarcode).mockResolvedValue({
			ok: true,
			data: { name: "123", status: "Open" },
			error: null,
			requestId: "r",
			serverTime: null,
		});

		await expect(flow.handleUnknownBarcode("123")).resolves.toBe(true);
		expect(openCreateDialog).not.toHaveBeenCalled();
		const toast = toastStore.show.mock.calls[0][0];
		expect(toast.title).toBe("Producto no dado de alta");
		expect(toast.action.label).toBe("Pedir alta");

		toast.action.handler();
		await vi.waitFor(() =>
			expect(toastStore.show).toHaveBeenLastCalledWith(
				expect.objectContaining({ title: "Solicitud enviada" }),
			),
		);
		expect(catalogScanService.requestItemForBarcode).toHaveBeenCalledWith("123");
	});
});
