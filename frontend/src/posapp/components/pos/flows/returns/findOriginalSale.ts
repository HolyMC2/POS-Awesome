/**
 * Finding the original sale — the server half of the Devolución finder.
 *
 * The shipped endpoint answers two of the artboard's four searches and not
 * the other two: `api.invoices.search_invoices_for_return` filters on
 * `invoice_name`, on the customer (name / id / mobile / RFC, OR'd), on a date
 * range and on an amount range. It has NO item filter and no serial filter,
 * and adding one is a backend change in a file this task does not own.
 *
 * So "por artículo o código" and "por serie o IMEI" resolve in two hops, both
 * over surfaces this app already calls:
 *
 *   1. `frappe.client.get_list` over the invoice's CHILD table — the same
 *      generic endpoint `InvoiceManagement.vue`, `PayView.vue` and
 *      `itemService.ts` already use — to turn the typed value into a handful
 *      of candidate invoice names. Frappe checks read permission on the
 *      PARENT doctype for a child-table list, so this grants nothing a
 *      cashier could not already read.
 *   2. the existing `search_invoices_for_return`, once per candidate, so that
 *      company scope, `docstatus`, `is_return` and the return-validity
 *      window are decided by the code that already decides them. Re-deriving
 *      "is this still returnable?" on the client would be a second answer to
 *      a question the server already answers, and the two would drift.
 *
 * That costs N round trips for one search, which is why `CANDIDATE_LIMIT` is
 * small and stated. It is the honest shape of the query until the endpoint
 * grows an item filter; the alternative was a client-side eligibility rule,
 * and a wrong one hands back money for a sale that was already returned.
 */

export interface FrappeCallOptions {
	method: string;
	args: Record<string, unknown>;
}

/** `frappe.call` narrowed to what this module needs — injected so the two-hop
 * search can be tested without a server or a global. */
export type FrappeCall = (options: FrappeCallOptions) => Promise<{ message?: unknown } | undefined>;

export interface FindContext {
	call: FrappeCall;
	company: string;
	posProfileName?: string | null;
	/** "Sales Invoice" or "POS Invoice", per the profile. */
	doctype: string;
}

/** A candidate original sale, exactly as `search_invoices_for_return` sends it. */
export interface OriginalSaleRow {
	name: string;
	doctype?: string;
	company?: string;
	customer?: string;
	customer_name?: string;
	posting_date?: string;
	posting_time?: string;
	grand_total?: number;
	outstanding_amount?: number;
	currency?: string;
	posa_return_valid_upto?: string | null;
	posa_return_expired?: number;
}

export interface FindOutcome {
	rows: OriginalSaleRow[];
	hasMore: boolean;
	/**
	 * Set when the lookup itself failed rather than finding nothing. The
	 * difference matters at a counter: "no hay ventas con ese IMEI" sends the
	 * cashier to another search, "no se pudo buscar" sends them to the manager.
	 */
	error: string | null;
}

/**
 * How many candidate invoices a two-hop search will open before it stops.
 *
 * Ten because each one costs a round trip, and because a cashier holding a
 * physical article is looking for ONE sale — a search that returns fifty is
 * not a shorter path to it. The child-table hop is ordered newest-first, so
 * the ten are the ten most recent, which is where a return lives.
 */
export const CANDIDATE_LIMIT = 10;

const emptyOutcome = (error: string | null = null): FindOutcome => ({
	rows: [],
	hasMore: false,
	error,
});

const asRows = (message: unknown): { rows: OriginalSaleRow[]; hasMore: boolean } => {
	const payload = (message ?? {}) as { invoices?: unknown; has_more?: unknown };
	const invoices = Array.isArray(payload.invoices) ? (payload.invoices as OriginalSaleRow[]) : [];
	return { rows: invoices.filter((row) => Boolean(row?.name)), hasMore: Boolean(payload.has_more) };
};

