<template>
	<!-- Main Invoice Wrapper -->
	<div class="pa-0 invoice-shell">
		<!-- Cancel Sale Confirmation Dialog -->
		<CancelSaleDialog v-model="cancel_dialog" @confirm="confirmCancelSale" />

		<!-- Main Invoice Card (contains all invoice content).

		     No inline height by design. This card used to be pinned to
		     `var(--container-height)` — a 58–74vh GUESS from useResponsive —
		     with `overflow: auto`, and that is what produced the two live
		     scrollbars: the card scrolled internally because its height was a
		     fraction of the VIEWPORT rather than of what was left in the column,
		     and the shell scrolled because that fraction plus the summary
		     overflowed the column. It now takes the leftover space via flex, and
		     the cart table is the only scrollport. The `resize: vertical` handle
		     went with it: it existed so the operator could drag around the wrong
		     height. -->
		<v-card
			ref="invoiceCard"
			:class="[
				'cards my-0 py-0 mt-3 invoice-main-card',
				'pos-themed-card',
				{ 'return-mode': isReturnInvoice },
			]"
		>
			<!-- Dynamic padding wrapper -->
			<div class="dynamic-padding">
				<v-alert
					type="info"
					density="compact"
					class="invoice-status-alert mb-0"
					v-if="pos_profile.create_pos_invoice_instead_of_sales_invoice"
				>
					{{ __("Invoices saved as POS Invoices") }}
				</v-alert>
				<div class="invoice-sections">
					<!-- Whose ticket this is, whether the last round is safe, and
					     the way back to the room (golden flow §3). Above the
					     customer strip on purpose: on a seated sale the table IS
					     the identity, and the customer row is the fiscal detail
					     underneath it. Renders only while a table order owns the
					     cart, so retail and the counter never see it. -->
					<MesaContextStrip
						v-if="mesaOrderActive"
						band-breakdown-target="[data-band-lane='breakdown']"
					/>

					<!-- The customer as a dense strip, not a card. `Main.dc.html`
					     draws the name, its provenance and a row of inline facts
					     with no chrome and no idle form controls; the controls
					     live in Sale details, one tap away via `change`. -->
					<CustomerStrip
						:customer-name="saleCustomerLabel"
						:balance-label="customerBalanceLabel"
						:price-list="selected_price_list"
						:sale-type="invoiceType"
						:is-return="isReturnInvoice"
						:cfdi-ready="cfdiReady"
						@change="openSaleDetails()"
					/>

					<!-- Config cards (customer, delivery, posting/price list,
					     currency), collapsed BY DEFAULT AT EVERY WIDTH since
					     2026-08-22. They used to render expanded on desktop and
					     cost ~300px above the cart before a single line could
					     appear, on a screen whose whole argument is density.
					     Nothing was removed — the disclosure is the same one
					     phones already had, and every control is one tap in. -->
					<div class="invoice-config-sections">
						<!-- ONE control strip above the cart, not two.

						     `.invoice-items-bar` used to be a second row, below this
						     one and inside the items card. It was built to carry the
						     artboard's count ("6 líneas · 9 piezas"); the count then
						     moved to the summary, where `Main.dc.html` actually draws
						     it, and the strip stayed behind for its last tenant — the
						     cart filter. What that left on a live register with items
						     in the cart was a table-width, half-height band with a
						     lone icon right-aligned into the Actions column, sitting
						     directly above the column header: it reads as a cut-off
						     row rendered above its own header, which is what the owner
						     marked. It only ever rendered with `items.length`, which
						     is why the empty-cart evidence never showed it.

						     This row already spans the panel and its right half is
						     empty, so hosting the toggle here costs no height at all,
						     and the strip's ~28px goes to the cart — the column's one
						     elastic sibling (59c5fe1ad), which is where reclaimed
						     height has to go or it becomes a new gap. -->
						<div class="invoice-items-bar">
							<button
								type="button"
								class="invoice-details-toggle"
								:aria-expanded="saleDetailsOpen ? 'true' : 'false'"
								aria-controls="invoice-sale-details"
								@click="toggleSaleDetails()"
							>
								<v-icon
									:icon="saleDetailsOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
									size="20"
								/>
								<span class="invoice-details-toggle__label">{{ __("Sale details") }}</span>
								<!-- No customer name here. `CustomerStrip` states it directly
								     above, and a disclosure that echoes the line above it is
								     the register saying one fact twice. The comment this
								     replaces claimed the collapsed row "still has to answer
								     who am I selling to" — true before the strip existed,
								     false the moment it landed. -->
							</button>
							<v-btn
								v-if="items.length"
								class="invoice-items-bar__filter"
								:icon="itemsToolbarOpen ? 'mdi-close' : 'mdi-magnify'"
								size="x-small"
								variant="text"
								density="compact"
								data-testid="cart-filter-toggle"
								:aria-label="__('Filter cart lines')"
								:aria-expanded="itemsToolbarOpen ? 'true' : 'false'"
								@click="toggleItemsToolbar()"
							/>
						</div>
						<div
							v-show="saleDetailsOpen"
							id="invoice-sale-details"
							class="invoice-config-sections__body"
						>
							<div class="invoice-top-grid">
								<v-card
									ref="customerCard"
									flat
									class="invoice-section-card pos-themed-card"
									:class="{ 'invoice-section-card--flash': customerFlash }"
								>
									<div class="invoice-section-heading">
										<h3 class="invoice-section-heading__title">
											{{ __("Customer Details") }}
										</h3>
									</div>
									<InvoiceCustomerSection
										ref="customerSection"
										:pos_profile="pos_profile"
										:invoiceTypes="invoiceTypes"
										v-model="invoiceType"
									/>
								</v-card>

								<v-card
									v-if="pos_profile.posa_use_delivery_charges"
									flat
									class="invoice-section-card pos-themed-card"
								>
									<div class="invoice-section-heading">
										<h3 class="invoice-section-heading__title">
											{{ __("Delivery Charges") }}
										</h3>
									</div>
									<DeliveryCharges
										ref="deliveryChargesComponent"
										:pos_profile="pos_profile"
										:delivery_charges="delivery_charges"
										:selected_delivery_charge="selected_delivery_charge"
										:delivery_charges_rate="delivery_charges_rate"
										:deliveryChargesFilter="deliveryChargesFilter"
										:formatCurrency="formatCurrency"
										:currencySymbol="currencySymbol"
										:readonly="readonly"
										@update:selected_delivery_charge="
											(val) => {
												selected_delivery_charge = val;
												update_delivery_charges(conversion_rate, currency_precision);
											}
										"
									/>
								</v-card>
							</div>

							<div class="invoice-meta-grid">
								<v-card
									v-if="pos_profile.posa_allow_change_posting_date"
									flat
									class="invoice-section-card pos-themed-card"
								>
									<div class="invoice-section-heading">
										<h3 class="invoice-section-heading__title">
											{{ __("Posting and Price List") }}
										</h3>
									</div>
									<PostingDateRow
										ref="postingDateComponent"
										:pos_profile="pos_profile"
										:posting_date_display="posting_date_display"
										:customer_balance="customer_balance"
										:price-list="selected_price_list"
										:price-lists="price_lists"
										:formatCurrency="formatCurrency"
										@update:posting_date_display="
											(val) => {
												posting_date_display = val;
											}
										"
										@update:priceList="
											(val) => {
												selected_price_list = val;
											}
										"
									/>
								</v-card>

								<v-card
									v-if="pos_profile.posa_allow_multi_currency"
									flat
									class="invoice-section-card pos-themed-card"
								>
									<div class="invoice-section-heading">
										<h3 class="invoice-section-heading__title">
											{{ __("Multi Currency") }}
										</h3>
									</div>
									<MultiCurrencyRow
										:pos_profile="pos_profile"
										:selected_currency="selected_currency"
										:plc_conversion_rate="exchange_rate"
										:conversion_rate="conversion_rate"
										:available_currencies="available_currencies"
										:isNumber="isNumber"
										:price_list_currency="price_list_currency"
										@update:selected_currency="
											(val) => {
												selected_currency = val;
												update_currency(val);
											}
										"
										@update:plc_conversion_rate="
											(val) => {
												exchange_rate = val;
												update_exchange_rate();
											}
										"
										@update:conversion_rate="
											(val) => {
												conversion_rate = val;
												update_conversion_rate();
											}
										"
									/>
								</v-card>
							</div>
						</div>
					</div>

					<!-- No card, no "Invoice Items" heading. The artboard goes
					     straight from the customer strip to the column header
					     row; a bordered card around the one elastic element in
					     the height chain bought a shadow and cost two lines. -->
					<div class="invoice-items-card">
						<!-- Nothing between this card's top and the table. The count
						     moved to the summary (where `Main.dc.html` draws it) and
						     the filter moved up to the `Sale details` row, so the
						     scrollport starts at the column header, exactly as the
						     artboard goes customer strip → header → rows. -->
						<div class="items-table-wrapper">
							<InvoiceItemsActionToolbar
								v-if="itemsToolbarOpen"
								ref="actionToolbar"
								:itemSearch="itemSearch"
								:availableColumns="available_columns"
								:selectedColumns="selected_columns"
								@update:itemSearch="itemSearch = $event"
								@update:selectedColumns="
									(cols) => {
										selected_columns = cols;
										saveColumnPreferences();
									}
								"
							/>

							<ItemsTable
								ref="itemsTableRef"
								:headers="items_headers"
								v-model:expanded="expanded"
								:itemsPerPage="itemsPerPage"
								:itemSearch="itemSearch"
								:pos_profile="pos_profile"
								:invoiceType="invoiceType"
								:stock_settings="stock_settings"
								:displayCurrency="displayCurrency"
								:formatFloat="formatFloat"
								:formatCurrency="formatCurrency"
								:currencySymbol="currencySymbol"
								:isNumber="isNumber"
								:setFormatedQty="setFormatedQty"
								:setFormatedCurrency="setFormatedCurrency"
								:calcPrices="calc_prices"
								:calcUom="calc_uom"
								:setSerialNo="set_serial_no"
								:setBatchQty="set_batch_qty"
								:validateDueDate="validate_due_date"
								:removeItem="remove_item"
								:subtractOne="subtract_one"
								:addOne="add_one"
								:toggleOffer="toggleOffer"
								:changePriceListRate="change_price_list_rate"
								:isNegative="isNegative"
								@update:expanded="handleExpandedUpdate"
								@reorder-items="handleItemReorder"
								@add-item-from-drag="handleItemDrop"
								@show-drop-feedback="
									(isDragging) => showDropFeedback(isDragging, itemsTableRef)
								"
								@item-dropped="showDropFeedback(false, itemsTableRef)"
								@view-packed="openPackedItems"
							/>

							<PackedItemsDialog
								v-model="show_packed_dialog"
								:items="packed_dialog_items"
								:displayCurrency="displayCurrency"
								:formatFloat="formatFloat"
								:formatCurrency="formatCurrency"
								:currencySymbol="currencySymbol"
							/>
						</div>
					</div>
				</div>
			</div>
		</v-card>

		<!-- Payment Confirmation Dialog -->
		<PaymentConfirmationDialog
			ref="paymentConfirmationDialog"
			v-model="confirm_payment_dialog"
			@confirm="resolvePaymentConfirmation(true)"
			@cancel="resolvePaymentConfirmation(false)"
		/>
		<PriceListRateDialog
			v-model="price_list_rate_dialog_open"
			:initial-rate="price_list_rate_dialog_initial_rate"
			:item-label="price_list_rate_dialog_item_label"
			:currency-symbol="currencySymbol(selected_currency || pos_profile?.currency)"
			@submit="handlePriceListRateDialogSubmit"
			@cancel="handlePriceListRateDialogCancel"
		/>

		<!-- Payment Section -->
		<!-- The band's two lanes, named by attribute rather than by id because
		     `ClosingDialog` mounts an ActionBand of its own; an attribute
		     selector is a lookup, an id would be a uniqueness claim across two
		     surfaces that are only mutually exclusive by convention. The summary
		     teleports its breakdown and its tender into them when the shell band
		     is on screen, and renders both in place when it is not — see
		     `ActionBand.vue`'s lane comment for why the band does not simply
		     take them as a slot. -->
		<InvoiceSummary
			ref="invoiceSummary"
			band-breakdown-target="[data-band-lane='breakdown']"
			band-context-target="[data-band-lane='context']"
			:band-owned-elsewhere="bandOwnedElsewhere"
			:mesa-order-active="mesaOrderActive"
			:pos_profile="pos_profile"
			:total_qty="total_qty"
			:additional_discount="additional_discount"
			:additional_discount_percentage="additional_discount_percentage"
			:total_items_discount_amount="total_items_discount_amount"
			:subtotal="subtotal"
			:displayCurrency="displayCurrency"
			:formatFloat="formatFloat"
			:formatCurrency="formatCurrency"
			:currencySymbol="currencySymbol"
			:discount_percentage_offer_name="discount_percentage_offer_name"
			:isNumber="isNumber"
			:return_discount_meta="return_discount_meta"
			@update:additional_discount="(val) => (additional_discount = val)"
			@update:additional_discount_percentage="(val) => (additional_discount_percentage = val)"
			@update_discount_umount="update_discount_umount"
			@save-and-clear="save_and_clear_invoice"
			@load-drafts="get_draft_invoices"
			@select-order="get_draft_orders"
			@cancel-sale="cancel_dialog = true"
			@open-invoice-management="open_invoice_management"
			@open-returns="open_returns"
			@print-draft="print_draft_invoice"
			@show-payment="handleShowPaymentRequest"
			@open-saldo-picker="$emit('open-saldo-picker')"
			@open-customer-display="handleOpenCustomerDisplayRequest"
			@resume-parked-order="resume_parked_order"
		/>
	</div>
