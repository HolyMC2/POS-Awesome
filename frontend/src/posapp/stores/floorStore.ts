/**
 * Restaurant floor state (RESTAURANT_TABLES_SPEC.md §0.2, §3, §6.7).
 *
 * Two rules shape everything here:
 *
 * 1. **Table status is derived, never stored.** The store keeps floors, tables
 *    and the register's OPEN orders; free/seated/ordered/sent is computed from
 *    the order set at render time (§0.2). The server's `occupied` Check is a
 *    repaint hint we mirror, never a truth we branch on.
 * 2. **The socket is a latency hint; the pull is the truth.** Frappe has no
 *    reconnect replay (§6.7), so every broadcast is paired with an
 *    authoritative `getFloorSnapshot` on reconnect and on tab visibility.
 *
 * The store owns no rendering and no geometry maths — see
 * `components/floor/floorGeometry.ts`.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import * as restaurantApi from "../api/restaurant";
import { createCartSync } from "./floor/floorCartSync";
import { createOrderActions } from "./floor/floorOrderActions";
import { createFloorRealtime } from "./floor/floorRealtime";
import {
	ACTIVE_FLOOR_KEY,
	VIEW_MODE_KEY,
	getDeviceIdentifier,
	newUid,
	readLocal,
	writeLocal,
} from "./floor/floorRuntime";
import { useInvoiceStore } from "./invoiceStore";
import { useUIStore } from "./uiStore";
import { useVerticalStore } from "./verticalStore";

/**
 * Row and param shapes are the offline layer's (`offline/restaurantTypes.ts`,
 * re-exported by the wrapper) — one definition for the mirror, the wrapper and
 * the UI. Re-exported here so floor components have a single import.
 */
export type {
	FloorEditorTable,
	FloorLayout,
	FloorRow,
	FloorSnapshot,
	KotProjection,
	OrderLine,
	OrderRow,
	SaveFloorParams,
	TableLayout,
	TableRow,
} from "../api/restaurant";

import type { FloorRow, OrderRow, TableRow } from "../api/restaurant";

export { getDeviceIdentifier, parseLayout } from "./floor/floorRuntime";

/** The floor's grid reference frame, defaults applied (spec §2.2). */
export interface FloorCanvas {
	cols: number;
	rows: number;
	cell: number;
}

