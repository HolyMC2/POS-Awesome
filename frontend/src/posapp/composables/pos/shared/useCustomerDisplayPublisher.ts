/**
 * What the register tells the customer's screen.
 *
 * The transport (`utils/customerDisplay.ts`) is a BroadcastChannel with a
 * localStorage mirror; this is the only thing that fills it. Until 2026-08-23
 * it published a basket and a total, so three of the four states in
 * `docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1 were dark on a screen that had
 * already been built to render them. This module is the widening.
 *
 * ## What crosses the window, and on whose authority
 *
 * `PANTALLA_CLIENTE_GOLDEN_FLOW.md` §1 sanctions the tender line
 * («Recibido $500 · Cambio $152») and the accrual («Acumulaste $15.00 · saldo
 * $433.00», "only for enrolled customers on card-enabled registers — absence,
 * not zeros"). §2's "do not widen it" governs fields the screen does NOT
 * render; every field added here is one §1 names.
 *
 * ## Absence, not zeros — the rule every new field obeys
 *
 * A customer is standing in front of this screen and cannot opt out of what it
 * says about their money. So each field is omitted unless the register holds
 * the fact:
 *
 *  - `received_amount` / `change_amount` only once the pay surface is armed AND
 *    money has actually been keyed. A `Recibido $0.00` card in front of someone
 *    who has not paid is a statement about their money that is not true.
 *  - `change_amount` is published only when it is POSITIVE and complete. During
 *    tender it is computed from the payment rows the cashier keyed; those rows
 *    exclude redeemed customer credit and loyalty (the submit call carries
 *    those separately, `usePaymentSubmission` §908), so a sale that leans on
 *    either produces a smaller figure — and the display stays SILENT rather
 *    than printing a change smaller than the one the cashier is counting out.
 *    At `done` the number is the server-booked change Payment Entry, which is
 *    the only authoritative one.
 *  - `cashback_earned` only for an enrolled customer on a card-enabled
 *    register, and only from a server preview handed in through
 *    `setCustomerDisplayCashbackPreview`. Never derived here — `collection_factor`
 *    is a tier value the client does not have (`useRedemptionLogic`).
 *  - `cashback_balance_after` only when the LOYALTY balance is also on hand.
 *    `walletSummary.ts` is the authority that these are TWO wallets: the
 *    accrual belongs to the loyalty programme, so adding it to a stored-value
 *    balance would promise the customer a number neither ledger will show.
 *  - `stage` only for the states the display's model cannot infer for itself.
 *    It never guesses `done` from an emptied cart: a cart empties on a
 *    completed sale AND on a voided one.
 */

import {
	computed,
	onBeforeUnmount,
	onMounted,
	ref,
	watch,
	type Ref,
} from "vue";
import { useInvoiceStore } from "../../../stores/invoiceStore";
import { useCustomersStore } from "../../../stores/customersStore";
import { useUIStore } from "../../../stores/uiStore";
import { priceCombo } from "../combos/comboPricing";
import {
	COMBO_BROKEN_FIELD,
	COMBO_COMPONENTS_FIELD,
} from "../items/comboLineAttachment";
import {
	buildCustomerDisplayUrl,
	createCustomerDisplayTransport,
	getAutoOpenMarkerKey,
	getOrCreateCustomerDisplayChannelId,
	isCustomerDisplayEnabled,
	shouldAutoOpenCustomerDisplay,
	type CustomerDisplayLineItem,
	type CustomerDisplaySnapshot,
} from "../../../utils/customerDisplay";

declare const frappe: any;
declare const __: (_text: string, _args?: any[]) => string;

interface UseCustomerDisplayPublisherOptions {
	posProfile: Ref<any>;
	eventBus?: any;
}

const CUSTOMER_DISPLAY_WINDOW_NAME = "POSA_CUSTOMER_DISPLAY_WINDOW";
const CUSTOMER_DISPLAY_WINDOW_FEATURES =
	"popup=yes,width=1280,height=820,left=80,top=60,resizable=yes,scrollbars=yes";

/** Half a cent — the two sides of this arithmetic are floats that took different routes. */
const TOLERANCE = 0.005;

/**
 * How long «Gracias» stands before the screen returns to its greeting
 * (§1: "Done → back to Idle"). Long enough for a customer to read a change
 * figure and pocket it; short enough that the next customer in the queue is
 * not greeted by the previous one's thank-you.
 */
const DONE_DWELL_MS = 12000;

