/**
 * The tax pair in the sale footer's money breakdown — `Main.dc.html` node 352,
 * `IVA 16 %  $155.72`, sitting between `Subtotal` and `Descuento`.
 *
 * Why a module and not four lines in the card: it is arithmetic on money, and
 * this repo puts that in a pure module with its own spec every time
 * (`itemPricing.ts`, `discountIntent.ts`, the combo allocation). It is also the
 * one figure in this strip a Mexican cashier reads out loud and an accountant
 * checks afterwards, so it is worth being able to mutation-test.
 *
 * ## Where the rate comes from — never a constant
 *
 * The artboard's `16 %` is that shop's rate, not the product's. Two sources,
 * in this order:
 *
 * 1. **The invoice document's own `taxes` rows**, when it has any. A loaded
 *    draft, a converted order, and anything that has been through the payment
 *    screen carry the rows the server computed.
 * 2. **The cached `Sales Taxes and Charges Template`** named by the POS
 *    Profile's `taxes_and_charges`. `usePosShift` fetches it at shift open and
 *    caches it, online and offline alike. This source is not a nicety: a fresh
 *    sale never round-trips its doc — `update_invoice` is called only by
 *    `update_exchange_rate_on_server` — so without it the pair would be dark on
 *    exactly the path it exists for.
 *
 * ## Why the AMOUNT is derived, never read off the row
 *
 * The rows carry `tax_amount`, and using it would be simpler and wrong: the doc
 * is built once and the cart keeps moving. A tax figure that has stopped
 * tracking the cart, beside a band that has not, is worse than no figure at
 * all. So a row is read for its RATE and the amount is computed against the
 * subtotal on screen right now.
 *
 * ## What it refuses to state
 *
 * Every path below either produces a figure the register can stand behind or
 * returns `null`; there is no third outcome. `null` renders NO pair — not a
 * zero, because `IVA $0.00` is a claim about the ticket, and "we cannot work
 * this out from here" is not that claim.
 */

/** A tax row, as both `Sales Taxes and Charges` and the cached template carry it. */
export interface TaxRateRow {
	rate?: number | string | null;
	description?: string | null;
	included_in_print_rate?: number | boolean | null;
	charge_type?: string | null;
}

export interface TaxTemplate {
	taxes?: readonly (TaxRateRow | null | undefined)[] | null;
}

export interface TaxBreakdown {
	/** The tenant's own name for the tax, carrying its rate — `IVA 16 %`. */
	label: string;
	rate: number;
	/** Tax contained in (inclusive) or added to (exclusive) the subtotal. */
	amount: number;
	/** The pre-tax base — what `Subtotal` means once a tax pair sits beside it. */
	net: number;
	inclusive: boolean;
}

export interface TaxBreakdownInput {
	/** `invoice_doc.taxes`, when the register has a document. */
	docTaxes?: readonly (TaxRateRow | null | undefined)[] | null;
	/** The cached Sales Taxes and Charges Template for this profile. */
	template?: TaxTemplate | null;
	/** The figure the footer is breaking down — the register's live subtotal. */
	subtotal?: number | string | null;
	/**
	 * Translated fallback name, for a template row that left `description`
	 * blank. Passed in rather than looked up so this module stays free of the
	 * i18n global, like every other pure module here.
	 */
	taxLabel: string;
}

/**
 * The only `charge_type` this module can reproduce from a subtotal alone.
 * `Actual`, `On Previous Row Amount` and `On Item Quantity` are compositions
 * that need the doc's own row chain; a partial breakdown is a wrong one.
 */
const ON_NET_TOTAL = "On Net Total";

const truthy = (value: unknown): boolean => value === 1 || value === "1" || value === true;

/**
 * `""` is not zero here. `Number("")` is `0`, and a blank subtotal or a blank
 * `rate` coerced to a confident zero is how a register ends up printing
 * `IVA 0 %` on a ticket that has tax — the one wrong answer this module must
 * never give.
 */
const numeric = (value: unknown): number | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" && value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const rateRows = (rows: readonly (TaxRateRow | null | undefined)[] | null | undefined): TaxRateRow[] =>
	(Array.isArray(rows) ? rows : []).filter(
		(row): row is TaxRateRow => !!row && numeric(row.rate) !== null,
	);

/**
 * Doc rows win over the template: they describe THIS ticket, and a register
 * whose profile changed mid-shift would otherwise state the new template's rate
 * over a document computed under the old one.
 */
const sourceRows = (input: TaxBreakdownInput): TaxRateRow[] => {
	const fromDoc = rateRows(input.docTaxes);
	return fromDoc.length ? fromDoc : rateRows(input.template?.taxes);
};

/** `16` → `16 %`, `8.25` → `8.25 %`. Trailing zeros dropped; the artboard's spacing. */
const formatRate = (rate: number): string => `${Number(rate.toFixed(2))} %`;

/**
 * The tenant's own word for the tax, with the rate beside it.
 *
 * `description` is DATA — a Mexican template says `IVA`, a Colombian one says
 * `IVA` too but at 19, a Spanish one says `IGIC` — so it never goes through
 * `__()`; only the blank-description fallback does, and the caller translates
 * that. The rate is appended only when the description does not already state
 * one, because templates commonly bake it in and `IVA 16% 16 %` is worse than
 * either half on its own.
 */
const labelFor = (row: TaxRateRow, rate: number, fallback: string): string => {
	const description = String(row.description ?? "").trim();
	const name = description || fallback;
	return /\d/.test(name) ? name : `${name} ${formatRate(rate)}`;
};

/**
 * The tax pair for this ticket, or `null` when the register cannot state one.
 *
 * Mutation-tested by `tests/saleFooterTax.spec.ts` against the canvas's own
 * money (ticket `B-04812`: 1,129.00 inclusive at 16 % → 973.28 + 155.72), so
 * the inclusive formula cannot quietly become the exclusive one — the two
 * differ by 25 pesos on that ticket and both look plausible in a screenshot.
 */
export const resolveTaxBreakdown = (input: TaxBreakdownInput): TaxBreakdown | null => {
	const subtotal = numeric(input.subtotal);
	if (subtotal === null) return null;

	const rows = sourceRows(input);
	// Exactly one rate-bearing row. Two rows is either a retención pair or the
	// mixed 0 %-alimentos-beside-16 % ticket §4.2 draws, and splitting the base
	// between them needs a per-ITEM tax category this register does not carry.
	// Stating a split it cannot compute would be a number, not an estimate.
	const [row] = rows;
	if (!row || rows.length !== 1) return null;

	if (String(row.charge_type ?? ON_NET_TOTAL) !== ON_NET_TOTAL) return null;

	const rate = numeric(row.rate);
	if (rate === null) return null;

	const inclusive = truthy(row.included_in_print_rate);
	const divisor = 1 + rate / 100;
	// A −100 % row would divide by zero. It is not a real tax template, but a
	// blank breakdown beats `Infinity` on a counter screen.
	if (inclusive && divisor === 0) return null;

	// Inclusive: the item rates ALREADY carry the tax, so the base is divided
	// out — not `subtotal × rate / 100`, which over-states a 16 % IVA by 16 % of
	// itself (1,129.00 → 180.64 instead of 155.72). Exclusive: the subtotal IS
	// the base and the tax sits on top of it.
	const net = inclusive ? subtotal / divisor : subtotal;
	const amount = inclusive ? subtotal - net : (subtotal * rate) / 100;

	return { label: labelFor(row, rate, input.taxLabel), rate, amount, net, inclusive };
};
