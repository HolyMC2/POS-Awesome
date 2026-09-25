// @vitest-environment jsdom
/**
 * Credit documents: what the register sends, and to which endpoint.
 *
 * The upload helpers are pure except for the canvas, which `prepareUpload`
 * takes as injected decode/encode functions — so the downscale decision, the
 * size limit and the base64 payload are all checked here without a browser.
 * The API wrappers are pinned to the mercado contract: method names, GET for
 * reads, POST for writes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { call, salesInvoiceExpenses } = vi.hoisted(() => ({ call: vi.fn(), salesInvoiceExpenses: vi.fn() }));
vi.mock("../src/posapp/services/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/posapp/services/api")>();
	return { ...actual, default: { call } };
});
vi.mock("../src/posapp/services/cashMovementService", () => ({
	default: { getSalesInvoiceExpenses: salesInvoiceExpenses },
}));

import {
	CAMERA_ACCEPT,
	FILE_ACCEPT,
	MAX_IMAGE_BYTES,
	UploadRefusedError,
	base64FromDataUrl,
	exceedsLimit,
	fitWithin,
	isPdf,
	jpegName,
	needsDownscale,
	prepareUpload,
	uploadLimitMb,
	type DecodedImage,
} from "../src/posapp/components/pos/credit/creditUpload";
import {
	attachCreditDocument,
	getCreditContext,
	getCreditSale,
	getCreditSaleExpenses,
	listCreditSales,
	loadCreditContext,
	lockCreditSale,
	removeCreditDocument,
	updateCreditSale,
} from "../src/posapp/components/pos/credit/creditApi";
import { formatMoney, safeFileUrl } from "../src/posapp/components/pos/credit/creditFormat";

const MB = 1024 * 1024;
const fileOf = (bytes: number | string, name: string, type: string) =>
	new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });
const decoded = (width: number, height: number) => {
	const close = vi.fn();
	const image: DecodedImage = { width, height, source: {} as CanvasImageSource, close };
	return { image, close, decode: vi.fn(async () => image) };
};

describe("upload decisions", () => {
	it("reads the limit, falling back to 10 MB", () => {
		expect(uploadLimitMb(undefined)).toBe(10);
		expect(uploadLimitMb(0)).toBe(10);
		expect(uploadLimitMb(-3)).toBe(10);
		expect(uploadLimitMb(4)).toBe(4);
		expect(exceedsLimit(10 * MB, 10)).toBe(false);
		expect(exceedsLimit(10 * MB + 1, 10)).toBe(true);
		expect(exceedsLimit(3 * MB, 2)).toBe(true);
	});

	it("downscales past 2560 px, past 1.5 MB, or when the server cannot keep the format", () => {
		const small = { size: 400_000, type: "image/jpeg" };
		expect(needsDownscale({ width: 2560, height: 1440 }, small)).toBe(false);
		expect(needsDownscale({ width: 2561, height: 1440 }, small)).toBe(true);
		expect(needsDownscale({ width: 1200, height: 4000 }, small)).toBe(true);
		expect(needsDownscale({ width: 1200, height: 900 }, { size: MAX_IMAGE_BYTES + 1, type: "image/png" })).toBe(true);
		expect(needsDownscale({ width: 1200, height: 900 }, { size: 1000, type: "image/heic" })).toBe(true);
	});

	it("fits the longest side and never enlarges", () => {
		expect(fitWithin(4000, 3000)).toEqual({ width: 2560, height: 1920 });
		expect(fitWithin(3000, 6000)).toEqual({ width: 1280, height: 2560 });
		expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
	});

	it("names re-encoded photos .jpg and strips data URL prefixes", () => {
		expect(jpegName("IMG_2041.HEIC")).toBe("IMG_2041.jpg");
		expect(jpegName("")).toBe("photo.jpg");
		expect(jpegName("contrato.v2.png")).toBe("contrato.v2.jpg");
		expect(base64FromDataUrl("data:image/jpeg;base64,QUJD")).toBe("QUJD");
		expect(base64FromDataUrl("QUJD")).toBe("QUJD");
	});

	it("recognises a PDF with no type by its name", () => {
		expect(isPdf({ name: "contrato.pdf", type: "", size: 1 })).toBe(true);
		expect(isPdf({ name: "contrato.pdf", type: "application/pdf", size: 1 })).toBe(true);
		expect(isPdf({ name: "foto.jpg", type: "image/jpeg", size: 1 })).toBe(false);
	});

	it("offers the camera anything it writes and the picker only what the server keeps", () => {
		expect(CAMERA_ACCEPT).toBe("image/*");
		expect(FILE_ACCEPT.split(",")).toEqual(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
	});
});

describe("prepareUpload", () => {
	it("sends a PDF as it is, in base64", async () => {
		const prepared = await prepareUpload(fileOf("bytes", "contrato.pdf", "application/pdf"));
		expect(prepared).toEqual({ filename: "contrato.pdf", content: "Ynl0ZXM=", bytes: 5, type: "application/pdf" });
	});

	it("refuses a PDF over the limit before reading it", async () => {
		const big = fileOf(3 * MB, "contrato.pdf", "application/pdf");
		await expect(prepareUpload(big, { maxUploadMb: 2 })).rejects.toMatchObject({ reason: "too-large", limitMb: 2 });
	});

	it("refuses what is neither a photo nor a PDF", async () => {
		const error = await prepareUpload(fileOf("x", "nota.txt", "text/plain")).catch((e) => e);
		expect(error).toBeInstanceOf(UploadRefusedError);
		expect(error.reason).toBe("unsupported");
	});

	it("keeps a small photo untouched and closes the decoded bitmap", async () => {
		const { decode, close } = decoded(1600, 1200);
		const encode = vi.fn();
		const prepared = await prepareUpload(fileOf("bytes", "ine.jpg", "image/jpeg"), { decode, encode });
		expect(encode).not.toHaveBeenCalled();
		expect(prepared).toMatchObject({ filename: "ine.jpg", content: "Ynl0ZXM=", type: "image/jpeg" });
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("re-encodes a large camera photo to a JPEG within 2560 px, even above the limit", async () => {
		const { decode, close } = decoded(4032, 3024);
		const encode = vi.fn(async () => new Blob(["small"], { type: "image/jpeg" }));
		const camera = fileOf(12 * MB, "IMG_0001.HEIC", "image/heic");
		const prepared = await prepareUpload(camera, { decode, encode, maxUploadMb: 10 });
		expect(encode).toHaveBeenCalledWith(expect.anything(), { width: 2560, height: 1920 }, 0.85);
		expect(prepared).toMatchObject({ filename: "IMG_0001.jpg", content: "c21hbGw=", type: "image/jpeg", bytes: 5 });
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("refuses a photo whose re-encoded copy is still over the limit", async () => {
		const { decode } = decoded(4032, 3024);
		const encode = vi.fn(async () => new Blob([new Uint8Array(3 * MB)], { type: "image/jpeg" }));
		await expect(
			prepareUpload(fileOf(8 * MB, "big.jpg", "image/jpeg"), { decode, encode, maxUploadMb: 2 }),
		).rejects.toMatchObject({ reason: "too-large" });
	});

	it("without a decoder, sends a storable photo within the limit and refuses the rest", async () => {
		const decode = vi.fn(async () => null);
		await expect(prepareUpload(fileOf("bytes", "ine.png", "image/png"), { decode })).resolves.toMatchObject({
			filename: "ine.png",
			content: "Ynl0ZXM=",
		});
		await expect(prepareUpload(fileOf("bytes", "ine.heic", "image/heic"), { decode })).rejects.toMatchObject({
			reason: "unsupported",
		});
		await expect(
			prepareUpload(fileOf(3 * MB, "ine.jpg", "image/jpeg"), { decode, maxUploadMb: 2 }),
		).rejects.toMatchObject({ reason: "too-large" });
	});
});

describe("credit API contract", () => {
	beforeEach(() => {
		call.mockReset().mockResolvedValue({});
		salesInvoiceExpenses.mockReset().mockResolvedValue([]);
	});

	it("reads with GET and writes with POST on mercado.api.pos_credit", async () => {
		await getCreditContext("Doco Ventas");
		await getCreditSale("ACC-SINV-1");
		await listCreditSales({ posProfile: "Doco Ventas", status: "pending", search: "ana" });
		await attachCreditDocument({ invoice: "ACC-SINV-1", kind: "ine", filename: "ine.jpg", content: "QUJD" });
		await removeCreditDocument("ACC-SINV-1", "FILE-1");
		await updateCreditSale("ACC-SINV-1", { plan_months: 12, plan_monthly: 450, notes: "x" });
		await lockCreditSale("ACC-SINV-1");
		expect(call.mock.calls).toEqual([
			["mercado.api.pos_credit.get_context", { pos_profile: "Doco Ventas" }, { type: "GET" }],
			["mercado.api.pos_credit.get_credit_sale", { invoice: "ACC-SINV-1" }, { type: "GET" }],
			[
				"mercado.api.pos_credit.list_credit_sales",
				{ pos_profile: "Doco Ventas", status: "pending", search: "ana", limit: 50 },
				{ type: "GET" },
			],
			[
				"mercado.api.pos_credit.attach_document",
				{ invoice: "ACC-SINV-1", kind: "ine", filename: "ine.jpg", content: "QUJD" },
			],
			["mercado.api.pos_credit.remove_document", { invoice: "ACC-SINV-1", file: "FILE-1" }],
			[
				"mercado.api.pos_credit.update_credit_sale",
				{ invoice: "ACC-SINV-1", plan_months: 12, plan_monthly: 450, notes: "x" },
			],
			["mercado.api.pos_credit.lock_credit_sale", { invoice: "ACC-SINV-1" }],
		]);
	});

	it("lists the sale's expenses through posawesome's own read", async () => {
		await getCreditSaleExpenses("ACC-SINV-1");
		expect(salesInvoiceExpenses).toHaveBeenCalledWith("ACC-SINV-1");
	});

	it("asks for a profile's context once, and again after a failure", async () => {
		call.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ enabled: true });
		await expect(loadCreditContext("Mumu")).rejects.toThrow("offline");
		await loadCreditContext("Mumu");
		await loadCreditContext("Mumu");
		expect(call).toHaveBeenCalledTimes(2);
		await loadCreditContext("Mumu", { force: true });
		expect(call).toHaveBeenCalledTimes(3);
	});
});

describe("formatting and links", () => {
	it("formats money in the returned currency, and as a plain number without one", () => {
		const reference = new Intl.NumberFormat(undefined, { style: "currency", currency: "MXN" }).format(1234.5);
		expect(formatMoney(1234.5, "MXN")).toBe(reference);
		expect(formatMoney("1234.5", "")).toBe(
			new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234.5),
		);
		expect(formatMoney(10, "not-a-code")).toBe(
			new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(10),
		);
	});

	it("only lets same-origin files become links", () => {
		expect(safeFileUrl("/private/files/ine.jpg")).toBe("/private/files/ine.jpg");
		expect(safeFileUrl(`${window.location.origin}/files/a.pdf?x=1`)).toBe("/files/a.pdf?x=1");
		expect(safeFileUrl("https://evil.test/ine.jpg")).toBeNull();
		expect(safeFileUrl("//evil.test/ine.jpg")).toBeNull();
		expect(safeFileUrl("/\\evil.test/ine.jpg")).toBeNull();
		expect(safeFileUrl("")).toBeNull();
	});
});
