/**
 * The print format for a provider-financed credit sale's ticket.
 *
 * A financed sale prints its provider's down-payment ticket (mercado seeds
 * «Ticket de enganche»; a Credit Provider may name its own), never the
 * register's regular receipt: in the split shape the invoice carries the full
 * credit price, and that figure belongs on the provider's contract, not on the
 * store's ticket.
 *
 * Returns null — "print as usual" — for every other invoice, on registers
 * without credit sales, and whenever the answer cannot be established. The
 * resolver never blocks printing: a failed lookup falls back to the normal
 * format.
 */
import api from "../services/api";
import { useCreditSaleStore } from "../stores/creditSaleStore";

interface CreditTicketInput {
	doc?: Record<string, any> | null;
	doctype?: string | null;
	name?: string | null;
}

const PRINTABLE_DOCTYPES = new Set(["Sales Invoice"]);

export async function resolveCreditTicketFormat(input: CreditTicketInput): Promise<string | null> {
	let store: ReturnType<typeof useCreditSaleStore>;
	try {
		store = useCreditSaleStore();
	} catch {
		return null;
	}
	if (!store.enabled) return null;

	const doctype = input.doctype || input.doc?.doctype || "Sales Invoice";
	if (!PRINTABLE_DOCTYPES.has(doctype)) return null;

	const doc = input.doc;
	if (doc && doc.is_financed !== undefined && doc.is_financed !== null) {
		return store.printFormatFor(doc);
	}

	const name = input.name || doc?.name;
	if (!name) return null;
	try {
		const row = await api.call<Record<string, any>>("frappe.client.get_value", {
			doctype,
			filters: name,
			fieldname: ["is_financed", "credit_provider"],
		});
		return store.printFormatFor(row || null);
	} catch {
		return null;
	}
}
