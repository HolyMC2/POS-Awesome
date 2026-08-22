/**
 * "Enter para agregar el primero" — made TRUE, or not drawn.
 *
 * The artboard puts that sentence at the right of the up-sell strip's header
 * (`Main.dc.html`, node 96). Taken literally it cannot ship, and the reason is
 * the register's entire input model: the scan field is autofocused
 * (`ItemHeader.vue`) and holds focus continuously, `@keydown.enter` on it runs
 * `useItemsSelectorSearch.onEnter`, and after every scanner-driven search
 * `_performSearch` calls `clearSearch()` then `focusItemSearch()` — so an
 * EMPTY, focused scan field is the resting state immediately after each scan.
 * A gun that emits a trailing CR (some emit CR+LF) would land that Enter on
 * whatever else claimed the key. If that were this strip, every scan would
 * silently add an up-sell item to the ticket. There is no version of "Enter
 * adds the first tile" that is worth that.
 *
 * So the shortcut is CONDITIONAL and the hint is bound to the same condition:
 * Enter adds the first tile exactly when nothing else on screen claims Enter,
 * and the hint renders exactly then too. One predicate drives both, which is
 * the point — a hint that lies about a shortcut is worse than no hint, and the
 * only way to be sure it cannot lie is to make the sentence and the behaviour
 * read the same boolean.
 *
 * This is deliberately NOT a chord. Registering one is a three-file change in
 * `shortcuts/` (§8 R8: name it, bind it, implement it), and those files belong
 * to another owner. Reported instead — see the task report — because a chord
 * is the only way to make the strip reachable from a focused scan field, and
 * that is a decision for the shortcut pack's owner, not for this component.
 */

import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from "vue";

/**
 * Selectors for things that DO something with Enter when focused.
 *
 * `button` and `a[href]` are in the list for the same reason the scan field
 * is: Enter activates them natively. A focused up-sell tile is a `button`, so
 * it activates ITSELF rather than falling through to "the first" — which is
 * both what a keyboard user expects and what keeps this handler from
 * second-guessing a deliberate Tab.
 *
 * `[role="dialog"]` and `[aria-modal="true"]` are ancestors, not focus
 * targets: while a modal is up it owns the keyboard, and a focused div inside
 * one must not fall through to a strip rendered underneath it.
 */
const CLAIMS_ENTER = [
	"input",
	"textarea",
	"select",
	"button",
	"a[href]",
	'[contenteditable=""]',
	'[contenteditable="true"]',
	'[role="button"]',
	'[role="textbox"]',
	'[role="searchbox"]',
	'[role="combobox"]',
	'[role="menuitem"]',
	'[role="option"]',
	'[role="link"]',
	'[role="tab"]',
	'[role="dialog"]',
	'[aria-modal="true"]',
].join(",");

/**
 * Does the currently focused element already mean something by Enter?
 *
 * Answered by walking UP from the element, not by looking at it alone:
 * Vuetify wraps its inputs in several divs and focus frequently lands on a
 * wrapper, so an exact tag test would report "nothing claims Enter" while the
 * cashier is typing into the scan bar. `closest` is the whole reason this is
 * a function and not a tag comparison.
 *
 * `null` — nothing focused, or `document.body`, which is the same thing —
 * claims nothing.
 */
export const claimsEnter = (element: Element | null | undefined): boolean => {
	if (!element) return false;
	if (typeof (element as any).closest !== "function") return false;
	const el = element as Element;
	if (el === el.ownerDocument?.body) return false;
	return Boolean(el.closest(CLAIMS_ENTER));
};

export interface UpsellEnterOptions {
	/** Is there a first tile to add? Read reactively, so `armed` follows it. */
	isEnabled: () => boolean;
	/** Add the first tile. Called at most once per keypress. */
	onEnter: () => void;
	/** Test seam. Defaults to the ambient document. */
	target?: Document;
}

export interface UpsellEnter {
	/**
	 * True exactly when pressing Enter right now would add the first tile.
	 * The hint renders on this and nothing else.
	 */
	armed: ComputedRef<boolean>;
	/** Exposed so a spec can drive the handler without a real key event. */
	handleKeydown: (_event: KeyboardEvent) => void;
	/** Re-read focus. Called on mount and by the focus listeners. */
	syncFocus: () => void;
}

export function useUpsellEnter(options: UpsellEnterOptions): UpsellEnter {
	const doc = options.target ?? (typeof document !== "undefined" ? document : undefined);

	/**
	 * Pessimistic default. On a real register the scan field is autofocused
	 * before this component mounts, so "something claims Enter" is the correct
	 * assumption to start from; guessing the other way would flash a hint that
	 * is false for the one frame a screenshot might catch.
	 */
	const focusClaimed = ref(true);

	const armed = computed(() => Boolean(options.isEnabled()) && !focusClaimed.value);

	const syncFocus = () => {
		focusClaimed.value = claimsEnter(doc?.activeElement ?? null);
	};

	const onFocusIn = (event: FocusEvent) => {
		focusClaimed.value = claimsEnter(event.target as Element | null);
	};

	/**
	 * `relatedTarget` is the element ABOUT to receive focus, so this reads the
	 * destination rather than the momentary nothing between two elements.
	 * Reading `activeElement` here instead would flip `armed` true for a frame
	 * on every Tab, and the hint would blink across the header.
	 */
	const onFocusOut = (event: FocusEvent) => {
		focusClaimed.value = claimsEnter(event.relatedTarget as Element | null);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key !== "Enter") return;
		// A modifier'd Enter belongs to whoever registered that chord.
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		// Mid-composition Enter commits an IME candidate; it is not a command.
		if ((event as any).isComposing || event.keyCode === 229) return;
		if (event.defaultPrevented) return;
		if (!options.isEnabled()) return;

		// Both, and neither is redundant: `target` is where the key was typed,
		// `activeElement` is what would act on it. They diverge when a handler
		// upstream has moved focus during the same event.
		if (claimsEnter(event.target as Element | null)) return;
		if (claimsEnter(doc?.activeElement ?? null)) return;

		event.preventDefault();
		options.onEnter();
	};

	onMounted(() => {
		if (!doc) return;
		syncFocus();
		doc.addEventListener("focusin", onFocusIn);
		doc.addEventListener("focusout", onFocusOut);
		doc.addEventListener("keydown", handleKeydown);
	});

	onBeforeUnmount(() => {
		if (!doc) return;
		doc.removeEventListener("focusin", onFocusIn);
		doc.removeEventListener("focusout", onFocusOut);
		doc.removeEventListener("keydown", handleKeydown);
	});

	return { armed, handleKeydown, syncFocus };
}
