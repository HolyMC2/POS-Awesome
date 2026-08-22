/**
 * The register status line, as a pure function (convergence checklist item A,
 * `Main.dc.html` nodes 13-19).
 *
 * The artboard replaces the navbar's status ICONS with legible text, and the
 * difference is not decoration. An icon says "printer"; the artboard says
 * "Impresora lista". An icon says "wifi"; the artboard says "En línea ·
 * sincronizado" — and those are two different facts. The second one is the
 * one that matters to somebody about to close a shift, because it is a claim
 * about whether the money already taken has reached the server.
 *
 * Which is why this is a module and not a template. `En línea · sincronizado`
 * must be impossible to render while the offline queue still holds invoices,
 * and a guard that lives in a `v-if` is a guard that the next person editing
 * the markup can delete without noticing what it was for.
 *
 * Pure by construction: no Vue, no store, no `__()`, no `new Date()` without
 * being handed one. Labels come out as translation KEYS with parameters and
 * the component calls `__()` on them — the same contract `bandState.ts` uses,
 * so the two strips cannot drift into different habits.
 *
 * Context-shifting is the artboard's, not an invention: `Main` shows the
 * ticket folio, `Apertura` shows "Abrir turno" with a subtitle explaining
 * that the register cannot charge yet, and `Corte` shows the shift span with
 * its duration. Read those three .dc.html files before changing the shape.
 */

export type StatusTone = "neutral" | "positive" | "warning";

/** Which screen the strip is describing. The artboard draws three. */
export type RegisterContext = "sale" | "opening" | "closing";

export interface StatusChip {
	/** Stable id — the evidence lane and the tests select on it. */
	id: string;
	/** Translation key; the component calls `__()`. */
	labelKey: string;
	/** `{0}`-style interpolation values, in order. */
	labelParams?: (string | number)[];
	tone: StatusTone;
	/** Tabular figures — dates, money, folios. */
	mono?: boolean;
}

export interface RegisterStatusLine {
	/** Folio, or the name of the thing being done. */
	titleKey: string;
	titleParams?: (string | number)[];
	/** Whether the title is a literal value (a folio) rather than a phrase. */
	titleIsLiteral: boolean;
	subtitleKey: string;
	subtitleParams?: (string | number)[];
	chips: StatusChip[];
}

export interface RegisterStatusInput {
	context?: RegisterContext;
	/** Current invoice name, e.g. `ACC-SINV-2026-00042`. */
	ticketName?: string | null;
	/** POS Profile name — the artboard's "Doco Ventas". */
	profileName?: string | null;
	/** The register/till within the profile — the artboard's "Caja 2". */
	registerLabel?: string | null;
	cashierName?: string | null;
	/** `POS Opening Shift.period_start_date`. */
	shiftStart?: string | null;
	/** Injected so the clock is testable; never called for free. */
	now?: Date | null;
	/** Locale for date formatting; falls back to the runtime default. */
	locale?: string | null;
	/**
	 * Invoices closed on this register today. `null` means NOT AVAILABLE —
	 * there is no read model for it (see the report). A null omits the chip
	 * rather than rendering a zero, because "0 tickets hoy" is a claim and
	 * "we do not know" is not.
	 */
	ticketsToday?: number | null;
	/** `usePrintHealthShared().rollup` — only meaningful with silent print on. */
	printerStatus?: "ok" | "warn" | "fail" | "unknown";
	usesSilentPrint?: boolean;
	/** `useOnlineStatus().isOnline` — server reachability, not `navigator.onLine`. */
	online?: boolean;
	/** Offline queue depth. Anything above zero forbids the synced claim. */
	pendingCount?: number;
	/** Pre-formatted saldo balance, or null when the app is not installed. */
	saldoLabel?: string | null;
	/** Below the rail's breakpoint the strip sheds everything but identity. */
	compact?: boolean;
}

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * `vie 22 ago · 19:52`. Weekday and month abbreviated, 24-hour clock — the
 * artboard's format, and the one a Mexican counter reads without thinking.
 */
