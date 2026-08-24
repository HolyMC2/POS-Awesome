/**
 * Apertura — the ten-point readiness check, as a pure function
 * (roadmap §5.1, build plan §12 A, artboard `Apertura.dc.html`).
 *
 * The artboard's subtitle is the whole design: *"no se pregunta, se
 * comprueba"*. `OpeningDialog` ASKS — company, profile, opening amounts. This
 * module CHECKS, against the configuration the register already holds, and
 * §5.1's rule decides what each answer costs:
 *
 *     lo opcional avisa; lo necesario detiene
 *
 * A register that opens with a payment method missing its accounting account
 * will take money it cannot post. That is the one point on the list with a
 * money consequence and the reason the view exists at all.
 *
 * ## Three states, four outcomes, and why UNKNOWN is not a fourth kind of pass
 *
 * A check answers `pass`, `fail` or `unknown`. Severity turns that into an
 * outcome: a required `fail` STOPS the opening, an optional `fail` WARNS, and
 * `unknown` does neither — it renders as unverified.
 *
 * `unknown` is load-bearing, not a placeholder. Several of the ten points
 * cannot be answered from anything the register has in hand today (the
 * accounting account behind a mode of payment is the important one — it lives
 * in `Mode of Payment Account`, which no opening payload carries). Rendering
 * those as green would be worse than not checking at all: it would tell a
 * cashier the register verified something nobody verified. So they render as
 * unverified, and they do not count towards the artboard's "9 de 10".
 *
 * Nor does `unknown` block. A register whose checks cannot be evaluated is
 * exactly today's register, and walling it would break every shop to protect
 * one — the gate acquires teeth as the data arrives, never before. What each
 * missing field is, and where it would come from, is recorded on the check
 * that needs it.
 *
 * ## Pure on purpose
 *
 * No Vue, no store, no `__()`, no `Date`, no cache reads. The caller hands in
 * a `ReadinessInput` snapshot and gets a verdict back, which is what lets the
 * whole ten-point matrix be tested without mounting anything and without a
 * live tenant. Labels come out as translation KEYS with `{0}`-style params and
 * the component calls `__()` on them — the same contract `bandState.ts` and
 * `registerStatusLine.ts` use, so the register's three pure modules cannot
 * drift into different habits.
 *
 * Collecting the snapshot from caches, refs and the opening payload is
 * `readinessSnapshot.ts`'s job, deliberately separate: that file is allowed to
 * be defensive and impure, this one is allowed to be tested.
 */

/** The ten points, in the artboard's order. Ids are English (ruling R1). */
export type ReadinessCheckId =
	| "modeAndBranch"
	| "warehouseAndPriceList"
	| "fiscalPosture"
	| "tenderAccounts"
	| "documentFormats"
	| "devices"
	| "peopleAndAuthority"
	| "testSale"
	| "offlineReady"
	| "floorClear";

/** What the evidence said. */
export type ReadinessState = "pass" | "fail" | "unknown";

/** What that costs, once severity is applied. */
export type ReadinessOutcome = "pass" | "warn" | "stop" | "unknown";

export type ReadinessSeverity = "required" | "optional";

/* ------------------------------------------------------------------ input */

/**
 * The resolved capability contract (`vertical.py`'s vocabulary, verbatim).
 *
 * `invalid` is not "unconfigured with extra steps": `assert_capability_
 * configuration` THROWS on it at the money moment, so a register allowed to
 * open on an invalid contract fails at its first sale instead of here.
 */
export interface ReadinessContract {
	status: "resolved" | "invalid" | "unconfigured";
	/** Preset name — the artboard's "Venta al mostrador". */
	mode?: string | null;
	/** Giro — the artboard's "Celulares y accesorios". */
	giro?: string | null;
	/**
	 * The company the shift opens on.
	 *
	 * The artboard says "Sucursal Centro" and there is NO branch field
	 * anywhere in this stack — not on POS Profile, not on the capability
	 * preset. Company is the true nearest fact, so it is rendered AS the
	 * company rather than relabelled "sucursal": a made-up branch name on the
	 * one screen whose promise is that it verifies would be a lie about the
	 * thing it exists to prove.
	 */
	company?: string | null;
}