</template>

<script>
import format from "../../format";
import InvoiceCustomerSection from "./invoice/InvoiceCustomerSection.vue";
import CustomerStrip from "./customer/CustomerStrip.vue";
import DeliveryCharges from "./invoice/DeliveryCharges.vue";
import PostingDateRow from "./invoice/PostingDateRow.vue";
import MultiCurrencyRow from "./invoice/MultiCurrencyRow.vue";
import CancelSaleDialog from "./invoice/CancelSaleDialog.vue";
import MesaContextStrip from "./invoice/MesaContextStrip.vue";
import InvoiceSummary from "./invoice/InvoiceSummary.vue";
import ItemsTable from "./invoice/ItemsTable.vue";
import InvoiceItemsActionToolbar from "./invoice/InvoiceItemsActionToolbar.vue";
import PackedItemsDialog from "./invoice/PackedItemsDialog.vue";
import PaymentConfirmationDialog from "./payments/PaymentConfirmationDialog.vue";
import PriceListRateDialog from "./invoice/PriceListRateDialog.vue";
import invoiceItemMethods from "./invoice/invoiceItemMethods";
import invoiceComputed from "./invoice/invoiceComputed";
import invoiceWatchers from "./invoice/invoiceWatchers";
import shortcutMethods from "./invoice/invoiceShortcuts";
import { useInvoiceStore } from "../../stores/invoiceStore.js";
import { useFloorStore } from "../../stores/floorStore";
import { useCustomersStore } from "../../stores/customersStore.js";
import { useToastStore } from "../../stores/toastStore.js";
import { useUIStore } from "../../stores/uiStore.js";
import { storeToRefs } from "pinia";
import stockCoordinator from "../../utils/stockCoordinator";
import { computed, getCurrentInstance, ref } from "vue";
import { save_and_clear_invoice as saveAndClearInvoiceAction } from "./invoice_utils/actions";
import { fetchDraftInvoices } from "../../utils/draftInvoices";

