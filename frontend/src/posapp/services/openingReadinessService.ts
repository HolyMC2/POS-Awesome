import api from "./api";

import type { ReadinessInput } from "../components/pos/shift/openingReadiness";

/**
 * The Apertura readiness read model, from the SPA's side.
 *
 * One read and nothing else. It exists because the ten-point check could not
 * be answered from the browser at the moment it matters: the register's caches
 * are written when a shift OPENS, so the screen that opens the first shift has
 * nothing to read, and two of the facts it needs — the accounting account
 * behind a mode of payment, and whether a warehouse «sirve para vender» — do
 * not live in any payload the client has ever been handed.
 *
 * ## The shape is the server's, the meaning is not
 *
 * Everything below is snake_case because that is what came off the wire, and
 * `serverReadinessInput` is the only place that translates it into the
 * check's vocabulary. Nothing here decides anything: a `false` from the server
 * is a fact, and what it COSTS is `openingReadiness.ts`'s call, tested there
 * against plain objects.
 *
 * ## An absent group is not an empty one
 *
 * The server omits a group it could not compute. That omission has to survive
 * the mapping, because an omitted group renders as «no verificado» and an
 * empty one would render as a finding — the difference between "nobody
 * checked" and "we checked and it is broken", which is the whole discipline
 * of this screen.
 */

const METHOD = "posawesome.posawesome.api.opening_readiness.get_opening_readiness";

export interface ServerReadinessContract {
	status: "resolved" | "invalid" | "unconfigured";
	mode?: string | null;
	giro?: string | null;
	company?: string | null;
}

export interface ServerReadinessCatalogue {
	warehouse?: string | null;
	price_list?: string | null;
	/** Not a group node, not disabled, this company's. `null` = none named. */
	warehouse_sells?: boolean | null;
	priced_items?: number | null;
}

export interface ServerReadinessFiscal {
	stamping_enabled?: boolean | null;
	tax_template?: string | null;
	tax_rate?: number | null;
}

export interface ServerReadinessTender {
	mode: string;
	/** Empty string means REPORTED AND MISSING — the money failure. */
	account?: string | null;
}

export interface ServerReadinessTenders {
	rows: ServerReadinessTender[];
	accounts_reported: boolean;
}

export interface ServerReadinessFormats {
	ticket_format?: string | null;
	/** `false` = the profile names a format that no longer exists. */
	ticket_format_exists?: boolean | null;
	return_note_format?: string | null;
	cfdi_pdf?: boolean | null;
}

export interface ServerReadinessPeople {
	cashier?: string | null;
	seller_count?: number | null;
	/** A list, always — the server looked. `[]` is a finding, not an absence. */
	authorisers?: string[] | null;
}

export interface ServerReadinessTestSale {
	performed?: boolean | null;
	/** ISO. The server does not know the tenant's date format and says so. */
	reverted_on?: string | null;
	reversal?: string | null;
}

export interface OpeningReadinessPayload {
	pos_profile?: string | null;
	company?: string | null;
	contract?: ServerReadinessContract | null;
	catalogue?: ServerReadinessCatalogue | null;
	fiscal?: ServerReadinessFiscal | null;
	tenders?: ServerReadinessTenders | null;
	formats?: ServerReadinessFormats | null;
	people?: ServerReadinessPeople | null;
	test_sale?: ServerReadinessTestSale | null;
}

/**
 * One register's server-side readiness. Throws like any other call; the caller
 * decides what a refusal means — see `OpeningReadiness.vue`, which treats it
 * as "no answer" and never asks twice.
 */
export function fetchOpeningReadiness(posProfile: string) {
	return api.call<OpeningReadinessPayload>(METHOD, { pos_profile: posProfile });
}

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

const bool = (value: unknown): boolean | null =>
	value === null || value === undefined ? null : Boolean(value);

const count = (value: unknown): number | null => {
	const parsed = Number(value);
	return value === null || value === undefined || !Number.isFinite(parsed)
		? null
		: parsed;
};

/**
 * The server's answer in the check's own vocabulary.
 *
 * Returns a SPARSE `ReadinessInput`: only the groups the server actually
 * carried, and within `fiscal` only the fields it knows about — CFDI version,
 * régimen and timbres restantes are emc's and are deliberately left off, so
 * merging this over a snapshot cannot blank what another source found.
 */
export function serverReadinessInput(
	payload: OpeningReadinessPayload | null | undefined,
): ReadinessInput | null {
	if (!payload || typeof payload !== "object") return null;
	const input: ReadinessInput = {};

	if (payload.contract) {
		const contract = payload.contract;
		input.contract = {
			status:
				contract.status === "invalid"
					? "invalid"
					: contract.status === "unconfigured"
						? "unconfigured"
						: "resolved",
			mode: text(contract.mode) || null,
			giro: text(contract.giro) || null,
			company: text(contract.company) || null,
		};
	}

	if (payload.catalogue) {
		const catalogue = payload.catalogue;
		input.catalogue = {
			warehouse: text(catalogue.warehouse) || null,
			priceList: text(catalogue.price_list) || null,
			warehouseSells: bool(catalogue.warehouse_sells),
			pricedItems: count(catalogue.priced_items),
		};
	}

	if (payload.fiscal) {
		const fiscal = payload.fiscal;
		input.fiscal = {
			stampingEnabled: bool(fiscal.stamping_enabled),
			taxTemplate: text(fiscal.tax_template) || null,
			taxRate: count(fiscal.tax_rate),
		};
	}

	if (payload.tenders && Array.isArray(payload.tenders.rows)) {
		input.tenders = {
			rows: payload.tenders.rows
				.map((row) => ({
					mode: text(row?.mode),
					// `?? ""` and not `|| ""`: an account key the server sent as an
					// empty string is the finding, and it must not read as absent.
					account: typeof row?.account === "string" ? row.account.trim() : "",
				}))
				.filter((row) => row.mode.length > 0),
			accountsReported: payload.tenders.accounts_reported === true,
		};
	}

	if (payload.formats) {
		const formats = payload.formats;
		input.formats = {
			ticketFormat: text(formats.ticket_format) || null,
			ticketFormatExists: bool(formats.ticket_format_exists),
			returnNoteFormat: text(formats.return_note_format) || null,
			cfdiPdf: bool(formats.cfdi_pdf),
		};
	}

	if (payload.people) {
		const people = payload.people;
		input.people = {
			cashier: text(people.cashier) || null,
			sellerCount: count(people.seller_count),
			// `[]` survives as `[]`. The check reads null as "the roster was
			// never loaded" and an empty array as "nobody here can authorise",
			// and only the second is a finding.
			authorisers: Array.isArray(people.authorisers)
				? people.authorisers.map((name) => text(name)).filter(Boolean)
				: null,
		};
	}

	if (payload.test_sale) {
		input.testSale = {
			performed: bool(payload.test_sale.performed),
			revertedOn: text(payload.test_sale.reverted_on) || null,
		};
	}

	return input;
}
