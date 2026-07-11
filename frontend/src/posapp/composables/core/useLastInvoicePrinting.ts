import { useUIStore } from "../../stores/uiStore";
import {
	appendDebugPrintParam,
	isDebugPrintEnabled,
	silentPrint,
	watchPrintWindow,
} from "../../plugins/print";
import { notifyQzPrintFallback, printDocumentViaQz } from "../../services/qzTray";

declare const frappe: any;
declare const __: (text: string, args?: any[]) => string;

// Module-scope in-flight guard. Closes the "two paper copies" bug:
// operators tap the navbar print button while a print is mid-flight
// (the silent print or new-tab open hasn't returned yet), the second
// tap races the first and both jobs reach the printer. The guard
// makes the function reentrant-safe: subsequent calls become no-ops
// until the in-flight print resolves or rejects.
let _printLastInvoiceInFlight = false;

export function useLastInvoicePrinting() {
	const uiStore = useUIStore();

	function parseBooleanSetting(value: unknown) {
		if (value === undefined || value === null) return false;
		if (typeof value === "string") {
			const normalized = value.trim().toLowerCase();
			return ["1", "true", "yes", "on"].includes(normalized);
		}
		if (typeof value === "number") return value === 1;
		return Boolean(value);
	}

	async function fetchLastInvoiceName(doctype: string): Promise<string | null> {
		try {
			const shiftName = uiStore.posOpeningShift?.name || undefined;
			const response = await frappe.call({
				method: "posawesome.posawesome.api.invoices.get_last_pos_invoice",
				args: { pos_opening_shift: shiftName, doctype },
			});
			return response?.message || null;
		} catch (error) {
			console.warn("Failed to fetch last invoice from server", error);
			return null;
		}
	}

	async function printLastInvoice() {
		// Re-entrancy guard — see `_printLastInvoiceInFlight` at top of
		// file. Drops the second concurrent press so the printer
		// receives one job, not two.
		if (_printLastInvoiceInFlight) {
			frappe?.show_alert?.(
				{
					message: "Print already in flight; ignoring duplicate request.",
					indicator: "orange",
				},
				3,
			);
			return;
		}
		_printLastInvoiceInFlight = true;

		try {
			await _printLastInvoiceImpl();
		} finally {
			_printLastInvoiceInFlight = false;
		}
	}

	async function _printLastInvoiceImpl() {
		const posProfile = uiStore.posProfile;

		if (!posProfile) {
			frappe?.show_alert?.(
				{
					message: __("POS Profile is still loading. Try again in a moment."),
					indicator: "red",
				},
				5,
			);
			return;
		}

		const doctype = posProfile.create_pos_invoice_instead_of_sales_invoice
			? "POS Invoice"
			: "Sales Invoice";

		// Prefer the cached id (in-memory or persisted); when empty — fresh tab,
		// cleared storage, service-worker reload — fall back to the server so the
		// reprint button works on the operator's first action after opening POS.
		let lastInvoiceId = uiStore.lastInvoiceId;
		if (!lastInvoiceId) {
			lastInvoiceId = await fetchLastInvoiceName(doctype);
			if (lastInvoiceId) uiStore.setLastInvoice(lastInvoiceId);
		}

		if (!lastInvoiceId) {
			frappe?.show_alert?.(
				{
					message: __("No recent ticket found to reprint."),
					indicator: "orange",
				},
				5,
			);
			return;
		}

		const pf =
			posProfile.print_format_for_online || posProfile.print_format;
		const letter_head = posProfile.letter_head || 0;
		const debugPrint = isDebugPrintEnabled();
		const openInNewTab = parseBooleanSetting(
			posProfile.posa_open_print_in_new_tab,
		);
		const useSilentPrint = parseBooleanSetting(posProfile.posa_silent_print);
		const basePrintUrl = frappe.urllib.get_base_url() + "/printview";

		let url =
			basePrintUrl +
			"?doctype=" +
			encodeURIComponent(doctype) +
			"&name=" +
			encodeURIComponent(lastInvoiceId) +
			"&trigger_print=1" +
			"&format=" +
			encodeURIComponent(pf || "Standard") +
			"&no_letterhead=" +
			(letter_head ? "0" : "1");

		if (letter_head) {
			url += "&letterhead=" + encodeURIComponent(letter_head);
		}

		url = appendDebugPrintParam(url, debugPrint);

		if (debugPrint) {
			console.log("[POSA][Print] Opening URL:", url);
		}

		const printOptions = {
			triggerPrint: "1",
			debugPrint,
			debugInfo: {
				printFormat: pf || "Standard",
				templatePath: "online-printview",
			},
		};

		if (openInNewTab) {
			let newTabUrl =
				basePrintUrl +
				"?doctype=" +
				encodeURIComponent(doctype) +
				"&name=" +
				encodeURIComponent(lastInvoiceId) +
				"&trigger_print=0" +
				"&format=" +
				encodeURIComponent(pf || "Standard") +
				"&no_letterhead=" +
				(letter_head ? "0" : "1");

			if (letter_head) {
				newTabUrl += "&letterhead=" + encodeURIComponent(letter_head);
			}

			newTabUrl = appendDebugPrintParam(newTabUrl, debugPrint);
			const printWindow = window.open(newTabUrl, "_blank");
			if (printWindow) {
				watchPrintWindow(printWindow, {
					...printOptions,
					triggerPrint: "0",
					shouldPrint: false,
					showSessionMessage: false,
				});
				return;
			}
			console.warn(
				"Popup blocked while opening print preview tab, falling back to browser print",
			);
			frappe?.show_alert?.(
				{
					message:
						"Popup blocked while opening print preview. Continuing with browser print.",
					indicator: "orange",
				},
				5,
			);
			const fallbackPrintWindow = window.open(url, "Print");
			if (fallbackPrintWindow) {
				watchPrintWindow(fallbackPrintWindow, printOptions);
				return;
			}
			silentPrint(url, printOptions);
			return;
		}

		if (useSilentPrint) {
			try {
				await printDocumentViaQz({
					doctype,
					name: lastInvoiceId,
					printFormat: pf || "Standard",
					letterhead: letter_head || null,
					noLetterhead: letter_head ? "0" : "1",
					printerName: posProfile.posa_qz_printer_name || undefined,
				});
				return;
			} catch (error) {
				notifyQzPrintFallback(error, "reprint-last");
			}
			silentPrint(url, printOptions);
			return;
		}

		const printWindow = window.open(url, "Print");
		if (printWindow) {
			watchPrintWindow(printWindow, printOptions);
			return;
		}

		console.warn("Popup blocked or failed to open print window");
		frappe?.show_alert?.(
			{
				message: __(
					"Could not open the print window — check the browser's popup blocker.",
				),
				indicator: "red",
			},
			6,
		);
	}

	return {
		printLastInvoice,
	};
}
