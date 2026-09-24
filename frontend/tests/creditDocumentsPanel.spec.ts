// @vitest-environment jsdom
/**
 * The credit paperwork checklist, mounted.
 *
 * The cases a counter actually meets: a document still missing, one taken
 * from the serial number, a PDF that cannot be removed, an upload that fails
 * while the customer is still there (and must be re-sent without picking the
 * photo again), and a file too big to send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const { attach, remove } = vi.hoisted(() => ({ attach: vi.fn(), remove: vi.fn() }));
vi.mock("../src/posapp/components/pos/credit/creditApi", () => ({
	attachCreditDocument: attach,
	removeCreditDocument: remove,
}));

import CreditDocumentsPanel from "../src/posapp/components/pos/credit/CreditDocumentsPanel.vue";
import type { CreditDocuments } from "../src/posapp/components/pos/credit/creditApi";
import { ApiEnvelopeError } from "../src/posapp/services/api";

const INVOICE = "ACC-SINV-2026-00042";

const file = (name: string, extra: Record<string, unknown> = {}) => ({
	name,
	file_name: `${name}.jpg`,
	file_url: `/private/files/${name}.jpg`,
	is_image: true,
	can_remove: true,
	...extra,
});

const documents = (overrides: Partial<CreditDocuments> = {}): CreditDocuments => ({
	required: [
		{ kind: "ine_front", label: "INE (front)", satisfied: true, via_serial: false, file: file("FILE-INE") },
		{ kind: "ine_back", label: "INE (back)", satisfied: false, via_serial: false, file: null },
		{ kind: "imei", label: "IMEI", satisfied: true, via_serial: true, file: null },
		{
			kind: "contract",
			label: "Contract",
			satisfied: true,
			via_serial: false,
			file: file("FILE-PDF", {
				file_name: "contrato.pdf",
				file_url: "/private/files/contrato.pdf",
				is_image: false,
				can_remove: false,
			}),
		},
	],
	extra: [],
	missing: 1,
	total: 4,
	complete: false,
	...overrides,
});

/** Listeners ride as props: VTU does not record component emits in this repo. */
const onDocuments = vi.fn();
const render = (props: Record<string, unknown> = {}) =>
	mount(CreditDocumentsPanel, {
		props: { invoice: INVOICE, documents: documents(), editable: true, "onUpdate:documents": onDocuments, ...props },
		global: { stubs: { "v-icon": true } },
	});

/** FileReader answers on a timer in jsdom, so microtasks alone are not enough. */
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await flushPromises();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

async function pick(wrapper: VueWrapper, testId: string, chosen: File) {
	const input = wrapper.get(`[data-testid="${testId}"]`);
	Object.defineProperty(input.element, "files", { configurable: true, value: [chosen] });
	await input.trigger("change");
	await settle();
}

const photo = (name = "back.jpg") => new File(["bytes"], name, { type: "image/jpeg" });

beforeEach(() => {
	attach.mockReset();
	remove.mockReset();
	onDocuments.mockReset();
	(window as any).__ = undefined;
});

