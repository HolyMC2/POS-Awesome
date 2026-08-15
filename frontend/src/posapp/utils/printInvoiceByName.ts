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
import { reportPrintPopupBlocked } from "./printPopupBlocked";
import { isOffline } from "../../offline/index";
import { resolvePosPrintPreference } from "../services/printPreference";

declare const frappe: any;

export async function printInvoiceByName(
	profile: any,
	doctype: string,
	name: string,
): Promise<void> {
	if (!name || !profile) return;
	const preference = await resolvePosPrintPreference(doctype, {
		print_format: profile.print_format_for_online || profile.print_format || "Standard",
		backend: profile.posa_silent_print ? "browser_qz" : "system_dialog",
		printer_name: profile.posa_qz_printer_name || "",
		letterhead: profile.letter_head || "",
		no_letterhead: profile.letter_head ? 0 : 1,
	});
	const printFormat = preference.print_format || "Standard";
	const letterHead = preference.letterhead || 0;
	// Audit r2 A9: an explicit no_letterhead in the resolved preference must
	// win — it used to be re-derived from letterhead truthiness alone, so a
	// preference of "letterhead configured but suppressed" was ignored.
	const noLetterhead =
		preference.no_letterhead != null
			? preference.no_letterhead
				? 1
				: 0
			: letterHead
				? 0
				: 1;
	const debugPrint = isDebugPrintEnabled();
	const useSilentPrint = preference.backend === "browser_qz" ||
		(!preference.backend && !!profile.posa_silent_print);
	let url =
		frappe.urllib.get_base_url() +
		"/printview?doctype=" +
		encodeURIComponent(doctype) +
		"&name=" +
		encodeURIComponent(name) +
		"&trigger_print=1&format=" +
		encodeURIComponent(printFormat) +
		"&no_letterhead=" +
		(noLetterhead ? "1" : "0");
	if (letterHead && !noLetterhead) url += "&letterhead=" + encodeURIComponent(letterHead);
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
				letterhead: noLetterhead ? null : letterHead || null,
				noLetterhead: noLetterhead ? "1" : "0",
				printerName: preference.printer_name || undefined,
				widthMm: Number(preference.paper_width_mm || 80),
				copies: Number(preference.copies) || undefined,
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
	if (printWindow) {
		watchPrintWindow(printWindow, printOptions);
	} else {
		reportPrintPopupBlocked("hold-confirm-print");
	}
}
