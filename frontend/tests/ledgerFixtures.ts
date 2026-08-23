/**
 * Shared fixtures for the two Facturas ledger suites (build plan §15.4).
 *
 * `invoiceLedger.spec.ts` covers the pure model and the seam with
 * `InvoiceManagement.vue`; `invoiceLedgerSurface.spec.ts` mounts the four
 * children. Both need the same invoice row and the same collections shape, and
 * two copies of a fixture is two places for a test to start describing an
 * invoice the server would never send.
 *
 * Not a suite: `vitest.config.ts` collects `tests/**\/*.spec.{js,ts}` and
 * `*.test.{js,ts}`, so a plain `.ts` here is a module and nothing else.
 */

import type {
	LedgerCollections,
	LedgerRowSource,
} from "../src/posapp/components/pos/flows/ledger/ledgerModel";
import { buildCashierDirectory } from "../src/posapp/components/pos/flows/ledger/ledgerModel";

export const TODAY = "2026-08-22";

/** A marker no formatter produces, so counting it counts MONEY FIGURES. */
export const MONEY = "¤";
export const formatCurrency = (value: number) => `${MONEY}${Number(value).toFixed(2)}`;
export const formatFloat = (value: number) => String(value);

/** Exactly the shape `getInvoiceListFields` returns — no more, no less. */
export const row = (overrides: Partial<LedgerRowSource> = {}): LedgerRowSource => ({
	name: "B-04812",
	customer: "ALE-001",
	customer_name: "Alejandra Ríos Bautista",
	posting_date: TODAY,
	posting_time: "19:52:03",
	grand_total: 1129,
	paid_amount: 1129,
	outstanding_amount: 0,
	status: "Paid",
	currency: "MXN",
	owner: "jenni@doco.mx",
	is_return: 0,
	doctype: "Sales Invoice",
	...overrides,
});

export const DIRECTORY = buildCashierDirectory(
	[{ user: "jenni@doco.mx", full_name: "Jenni" }],
	null,
);

export const collections = (
	overrides: Partial<Record<string, unknown>> = {},
): LedgerCollections => {
	const empty = { page: [], total: 0, pageNo: 1, pageCount: 1, loaded: [] as LedgerRowSource[] };
	return {
		history: { ...empty, ...((overrides.history as object) ?? {}) },
		partial: { ...empty, ...((overrides.partial as object) ?? {}) },
		drafts: { ...empty, ...((overrides.drafts as object) ?? {}) },
		// The returns tab reads the history collection, so it has none of its
		// own to have loaded.
		returns: { ...empty, loaded: null, ...((overrides.returns as object) ?? {}) },
	} as LedgerCollections;
};

/**
 * `__`, interpolating.
 *
 * A stub that returns the key unchanged would make every "{0} of the {1}
 * loaded" assertion measure the harness instead of the component.
 */
export const translateStub = (value: string, args?: Array<string | number>) =>
	!args || !args.length
		? value
		: value.replace(/\{(\d+)\}/g, (match, index: string) => {
				const replacement = args[Number(index)];
				return replacement === undefined || replacement === null ? match : String(replacement);
			});
