// @vitest-environment jsdom

import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportPrintPopupBlocked = vi.hoisted(() => vi.fn());
const isOfflineMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../src/offline/index", () => ({ isOffline: isOfflineMock }));
vi.mock("../src/posapp/plugins/print", () => ({
	appendDebugPrintParam: (url: string) => url,
	isDebugPrintEnabled: () => false,
	silentPrint: vi.fn(),
	watchPrintWindow: vi.fn(),
}));
vi.mock("../src/posapp/services/qzTray", () => ({
	printDocumentViaQz: vi.fn(),
	notifyQzPrintFallback: vi.fn(),
}));
vi.mock("../src/offline_print_template", () => ({
	default: vi.fn(async () => "<html>ticket</html>"),
}));
vi.mock("../src/posapp/utils/printPopupBlocked", () => ({
	reportPrintPopupBlocked,
}));

import { usePaymentPrinting } from "../src/posapp/composables/pos/payments/usePaymentPrinting";

const buildPrinting = (profileOverrides: Record<string, any> = {}) =>
	usePaymentPrinting({
		invoiceDoc: ref({ name: "ACC-SINV-0001", doctype: "Sales Invoice" }),
		posProfile: ref({
			print_format_for_online: "Standard",
			print_format: "Standard",
			letter_head: 0,
			posa_open_print_in_new_tab: false,
			posa_silent_print: false,
			...profileOverrides,
		}),
		invoiceType: ref("Invoice"),
		printFormat: ref("Standard"),
	});

describe("usePaymentPrinting popup-block reporting", () => {
	beforeEach(() => {
		reportPrintPopupBlocked.mockReset();
		isOfflineMock.mockReturnValue(false);
		vi.stubGlobal("frappe", {
			urllib: { get_base_url: () => "https://pos.test" },
		});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("reports a blocked window on the normal browser-print path", async () => {
		vi.spyOn(window, "open").mockReturnValue(null as any);
		const { loadPrintPage } = buildPrinting();

		await loadPrintPage({ name: "ACC-SINV-0001" });

		expect(reportPrintPopupBlocked).toHaveBeenCalledWith("payment-print");
	});

	it("reports a blocked preview tab, which used to return in silence", async () => {
		vi.spyOn(window, "open").mockReturnValue(null as any);
		const { loadPrintPage } = buildPrinting({ posa_open_print_in_new_tab: true });

		await loadPrintPage({ name: "ACC-SINV-0001" });

		expect(reportPrintPopupBlocked).toHaveBeenCalledWith("payment-print-new-tab");
	});

	it("reports a blocked offline ticket — the sale is done and nothing prints", async () => {
		vi.spyOn(window, "open").mockReturnValue(null as any);
		const { printOfflineInvoice } = buildPrinting();

		await printOfflineInvoice({ name: "OFFLINE-1" });

		expect(reportPrintPopupBlocked).toHaveBeenCalledWith("offline-print");
	});

	it("reports a blocked offline preview from the new-tab path", async () => {
		isOfflineMock.mockReturnValue(true);
		vi.spyOn(window, "open").mockReturnValue(null as any);
		const { loadPrintPage } = buildPrinting({ posa_open_print_in_new_tab: true });

		await loadPrintPage({ name: "ACC-SINV-0001" });

		expect(reportPrintPopupBlocked).toHaveBeenCalledWith("offline-preview");
	});

	it("stays quiet when the window actually opens", async () => {
		const fakeWindow = {
			document: { write: vi.fn(), close: vi.fn() },
			focus: vi.fn(),
			print: vi.fn(),
		};
		vi.spyOn(window, "open").mockReturnValue(fakeWindow as any);
		const { loadPrintPage } = buildPrinting();

		await loadPrintPage({ name: "ACC-SINV-0001" });

		expect(reportPrintPopupBlocked).not.toHaveBeenCalled();
	});
});
