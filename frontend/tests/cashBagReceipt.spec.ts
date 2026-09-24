// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showClosingBagReceipt } from "../src/posapp/components/pos/custody/closingReceipt";
import { printClosingEvidence } from "../src/posapp/components/pos/custody/api";
vi.mock("../src/posapp/components/pos/custody/api", () => ({
	printClosingEvidence: vi.fn(),
}));
const call = vi.fn();
const settle = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
beforeEach(() => {
	document.body.innerHTML = "";
	(window as any).frappe = { call };
	(window as any).__ = (x: string) => x;
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.dispatchEvent(new Event("close"));
	};
	call.mockReset();
	vi.mocked(printClosingEvidence).mockReset();
});
describe("confirmed closing handover", () => {
	it("shows persisted bag facts safely and offers a read-only retry after print failure", async () => {
		call.mockResolvedValue({
			message: [
				{
					seal: "<script>bad</script>",
					amount: 1000,
					currency: "MXN",
					purpose: "Float",
					state: "Unverified",
					prepared_by: "Cashier",
					prepared_on: "23/09/2026",
				},
			],
		});
		showClosingBagReceipt("CLOSE-123");
		await settle();
		expect(document.querySelector("li strong")?.textContent).toContain(
			"<script>bad</script>",
		);
		expect(document.querySelector("script")).toBeNull();
		expect(document.querySelector("li small")?.textContent).toContain(
			"23/09/2026",
		);
		vi.mocked(printClosingEvidence).mockRejectedValueOnce(
			new Error("printer offline"),
		);
		const button =
			document.querySelector<HTMLButtonElement>("[data-print]")!;
		button.click();
		await settle();
		expect(document.querySelector("[data-error]")?.textContent).toContain(
			"The shift is closed",
		);
		expect(button.disabled).toBe(false);
		vi.mocked(printClosingEvidence).mockResolvedValueOnce(undefined);
		button.click();
		await settle();
		expect(printClosingEvidence).toHaveBeenLastCalledWith(
			"CLOSE-123",
			"ticket",
		);
		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0][0].method).toMatch(/printing.closing_bags$/);
	});
	it("keeps the successful close explicit when labels cannot load", async () => {
		call.mockRejectedValueOnce(new Error("offline"));
		showClosingBagReceipt("CLOSE-1");
		await settle();
		expect(
			document.querySelector<HTMLButtonElement>("[data-print]")?.disabled,
		).toBe(true);
		expect(document.querySelector("[data-error]")?.textContent).toContain(
			"The shift is closed",
		);
		call.mockResolvedValueOnce({ message: [] });
		document.querySelector<HTMLButtonElement>("[data-retry]")!.click();
		await settle();
		expect(document.querySelector("[data-message]")?.textContent).toContain(
			"no bags to print",
		);
		document.querySelector<HTMLButtonElement>("[data-done]")!.click();
		expect(document.querySelector("dialog")).toBeNull();
	});
});