// Composables
import { useOnlineStatus } from "../../composables/core/useOnlineStatus";
import { useResponsive } from "../../composables/core/useResponsive";
import { useInvoiceCurrency } from "../../composables/pos/invoice/useInvoiceCurrency";
import { useInvoiceItems } from "../../composables/pos/invoice/useInvoiceItems";
import { useInvoiceOffers } from "../../composables/pos/invoice/useInvoiceOffers";
import { useInvoiceUI } from "../../composables/pos/invoice/useInvoiceUI";
import { useInvoicePrinting } from "../../composables/pos/invoice/useInvoicePrinting";
import { useInvoiceStock } from "../../composables/pos/invoice/useInvoiceStock";
import { usePaymentPrinting } from "../../composables/pos/payments/usePaymentPrinting";
import {
	createInvoiceShortcutListeners,
	registerInvoiceShortcutListener,
	unregisterInvoiceShortcutListener,
} from "../../utils/invoiceShortcutListener";

export default {
	name: "POSInvoice",
	mixins: [format],
	emits: ["open-saldo-picker"],
	setup() {
		const instance = getCurrentInstance();
		const uiStore = useUIStore();
		const invoiceStore = useInvoiceStore();
		const customersStore = useCustomersStore();
		const toastStore = useToastStore();
		const { isOnline } = useOnlineStatus();
		const floorStore = useFloorStore();

		const { activeView, posProfile: livePosProfile } = storeToRefs(uiStore);
		const {
			selectedCustomer,
			customerInfo: activeCustomerInfo,
			refreshToken: customerRefreshToken,
		} = storeToRefs(customersStore);
		// Same boundary as the ≤768px media query that reorders this panel:
		// below it the config cards collapse into one disclosure BELOW the
		// items table, above it everything stays expanded and in place.
		const { windowWidth } = useResponsive();
		const isCompactInvoice = computed(() => windowWidth.value <= 768);
		const {
			items,
			packedItems: packed_items,
			invoiceDoc: invoice_doc,
			invoiceType,
			flowToLoad,
			flowContext,
		} = storeToRefs(invoiceStore);
		const itemsTableRef = ref(null);
		const currencyState = useInvoiceCurrency({}, {});
		const itemActions = useInvoiceItems(invoiceType);
		const offerLogic = useInvoiceOffers();

		// New composables
		const uiLogic = useInvoiceUI();
		const { loadPrintPage } = usePaymentPrinting({
			invoiceDoc: invoice_doc,
			posProfile: livePosProfile,
			invoiceType,
		});
		const printingLogic = useInvoicePrinting(
			livePosProfile,
			loadPrintPage,
			() => {
				if (!instance?.proxy) {
					return Promise.resolve(null);
				}
				return saveAndClearInvoiceAction(instance.proxy);
			},
			invoice_doc,
		);

		const stockLogic = useInvoiceStock(items, packed_items, uiStore.eventBus, () => {});

		/**
		 * The cart belongs to a table order (golden flow §3). One question, three
		 * consumers: the context strip above the ticket, the identity field's
		 * label, and the «Cancelar venta» copy — all of which must agree, so all
		 * of them read this and not the store directly.
		 */
		const mesaOrderActive = computed(() => Boolean(floorStore.activeOrder));

		/**
		 * Someone else is filling the band's lanes.
		 *
		 * `InvoiceSummary` teleports its subtotal/IVA/discount column and its
		 * tender chips into the band whenever the band is the SALE's. It is not,
		 * on either of this round's two screens: Salón publishes the room's own
		 * figures, and a mesa-owned sale publishes the round's (`Salon.dc.html`,
		 * `SalonCuenta.dc.html`). Leaving the summary teleporting would put two
		 * breakdowns and a set of tender chips in the one lane §17.7 reserves
		 * for a single statement.
		 */
		const bandOwnedElsewhere = computed(
			() =>
				activeView.value === "floor" ||
				mesaOrderActive.value ||
				// A hosted destination (Gasto, Cobranza, Borradores…) owns the
				// stage: the band shows the hostedContext state, and this card's
				// tender chips + breakdown must not keep teleporting sale
				// furniture into it (critique A2, 08-29).
				Boolean(uiStore.hostedDestination),
		);

		return {
			uiStore,
			floorStore,
			mesaOrderActive,
			bandOwnedElsewhere,
			activeView,
			isOnline,
			toastStore,
			invoiceStore,
			customersStore,
			selectedCustomer,
			activeCustomerInfo,
			isCompactInvoice,
			customerRefreshToken,
			invoiceType,
			flowToLoad,
			flowContext,
			itemsTableRef,
			...currencyState,
			...itemActions,
			...offerLogic,
			...uiLogic,
			...printingLogic,
			...stockLogic,
		};
	},
	data() {
		return {
			pos_profile: "",
			pos_opening_shift: "",
			stock_settings: "",
			return_doc: "",
			customer: "",
			customer_info: "",
			customer_balance: 0,
			total_tax: 0,
			packed_dialog_items: [],
			show_packed_dialog: false,
			invoiceTypes: ["Invoice", "Order", "Quotation"],
			itemsPerPage: 1000,
			itemSearch: "",
			expanded: [],
			singleExpand: true,
			cancel_dialog: false,
			saleDetailsOpen: false,
			// The cart filter and the column picker used to occupy a full row
			// permanently. They are useful on a 40-line ticket and noise on a
			// 3-line one, so they arrive on request.
			itemsToolbarOpen: false,
			customerFlash: false,
			_customerFlashTimer: null,
			available_stock_cache: {},
			item_detail_cache: {},
			item_stock_cache: {},
			brand_cache: {},
			stockUnsubscribe: null,
			invoice_posting_date: false,
			posting_date_display: "",
			_shortcutHandlers: {},
			shortcutSubmitInFlight: false,
			shortcutCycle: {
				qty: 0,
				uom: 0,
				rate: 0,
			},
			return_discount_base_total: 0,
			return_discount_base_amount: 0,
			_busHandlers: {},
			price_list_rate_dialog_open: false,
			price_list_rate_dialog_initial_rate: "",
			price_list_rate_dialog_item_label: "",
			price_list_rate_dialog_resolver: null,
		};
	},

	components: {
		InvoiceCustomerSection,
		CustomerStrip,
		DeliveryCharges,
		PostingDateRow,
		MultiCurrencyRow,
		InvoiceSummary,
		MesaContextStrip,
		CancelSaleDialog,
		ItemsTable,
		InvoiceItemsActionToolbar,
		PackedItemsDialog,
		PaymentConfirmationDialog,
		PriceListRateDialog,
	},
	computed: {
		items: {
			get() {
				return this.invoiceStore.items;
			},
			set(value) {
				this.invoiceStore.setItems(value);
			},
		},
		invoice_doc: {
			get() {
				return this.invoiceStore.invoiceDoc;
			},
			set(value) {
				this.invoiceStore.setInvoiceDoc(value);
			},
		},
		packed_items: {
			get() {
				return this.invoiceStore.packedItems;
			},
			set(value) {
				this.invoiceStore.setPackedItems(value);
			},
		},
		paymentVisible() {
			return this.activeView === "payment" || this.uiStore.paymentDialogOpen;
		},
		discount_amount: {
			get() {
				return this.invoiceStore.discountAmount;
			},
			set(val) {
				this.invoiceStore.setDiscountAmount(val);
			},
		},
		additional_discount: {
			get() {
				return this.invoiceStore.additionalDiscount;
			},
			set(val) {
				this.invoiceStore.setAdditionalDiscount(val);
			},
		},
		additional_discount_percentage: {
			get() {
				return this.invoiceStore.additionalDiscountPercentage;
			},
			set(val) {
				this.invoiceStore.setAdditionalDiscountPercentage(val);
			},
		},
		posting_date: {
			get() {
				return this.invoiceStore.postingDate;
			},
			set(val) {
				this.invoiceStore.setPostingDate(val);
			},
		},
		/** Empty string when there is nothing to say — the strip omits the chip. */
		customerBalanceLabel() {
			const balance = Number(this.customer_balance) || 0;
			if (!balance) return "";
			return this.formatCurrency(balance);
		},
		cfdiReady() {
			return Boolean(this.pos_profile?.posa_cfdi_enable_stamping);
		},
		saleCustomerLabel() {
			const info = this.activeCustomerInfo || {};
			return info.customer_name || info.name || this.selectedCustomer || __("No customer");
		},
		return_discount_meta() {
			if (!this.isReturnInvoice || !this.return_doc || this.pos_profile?.posa_use_percentage_discount) {
				return null;
			}

			const originalDiscount = Math.abs(Number(this.return_discount_base_amount || 0));
			if (!originalDiscount) return null;

			const originalTotal = Math.abs(Number(this.return_discount_base_total || 0));
			if (!originalTotal) return null;

			const returnTotal = Math.abs(Number(this.Total || 0));
			if (!returnTotal) return null;

			const ratio = Math.min(1, returnTotal / originalTotal);
			const prorated = originalDiscount * ratio;

			return {
				ratio,
				original_discount: originalDiscount,
				prorated_discount: prorated,
			};
		},
		...invoiceComputed,
	},

	methods: {
		formatDateForDisplay(date) {
			if (!date) return "";
			const parts = date.split("-");
			if (parts.length === 3) {
				return `${parts[2]}-${parts[1]}-${parts[0]}`;
			}
			return date;
		},
		...shortcutMethods,
		...invoiceItemMethods,
		toggleItemsToolbar(open) {
			this.itemsToolbarOpen = typeof open === "boolean" ? open : !this.itemsToolbarOpen;
			// Closing the filter must not leave the cart filtered by a term the
			// operator can no longer see — that reads as "my items vanished".
			if (!this.itemsToolbarOpen) this.itemSearch = "";
		},
		/** The strip's `change` affordance: open Sale details and land on the
		 * customer field, rather than merely revealing a panel and leaving the
		 * operator to find it. */
		openSaleDetails() {
			this.toggleSaleDetails(true);
			this.$nextTick(() => {
				const section = this.$refs.customerSection;
				if (section && typeof section.focusCustomerSearch === "function") {
					section.focusCustomerSearch();
				}
			});
		},
		toggleSaleDetails(open) {
			this.saleDetailsOpen = typeof open === "boolean" ? open : !this.saleDetailsOpen;
		},

		// Entry point for the dock's customer chip (Pos.vue): open the panel
		// on the customer card wherever it currently sits. No autofocus — the
		// soft keyboard opening mid-scroll fights the scroll itself.
		openCustomerDetails() {
			this.toggleSaleDetails(true);
			this.$nextTick(() => {
				const card = this.$refs.customerCard?.$el || this.$refs.customerCard;
				if (card && typeof card.scrollIntoView === "function") {
					card.scrollIntoView({ behavior: "smooth", block: "center" });
				}
				this.flashCustomerCard();
			});
		},

		flashCustomerCard() {
			window.clearTimeout(this._customerFlashTimer);
			this.customerFlash = true;
			this._customerFlashTimer = window.setTimeout(() => {
				this.customerFlash = false;
			}, 1400);
		},

		focusCustomerSearchField() {
			const customerSection = this.$refs.customerSection;
			if (customerSection && typeof customerSection.focusCustomerSearch === "function") {
				customerSection.focusCustomerSearch();
			}
		},

		focusItemSearchField() {
			this.uiStore.triggerItemSearchFocus();
		},

		focusCartItemQty(payload = {}) {
			const rows = Array.isArray(this.items) ? this.items : [];
			if (!rows.length) return;

			const requestedItem = payload?.item || payload;
			const rowId = payload?.rowId || requestedItem?.posa_row_id;
			const itemCode = payload?.itemCode || requestedItem?.item_code;
			let index = -1;

			if (rowId) {
				index = rows.findIndex((row) => row?.posa_row_id === rowId);
			}
			if (index < 0 && itemCode) {
				index = rows.findIndex((row) => row?.item_code === itemCode);
			}
			if (index < 0) {
				index = 0;
			}

			this.$nextTick(() => {
				window.setTimeout(() => {
					const focused = this.$refs.itemsTableRef?.focusItemField?.(index, "qty");
					if (!focused && index !== 0) {
						this.$refs.itemsTableRef?.focusItemField?.(0, "qty");
					}
				}, 0);
			});
		},

		focusAdditionalDiscountField() {
			this.eventBus?.emit?.("focus_additional_discount");
			this.$refs.invoiceSummary?.focusAdditionalDiscountField?.();
		},

		handleStockCoordinatorUpdate(event = {}) {
			const codes = Array.isArray(event.codes) ? event.codes : [];
			if (!codes.length) return;
			this.applyStockStateToInvoiceItems(codes);
		},

		// UI methods from composable are available in scope but might need wrapping if they access 'this' context unavailable in setup
		// showDropFeedback is handled by composable

		openPackedItems(bundle_id) {
			this.packed_dialog_items = this.packed_items.filter((it) => it.bundle_id === bundle_id);
			this.show_packed_dialog = true;
		},

		makeid(length) {
			let result = "";
			const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
			const charactersLength = characters.length;
			for (var i = 0; i < length; i++) {
				result += characters.charAt(Math.floor(Math.random() * charactersLength));
			}
			return result;
		},

		handleExpandedUpdate(ids) {
			this.expanded = Array.isArray(ids) ? ids.slice(-1) : [];
		},

		applyReturnDiscountProration(options = {}) {
			const { defer } = options || {};
			if (defer && typeof this.$nextTick === "function") {
				this.$nextTick(() => {
					setTimeout(() => this.applyReturnDiscountProration(), 0);
				});
				return;
			}

			if (
				!this.isReturnInvoice ||
				this.pos_profile?.posa_use_percentage_discount ||
				!this.return_doc ||
				typeof this.return_doc !== "object"
			) {
				return;
			}

			const originalDiscount = Math.abs(Number(this.return_discount_base_amount || 0));
			const originalTotal = Math.abs(Number(this.return_discount_base_total || 0));
			const returnTotal = Math.abs(Number(this.Total || 0));

			if (!originalDiscount || !originalTotal || !returnTotal) {
				return;
			}

			const ratio = Math.min(1, returnTotal / originalTotal);
			const prorated = -Math.abs(originalDiscount * ratio);

			console.log("[POSA][Returns] Event auto-prorate discount", {
				originalDiscount,
				originalTotal,
				returnTotal,
				ratio,
				prorated,
			});

			this.discount_amount = prorated;
			this.additional_discount = prorated;
			this.additional_discount_percentage = 0;
		},

		async set_delivery_charges(options = {}) {
			const { forceReset = false } = options;
			if (!this.pos_profile || !this.customer || !this.pos_profile.posa_use_delivery_charges) {
				this.delivery_charges = [];
				this.base_delivery_charges_rate = 0;
				this.delivery_charges_rate = 0;
				this.selected_delivery_charge = "";
				return;
			}

			if (forceReset) {
				this.base_delivery_charges_rate = 0;
				this.delivery_charges_rate = 0;
				this.selected_delivery_charge = "";
			}
			try {
				const r = await frappe.call({
					method: "posawesome.posawesome.api.offers.get_applicable_delivery_charges",
					args: {
						company: this.pos_profile.company,
						pos_profile: this.pos_profile.name,
						customer: this.customer,
					},
				});
				if (r.message && r.message.length) {
					this.delivery_charges = r.message;
				}
			} catch (error) {
				console.error("Failed to fetch delivery charges", error);
			}
		},
		deliveryChargesFilter(itemText, queryText, itemRow) {
			const item = itemRow.raw;
			const textOne = item.name.toLowerCase();
			const searchText = queryText.toLowerCase();
			return textOne.indexOf(searchText) > -1;
		},
		updatePostingDate(date) {
			if (!date) return;
			this.posting_date = date;
			this.invoiceStore.setPostingDate(date);
		},

		update_exchange_rate() {
			this.sync_exchange_rate();
		},

		update_conversion_rate() {
			this.sync_exchange_rate();
		},

		async update_exchange_rate_on_server() {
			if (this.conversion_rate) {
				if (!this.items.length) {
					this.sync_exchange_rate();
					return;
				}

				const doc = this.get_invoice_doc();
				doc.conversion_rate = this.conversion_rate;
				doc.plc_conversion_rate = this._getPlcConversionRate();
				try {
					const resp = await this.update_invoice(doc);
					if (resp && resp.exchange_rate_date) {
						this.exchange_rate_date = resp.exchange_rate_date;
						const posting_backend = this.formatDateForBackend(this.posting_date_display);
						if (posting_backend !== this.exchange_rate_date) {
							this.toastStore.show({
								title: __(
									"Exchange rate date " +
										this.exchange_rate_date +
										" differs from posting date " +
										posting_backend,
								),
								color: "warning",
							});
						}
					}
					this.sync_exchange_rate();
				} catch (error) {
					console.error("Error updating exchange rate:", error);
					this.toastStore.show({
						title: "Error updating exchange rate",
						color: "error",
					});
				}
			}
		},

		sync_exchange_rate() {
			if (!this.exchange_rate || this.exchange_rate <= 0) {
				this.exchange_rate = 1;
			}
			if (!this.conversion_rate || this.conversion_rate <= 0) {
				this.conversion_rate = 1;
			}

			this.eventBus.emit("update_currency", {
				currency: this.selected_currency || this.pos_profile.currency || "",
				exchange_rate: this.exchange_rate,
				conversion_rate: this.conversion_rate,
			});

			this.update_item_rates();
			this.update_delivery_charges(this.conversion_rate, this.currency_precision);
		},

		handleRegisterPosProfile(data) {
			this.pos_profile = data.pos_profile;
			this.company = data.company || null;
			this.customer = data.pos_profile.customer;
			this.pos_opening_shift = data.pos_opening_shift;
			this.stock_settings = data.stock_settings;

			this.invoiceType = this.pos_profile.posa_default_sales_order ? "Order" : "Invoice";

			this.fetch_price_lists();
			this.update_price_list();
			this.fetch_available_currencies();
			this.refresh_parked_orders();
		},
		async refresh_parked_orders() {
			if (!this.pos_profile || !this.pos_opening_shift?.name) {
				this.uiStore.setParkedOrders([]);
				return;
			}

			try {
				const drafts = await fetchDraftInvoices({
					posOpeningShift: this.pos_opening_shift,
					posProfile: this.pos_profile,
				});
				this.uiStore.setParkedOrders(drafts);
			} catch (error) {
				console.error("Error refreshing parked orders:", error);
			}
		},
		handleClearInvoice() {
			this.clear_invoice();
			this.uiStore.triggerItemSearchFocus();
		},
		/**
		 * «Cancelar venta» on a mesa-owned sale abandons the CART, never the
		 * cuenta — and that is a behaviour, not only a wording.
		 *
		 * `cancel_invoice` clears the cart. With a table order still attached,
		 * that clear bumps the cart's change version, the floor's line sync sees
		 * an empty cart against a synced baseline, and 800 ms later it pushes
		 * "remove every line" at Mesa 1 — the waiter cancels their own screen and
		 * deletes the table's food with it. Detaching FIRST drops the baseline
		 * and cancels any pending push, which is the same ordering the settle
		 * path and «Guardar · Volver» both take.
		 *
		 * What is lost is whatever the debounce still held; what the server has
		 * already accepted stays on the cuenta, which is what the copy promises.
		 */
		confirmCancelSale() {
			if (this.floorStore?.activeOrder) {
				this.floorStore.setActiveOrder(null);
			}
			return this.cancel_invoice();
		},
		handleLoadInvoice(data) {
			this.load_invoice(data, { preserveStickies: true });
		},
		handleLoadOrder(data) {
			this.new_order(data);
		},
		handleLoadFlow(flow) {
			if (!flow?.prepared_doc) {
				return;
			}

			this.invoiceStore.setFlowContext?.(flow.flow_context || null);
			const action = flow?.action || flow?.flow_context?.prepared_action;
			const targetDoctype = flow?.flow_context?.target_doctype || flow?.prepared_doc?.doctype || "";

			if (targetDoctype === "Quotation" || action === "quote_edit_draft") {
				this.invoiceType = "Quotation";
				this.invoiceTypes = ["Invoice", "Order", "Quotation"];
			} else if (
				targetDoctype === "Sales Order" ||
				action === "order_load" ||
				action === "quote_to_order"
			) {
				this.invoiceType = "Order";
				this.invoiceTypes = ["Invoice", "Order", "Quotation"];
			} else {
				this.invoiceType = "Invoice";
				this.invoiceTypes = ["Invoice", "Order", "Quotation"];
			}

			this.load_invoice(flow.prepared_doc, { preserveStickies: true });
		},

		calcProratedReturnDiscount(returnDoc) {
			if (!returnDoc) return 0;

			const originalDiscount = Math.abs(Number(returnDoc.discount_amount || 0));
			if (!originalDiscount) return 0;

			const originalTotal = Math.abs(
				Number(returnDoc.total ?? returnDoc.net_total ?? returnDoc.grand_total ?? 0),
			);
			if (!originalTotal) return 0;

			const returnTotal = Math.abs(Number(this.Total || 0));
			if (!returnTotal) return 0;

			const ratio = Math.min(1, returnTotal / originalTotal);
			const prorated = originalDiscount * ratio;
			console.log("[POSA][Returns] Prorate discount", {
				originalDiscount,
				originalTotal,
				returnTotal,
				ratio,
				prorated,
			});
			return -Math.abs(prorated);
		},

		handleSetAllItems(data) {
			this.allItems = data;
			this.items.forEach((item) => {
				if (item._detailSynced !== true) {
					this.update_item_detail(item);
				}
			});
			this.primeInvoiceStockState();
		},
		handleLoadReturnInvoice(data) {
			this.load_invoice(data.invoice_doc);
			this.invoiceType = "Return";
			this.invoiceTypes = ["Return"];
			this.invoice_doc.is_return = 1;
			// Cap on cash refundable for this return = amount actually paid on the
			// original invoice. 0 for an unpaid/credit invoice, so the payment screen
			// defaults to no cash refund and the return becomes a credit note that
			// reduces the customer's balance. Derived here so it covers every entry
			// point that loads a return (returns dialog + invoice management).
			{
				const od = data.invoice_doc || {};
				const rd = data.return_doc || {};
				let refundable =
					od.posa_refundable_amount != null
						? od.posa_refundable_amount
						: rd.paid_amount != null
							? rd.paid_amount
							: (rd.grand_total || 0) - (rd.outstanding_amount || 0);
				refundable = this.flt(refundable, this.currency_precision);
				this.invoice_doc.posa_refundable_amount = refundable > 0 ? refundable : 0;
			}
			if (Array.isArray(this.invoice_doc.payments)) {
				this.invoice_doc.payments.forEach((payment) => {
					const amount = this.flt(payment.amount || 0, this.currency_precision);
					payment.amount = amount ? -Math.abs(amount) : 0;
					if (payment.base_amount !== undefined) {
						const baseAmount = this.flt(payment.base_amount || 0, this.currency_precision);
						payment.base_amount = baseAmount ? -Math.abs(baseAmount) : 0;
					}
				});
			}
			if (this.items && this.items.length) {
				this.items.forEach((item) => {
					if (item.qty > 0) item.qty = -Math.abs(item.qty);
					if (item.stock_qty > 0) item.stock_qty = -Math.abs(item.stock_qty);
				});
			}
			if (data.return_doc) {
				this.return_doc = data.return_doc;
				this.invoice_doc.return_against = data.return_doc.name;
				this.return_discount_base_amount = Math.abs(Number(data.return_doc.discount_amount || 0));
				this.return_discount_base_total = Math.abs(
					Number(
						data.return_doc.total ??
							data.return_doc.net_total ??
							data.return_doc.grand_total ??
							0,
					),
				);
				console.log("[POSA][Returns] Loaded return doc", {
					return_against: data.return_doc.name,
					is_percentage: !!this.pos_profile?.posa_use_percentage_discount,
					discount_amount: data.return_doc.discount_amount,
					discount_percentage: data.return_doc.additional_discount_percentage,
					original_total:
						data.return_doc.total ?? data.return_doc.net_total ?? data.return_doc.grand_total,
					base_total: this.return_discount_base_total,
					base_discount: this.return_discount_base_amount,
				});

				if (this.pos_profile?.posa_use_percentage_discount) {
					if (data.return_doc.additional_discount_percentage !== undefined) {
						this.additional_discount_percentage = this.flt(
							data.return_doc.additional_discount_percentage || 0,
							this.float_precision,
						);
					}
					this.update_discount_umount();
				} else {
					const prorated = this.calcProratedReturnDiscount(data.return_doc);
					this.discount_amount = prorated;
					this.additional_discount = prorated;
					this.additional_discount_percentage = 0;
				}
			} else {
				this.discount_amount = 0;
				this.additional_discount = 0;
				this.additional_discount_percentage = 0;
			}
		},
		handleSetNewLine(data) {
			this.new_line = data;
		},
		handleShowPaymentRequest() {
			this.show_payment();
		},
		async resume_parked_order(draft) {
			try {
				const message = await this.load_draft_source_record(draft);
				if (message) {
					this.uiStore?.closeDrafts?.();
				}
			} catch (error) {
				console.error("Error loading parked order:", error);
				this.toastStore.show({
					title: __("Unable to load parked order"),
					color: "error",
				});
			}
		},
		handleOpenCustomerDisplayRequest() {
			if (this.eventBus && typeof this.eventBus.emit === "function") {
				this.eventBus.emit("open_customer_display");
			}
		},
		promptPriceListRate(initialRate, item) {
			if (typeof this.price_list_rate_dialog_resolver === "function") {
				this.price_list_rate_dialog_resolver(null);
			}

			this.price_list_rate_dialog_initial_rate = initialRate == null ? "" : String(initialRate);
			this.price_list_rate_dialog_item_label = String(item?.item_name || item?.item_code || "");
			this.price_list_rate_dialog_open = true;

			return new Promise((resolve) => {
				this.price_list_rate_dialog_resolver = resolve;
			});
		},
		handlePriceListRateDialogCancel() {
			if (typeof this.price_list_rate_dialog_resolver === "function") {
				this.price_list_rate_dialog_resolver(null);
			}
			this.price_list_rate_dialog_open = false;
			this.price_list_rate_dialog_initial_rate = "";
			this.price_list_rate_dialog_item_label = "";
			this.price_list_rate_dialog_resolver = null;
		},
		handlePriceListRateDialogSubmit(value) {
			if (typeof this.price_list_rate_dialog_resolver === "function") {
				this.price_list_rate_dialog_resolver(value);
			}
			this.price_list_rate_dialog_open = false;
			this.price_list_rate_dialog_initial_rate = "";
			this.price_list_rate_dialog_item_label = "";
			this.price_list_rate_dialog_resolver = null;
		},
	},

	mounted() {
		this.setUpdateItemDetail(this.update_item_detail);
		this.loadColumnPreferences();
		this.loadInvoiceHeight();

		// Watch the IDENTITY of `posProfile` + `offers` (the
		// reference itself), not their deep contents. The previous
		// `deep: true` configuration walked the entire 100-key
		// profile object + offers array on every reactive tick —
		// which on a busy POS with a foreign price-list +
		// pricing rules + stock updates fired thousands of times,
		// dominating the click-input freeze (27 s INP on the search
		// box). Internal field mutations inside `posProfile` /
		// `offers` are state we already own; the handler only needs
		// to re-fire when the WHOLE object is replaced (i.e.
		// `setPosProfile(newProfile)` / `setOffers(newOffers)`).
		this.$watch(
			() => this.uiStore.posProfile,
			(profile) => {
				if (profile && profile.name) {
					this.handleRegisterPosProfile({
						pos_profile: profile,
						stock_settings: this.uiStore.stockSettings,
						company: this.uiStore.companyDoc,
						pos_opening_shift: this.uiStore.posOpeningShift,
					});
				}
			},
			{ immediate: true },
		);

		this.$watch(
			() => this.uiStore.offers,
			(offers) => {
				if (offers) {
					this.handleSetOffers(offers);
				}
			},
			{ immediate: true },
		);

		this.$watch(
			() => this.invoiceStore.invoiceToLoad,
			(doc) => {
				if (doc) {
					this.handleLoadInvoice(doc);
				}
			},
			{ deep: false },
		);

		this.$watch(
			() => this.invoiceStore.orderToLoad,
			(doc) => {
				if (doc) {
					this.handleLoadOrder(doc);
				}
			},
			{ deep: false },
		);

		this.$watch(
			() => this.invoiceStore.flowToLoad,
			(flow) => {
				if (flow?.prepared_doc) {
					this.handleLoadFlow(flow);
				} else if (flow) {
					this.handleLoadFlow({
						action: this.invoiceStore.flowContext?.prepared_action,
						prepared_doc: flow,
						flow_context: this.invoiceStore.flowContext,
					});
				}
			},
			{ deep: false },
		);

		this.$watch(
			() => this.uiStore.draggedItem,
			(item) => {
				this.showDropFeedback(!!item, this.itemsTableRef);
			},
		);

		this.$watch(
			() => this.invoiceStore.postingDate,
			(val) => {
				if (val) this.posting_date = val;
			},
			{ immediate: true },
		);

		this._busHandlers = {
			add_item: this.add_item,
			clear_invoice: this.handleClearInvoice,
			// Shell → panel requests (replace the old invoicePanel ref
			// reach-ins — VERTICAL_PROFILES_PLAN.md C1):
			open_customer_details: () => this.openCustomerDetails(),
			request_invoice_payment: () => this.handleShowPaymentRequest(),
			recalc_additional_discount: () => this.update_discount_umount(),
			apply_pricing_rules: () => {
				if (typeof this.schedulePricingRuleApplication === "function") {
					this.schedulePricingRuleApplication();
				}
			},
			update_invoice_offers: this.handleUpdateInvoiceOffers,
			update_invoice_coupons: this.handleUpdateInvoiceCoupons,
			set_all_items: this.handleSetAllItems,
			load_return_invoice: this.handleLoadReturnInvoice,
			focus_cart_item_qty: this.focusCartItemQty,
			set_new_line: this.handleSetNewLine,
			recalculate_return_discount: (payload) => this.applyReturnDiscountProration(payload),
			reset_invoice_type_to_invoice: () => {
				this.invoiceType = "Invoice";
				this.invoiceTypes = ["Invoice", "Order", "Quotation"];
			},
			// Phase 1.H: silently refresh the drafts panel after Save & Clear so
			// the count badge + in-place preview update without the operator
			// having to click "Manage all". Keeps the lazy "Manage all" path
			// intact for flaky-network manual refresh.
			draft_saved: () => {
				if (typeof this.get_draft_invoices === "function") {
					const source = this.uiStore?.draftSource || "invoice";
					this.get_draft_invoices(source, { quiet: true });
				}
			},
		};

		Object.entries(this._busHandlers).forEach(([eventName, handler]) => {
			this.eventBus.on(eventName, handler);
		});

		this.stockUnsubscribe = stockCoordinator.subscribe(this.handleStockCoordinatorUpdate);

		this.emitCartQuantities();
		this.$nextTick(() => {
			this.primeInvoiceStockState();
		});
	},
	beforeUnmount() {
		window.clearTimeout(this._customerFlashTimer);

		if (typeof this.price_list_rate_dialog_resolver === "function") {
			this.price_list_rate_dialog_resolver(null);
			this.price_list_rate_dialog_resolver = null;
		}

		if (typeof this.stockUnsubscribe === "function") {
			this.stockUnsubscribe();
			this.stockUnsubscribe = null;
		}

		Object.entries(this._busHandlers || {}).forEach(([eventName, handler]) => {
			this.eventBus.off(eventName, handler);
		});
		this._busHandlers = {};
		if (typeof this.cancelScheduledOfferRefresh === "function") {
			this.cancelScheduledOfferRefresh();
		}
		if (this._suppressClosePaymentsTimer) {
			clearTimeout(this._suppressClosePaymentsTimer);
			this._suppressClosePaymentsTimer = null;
		}
	},
	created() {
		this.invoiceStore.clear();
		this.$watch(
			() => this.selectedCustomer,
			(newCustomer) => {
				if (newCustomer) {
					if (this.customer !== newCustomer) {
						this.customer = newCustomer;
					}
				} else if (this.customer) {
					this.customer = "";
				}
			},
			{ immediate: true },
		);
		this.$watch(
			() => this.customerRefreshToken,
			() => {
				if (this.customer) {
					this.fetch_customer_details();
				}
			},
		);
		this._shortcutHandlers = this._shortcutHandlers || {};

		this._shortcutHandlers.handleInvoiceShortcut = createInvoiceShortcutListeners(
			this.handleInvoiceShortcut.bind(this),
		);
		registerInvoiceShortcutListener(document, this._shortcutHandlers.handleInvoiceShortcut);
	},
	unmounted() {
		if (!this._shortcutHandlers) {
			return;
		}

		unregisterInvoiceShortcutListener(document, this._shortcutHandlers.handleInvoiceShortcut);

		this._shortcutHandlers = {};
	},
	watch: {
		...invoiceWatchers,
		confirm_payment_dialog(val) {
			if (val) {
				this.$nextTick(() => {
					setTimeout(() => {
						this.$refs.paymentConfirmationDialog?.focus?.();
					}, 100);
				});
			}
		},
		// ── CartView contract: publish derived totals to invoiceStore ──
		// The shell reads these from the store; it must never reach into
		// this component instance (VERTICAL_PROFILES_PLAN.md C1).
		subtotal: {
			immediate: true,
			handler(value) {
				this.invoiceStore.publishDerivedTotals({ subtotal: value });
			},
		},
		// No `deep`: the computed returns a fresh object per evaluation,
		// so identity changes are the only signal deep could ever see;
		// the store's content check absorbs the spurious re-fires.
		return_discount_meta: {
			immediate: true,
			handler(value) {
				this.invoiceStore.publishDerivedTotals({ returnDiscountMeta: value });
			},
		},
		discount_percentage_offer_name: {
			immediate: true,
			handler(value) {
				this.invoiceStore.publishDerivedTotals({
					discountPercentageOfferName: value || null,
				});
			},
		},
	},
};
</script>