/**
 * The cashback preview, handed in from wherever the pay surface computed it.
 *
 * Module-scoped rather than an option because the fact and the publisher live
 * in different components: `useRedemptionLogic.cashback_accrual` is created
 * inside `Payments.vue`, and this composable is mounted by the register shell.
 * A ref here is the smallest seam that does not invent a store or a bus event
 * — one `watch` in the pay surface feeds it (see the report accompanying this
 * change for the exact diff).
 *
 * `null` means NOT AVAILABLE and is the value for every register with customer
 * cards off, every unenrolled customer and every offline sale. A non-positive
 * preview is stored as `null` for the same reason `walletSummary` refuses one:
 * a purchase does not shrink a wallet, so a zero or a negative is a fault
 * upstream and printing it would tell the customer something untrue.
 */
const cashbackPreview = ref<number | null>(null);

export const setCustomerDisplayCashbackPreview = (value: unknown) => {
	const parsed = Number(value);
	cashbackPreview.value =
		Number.isFinite(parsed) && parsed > TOLERANCE ? parsed : null;
};

const toNumber = (value: any) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

const toFiniteOrNull = (value: any) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const toText = (value: any) => {
	if (value === undefined || value === null) return "";
	return String(value).trim();
};

/**
 * The combo facts a cart line carries, or `null` for the ordinary line that
 * every line in the product was until `comboLineAttachment` started marking
 * them.
 *
 * The qualifier is the components' own NAMES — «Funda · Mica · Instalación» —
 * because that is the fact that makes the saving beside it worth reading, and
 * it is customer-facing text by construction. A component with no name is
 * skipped rather than falling back to its `item_code`: the SKU is noise at two
 * metres and `customerDisplayPrivacy.spec.ts` asserts it never reaches this
 * screen's DOM.
 *
 * The saving is `priceCombo`'s, per unit, multiplied by the line's quantity —
 * `priceCombo` prices ONE combo against one combo's worth of components.
 */
const toComboFacts = (item: any, qty: number) => {
	const raw = item?.[COMBO_COMPONENTS_FIELD];
	if (!Array.isArray(raw) || raw.length === 0 || item?.[COMBO_BROKEN_FIELD]) {
		return null;
	}

	const components = raw.map((component: any) => ({
		item_code: toText(component?.item_code),
		item_name: toText(component?.item_name),
		qty: toNumber(component?.qty) || 1,
		rate: toNumber(component?.rate),
	}));

	const note = components
		.map((component) => component.item_name)
		.filter(Boolean)
		.join(" · ");
	const saving = priceCombo(components, toNumber(item?.rate)).saving * qty;

	return {
		note,
		saving: saving > TOLERANCE ? saving : null,
	};
};

const toLineItem = (item: any, index: number): CustomerDisplayLineItem => {
	const qty = toNumber(item?.qty);
	const rate = toNumber(item?.rate);
	const amount = qty * rate;

	const line: CustomerDisplayLineItem = {
		id:
			toText(item?.posa_row_id) ||
			toText(item?.item_code) ||
			`line_${index + 1}`,
		item_code: toText(item?.item_code),
		item_name:
			toText(item?.item_name) ||
			toText(item?.item_code) ||
			__("Item"),
		qty,
		rate,
		amount,
		uom: toText(item?.uom || item?.stock_uom),
	};

	const combo = toComboFacts(item, qty);
	if (combo?.note) {
		line.note = combo.note;
	}
	if (combo?.saving !== null && combo?.saving !== undefined) {
		line.saving = combo.saving;
	}

	return line;
};

const getCustomerName = (
	invoiceDoc: any,
	customerInfo: Record<string, any>,
	selectedCustomer: string | null,
) =>
	toText(invoiceDoc?.customer_name) ||
	toText(customerInfo?.customer_name) ||
	toText(selectedCustomer);

