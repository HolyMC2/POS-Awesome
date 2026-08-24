/**
 * What a ledger ROW is, and what the day adds up to (build plan §15.3).
 *
 * Split out of `ledgerModel.ts` for size alone — that file passed 500 lines,
 * which this repo does not allow — so the boundary is the one that keeps both
 * halves readable and, more importantly, keeps the dependency one-way: nothing
 * here imports from `ledgerModel.ts`, and `ledgerModel.ts` re-exports all of
 * it, so every caller still has one import and there is no cycle to reason
 * about.
 *
 * Pure by construction, exactly as `ledgerModel.ts` is: no Vue, no store, no
 * `__()`, no `frappe`. The two rules that live in this half:
 *
 * 1. **A figure with no read model is not a figure.** The list payload
 *    (`getInvoiceListFields`) carries name, customer, posting date/time,
 *    totals, status, currency, profile, owner and — on history —
 *    `change_amount`, `is_return`, `return_against`. It carries no tender, no
 *    CFDI state and no opening shift, so `LedgerFigures` has no `stamped` key
 *    and `describeColumns` returns `tender: false`.
 * 2. **`null` is not `0`.** A collection that has not loaded yields `null` and
 *    the view draws a dash. Announcing an empty day the register has not read
 *    is worse than announcing nothing.
 */

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/** Exactly the shape `getInvoiceListFields` returns, plus the draft extras. */
export interface LedgerRowSource {
	name?: string;
	customer?: string;
	customer_name?: string;
	posting_date?: string;
	posting_time?: string;
	grand_total?: number;
	paid_amount?: number;
	outstanding_amount?: number;
	status?: string;
	currency?: string;
	owner?: string;
	due_date?: string;
	is_return?: number | boolean;
	return_against?: string;
	change_amount?: number;
	doctype?: string;
	source?: string;
	[key: string]: unknown;
}

export type LedgerTone = "positive" | "warning" | "negative" | "neutral" | "returned";

export interface LedgerStatus {
	key: string;
	/** English source string; the view wraps it in `__()`. */
	label: string;
	tone: LedgerTone;
}

/** `isOverdue`, restated pure so a spec can reach it without a component. */
export const isRowOverdue = (row: LedgerRowSource, today: string): boolean => {
	const status = String(row?.status || "").toLowerCase();
	if (status.includes("overdue")) return true;
	const dueDate = row?.due_date ? String(row.due_date).slice(0, 10) : "";
	if (!dueDate) return false;
	return dueDate < today && Number(row?.outstanding_amount || 0) > 0;
};

export const isReturnRow = (row: LedgerRowSource): boolean => Boolean(Number(row?.is_return || 0));

/**
 * Status as a chip: a tone AND a word, never a tone alone.
 *
 * `accentDestinations.spec.ts` guards exactly this pairing on the tab layout
 * and the rule is the same here — a colourblind operator has to be able to
 * READ the status, so the tone is decoration on top of a label rather than
 * the label itself.
 */
export const describeStatus = (
	row: LedgerRowSource,
	today: string,
	isDraft = false,
): LedgerStatus => {
	if (isDraft) {
		// Borradores lists whichever document family the header is switched to —
		// «Select S.O» switches it to sales orders — so the chip cannot say
		// "Borrador" over every row on the segment. A submitted, part-billed
		// sales order is not a draft invoice, and only the record knows which it
		// is. Unrecognised source, or none: the old label, unchanged.
		const source = String(row?.source || "invoice").toLowerCase();
		if (source !== "invoice") {
			return { key: source, label: String(row?.status || "Submitted"), tone: "neutral" };
		}
		return { key: "draft", label: "Draft invoice", tone: "neutral" };
	}
	if (isReturnRow(row)) return { key: "returned", label: "Returned invoice", tone: "returned" };
	if (isRowOverdue(row, today)) return { key: "overdue", label: "Overdue invoice", tone: "negative" };

	const status = String(row?.status || "").toLowerCase();
	if (status === "paid") return { key: "paid", label: "Paid invoice", tone: "positive" };
	if (status.includes("partly")) return { key: "partial", label: "Partly paid invoice", tone: "warning" };
	if (status.includes("credit")) return { key: "credited", label: "Credit note issued", tone: "neutral" };
	if (status === "unpaid") return { key: "unpaid", label: "Unpaid invoice", tone: "warning" };
	if (status === "draft") return { key: "draft", label: "Draft invoice", tone: "neutral" };
	// Anything the server invents later reads as itself rather than as a
	// guess: an unknown status rendered as "Pagada" would be a lie.
	return { key: "other", label: String(row?.status || "Draft invoice"), tone: "neutral" };
};

/** `{ user: full_name }`, built from what the client already holds. */
export type CashierDirectory = Readonly<Record<string, string>>;

export const buildCashierDirectory = (
	employees: ReadonlyArray<{ user?: string; full_name?: string }> | null | undefined,
	current?: { user?: string; full_name?: string } | null,
): CashierDirectory => {
	const directory: Record<string, string> = {};
	for (const employee of employees ?? []) {
		const user = String(employee?.user || "");
		const name = String(employee?.full_name || "").trim();
		if (user && name && name !== user) directory[user] = name;
	}
	const currentUser = String(current?.user || "");
	const currentName = String(current?.full_name || "").trim();
	if (currentUser && currentName && currentName !== currentUser) directory[currentUser] = currentName;
	return directory;
};

/**
 * The cashier's display name, or `null`.
 *
 * `null` on purpose rather than the email: §15.2's rule is that the column is
 * dropped rather than filled with an address, and an address is what `owner`
 * is. A directory entry that merely echoes the user id is treated as no
 * entry, which is what `buildCashierDirectory` filters for.
 */
