import { ref, type Ref, type ComputedRef } from "vue";
import { useToastStore } from "../../../stores/toastStore";
import { perfMarkStart, perfMarkEnd } from "../../../utils/perf";
import {
	formatStockShortageError,
	parseBooleanSetting,
} from "../../../utils/stock";
import { debugLog } from "../../../utils/debug";
import { recordResolvedScan } from "./useLastScanEcho";
import { saveItems, savePriceListItems } from "../../../../offline/index";
import { openItemSelectionDialog } from "../../../utils/itemSelectionDialog";
import {
	extractScanAssignmentFromItem,
	emptyScanAssignment,
	type ScanAssignment,
} from "./scanProcessor/scanAssignment";
import {
	embeddedLookupCodes,
	parseEmbeddedBarcode,
	qtyFromEmbeddedLabel,
	readEmbeddedScheme,
	type EmbeddedInvalid,
	type EmbeddedParsed,
	type LabelQtyRefusal,
} from "../../../utils/embeddedBarcode";
import { isFractionEligible, qtyPrecisionForUom } from "../../../utils/fractionalMath";
// @ts-ignore
import placeholderImage from "../../../components/pos/placeholder-image.png";

declare const frappe: any;
declare const __: (_str: string, _args?: any[]) => string;

export interface ScanProcessorContext {
	items: Ref<any[]>;
	pos_profile: Ref<any>;
	isReturnInvoice?: Ref<boolean> | ComputedRef<boolean> | boolean;
	active_price_list: Ref<string>;
	customer_price_list: Ref<string | null>;
	itemDetailFetcher: {
		update_items_details: (_items: any[]) => Promise<void>;
	};
	itemAddition: {
		addItem: (_item: any, _options?: any) => Promise<void>;
	};
	barcodeIndex: {
		ensureBarcodeIndex: () => any;
		lookupItemByBarcode: (_barcode: string) => any;
		replaceBarcodeIndex: (_items: any[]) => void;
		indexItem: (_item: any) => void;
		searchItemsByCode: (_items: any, _code: string) => any[];
		resetBarcodeIndex: () => void;
	};
	scannerInput: any;
	searchCache?: Ref<Map<any, any>>;
	eventBus?: any;
	format_number: (_val: any, _precision?: number) => string;
	float_precision: ComputedRef<number>;
	hide_qty_decimals: ComputedRef<boolean>;
	blockSaleBeyondAvailableQty: ComputedRef<boolean>;
	deferStockValidationToPayment?: ComputedRef<boolean> | Ref<boolean> | boolean;
	currency_precision: ComputedRef<number>;
	exchange_rate: ComputedRef<number>;
	format_currency: (
		_value: number,
		_currency: string,
		_precision: number,
	) => string;
	ratePrecision: (_val: any) => number;
	customer: Ref<any>;
	onItemAdded?: () => void;
	onItemNotFound?: (_code: string) => void;
	stock_settings: Ref<any>;
	selected_currency?: Ref<string>;
	conversion_rate?: Ref<number> | ComputedRef<number>;
	// Callback for search focus or clear
	get_search?: (_code: string) => string;
	get_item_qty?: (_code: string) => string;
	search_from_scanner_ref?: Ref<boolean>;
}

/**
 * Manages the logic for processing scanned barcodes, including:
 * - Scale barcode parsing
 * - Server fetch for missing items
 * - Stock availability validation
 * - UOM price conversion
 * - Adding to invoice via useItemAddition
 */
