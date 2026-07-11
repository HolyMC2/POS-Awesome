/**
 * Print a submitted invoice by (doctype, name) using the profile's print
 * pipeline — QZ Tray silent print when configured, silentPrint iframe
 * fallback, else a print window. Mirrors InvoiceManagement.printInvoice so
 * receipts printed after a deferred (held) submission come out identical to
 * a normal checkout print.
 */
import {
	appendDebugPrintParam,
	isDebugPrintEnabled,
	silentPrint,
	watchPrintWindow,
} from "../plugins/print";
import { notifyQzPrintFallback, printDocumentViaQz } from "../services/qzTray";
import { isOffline } from "../../offline/index";

declare const frappe: any;

export async function printInvoiceByName(
	profile: any,
	doctype: string,
	name: string,
): Promise<void> {
	if (!name || !profile) return;
	const printFormat =
		profile.print_format_for_online || profile.print_format || "Standard";
	const letterHead = profile.letter_head || 0;
	const debugPrint = isDebugPrintEnabled();
	const useSilentPrint = !!profile.posa_silent_print;
	let url =
		frappe.urllib.get_base_url() +
		"/printview?doctype=" +
		encodeURIComponent(doctype) +
		"&name=" +
		encodeURIComponent(name) +
		"&trigger_print=1&format=" +
		encodeURIComponent(printFormat) +
		"&no_letterhead=" +
		(letterHead ? "0" : "1");
	if (letterHead) url += "&letterhead=" + encodeURIComponent(letterHead);
	url = appendDebugPrintParam(url, debugPrint);
	const printOptions = {
		allowOfflineFallback: isOffline(),
		triggerPrint: "1",
		debugPrint,
	};
	if (useSilentPrint && !isOffline()) {
		try {
			await printDocumentViaQz({
				doctype,
				name,
				printFormat,
				letterhead: letterHead || null,
				noLetterhead: letterHead ? "0" : "1",
				printerName: profile.posa_qz_printer_name || undefined,
			});
			return;
		} catch (error) {
			notifyQzPrintFallback(error, "hold-confirm-print");
		}
	}
	if (useSilentPrint) {
		silentPrint(url, printOptions);
		return;
	}
	const printWindow = window.open(url, "Print");
	if (printWindow) watchPrintWindow(printWindow, printOptions);
}