export const resolveCashier = (
	row: LedgerRowSource,
	directory: CashierDirectory,
): string | null => {
	const owner = String(row?.owner || "");
	if (!owner) return null;
	return directory[owner] ?? null;
};

export interface LedgerRow {
	name: string;
	time: string;
	date: string;
	customer: string;
	cashier: string | null;
	amount: number;
	currency: string;
	status: LedgerStatus;
	isReturn: boolean;
	isDraft: boolean;
	isOverdue: boolean;
	/**
	 * The untouched list record. Every intent hands this back to the engine,
	 * because `viewInvoice`, `printInvoice` and `createReturn` read fields
	 * (`doctype`, `source`) a shaped row has no business re-deriving.
	 */
	raw: LedgerRowSource;
}

/** `19:52:03.121` → `19:52`. The seconds are never what a cashier is reading. */
export const shortTime = (value: unknown): string => {
	const raw = String(value ?? "").split(".")[0] ?? "";
	const parts = raw.split(":");
	if (parts.length < 2) return "";
	const hour = Number.parseInt(parts[0] ?? "", 10);
	const minute = Number.parseInt(parts[1] ?? "", 10);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const describeRow = (
	row: LedgerRowSource,
	options: { today: string; directory: CashierDirectory; isDraft?: boolean },
): LedgerRow => {
	const isDraft = Boolean(options.isDraft);
	return {
		name: String(row?.name || ""),
		time: shortTime(row?.posting_time),
		date: row?.posting_date ? String(row.posting_date).slice(0, 10) : "",
		customer: String(row?.customer_name || row?.customer || ""),
		cashier: resolveCashier(row, options.directory),
		amount: Number(row?.grand_total || 0),
		currency: String(row?.currency || ""),
		status: describeStatus(row, options.today, isDraft),
		isReturn: isReturnRow(row),
		isDraft,
		isOverdue: !isDraft && isRowOverdue(row, options.today),
		raw: row,
	};
};

export const describeRows = (
	rows: readonly LedgerRowSource[],
	options: { today: string; directory: CashierDirectory; isDraft?: boolean },
): LedgerRow[] => rows.map((row) => describeRow(row, options));

/**
 * Which optional columns this page can honestly fill.
 *
 * `cashier` is `true` when at least ONE visible row resolves to a name the
 * client is already holding — a column of em dashes teaches nothing and takes
 * 78 px from the customer.
 *
 * `tender` is a constant `false` and stays one until the tender arrives in
 * the SAME call as the rest of the row. It lives in the invoice's `payments`
 * child table; the list read does not touch child tables, and §15.2 forbids a
 * second request per row outright. The panel shows it for the selected row
 * because `viewInvoice` fetches that whole document anyway.
 */
export interface LedgerColumns {
	cashier: boolean;
	tender: false;
}

export const describeColumns = (rows: readonly LedgerRow[]): LedgerColumns => ({
	cashier: rows.some((row) => Boolean(row.cashier)),
	tender: false,
});

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

export interface SoldFigure {
	total: number;
	count: number;
	/** `null` when there is nothing to average, never `0`. */
	average: number | null;
}

export interface ReceivableFigure {
	total: number;
	count: number;
	overdue: number;
}

export interface RefundedFigure {
	total: number;
	count: number;
	withoutTicket: number;
}

/**
 * The three figures the payload can pay for.
 *
 * **`stamped` is deliberately absent.** The artboard draws `Timbrado 28 de
 * 31 · 3 sin CFDI · 137 timbres restantes`, and nothing on the client can
 * source any of the three numbers: no CFDI field is in the list payload, and
 * `cfdiStore.ts` holds catalogs and a stamp state machine but no per-invoice
 * state and no quota. Adding the field is a `loadHistory` edit, which §15.3
 * puts out of scope. A stamped count the cashier repeats to a customer is
 * the worst kind of wrong figure, so there is no key for it here.
 */
export interface LedgerFigures {
	sold: SoldFigure | null;
	receivable: ReceivableFigure | null;
	refunded: RefundedFigure | null;
}

export interface FigureInput {
	/** `null` until the collection has loaded. `null` ≠ `[]`. */
	history: readonly LedgerRowSource[] | null;
	unpaid: readonly LedgerRowSource[] | null;
	today: string;
}

const onToday = (row: LedgerRowSource, today: string): boolean =>
	String(row?.posting_date || "").slice(0, 10) === today;

export const describeFigures = ({ history, unpaid, today }: FigureInput): LedgerFigures => {
	let sold: SoldFigure | null = null;
	let refunded: RefundedFigure | null = null;

	if (history) {
		const sales = history.filter((row) => !isReturnRow(row) && onToday(row, today));
		const total = sales.reduce((sum, row) => sum + Number(row?.grand_total || 0), 0);
		sold = {
			total,
			count: sales.length,
			average: sales.length ? total / sales.length : null,
		};

		// NOT day-scoped, unlike `sold`: §15.2 reads "Devuelto = Σ |grand_total|
		// of returns", and the Devoluciones segment is not a day either — a
		// refund the cashier is chasing is usually yesterday's. The count here
		// and the count on that segment are therefore the same number, which is
		// the point.
		const returns = history.filter((row) => isReturnRow(row));
		refunded = {
			total: returns.reduce((sum, row) => sum + Math.abs(Number(row?.grand_total || 0)), 0),
			count: returns.length,
			withoutTicket: returns.filter((row) => !row?.return_against).length,
		};
	}

	let receivable: ReceivableFigure | null = null;
	if (unpaid) {
		receivable = {
			total: unpaid.reduce((sum, row) => sum + Number(row?.outstanding_amount || 0), 0),
			count: unpaid.length,
			overdue: unpaid.filter((row) => isRowOverdue(row, today)).length,
		};
	}

	return { sold, receivable, refunded };
};

