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
	/**
	 * What survives when the bar runs out of room. 1 never drops; higher
	 * numbers drop first.
	 *
	 * The strip drops WHOLE chips by priority rather than ellipsing or
	 * clipping them, because a value cut mid-word ("Online · synce") reads as
	 * a bug rather than as a design, and a half-rendered claim about money is
	 * worse than an absent one. Losing "31 tickets hoy" off a narrow register
	 * is survivable; losing the connection state is not.
	 */
	priority: number;
	/** Translation key; the component calls `__()`. */
	labelKey: string;
	/** `{0}`-style interpolation values, in order. */
	labelParams?: (string | number)[];
	tone: StatusTone;
	/** Tabular figures — dates, money, folios. */
	mono?: boolean;
	/** mdi icon name; with `iconOnly` the label moves to the tooltip. */
	icon?: string;
	/**
	 * Render the icon alone and keep the words as the tooltip (critique E1).
	 * For a fact that is true ALL DAY, a text pill is wallpaper — it devalues
	 * the chips beside it. The icon states "degraded" at a glance; the moments
	 * where it matters (opening readiness, the cobro header, the fire verdict)
	 * carry the full words.
	 */
	iconOnly?: boolean;
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
	/**
	 * NOT rendered here. The avatar chip in the actions row owns the cashier's
	 * name, because there the name is the LABEL OF A CONTROL — clicking it
	 * switches cashier — while here it would be a third restatement of a fact
	 * already on screen twice. Kept in the interface so the ownership decision
	 * is visible at the point someone would otherwise re-add it.
	 */
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
	/**
	 * The bar ALSO carries a dedicated connection indicator (the phone
	 * navbar's StatusIndicator circle sits in the same row). A nominal
	 * «Online» chip beside it restates it and, on a 390px bar, was the chip
	 * that overflowed under the actions cluster. Only the POSITIVE claim is
	 * dropped: «No connection» and «To upload · N» are warnings about money
	 * and keep their seat whatever else states the connection.
	 */
	connectionStatedElsewhere?: boolean;
	/** Pre-formatted saldo balance, or null when the app is not installed. */
	saldoLabel?: string | null;
	/** Below the rail's breakpoint the strip sheds everything but identity. */
	compact?: boolean;
	/**
	 * The bar is narrow enough that a LONG identity would cost the chips room.
	 *
	 * The chips have a drop ladder; the identity did not, and it is
	 * `flex: 0 0 auto` — so a tenant with a long profile name («Docomexico
	 * Sucursal Centro Mostrador») pushed the chips clean out of their own box
	 * and under the actions cluster. Measured at 1280: the row stayed ONE row,
	 * as designed, and overflowed sideways instead.
	 *
	 * This flag does NOT drop anything by itself, which is the whole point of
	 * its being separate from `compact`. Measuring the real bar at 1100–1440
	 * put the overflow threshold at roughly a 49-character subtitle, and an
	 * ordinary one («Doco Ventas · Caja 2 · turno desde 09:02») is 40 — so on
	 * almost every register the identity is stated in full at every width, and
	 * a width-only rule would have deleted a fact nobody was short of room for.
	 * The profile name goes only when the identity ACTUALLY overruns
	 * `NARROW_IDENTITY_BUDGET`.
	 *
	 * The profile name is what gives way because it is the most static thing on
	 * the line — the cashier knows which shop they are standing in. The
	 * register and the shift start are the specific facts and they stay.
	 *
	 * Ellipsing was the other option and is still refused: cutting the end of
	 * this subtitle severs the shift start, which is how «turno desde 0…»
	 * shipped once. Dropping a whole word says less; a severed one says wrong.
	 */
	narrow?: boolean;
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
function identitySegments(input: RegisterStatusInput, keepProfile: boolean): string[] {
	const segments: string[] = [];
	if (keepProfile) {
		const profile = text(input.profileName);
		if (profile) segments.push(profile);
	}
	const register = text(input.registerLabel);
	if (register) segments.push(register);
	// `cashierName` is deliberately absent — see the interface. The avatar
	// chip states it, and it states it as a control rather than as prose.
	return segments;
}

