import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEnvelope } from "../src/posapp/services/api";

vi.mock("../src/posapp/services/api", () => ({
	default: {
		callEnvelope: vi.fn(),
	},
}));

import api from "../src/posapp/services/api";
import catalogScanService from "../src/posapp/services/catalogScanService";

const ok = <T>(data: T): ApiEnvelope<T> => ({
	ok: true,
	data,
	error: null,
	requestId: "r",
	serverTime: null,
});

const fail = (message: string): ApiEnvelope<any> => ({
	ok: false,
	data: null,
	error: { code: "HTTP_ERROR", message, retryable: false },
	requestId: "r",
	serverTime: null,
});

describe("catalogScanService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		catalogScanService.resetAvailability();
	});

	it("calls doco prefill with the trimmed barcode and returns the payload", async () => {
		const payload = { barcode: "7501055300075", found_in: "central", can_create: true };
		vi.mocked(api.callEnvelope).mockResolvedValue(ok(payload) as never);

		await expect(catalogScanService.prefillForBarcode(" 7501055300075 ")).resolves.toEqual(payload);
		expect(api.callEnvelope).toHaveBeenCalledWith(
			"doco.docoutils.catalog_items.prefill_for_barcode",
			{ barcode: "7501055300075" },
			expect.objectContaining({ timeoutMs: expect.any(Number) }),
		);
	});

	it("disables itself for the session when doco is not installed", async () => {
		vi.mocked(api.callEnvelope).mockResolvedValue(
			fail("Failed to get method for command doco.docoutils.catalog_items.prefill_for_barcode with No module named 'doco'") as never,
		);

		await expect(catalogScanService.prefillForBarcode("123")).resolves.toBeNull();
		expect(catalogScanService.isAvailable()).toBe(false);
		await expect(catalogScanService.prefillForBarcode("456")).resolves.toBeNull();
		expect(api.callEnvelope).toHaveBeenCalledTimes(1);
	});

	it("stays available after a transient failure", async () => {
		vi.mocked(api.callEnvelope).mockResolvedValue(fail("Request timed out") as never);

		await expect(catalogScanService.prefillForBarcode("123")).resolves.toBeNull();
		expect(catalogScanService.isAvailable()).toBe(true);
	});

	it("drops empty arguments when creating and tags requests as pos", async () => {
		vi.mocked(api.callEnvelope).mockResolvedValue(ok({}) as never);

		await catalogScanService.createItemFromScan({
			barcode: "123",
			item_name: "Agua 1 L",
			brand: null,
			selling_price: 12,
			opening_qty: null,
		});
		expect(api.callEnvelope).toHaveBeenLastCalledWith(
			"doco.docoutils.catalog_items.create_item_from_scan",
			{ barcode: "123", item_name: "Agua 1 L", selling_price: 12 },
		);

		await catalogScanService.requestItemForBarcode("123");
		expect(api.callEnvelope).toHaveBeenLastCalledWith(
			"doco.docoutils.catalog_items.request_item_for_barcode",
			{ barcode: "123", source_app: "pos" },
		);
	});
});