export function formatClock(now: Date | null | undefined, locale?: string | null): string {
	if (!now || Number.isNaN(now.getTime())) {
		return "";
	}
	const tag = text(locale) || undefined;
	try {
		const day = new Intl.DateTimeFormat(tag, {
			weekday: "short",
			day: "numeric",
			month: "short",
		}).format(now);
		const time = new Intl.DateTimeFormat(tag, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(now);
		return `${day.replace(/\.$/, "")} · ${time}`;
	} catch {
		return "";
	}
}

/** `09:02` from a Frappe datetime string, without dragging a date library in. */
export function formatShiftStart(value: string | null | undefined, locale?: string | null): string {
	const raw = text(value);
	if (!raw) {
		return "";
	}
	// Frappe hands back "YYYY-MM-DD HH:mm:ss[.ffffff]" in site-local time.
	// Reading the clock off the string keeps it local; `new Date(raw)` would
	// re-interpret it against the browser's zone and shift an early shift into
	// the previous day, which is exactly the kind of quiet wrongness a corte
	// screen must not have.
	const match = /(\d{1,2}):(\d{2})/.exec(raw);
	if (match) {
		return `${match[1]!.padStart(2, "0")}:${match[2]}`;
	}
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	try {
		return new Intl.DateTimeFormat(text(locale) || undefined, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(parsed);
	} catch {
		return "";
	}
}

/**
 * The identity subtitle: `Doco Ventas · Caja 2 · Jenni · turno desde 09:02`.
 *
 * Every segment is optional and an absent one is DROPPED, not rendered as a
 * gap or as "undefined". A register that has not answered its bootstrap yet
 * is a normal state at 8am, not an error worth showing the cashier.
 */
function identitySegments(input: RegisterStatusInput): string[] {
	const segments: string[] = [];
	if (!input.compact) {
		const profile = text(input.profileName);
		if (profile) segments.push(profile);
	}
	const register = text(input.registerLabel);
	if (register) segments.push(register);
	const cashier = text(input.cashierName);
	if (cashier) segments.push(cashier);
	return segments;
}

/**
 * The connection chip, and the only one here that can lie about money.
 *
 * Three states, deliberately not two:
 *  - offline                     → `Sin conexión`, warning
 *  - online with a queue         → `Por subir · {0}`, warning
 *  - online with an empty queue  → `En línea · sincronizado`, positive
 *
 * The middle state is the point. "En línea" is true the moment the network
 * returns, but the invoices taken while it was gone have not reached the
 * server yet, and a cashier reading "sincronizado" would close the shift on
 * that promise. When the two facts disagree the weaker one wins.
 */
function connectionChip(input: RegisterStatusInput): StatusChip {
	const pending = Math.max(0, Number(input.pendingCount) || 0);
	if (input.online === false) {
		return { id: "connection", labelKey: "No connection", tone: "warning" };
	}
	if (pending > 0) {
		return {
			id: "connection",
			labelKey: "To upload · {0}",
			labelParams: [pending],
			tone: "warning",
		};
	}
	if (input.compact) {
		return { id: "connection", labelKey: "Online", tone: "positive" };
	}
	return { id: "connection", labelKey: "Online · synced", tone: "positive" };
}

/**
 * Printer, only where silent printing is configured. A register that prints
 * through the browser dialog has no "ready" state to report, and a chip that
 * is always grey teaches the operator to stop reading the row.
 */
function printerChip(input: RegisterStatusInput): StatusChip | null {
	if (!input.usesSilentPrint) return null;
	const status = input.printerStatus ?? "unknown";
	if (status === "unknown") return null;
	if (status === "ok") {
		return { id: "printer", labelKey: "Printer ready", tone: "neutral" };
	}
	return {
		id: "printer",
		labelKey: status === "warn" ? "Printer needs attention" : "Printer unavailable",
		tone: "warning",
	};
}

export function resolveRegisterStatusLine(
	input: RegisterStatusInput = {},
): RegisterStatusLine {
	const context: RegisterContext = input.context ?? "sale";
	const segments = identitySegments(input);
	const shiftStart = formatShiftStart(input.shiftStart, input.locale);

	// Title. The artboard names the ACTION when there is no sale to name, and
	// the folio when there is — so the strip always answers "what is this
	// register doing right now" rather than showing an empty slot.
	let titleKey = "New sale";
	let titleParams: (string | number)[] | undefined;
	let titleIsLiteral = false;
	if (context === "opening") {
		titleKey = "Open shift";
	} else if (context === "closing") {
		titleKey = "Cash count";
	} else {
		const ticket = text(input.ticketName);
		if (ticket) {
			titleKey = ticket;
			titleIsLiteral = true;
		}
	}

	// Subtitle. `Apertura` replaces the shift clause with the reason the
	// register cannot charge yet — the artboard's own words, and a better use
	// of the line than a blank where a time would go.
	let subtitleKey = "{0}";
	let subtitleParams: (string | number)[] = [segments.join(" · ")];
	if (context === "opening") {
		subtitleKey = segments.length
			? "{0} · until you open the shift this register cannot charge"
			: "Until you open the shift this register cannot charge";
		subtitleParams = segments.length ? [segments.join(" · ")] : [];
	} else if (shiftStart) {
		subtitleKey = segments.length ? "{0} · shift since {1}" : "Shift since {0}";
		subtitleParams = segments.length ? [segments.join(" · "), shiftStart] : [shiftStart];
	} else if (!segments.length) {
		subtitleKey = "";
		subtitleParams = [];
	}

	const chips: StatusChip[] = [];

	// Clock: desktop only. The phone paints its own, and the artboard's mobile
	// boards drop it.
	if (!input.compact) {
		const clock = formatClock(input.now ?? null, input.locale);
		if (clock) {
			chips.push({ id: "clock", labelKey: clock, tone: "neutral", mono: true });
		}
		if (typeof input.ticketsToday === "number" && Number.isFinite(input.ticketsToday)) {
			chips.push({
				id: "tickets-today",
				labelKey: "{0} tickets today",
				labelParams: [input.ticketsToday],
				tone: "neutral",
			});
		}
		const printer = printerChip(input);
		if (printer) chips.push(printer);
	}

	chips.push(connectionChip(input));

	const saldo = text(input.saldoLabel);
	if (saldo) {
		chips.push({ id: "saldo", labelKey: saldo, tone: "warning", mono: true });
	}

	return { titleKey, titleParams, titleIsLiteral, subtitleKey, subtitleParams, chips };
}

/**
 * Exported so the strip and its tests agree on what "claims to be synced"
 * means without either restating the rule.
 */
export function claimsSynced(line: RegisterStatusLine): boolean {
	return line.chips.some(
		(chip) => chip.id === "connection" && chip.labelKey.includes("synced"),
	);
}
