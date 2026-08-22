/**
 * Assembles the ten-point readiness snapshot from what the register already
 * holds (build plan §12 A, roadmap §5.1).
 *
 * `openingReadiness.ts` decides what the answers MEAN. This file finds them,
 * and the split is deliberate: everything here reads caches, live refs and a
 * payload the shift dialog already fetched, so it is impure by nature and has
 * to be defensive by nature. The verdict logic is neither, and it is the half
 * with money behind it, so it stays testable on plain objects.
 *
 * ## No new round trips
 *
 * The moment a shop opens is not the moment to make ten calls. Every source
 * below is either already in memory or already on the wire:
 *
 * | Source                        | Already fetched by            |
 * |-------------------------------|-------------------------------|
 * | `payments_method` rows        | `get_opening_dialog_data`     |
 * | previous shift payload        | `setOpeningStorage` (cache)   |
 * | bootstrap prerequisites       | `setBootstrapSnapshot` (cache)|
 * | cached price-list items       | the catalogue cache           |
 * | offline queue depth           | the write queue (cache)       |
 * | tax template                  | `setTaxTemplate` (cache)      |
 * | printer state                 | qzTray's live refs            |
 *
 * The cache reads describe the register's PREVIOUS shift, which is why every
 * profile-derived group is gated on the cached profile being the same one the
 * cashier just picked. Describing register B's warehouse under register A's
 * name would be worse than saying nothing.
 *
 * ## Nothing here throws
 *
 * This runs on the first screen of the day, in front of a queue. Every read is
 * wrapped, every missing module degrades to "unknown", and a snapshot that
 * could not be collected at all still renders ten honest unverified rows.
 */
import type {
	ReadinessDevice,
	ReadinessInput,
	ReadinessTender,
} from "./openingReadiness";

declare const frappe: any;

/** What the shift dialog knows and this module cannot find on its own. */
export interface ReadinessSources {
	/** The company selected in the dialog. */
	company?: string | null;
	/** The POS Profile selected in the dialog. */
	posProfile?: string | null;
	/** `get_opening_dialog_data().payments_method`, unfiltered. */
	paymentRows?: readonly any[] | null;
}

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

/** Every cache read goes through this. A broken cache is "unknown", never a crash. */
const attempt = <T>(read: () => T, fallback: T): T => {
	try {
		return read();
	} catch {
		return fallback;
	}
};

const attemptAsync = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
	try {
		return await read();
	} catch {
		return fallback;
	}
};

/**
 * The offline barrel is `vi.mock`ed wholesale in several specs, so a named
 * export that exists in production can be `undefined` here. Calling it would
 * take the whole opening screen down for a check that is allowed to be
 * unknown.
 */
const callIfFunction = <T>(fn: unknown, fallback: T, ...args: unknown[]): T => {
	if (typeof fn !== "function") return fallback;
	return attempt(() => (fn as (..._a: unknown[]) => T)(...args), fallback);
};

/* ------------------------------------------------------------------ people */

const sessionCashier = (): string | null =>
	attempt(
		() =>
			text(frappe?.session?.user_fullname) ||
			text(frappe?.boot?.user_fullname) ||
			text(frappe?.session?.user) ||
			null,
		null,
	);

/* ----------------------------------------------------------------- devices */

/**
 * The six devices §5.1 names — scanner, scale, printer, drawer, terminal,
 * customer display — and what this app can actually say about each.
 *
 * Only the printer reports, and only on a register that prints through QZ.
 * `usePrintHealthShared().rollup` is the same six-check rollup the navbar dot
 * reads, so this screen and that dot cannot disagree.
 *
 * Deliberately NOT `qzConnected`: that is a websocket flag, and a tenant that
 * prints through the browser dialog has no tray to connect to. Reading it
 * would paint "the printer did not respond" amber on every such register,
 * forever — a false alarm is how a warning colour stops being read at all.
 * The rollup answers `unknown` until something has actually probed, which is
 * exactly what this screen should show before anything has.
 *
 * Everything else is either a configuration flag (which says what was ASKED
 * for, not what answered) or has no wiring at all:
 *
 * - **scanner** — a keyboard wedge on `document`. A wedge is indistinguishable
 *   from a keyboard until somebody scans something.
 * - **scale** — no integration exists in this app.
 * - **drawer** — no kick command exists; the artboard's "por impresora" is a
 *   description of the hardware, not a channel we can query.
 * - **terminal** — `listEnabledTerminals()` would answer, but it is a call to
 *   the MercadoPago connector, which is exactly the extra round trip this
 *   screen must not make.
 * - **customer display** — the transport publishes one way. A display that
 *   stopped listening looks identical to one that never opened, so the
 *   artboard's "no responde" needs a heartbeat that does not exist yet.
 *
 * Marking those `unverifiable` rather than `ready` is the whole discipline:
 * five configuration flags rendered as five green ticks would be five claims
 * nobody checked.
 */