<style scoped>
/* Card background adjustments */
.cards {
	background-color: var(--pos-surface-muted) !important;
}

/* THE height chain (desktop). Exactly one element below this scrolls: the
 * cart table wrapper. Every ancestor is `flex: 1 1 auto; min-height: 0` so the
 * cart gets what is LEFT in the column, and the summary/action grid is
 * `flex: 0 0 auto` so it is pinned and can never scroll out of reach.
 * `min-height: 0` is the load-bearing half — flex items default to
 * `min-height: auto` and refuse to shrink below their content, which is how a
 * "just add overflow" fix ends up nesting a second scrollport instead. */
.invoice-shell {
	display: flex;
	flex-direction: column;
	gap: var(--dynamic-sm);
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
}

/* No dock reservation here. The shell root is `class="pa-0 invoice-shell"`,
 * and Vuetify's `.pa-0 { padding: 0px !important }` beat the
 * `padding-bottom: calc(var(--bottom-safe-space) + …)` this block used to
 * carry — measured computed padding-bottom was 0px at both 630 px and 900 px,
 * so the rule never reserved anything. The live reservation is Pos.vue's
 * `.dynamic-container` padding-bottom, which sits below this whole column and
 * is inside whichever element scrolls; re-adding one here (with !important)
 * would stack a second ~135 px gap under the action grid.
 * Pinned by tests/cartActionBarLayout.spec.ts. */

