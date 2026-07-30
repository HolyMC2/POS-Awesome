/**
 * The slip the print-setup self-test puts on paper.
 *
 * Deliberately not a sample receipt. Its only job is to be unmistakable
 * from across a counter, so an operator answering "did it print?" is
 * answering about THIS job and not a receipt still in the queue from the
 * last customer. Hence the timestamp and the printer name in large type:
 * a slip printed five minutes ago on the other register can't be mistaken
 * for this one.
 *
 * Kept plain — no images, no barcodes, no gray fills. A self-test that
 * fails because the raster settings are wrong would be diagnosing the
 * wrong thing; interpolation and density belong to the A/B dialog.
 */

function escapeHtml(value: string): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface SelfTestSlipOptions {
	companyName?: string;
	printer?: string;
	terminalLabel?: string;
	at?: Date;
	widthMm?: number;
	/** Caller-supplied translator so the slip speaks the operator's language. */
	translate?: (_value: string) => string;
}

export function buildSelfTestSlipHtml(options: SelfTestSlipOptions = {}): string {
	const {
		companyName = "",
		printer = "",
		terminalLabel = "",
		at = new Date(),
		widthMm = 80,
		translate = (value: string) => value,
	} = options;

	const heading = escapeHtml(translate("PRINT TEST"));
	const confirmLine = escapeHtml(
		translate("If you can read this, printing works."),
	);
	const printerLabel = escapeHtml(translate("Printer"));
	const terminalLine = terminalLabel
		? `<div>${escapeHtml(translate("Terminal"))}: ${escapeHtml(terminalLabel)}</div>`
		: "";
	const stamp = escapeHtml(at.toLocaleString());
	const companyLine = companyName
		? `<div style="font-size:12pt; font-weight:700; text-align:center; margin-bottom:2mm;">${escapeHtml(companyName)}</div>`
		: "";
	const body = `
		${companyLine}
		<div style="text-align:center; border:3px solid #000; padding:4mm; margin-bottom:4mm;">
			<div style="font-size:18pt; font-weight:700; letter-spacing:1px;">${heading}</div>
			<div style="font-size:11pt; margin-top:2mm;">${stamp}</div>
		</div>
		<div style="font-size:11pt; line-height:1.5; text-align:center;">
			<div style="font-weight:700; margin-bottom:3mm;">${confirmLine}</div>
			<div>${printerLabel}: ${escapeHtml(printer || "-")}</div>
			${terminalLine}
		</div>
		<div style="text-align:center; margin-top:5mm; border-top:1px dashed #000; padding-top:3mm; font-size:10pt;">
			${escapeHtml(translate("Return to the POS and confirm what you see."))}
		</div>`;

	// Mirrors buildPrintHtml in services/qzTray.ts: same viewport pin and
	// body inset, so a slip that prints cleanly means real receipts will too.
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
@page { size: ${widthMm}mm auto; margin: 0; }
html { width: ${widthMm}mm; margin: 0; padding: 0; }
body { width: ${widthMm}mm; margin: 0; padding: 0 4mm; box-sizing: border-box; font-size: 10pt; line-height: 1.3; font-family: sans-serif; }
* { box-sizing: border-box; }
</style>
</head>
<body>${body}</body>
</html>`;
}
