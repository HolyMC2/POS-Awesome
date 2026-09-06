import {
	getPrintTemplate,
	getTermsAndConditions,
	memoryInitPromise,
} from "./offline/index";
import nunjucks from "nunjucks";
import DOMPurify from "dompurify";

declare const frappe: any;

function htmlText(value: unknown) {
	const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
	return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]!);
}

function safeReceipt(html: string) {
	// Receipts retain layout and rich terms, but never active browser content.
	return "<!DOCTYPE html>" + DOMPurify.sanitize(html, {
		WHOLE_DOCUMENT: true,
		FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "meta", "link"],
		FORBID_ATTR: ["srcdoc"],
	});
}

function normaliseTemplate(template: string) {
	if (!template) return template;
	return template.replace(/"""([\s\S]*?)"""/g, (_, str) => {
		const escaped = str
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\r?\n/g, "\\n");
		return `"${escaped}"`;
	});
}

function attachFormatter(obj: any) {
	if (!obj || typeof obj !== "object" || obj.get_formatted) return;
	obj.get_formatted = function (field: string) {
		return this?.[field];
	};
}

function computePaidAmount(doc: any) {
	if (!doc) return 0;

	const paymentsTotal = (doc.payments || []).reduce(
		(sum: number, p: any) => sum + Math.abs(parseFloat(p.amount) || 0),
		0,
	);

	// A credit sale can carry a deposit. The credit flag does not erase tender.
	return paymentsTotal;
}

