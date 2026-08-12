declare const frappe: any;

export type ResolvedPrintPreference = {
	print_format?: string;
	backend?: "browser_qz" | "browser_normal" | "system_dialog";
	printer_name?: string;
	paper_width_mm?: number;
	copies?: number;
	letterhead?: string;
	no_letterhead?: number;
};

const terminalKey = () => localStorage.getItem("doco_print_terminal_id") || "";

// Preference resolution rides the pay/print path. frappe.call has no default
// timeout, so a slow or wedged server would hang the receipt after the sale is
// already submitted. Bound it to the plan's 3 s preference-resolve budget and
// fall back to legacy behaviour on timeout — printing must never wait forever.
const PREFERENCE_TIMEOUT_MS = 3000;

export async function resolvePosPrintPreference(
	targetDoctype: string,
	legacy: ResolvedPrintPreference,
): Promise<ResolvedPrintPreference> {
	if (!navigator.onLine || !frappe?.call) return legacy;
	try {
		const request = frappe.call({
			method: "doco.docoutils.printing.preferences.get_my_preference",
			args: { surface: "posawesome", target_doctype: targetDoctype, terminal_key: terminalKey() || null },
		});
		const response = await Promise.race([
			request,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("print-preference timeout")), PREFERENCE_TIMEOUT_MS),
			),
		]);
		return { ...legacy, ...((response as any)?.message?.values || {}) };
	} catch {
		return legacy;
	}
}
