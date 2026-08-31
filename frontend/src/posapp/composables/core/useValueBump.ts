/**
 * "The total bumps" (native-feel round 2, owner direction 2026-08-30).
 *
 * A figure that changes in place is the one moment in a POS where the screen
 * has news and gives no sign of it: the cashier adds a third bottle and the
 * only difference is two digits they have to re-read to trust. One short
 * scale — 4% up, settling back over `--motion-base` — turns that into
 * something peripheral vision catches.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY TWO CLASS NAMES. A CSS animation restarts when its `animation-name`
 * changes, and only then. Removing the class and re-adding it inside a single
 * Vue flush does nothing at all — the browser does not repaint between two
 * microtask flushes, so the element never observes the class as absent and
 * the keyframes never re-run. The usual escapes are a forced reflow
 * (`void el.offsetWidth`, which needs a template ref and costs a layout) or a
 * `requestAnimationFrame` hop (which needs a frame, and jsdom's is a timer).
 * Alternating between two IDENTICAL keyframe rules needs neither: the name
 * genuinely changes every time, so the animation genuinely restarts, and the
 * whole thing stays a pure class string a spec can read.
 *
 * The keyframes and the two classes live in `styles/register-tokens.css`
 * beside the motion tokens, because two components (the band and the phone
 * dock) share them and Vue's scoped styles rewrite `@keyframes` names.
 *
 * This composable NEVER animates under `prefers-reduced-motion`, and the
 * token layer zeroes `--motion-base` there as well. Two answers to the same
 * question on purpose: the class is what a spec can assert, the token is what
 * protects a surface that forgets to ask.
 */
import { ref, watch, type Ref, type WatchSource } from "vue";

/** Ping-ponged so the `animation-name` differs from one bump to the next. */
export const BUMP_CLASSES = ["reg-bump-a", "reg-bump-b"] as const;

/**
 * Read live rather than cached: a cashier who turns the OS setting on
 * mid-shift gets a still register at the next change, not at the next reload.
 * `matchMedia` is absent in jsdom unless a spec stubs it, so this never trusts
 * it to exist.
 */
export function prefersReducedMotion(): boolean {
	try {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
	} catch {
		return false;
	}
}

/**
 * Watches a formatted value and returns the class its element should carry.
 *
 * The FORMATTED value, not the number: `$1,240.00` is what the cashier reads,
 * and a rounding that leaves the display identical is not news. Vue's watcher
 * compares with `Object.is`, so a re-render that produces the same string
 * fires nothing — which is exactly the "does not bump on a same-value
 * re-render" half of the contract, for free.
 */
export function useValueBump(source: WatchSource<unknown>): Ref<string> {
	const bumpClass = ref("");
	let next = 0;

	watch(source, (value, previous) => {
		// The first resolve of an async figure is an arrival, not a change.
		if (previous === undefined) return;
		if (Object.is(value, previous)) return;
		if (prefersReducedMotion()) return;
		bumpClass.value = BUMP_CLASSES[next] ?? "";
		next = next === 0 ? 1 : 0;
	});

	return bumpClass;
}

export default useValueBump;
