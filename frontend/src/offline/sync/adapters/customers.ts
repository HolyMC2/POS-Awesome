import {
	clearCustomerStorage,
	getCustomerStorageCount,
	setCustomersLastSync,
} from "../../cache";
import {
	deleteCustomerStorageByNames,
	setCustomerStorage,
} from "../../customers";
import { getSyncResourceState } from "../syncState";
import {
	buildResourceSyncResult,
	buildScopeSignature,
	persistResourceSyncState,
	refreshSnapshotFromSync,
	resolveWatermark,
	type ResourceSyncResult,
	type SyncResponse,
	type SyncScopedProfile,
} from "./common";

type CustomersFetcher = (args: {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	schemaVersion?: string | null;
}) => Promise<SyncResponse>;

type CustomersSyncArgs = {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	schemaVersion?: string | null;
	fetcher: CustomersFetcher;
};

function extractChangedCustomers(response: SyncResponse) {
	return (response?.changes || [])
		.map((entry) => entry?.data)
		.filter((row): row is Record<string, any> => !!row?.name);
}

function extractDeletedCustomerNames(response: SyncResponse) {
	return (response?.deleted || [])
		.map((entry) => {
			const key = String(entry?.key || "");
			return key.startsWith("customer::")
				? key.slice("customer::".length)
				: "";
		})
		.filter(Boolean);
}

async function hasCustomerScopeChanged(posProfile: SyncScopedProfile) {
	const nextScopeSignature = buildScopeSignature(posProfile);
	const currentState = await getSyncResourceState("customers");
	return !!(
		currentState?.scopeSignature &&
		currentState.scopeSignature !== nextScopeSignature
	);
}

export async function syncCustomersResource(
	args: CustomersSyncArgs,
): Promise<ResourceSyncResult> {
	const scopeChanged = await hasCustomerScopeChanged(args.posProfile);
	const effectiveWatermark = scopeChanged ? null : args.watermark;
	const response = await args.fetcher({
		posProfile: args.posProfile,
		watermark: effectiveWatermark,
		schemaVersion: args.schemaVersion,
	});

	if (response?.full_resync_required) {
		await persistResourceSyncState({
			resourceId: "customers",
			status: "limited",
			posProfile: args.posProfile,
			response,
			watermark: effectiveWatermark,
		});
		return buildResourceSyncResult(
			"customers",
			"limited",
			response,
			effectiveWatermark,
		);
	}

	if (scopeChanged) {
		await clearCustomerStorage();
	}

	const changedCustomers = extractChangedCustomers(response);
	if (changedCustomers.length) {
		await setCustomerStorage(changedCustomers);
	}

	const deletedCustomerNames = extractDeletedCustomerNames(response);
	if (deletedCustomerNames.length) {
		await deleteCustomerStorageByNames(deletedCustomerNames);
	}

	const customersCount = await getCustomerStorageCount();
	refreshSnapshotFromSync({
		posProfile: args.posProfile,
		cacheState: {
			customersCount,
		},
	});

	const nextWatermark = resolveWatermark(response, effectiveWatermark);
	if (nextWatermark) {
		setCustomersLastSync(nextWatermark);
	}

	await persistResourceSyncState({
		resourceId: "customers",
		status: "fresh",
		posProfile: args.posProfile,
		response,
		watermark: effectiveWatermark,
	});
	return buildResourceSyncResult(
		"customers",
		"fresh",
		response,
		effectiveWatermark,
	);
}
