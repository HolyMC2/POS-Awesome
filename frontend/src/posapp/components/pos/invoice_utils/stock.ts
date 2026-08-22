import { parseBooleanSetting } from "../../../utils/stock";
// Imported rather than retyped: three files now agree on this spelling, and a
// silent divergence would drop the combo ceiling without failing anything.
import { COMBO_COMPONENTS_FIELD } from "../../../composables/pos/items/comboLineAttachment";
import { useStockUtils } from "../../../composables/pos/shared/useStockUtils";
import { useBatchSerial } from "../../../composables/pos/shared/useBatchSerial";

declare const __: (_text: string, _args?: any[]) => string;
declare const flt: (_value: unknown, _precision?: number) => number;
declare const frappe: any;

let stockUtilsApi: ReturnType<typeof useStockUtils> | null = null;
let batchSerialApi: ReturnType<typeof useBatchSerial> | null = null;

function getStockUtilsApi() {
	if (!stockUtilsApi) {
		stockUtilsApi = useStockUtils();
	}
	return stockUtilsApi;
}

function getBatchSerialApi() {
	if (!batchSerialApi) {
		batchSerialApi = useBatchSerial();
	}
	return batchSerialApi;
}

export function calc_stock_qty(context: any, item: any, value: any) {
	if (!item) return;
	const { calcStockQty } = getStockUtilsApi();

	// Delegate to composable logic
	calcStockQty(item, value);
	// Composable might not handle `this` context specific logic like calling `update_qty_limits` on context
	// In original code:
	// calcStockQty(item, value, this);
	// So if calcStockQty in composable expects context as 3rd arg, we should pass it.
	// Based on imports in invoiceItemMethods.ts: const { calcStockQty } = useStockUtils();
	// It seems it was imported.

	if (context.update_qty_limits) {
		context.update_qty_limits(item);
	}

	const blockSale = Boolean(
		context.pos_profile?.posa_block_sale_beyond_available_qty ||
		context.blockSaleBeyondAvailableQty,
	);
	const allowNegativeStock =
		!blockSale &&
		(parseBooleanSetting(context.stock_settings?.allow_negative_stock) ||
			parseBooleanSetting(item?.allow_negative_stock));
	let clamped = false;
	if (
		blockSale &&
		!allowNegativeStock &&
		item.max_qty !== undefined &&
		flt(item.qty) > item.max_qty
	) {
		context.toastStore.show({
			title: __("Quantity exceeds available stock"),
			text: __(
				"The quantity for {0} has been adjusted to the maximum available stock.",
				[item.item_name],
			),
			color: "warning",
		});
		item.qty = item.max_qty;
		clamped = true;
	}

	if (flt(item.qty) === 0) {
		if (context.remove_item) context.remove_item(item);
		if (context.$forceUpdate) context.$forceUpdate();
		return;
	}

	if (clamped) {
		if (context.calc_item_price) context.calc_item_price(item);
	} else if (!context._applyingPricingRules) {
		if (context.schedulePricingRuleApplication)
			context.schedulePricingRuleApplication();
	}
}

/**
 * Does this line carry a combo's component list?
 *
 * Deliberately only "has components", not the reader's fuller `isComboLine`
 * (which also excludes a broken combo): `posa_combo_broken` governs whether
 * the row RENDERS as a combo after a partial return, and a half-returned combo
 * still consumes its remaining components' stock. Rendering and stock are
 * different questions and answering both with one predicate is how the ceiling
 * would silently vanish mid-return.
 */
const carriesComboComponents = (item: any): boolean =>
	Array.isArray(item?.[COMBO_COMPONENTS_FIELD]) && item[COMBO_COMPONENTS_FIELD].length > 0;