const collectDevices = async (profile: any): Promise<ReadinessDevice[]> => {
	const devices: ReadinessDevice[] = [];

	// A register that prints through the browser dialog has no readiness to
	// report, so it reports none rather than a guess.
	const silentPrint = profile?.posa_silent_print === 1 || profile?.posa_silent_print === true;
	const rollup = silentPrint
		? await attemptAsync(async () => {
				// Dynamic: the shared instance builds refs and touches Pinia at
				// call time. Nothing on the opening screen should pay for that
				// unless the readiness panel is actually on screen. `refresh()` is
				// NOT called — probing here would be the extra round trip this
				// screen must not make, and the navbar arms the monitor itself
				// once the shift is open.
				const mod: any = await import("../../../composables/core/usePrintHealthShared");
				return text(mod?.usePrintHealthShared?.()?.rollup?.value) || "unknown";
			}, "unknown")
		: "unknown";

	const printerName = text(profile?.posa_qz_printer_name);
	devices.push({
		id: "printer",
		labelKey: "Ticket printer",
		state: rollup === "ok" ? "ready" : rollup === "warn" || rollup === "fail" ? "failed" : "unverifiable",
		// The printer's NAME, never a phrase. "Did not respond" is the check's
		// own translated wording; a Spanish literal built here would ship a
		// string `es.csv`'s single writer never sees.
		detail: printerName || null,
	});

	devices.push(
		{ id: "scanner", labelKey: "Scanner", state: "unverifiable" },
		{ id: "scale", labelKey: "Scale", state: "unverifiable" },
		{ id: "drawer", labelKey: "Cash drawer", state: "unverifiable" },
		{ id: "terminal", labelKey: "Card terminal", state: "unverifiable" },
		{ id: "customerDisplay", labelKey: "Customer display", state: "unverifiable" },
	);

	return devices;
};

/* ----------------------------------------------------------------- tenders */

/**
 * Payment rows for the chosen profile, with whatever account information the
 * server sent.
 *
 * `accountsReported` is false today and that is the finding, not a bug in this
 * function: `get_opening_dialog_data` selects the POS Profile's `payments`
 * child rows, and the accounting account is not one of their fields — it is
 * `Mode of Payment Account.default_account`, keyed by mode AND company. Both
 * spellings are accepted here so the check goes live the moment the field
 * ships, with no change on this side.
 */
const collectTenders = (
	sources: ReadinessSources,
): { rows: ReadinessTender[]; accountsReported: boolean } | null => {
	const all = Array.isArray(sources.paymentRows) ? sources.paymentRows : null;
	if (!all) return null;
	const profile = text(sources.posProfile);
	if (!profile) return null;

	const rows: ReadinessTender[] = [];
	let reported = 0;
	for (const row of all) {
		if (text(row?.parent) !== profile) continue;
		const mode = text(row?.mode_of_payment);
		if (!mode) continue;
		const carriesAccount =
			row && typeof row === "object" && ("account" in row || "default_account" in row);
		if (carriesAccount) reported += 1;
		rows.push({
			mode,
			account: carriesAccount ? text(row.account) || text(row.default_account) : undefined,
		});
	}
	if (!rows.length) return null;
	// Every row or none. A payload where half the rows carry accounts is a
	// shape nobody designed, and guessing which half to trust is how a missing
	// account gets rendered as a pass.
	return { rows, accountsReported: reported === rows.length };
};

/* ------------------------------------------------------------------ fiscal */

/** Highest rate on the cached Sales Taxes and Charges Template, or null. */
const highestTaxRate = (template: any): number | null => {
	const rows = Array.isArray(template?.taxes) ? template.taxes : [];
	let best: number | null = null;
	for (const row of rows) {
		const rate = Number(row?.rate);
		if (!Number.isFinite(rate)) continue;
		if (best === null || rate > best) best = rate;
	}
	return best;
};

/* ------------------------------------------------------------- the snapshot */