export const useFloorStore = defineStore("floor", () => {
	const uiStore = useUIStore();
	const verticalStore = useVerticalStore();

	const floors = ref<FloorRow[]>([]);
	const tables = ref<TableRow[]>([]);
	const orders = ref<OrderRow[]>([]);
	const activeFloor = ref<string | null>(null);
	const viewMode = ref<"plan" | "kanban">(readLocal(VIEW_MODE_KEY) === "kanban" ? "kanban" : "plan");
	const editorMode = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const lastSyncedAt = ref<number | null>(null);
	/** Table names with a write in flight — the plan draws them `syncing`. */
	const syncingTables = ref<string[]>([]);
	const transferOrder = ref<OrderRow | null>(null);
	/** The order whose lines are currently loaded in the cart. */
	const activeOrder = ref<OrderRow | null>(null);

	const posProfileName = computed(() => uiStore.posProfile?.name || "");
	const companyName = computed(() => uiStore.company || "");

	/**
	 * `invoice_mode` is a TOP-LEVEL key of the capability payload, and
	 * `verticalStore.profile` deliberately drops keys it does not model — so it
	 * is read from the raw payload here rather than through the store.
	 */
	const invoiceMode = computed<string | null>(() => {
		const raw = uiStore.capabilityPayload?.invoice_mode;
		return typeof raw === "string" && raw ? raw : null;
	});

	const hasTables = computed(() => verticalStore.has("tables"));
	/** Record-Only is the mode that owns a POS Table Order (§2.3). */
	const isRecordOnly = computed(() => hasTables.value && invoiceMode.value === "Record Only");

	const activeFloorRow = computed(
		() => floors.value.find((floor) => floor.name === activeFloor.value) || null,
	);

	const activeFloorTables = computed(() =>
		tables.value.filter((table) => table.floor === activeFloor.value && table.is_active !== 0),
	);

	/** table name → its open orders. A table with two orders is a split bill. */
	const ordersByTable = computed(() => {
		const map = new Map<string, OrderRow[]>();
		for (const order of orders.value) {
			if (!order.table) continue;
			const bucket = map.get(order.table);
			if (bucket) bucket.push(order);
			else map.set(order.table, [order]);
		}
		return map;
	});

	/** Table-less orders — the cafetería "name on the cup" rail. */
	const tabOrders = computed(() => orders.value.filter((order) => !order.table));

	const openOrdersCount = computed(() => orders.value.length);

	const ordersForTable = (table: string): OrderRow[] => ordersByTable.value.get(table) || [];

	const isOccupied = (table: string): boolean => ordersForTable(table).length > 0;

	const unsentCountForTable = (table: string): number =>
		ordersForTable(table).reduce((sum, order) => sum + (Number(order.unsent_count) || 0), 0);

	const isSyncing = (table: string): boolean => syncingTables.value.includes(table);

	const markSyncing = (table: string | null, on: boolean) => {
		if (!table) return;
		const present = syncingTables.value.includes(table);
		if (on && !present) syncingTables.value = [...syncingTables.value, table];
		else if (!on && present) syncingTables.value = syncingTables.value.filter((t) => t !== table);
	};

	/**
	 * The cart ⇄ order bridge. It owns the "last accepted" baseline that makes
	 * the per-line union correct, so nothing else may write those lines.
	 */
	const cartSync = createCartSync({
		// Getter, not the instance — the floor store must be constructible
		// without instantiating the cart (see CartSyncDeps.invoiceStore).
		invoiceStore: () => useInvoiceStore(),
		activeOrder,
		isRecordOnly,
		markSyncing,
		onOrderUpdated: (order) => {
			upsertOrder(order);
			activeOrder.value = order;
		},
		onError: (message) => {
			error.value = message;
		},
	});

	const loadOrderIntoCart = cartSync.loadOrderIntoCart;
	const flushCartSync = cartSync.flush;

	const setViewMode = (mode: "plan" | "kanban") => {
		viewMode.value = mode;
		writeLocal(VIEW_MODE_KEY, mode);
	};

	const setEditorMode = (on: boolean) => {
		editorMode.value = on;
	};

	const setActiveFloor = (name: string | null) => {
		if (activeFloor.value === name) return;
		socket.unsubscribe();
		activeFloor.value = name;
		if (name) {
			writeLocal(ACTIVE_FLOOR_KEY, name);
			socket.subscribe();
		}
	};

	const applySnapshot = (snapshot: restaurantApi.FloorSnapshot) => {
		floors.value = (snapshot.floors || []) as FloorRow[];
		tables.value = (snapshot.tables || []) as TableRow[];
		orders.value = (snapshot.orders || []) as OrderRow[];
		lastSyncedAt.value = Date.now();
		if (!activeFloor.value || !floors.value.some((floor) => floor.name === activeFloor.value)) {
			const remembered = readLocal(ACTIVE_FLOOR_KEY);
			const preferred =
				floors.value.find((floor) => floor.name === remembered) || floors.value[0] || null;
			setActiveFloor(preferred ? preferred.name : null);
		}
	};

	/** The authoritative read. Every socket event ultimately defers to this. */
	const refresh = async (options: { silent?: boolean } = {}) => {
		if (!posProfileName.value) return;
		if (!options.silent) loading.value = true;
		try {
			// Deliberately unfiltered: the floor switcher needs every floor and
			// the dock badge counts open orders across the whole register, so a
			// per-floor pull would make the badge lie the moment a waiter
			// switched floors. It is one grouped query either way (§F9).
			const snapshot = await restaurantApi.getFloorSnapshot(
				posProfileName.value,
				companyName.value,
			);
			applySnapshot(snapshot);
			error.value = null;
		} catch (err: any) {
			error.value = err?.message || String(err);
		} finally {
			loading.value = false;
		}
	};

	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	/** Coalesces the burst of broadcasts a busy service produces. */
	const scheduleRefresh = (delayMs = 1200) => {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			void refresh({ silent: true });
		}, delayMs);
	};

	// ---- realtime (§6.7) ----------------------------------------------------

	const deviceIdentifier = getDeviceIdentifier();

	const applyFloorUpdate = (payload: any) => {
		if (!payload || payload.source_device === deviceIdentifier) return;
		const rows: any[] = Array.isArray(payload.tables) ? payload.tables : [];
		if (rows.length) {
			const patch = new Map<string, any>(rows.map((row) => [row.name, row]));
			tables.value = tables.value.map((table) => {
				const row = patch.get(table.name);
				return row
					? { ...table, occupied: row.occupied, needs_cleaning: row.needs_cleaning }
					: table;
			});
		}
		// The payload carries counts, not order rows — the pull fills in who is
		// sitting where. Cheap because it is coalesced.
		scheduleRefresh();
	};

	const socket = createFloorRealtime({
		activeFloor: () => activeFloor.value,
		onUpdate: applyFloorUpdate,
		onResync: () => void refresh({ silent: true }),
	});

	/** Called by FloorView on mount; safe to call repeatedly. */
	const activate = async () => {
		socket.bind();
		await refresh();
		socket.subscribe();
	};

	const deactivate = () => {
		socket.unbind();
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	};

	// ---- order flow ---------------------------------------------------------

	const setActiveOrder = (order: OrderRow | null) => {
		activeOrder.value = order;
		if (!order) cartSync.reset();
	};

	const upsertOrder = (order: OrderRow) => {
		const index = orders.value.findIndex((row) => row.order_uid === order.order_uid);
		if (index >= 0) orders.value.splice(index, 1, order);
		else orders.value.push(order);
	};

	const dropOrder = (orderUid: string) => {
		orders.value = orders.value.filter((row) => row.order_uid !== orderUid);
		if (activeOrder.value?.order_uid === orderUid) setActiveOrder(null);
	};

	const orderActions = createOrderActions({
		posProfile: posProfileName,
		company: companyName,
		activeOrder,
		transferOrder,
		markSyncing,
		setActiveOrder,
		upsertOrder,
		dropOrder,
		loadOrderIntoCart,
		flushCartSync,
		refresh,
		isOccupied,
		onError: (message) => {
			error.value = message;
		},
	});

	// ---- floor editor -------------------------------------------------------

	/**
	 * Whole-floor save with the optimistic-concurrency token (§6.3). The
	 * caller handles TimestampMismatch by re-pulling and asking; this only
	 * reports it.
	 */
	const saveLayout = async (payload: {
		layout: restaurantApi.FloorLayout;
		tables: restaurantApi.FloorEditorTable[];
	}) => {
		if (!activeFloor.value) return;
		const floor = activeFloorRow.value;
		await restaurantApi.saveFloorLayout({
			posProfile: posProfileName.value,
			company: companyName.value,
			floor: activeFloor.value,
			layout: payload.layout,
			tables: payload.tables,
			modified: floor?.modified || null,
		});
		await refresh({ silent: true });
	};

	/** Clear the bussing latch on a table (settle sets it; bussing clears it). */
	const markClean = async (table: string) => {
		markSyncing(table, true);
		try {
			await restaurantApi.markTableClean({
				posProfile: posProfileName.value,
				company: companyName.value,
				table,
			});
			tables.value = tables.value.map((row) =>
				row.name === table ? { ...row, needs_cleaning: 0, bill_printed_at: null } : row,
			);
		} catch (err: any) {
			error.value = err?.message || String(err);
		} finally {
			markSyncing(table, false);
		}
	};

	return {
		// state
		floors,
		tables,
		orders,
		activeFloor,
		activeFloorRow,
		activeFloorTables,
		viewMode,
		editorMode,
		loading,
		error,
		lastSyncedAt,
		transferOrder,
		activeOrder,
		deviceIdentifier,
		// derived
		hasTables,
		invoiceMode,
		isRecordOnly,
		ordersByTable,
		tabOrders,
		openOrdersCount,
		ordersForTable,
		isOccupied,
		unsentCountForTable,
		isSyncing,
		// actions
		activate,
		deactivate,
		refresh,
		setActiveFloor,
		setViewMode,
		setEditorMode,
		...orderActions,
		setActiveOrder,
		loadOrderIntoCart,
		flushCartSync,
		saveLayout,
		markClean,
	};
});