.invoice-main-card {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	min-width: 0;
}

/* Style for customer balance field */
:deep(.balance-field) {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: nowrap;
}

/* Style for balance value text */
:deep(.balance-value) {
	font-size: 1.5rem;
	font-weight: bold;
	color: var(--primary-start);
	margin-left: var(--dynamic-xs);
}

/* Red border and label for return mode card */

/* Red border and label for return mode card */

.return-mode {
	border: 2px solid rgb(var(--v-theme-error)) !important;
	position: relative;
}

/* Label for return mode card */
.return-mode::before {
	content: "RETURN";
	position: absolute;
	top: 0;
	right: 0;
	background-color: rgb(var(--v-theme-error));
	color: white;
	padding: 4px 12px;
	font-weight: bold;
	border-bottom-left-radius: 8px;
	z-index: 1;
}

/* Dynamic padding for responsive layout */
.dynamic-padding {
	/* Uniform spacing for better alignment */
	padding: var(--dynamic-sm);
	display: flex;
	flex-direction: column;
	gap: var(--dynamic-sm);
	flex: 1 1 auto;
	min-height: 0;
	overflow: visible;
}

.invoice-status-alert {
	border-radius: 14px;
	flex: 0 0 auto;
}

.invoice-sections {
	display: flex;
	flex-direction: column;
	gap: var(--dynamic-sm);
	flex: 1 1 auto;
	min-height: 0;
	overflow: visible;
	align-items: stretch;
}