export const collectReadinessInput = async (
	sources: ReadinessSources = {},
): Promise<ReadinessInput> => {
	const offlineModule: any = await attemptAsync(
		async () => await import("../../../../offline/index"),
		null,
	);

	const cached: any = callIfFunction(offlineModule?.getOpeningStorage, null);
	const chosenProfile = text(sources.posProfile);
	const cachedProfile = cached?.pos_profile ?? null;
	// The cached payload describes whichever register opened here last. It is
	// only evidence about THIS opening when it is the same register.
	const sameRegister =
		!!chosenProfile && text(cachedProfile?.name) === chosenProfile;
	const profile = sameRegister ? cachedProfile : null;

	const input: ReadinessInput = {};

	/* 1 — mode and branch */
	if (sameRegister && cached && "capability_profile" in cached) {
		const payload = cached.capability_profile;
		const status = text(payload?.resolution?.status);
		input.contract = {
			status:
				status === "invalid"
					? "invalid"
					: payload
						? "resolved"
						: "unconfigured",
			mode: text(payload?.name) || null,
			giro: text(payload?.vertical) || null,
			company: text(sources.company) || text(profile?.company) || null,
		};
	}

	/* 2 — warehouse and price list */
	if (profile) {
		const priceList = text(profile.selling_price_list);
		const pricedItems = priceList
			? callIfFunction<any>(offlineModule?.getCachedPriceListItems, null, priceList)
			: null;
		input.catalogue = {
			warehouse: text(profile.warehouse) || null,
			priceList: priceList || null,
			pricedItems: Array.isArray(pricedItems) ? pricedItems.length : null,
		};
	}

	/* 3 — fiscal posture */
	if (profile) {
		const templateName = text(profile.taxes_and_charges);
		const template = templateName
			? callIfFunction<any>(offlineModule?.getTaxTemplate, null, templateName)
			: null;
		input.fiscal = {
			stampingEnabled: !!profile.posa_cfdi_enable_stamping,
			taxTemplate: templateName || null,
			taxRate: template ? highestTaxRate(template) : null,
			// CFDI version, régimen and timbres restantes are emc's, not this
			// app's. Left null so the check renders what it knows and claims
			// nothing about what it does not.
			cfdiVersion: null,
			regime: null,
			stampsRemaining: null,
		};
	}

	/* 4 — payment methods and their accounts */
	const tenders = collectTenders(sources);
	if (tenders) input.tenders = tenders;

	/* 5 — ticket and document formats */
	if (profile) {
		const rules = Array.isArray(profile.posa_print_format_rules)
			? profile.posa_print_format_rules
			: [];
		const returnRule = rules.find((rule: any) =>
			text(rule?.condition).toLowerCase().includes("return"),
		);
		input.formats = {
			ticketFormat:
				text(profile.print_format_for_online) || text(profile.print_format) || null,
			returnNoteFormat: text(returnRule?.print_format) || null,
			cfdiPdf: !!profile.posa_cfdi_enable_stamping,
		};
	}

	/* 6 — devices */
	input.devices = await collectDevices(profile);

	/* 7 — who sells and who authorises */
	input.people = {
		cashier: sessionCashier(),
		sellerCount: Array.isArray(profile?.applicable_for_users)
			? profile.applicable_for_users.length
			: null,
		// null, not []: the supervisor roster comes from
		// `employees.get_terminal_employees`, which the shell calls only after
		// the shift is open. Reported as the field to add rather than fetched
		// here — one extra call on this screen is one too many.
		authorisers: null,
	};

	/* 8 — test sale — omitted: nothing in this app records one. */

	/* 9 — offline readiness */
	const snapshot: any = callIfFunction(offlineModule?.getBootstrapSnapshot, null);
	if (snapshot) {
		const prerequisites = snapshot.prerequisites || {};
		const missing = Object.keys(prerequisites).filter(
			(key) => prerequisites[key] !== "ready",
		);
		const usage: any = await attemptAsync(
			async () =>
				typeof offlineModule?.getCacheUsageEstimate === "function"
					? await offlineModule.getCacheUsageEstimate()
					: null,
			null,
		);
		input.offline = {
			missingPrerequisites: missing,
			cacheBytes: Number.isFinite(Number(usage?.total)) ? Number(usage.total) : null,
			// Nothing in this app reserves a folio range before going offline.
			foliosReserved: null,
		};
	}

	/* 10 — clear to open */
	// `check_opening_shift` clears the opening cache immediately before this
	// dialog is shown, so an empty cache is the server having said "no shift
	// open for you". A NON-empty cache means the call did not complete — an
	// offline boot keeps it deliberately — which is unknown, not "a shift is
	// open". Never inferring `true` here is on purpose: this check is REQUIRED,
	// so a false positive would wall a register out of its own till.
	const stillCached = callIfFunction(offlineModule?.getOpeningStorage, null) !== null;
	const drafts = await attemptAsync(
		async () =>
			typeof offlineModule?.getWriteQueueDraftReviewCount === "function"
				? Number(await offlineModule.getWriteQueueDraftReviewCount())
				: null,
		null as number | null,
	);
	input.floor = {
		openShift: stillCached ? undefined : false,
		hungDrafts: Number.isFinite(Number(drafts)) ? Number(drafts) : null,
		pendingUploads: callIfFunction<number | null>(
			offlineModule?.getPendingOfflineInvoiceCount,
			null,
		),
	};

	return input;
};
