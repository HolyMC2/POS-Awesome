/**
 * Shortcuts engine — chord parsing, event matching, keymap resolution,
 * conflict detection and cheat-sheet data (roadmap §17.3).
 *
 * MATCHING SEMANTICS ARE INHERITED, ON PURPOSE. This engine replaced a
 * hand-written if-chain in invoiceShortcuts.ts; every rule below reproduces
 * what that chain did, so the refactor is invisible to a cashier's fingers:
 *
 * - A key token matches `event.key` OR `event.code`, because a POS runs on
 *   whatever keyboard the shop owns: `1` must work from the number row
 *   (Digit1) AND the numpad (Numpad1), and a Spanish layout reports letters
 *   through `key` while `code` stays US-physical.
 * - `alt+…` chords require Alt and refuse Ctrl/Meta, and IGNORE Shift —
 *   Alt+Shift+1 fires Alt+1 today. Preserved rather than silently tightened.
 * - Modifier-less chords (the F-keys) check no modifiers at all, so Alt+F4
 *   also reaches F4's action today. Preserved. Both quirks are now DATA
 *   rather than control flow, so fixing them later is a keymap decision with
 *   a test, not an archaeology expedition.
 */

import {
	CATEGORY_LABELS,
	CATEGORY_ORDER,
	SHORTCUT_ACTIONS,
	type ShortcutAction,
	type ShortcutCategory,
	getAction,
} from "./actions";
import type { Keymap } from "./keymap";

export interface Chord {
	alt: boolean;
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
	/** Normalized key token: "1", "q", "backquote", "pageup", "f4", … */
	key: string;
	/** Canonical string form, e.g. "alt+1". */
	id: string;
}

const MODIFIER_TOKENS = new Set(["alt", "ctrl", "control", "meta", "cmd", "shift"]);

/** Parse "alt+1" / "f4" / "alt+backquote" into a matcher. Throws on garbage —
 * a malformed binding is a packaging bug and must never fail silently into
 * "this key does nothing". */
export const parseChord = (input: string): Chord => {
	const raw = String(input || "").trim().toLowerCase();
	if (!raw) {
		throw new Error("empty chord");
	}
	const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
	if (!parts.length) {
		throw new Error(`invalid chord: ${input}`);
	}
	const key = parts[parts.length - 1];
	// `!key` also satisfies noUncheckedIndexedAccess — an index read is
	// `string | undefined` here no matter what the length check above proved.
	if (!key || MODIFIER_TOKENS.has(key)) {
		throw new Error(`chord has no key: ${input}`);
	}
	const mods = parts.slice(0, -1);
	for (const mod of mods) {
		if (!MODIFIER_TOKENS.has(mod)) {
			throw new Error(`unknown modifier ${mod} in chord: ${input}`);
		}
	}
	const chord: Chord = {
		alt: mods.includes("alt"),
		ctrl: mods.includes("ctrl") || mods.includes("control"),
		meta: mods.includes("meta") || mods.includes("cmd"),
		shift: mods.includes("shift"),
		key,
		id: "",
	};
	chord.id = canonicalChordId(chord);
	return chord;
};

const canonicalChordId = (chord: Chord): string => {
	const parts: string[] = [];
	if (chord.ctrl) parts.push("ctrl");
	if (chord.alt) parts.push("alt");
	if (chord.shift) parts.push("shift");
	if (chord.meta) parts.push("meta");
	parts.push(chord.key);
	return parts.join("+");
};

const isDigitToken = (token: string) => token.length === 1 && token >= "0" && token <= "9";
const isLetterToken = (token: string) => token.length === 1 && token >= "a" && token <= "z";

/** Does this event's key/code satisfy the token? Mirrors the old helpers. */
export const matchesKeyToken = (event: KeyboardEvent, token: string): boolean => {
	const eventKey = typeof event.key === "string" ? event.key : "";
	const eventCode = typeof event.code === "string" ? event.code : "";

	if (isDigitToken(token)) {
		return (
			eventKey === token ||
			eventCode === `Digit${token}` ||
			eventCode === `Numpad${token}`
		);
	}
	if (isLetterToken(token)) {
		return (
			eventKey.toLowerCase() === token || eventCode === `Key${token.toUpperCase()}`
		);
	}
	if (token === "backquote") {
		return eventKey === "`" || eventCode === "Backquote";
	}
	// Named keys: PageUp, Home, F4… compared case-insensitively against both.
	return eventKey.toLowerCase() === token || eventCode.toLowerCase() === token;
};

export const matchesChord = (event: KeyboardEvent, chord: Chord): boolean => {
	if (!matchesKeyToken(event, chord.key)) {
		return false;
	}
	const hasModifier = chord.alt || chord.ctrl || chord.meta;
	if (!hasModifier) {
		// Inherited: F-keys fire regardless of modifier state.
		return true;
	}
	if (chord.alt !== Boolean(event.altKey)) return false;
	if (chord.ctrl !== Boolean(event.ctrlKey)) return false;
	if (chord.meta !== Boolean(event.metaKey)) return false;
	// Shift deliberately unchecked unless the chord asks for it.
	if (chord.shift && !event.shiftKey) return false;
	return true;
};

export interface ResolvedBinding {
	actionId: string;
	chord: Chord;
}

export interface KeymapConflict {
	chordId: string;
	actionIds: string[];
}

