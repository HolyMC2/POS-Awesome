/**
 * The floor's shared clock and the idle-time vocabulary built on it.
 *
 * A dining room at service is a timing business: the number a waiter cannot get
 * from a list is *how long has this ticket sat untouched*. Spec §3 allows
 * exactly this — a timer escalation layered on top of state, "orthogonal to
 * state" — so it rides its own visual channel (a ring around the tile) and
 * never touches the two channels the canon already spends: opacity carries
 * free/occupied, colour carries the operator's own section semantic.
 *
 * What the clock measures is IDLE time, from the order's `modified`. The floor
 * snapshot projects `modified` but not `creation` (see
 * `api/restaurant/floors.py::_open_orders_for` — `o.creation` appears in the
 * ORDER BY and never in the SELECT), so time-since-opened is not data the
 * client has. Idle time is the more actionable of the two anyway: a table that
 * has not changed in half an hour either wants its cheque or has been
 * forgotten.
 *
 * One interval for the whole board. Forty tiles each holding their own timer is
 * forty wakeups a minute on a tablet that has to stay responsive for the next
 * eight hours.
 *
 * @module posapp/components/floor/floorClock
 */
import { onScopeDispose, ref, type Ref } from "vue";

/** How often the board re-reads the wall clock. */
export const TICK_MS = 30_000;

/** Minutes of no activity at which a ticket starts asking for attention. */
export const WARM_AFTER_MIN = 10;
/** Minutes of no activity at which it is overdue. */
export const LATE_AFTER_MIN = 25;
/** Minutes at which the age ring is full — past this it just stays full. */
export const RING_FULL_MIN = 30;

export type AgeStep = "fresh" | "warm" | "late";

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
let subscribers = 0;

/**
 * Frappe stores naive datetimes in the site's own timezone and serialises them
 * as `YYYY-MM-DD HH:mm:ss`. A POS terminal sits in the venue it bills for, so
 * reading that as local time is right; treating it as UTC would put every
 * ticket hours into the future or the past depending on the venue.
 *
 * The `T` is required — Safari rejects the space-separated form outright, which
 * is the kind of gap that ships fine on the dev's laptop and blanks every timer
 * on the iPad at the pass.
 */
export const parseServerTime = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const normalised = String(value).trim().replace(" ", "T");
	const parsed = Date.parse(normalised);
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Whole minutes since `modified`, or null when the row carries no timestamp —
 * an order queued offline has never been written by the server and has nothing
 * to measure from. Clock skew between terminal and server floors at 0 rather
 * than rendering a negative age.
 */
export const idleMinutes = (
	modified: string | null | undefined,
	at: number = Date.now(),
): number | null => {
	const stamp = parseServerTime(modified);
	if (stamp === null) return null;
	return Math.max(0, Math.floor((at - stamp) / 60_000));
};

export const ageStep = (minutes: number | null): AgeStep => {
	if (minutes === null) return "fresh";
	if (minutes >= LATE_AFTER_MIN) return "late";
	if (minutes >= WARM_AFTER_MIN) return "warm";
	return "fresh";
};

/** The ring's sweep as a fraction of a turn, clamped to one full lap. */
export const ageTurn = (minutes: number | null): number => {
	if (minutes === null || minutes <= 0) return 0;
	return Math.min(1, minutes / RING_FULL_MIN);
};

/**
 * Tile-sized age: minutes with a prime up to the hour, `h:mm` past it. Kept
 * language-neutral because it renders inside a 88px tile where a translated
 * unit would not fit — callers that have room spell it out around this.
 */
export const formatIdleShort = (minutes: number | null): string => {
	if (minutes === null) return "";
	if (minutes < 60) return `${minutes}′`;
	const hours = Math.floor(minutes / 60);
	return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
};

/**
 * The shared tick. Every caller gets the same ref; the interval exists only
 * while at least one component is watching it, so leaving the floor screen
 * stops the wakeups instead of running them behind the cart for the rest of
 * the shift.
 */
export const useFloorClock = (): { now: Ref<number> } => {
	subscribers += 1;
	if (!timer) {
		now.value = Date.now();
		timer = setInterval(() => {
			now.value = Date.now();
		}, TICK_MS);
	}
	onScopeDispose(() => {
		subscribers = Math.max(0, subscribers - 1);
		if (subscribers === 0 && timer) {
			clearInterval(timer);
			timer = null;
		}
	});
	return { now };
};
