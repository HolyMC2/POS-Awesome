/**
 * Local mirror of the floors/tables catalog (`pos_floors`, `pos_tables`).
 *
 * `POS Floor` / `POS Table` were not in the offline sync registry (spec §6.8),
 * so the floor screen could not render without the server. These are the
 * read-mirror writes behind the two new pulled resources; every row is a
 * verbatim copy of the explicit field list the endpoint returns.
 *
 * Both tables are pure derived cache — they are wiped by
 * `clearDerivedOfflineCaches()` and refetched. Nothing unsynced lives here;
 * device-local orders live in `pos_table_orders` (`restaurantOrders.ts`).
 *
 * @module offline/restaurantCatalog
 */
import { checkDbHealth, db, initPromise } from "./db";
import type { FloorRow, TableRow } from "./restaurantTypes";

const FLOORS_TABLE = "pos_floors";
const TABLES_TABLE = "pos_tables";

async function ensureCatalogDbReady() {
	await initPromise;
	await checkDbHealth();
	if (!db.isOpen()) {
		await db.open();
	}
}

function toNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Tolerate a JSON field arriving as a string (older Frappe JSON handling). */
function parseJsonField<T>(value: unknown): T | null {
	if (!value) {
		return null;
	}
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return null;
		}
	}
	return typeof value === "object" ? (value as T) : null;
}

export function normalizeFloorRow(row: Record<string, any>): FloorRow {
	return {
		name: String(row?.name || ""),
		floor_uid: String(row?.floor_uid || row?.name || ""),
		floor_name: String(row?.floor_name || ""),
		company: row?.company ?? null,
		pos_profile: row?.pos_profile ?? null,
		sequence: toNumber(row?.sequence, 1),
		is_active: toNumber(row?.is_active, 1),
		layout: parseJsonField(row?.layout),
		modified: row?.modified ?? null,
	};
}

export function normalizeTableRow(row: Record<string, any>): TableRow {
	return {
		name: String(row?.name || ""),
		table_uid: String(row?.table_uid || row?.name || ""),
		table_label: String(row?.table_label || ""),
		floor: String(row?.floor || ""),
		seats: toNumber(row?.seats, 2),
		is_active: toNumber(row?.is_active, 1),
		layout: parseJsonField(row?.layout),
		needs_cleaning: toNumber(row?.needs_cleaning, 0),
		bill_printed_at: row?.bill_printed_at ?? null,
		occupied: toNumber(row?.occupied, 0),
		modified: row?.modified ?? null,
	};
}

export async function putStoredFloors(rows: Record<string, any>[]) {
	const normalized = (rows || [])
		.map((row) => normalizeFloorRow(row))
		.filter((row) => !!row.name);
	if (!normalized.length) {
		return 0;
	}
	await ensureCatalogDbReady();
	await db.table(FLOORS_TABLE).bulkPut(normalized);
	return normalized.length;
}

export async function putStoredTables(rows: Record<string, any>[]) {
	const normalized = (rows || [])
		.map((row) => normalizeTableRow(row))
		.filter((row) => !!row.name);
	if (!normalized.length) {
		return 0;
	}
	await ensureCatalogDbReady();
	await db.table(TABLES_TABLE).bulkPut(normalized);
	return normalized.length;
}

export async function deleteStoredFloors(names: string[]) {
	const keys = (names || []).filter(Boolean);
	if (!keys.length) {
		return;
	}
	await ensureCatalogDbReady();
	await db.table(FLOORS_TABLE).bulkDelete(keys);
}

export async function deleteStoredTables(names: string[]) {
	const keys = (names || []).filter(Boolean);
	if (!keys.length) {
		return;
	}
	await ensureCatalogDbReady();
	await db.table(TABLES_TABLE).bulkDelete(keys);
}

export async function clearStoredFloors() {
	await ensureCatalogDbReady();
	await db.table(FLOORS_TABLE).clear();
}

export async function clearStoredTables() {
	await ensureCatalogDbReady();
	await db.table(TABLES_TABLE).clear();
}

/** Active floors in render order (sequence, then name). */
export async function listStoredFloors(
	posProfile?: string | null,
): Promise<FloorRow[]> {
	await ensureCatalogDbReady();
	const rows = (await db.table(FLOORS_TABLE).toArray()) as FloorRow[];
	return rows
		.filter((row) => row.is_active !== 0)
		.filter((row) =>
			// A floor with no profile serves every register on the company.
			posProfile && row.pos_profile ? row.pos_profile === posProfile : true,
		)
		.sort(
			(left, right) =>
				left.sequence - right.sequence ||
				String(left.floor_name).localeCompare(String(right.floor_name)),
		);
}

export async function listStoredTables(
	floor?: string | null,
): Promise<TableRow[]> {
	await ensureCatalogDbReady();
	const rows = (await db.table(TABLES_TABLE).toArray()) as TableRow[];
	return rows
		.filter((row) => row.is_active !== 0)
		.filter((row) => (floor ? row.floor === floor : true));
}