export interface ReadinessCatalogue {
	warehouse?: string | null;
	priceList?: string | null;
	/**
	 * Whether the named warehouse can actually be sold from — not a group
	 * node, not disabled, and this company's.
	 *
	 * `null` = nobody judged it, which is what any payload the browser holds
	 * can say: three broken warehouses and a working one are the same string.
	 * `get_opening_readiness` is the source that CAN judge, and it is the
	 * reason this field exists rather than being inferred from a name.
	 */
	warehouseSells?: boolean | null;
	/**
	 * Items with a price on this price list. `null` = not counted.
	 *
	 * Zero is deliberately not a failure. An empty count is a fact about the
	 * catalogue, not a fault in the register's configuration, and this check
	 * is REQUIRED — failing it would wall a correctly configured shop out of
	 * its own till. Cache state belongs to the offline point, which is
	 * optional, and that is where an empty catalogue is felt.
	 */
	pricedItems?: number | null;
}

export interface ReadinessFiscal {
	/** POS Profile `posa_cfdi_enable_stamping`. */
	stampingEnabled?: boolean | null;
	/** POS Profile `taxes_and_charges`. */
	taxTemplate?: string | null;
	/** Highest rate on the cached tax template, e.g. `16`. `null` = unknown. */
	taxRate?: number | null;
	/** "4.0". Not derivable in this app — see the check. */
	cfdiVersion?: string | null;
	/** "626 RESICO". Not derivable in this app — see the check. */
	regime?: string | null;
	/** Timbres left. PAC metering lives in emc, never here. */
	stampsRemaining?: number | null;
}

export interface ReadinessTender {
	/** `mode_of_payment`, which is also what the operator reads. */
	mode: string;
	/**
	 * The accounting account resolved for this mode AND this company.
	 * Empty string or `null` means REPORTED AND MISSING — the money failure.
	 * Only meaningful when `accountsReported` is true.
	 */
	account?: string | null;
}

export interface ReadinessTenders {
	rows: readonly ReadinessTender[];
	/**
	 * Whether the payload carried account information at all.
	 *
	 * False is today's answer: `get_opening_dialog_data` returns the POS
	 * Profile's `payments` child rows, and the account is not on them — it is
	 * `Mode of Payment Account.default_account`, keyed by mode AND company.
	 * Until that ships as a field on those rows the check is UNKNOWN, because
	 * "no account key in the payload" and "this mode has no account" are the
	 * same shape in JavaScript and only one of them is a reason not to open.
	 */
	accountsReported: boolean;
}

export interface ReadinessFormats {
	/** POS Profile `print_format` / `print_format_for_online`. */
	ticketFormat?: string | null;
	/**
	 * Whether that format still exists. `null` = nobody looked.
	 *
	 * A dangling link and an unconfigured register both hand the cashier no
	 * ticket, and they are repaired differently — one by picking a format, the
	 * other by restoring the one that was deleted — so the check says which.
	 */
	ticketFormatExists?: boolean | null;
	/** A `posa_print_format_rules` row for returns, when one exists. */
	returnNoteFormat?: string | null;
	/** Whether the register can hand over a CFDI PDF. */
	cfdiPdf?: boolean | null;
}

/**
 * `unverifiable` is not `failed`. The artboard's amber row names a customer
 * display that DID NOT RESPOND; a device this app has no way to interrogate
 * has not failed anything, and colouring it amber would train cashiers to
 * ignore the colour that means "look at this".
 */
export type ReadinessDeviceState = "ready" | "failed" | "unverifiable";

export interface ReadinessDevice {
	id: string;
	/** Translation key for the device's name. */
	labelKey: string;
	state: ReadinessDeviceState;
	/** What it is, or what went wrong — "58 mm", "no responde". Not a key. */
	detail?: string | null;
}

