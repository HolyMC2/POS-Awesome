import type { POSProfile } from "../../types/models";
import type { GetItemsArgs } from "../../services/itemService";

export interface LoadItemsOptions {
	forceServer?: boolean;
	searchValue?: string;
	groupFilter?: string;
	priceList?: string | null;
	limit?: number | null;
	/**
	 * "Lean" search mode: hard-cap the page (default 50), drop image
	 * payload, and merge results into the existing items array
	 * instead of replacing it. Used by the search server-fallback so
	 * a single missing-item retry never re-pulls the full catalog.
	 */
	lean?: boolean;
}

export interface BuildLoadItemsRequestInput {
	options?: LoadItemsOptions;
	posProfile: POSProfile | null;
	activePriceList: string;
	customer: string | null;
	itemCount: number;
	totalItemCount: number;
	limitSearchEnabled: boolean;
	resolvePageSize: () => number;
	resolveLimitSearchSize: () => number | null;
}

export interface BuiltLoadItemsRequest {
	forceServer: boolean;
	searchValue: string;
	normalizedGroup: string;
	priceList: string | null;
	effectivePriceList: string;
	isInitialBootstrapRequest: boolean;
	resolvedLimit: number | null;
	args: GetItemsArgs | null;
	lean: boolean;
}

export const buildLoadItemsRequest = ({
	options = {},
	posProfile,
	activePriceList,
	customer,
	itemCount,
	totalItemCount,
	limitSearchEnabled,
	resolvePageSize,
	resolveLimitSearchSize,
}: BuildLoadItemsRequestInput): BuiltLoadItemsRequest => {
	const {
		forceServer = false,
		searchValue: rawSearchValue = "",
		groupFilter = "ALL",
		priceList = null,
		limit = null,
		lean = false,
	} = options;

	const searchValue =
		typeof rawSearchValue === "string" ? rawSearchValue.trim() : "";
	const normalizedGroup =
		typeof groupFilter === "string" && groupFilter.trim().length > 0
			? groupFilter.trim()
			: "ALL";

	const isInitialBootstrapRequest =
		!forceServer &&
		!limitSearchEnabled &&
		!searchValue &&
		normalizedGroup === "ALL" &&
		itemCount === 0 &&
		totalItemCount === 0;

	const resolvedLimit =
		Number.isFinite(limit) && limit! > 0
			? limit!
			: lean
				? 50
				: isInitialBootstrapRequest
					? resolvePageSize()
					: limitSearchEnabled
						? resolveLimitSearchSize()
						: null;

	if (!posProfile) {
		return {
			forceServer,
			searchValue,
			normalizedGroup,
			priceList,
			effectivePriceList: priceList || activePriceList,
			isInitialBootstrapRequest,
			resolvedLimit,
			args: null,
			lean,
		};
	}

	const requestProfile = JSON.parse(JSON.stringify(posProfile));
	const effectivePriceList = priceList || activePriceList;
	if (forceServer) {
		requestProfile.posa_use_server_cache = 0;
		requestProfile.posa_force_reload_items = 1;
	}

	const args: GetItemsArgs = {
		pos_profile: JSON.stringify(requestProfile),
		price_list: effectivePriceList,
		item_group: normalizedGroup !== "ALL" ? normalizedGroup.toLowerCase() : "",
		search_value: searchValue || "",
		customer,
		// Lean searches drop the image payload — the server response
		// shrinks dramatically on catalogs with embedded thumbnails,
		// which is the dominant cost in the search-fallback path.
		include_image: lean ? 0 : 1,
		item_groups: posProfile?.item_groups?.map((g: any) => g.item_group) || [],
	};

	if (typeof resolvedLimit === "number" && resolvedLimit > 0) {
		args.limit = resolvedLimit;
	}

	return {
		forceServer,
		searchValue,
		normalizedGroup,
		priceList,
		effectivePriceList,
		isInitialBootstrapRequest,
		resolvedLimit,
		args,
		lean,
	};
};