/* Wrapper around the config grids. Reproduces the gap they used to get as
 * direct children of .invoice-sections, so desktop spacing is unchanged. */
.invoice-config-sections,
.invoice-config-sections__body {
	display: flex;
	flex-direction: column;
	gap: var(--dynamic-sm);
	flex: 0 0 auto;
	min-width: 0;
}

/* Slimmed 2026-08-22. This used to appear only below 768px, where a 44px
 * card-styled row was proportionate. It is now the permanent way into the sale
 * config at every width, so it pays for itself in height: no card border, no
 * shadow, no 18px radius, and 30px instead of 44. The 44px touch minimum is met
 * by the hit area rather than by the visual — the row spans the full panel
 * width, which is a far larger target than the bordered card ever was. */
.invoice-details-toggle {
	display: flex;
	align-items: center;
	gap: 6px;
	/* Was `width: 100%`. It now shares a flex row with the cart filter, so it
	   takes the free width instead of claiming all of it; the hit area is
	   still the whole row minus one icon, which is what met the 44px touch
	   minimum by area rather than by height. */
	flex: 1 1 auto;
	min-width: 0;
	min-height: 30px;
	padding: 4px 2px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: var(--pos-text-muted, #667085);
	font: inherit;
	font-size: 0.78rem;
	font-weight: 600;
	text-align: start;
	cursor: pointer;
}

.invoice-details-toggle:hover,
.invoice-details-toggle:focus-visible {
	color: var(--pos-text-primary);
}

.invoice-details-toggle__label {
	flex: 1 1 auto;
	min-width: 0;
	text-align: start;
}



.invoice-top-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--dynamic-sm);
	flex: 0 0 auto;
}

