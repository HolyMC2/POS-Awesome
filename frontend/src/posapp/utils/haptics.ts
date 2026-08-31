/**
 * The register's haptics (native-feel round 2).
 *
 * A phone POS is used with the screen half-glanced-at: the cashier is looking
 * at the customer, the shelf or the bag, and the thing that tells them the tap
 * landed is the buzz, not the pixel. That is the whole job of this file — three
 * short patterns, called from the places the ENGINE already treats as the
 * event, never from a component's `@click` for its own sake.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THREE GUARDS, and each of them is a bug that would otherwise ship:
 *
 * 1. `navigator.vibrate` — absent on every iOS browser and on every desktop
 *    Firefox. Calling it unguarded is a TypeError on the add path.
 * 2. `(pointer: coarse)` — a desk register on a mouse must never buzz. Some
 *    laptops DO expose `vibrate` (Chrome ships the API regardless of
 *    hardware); the pointer is what says a hand is on the glass.
 * 3. `localStorage["posa.haptics"] === "off"` — a shop where the phone lives
 *    in an apron pocket next to a sleeping child, or a cashier who simply
 *    hates it. The opt-out is a plain string key so it can be set from the
 *    browser console without a settings screen existing yet.
 *
 * NOTHING here throws. `matchMedia` is absent in jsdom without a stub,
 * `localStorage` throws outright in a Safari private window, and `vibrate`
 * itself throws on a pattern the platform rejects. A haptic that breaks an
 * add is infinitely worse than an add with no haptic, so every guard and the
 * call itself sit inside a `try`.
 */

/** The opt-out. `"off"` disables; anything else (including absent) allows. */
export const HAPTICS_OPT_OUT_KEY = "posa.haptics";
export const HAPTICS_OPT_OUT_VALUE = "off";

/**
 * A single ~8ms pulse: the shortest buzz Android renders as a distinct tick
 * rather than as a hum. One item added, one step up or down.
 */
export const HAPTIC_TICK: number = 8;

/**
 * A light double. Reserved for money LANDING — the collect-and-close that
 * submitted an invoice. Two pulses because one is "I heard you" and two is
 * "it is done", and the cashier needs to tell those apart without looking.
 */
export const HAPTIC_CONFIRM: readonly number[] = [10, 30, 10];

/**
 * A heavier double for a consequential, reversible verb (removing a line).
 * Deliberately NOT used for errors: those already toast and play a sound, and
 * a third channel saying the same thing is noise.
 */
export const HAPTIC_WARN: readonly number[] = [24, 60, 24];

type VibratePattern = number | readonly number[];

/** `matchMedia`, never trusted: jsdom has none unless a spec stubs one. */
function matches(query: string): boolean {
	try {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
		return window.matchMedia(query).matches === true;
	} catch {
		return false;
	}
}

/** Storage access itself throws in a Safari private window — not just reads. */
function optedOut(): boolean {
	try {
		if (typeof localStorage === "undefined") return false;
		return localStorage.getItem(HAPTICS_OPT_OUT_KEY) === HAPTICS_OPT_OUT_VALUE;
	} catch {
		return false;
	}
}

/**
 * Whether a buzz would be delivered. Exported so a settings surface can show
 * the toggle only where it means something, and so the specs can assert the
 * gate without asserting a side effect.
 */
export function hapticsAvailable(): boolean {
	try {
		if (typeof navigator === "undefined") return false;
		if (typeof (navigator as Navigator).vibrate !== "function") return false;
	} catch {
		return false;
	}
	if (!matches("(pointer: coarse)")) return false;
	return !optedOut();
}

/** The one call site of `navigator.vibrate` in the app. Returns whether it fired. */
function buzz(pattern: VibratePattern): boolean {
	if (!hapticsAvailable()) return false;
	try {
		// A copy, not the exported constant: `vibrate` takes a mutable array and
		// some engines have historically kept the reference.
		navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
		return true;
	} catch {
		return false;
	}
}

/** One item added, one quantity step, one lot chosen. */
export function tick(): boolean {
	return buzz(HAPTIC_TICK);
}

/** The sale closed. */
export function confirm(): boolean {
	return buzz(HAPTIC_CONFIRM);
}

/** A line removed — consequential, and the screen may already be closing. */
export function warn(): boolean {
	return buzz(HAPTIC_WARN);
}

export default { tick, confirm, warn, hapticsAvailable };
