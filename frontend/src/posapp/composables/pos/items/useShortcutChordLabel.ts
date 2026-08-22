/**
 * The chord a given action is ACTUALLY bound to, formatted for display.
 *
 * The register prints chords on the surfaces they operate — the scan field and
 * the "Explorar catálogo" button (artboard nodes 22 and 24) — which turns the
 * shortcuts engine (§17.3) into something a cashier learns while working
 * rather than a cheat sheet they have to go find.
 *
 * **It resolves through the active keymap; it never prints the mock's chord.**
 * That is ruling R8, and it has already bitten twice: `Main.dc.html` draws
 * `F4` on the catalogue, but `F4` has meant `employee.switch` since before the
 * engine existed, and the catalogue is bound to `alt+b`. A chip that names a
 * key which does something else is worse than no chip — the operator presses
 * it once, switches cashier mid-sale, and stops trusting every other chip on
 * the screen.
 *
 * An unbound action returns `null`, and the caller renders the verb with no
 * chip. `describeKeymap` already takes this line for the cheat sheet: "a
 * printed key list that lies about what works is worse than a shorter one."
 */
import { formatChord, getActiveKeymap } from "../../../shortcuts";

/**
 * Display label for the first chord bound to `actionId`, or `null` if the
 * active keymap binds none.
 *
 * First rather than all: a surface chip has room for one, and `keymap.ts`
 * orders a multi-chord binding with the canonical one first (`payment.open`
 * lists `alt+d` before `alt+pageup` — the letter a cashier is taught, then
 * the position an incumbent's muscle memory reaches for).
 */
export const chordLabelFor = (actionId: string): string | null => {
	if (!actionId) {
		return null;
	}
	const binding = getActiveKeymap().bindings.find((b) => b.actionId === actionId);
	return binding ? formatChord(binding.chord) : null;
};