export function useScanProcessor(context: ScanProcessorContext) {
	// Deconstruct required context
	const {
		items,
		pos_profile,
		active_price_list,
		customer_price_list,
		itemDetailFetcher,
		itemAddition,
		barcodeIndex,
		scannerInput,
		searchCache,
		eventBus,
		float_precision,
		blockSaleBeyondAvailableQty,
		// exchange_rate,
		format_currency,
		ratePrecision,
		// customer,
	} = context;

	const toastStore = useToastStore();
	// const uiStore = useUIStore();

	const awaitingScanResult = ref(false);
	const pendingScanCode = ref("");
	const logScanFlow = (step: string, payload?: any) => {
		debugLog(`[POS ScanFlow] ${step}`, payload || {});
	};

	const isNegativeStockEnabled = (item: any = null) => {
		const allowNegativeSetting = parseBooleanSetting(
			context.stock_settings.value?.allow_negative_stock,
		);
		const allowNegativeItem = item
			? parseBooleanSetting(item.allow_negative_stock)
			: false;
		return allowNegativeSetting || allowNegativeItem;
	};

	const isReturnMode = () => {
		const value = context.isReturnInvoice;
		if (typeof value === "boolean") return value;
		return Boolean(value?.value);
	};

	const shouldDeferStockValidation = () => {
		const value = context.deferStockValidationToPayment;
		if (typeof value === "boolean") return value;
		return Boolean(value?.value);
	};

	const showScanError = (error: {
		message: string;
		code: string;
		details: string;
	}) => {
		if (scannerInput.scanErrorDialog) {
			scannerInput.scanErrorDialog.value = true;
			scannerInput.scanErrorMessage.value = error.message;
			scannerInput.scanErrorCode.value = error.code;
			scannerInput.scanErrorDetails.value = error.details;
			if (typeof scannerInput.playScanTone === "function") {
				scannerInput.playScanTone("error");
			}
		}
	};

	const showMultipleItemsDialog = (itemsList: any[], scannedCode: string) => {
		openItemSelectionDialog({
			items: itemsList,
			scannedCode,
			currency: pos_profile.value.currency,
			formatCurrency: format_currency,
			ratePrecision: ratePrecision,
			placeholderImage,
			translate: __,
			onSelect: (item: any) =>
				addScannedItemToInvoice(item, scannedCode, null, null),
		});
	};

	type ScanMeta = {
		isScaleBarcode?: boolean;
		/** «etiqueta de báscula …» — written onto the line's note. */
		labelProvenance?: string;
	};

	/**
	 * Why a labelling-scale label was refused, in a sentence a cashier can act
	 * on. Every one of these names the label, not the software: the operator's
	 * next move is to look at the sticker, re-print it, or weigh again.
	 */
	const describeLabelRefusal = (reason: EmbeddedInvalid["reason"]): string => {
		if (reason === "check_digit") {
			return __(
				"The scale label did not verify — it was read wrong or printed damaged. Scan it again, or weigh the item again.",
			);
		}
		if (reason === "empty_short_code") {
			return __("The scale label names no item. Re-print it from the scale.");
		}
		return __("The scale label carries no weight or price. Weigh the item again.");
	};

	const describeLabelQtyRefusal = (reason: LabelQtyRefusal): string => {
		if (reason === "no_rate") {
			return __(
				"This item has no price on this register, so the amount on the label cannot be turned into a quantity.",
			);
		}
		if (reason === "below_minimum_qty") {
			return __("The label's amount is smaller than the smallest quantity this register can sell.");
		}
		return __("The scale label carries no weight or price. Weigh the item again.");
	};

	const addScannedItemToInvoice = async (
		item: any,
		scannedCode: string,
		qtyFromBarcode: number | null = null,
		priceFromBarcode: number | null = null,
		scanAssignment: ScanAssignment = emptyScanAssignment(),
		scanMeta: ScanMeta = {},
	) => {
		logScanFlow("Preparing scanned item add", {
			scannedCode,
			item_code: item?.item_code,
			scanAssignment,
			qtyFromBarcode,
			priceFromBarcode,
			isScaleBarcode: Boolean(scanMeta?.isScaleBarcode),
		});

		// Clone the item to avoid mutating list data
		const newItem = { ...item };
		newItem._scanned_barcode = scannedCode;
		if (scanMeta?.isScaleBarcode) {
			newItem._is_scale_barcode = true;
			newItem._scanned_scale_barcode = scannedCode;
			if (!String(newItem.barcode || "").trim()) {
				newItem.barcode = scannedCode;
			}
		}
		// Provenance on the LINE, not just in the console: a weighed line's
		// quantity came from a sticker rather than from anybody's hands, and
		// when a customer disputes the weight an hour later that is the only
		// record of where the number came from. Never overwrites a note the
		// operator (or the kitchen) already put there.
		if (scanMeta?.labelProvenance && !String(newItem.posa_notes || "").trim()) {
			newItem.posa_notes = scanMeta.labelProvenance;
		}

		// If the scanned barcode has a specific UOM, apply it
		if (Array.isArray(newItem.item_barcode)) {
			const barcodeMatch = newItem.item_barcode.find(
				(b: any) => b.barcode === scannedCode,
			);
			const matchedUom = barcodeMatch?.uom;
			if (barcodeMatch && matchedUom) {
				newItem.uom = matchedUom;

				// Try fetching the rate for this UOM from the active price list
				try {
					const res = await frappe.call({
						method: "posawesome.posawesome.api.items.get_price_for_uom",
						args: {
							item_code: newItem.item_code,
							price_list: active_price_list.value,
							uom: matchedUom,
						},
					});

					const uomInfo =
						newItem.item_uoms &&
						newItem.item_uoms.find(
							(u: any) => u.uom === matchedUom,
						);
					const conversionFactor =
						uomInfo && uomInfo.conversion_factor
							? parseFloat(uomInfo.conversion_factor)
							: null;
					const currentConversion = newItem.conversion_factor || 1;
					const baseUnitRate =
						parseFloat(
							String(
								(newItem.base_price_list_rate ||
									newItem.base_rate ||
									newItem.price_list_rate ||
									newItem.rate ||
									0) / (currentConversion || 1),
							),
						) || 0;

					if (res.message) {
						const price = parseFloat(res.message);
						newItem.rate = price;
						newItem.price_list_rate = price;
						const basePrice = conversionFactor
							? price / conversionFactor
							: price;
						newItem.base_rate = basePrice;
						newItem.base_price_list_rate = basePrice;
						if (conversionFactor) {
							newItem.conversion_factor = conversionFactor;
						}
						newItem._manual_rate_set = true;
						newItem.skip_force_update = true;
					} else if (conversionFactor) {
						const newPrice = baseUnitRate * conversionFactor;

						newItem.rate = newPrice;
						newItem.price_list_rate = newPrice;
						newItem.base_rate = baseUnitRate;
						newItem.base_price_list_rate = baseUnitRate;
						newItem.conversion_factor = conversionFactor;
						newItem._manual_rate_set = true;
						newItem.skip_force_update = true;
					}
				} catch (e) {
					console.error("Failed to fetch UOM price", e);
				}
			}
		}

		let effectiveQty: number | null = qtyFromBarcode;
		if (
			(effectiveQty === null || Number.isNaN(effectiveQty)) &&
			newItem._scale_qty !== undefined &&
			newItem._scale_qty !== null
		) {
			const parsedScaleQty = parseFloat(newItem._scale_qty);
			if (!Number.isNaN(parsedScaleQty)) {
				effectiveQty = parsedScaleQty;
			}
		}

		// Apply quantity from scale barcode if available
		if (effectiveQty !== null && !Number.isNaN(effectiveQty)) {
			newItem.qty = effectiveQty;
			newItem._barcode_qty = true;
		}

		let effectivePrice: number | null = priceFromBarcode;
		if (
			(effectivePrice === null || Number.isNaN(effectivePrice)) &&
			newItem._scale_price !== undefined &&
			newItem._scale_price !== null
		) {
			const parsedScalePrice = parseFloat(newItem._scale_price);
			if (!Number.isNaN(parsedScalePrice)) {
				effectivePrice = parsedScalePrice;
			}
		}

		if (effectivePrice !== null && !Number.isNaN(effectivePrice)) {
			const parsedPrice = parseFloat(String(effectivePrice));
			if (!Number.isNaN(parsedPrice)) {
				const selectedCurrency = context.selected_currency?.value;
				const companyCurrency = pos_profile.value?.currency;
				const conversionRate =
					Number(context.conversion_rate?.value || 1) || 1;
				const basePrice =
					selectedCurrency &&
					companyCurrency &&
					selectedCurrency !== companyCurrency
						? parsedPrice * conversionRate
						: parsedPrice;

				newItem.rate = parsedPrice;
				newItem.price_list_rate = parsedPrice;
				newItem.base_rate = basePrice;
				newItem.base_price_list_rate = basePrice;
				newItem._manual_rate_set = true;
				newItem.skip_force_update = true;
			}
		}

		if (scanAssignment.serialNo && newItem.has_serial_no) {
			newItem.to_set_serial_no = scanAssignment.serialNo;
		}
		if (scanAssignment.batchNo && newItem.has_batch_no) {
			newItem.to_set_batch_no = scanAssignment.batchNo;
		}
		logScanFlow("Applied scan assignment", {
			item_code: newItem.item_code,
			to_set_serial_no: newItem.to_set_serial_no || null,
			to_set_batch_no: newItem.to_set_batch_no || null,
			qty: newItem.qty,
		});

		const requestedQtyRaw =
			qtyFromBarcode !== null && !isNaN(qtyFromBarcode)
				? qtyFromBarcode
				: (newItem.qty ?? 1);
		const requestedQty = Math.abs(requestedQtyRaw || 1);
		const availableQty =
			typeof newItem.available_qty === "number"
				? newItem.available_qty
				: typeof newItem.actual_qty === "number"
					? newItem.actual_qty
					: null;

		if (
			!isReturnMode() &&
			!shouldDeferStockValidation() &&
			availableQty !== null &&
			availableQty < requestedQty
		) {
			const negativeStockEnabled = isNegativeStockEnabled(newItem);
			const exceedsAvailable = availableQty < requestedQty;
			const shouldBlock =
				(blockSaleBeyondAvailableQty.value && exceedsAvailable) ||
				(!negativeStockEnabled && exceedsAvailable);

			if (shouldBlock) {
				showScanError({
					message: formatStockShortageError(
						newItem.item_name || newItem.item_code || scannedCode,
						availableQty,
						requestedQty,
					),
					code: scannedCode,
					details: __(
						"Adjust the quantity or enable negative stock to continue.",
					),
				});
				return;
			}

			// Suppress low stock notifications when negative stock is allowed
		}

		awaitingScanResult.value = true;

		try {
			// FIXED: Use itemAddition.addItem instead of context.add_item_wrapper
			await itemAddition.addItem(newItem, {
				suppressNegativeWarning: true,
				skipNotification: true,
				// The scanner never raises the LOT PICKER. When the barcode
				// named the unit it is already on the row (`to_set_serial_no` /
				// `to_set_batch_no`); when it named only the ITEM, the add
				// pipeline auto-assigns FEFO exactly as it always has. Either
				// way a modal between two beeps would turn a scan run into a
				// tap run, and nobody asked for that — the picker's door is the
				// catalogue, on the desk and on the phone.
				fromScan: true,
			});
			logScanFlow("Item added from scanner", {
				item_code: newItem.item_code,
				qty: requestedQty,
				batch: newItem.to_set_batch_no || null,
				serial: newItem.to_set_serial_no || null,
			});
			// `último:` on the scan bar (artboard node 21). Recorded HERE —
			// after the line exists — and nowhere else, so the echo can only
			// ever name a code that actually became a cart row. The miss
			// branches below deliberately do not touch it: echoing a failed
			// scan would teach the cashier to trust a wrong signal.
			recordResolvedScan(newItem.item_code);
			if (typeof scannerInput.playScanTone === "function") {
				scannerInput.playScanTone("success");
			}
			if (scannerInput.scannerLocked)
				scannerInput.scannerLocked.value = false;

			if (context.search_from_scanner_ref) {
				context.search_from_scanner_ref.value = false;
			}
			pendingScanCode.value = "";

			// Show success message
			const itemName =
				newItem.item_name ||
				newItem.item_code ||
				scannedCode ||
				__("Item");
			const rawPrecision = Number(float_precision.value);
			const precision = Number.isInteger(rawPrecision)
				? Math.min(Math.max(rawPrecision, 0), 6)
				: 2;
			const displayQty = Number.isInteger(requestedQty)
				? requestedQty
				: Number(requestedQty.toFixed(precision));

			if (eventBus && eventBus.emit) {
				toastStore.show({
					title: __("Item {0} added to invoice", [itemName]),
					summary: __("Items added to invoice"),
					detail: __("{0} (Qty: {1})", [itemName, displayQty]),
					color: "success",
					key: "invoice-item-added",
				});
			} else if (typeof frappe !== "undefined" && frappe.show_alert) {
				frappe.show_alert(
					{
						message: `Added: ${itemName}`,
						indicator: "green",
					},
					3,
				);
			}

			// Clear search after successful addition and refocus input via context callback
			if (context.onItemAdded) context.onItemAdded();
		} finally {
			awaitingScanResult.value = false;
		}
	};

	/**
	 * Find the item a scale label names.
	 *
	 * The printed value changes with every package, so the code on the sticker
	 * is almost never the code registered on the Item. `embeddedLookupCodes`
	 * offers the exact label first (in case it is), then the zero-valued
	 * template a shop actually registers, then the bare short code — and only
	 * then does it cost a round trip.
	 */
	const resolveEmbeddedItem = async (parsedLabel: EmbeddedParsed) => {
		const codes = embeddedLookupCodes(parsedLabel);
		barcodeIndex.ensureBarcodeIndex();

		for (const code of codes) {
			const hit = barcodeIndex.lookupItemByBarcode(code);
			if (hit) return hit;
		}
		const localHit = items.value.find((item: any) =>
			codes.some(
				(code) =>
					item.item_code === code ||
					item.barcode === code ||
					(Array.isArray(item.item_barcode) &&
						item.item_barcode.some((b: any) => b.barcode === code)),
			),
		);
		if (localHit) return localHit;

		for (const code of codes) {
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_items",
					args: {
						pos_profile: pos_profile.value,
						price_list: active_price_list.value,
						search_value: code,
					},
				});
				if (res?.message?.length) return res.message[0];
			} catch (error) {
				console.error("Failed to resolve scale label on server:", error);
			}
		}
		return null;
	};

	/**
	 * A labelling scale's label, from sticker to cart line.
	 *
	 * Everything that can go wrong here is a refusal with a sentence, never a
	 * silent fallback to the ordinary lookup: the prefix already said this is a
	 * label, and a label that resolves to the wrong item or the wrong quantity
	 * is a mis-charge the cashier has no way to notice.
	 */
	const processEmbeddedLabel = async (parsedLabel: EmbeddedParsed, scannedCode: string) => {
		logScanFlow("Scale label parsed", {
			scannedCode,
			scheme: parsedLabel.scheme,
			shortCode: parsedLabel.shortCode,
		});

		const foundItem = await resolveEmbeddedItem(parsedLabel);
		if (!foundItem) {
			if (context.onItemNotFound) context.onItemNotFound(scannedCode);
			showScanError({
				message: `${__("Item not found")}: ${parsedLabel.shortCode}`,
				code: scannedCode,
				details: __(
					"No item carries the code {0} that this scale label names. Register the label on the item, or check the scale's item number.",
					[parsedLabel.shortCode],
				),
			});
			return;
		}

		// A weight label on an item sold by the piece is the scale and the
		// catalogue disagreeing about what this product IS. Adding 0.312 of it
		// would be refused by the server at save anyway; saying so here costs
		// the cashier one sentence instead of a failed Pay.
		const uomFacts = {
			uom: foundItem.uom || foundItem.stock_uom,
			mustBeWholeNumber: foundItem.must_be_whole_number,
			precision: float_precision.value,
		};
		if (!isFractionEligible(uomFacts)) {
			showScanError({
				message: __("{0} is not sold by weight", [
					foundItem.item_name || foundItem.item_code || parsedLabel.shortCode,
				]),
				code: scannedCode,
				details: __(
					"Its unit ({0}) only takes whole numbers, so a scale label cannot set its quantity.",
					[uomFacts.uom || __("unit")],
				),
			});
			return;
		}

		const labelQty = qtyFromEmbeddedLabel({
			parsed: parsedLabel,
			rate: foundItem.rate ?? foundItem.price_list_rate,
			qtyPrecision: qtyPrecisionForUom(uomFacts),
			currencyPrecision: context.currency_precision.value,
		});
		if (!labelQty.ok) {
			showScanError({
				message: __("This scale label cannot be read as a quantity"),
				code: scannedCode,
				details: describeLabelQtyRefusal(labelQty.reason),
			});
			return;
		}

		const provenance =
			parsedLabel.scheme === "weight"
				? __("Scale label · {0}", [scannedCode])
				: __("Scale label · {0} · {1}", [
						scannedCode,
						format_currency(
							labelQty.charged ?? 0,
							pos_profile.value?.currency,
							context.currency_precision.value,
						),
					]);

		const scanAssignment = extractScanAssignmentFromItem(foundItem, scannedCode);
		await addScannedItemToInvoice(foundItem, scannedCode, labelQty.qty, null, scanAssignment, {
			isScaleBarcode: true,
			labelProvenance: provenance,
		});
	};

	const processScannedItem = async (scannedCode: string) => {
		const mark = perfMarkStart("pos:scan-process");
		logScanFlow("Start processing scan", { scannedCode });
		pendingScanCode.value = scannedCode;

		// Labelling-scale labels are settled BEFORE the legacy scale round trip
		// and before the ordinary lookup. A register that declares no scheme
		// gets `not_embedded` on the first line and falls through to exactly
		// the path it had yesterday — including for 20-25 codes, which without
		// a declared scheme are just barcodes.
		const embedded = parseEmbeddedBarcode(
			scannedCode,
			readEmbeddedScheme(pos_profile.value?.posa_gr_embedded_barcode_scheme),
		);
		if (embedded.kind === "invalid") {
			logScanFlow("Scale label refused", { scannedCode, reason: embedded.reason });
			if (context.onItemNotFound) context.onItemNotFound(scannedCode);
			showScanError({
				message: __("Unreadable scale label"),
				code: scannedCode,
				details: describeLabelRefusal(embedded.reason),
			});
			perfMarkEnd("pos:scan-process", mark);
			return;
		}
		if (embedded.kind === "parsed") {
			try {
				await processEmbeddedLabel(embedded, scannedCode);
			} finally {
				perfMarkEnd("pos:scan-process", mark);
			}
			return;
		}

		if (typeof scannerInput.ensureScaleBarcodeSettings === "function") {
			await scannerInput.ensureScaleBarcodeSettings();
		}

		// Handle scale barcodes by extracting the item code and quantity
		let searchCode = scannedCode;
		let qtyFromBarcode: number | null = null;
		let priceFromBarcode: number | null = null;
		let scaleResponse: any = null;
		let scanAssignment: ScanAssignment = emptyScanAssignment();

		try {
			const res = await frappe.call({
				method: "posawesome.posawesome.api.items.parse_scale_barcode",
				args: { barcode: scannedCode },
			});
			if (res && res.message) {
				scaleResponse = res.message;
			}
		} catch (error) {
			console.error("Failed to parse scale barcode via API:", error);
		}

		if (
			scaleResponse &&
			scaleResponse.settings &&
			typeof scannerInput.updateScaleBarcodeSettings === "function"
		) {
			scannerInput.updateScaleBarcodeSettings(scaleResponse.settings);
		}

		const configuredPrefix =
			typeof scannerInput.getScaleBarcodePrefix === "function"
				? scannerInput.getScaleBarcodePrefix()
				: null;

		if (
			scaleResponse &&
			configuredPrefix &&
			!String(scannedCode || "").startsWith(configuredPrefix)
		) {
			scaleResponse = null;
			searchCode = scannedCode;
			qtyFromBarcode = null;
			priceFromBarcode = null;
		}

		if (scaleResponse && scaleResponse.item_code) {
			searchCode = scaleResponse.item_code;
			const parsedQty = parseFloat(scaleResponse.qty);
			if (!Number.isNaN(parsedQty)) {
				qtyFromBarcode = parsedQty;
			}
			const parsedPrice = parseFloat(scaleResponse.price);
			if (!Number.isNaN(parsedPrice)) {
				priceFromBarcode = parsedPrice;
			}
		} else if (
			typeof scannerInput.scaleBarcodeMatches === "function" &&
			scannerInput.scaleBarcodeMatches(scannedCode)
		) {
			if (context.get_search && context.get_item_qty) {
				searchCode = context.get_search(scannedCode);
				qtyFromBarcode = parseFloat(context.get_item_qty(scannedCode));
			}
		}

		// First try to find exact match by processed code using the pre-built index
		const index = barcodeIndex.ensureBarcodeIndex();
		// Use barcodeIndex composable methods if available, else local logic
		let foundItem = barcodeIndex.lookupItemByBarcode(searchCode);

		if (!foundItem && (!index || index.size === 0)) {
			// Index not populated yet, build it and fall back to a direct scan once
			barcodeIndex.replaceBarcodeIndex(items.value);
			foundItem = items.value.find((item) => {
				const barcodeMatch =
					item.barcode === searchCode ||
					(Array.isArray(item.item_barcode) &&
						item.item_barcode.some(
							(b: any) => b.barcode === searchCode,
						)) ||
					(Array.isArray(item.barcodes) &&
						item.barcodes.some(
							(bc: any) => String(bc) === searchCode,
						)) ||
					(Array.isArray(item.serial_no_data) &&
						item.serial_no_data.some(
							(sn: any) =>
								String(sn?.serial_no || "") === searchCode,
						)) ||
					(Array.isArray(item.batch_no_data) &&
						item.batch_no_data.some(
							(bn: any) =>
								String(bn?.batch_no || "") === searchCode,
						));
				return barcodeMatch || item.item_code === searchCode;
			});
		}
		logScanFlow("Parsed scan code", {
			scannedCode,
			searchCode,
			qtyFromBarcode,
			priceFromBarcode,
			scaleParsed: Boolean(scaleResponse && scaleResponse.item_code),
		});
		const isScaleBarcodeScan = Boolean(
			(scaleResponse && scaleResponse.item_code) ||
				qtyFromBarcode !== null ||
				priceFromBarcode !== null,
		);

		if (!foundItem && qtyFromBarcode === null) {
			const searchSerialNo = parseBooleanSetting(
				pos_profile.value?.posa_search_serial_no,
			);
			const searchBatchNo = parseBooleanSetting(
				pos_profile.value?.posa_search_batch_no,
			);

			if (searchSerialNo || searchBatchNo) {
				try {
					const resolveRes = await frappe.call({
						method: "posawesome.posawesome.api.items.search_serial_or_batch_or_barcode_number",
						args: {
							search_value: scannedCode,
							search_serial_no: searchSerialNo ? 1 : 0,
							search_batch_no: searchBatchNo ? 1 : 0,
						},
					});

					const resolved = resolveRes?.message || {};
					if (resolved?.item_code) {
						searchCode = String(resolved.item_code);
						if (resolved?.serial_no) {
							scanAssignment.serialNo = String(resolved.serial_no);
						}
						if (resolved?.batch_no) {
							scanAssignment.batchNo = String(resolved.batch_no);
						}
						foundItem = barcodeIndex.lookupItemByBarcode(searchCode);
					}
				} catch (error) {
					console.error(
						"Failed to resolve serial/batch scan on server:",
						error,
					);
				}
			}
		}

		if (foundItem) {
			const localAssignment = extractScanAssignmentFromItem(
				foundItem,
				scannedCode,
			);
			scanAssignment = {
				serialNo: scanAssignment.serialNo || localAssignment.serialNo,
				batchNo: scanAssignment.batchNo || localAssignment.batchNo,
			};
			logScanFlow("Local item resolved", {
				item_code: foundItem?.item_code,
				scannedCode,
				scanAssignment,
			});
			await addScannedItemToInvoice(
				foundItem,
				scannedCode,
				qtyFromBarcode,
				priceFromBarcode,
				scanAssignment,
				{ isScaleBarcode: isScaleBarcodeScan },
			);
			return;
		}

		// If not found locally, attempt to fetch from server using processed code
		try {
			let newItem: any = null;
			if (qtyFromBarcode !== null) {
				// Scale barcodes use a direct, faster lookup
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_item_detail",
					args: {
						item: JSON.stringify({ item_code: searchCode }),
						warehouse: pos_profile.value.warehouse,
						price_list: active_price_list.value,
						company: pos_profile.value.company,
					},
				});
				if (res && res.message) {
					newItem = res.message;
				}
			} else {
				// Regular barcodes and searches use the generic search
				const res = await frappe.call({
					method: "posawesome.posawesome.api.items.get_items",
					args: {
						pos_profile: pos_profile.value,
						price_list: active_price_list.value,
						search_value: searchCode,
					},
				});

				if (res && res.message && res.message.length > 0) {
					newItem = res.message[0];
				}
			}

			if (newItem) {
				items.value.push(newItem);
				barcodeIndex.indexItem(newItem);

				if (searchCache) {
					searchCache.value.clear();
				}

				const profileScope = `${pos_profile.value?.name || "no_profile"}_${pos_profile.value?.warehouse || "no_warehouse"}`;
				await saveItems(items.value, profileScope);
				await savePriceListItems(
					customer_price_list.value,
					items.value,
				);
				if (eventBus && eventBus.emit)
					eventBus.emit("set_all_items", items.value);

				await itemDetailFetcher.update_items_details([newItem]);
				const localAssignment = extractScanAssignmentFromItem(
					newItem,
					scannedCode,
				);
				scanAssignment = {
					serialNo: scanAssignment.serialNo || localAssignment.serialNo,
					batchNo: scanAssignment.batchNo || localAssignment.batchNo,
				};
				await addScannedItemToInvoice(
					newItem,
					scannedCode,
					qtyFromBarcode,
					priceFromBarcode,
					scanAssignment,
					{ isScaleBarcode: isScaleBarcodeScan },
				);
				return;
			}

			// Report Not Found
			if (context.onItemNotFound) context.onItemNotFound(scannedCode);

			showScanError({
				message: `${__("Item not found")}: ${scannedCode}`,
				code: scannedCode,
				details: __(
					"Please verify the barcode or check the item's availability.",
				),
			});
			return;
		} catch (e: any) {
			console.error("Error fetching item from barcode:", e);
			if (context.onItemNotFound) context.onItemNotFound(scannedCode);

			showScanError({
				message: `${__("Item not found")}: ${scannedCode}`,
				code: scannedCode,
				details: __(
					"The system could not retrieve the item details. Please try again.",
				),
			});
			return;
		} finally {
			perfMarkEnd("pos:scan-process", mark);
		}
	};

	return {
		processScannedItem,
		addScannedItemToInvoice,
		awaitingScanResult,
		showMultipleItemsDialog,
	};
}
