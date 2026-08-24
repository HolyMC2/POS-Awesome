import { describe, expect, it } from "vitest";

import {
	describeDay,
	eventLabelKey,
	groupByDay,
	MONTH_LABEL_KEYS,
	toStoryRow,
	truncationNote,
	type OrderStoryEvent,
} from "../src/posapp/components/pos/flows/orden/orderStory";

/**
 * The order story, as sentences.
 *
 * The server sends keys and figures and no prose; this is the half that turns
 * them into a line a counter reads. Three of these tests exist because the
 * obvious implementation of each is wrong in a way a screenshot never shows:
 * `new Date("2026-08-19")` renders as the 18th in Mexico, an unrecognised
 * `step_type` would silently vanish, and a re-sort here would quietly disagree
 * with the endpoint about what a bare date means.
 */

const event = (overrides: Partial<OrderStoryEvent> = {}): OrderStoryEvent => ({
	ts: "2026-08-19 14:22:00",
	kind: "payment",
	topic: "advance",
	amount: 600,
	actor: "jenni@doco.mx",
	detail: "Efectivo",
	doctype: "Payment Entry",
	name: "ACC-PAY-2026-00031",
	...overrides,
});

describe("what an event is called", () => {
	it("names the ones the register has words for", () => {
		expect(eventLabelKey(event())).toBe("Advance paid");
		expect(eventLabelKey(event({ kind: "billing", topic: "invoiced" }))).toBe("Invoiced");
		expect(eventLabelKey(event({ kind: "consumption", topic: "customer_supplied" }))).toBe(
			"Customer's own part fitted",
		);
	});

	it("still renders a step the shop invented itself", () => {
		// taller's `step_type` is a tenant-editable Select. A row whose topic
		// this module has never seen falls back to the kind, because dropping
		// it would hide exactly the steps a shop cared enough to add.
		expect(eventLabelKey(event({ kind: "movement", topic: "Prueba de agua" }))).toBe(
			"Workshop note",
		);
	});

	it("has a last resort for a kind it does not know either", () => {
		expect(eventLabelKey(event({ kind: "something-new", topic: null }))).toBe("Recorded");
	});
});

describe("reading a timestamp", () => {
	it("splits the day from the time", () => {
		const row = toStoryRow(event(), 0);
		expect(row.day).toBe("2026-08-19");
		expect(row.time).toBe("14:22");
	});

	it("reports no time when the source only knew the date", () => {
		// A `posting_date` is "that day, time unknown" — not midnight.
		expect(toStoryRow(event({ ts: "2026-08-22" }), 0).time).toBeNull();
	});

	it("reads the day off the text, never through Date()", () => {
		// `new Date("2026-08-19")` is UTC midnight and renders as the 18th
		// everywhere west of Greenwich, which is all of Mexico.
		expect(describeDay("2026-08-19")).toEqual({
			day: "2026-08-19",
			dayNumber: 19,
			monthKey: "aug",
			year: 2026,
		});
	});

	it("refuses a day it cannot parse rather than guessing one", () => {
		expect(describeDay("")).toBeNull();
		expect(describeDay("19/08/2026")).toBeNull();
		expect(describeDay("2026-13-01")).toBeNull();
	});

	it("keeps the month names in the tenant's language, not the browser's", () => {
		// Twelve keys, translated through `es.csv` like every other word on
		// the screen. `Intl` would follow the operator's laptop instead.
		expect(MONTH_LABEL_KEYS).toHaveLength(12);
		expect(MONTH_LABEL_KEYS[0]).toBe("jan");
		expect(MONTH_LABEL_KEYS[11]).toBe("dec");
	});
});

describe("a row", () => {
	it("keeps the amount only where there is one", () => {
		expect(toStoryRow(event(), 0).amount).toBe(600);
		expect(toStoryRow(event({ kind: "movement", topic: "work_started", amount: null }), 0).amount)
			.toBeNull();
	});

	it("keys on the index, because one document repeats its own name", () => {
		const first = toStoryRow(event(), 0);
		const second = toStoryRow(event(), 1);
		expect(first.key).not.toBe(second.key);
	});

	it("passes the document's own words through untranslated", () => {
		// "Efectivo" is a Mode of Payment the tenant named. Translating it here
		// would rename their own records on screen.
		expect(toStoryRow(event({ detail: "Efectivo" }), 0).detail).toBe("Efectivo");
	});
});

describe("grouping", () => {
	const events = [
		event({ ts: "2026-08-22 11:05:00", kind: "billing", topic: "invoiced" }),
		event({ ts: "2026-08-22 09:14:00", kind: "movement", topic: "work_finished" }),
		event({ ts: "2026-08-19 14:22:00" }),
	];

	it("puts a day's rows under one heading", () => {
		const days = groupByDay(events);
		expect(days).toHaveLength(2);
		expect(days[0]?.rows).toHaveLength(2);
		expect(days[1]?.rows).toHaveLength(1);
	});

	it("does not re-sort what the server already ordered", () => {
		// Two sorts of one list is how a timeline starts disagreeing with the
		// endpoint that produced it — and the server is the side that knows a
		// bare date means "that day, time unknown".
		const shuffled = [events[2]!, events[0]!, events[1]!];
		expect(groupByDay(shuffled).map((day) => day.day)).toEqual([
			"2026-08-19",
			"2026-08-22",
		]);
	});

	it("is empty for a document nothing has happened to", () => {
		expect(groupByDay([])).toEqual([]);
	});
});

describe("saying the story was cut short", () => {
	it("says nothing when it was not", () => {
		expect(truncationNote({ truncated: false, cap: 120 })).toBeNull();
		expect(truncationNote(null)).toBeNull();
	});

	it("names the cap when it was", () => {
		// A timeline that silently stops tells a cashier the account began
		// there, and the oldest row is usually what they are looking for.
		expect(truncationNote({ truncated: true, cap: 120 })).toEqual({
			labelKey: "Showing the {0} most recent events",
			labelParams: [120],
		});
	});
});