/**
 * How long the joined identity may be on a narrow bar before the profile name
 * has to go.
 *
 * A measured number, not a guessed one. Rendering the real strip at 1100–1440
 * and lengthening the subtitle until the chips left their box put the break at
 * roughly 49 characters of subtitle; the shift clause («· turno desde 09:02»)
 * accounts for about twenty of those, which leaves this. An ordinary identity
 * («Doco Ventas · Caja 2» — 20) is nowhere near it, and that is deliberate:
 * the budget exists to catch the tenant who named a profile «Docomexico
 * Sucursal Centro Mostrador», not to shorten everyone else's bar.
 *
 * Characters rather than pixels because this module is pure and has no font to
 * measure against. It is a proxy, so it is set with room to spare, and the
 * direction it errs in is keeping a fact rather than dropping one.
 */
export const NARROW_IDENTITY_BUDGET = 28;

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
function connectionChip(input: RegisterStatusInput): StatusChip | null {
	const pending = Math.max(0, Number(input.pendingCount) || 0);
	if (input.online === false) {
		return { id: "connection", labelKey: "No connection", tone: "warning", priority: 1 };
	}
	if (pending > 0) {
		return {
			id: "connection",
			labelKey: "To upload · {0}",
			labelParams: [pending],
			tone: "warning",
			priority: 1,
		};
	}
	// Nominal — sayable by the dedicated indicator when the bar has one.
	if (input.connectionStatedElsewhere) {
		return null;
	}
	if (input.compact) {
		return { id: "connection", labelKey: "Online", tone: "positive", priority: 1 };
	}
	return { id: "connection", labelKey: "Online · synced", tone: "positive", priority: 1 };
}

/**
 * Printer, only where silent printing is configured. A register that prints
 * through the browser dialog has no "ready" state to report, and a chip that
 * is always grey teaches the operator to stop reading the row.
 *
 * The navbar says NOTHING about a healthy printer and only an ICON about a
 * broken one (critique E1). A tablet register with silent print configured
 * but no QZ on the device is degraded all day, every day — and a warning
 * pill that lives in the bar all day is not a warning, it is wallpaper that
 * devalues the badges beside it. «Impresora lista» was the same problem in
 * reassurance form. The WORDS now live only where printing is about to
 * matter, and each of those moments already has its own surface: opening
 * readiness (shift open), the cobro header (hardwareReadiness), and the
 * fire verdict watch on the salón (B1). Here the fault keeps its seat on
 * the ladder — degraded, at a glance, in one icon's width — and the tooltip
 * still carries the sentence for whoever hovers.
 */
function printerChip(input: RegisterStatusInput): StatusChip | null {
	if (!input.usesSilentPrint) return null;
	const status = input.printerStatus ?? "unknown";
	if (status !== "warn" && status !== "fail") return null;
	return {
		id: "printer",
		labelKey: status === "warn" ? "Printer needs attention" : "Printer unavailable",
		tone: "warning",
		icon: "mdi-printer-off",
		iconOnly: true,
		// An instruction, same shelf as saldo: it drops only when the bar is
		// down to the one claim about money (the connection chip).
		priority: 2,
	};
}

export function resolveRegisterStatusLine(
	input: RegisterStatusInput = {},
): RegisterStatusLine {
	const context: RegisterContext = input.context ?? "sale";
	// A compact (phone) bar never carries the profile name. A narrow desktop
	// one carries it unless the identity it produces is genuinely too long —
	// see `narrow` and `NARROW_IDENTITY_BUDGET`.
	let segments = input.compact ? identitySegments(input, false) : identitySegments(input, true);
	if (input.narrow && !input.compact && segments.join(" · ").length > NARROW_IDENTITY_BUDGET) {
		segments = identitySegments(input, false);
	}
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
			chips.push({ id: "clock", labelKey: clock, tone: "neutral", mono: true, priority: 5 });
		}
		if (typeof input.ticketsToday === "number" && Number.isFinite(input.ticketsToday)) {
			chips.push({
				id: "tickets-today",
				labelKey: "{0} tickets today",
				labelParams: [input.ticketsToday],
				tone: "neutral",
				priority: 4,
			});
		}
		const printer = printerChip(input);
		if (printer) chips.push(printer);
	}

	// Saldo BEFORE the connection chip. The stylesheet has always claimed the
	// connection is "rendered last and therefore clipped last"; it was not —
	// saldo was pushed after it, so on a tenant with the saldo app the chip
	// that must never be lost was the second-to-last thing on the row. Order
	// now matches the reasoning, and `priority` enforces it independently.
	const saldo = text(input.saldoLabel);
	if (saldo) {
		chips.push({ id: "saldo", labelKey: saldo, tone: "warning", mono: true, priority: 2 });
	}

	const connection = connectionChip(input);
	if (connection) chips.push(connection);

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