.invoice-meta-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--dynamic-sm);
	flex: 0 0 auto;
}

.invoice-section-card {
	background: var(--pos-card-bg) !important;
	border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
	border-radius: var(--pos-radius-md, 18px);
	box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
	overflow: hidden;
	flex: 0 0 auto;
	min-height: fit-content;
}

/* Jump target feedback for the dock's customer chip — without it the
 * scroll lands silently and the cashier has to hunt for what moved. */
.invoice-section-card--flash {
	animation: invoice-section-flash 1.4s ease-out;
}

@keyframes invoice-section-flash {
	0%,
	60% {
		box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.55);
	}
	100% {
		box-shadow: 0 10px 30px rgba(var(--v-theme-on-surface), 0.05);
	}
}

@media (prefers-reduced-motion: reduce) {
	.invoice-section-card--flash {
		animation: none;
		box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.55);
	}
}

.invoice-section-heading {
	padding: 14px 16px 0;
}

.invoice-section-heading__title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
	line-height: 1.25;
	color: var(--pos-text-primary);
}

/* The cart list is the elastic one: it absorbs whatever the config sections
 * above and the summary below do not use. `min-height: 0` (not 320px) so it can
 * shrink on a short viewport instead of pushing the totals off-screen. */
/* Still the single elastic sibling in the height chain — `flex: 1 1 auto;
 * min-height: 0` is unchanged and load-bearing (see 59c5fe1ad). What went is
 * the CHROME: the card background, border, 18px radius and shadow it inherited
 * from `.invoice-section-card`. The height that bought is the height the cart
 * now gets, which is the whole point of the change. */
