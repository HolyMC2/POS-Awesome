/**
 * The order story, as sentences (server module `api/order_story.py`).
 *
 * The server sends `(ts, kind, topic, amount?, actor?, detail?)` and no prose —
 * see its header for why. This module is the other half of that bargain: it
 * turns those keys into the line a counter reads, «Anticipo $600 — efectivo,
 * 19 ago», and it is pure so the mapping can be checked without a server, a
 * clock or a mount.
 *
 * TWO RULES THAT LOOK LIKE STYLE AND ARE NOT:
 *
 * 1. **An unknown key still renders.** `topic` carries tenant-editable values
 *    in one place — taller's `step_type` is a Select a shop can add options to
 *    — so a row whose key this module has never seen falls back to the kind's
 *    own label plus the server's `detail`. Dropping it would hide exactly the
 *    steps a shop cared enough about to invent.
 * 2. **Dates are formatted from the STRING, never through `new Date()`.**
 *    `new Date("2026-08-19")` is parsed as UTC midnight and renders as the
 *    18th in every timezone west of Greenwich, which is all of Mexico. The
 *    parts are read off the text instead.
 */

/** Server event, verbatim. Nothing is added to it on the wire. */
export interface OrderStoryEvent {
	ts: string;
	kind: string;
	topic?: string | null;
	amount?: number | null;
	actor?: string | null;
	detail?: string | null;
	doctype?: string | null;
	name?: string | null;
}

export interface OrderStoryPayload {
	doctype?: string;
	name?: string;
	events: OrderStoryEvent[];
	truncated: boolean;
	cap: number;
	dropped_undated?: number;
}

export interface OrderStoryRow {
	/** Stable `v-for` key. Timestamps repeat; the index does not. */
	key: string;
	kind: string;
	/** English source string for what happened; the view wraps it in `__()`. */
	labelKey: string;
	/** The document's own words (a mode of payment, an item, a step). */
	detail: string | null;
	amount: number | null;
	actor: string | null;
	/** `YYYY-MM-DD`, for the day heading. */
	day: string;
	/** `HH:MM`, or null when the source only knew the date. */
	time: string | null;
	doctype: string | null;
	name: string | null;
}

/**
 * `kind:topic` → what happened, in register language.
 *
 * A LIST rather than a keyed record so `registerShellTranslations.spec.ts`
 * sees a `labelKey` property and demands Spanish for every one — a record
 * keyed by `payment:advance:` would hide the whole vocabulary from the only
 * thing that would notice it has none.
 */
const EVENT_LABELS: ReadonlyArray<{ match: string; labelKey: string }> = [
	{ match: "created:received", labelKey: "Device received" },
	{ match: "created:ordered", labelKey: "Order placed" },
	{ match: "payment:advance", labelKey: "Advance paid" },
	{ match: "payment:payment", labelKey: "Payment received" },
	{ match: "consumption:stock", labelKey: "Part fitted from stock" },
	{ match: "consumption:ordered", labelKey: "Part fitted, ordered in" },
	{ match: "consumption:customer_supplied", labelKey: "Customer's own part fitted" },
	{ match: "movement:work_started", labelKey: "Work started" },
	{ match: "movement:work_finished", labelKey: "Work finished" },
	{ match: "movement:log", labelKey: "Workshop note" },
	{ match: "billing:invoiced", labelKey: "Invoiced" },
	{ match: "delivery:delivered", labelKey: "Delivered" },
];

/** Fallback per kind, for a `topic` this module has never seen. See rule 1. */
const KIND_LABELS: ReadonlyArray<{ kind: string; labelKey: string }> = [
	{ kind: "created", labelKey: "Opened" },
	{ kind: "payment", labelKey: "Payment received" },
	{ kind: "consumption", labelKey: "Part fitted" },
	{ kind: "movement", labelKey: "Workshop note" },
	{ kind: "billing", labelKey: "Invoiced" },
	{ kind: "delivery", labelKey: "Delivered" },
];

export const eventLabelKey = (event: OrderStoryEvent): string => {
	const exact = EVENT_LABELS.find((entry) => entry.match === `${event.kind}:${event.topic ?? ""}`);
	if (exact) return exact.labelKey;
	return KIND_LABELS.find((entry) => entry.kind === event.kind)?.labelKey ?? "Recorded";
};

/**
 * Month abbreviations, as keys.
 *
 * Not `Intl.DateTimeFormat`: the register's language is the TENANT's, chosen
 * in Frappe, and the browser's locale is the operator's laptop. A Spanish
 * register on an English profile would print "Aug 19" beside "Anticipo".
 */
export const MONTH_LABEL_KEYS: readonly string[] = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

export interface DayHeading {
	day: string;
	/** `{0} {1}` — the day number and the translated month. */
	dayNumber: number;
	monthKey: string;
	year: number;
}

/**
 * Split `YYYY-MM-DD` into parts, by reading the text. See rule 2 in the header
 * for why this is not `new Date(...)`.
 */
export const describeDay = (day: string): DayHeading | null => {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? "").trim());
	if (!match) return null;
	const [, year = "", month = "", date = ""] = match;
	const monthIndex = Number(month) - 1;
	const monthKey = MONTH_LABEL_KEYS[monthIndex];
	if (!monthKey) return null;
	return { day, dayNumber: Number(date), monthKey, year: Number(year) };
};

const splitStamp = (ts: string): { day: string; time: string | null } => {
	const text = String(ts ?? "").trim();
	const [datePart = "", timePart = ""] = text.split(" ");
	const time = /^(\d{2}):(\d{2})/.exec(timePart);
	return { day: datePart, time: time ? `${time[1]}:${time[2]}` : null };
};

export const toStoryRow = (event: OrderStoryEvent, index: number): OrderStoryRow => {
	const { day, time } = splitStamp(event.ts);
	return {
		key: `${index}:${event.doctype ?? event.kind}:${event.name ?? event.ts}`,
		kind: event.kind,
		labelKey: eventLabelKey(event),
		detail: event.detail ?? null,
		amount: typeof event.amount === "number" ? event.amount : null,
		actor: event.actor ?? null,
		day,
		time,
		doctype: event.doctype ?? null,
		name: event.name ?? null,
	};
};

export interface OrderStoryDay {
	heading: DayHeading | null;
	/** The raw day string, for the `v-for` key when the heading cannot parse. */
	day: string;
	rows: OrderStoryRow[];
}

/**
 * Rows grouped under their day, in the order the server sent them.
 *
 * The server already sorted newest-first and this does NOT re-sort: two sorts
 * of one list is how a timeline starts disagreeing with the endpoint that
 * produced it, and the server is the one that knows a bare date means "that
 * day, time unknown".
 */
export const groupByDay = (events: readonly OrderStoryEvent[]): OrderStoryDay[] => {
	const days: OrderStoryDay[] = [];
	events.forEach((event, index) => {
		const row = toStoryRow(event, index);
		const last = days[days.length - 1];
		if (last && last.day === row.day) {
			last.rows.push(row);
			return;
		}
		days.push({ day: row.day, heading: describeDay(row.day), rows: [row] });
	});
	return days;
};

/**
 * What the footer says when the story was cut short.
 *
 * `null` when it was not: a note that always appears stops being read, and
 * this one exists precisely to be noticed on the long accounts where the
 * oldest row is the one somebody is looking for.
 */
export const truncationNote = (
	payload: Pick<OrderStoryPayload, "truncated" | "cap"> | null,
): { labelKey: string; labelParams: (string | number)[] } | null =>
	payload?.truncated
		? { labelKey: "Showing the {0} most recent events", labelParams: [payload.cap] }
		: null;