export function update_qty_limits(context: any, item: any) {
	// A combo parent is genuinely not a stock item — `expandBundle` sets
	// `is_stock_item = 0` because the SUBSTRATE decrements its components, not
	// it — so it falls into the early return below and had its ceiling wiped on
	// every edit. The clamp held on the initial add (the attach set `max_qty`
	// directly) and was cleared by the next qty change, which is the worst
	// shape a stock bug can take: correct on the screen the cashier checks,
	// gone by the time they finish.
	//
	// So a combo is handled BEFORE the non-stock return, and gets the ceiling
	// nothing else in the system can supply — `available` is the number of
	// whole combos the components allow, computed by the availability rule.
	// `is_stock_item` stays 0: packed-item handling and the server both read it.
	if (item && carriesComboComponents(item)) {
		const blockSale = Boolean(
			context.pos_profile?.posa_block_sale_beyond_available_qty ||
			context.blockSaleBeyondAvailableQty,
		);
		const available = item._combo_available;
		// No combo-specific toggle: a register that chose warn-and-sell keeps
		// selling combos too, exactly as it does for every plain line.
		if (blockSale && typeof available === "number" && Number.isFinite(available)) {
			// Divided the same way a stock line is, so a combo sold by a
			// multi-unit UOM is clamped in the unit the operator is typing in.
			item.max_qty = flt(available / (item.conversion_factor || 1));
			item.disable_increment = flt(item.qty) >= item.max_qty;
		} else {
			item.max_qty = undefined;
			item.disable_increment = false;
		}
		return;
	}

	// Clamp only KNOWN stock items. Rows loaded from a saved doc (Sales
	// Invoice Item has no is_stock_item column) or hydrated from a payload
	// that omits the flag would otherwise inherit max_qty=0 from the
	// availability coordinator and be removed from the cart on any edit.
	// Server-side stock validation still enforces at pay/submit.
	if (item && !parseBooleanSetting(item.is_stock_item)) {
		item.max_qty = undefined;
		item.disable_increment = false;
		return;
	}

	if (item && item._base_actual_qty !== undefined) {
		item.max_qty = flt(
			item._base_actual_qty / (item.conversion_factor || 1),
		);

		// Set increment disable flag based on stock limits
		const blockSale = Boolean(
			context.pos_profile?.posa_block_sale_beyond_available_qty ||
			context.blockSaleBeyondAvailableQty,
		);
		const allowNegativeStock =
			!blockSale &&
			(parseBooleanSetting(
				context.stock_settings?.allow_negative_stock,
			) ||
				parseBooleanSetting(item?.allow_negative_stock));

		if (allowNegativeStock) {
			item.disable_increment = false;
		} else if (blockSale) {
			item.disable_increment = item.qty >= item.max_qty;
		} else {
			item.disable_increment =
				!parseBooleanSetting(
					context.stock_settings?.allow_negative_stock,
				) && item.qty >= item.max_qty;
		}
	}
}

export async function fetch_available_qty(context: any, item: any) {
	if (!item || !item.item_code || !item.warehouse || item.is_stock_item === 0)
		return;

	// Use cache methods from context or import? They were methods on mixin.
	// context._getStockCacheKey etc.
	// We should assume they are available if we didn't extract them to a util module yet.
	// Actually we extracted them to cache.js but haven't decided if mixin exposes them directly.
	// The mixin (invoiceItemMethods) will import * from cache.js and expose them.

	const key = context._getStockCacheKey
		? context._getStockCacheKey(item)
		: null;
	if (key) {
		const cachedQty = context._getCachedStockQty
			? context._getCachedStockQty(key)
			: null;
		if (cachedQty !== null && cachedQty !== undefined) {
			item.available_qty = cachedQty;
			update_qty_limits(context, item);
			return cachedQty;
		}
	}

	const runner = async () => {
		try {
			const response = await frappe.call({
				method: "posawesome.posawesome.api.items.get_available_qty",
				args: {
					items: JSON.stringify([
						{
							item_code: item.item_code,
							warehouse: item.warehouse,
							batch_no: item.batch_no,
						},
					]),
				},
			});
			const qty =
				response.message && response.message.length
					? flt(response.message[0].available_qty)
					: 0;

			if (key) {
				if (context._storeStockQty) context._storeStockQty(key, qty);
				// legacy cache support?
				if (context.available_stock_cache) {
					context.available_stock_cache[key] = {
						qty,
						ts: Date.now(),
					};
				}
			}
			item.available_qty = qty;
			update_qty_limits(context, item);
			return qty;
		} catch (error) {
			console.error("Failed to fetch available qty", error);
			throw error;
		}
	};

	if (context.queueItemTask) {
		return context.queueItemTask(item, "fetch_available_qty", runner);
	}
	return runner();
}

export function set_serial_no(context: any, item: any) {
	// legacy delegate
	const { setSerialNo } = getBatchSerialApi();
	return setSerialNo(item, context);
}

export function set_batch_qty(
	context: any,
	item: any,
	value: any,
	update = true,
) {
	// legacy delegate
	const { setBatchQty } = getBatchSerialApi();
	return setBatchQty(item, value, update, context);
}

export function calc_uom(context: any, item: any, value: any) {
	if (!item) return;
	const { calcUom } = getStockUtilsApi();
	console.log("[stock.ts] calc_uom event received", {
		item: item.item_code,
		uom: value,
	});
	const task = () => calcUom(item, value, context);
	if (context.queueItemTask) {
		return context.queueItemTask(item, "calc_uom", task, { force: true });
	}
	return task();
}
