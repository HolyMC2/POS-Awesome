// @vitest-environment jsdom
import SOURCE from "../../posawesome/public/js/cash_photos.js?raw";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const call = vi.fn();
let host: HTMLElement, panel: any;
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 25)); };
const photo = { name: "FILE-1", file_name: "bag.jpg", file_url: "/private/files/bag.jpg", owner: "cashier@test", creation: "2026-09-23 12:00:00" };
const result = (photos: any[] = []) => ({ message: { photos, can_upload: true, max_photos: 6, max_bytes: 5 * 1024 * 1024 } });
async function pick(file: File) {
	const input = host.querySelector<HTMLInputElement>('input[capture]')!;
	Object.defineProperty(input, "files", { configurable: true, value: [file] });
	input.dispatchEvent(new Event("change")); await flush();
}
beforeEach(async () => {
	vi.stubGlobal("__", (text: string) => text);
	vi.stubGlobal("frappe", { call });
	URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
	document.body.innerHTML = "";
	host = document.createElement("div"); document.body.append(host);
	call.mockReset().mockResolvedValue(result());
	new Function(SOURCE)();
	panel = (window as any).posaCashPhotos.mount(host, { doctype: "POS Cash Bag", name: "BAG-1" });
	await flush();
});
afterEach(() => { panel.destroy(); vi.unstubAllGlobals(); });
describe("cash photos", () => {
	it("uses a camera input, private URLs and escaped uploader facts", async () => {
		panel.destroy(); call.mockResolvedValue(result([photo, { ...photo, file_url: "https://evil.test/photo.jpg" }]));
		panel = (window as any).posaCashPhotos.mount(host, { doctype: "POS Cash Count", name: "COUNT-1" }); await flush();
		expect(host.querySelector('input[capture="environment"]')).toBeTruthy();
		expect(host.querySelectorAll("figure")).toHaveLength(1);
		expect(host.querySelector("figure a")?.getAttribute("href")).toBe(photo.file_url);
		expect(call.mock.lastCall?.[0].args).toEqual({ doctype: "POS Cash Count", name: "COUNT-1" });
	});
	it("retries the same bytes against the same bag after an unconfirmed upload", async () => {
		call.mockRejectedValueOnce(new Error("connection lost"));
		await pick(new File(["bytes"], "bag.jpg", { type: "image/jpeg" }));
		expect(panel.hasPending()).toBe(true);
		expect(host.querySelector('[role="alert"]')?.textContent).toContain("cash record is unchanged");
		const first = call.mock.calls.at(-1)?.[0];
		call.mockResolvedValueOnce({ message: photo }).mockResolvedValueOnce(result([photo]));
		Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry")!.click(); await flush();
		expect(call.mock.calls.at(-2)?.[0]).toEqual(first);
		expect(first.method).toMatch(/photos.upload_photo$/);
		expect(first.args).toMatchObject({ name: "BAG-1", filename: "bag.jpg", content: "Ynl0ZXM=" });
		expect(panel.hasPending()).toBe(false);
		expect(host.querySelectorAll("figure")).toHaveLength(1);
		expect(call.mock.calls.every(([req]) => req.method.includes(".photos."))).toBe(true);
	});
	it("keeps an unconfirmed photo on its own bag across SPA navigation", async () => {
		call.mockRejectedValueOnce(new Error("offline"));
		await pick(new File(["bytes"], "bag.jpg", { type: "image/jpeg" }));
		panel.destroy(); call.mockResolvedValue(result());
		panel = (window as any).posaCashPhotos.mount(host, { doctype: "POS Cash Bag", name: "BAG-OTHER" }); await flush();
		expect(panel.hasPending()).toBe(false);
		panel.destroy();
		panel = (window as any).posaCashPhotos.mount(host, { doctype: "POS Cash Bag", name: "BAG-1" }); await flush();
		expect(panel.hasPending()).toBe(true);
		const retry = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry")!;
		expect(retry.hidden).toBe(false);
		call.mockResolvedValueOnce({ message: photo }).mockResolvedValueOnce(result([photo]));
		retry.click(); await flush();
		expect(call.mock.calls.at(-2)?.[0].args).toMatchObject({ name: "BAG-1", content: "Ynl0ZXM=" });
		expect(panel.hasPending()).toBe(false);
	});
	it("rejects non-photos locally and offers an independent list retry", async () => {
		await pick(new File(["<svg>"], "bag.svg", { type: "image/svg+xml" }));
		expect(call).toHaveBeenCalledTimes(1);
		expect(host.querySelector('[role="alert"]')?.textContent).toContain("JPEG");
		panel.destroy(); call.mockRejectedValueOnce(Error());
		panel = (window as any).posaCashPhotos.mount(host, { doctype: "POS Cash Bag", name: "BAG-2" }); await flush();
		expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
		Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Retry")!.click(); await flush();
		expect(host.querySelector('[role="alert"]')?.textContent).toBe("");
	});
});