const searchArgs = (ctx: FindContext, overrides: Record<string, unknown>) => ({
	// Required positionally by the endpoint, so it is always present even when
	// the search is about something else.
	invoice_name: "",
	company: ctx.company,
	page: 1,
	pos_profile: ctx.posProfileName || undefined,
	doctype: ctx.doctype,
	...overrides,
});

const runSearch = async (
	ctx: FindContext,
	overrides: Record<string, unknown>,
): Promise<FindOutcome> => {
	try {
		const response = await ctx.call({
			method: "posawesome.posawesome.api.invoices.search_invoices_for_return",
			args: searchArgs(ctx, overrides),
		});
		const { rows, hasMore } = asRows(response?.message);
		return { rows, hasMore, error: null };
	} catch (error) {
		return emptyOutcome((error as Error)?.message || "search failed");
	}
};

/**
 * Extra filters the finder passes straight through to the endpoint — the date
 * range and amount range the old search form owned.
 *
 * They survive the artboard's redesign as a REFINEMENT of whichever way is
 * active rather than as four more boxes: "use date range to search for older
 * invoices" is real advice the shipped dialog gives, and the artboard's five
 * ways do not replace it. `page` rides here too, which is why pagination
 * quietly applies only where the endpoint paginates — the two-hop searches
 * cap at `CANDIDATE_LIMIT` and always answer `hasMore: false`.
 */
export type FindFilters = Record<string, unknown>;

/** By ticket: the endpoint's own `invoice_name` LIKE. */
export const findByTicket = (
	ctx: FindContext,
	term: string,
	extra: FindFilters = {},
): Promise<FindOutcome> => runSearch(ctx, { ...extra, invoice_name: term });

/**
 * By customer: one field, fanned across the four the endpoint ORs together.
 *
 * The cashier is holding a name, a phone number or an RFC and does not know
 * which box the register wants — asking them to choose is asking them to know
 * the schema. The server already ORs the four, so sending the same string to
 * all of them turns four boxes into one without touching the query.
 */
export const findByCustomer = (
	ctx: FindContext,
	term: string,
	extra: FindFilters = {},
): Promise<FindOutcome> =>
	runSearch(ctx, {
		...extra,
		customer_name: term,
		customer_id: term,
		mobile_no: term,
		tax_id: term,
	});

/** Distinct parents, newest first, capped — the second hop's work list. */
const candidateNames = async (
	ctx: FindContext,
	orFilters: unknown[],
): Promise<{ names: string[]; error: string | null }> => {
	try {
		const response = await ctx.call({
			method: "frappe.client.get_list",
			args: {
				doctype: `${ctx.doctype} Item`,
				parent: ctx.doctype,
				filters: [
					["docstatus", "=", 1],
					["parenttype", "=", ctx.doctype],
				],
				or_filters: orFilters,
				fields: ["parent"],
				order_by: "creation desc",
				// Over-fetch: several rows of one invoice collapse to one
				// candidate, so a flat CANDIDATE_LIMIT here would routinely
				// return two or three distinct sales.
				limit_page_length: CANDIDATE_LIMIT * 5,
			},
		});
		const rows = Array.isArray(response?.message)
			? (response.message as Array<{ parent?: unknown }>)
			: [];
		const names: string[] = [];
		for (const row of rows) {
			const parent = typeof row?.parent === "string" ? row.parent : "";
			if (parent && !names.includes(parent)) {
				names.push(parent);
			}
			if (names.length >= CANDIDATE_LIMIT) break;
		}
		return { names, error: null };
	} catch (error) {
		return { names: [], error: (error as Error)?.message || "lookup failed" };
	}
};

/**
 * Resolve candidate invoice names through the endpoint that owns return
 * eligibility, keeping only exact hits.
 *
 * `invoice_name` is a LIKE, so a candidate `B-047` would also drag in
 * `B-0478`; the equality filter is what keeps the two-hop search from
 * widening the result set it was supposed to narrow.
 */