export interface ReadinessPeople {
	/** The cashier about to open, by name. */
	cashier?: string | null;
	/** How many users this profile lets sell. */
	sellerCount?: number | null;
	/**
	 * Names of the users who may authorise exceptions.
	 *
	 * `null` = the roster was never loaded (unknown). `[]` = loaded, and
	 * NOBODY on this register can authorise a discount or a no-receipt
	 * return. The two must stay distinguishable: the second is a finding.
	 */
	authorisers?: readonly string[] | null;
}

export interface ReadinessTestSale {
	performed?: boolean | null;
	/** Human date of the reversal, e.g. "14 de agosto". */
	revertedOn?: string | null;
}

export interface ReadinessOffline {
	/**
	 * Bootstrap prerequisites that are not ready. `null` = no snapshot, so
	 * nothing was measured. `[]` = measured and complete.
	 */
	missingPrerequisites?: readonly string[] | null;
	/** Bytes the register has cached, for the artboard's "18 MB". */
	cacheBytes?: number | null;
	/** Reserved folios. Nothing in this app reserves any — see the check. */
	foliosReserved?: number | null;
}

export interface ReadinessFloor {
	/** A shift still open for this cashier. The server refuses a second one. */
	openShift?: boolean | null;
	/** Queue entries parked for draft review. */
	hungDrafts?: number | null;
	/** Offline invoices still waiting to upload. */
	pendingUploads?: number | null;
}

/**
 * Every group is optional and every absent group means UNKNOWN for its check.
 * That is the whole convention: a caller that cannot answer a point omits it
 * rather than passing a shape that guesses.
 */
export interface ReadinessInput {
	contract?: ReadinessContract | null;
	catalogue?: ReadinessCatalogue | null;
	fiscal?: ReadinessFiscal | null;
	tenders?: ReadinessTenders | null;
	formats?: ReadinessFormats | null;
	devices?: readonly ReadinessDevice[] | null;
	people?: ReadinessPeople | null;
	testSale?: ReadinessTestSale | null;
	offline?: ReadinessOffline | null;
	floor?: ReadinessFloor | null;
}

/* ----------------------------------------------------------------- output */

export interface ReadinessFinding {
	state: ReadinessState;
	/** Translation key for the line under the title. */
	detailKey: string;
	detailParams?: (string | number)[];
	/**
	 * Whatever specifically failed or could not be read, verbatim — a mode of
	 * payment, a device. Names, not keys: `Transferencia` is what this
	 * tenant's register calls it, not something to translate.
	 */
	subjects?: string[];
}

export interface ReadinessCheckDefinition {
	id: ReadinessCheckId;
	/** 1–10, the artboard's numbering. */
	order: number;
	severity: ReadinessSeverity;
	titleKey: string;
	evaluate: (_input: ReadinessInput) => ReadinessFinding;
}

export interface ReadinessCheckResult extends ReadinessFinding {
	id: ReadinessCheckId;
	order: number;
	severity: ReadinessSeverity;
	titleKey: string;
	outcome: ReadinessOutcome;
}

export interface ReadinessVerdict {
	/** All ten, always, in artboard order. */
	checks: ReadinessCheckResult[];
	/** The gate. False when any required check FAILED. */
	canOpen: boolean;
	/** Required failures — the reasons the register may not open. */
	stops: ReadinessCheckResult[];
	/** Optional failures — the ones that warn and let the cashier through. */
	warnings: ReadinessCheckResult[];
	/** Points nothing could verify. Never counted as passes. */
	unknowns: ReadinessCheckResult[];
	/** Points that actually passed — the "9" in "9 de 10". */
	verified: number;
	total: number;
	/** Feeds `bandState`'s `opening` input, which disables OPEN SHIFT on > 0. */
	blockingIssues: number;
}

/* ---------------------------------------------------------------- helpers */

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

const isFilled = (value: unknown): boolean => text(value).length > 0;

