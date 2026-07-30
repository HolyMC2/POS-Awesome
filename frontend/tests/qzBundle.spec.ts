// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	detectQzPlatform,
	downloadQzBundle,
	fetchQzBundleInfo,
	formatBundleSize,
	getQzBundleDownloadUrl,
} from "../src/posapp/services/qzBundle";

vi.mock("../src/posapp/utils/telemetry", () => ({
	track: vi.fn(),
}));

const setUserAgent = (ua: string, platform = "") => {
	Object.defineProperty(globalThis.navigator, "userAgent", {
		value: ua,
		configurable: true,
	});
	Object.defineProperty(globalThis.navigator, "platform", {
		value: platform,
		configurable: true,
	});
};

describe("detectQzPlatform", () => {
	it("picks the Windows installer for a Windows till", () => {
		setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
		expect(detectQzPlatform()).toBe("win");
	});

	it("picks the Linux installer for a desktop Linux till", () => {
		setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
		expect(detectQzPlatform()).toBe("linux");
	});

	it("does not offer the Linux build to Android tablets", () => {
		setUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 7)");
		expect(detectQzPlatform()).toBe("win");
	});
});

describe("getQzBundleDownloadUrl", () => {
	it("targets the whitelisted endpoint with the platform as a query arg", () => {
		expect(getQzBundleDownloadUrl("linux")).toBe(
			"/api/method/posawesome.posawesome.api.qz.download_qz_bundle?platform=linux",
		);
	});
});

describe("formatBundleSize", () => {
	it("renders megabytes for real archives and kilobytes for stubs", () => {
		expect(formatBundleSize(108 * 1024 * 1024)).toBe("108 MB");
		expect(formatBundleSize(4096)).toBe("4 KB");
		expect(formatBundleSize(0)).toBe("");
	});
});

describe("fetchQzBundleInfo", () => {
	beforeEach(() => {
		(globalThis as any).frappe = { call: vi.fn() };
	});

	it("normalises the server payload", async () => {
		(globalThis as any).frappe.call.mockResolvedValue({
			message: {
				available: true,
				qz_version: "2.2.5",
				built_at: "2026-07-30",
				cert_fingerprint: "AA:BB",
				platforms: {
					win: { filename: "qz-win.zip", size: 108, sha256: "abc", present: true },
					linux: { filename: "qz-linux.tar.gz", size: 90, sha256: "def", present: false },
				},
			},
		});

		const info = await fetchQzBundleInfo();

		expect(info.available).toBe(true);
		expect(info.qz_version).toBe("2.2.5");
		expect(info.platforms.win).toEqual({
			filename: "qz-win.zip",
			size: 108,
			sha256: "abc",
			present: true,
		});
		// A manifest can describe an archive a half-finished deploy never
		// landed; `present:false` must survive so the button stays disabled.
		expect(info.platforms.linux?.present).toBe(false);
	});

	it("answers 'nothing deployed' rather than throwing when the site has no bundle", async () => {
		(globalThis as any).frappe.call.mockResolvedValue({ message: { available: false } });

		const info = await fetchQzBundleInfo();

		expect(info.available).toBe(false);
		expect(info.platforms).toEqual({});
	});

	it("degrades to empty when the endpoint refuses or the network is down", async () => {
		// The wizard's other steps must keep working for an operator whose
		// role cannot read the bundle.
		(globalThis as any).frappe.call.mockRejectedValue(new Error("403 Forbidden"));

		await expect(fetchQzBundleInfo()).resolves.toMatchObject({
			available: false,
			platforms: {},
		});
	});

	it("drops platform entries with no filename", async () => {
		(globalThis as any).frappe.call.mockResolvedValue({
			message: { available: true, platforms: { win: { size: 10 }, linux: null } },
		});

		const info = await fetchQzBundleInfo();
		expect(info.platforms).toEqual({});
	});
});

describe("downloadQzBundle", () => {
	let clickSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		clickSpy = vi.fn();
		(globalThis as any).URL.createObjectURL = vi.fn(() => "blob:qz");
		(globalThis as any).URL.revokeObjectURL = vi.fn();
		vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
			if (tag !== "a") {
				return document.createElementNS("http://www.w3.org/1999/xhtml", tag) as any;
			}
			return { href: "", download: "", click: clickSpy } as any;
		}) as any);
		vi.spyOn(document.body, "appendChild").mockImplementation((node: any) => node);
		vi.spyOn(document.body, "removeChild").mockImplementation((node: any) => node);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("hands the archive to the browser as a download", async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			headers: { get: () => 'attachment; filename="qz-tray-win.zip"' },
			blob: async () => new Blob(["zip"]),
		}));

		await downloadQzBundle("win");

		expect(clickSpy).toHaveBeenCalled();
		expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith("blob:qz");
	});

	it("strips any path out of the server-supplied filename", async () => {
		const anchor: any = { href: "", download: "", click: clickSpy };
		vi.mocked(document.createElement).mockReturnValue(anchor);
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			headers: { get: () => 'attachment; filename="../../site_config.json"' },
			blob: async () => new Blob(["zip"]),
		}));

		await downloadQzBundle("win");

		expect(anchor.download).toBe("site_config.json");
	});

	it("explains a 403 instead of dropping a JSON error page on the operator", async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: false,
			status: 403,
			headers: { get: () => "" },
			blob: async () => new Blob([]),
		}));

		await expect(downloadQzBundle("win")).rejects.toThrow(/permission/i);
	});

	it("reports other HTTP failures with their status", async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: false,
			status: 404,
			headers: { get: () => "" },
			blob: async () => new Blob([]),
		}));

		await expect(downloadQzBundle("win")).rejects.toThrow(/404/);
	});

	it("releases the in-flight guard after a failure so a retry is possible", async () => {
		(globalThis as any).fetch = vi.fn(async () => ({
			ok: false,
			status: 500,
			headers: { get: () => "" },
			blob: async () => new Blob([]),
		}));

		await expect(downloadQzBundle("win")).rejects.toThrow();

		(globalThis as any).fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			headers: { get: () => "" },
			blob: async () => new Blob(["zip"]),
		}));
		await expect(downloadQzBundle("win")).resolves.toBeUndefined();
		expect(clickSpy).toHaveBeenCalled();
	});
});
