/**
 * The floor editor's working copy.
 *
 * The editor never mutates store rows: a whole-floor save is a single
 * optimistic-concurrency write (§6.3), so the operator has to be able to move
 * six tables and then decide not to keep any of it. This module owns the shape
 * of that working copy and the pure operations that build rows for it, which is
 * what lets the editor components stay about interaction.
 *
 * @module posapp/components/floor/floorEditorDraft
 */
import { resolveTableLayout, type PlacedLayout } from "./floorGeometry";
import type { FloorCanvas, TableRow } from "../../stores/floorStore";

export interface DraftTable {
	/** Server docname; absent until the row has been saved once. */
	name?: string;
	table_uid: string;
	table_label: string;
	seats: number;
	is_active: number;
	layout: PlacedLayout;
}

/**
 * `table_uid` is the save payload's key (`_upsert_table` matches on it), so a
 * table created while the tablet was offline updates its own row on the retry
 * instead of spawning a twin.
 */
export const newTableUid = (): string =>
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `tbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const draftFromTable = (
	table: TableRow,
	index: number,
	canvas: FloorCanvas,
): DraftTable => ({
	name: table.name,
	table_uid: table.table_uid || table.name,
	table_label: table.table_label,
	seats: Number(table.seats) || 0,
	is_active: table.is_active === 0 ? 0 : 1,
	layout: resolveTableLayout(table, index, canvas),
});

/**
 * The next free integer label. Counting rows would re-issue a number the
 * moment a table is hidden, and two tables both called "7" is a mis-delivered
 * plate — so the label is one past the highest number already on the floor,
 * hidden rows included.
 */
export const nextTableLabel = (draft: ReadonlyArray<DraftTable>): string => {
	const highest = draft.reduce((max, entry) => {
		const numeric = Number.parseInt(entry.table_label.replace(/\D+/g, ""), 10);
		return Number.isFinite(numeric) && numeric > max ? numeric : max;
	}, 0);
	return String(highest + 1);
};

/** A copy of `source`, offset and re-keyed so it saves as a new table. */
export const duplicateDraft = (
	source: DraftTable,
	draft: ReadonlyArray<DraftTable>,
	layout: PlacedLayout,
): DraftTable => ({
	table_uid: newTableUid(),
	table_label: nextTableLabel(draft),
	seats: source.seats,
	is_active: 1,
	layout,
});