const count = (value: unknown): number | null => {
	if (value === null || value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
};

/** Present-but-empty is a finding; absent is unknown. Keep them apart. */
const isAbsent = (group: unknown): boolean =>
	group === null || group === undefined;

/**
 * The verdict rule, as a table rather than a chain of ifs.
 *
 * Two rows, three columns, and every cell is a decision somebody could get
 * wrong: `required.fail` is the only cell that stops the register, and
 * `optional.fail` is the only one that lets a failure through. Both
 * `unknown` cells must stay `unknown` — an unverified point that resolved to
 * `pass` would put a tick beside a check nobody ran, and one that resolved to
 * `stop` would wall every register whose data has not arrived yet.
 */
const OUTCOME: Record<
	ReadinessSeverity,
	Record<ReadinessState, ReadinessOutcome>
> = {
	required: { pass: "pass", fail: "stop", unknown: "unknown" },
	optional: { pass: "pass", fail: "warn", unknown: "unknown" },
};

export const outcomeFor = (
	state: ReadinessState,
	severity: ReadinessSeverity,
): ReadinessOutcome => OUTCOME[severity][state];

/* ----------------------------------------------------------- the ten points */

/**
 * Severity is set here, once, and `tests/readinessVerdict.spec.ts` pins each
 * one by name — invert a single entry and that suite says which.
 *
 * The four REQUIRED points are the four the design names, verbatim: *"Una
 * caja no abre si a una forma de pago le falta cuenta, si el almacén no sirve
 * para vender, si falta el formato del ticket o si al giro le faltan datos."*
 * Nothing was promoted beyond that list on a hunch — except `floorClear`,
 * which is required because the SERVER already refuses: `create_opening_
 * voucher` throws when the cashier still has an open shift, so a register let
 * through here would fail on submit with a stack trace instead of a sentence.
 */
export const READINESS_CHECKS: readonly ReadinessCheckDefinition[] = [
	{
		id: "modeAndBranch",
		order: 1,
		// "si al giro le faltan datos" — an invalid contract is exactly that.
		severity: "required",
		titleKey: "Mode and branch",
		evaluate: ({ contract }) => {
			if (isAbsent(contract)) {
				return {
					state: "unknown",
					detailKey: "The register has not resolved its mode yet",
				};
			}
			const resolved = contract as ReadinessContract;
			if (resolved.status === "invalid") {
				return {
					state: "fail",
					detailKey: "This register's capability profile does not resolve",
				};
			}
			const mode = text(resolved.mode);
			const giro = text(resolved.giro);
			const company = text(resolved.company);
			// `unconfigured` is a legitimate state, not a gap: a profile with no
			// preset linked runs the shipped retail behaviour, which is what most
			// registers do. It passes, and says which one it is.
			if (!mode && !giro) {
				return company
					? {
							state: "pass",
							detailKey: "Standard retail register · {0}",
							detailParams: [company],
						}
					: { state: "pass", detailKey: "Standard retail register" };
			}
			const label = mode || giro;
			return company
				? {
						state: "pass",
						detailKey: "{0} · {1}",
						detailParams: [label, company],
					}
				: { state: "pass", detailKey: "{0}", detailParams: [label] };
		},
	},
	{
		id: "warehouseAndPriceList",
		order: 2,
		// "si el almacén no sirve para vender".
		severity: "required",
		titleKey: "Warehouse and price list",
		evaluate: ({ catalogue }) => {
			if (isAbsent(catalogue)) {
				return {
					state: "unknown",
					detailKey: "The register's warehouse and price list are not loaded yet",
				};
			}
			const resolved = catalogue as ReadinessCatalogue;
			const warehouse = text(resolved.warehouse);
			const priceList = text(resolved.priceList);
			const missing: string[] = [];
			if (!warehouse) missing.push("warehouse");
			if (!priceList) missing.push("priceList");
			if (missing.length) {
				return {
					state: "fail",
					detailKey: !warehouse && !priceList
						? "No warehouse and no price list on this register"
						: !warehouse
							? "This register has no warehouse"
							: "This register has no price list",
					subjects: missing,
				};
			}
			// Only PRESENCE is verified. Whether a warehouse "sirve para vender"
			// — not a group node, not disabled, belonging to the company — is a
			// server-side judgement no opening payload carries, and inventing it
			// from a name would be the exact green tick this view exists to
			// refuse. `get_opening_readiness` judges it and hands the answer in;
			// when nobody judged, `warehouseSells` is null and this check goes on
			// claiming presence alone, exactly as it did before the field existed.
			if (resolved.warehouseSells === false) {
				return {
					state: "fail",
					detailKey: "{0} cannot sell · it is a group, disabled or another company's",
					detailParams: [warehouse],
					subjects: [warehouse],
				};
			}
			const priced = count(resolved.pricedItems);
			if (priced === null) {
				return {
					state: "pass",
					detailKey: "{0} · {1} · priced items not counted",
					detailParams: [warehouse, priceList],
				};
			}
			return {
				state: "pass",
				detailKey: "{0} · {1} · {2} items with a price",
				detailParams: [warehouse, priceList, priced],
			};
		},
	},
	{
		id: "fiscalPosture",
		order: 3,
		// NOT one of the four the design names. A register whose stamping is off
		// still sells legally here — the ticket is handed over now and the
		// factura is stamped later from Facturación — so a fiscal gap warns.
		severity: "optional",
		titleKey: "Fiscal posture",
		evaluate: ({ fiscal }) => {
			if (isAbsent(fiscal)) {
				return {
					state: "unknown",
					detailKey: "The register's fiscal configuration is not loaded yet",
				};
			}
			const resolved = fiscal as ReadinessFiscal;
			const template = text(resolved.taxTemplate);
			const stamping = resolved.stampingEnabled === true;
			// The golden flow's hardest-won lesson, as a check: a register that
			// claims it can stamp while carrying no tax template sells 16% goods
			// untaxed and only discovers it at the PAC.
			if (stamping && !template) {
				return {
					state: "fail",
					detailKey: "Stamping is on but this register has no tax template",
				};
			}
			if (!template) {
				// An exento-only shop and a misconfigured one look identical from
				// here. Refusing to guess is the point of the module.
				return {
					state: "unknown",
					detailKey: "No tax template — cannot tell exempt from unconfigured",
				};
			}
			const rate = resolved.taxRate;
			const parts: (string | number)[] = [template];
			// CFDI version, régimen and timbres restantes are all real facts the
			// artboard shows and this app cannot see: version and régimen live on
			// emc's fiscal documents, and PAC metering is emc's too. They render
			// only when somebody hands them in.
			const extras = [
				text(resolved.cfdiVersion),
				text(resolved.regime),
			].filter(Boolean);
			if (typeof rate === "number" && Number.isFinite(rate)) {
				parts.push(rate);
				return extras.length
					? {
							state: "pass",
							detailKey: "{0} · IVA {1} % · {2}",
							detailParams: [...parts, extras.join(" · ")],
						}
					: {
							state: "pass",
							detailKey: "{0} · IVA {1} %",
							detailParams: parts,
						};
			}
			return {
				state: "pass",
				detailKey: "{0} · rate not read",
				detailParams: parts,
			};
		},
	},
	{
		id: "tenderAccounts",
		order: 4,
		// "si a una forma de pago le falta cuenta". The money check.
		severity: "required",
		titleKey: "Payment methods and their accounts",
		evaluate: ({ tenders }) => {
			if (isAbsent(tenders)) {
				return {
					state: "unknown",
					detailKey: "The register's payment methods are not loaded yet",
				};
			}
			const resolved = tenders as ReadinessTenders;
			const rows = Array.isArray(resolved.rows) ? resolved.rows : [];
			const modes = rows.map((row) => text(row?.mode)).filter(Boolean);
			if (!modes.length) {
				// ERPNext refuses to save a POS Profile with no payment method, so
				// this is a corrupted or partially loaded register either way — and
				// a register with no tender cannot take a peso.
				return {
					state: "fail",
					detailKey: "This register offers no payment method",
				};
			}
			if (resolved.accountsReported !== true) {
				return {
					state: "unknown",
					detailKey: "{0} payment methods · accounting accounts not reported",
					detailParams: [modes.length],
					subjects: modes,
				};
			}
			const without = rows
				.filter((row) => !isFilled(row?.account))
				.map((row) => text(row?.mode))
				.filter(Boolean);
			if (without.length) {
				return {
					state: "fail",
					detailKey: "{0} of {1} with an accounting account · {2} cannot post",
					detailParams: [
						modes.length - without.length,
						modes.length,
						without.join(", "),
					],
					subjects: without,
				};
			}
			return {
				state: "pass",
				detailKey: "{0} · {1} of {1} with an accounting account",
				detailParams: [modes.join(" · "), modes.length],
				subjects: modes,
			};
		},
	},
	{
		id: "documentFormats",
		order: 5,
		// "si falta el formato del ticket".
		severity: "required",
		titleKey: "Ticket and document formats",
		evaluate: ({ formats }) => {
			if (isAbsent(formats)) {
				return {
					state: "unknown",
					detailKey: "The register's print formats are not loaded yet",
				};
			}
			const resolved = formats as ReadinessFormats;
			const ticket = text(resolved.ticketFormat);
			if (!ticket) {
				return {
					state: "fail",
					detailKey: "This register has no ticket format",
				};
			}
			// A NAMED format that no longer exists hands the cashier the same
			// nothing, and only a source that can look up the document knows the
			// difference. `null` — nobody looked — leaves the check where it was.
			if (resolved.ticketFormatExists === false) {
				return {
					state: "fail",
					detailKey: "The ticket format {0} no longer exists",
					detailParams: [ticket],
					subjects: [ticket],
				};
			}
			const extras: string[] = [];
			const returnNote = text(resolved.returnNoteFormat);
			if (returnNote) extras.push(returnNote);
			return {
				state: "pass",
				detailKey: extras.length
					? resolved.cfdiPdf === true
						? "{0} · {1} · CFDI PDF"
						: "{0} · {1}"
					: resolved.cfdiPdf === true
						? "{0} · CFDI PDF"
						: "{0}",
				detailParams: extras.length ? [ticket, extras.join(" · ")] : [ticket],
			};
		},
	},
	{
		id: "devices",
		order: 6,
		// The artboard's own worked example of an optional point: a customer
		// display that does not respond warns and the shift opens anyway.
		severity: "optional",
		titleKey: "Scanner, printer, drawer, terminal and display",
		evaluate: ({ devices }) => {
			if (isAbsent(devices) || !Array.isArray(devices) || !devices.length) {
				return {
					state: "unknown",
					detailKey: "No device reported its state",
				};
			}
			const failed = devices.filter((d) => d?.state === "failed");
			const ready = devices.filter((d) => d?.state === "ready");
			const blind = devices.filter((d) => d?.state === "unverifiable");
			const reporting = failed.length + ready.length;
			if (!reporting) {
				// Everything present, nothing interrogable. That is not a pass.
				return {
					state: "unknown",
					detailKey: "{0} devices, none of them verifiable from here",
					detailParams: [blind.length],
					subjects: blind.map((d) => text(d?.id)).filter(Boolean),
				};
			}
			if (failed.length) {
				return {
					state: "fail",
					detailKey: blind.length
						? "{0} of {1} responding · {2} did not · {3} not verifiable"
						: "{0} of {1} responding · {2} did not",
					detailParams: blind.length
						? [
								ready.length,
								reporting,
								failed.map((d) => text(d?.detail) || text(d?.labelKey) || text(d?.id)).join(", "),
								blind.length,
							]
						: [
								ready.length,
								reporting,
								failed.map((d) => text(d?.detail) || text(d?.labelKey) || text(d?.id)).join(", "),
							],
					subjects: failed.map((d) => text(d?.id)).filter(Boolean),
				};
			}
			return {
				state: "pass",
				detailKey: blind.length
					? "{0} of {1} responding · {2} not verifiable"
					: "{0} of {1} responding",
				detailParams: blind.length
					? [ready.length, reporting, blind.length]
					: [ready.length, reporting],
				subjects: blind.map((d) => text(d?.id)).filter(Boolean),
			};
		},
	},
	{
		id: "peopleAndAuthority",
		order: 7,
		// A register with nobody to authorise still sells; it just cannot take a
		// no-receipt return. That is a warning, not a wall.
		severity: "optional",
		titleKey: "Who sells and who authorises",
		evaluate: ({ people }) => {
			if (isAbsent(people)) {
				return {
					state: "unknown",
					detailKey: "The register's roster is not loaded yet",
				};
			}
			const resolved = people as ReadinessPeople;
			const cashier = text(resolved.cashier);
			const authorisers = resolved.authorisers;
			if (authorisers === null || authorisers === undefined) {
				// The cashier alone is not the point of this check. Half an answer
				// rendered green would claim the authority side was verified.
				return {
					state: "unknown",
					detailKey: cashier
						? "{0} sells · nobody checked who authorises"
						: "The register's roster is not loaded yet",
					detailParams: cashier ? [cashier] : undefined,
				};
			}
			const names = authorisers.map((name) => text(name)).filter(Boolean);
			if (!names.length) {
				return {
					state: "fail",
					detailKey: cashier
						? "{0} sells · nobody on this register can authorise an exception"
						: "Nobody on this register can authorise an exception",
					detailParams: cashier ? [cashier] : undefined,
				};
			}
			return {
				state: "pass",
				detailKey: cashier
					? "{0} sells · {1} authorises"
					: "{1} authorises",
				detailParams: [cashier, names.join(", ")],
				subjects: names,
			};
		},
	},
	{
		id: "testSale",
		order: 8,
		// A certification nicety with no money consequence at open time.
		severity: "optional",
		titleKey: "Test sale and its reversal",
		evaluate: ({ testSale }) => {
			if (isAbsent(testSale)) {
				// Nothing in this app records a certification test sale — no
				// doctype, no field, no marker on the profile. Until one exists
				// this point is honestly unanswerable, and saying so is the only
				// correct render.
				return {
					state: "unknown",
					detailKey: "No test sale is recorded for this register",
				};
			}
			const resolved = testSale as ReadinessTestSale;
			if (resolved.performed !== true) {
				return {
					state: "fail",
					detailKey: "No test sale has been made on this register",
				};
			}
			const on = text(resolved.revertedOn);
			return on
				? {
						state: "pass",
						detailKey: "Made and reversed on {0} · left at zero",
						detailParams: [on],
					}
				: {
						state: "pass",
						detailKey: "Made and reversed · left at zero",
					};
		},
	},
	{
		id: "offlineReady",
		order: 9,
		// Ruling R4 stands: per-surface offline availability is a design claim
		// this app has never measured. Blocking an opening on it would strand
		// registers that work perfectly well online.
		severity: "optional",
		titleKey: "Ready to work offline",
		evaluate: ({ offline }) => {
			if (isAbsent(offline)) {
				return {
					state: "unknown",
					detailKey: "Offline readiness has not been measured on this device",
				};
			}
			const resolved = offline as ReadinessOffline;
			const missing = resolved.missingPrerequisites;
			const mb = (() => {
				const bytes = count(resolved.cacheBytes);
				if (bytes === null) return null;
				return Math.round((bytes / (1024 * 1024)) * 10) / 10;
			})();
			if (missing === null || missing === undefined) {
				return {
					state: "unknown",
					detailKey: "Offline readiness has not been measured on this device",
				};
			}
			const gaps = missing.map((name) => text(name)).filter(Boolean);
			if (gaps.length) {
				return {
					state: "fail",
					detailKey: "Not cached yet: {0}",
					detailParams: [gaps.join(", ")],
					subjects: gaps,
				};
			}
			// Folios: nothing in this app reserves a naming-series range ahead of
			// going offline. The artboard promises it; the code does not do it, so
			// the line does not claim it.
			return mb === null
				? { state: "pass", detailKey: "Catalogue and prices cached on this register" }
				: {
						state: "pass",
						detailKey: "Catalogue and prices cached on this register · {0} MB",
						detailParams: [mb],
					};
		},
	},
	{
		id: "floorClear",
		order: 10,
		// Required, and for a reason nothing else on this list shares: the
		// server refuses. `create_opening_voucher` throws on an existing open
		// shift, so letting this through only moves the failure to a stack
		// trace the cashier cannot read.
		severity: "required",
		titleKey: "Clear to open",
		evaluate: ({ floor }) => {
			if (isAbsent(floor)) {
				return {
					state: "unknown",
					detailKey: "The register has not checked yesterday's shifts",
				};
			}
			const resolved = floor as ReadinessFloor;
			if (resolved.openShift === true) {
				return {
					state: "fail",
					detailKey: "A shift is still open for this cashier · close it first",
				};
			}
			if (resolved.openShift !== false) {
				return {
					state: "unknown",
					detailKey: "The register has not checked yesterday's shifts",
				};
			}
			const drafts = count(resolved.hungDrafts);
			const uploads = count(resolved.pendingUploads);
			// Hung drafts and unsent tickets do NOT stop an opening, deliberately.
			// They belong to a shift that is already over and they upload on their
			// own; refusing to open the till over them would shut a shop to
			// protect bookkeeping that is not at risk. They are reported because a
			// cashier who can see them acts on them.
			const pending: (string | number)[] = [];
			if (drafts !== null && drafts > 0) pending.push(drafts);
			if (uploads !== null && uploads > 0) pending.push(uploads);
			if (drafts !== null && drafts > 0 && uploads !== null && uploads > 0) {
				return {
					state: "pass",
					detailKey:
						"No shift left open · {0} drafts parked · {1} tickets still to upload",
					detailParams: [drafts, uploads],
				};
			}
			if (drafts !== null && drafts > 0) {
				return {
					state: "pass",
					detailKey: "No shift left open · {0} drafts parked",
					detailParams: [drafts],
				};
			}
			if (uploads !== null && uploads > 0) {
				return {
					state: "pass",
					detailKey: "No shift left open · {0} tickets still to upload",
					detailParams: [uploads],
				};
			}
			return {
				state: "pass",
				detailKey: "No shift left open · no parked drafts · nothing to upload",
			};
		},
	},
];

/* ---------------------------------------------------------------- verdict */

/**
 * Runs the ten points and applies the rule.
 *
 * Every call returns all ten results in artboard order, whatever the input —
 * a view that renders only what it could verify would quietly shrink the
 * checklist on exactly the register that needed the whole thing.
 */
export const evaluateReadiness = (
	input: ReadinessInput | null | undefined,
): ReadinessVerdict => {
	const snapshot: ReadinessInput = input ?? {};
	const checks: ReadinessCheckResult[] = READINESS_CHECKS.map((check) => {
		const finding = check.evaluate(snapshot);
		return {
			...finding,
			id: check.id,
			order: check.order,
			severity: check.severity,
			titleKey: check.titleKey,
			outcome: outcomeFor(finding.state, check.severity),
		};
	}).sort((a, b) => a.order - b.order);

	const stops = checks.filter((check) => check.outcome === "stop");
	const warnings = checks.filter((check) => check.outcome === "warn");
	const unknowns = checks.filter((check) => check.outcome === "unknown");
	const verified = checks.filter((check) => check.outcome === "pass").length;

	return {
		checks,
		canOpen: stops.length === 0,
		stops,
		warnings,
		unknowns,
		verified,
		total: checks.length,
		blockingIssues: stops.length,
	};
};
