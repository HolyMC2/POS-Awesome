import { useBundles } from "../useBundles";
import { useComboComponents } from "../useComboComponents";
import { attachComboComponents } from "../comboLineAttachment";
import { useStockUtils } from "../../shared/useStockUtils";

export function useItemBundles() {
	const { getBundleComponents } = useBundles();
	const { getComboComponents } = useComboComponents();
	const { calcStockQty } = useStockUtils();

	const expandBundle = async (parent: any, context: any) => {
		const components = await getBundleComponents(parent.item_code);
		if (!components || !components.length) {
			return;
		}

		/*
		 * Mark the line as a combo (roadmap §17.6).
		 *
		 * This is the only place in the product where a line learns it is a
		 * combo, and it belongs here because this function is already the one
		 * that knows the item is a Product Bundle — asking a second time
		 * elsewhere would be a second source of truth about what a bundle is.
		 *
		 * A SECOND fetch rather than a reuse of `components` above: that list
		 * comes from the packing read model and carries no rate, so
		 * `priceCombo()` would compute a list price of 0 and render "ahorra
		 * $0" under every combo — a wrong number on a ticket, which is worse
		 * than no badge. It is cached per bundle and per pricing context and
		 * fires only for bundles, so a plain scan pays nothing.
		 *
		 * Awaited, not fired and forgotten: `expandBundle` already runs inside
		 * `runAsyncTask`, off the scan path, and the operator should not watch
		 * a combo row appear a beat after the line it belongs to.
		 */
		const priced = await getComboComponents(parent.item_code, {
			pos_profile: context.pos_profile,
			customer: context.customer,
		});
		// The profile is what decides whether the availability rule becomes a
		// CEILING or stays a displayed figure: `ceilingFromResolution` returns
		// null unless `posa_block_sale_beyond_available_qty` is on. Called
		// without it, the rule computes and shows but never blocks — which is
		// the state this line closes.
		attachComboComponents(parent, priced, { posProfile: context.pos_profile });
		parent.is_bundle = 1;
		parent.is_bundle_parent = 1;
		parent.is_stock_item = 0;
		parent.warehouse = null;
		parent.stock_qty = 0;
		parent.bundle_id = context.makeid
			? context.makeid(10)
			: Math.random().toString(36).substr(2, 10);
		// Force update logic is handled by store reactivity usually, but here we modify parent properties.
		// Since 'parent' is reactive from store, changes reflect.

		for (const comp of components) {
			const isStockItem = comp.is_stock_item ?? 1;
			const child = {
				parent_item: parent.item_code,
				bundle_id: parent.bundle_id,
				item_code: comp.item_code,
				item_name: comp.item_name || comp.item_code,
				qty: (parent.qty || 1) * comp.qty,
				stock_qty: (parent.qty || 1) * comp.qty,
				uom: comp.uom,
				rate: 0,
				child_qty_per_bundle: comp.qty,
				warehouse: context.pos_profile.warehouse,
				is_stock_item: isStockItem ? 1 : 0,
				has_batch_no: comp.is_batch,
				has_serial_no: comp.is_serial,
				posa_row_id: context.makeid
					? context.makeid(20)
					: Math.random().toString(36).substr(2, 20),
				posa_offers: JSON.stringify([]),
				posa_offer_applied: 0,
				posa_is_offer: 0,
				_needs_update: true, // Mark for background update
			};
			context.packed_items.push(child);

			// Schedule explicit calc_stock_qty if needed, or rely on update
			calcStockQty(child, child.qty);
		}
		// Trigger background flush if available
		if (context.triggerBackgroundFlush) context.triggerBackgroundFlush();
	};

	return {
		expandBundle,
	};
}