export function useCustomerDisplayPublisher({
	posProfile,
	eventBus,
}: UseCustomerDisplayPublisherOptions) {
	const invoiceStore = useInvoiceStore();
	const customersStore = useCustomersStore();
	const uiStore = useUIStore();

	const channelId = getOrCreateCustomerDisplayChannelId();
	const transport = createCustomerDisplayTransport(channelId);

	const isEnabled = computed(() =>
		isCustomerDisplayEnabled(posProfile.value),
	);
	const shouldAutoOpen = computed(() =>
		shouldAutoOpenCustomerDisplay(posProfile.value),
	);
	const autoOpenMarker = computed(() => getAutoOpenMarkerKey(channelId));

	/**
	 * The pay surface is armed. Two spellings because the register has two
	 * payment modes — a dialog over the cart and a hosted `payment` view — and
	 * the customer's screen owes the same answer under both.
	 */
	const payShowing = computed(
		() =>
			Boolean(uiStore.paymentDialogOpen) || uiStore.activeView === "payment",
	);

	let publishTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The completed sale, frozen.
	 *
	 * `show_change_due` fires from inside the submit routine and the invoice is
	 * cleared moments later (`finishSubmissionNavigation`), so a debounced
	 * publish would arrive at an empty cart and show «Gracias» over nothing.
	 * The snapshot is taken at the instant the register knew the sale closed
	 * and republished from here until the dwell expires.
	 */
	let doneTableau: CustomerDisplaySnapshot | null = null;
	let doneTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The register said the sale is over — a clear that was NOT a completion.
	 * This is what keeps a voided sale from inheriting «Gracias»: a void takes
	 * the same `clear_invoice` route a completed sale does, and the only thing
	 * that separates them is whether a completion was declared first.
	 */
	const explicitIdle = ref(false);

	const clearDoneDwell = () => {
		if (doneTimer) {
			clearTimeout(doneTimer);
			doneTimer = null;
		}
	};

	const releaseDone = () => {
		clearDoneDwell();
		doneTableau = null;
	};

	const invoiceTotal = () => {
		const doc = invoiceStore.invoiceDoc;
		if (!doc) return null;
		return toFiniteOrNull(doc.rounded_total || doc.grand_total);
	};

	/**
	 * Money actually handed over: the payment rows the cashier keyed on the pay
	 * surface. Redeemed customer credit and loyalty are deliberately NOT in it —
	 * they are not money crossing the counter, and the submit call carries them
	 * as separate arguments rather than as rows.
	 */
	const receivedAmount = () => {
		const doc = invoiceStore.invoiceDoc;
		if (!doc || doc.is_return) return null;
		const rows = Array.isArray(doc.payments) ? doc.payments : [];
		const total = rows.reduce(
			(sum: number, row: any) => sum + toNumber(row?.amount),
			0,
		);
		return Number.isFinite(total) ? total : null;
	};

	/**
	 * Pesos the customer's loyalty points are worth — the ledger the accrual
	 * lands on. `null` whenever the register would have to guess: unknown
	 * points, unknown conversion factor, or an invoice in a currency the
	 * profile does not share (converting would need a rate this module has no
	 * business applying to someone's wallet).
	 */
	const loyaltyBalance = () => {
		const info = customersStore.customerInfo || {};
		const points = toFiniteOrNull((info as any).loyalty_points);
		const factor = toFiniteOrNull((info as any).conversion_factor);
		if (points === null || factor === null) return null;

		const docCurrency = toText(invoiceStore.invoiceDoc?.currency);
		const profileCurrency = toText(posProfile.value?.currency);
		if (docCurrency && profileCurrency && docCurrency !== profileCurrency) {
			return null;
		}

		const value = points * factor;
		return Number.isFinite(value) && value >= 0 ? value : null;
	};

	const applyTender = (
		snapshot: CustomerDisplaySnapshot,
		hasLines: boolean,
	) => {
		if (!hasLines || !payShowing.value) return;

		const received = receivedAmount();
		if (received === null || received <= TOLERANCE) return;
		snapshot.received_amount = received;

		const total = invoiceTotal();
		if (total === null) return;
		const change = received - total;
		if (change > TOLERANCE) {
			snapshot.change_amount = change;
		}
	};

	const applyCashback = (
		snapshot: CustomerDisplaySnapshot,
		isReturn: boolean,
	) => {
		if (isReturn) return;

		const earned = cashbackPreview.value;
		if (earned === null || earned <= TOLERANCE) return;
		if (!posProfile.value?.posa_use_customer_cards) return;
		if (!toText((customersStore.customerInfo as any)?.loyalty_program)) return;

		snapshot.cashback_earned = earned;

		const balance = loyaltyBalance();
		if (balance !== null) {
			snapshot.cashback_balance_after = balance + earned;
		}
	};

	/**
	 * The register's own word for where the sale is, or `undefined` when the
	 * display's model already infers it correctly from what is on screen.
	 *
	 * `sale` is deliberately absent: lines on the screen ARE the sale, and
	 * declaring it would give the same state two sources of truth. What the
	 * model cannot see is that the pay surface is up before any money is keyed,
	 * and that a cleared cart was a void rather than a completion.
	 */
	const resolveStage = (hasLines: boolean) => {
		if (explicitIdle.value && !hasLines) return "idle";
		if (hasLines && payShowing.value) return "tender";
		return undefined;
	};

	const buildSaleSnapshot = (): CustomerDisplaySnapshot => {
		const items = (invoiceStore.items || []).map(toLineItem);
		const total_qty = items.reduce((sum, row) => sum + row.qty, 0);
		const item_total = items.reduce((sum, row) => sum + row.amount, 0);
		const additional_discount = toNumber(invoiceStore.additionalDiscount);
		const delivery_charges = toNumber(invoiceStore.deliveryChargesRate);
		const is_return = Boolean(invoiceStore.invoiceDoc?.is_return);
		const gross_total = is_return ? Math.abs(item_total) : item_total;
		const discount_magnitude = Math.abs(additional_discount);
		const subtotal = gross_total - discount_magnitude + delivery_charges;
		const total_amount = toFiniteOrNull(subtotal) ?? item_total;
		const customer_name = getCustomerName(
			invoiceStore.invoiceDoc,
			customersStore.customerInfo,
			customersStore.selectedCustomer,
		);
		const currency =
			toText(posProfile.value?.currency) ||
			toText(invoiceStore.invoiceDoc?.currency);

		const snapshot: CustomerDisplaySnapshot = {
			channel_id: channelId,
			currency,
			customer_name,
			items,
			total_qty,
			total_amount,
			updated_at: new Date().toISOString(),
		};

		const stage = resolveStage(items.length > 0);
		if (stage) {
			snapshot.stage = stage;
		}
		applyTender(snapshot, items.length > 0);
		applyCashback(snapshot, is_return);

		return snapshot;
	};

	const buildSnapshot = (): CustomerDisplaySnapshot =>
		doneTableau || buildSaleSnapshot();

	const publishSnapshot = () => {
		if (!isEnabled.value) {
			return;
		}
		transport.publish(buildSnapshot());
	};

	const schedulePublish = () => {
		if (!isEnabled.value) {
			return;
		}
		if (publishTimer) {
			clearTimeout(publishTimer);
		}
		publishTimer = setTimeout(() => {
			publishTimer = null;
			publishSnapshot();
		}, 80);
	};

	/**
	 * The sale closed. This is the ONLY thing that puts «Gracias» on the
	 * screen, and it is always a submit-success fact — both of its callers are
	 * events `usePaymentSubmission` emits after the server's verdict, so the
	 * figures and the GL always agree. Nothing infers it from an emptied cart.
	 *
	 * `change` is the change the server booked as a Payment Entry, or null when
	 * the sale was settled exactly; the field is omitted rather than published
	 * as a zero.
	 *
	 * Published immediately rather than debounced — the invoice is cleared a
	 * few statements later and the 80 ms would land after it.
	 */
	const declareDone = (change: number | null) => {
		const snapshot = buildSaleSnapshot();
		snapshot.stage = "done";

		const received = receivedAmount();
		if (received !== null && received > TOLERANCE) {
			snapshot.received_amount = received;
		}
		if (change !== null && change > TOLERANCE) {
			snapshot.change_amount = change;
		}

		explicitIdle.value = false;
		doneTableau = snapshot;
		clearDoneDwell();
		doneTimer = setTimeout(() => {
			doneTimer = null;
			doneTableau = null;
			explicitIdle.value = true;
			publishSnapshot();
		}, DONE_DWELL_MS);

		publishSnapshot();
	};

	const handleChangeDue = (payload: any = {}) =>
		declareDone(toFiniteOrNull(payload?.amount));

	/**
	 * The other way a sale closes — and the only way an exactly-paid one does.
	 *
	 * `show_change_due` fires only when there is money to hand back, so a card
	 * sale or a transfer settled to the peso reached the end of the submit
	 * routine with the display still showing the basket, and the screen went
	 * from the sale straight to the greeting without ever saying «Gracias».
	 * `invoice_submitted` is emitted on every successful online submit, so it
	 * covers that case and the toast-fallback register where nothing wires
	 * `onChangeDue` at all.
	 *
	 * Two refusals:
	 *
	 *  - A DONE TABLEAU ALREADY STANDING wins. On a change sale both events
	 *    arrive, `show_change_due` first and carrying the server-booked figure;
	 *    letting this one through would re-arm the dwell and give the customer
	 *    a second, longer thank-you for one sale.
	 *  - A RETURN says nothing. The register's «Gracias» tableau prices the
	 *    basket as a purchase, and the display has no refund state to draw
	 *    instead — the same reason `show_change_due` excludes returns.
	 */
	const handleInvoiceSubmitted = (payload: any = {}) => {
		if (payload?.is_return || doneTableau) return;
		declareDone(toFiniteOrNull(payload?.change_amount));
	};

	/**
	 * The cart was emptied. On the completion path this arrives just after
	 * `show_change_due` and must not disturb the thank-you it is part of;
	 * everywhere else — a void, a parked sale, a return to the floor — it is
	 * the register saying the sale is over, and the screen goes back to its
	 * greeting rather than to the last basket it saw.
	 */
	const handleClearInvoice = () => {
		if (doneTableau) return;
		explicitIdle.value = true;
		schedulePublish();
	};

	const openCustomerDisplay = () => {
		if (!isEnabled.value) {
			frappe?.show_alert?.(
				{
					message: __("Enable Customer Display in POS Profile first."),
					indicator: "orange",
				},
				4,
			);
			return null;
		}

		const url = buildCustomerDisplayUrl(channelId);
		const displayWindow = window.open(
			url,
			CUSTOMER_DISPLAY_WINDOW_NAME,
			CUSTOMER_DISPLAY_WINDOW_FEATURES,
		);
		if (!displayWindow) {
			frappe?.show_alert?.(
				{
					message: __(
						"Customer display was blocked. Please allow pop-ups for this site.",
					),
					indicator: "red",
				},
				6,
			);
			return null;
		}

		try {
			displayWindow.focus?.();
		} catch {
			// Ignore focus errors when browser restricts window interactions.
		}

		schedulePublish();
		return displayWindow;
	};

	const markAutoOpenDone = () => {
		if (typeof window === "undefined" || !window.sessionStorage) return;
		window.sessionStorage.setItem(autoOpenMarker.value, "1");
	};

	const hasAutoOpened = () => {
		if (typeof window === "undefined" || !window.sessionStorage) return false;
		return window.sessionStorage.getItem(autoOpenMarker.value) === "1";
	};

	const tryAutoOpen = () => {
		if (!isEnabled.value || !shouldAutoOpen.value || hasAutoOpened()) {
			return;
		}
		const openedWindow = openCustomerDisplay();
		if (openedWindow) {
			markAutoOpenDone();
		}
	};

	const handleOpenRequest = () => {
		openCustomerDisplay();
	};

	onMounted(() => {
		if (eventBus?.on) {
			eventBus.on("open_customer_display", handleOpenRequest);
			eventBus.on("show_change_due", handleChangeDue);
			eventBus.on("invoice_submitted", handleInvoiceSubmitted);
			eventBus.on("clear_invoice", handleClearInvoice);
		}
		tryAutoOpen();
		schedulePublish();
	});

	onBeforeUnmount(() => {
		if (eventBus?.off) {
			eventBus.off("open_customer_display", handleOpenRequest);
			eventBus.off("show_change_due", handleChangeDue);
			eventBus.off("invoice_submitted", handleInvoiceSubmitted);
			eventBus.off("clear_invoice", handleClearInvoice);
		}
		if (publishTimer) {
			clearTimeout(publishTimer);
			publishTimer = null;
		}
		releaseDone();
		transport.close();
	});

	watch(
		() => invoiceStore.metadata.changeVersion,
		() => {
			// A line in the cart is the next sale beginning. It ends the previous
			// one's thank-you rather than letting a dwell timer decide, and it
			// clears the idle the register declared when the last cart emptied.
			if ((invoiceStore.items || []).length > 0) {
				releaseDone();
				explicitIdle.value = false;
			}
			schedulePublish();
		},
	);

	watch(
		() => [
			invoiceStore.additionalDiscount,
			invoiceStore.additionalDiscountPercentage,
			invoiceStore.deliveryChargesRate,
			invoiceStore.invoiceDoc?.is_return,
		],
		() => {
			schedulePublish();
		},
	);

	watch(
		() => customersStore.selectedCustomer,
		() => {
			schedulePublish();
		},
	);

	// Drop deep:true on these — `customerInfo` and `posProfile`
	// are replaced as a whole on customer / shift change, which
	// the shallow watch already detects. Inner field mutations
	// don't need to re-trigger the customer-display publish.
	watch(
		() => customersStore.customerInfo,
		() => {
			schedulePublish();
		},
	);

	// The pay surface arming is the `tender` transition, and the payment rows
	// the cashier keys live on the invoice doc rather than in the store's
	// changeVersion — so the tender figures need their own trigger.
	watch(payShowing, () => {
		schedulePublish();
	});

	watch(
		() => (invoiceStore.invoiceDoc?.payments || []).map((row: any) => row?.amount),
		() => {
			schedulePublish();
		},
	);

	watch(cashbackPreview, () => {
		schedulePublish();
	});

	watch(
		posProfile,
		() => {
			tryAutoOpen();
			schedulePublish();
		},
		{ immediate: true },
	);

	return {
		channelId,
		openCustomerDisplay,
		publishCustomerDisplaySnapshot: publishSnapshot,
	};
}