.invoice-items-card {
	padding-bottom: var(--dynamic-xs);
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	background: none;
	border: 0;
	box-shadow: none;
}

/* THE control strip above the cart — one row, not two. It carries the
 * `Sale details` disclosure and, at its far end, the cart filter. It used to
 * be a strip of its own below this one, holding nothing but that filter, which
 * on a cart with lines rendered as a half-height row above the table's own
 * header. `flex: 0 0 auto` because it is chrome above the one thing that
 * scrolls; its height is the disclosure's, so the filter is free. */
.invoice-items-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 0 0 auto;
	min-height: 30px;
	padding: 0 2px;
	font-size: 0.74rem;
	font-weight: 600;
	color: var(--pos-text-muted, #667085);
}

/* Still the table's right edge, where the Actions column is — the toggle just
   reaches it from a row that was already on screen. */
.invoice-items-bar__filter {
	margin-left: auto;
}

/* Responsive breakpoints */
@media (max-width: 768px) {
	/* Mobile deliberately opts OUT of the desktop height chain: DefaultLayout
	 * hands the document back its own scroll below this width, the compact
	 * switcher shows one panel at a time, and the fixed dock carries the
	 * actions. So everything here goes back to natural height — a lone
	 * scrollport inside a page that also scrolls is the phone version of the
	 * same bug. */
	.invoice-shell {
		gap: var(--dynamic-xs);
		flex: 0 0 auto;
		overflow: visible;
	}

	.invoice-main-card {
		height: auto !important;
		max-height: none !important;
		flex: 0 0 auto;
		overflow: visible !important;
	}

	.dynamic-padding {
		/* Smaller uniform padding on tablets */
		padding: var(--dynamic-xs);
		overflow: visible;
	}

	.dynamic-padding .v-row {
		margin: 0 -2px;
	}

	.dynamic-padding .v-col {
		padding: 2px 4px;
	}

	.invoice-meta-grid {
		grid-template-columns: 1fr;
	}

	.invoice-top-grid {
		grid-template-columns: 1fr;
	}

	.invoice-sections {
		overflow: visible;
	}

	.invoice-items-card {
		flex: 0 0 auto;
		min-height: 320px;
		/* Cart opens on the goods, not on four config cards. Totals + PAY
		 * (InvoiceSummary) already sit below this card, so the only thing
		 * between items and the pay button is the collapsed disclosure. */
		order: -1;
	}

	/* Ahead of the cart, because the items card claims `order: -1` and the
	   strip would otherwise read BELOW the goods it identifies the buyer of.
	   It costs two lines, so it does not push the cart down meaningfully. */
	.customer-strip {
		order: -2;
	}

	.items-table-wrapper {
		/* Adjust for smaller padding on tablets */
		margin-left: 0;
		margin-right: 0;
		width: 100%;
		max-width: 100%;
		flex: 0 0 auto;
		min-height: 280px;
		/* Give the scroll back to the page here — see the note above. */
		overflow: visible;
	}
}

@media (max-width: 480px) {
	.invoice-main-card {
		margin-top: var(--dynamic-xs) !important;
	}

	.dynamic-padding {
		padding: var(--dynamic-xs);
	}

	.dynamic-padding .v-row {
		margin: 0 -1px;
	}

	.dynamic-padding .v-col {
		padding: 1px 2px;
	}

	.invoice-meta-grid {
		grid-template-columns: 1fr;
	}

	.invoice-top-grid {
		grid-template-columns: 1fr;
	}

	.items-table-wrapper {
		/* Adjust for smallest screens */
		margin-left: 0;
		margin-right: 0;
		width: 100%;
		max-width: 100%;
		min-height: 240px;
	}

	/* Card mode (phone) has no columns to configure — the dialog's
	   switches were silently discarded by the <450px column filter
	   anyway, and the button cost the search field its full row.
	   :deep because the button renders inside InvoiceItemsActionToolbar
	   (not on its root), so the scoped attribute never reaches it. */
	:deep(.column-selector-btn) {
		display: none;
	}
}

.column-selector-container {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 8px;
	padding: 8px 16px;
	background-color: var(--pos-card-bg);
	border-radius: 8px 8px 0 0;
	box-sizing: border-box;
	margin-bottom: 8px;
}

/* THE scrollport for the cart — the only one in this column. Its children keep
 * `height: auto` so they grow naturally and this wrapper does the scrolling;
 * the sticky column-selector below now sticks to THIS box, which is what makes
 * the header hold while the rows move. */
.items-table-wrapper {
	position: relative;
	/* No top inset. It was `var(--dynamic-sm)` — clearance under an "Invoice
	   Items" card heading this panel stopped rendering — then 2px of clearance
	   under a count strip that has also gone. Nothing sits above the scrollport
	   now, so an inset here is a gap between the customer strip and the first
	   thing a cashier scanned. */
	margin-top: 0;
	width: 100%;
	max-width: 100%;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	min-width: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;
	scrollbar-width: thin;
}

:deep(.items-table-wrapper .column-selector-container) {
	position: sticky;
	top: 0;
	z-index: 3;
	background: var(--pos-card-bg);
}

/* The cart's card is the artboard's: a hairline and a 1px shadow.
 * `items-table-styles.css` gives `.posa-cart-table` `box-shadow: 0 12px 24px`,
 * which at that blur paints a haze band ABOVE its own top border — a soft strip
 * the width of the table sitting over the column header, which is the other
 * half of what reads as a clipped row up there. That stylesheet is shared and
 * not this panel's to edit, so the correction is scoped to the cart's
 * scrollport and no other surface using it changes. */
:deep(.items-table-wrapper .posa-cart-table) {
	box-shadow: 0 1px 2px var(--pos-shadow-light);
}

/* Natural height on purpose: the wrapper above scrolls, this grows. The old
 * `min-height: 320px` forced a scroll even on a two-line cart. */
:deep(.items-table-wrapper .posa-items-table-container) {
	flex: 0 0 auto;
	min-height: 0;
	height: auto !important;
	max-height: none !important;
	overflow: visible !important;
}

:deep(.items-table-wrapper .posa-cart-table),
:deep(.items-table-wrapper .v-data-table__wrapper),
:deep(.items-table-wrapper .v-table__wrapper) {
	height: auto !important;
	max-height: none !important;
}

/* New styles for improved column switches */
:deep(.column-switch) {
	margin: 0;
	padding: 0;
}

:deep(.column-switch .v-switch__track) {
	opacity: 0.7;
}

:deep(.column-switch .v-switch__thumb) {
	transform: scale(0.8);
}

:deep(.column-switch .v-label) {
	opacity: 0.9;
	font-size: 0.95rem;
}
</style>
