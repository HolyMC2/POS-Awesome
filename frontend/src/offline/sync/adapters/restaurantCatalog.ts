/**
 * Sync adapters for the two pulled restaurant-catalog resources.
 *
 * `pos_floor` and `pos_table` follow the shipped delta pattern exactly: an
 * explicit server-side field list (never `["*"]`), a `modified` watermark, a
 * scope-signature wipe when the register changes profile/company, and full
 * resync on the server's `full_resync_required`.
 *
 * @module offline/sync/adapters/restaurantCatalog
 */
import {
	clearStoredFloors,
	clearStoredTables,
	deleteStoredFloors,
	deleteStoredTables,
	putStoredFloors,
	putStoredTables,
} from "../../restaurantCatalog";
import { getSyncResourceState } from "../syncState";
import type { SyncResourceId } from "../types";
import {
	buildResourceSyncResult,
	buildScopeSignature,
	persistResourceSyncState,
	type ResourceSyncResult,
	type SyncResponse,
	type SyncScopedProfile,
} from "./common";

type CatalogFetcher = (args: {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	schemaVersion?: string | null;
}) => Promise<SyncResponse>;

type CatalogSyncArgs = {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	schemaVersion?: string | null;
	fetcher: CatalogFetcher;
};

function extractChanged(response: SyncResponse) {
	return (response?.changes || [])
		.map((entry) => entry?.data)
		.filter((row): row is Record<string, any> => !!row?.name);
}

function extractDeletedNames(response: SyncResponse, prefix: string) {
	return (response?.deleted || [])
		.map((entry) => {
			const key = String(entry?.key || "");
			return key.startsWith(prefix) ? key.slice(prefix.length) : "";
		})
		.filter(Boolean);
}

async function hasScopeChanged(
	resourceId: SyncResourceId,
	posProfile: SyncScopedProfile,
) {
	const nextScopeSignature = buildScopeSignature(posProfile);
	const currentState = await getSyncResourceState(resourceId);
	return !!(
		currentState?.scopeSignature &&
		currentState.scopeSignature !== nextScopeSignature
	);
}

async function syncCatalogResource(
	resourceId: SyncResourceId,
	deletedKeyPrefix: string,
	writeRows: (rows: Record<string, any>[]) => Promise<number>,
	deleteRows: (names: string[]) => Promise<void>,
	clearRows: () => Promise<void>,
	args: CatalogSyncArgs,
): Promise<ResourceSyncResult> {
	const scopeChanged = await hasScopeChanged(resourceId, args.posProfile);
	const effectiveWatermark = scopeChanged ? null : args.watermark;
	const response = await args.fetcher({
		posProfile: args.posProfile,
		watermark: effectiveWatermark,
		schemaVersion: args.schemaVersion,
	});

	if (response?.full_resync_required) {
		// Reset the cursor so the NEXT run pulls everything; keeping the stale
		// one pins the resource in "limited" forever (the server keeps replying
		// full_resync_required to the same cursor). Mirrors the customers adapter.
		await persistResourceSyncState({
			resourceId,
			status: "limited",
			posProfile: args.posProfile,
			response,
			watermark: null,
		});
		return buildResourceSyncResult(
			resourceId,
			"limited",
			response,
			null,
			args.posProfile,
		);
	}

	if (scopeChanged) {
		await clearRows();
	}

	await writeRows(extractChanged(response));
	await deleteRows(extractDeletedNames(response, deletedKeyPrefix));

	await persistResourceSyncState({
		resourceId,
		status: "fresh",
		posProfile: args.posProfile,
		response,
		watermark: effectiveWatermark,
	});
	return buildResourceSyncResult(
		resourceId,
		"fresh",
		response,
		effectiveWatermark,
		args.posProfile,
	);
}

export async function syncPosFloorsResource(args: CatalogSyncArgs) {
	return syncCatalogResource(
		"pos_floor",
		"pos_floor::",
		putStoredFloors,
		deleteStoredFloors,
		clearStoredFloors,
		args,
	);
}

export async function syncPosTablesResource(args: CatalogSyncArgs) {
	return syncCatalogResource(
		"pos_table",
		"pos_table::",
		putStoredTables,
		deleteStoredTables,
		clearStoredTables,
		args,
	);
}