describe("CreditDocumentsPanel", () => {
	it("shows each required document's state and only the actions that apply", () => {
		const wrapper = render();
		expect(wrapper.get('[data-testid="credit-documents-progress"]').text()).toBe("3 of 4 ready");

		const front = wrapper.get('[data-testid="credit-doc-ine_front"]');
		expect(front.attributes("data-state")).toBe("done");
		expect(front.get('[data-testid="credit-doc-status-ine_front"]').text()).toBe("FILE-INE.jpg");
		const thumb = front.get('[data-testid="credit-doc-open-ine_front"]');
		expect(thumb.attributes("href")).toBe("/private/files/FILE-INE.jpg");
		expect(thumb.attributes("target")).toBe("_blank");
		expect(thumb.get("img").attributes("src")).toBe("/private/files/FILE-INE.jpg");
		expect(front.find('[data-testid="credit-doc-remove-ine_front"]').exists()).toBe(true);
		expect(front.find('[data-testid="credit-doc-camera-ine_front"]').exists()).toBe(false);

		const back = wrapper.get('[data-testid="credit-doc-ine_back"]');
		expect(back.attributes("data-state")).toBe("missing");
		expect(back.get('[data-testid="credit-doc-status-ine_back"]').text()).toBe("Missing");
		expect(back.find('[data-testid="credit-doc-camera-ine_back"]').text()).toContain("Take photo");
		expect(back.find('[data-testid="credit-doc-upload-ine_back"]').text()).toContain("Upload file");
		const camera = back.get('[data-testid="credit-doc-camera-input-ine_back"]');
		expect(camera.attributes("capture")).toBe("environment");
		expect(camera.attributes("accept")).toBe("image/*");
		expect(back.get('[data-testid="credit-doc-file-input-ine_back"]').attributes("accept")).toBe(
			"image/jpeg,image/png,image/webp,application/pdf",
		);

		const imei = wrapper.get('[data-testid="credit-doc-imei"]');
		expect(imei.get('[data-testid="credit-doc-status-imei"]').text()).toBe("IMEI from serial number");
		expect(imei.find("button").exists()).toBe(false);

		const contract = wrapper.get('[data-testid="credit-doc-contract"]');
		expect(contract.get('[data-testid="credit-doc-open-contract"]').text()).toBe("PDF");
		expect(contract.find("img").exists()).toBe(false);
		expect(contract.find('[data-testid="credit-doc-remove-contract"]').exists()).toBe(false);
	});

	it("uploads the chosen photo as base64 and hands the new checklist up", async () => {
		const next = documents({ missing: 0, complete: true });
		attach.mockResolvedValue(next);
		const wrapper = render();
		await pick(wrapper, "credit-doc-camera-input-ine_back", photo());
		expect(attach).toHaveBeenCalledTimes(1);
		expect(attach).toHaveBeenCalledWith({
			invoice: INVOICE,
			kind: "ine_back",
			filename: "back.jpg",
			content: "Ynl0ZXM=",
		});
		expect(onDocuments.mock.calls).toEqual([[next]]);
		expect(wrapper.find('[data-testid="credit-doc-error-ine_back"]').exists()).toBe(false);
	});

	it("keeps the file after a failed upload and re-sends the same bytes on Try again", async () => {
		const lost = new ApiEnvelopeError({
			ok: false,
			data: null,
			error: { code: "TIMEOUT", message: "Request timed out", retryable: true },
			requestId: "posa-1",
			serverTime: null,
		});
		const next = documents({ missing: 0, complete: true });
		attach.mockRejectedValueOnce(lost).mockResolvedValueOnce(next);
		const wrapper = render();
		await pick(wrapper, "credit-doc-file-input-ine_back", photo("reverso.jpg"));

		const error = wrapper.get('[data-testid="credit-doc-error-ine_back"]');
		expect(error.attributes("role")).toBe("alert");
		expect(error.text()).toContain("The file was not saved. Check the connection and try again.");
		expect(onDocuments).not.toHaveBeenCalled();

		await wrapper.get('[data-testid="credit-doc-retry-ine_back"]').trigger("click");
		await settle();
		expect(attach).toHaveBeenCalledTimes(2);
		expect(attach.mock.calls[1]).toEqual(attach.mock.calls[0]);
		expect(attach.mock.calls[1][0]).toMatchObject({ kind: "ine_back", filename: "reverso.jpg", content: "Ynl0ZXM=" });
		expect(onDocuments.mock.calls).toEqual([[next]]);
		expect(wrapper.find('[data-testid="credit-doc-error-ine_back"]').exists()).toBe(false);
	});

	it("shows the server's own reason when it refuses the file", async () => {
		attach.mockRejectedValueOnce(new Error("El archivo no es legible."));
		const wrapper = render();
		await pick(wrapper, "credit-doc-camera-input-ine_back", photo());
		expect(wrapper.get('[data-testid="credit-doc-error-ine_back"]').text()).toContain("El archivo no es legible.");
		expect(wrapper.find('[data-testid="credit-doc-retry-ine_back"]').exists()).toBe(true);
	});

	it("refuses a file over the limit without calling the server or offering a retry", async () => {
		const wrapper = render({ maxUploadMb: 1 });
		const pdf = new File([new Uint8Array(2 * 1024 * 1024)], "contrato.pdf", { type: "application/pdf" });
		await pick(wrapper, "credit-doc-file-input-ine_back", pdf);
		expect(attach).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="credit-doc-error-ine_back"]').text()).toContain("This file is over 1 MB");
		expect(wrapper.find('[data-testid="credit-doc-retry-ine_back"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="credit-doc-camera-ine_back"]').exists()).toBe(true);
	});

	it("asks before removing, then removes by file name", async () => {
		const next = documents();
		remove.mockResolvedValue(next);
		const wrapper = render();
		await wrapper.get('[data-testid="credit-doc-remove-ine_front"]').trigger("click");
		expect(remove).not.toHaveBeenCalled();
		await wrapper.get('[data-testid="credit-doc-remove-confirm-ine_front"]').trigger("click");
		await settle();
		expect(remove).toHaveBeenCalledWith(INVOICE, "FILE-INE");
		expect(onDocuments.mock.calls).toEqual([[next]]);
	});

	it("is read-only when the sale cannot be edited", () => {
		const wrapper = render({ editable: false });
		expect(wrapper.findAll("button")).toHaveLength(0);
		expect(wrapper.find('[data-testid="credit-extra-add"]').exists()).toBe(false);
		expect(wrapper.find('input[type="file"]').exists()).toBe(false);
		expect(wrapper.text()).toContain("You can see these documents but not change them.");
	});

	it("lists other documents and uploads a new one under the chosen kind", async () => {
		const extra = {
			...file("FILE-X", { file_name: "recibo.pdf", file_url: "/private/files/recibo.pdf", is_image: false }),
			attachment_kind: "Receipt",
		};
		const next = documents({ extra: [extra] });
		attach.mockResolvedValue(next);
		const wrapper = render({ documents: documents({ extra: [extra] }), documentKinds: ["Contract", "Receipt"] });
		expect(wrapper.get('[data-testid="credit-extra-FILE-X"]').text()).toContain("recibo.pdf");
		expect(wrapper.get('[data-testid="credit-extra-FILE-X"]').text()).toContain("Receipt");
		await wrapper.get('[data-testid="credit-extra-kind"]').setValue("Receipt");
		await pick(wrapper, "credit-extra-camera-input", photo("otro.jpg"));
		expect(attach).toHaveBeenCalledWith({ invoice: INVOICE, kind: "Receipt", filename: "otro.jpg", content: "Ynl0ZXM=" });
	});

	it("never turns a foreign URL into a link or an image", () => {
		const hostile = documents();
		hostile.required[0].file = file("FILE-INE", { file_url: "https://evil.test/ine.jpg" });
		const wrapper = render({ documents: hostile });
		expect(wrapper.find('[data-testid="credit-doc-open-ine_front"]').exists()).toBe(false);
		expect(wrapper.html()).not.toContain("evil.test");
	});
});