const resolveCandidates = async (
	ctx: FindContext,
	names: readonly string[],
): Promise<FindOutcome> => {
	if (!names.length) {
		return emptyOutcome();
	}
	const settled = await Promise.all(names.map((name) => runSearch(ctx, { invoice_name: name })));
	const wanted = new Set(names);
	const rows: OriginalSaleRow[] = [];
	const seen = new Set<string>();
	let error: string | null = null;

	for (const outcome of settled) {
		if (outcome.error && !error) error = outcome.error;
		for (const row of outcome.rows) {
			if (!wanted.has(row.name) || seen.has(row.name)) continue;
			seen.add(row.name);
			rows.push(row);
		}
	}

	// Newest first, matching every other list the cashier sees. The candidate
	// order already is, but a parallel resolve returns in completion order.
	rows.sort((a, b) =>
		String(b.posting_date ?? "").localeCompare(String(a.posting_date ?? "")) ||
		b.name.localeCompare(a.name),
	);

	// Only an error with nothing to show is an error: a partial failure that
	// still found the sale should not send the cashier to the manager.
	return { rows, hasMore: false, error: rows.length ? null : error };
};

/** By item or code: matches the item code or the item name as sold. */
export const findByItem = async (ctx: FindContext, term: string): Promise<FindOutcome> => {
	const { names, error } = await candidateNames(ctx, [
		["item_code", "like", `%${term}%`],
		["item_name", "like", `%${term}%`],
	]);
	if (error) return emptyOutcome(error);
	return resolveCandidates(ctx, names);
};

/**
 * By serial or IMEI.
 *
 * `serial_no` on an invoice row is a NEWLINE-SEPARATED list when a line sold
 * several units, so the match has to be a LIKE — an equality filter would
 * find only the sales that happened to move exactly one.
 */
export const findBySerial = async (ctx: FindContext, term: string): Promise<FindOutcome> => {
	const { names, error } = await candidateNames(ctx, [["serial_no", "like", `%${term}%`]]);
	if (error) return emptyOutcome(error);
	return resolveCandidates(ctx, names);
};

/** Dispatch by find-method id. Unknown ids and blank terms find nothing. */
export const runFind = (
	ctx: FindContext,
	methodId: string,
	rawTerm: string,
	extra: FindFilters = {},
): Promise<FindOutcome> => {
	const term = String(rawTerm ?? "").trim();
	if (!term) {
		return Promise.resolve(emptyOutcome());
	}
	switch (methodId) {
		case "ticket":
			return findByTicket(ctx, term, extra);
		case "customer":
			return findByCustomer(ctx, term, extra);
		case "item":
			return findByItem(ctx, term);
		case "serial":
			return findBySerial(ctx, term);
		default:
			// `noReceipt` finds nothing on purpose — it authorises, it does not
			// search. Anything else is a caller bug and must not silently
			// become a ticket search.
			return Promise.resolve(emptyOutcome());
	}
};

/**
 * Who rang the original sale.
 *
 * Neither `search_invoices_for_return` nor `get_invoice_for_return` returns
 * it, and the artboard's "Cajera" row is the one field on the original-sale
 * panel with no data source. `owner` is the closest true answer the server
 * will give without a backend change: the Frappe user who created the
 * document, which on a POS register is the cashier who rang it. Failure is
 * silent by design — a missing name hides one row of a panel; a thrown error
 * would take the whole return with it.
 */
export const fetchSaleCashier = async (
	ctx: FindContext,
	invoiceName: string,
): Promise<string | null> => {
	if (!invoiceName) return null;
	try {
		const response = await ctx.call({
			method: "frappe.client.get_value",
			args: {
				doctype: ctx.doctype,
				filters: { name: invoiceName },
				fieldname: ["owner"],
			},
		});
		const owner = (response?.message as { owner?: unknown } | undefined)?.owner;
		return typeof owner === "string" && owner ? owner : null;
	} catch {
		return null;
	}
};
