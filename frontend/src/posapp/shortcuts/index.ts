/**
 * Active-keymap runtime (roadmap §17.3).
 *
 * Resolution is memoized because it runs on the keydown hot path — a cashier
 * scanning fast generates a lot of events, and re-parsing chords per key
 * press would be a self-inflicted latency budget item (§6).
 *
 * `configureShortcuts` is the seam the server plumbing plugs into: a preset
 * names its keymap and a tenant may override individual actions, both
 * arriving in the capability payload. Until that ships, the default pack is
 * the whole truth and this module is a one-line lookup.
 */

import { describeKeymap, resolveKeymap, resolveShortcutAction, type ResolvedKeymap } from "./engine";
import { getKeymap } from "./keymap";

let active: ResolvedKeymap = resolveKeymap(getKeymap(null));

export interface ShortcutsConfig {
	/** Keymap pack id, e.g. from the capability payload. */
	keymapId?: string | null;
	/** Per-action chord overrides (tenant/user layer). */
	overrides?: Record<string, string[]> | null;
}

/** Swap the active keymap. Returns the resolution so a caller can surface
 * conflicts/errors — they are packaging bugs and must not stay silent. */
export const configureShortcuts = (config: ShortcutsConfig = {}): ResolvedKeymap => {
	active = resolveKeymap(getKeymap(config.keymapId), config.overrides);
	if (active.errors.length || active.conflicts.length) {
		console.warn("[shortcuts] keymap problems", {
			keymap: active.keymapId,
			errors: active.errors,
			conflicts: active.conflicts,
		});
	}
	return active;
};

export const getActiveKeymap = (): ResolvedKeymap => active;

/** The action a key event triggers under the active keymap, or null. */
export const actionForEvent = (event: KeyboardEvent): string | null =>
	resolveShortcutAction(event, active);

/** Cheat-sheet sections for the active keymap. */
export const activeCheatSheet = () => describeKeymap(active);

export * from "./actions";
export * from "./engine";
export { getKeymap, KEYMAP_PACKS, DEFAULT_KEYMAP_ID, MUELLE_DEFAULT, type Keymap } from "./keymap";
