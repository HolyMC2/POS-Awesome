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

export async function resolvePosPrintPreference(
	targetDoctype: string,
	legacy: ResolvedPrintPreference,
): Promise<ResolvedPrintPreference> {
	if (!navigator.onLine || !frappe?.call) return legacy;
	try {
		const response = await frappe.call({
			method: "doco.docoutils.printing.preferences.get_my_preference",
			args: { surface: "posawesome", target_doctype: targetDoctype, terminal_key: terminalKey() || null },
		});
		return { ...legacy, ...(response?.message?.values || {}) };
	} catch {
		return legacy;
	}
}