export interface ResolvedKeymap {
	keymapId: string;
	version: number;
	bindings: ResolvedBinding[];
	conflicts: KeymapConflict[];
	/** Binding problems that are packaging bugs: unknown action, bad chord. */
	errors: string[];
	/** Registry actions with no chord in this keymap. Legal, but surfaced. */
	unbound: string[];
}

/**
 * Resolve a keymap (plus an optional override layer) into a matchable table.
 *
 * Overrides are a shallow per-action replacement — a tenant or user rebinding
 * `payment.submit` replaces its chord list entirely rather than merging, so
 * "my Enter key does X" can never accidentally keep an inherited chord alive.
 * An override naming an unknown action is an ERROR, not a silent drop: that
 * is how a typo'd tenant override would otherwise disable a key forever.
 */
export const resolveKeymap = (
	keymap: Keymap,
	overrides?: Record<string, string[]> | null,
): ResolvedKeymap => {
	const errors: string[] = [];
	const merged: Record<string, string[]> = { ...keymap.bindings };

	for (const [actionId, chords] of Object.entries(overrides || {})) {
		if (!getAction(actionId)) {
			errors.push(`override names unknown action: ${actionId}`);
			continue;
		}
		merged[actionId] = Array.isArray(chords) ? chords : [];
	}

	const bindings: ResolvedBinding[] = [];
	const byChord = new Map<string, string[]>();

	for (const [actionId, chords] of Object.entries(merged)) {
		if (!getAction(actionId)) {
			errors.push(`keymap names unknown action: ${actionId}`);
			continue;
		}
		for (const raw of chords || []) {
			let chord: Chord;
			try {
				chord = parseChord(raw);
			} catch (error) {
				errors.push(`${actionId}: ${(error as Error).message}`);
				continue;
			}
			bindings.push({ actionId, chord });
			const owners = byChord.get(chord.id) || [];
			if (!owners.includes(actionId)) {
				owners.push(actionId);
			}
			byChord.set(chord.id, owners);
		}
	}

	const conflicts: KeymapConflict[] = [];
	for (const [chordId, actionIds] of byChord) {
		if (actionIds.length > 1) {
			conflicts.push({ chordId, actionIds: [...actionIds].sort() });
		}
	}

	const boundActions = new Set(bindings.map((b) => b.actionId));
	const unbound = SHORTCUT_ACTIONS.map((a) => a.id).filter((id) => !boundActions.has(id));

	// Modifier-bearing chords first: with the inherited loose F-key rule, a
	// specific Alt chord must never lose to a bare key that also matches.
	bindings.sort((a, b) => {
		const score = (c: Chord) => Number(c.ctrl) + Number(c.alt) + Number(c.meta) + Number(c.shift);
		return score(b.chord) - score(a.chord);
	});

	return {
		keymapId: keymap.id,
		version: keymap.version,
		bindings,
		conflicts: conflicts.sort((a, b) => a.chordId.localeCompare(b.chordId)),
		errors,
		unbound: unbound.sort(),
	};
};

/** The action a key event triggers, or null. First match wins (see sort). */
export const resolveShortcutAction = (
	event: KeyboardEvent,
	resolved: ResolvedKeymap,
): string | null => {
	for (const binding of resolved.bindings) {
		if (matchesChord(event, binding.chord)) {
			return binding.actionId;
		}
	}
	return null;
};

/** Human chord label: "alt+1" → "Alt + 1", "alt+pageup" → "Alt + Page Up". */
const KEY_LABELS: Record<string, string> = {
	backquote: "`",
	pageup: "Page Up",
	pagedown: "Page Down",
	home: "Home",
	end: "End",
};

export const formatChord = (chord: Chord): string => {
	const parts: string[] = [];
	if (chord.ctrl) parts.push("Ctrl");
	if (chord.alt) parts.push("Alt");
	if (chord.shift) parts.push("Shift");
	if (chord.meta) parts.push("Meta");
	const key = KEY_LABELS[chord.key] || (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key.replace(/^f(\d+)$/, "F$1"));
	parts.push(key);
	return parts.join(" + ");
};

export interface CheatSheetEntry {
	actionId: string;
	label: string;
	hint?: string;
	chords: string[];
}

export interface CheatSheetSection {
	category: ShortcutCategory;
	label: string;
	entries: CheatSheetEntry[];
}

/**
 * Cheat-sheet data, grouped and ordered for display. Unbound actions are
 * omitted: a printed key list that lies about what works is worse than a
 * shorter one.
 */
export const describeKeymap = (resolved: ResolvedKeymap): CheatSheetSection[] => {
	const chordsByAction = new Map<string, string[]>();
	for (const binding of resolved.bindings) {
		const list = chordsByAction.get(binding.actionId) || [];
		list.push(formatChord(binding.chord));
		chordsByAction.set(binding.actionId, list);
	}

	const sections: CheatSheetSection[] = [];
	for (const category of CATEGORY_ORDER) {
		const entries: CheatSheetEntry[] = [];
		for (const action of SHORTCUT_ACTIONS as readonly ShortcutAction[]) {
			if (action.category !== category) continue;
			const chords = chordsByAction.get(action.id);
			if (!chords?.length) continue;
			entries.push({
				actionId: action.id,
				label: action.label,
				hint: action.hint,
				chords,
			});
		}
		if (entries.length) {
			sections.push({ category, label: CATEGORY_LABELS[category], entries });
		}
	}
	return sections;
};