function defaultOfflineHTML(invoice: any, terms = "") {
	if (!invoice) return "";

	const itemsRows = (invoice.items || [])
		.map((it: any) => {
			const sn = it.serial_no
				? `<div class="serial">SR.No: ${htmlText(String(it.serial_no).replace(/\n/g, ", "))}</div>`
				: "";
			const marker =
				invoice.posa_show_custom_name_marker_on_print &&
				it.name_overridden
					? " (custom)"
					: "";
			return `<tr>
                <td>${htmlText(it.item_code)}${
					it.item_name && it.item_name !== it.item_code
						? `<div class="item-name">${htmlText(it.item_name)}${marker}</div>`
						: ""
				}${sn}</td>
                <td class="qty">${htmlText(it.qty)} ${htmlText(it.uom)}</td>
                <td class="rate">${htmlText(it.rate)}</td>
                <td class="amount">${htmlText(it.amount)}</td>
            </tr>`;
		})
		.join("");

	const taxesRows = (invoice.taxes || [])
		.map(
			(row: any) => `<tr>
                <td style="width:60%">${htmlText(row.description)}@${htmlText(row.rate)}%</td>
                <td style="width:40%; text-align:right;">${htmlText(row.tax_amount)}</td>
            </tr>`,
		)
		.join("");

	const discountRow = invoice.discount_amount
		? `<tr>
                <td style="width:60%">Discount</td>
                <td style="width:40%; text-align:right;">${htmlText(invoice.discount_amount)}</td>
            </tr>`
		: "";

	const changeRow = invoice.change_amount
		? `<tr>
                <td style="width:60%">Change Amount</td>
                <td style="width:40%; text-align:right;">${htmlText(invoice.change_amount)}</td>
            </tr>`
		: "";

	const termsSection = terms
		? `<div class="terms"><strong>Terms & Conditions</strong><div>${terms}</div></div>`
		: "";

	const paidAmount = computePaidAmount(invoice);

	return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${htmlText(invoice.name)}</title>
    <style>
        body { font-family: Arial, sans-serif; width: 80mm; margin: 0 auto; padding: 5mm; }
        .header { text-align: center; }
        .header h2 { margin: 0; }
        .info { margin-bottom: 4px; }
        .info div { font-size: 12px; line-height: 1.2; }
        table { width: 100%; border-collapse: collapse; }
        th, td { font-size: 12px; padding: 4px 0; border-bottom: 1px dashed #ccc; }
        th { text-align: left; }
        td.qty, td.rate, td.amount { text-align: right; }
        table.totals td { border-bottom: none; }
        .terms { margin-top: 8px; font-size: 10px; }
        .footer { text-align: center; margin-top: 8px; font-size: 11px; }
    </style>
</head>
<body>
    <div class="header">
        <h2>${htmlText(invoice.company || "Invoice")}</h2>
        <p><strong>${invoice.is_duplicate ? "Duplicate" : "Original"}</strong></p>
    </div>
    <div class="info">
        <div><strong>Invoice:</strong> ${htmlText(invoice.name)}</div>
        <div><strong>Date:</strong> ${htmlText(invoice.posting_date)} ${htmlText(invoice.posting_time)}</div>
        <div><strong>Customer:</strong> ${htmlText(invoice.customer_name || invoice.customer)}</div>
        <div><strong>Mobile:</strong> ${htmlText(invoice.contact_mobile)}</div>
        <div><strong>Additional Note:</strong> ${htmlText(invoice.posa_notes)}</div>
        ${invoice.posa_authorization_code ? `<div><strong>Authorization Code:</strong> ${htmlText(invoice.posa_authorization_code)}</div>` : ""}
    </div>
    <table class="items">
        <thead>
            <tr>
                <th style="width:40%">Item</th>
                <th style="width:20%; text-align:right;">Qty</th>
                <th style="width:20%; text-align:right;">Rate</th>
                <th style="width:20%; text-align:right;">Amt</th>
            </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
    </table>
    <table class="totals">
        <tbody>
            ${taxesRows}
            ${discountRow}
            <tr>
                <td style="width:60%"><strong>Total</strong></td>
                <td style="width:40%; text-align:right;">${htmlText(invoice.grand_total)}</td>
            </tr>
            <tr>
                <td style="width:60%">Paid</td>
                <td style="width:40%; text-align:right;">${paidAmount}</td>
            </tr>
            ${changeRow}
        </tbody>
    </table>
    ${termsSection}
    <div class="footer">Thank you, please visit again.</div>
</body>
</html>`;
}

export default async function renderOfflineInvoiceHTML(invoice: any) {
	if (!invoice) return "";

	await memoryInitPromise;

	const template = normaliseTemplate(getPrintTemplate());
	const terms = getTermsAndConditions();
	const doc = {
		...invoice,
		terms: invoice.terms || terms,
		terms_and_conditions: invoice.terms_and_conditions || terms,
	};

	doc.paid_amount = computePaidAmount(doc);
	attachFormatter(doc);
	(doc.items || []).forEach(attachFormatter);
	(doc.taxes || []).forEach(attachFormatter);

	if (!template) {
		console.warn(
			"No offline print template cached; using fallback template",
		);
		return safeReceipt(defaultOfflineHTML(doc, doc.terms_and_conditions));
	}

	try {
		const env = new nunjucks.Environment(null, { autoescape: true });
		env.addFilter("format_currency", (value: unknown, currency: string) => {
			const number =
				typeof value === "number" ? value : parseFloat(String(value));
			if (Number.isNaN(number)) return value;
			try {
				return new Intl.NumberFormat(undefined, {
					style: currency ? "currency" : "decimal",
					currency: currency || undefined,
				}).format(number);
			} catch {
				return currency ? `${currency} ${number}` : String(number);
			}
		});
		env.addFilter("currency", (value: unknown, currency: string) =>
			(env as any).filters.format_currency(value, currency),
		);
		(env as any).getFilter = function (name: string) {
			return (this as any).filters[name] || ((v: unknown) => v);
		};

		const context = {
			doc,
			terms: doc.terms,
			terms_and_conditions: doc.terms_and_conditions,
			_: typeof frappe !== "undefined" && frappe?._ ? frappe._ : (t: string) => t,
			frappe: {
				db: { get_value: () => "", sql: () => [] },
				get_list: () => [],
			},
		};
		return safeReceipt(env.renderString(template, context));
	} catch (e) {
		console.error("Failed to render offline invoice", e);
		return safeReceipt(defaultOfflineHTML(doc, doc.terms_and_conditions));
	}
}
