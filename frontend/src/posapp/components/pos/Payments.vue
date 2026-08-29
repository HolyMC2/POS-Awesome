<!-- eslint-disable vue/multi-word-component-names -->
<template>
	<div
		ref="paymentRoot"
		data-pos-keyboard-root="payment"
		:class="[
			'payment-shell',
			dialogMode ? 'payment-shell--dialog' : 'payment-shell--anchored',
			{ 'payment-shell--cobro': cobroMode },
		]"
		:style="anchoredShellStyle"
		data-perf-tag="payment"
	>
		<v-card
			:class="[
				'selection mx-auto my-0 pos-themed-card payment-card',
				dialogMode ? 'payment-card--dialog' : 'mt-3',
				{ 'payment-card--cobro': cobroMode },
			]"
		>
			<v-progress-linear
				:active="loading"
				:indeterminate="loading"
				absolute
				location="top"
				color="info"
			></v-progress-linear>
			<!--
				NOTHING INSIDE COBRO SCROLLS, and the surface does not either.
				The previous round gave every column its own scrollport, which
				answered "the screen is too tall" with four scrollbars and was
				rejected for it ("why so many scrolls?", owner 2026-08-23). What
				keeps the panel on one screen now is that every region is sized
				to its content and ONE region — the pad — absorbs the slack; the
				sale-lines list is the single exception, because a fifty-line
				ticket has to give somewhere.

				`More options` is the one state that cannot fit: it unfolds three
				legacy form sections under the panel, so THEN the surface scrolls
				as one. The band lives in the shell, outside this box, so it
				never scrolls away from the action it carries.

				Every other layout keeps the single scrolling list it has always
				had.
			-->
			<div
				ref="paymentContainer"
				:class="[
					'payment-scroll',
					cobroMode ? 'payment-scroll--cobro' : 'overflow-y-auto',
					{ 'payment-scroll--flow': cobroMode && cobroDetailsExpanded },
				]"
			>
				<!--
					COBRO. The three columns are a GRID over these same
					sections, not a second markup tree: `payment-sections--cobro`
					assigns each one an area, and the sections the artboard adds
					render below behind `v-if="cobroMode"`. Duplicating the
					list to lay it out differently would have meant maintaining
					every binding on this screen twice, which is how two payment
					screens start to disagree.
				-->
				<div
					:class="[
						'payment-sections',
						{
							'payment-sections--dialog': dialogMode,
							'payment-sections--cobro': cobroMode,
							'payment-sections--cobro-lean': cobroMode && !cobroDetailsExpanded,
						},
					]"
				>
					<!-- The way back to the cart, and the three devices that can
					     fail while the customer is standing there. The header
					     draws a chip only where the register has evidence, so a
					     shop with no drawer integration and no terminal probe
					     sees the back affordance and nothing else. -->
					<PaymentReadinessHeader
						class="payment-readiness"
						:hardware="hardwareReadiness"
						@back="cancel_payment()"
					/>
					<section class="payment-section payment-section--summary">
						<!-- Cobro's ticket card carries its own heading («Resumen
						     de la venta · 6 líneas · 9 pzas», the artboard's), so
						     a section title above it is the column saying its name
						     twice. -->
						<div v-if="!cobroMode" class="payment-section__header">
							<h3 class="payment-section__title">{{ __("Payment Summary") }}</h3>
						</div>
						<!-- What the money is FOR, on the screen where it is taken.
						     It suppresses itself when the cart is still beside this
						     panel — see `cartOnScreen`. -->
						<!-- Cobro is a full surface: the cart is BEHIND it, not beside
						     it, so the summary is the only place those lines can be
						     read and it must not suppress itself. -->
						<PaymentSaleSummary
							class="payment-sale-summary"
							:items="invoice_doc?.items"
							:cart-on-screen="cobroMode ? false : cartOnScreen"
							:wallet="customerWallet"
							:format-currency="formatSummaryCurrency"
						/>
						<!-- Phone: lead with the number the cashier is about to
						     charge. On desk it is one of nine fields in the totals
						     breakdown below; here it is the headline, so the three
						     rows that survive the fold read Total / Paid / Change. -->
						<div v-if="compactPaymentLayout && invoice_doc" class="payment-total-strip">
							<span class="payment-total-strip__label">{{ __("Total") }}</span>
							<strong class="payment-total-strip__amount">{{
								formatCurrency(invoiceChargeTotal, invoice_doc.currency)
							}}</strong>
						</div>
						<!--
							COBRO, column one's foot — the ticket's own totals.
							Subtotal · IVA · Descuento · Total, four single-line
							rows, and the ONE place this surface states the total.
							The nine-field `InvoiceTotals` breakdown is still here,
							one click away behind `More options`.
						-->
						<CobroTotalsFooter
							v-if="cobroMode && invoice_doc"
							:subtotal="Number(invoice_doc.net_total) || 0"
							:tax-label="cobroTaxLabel"
							:tax="Number(invoice_doc.total_taxes_and_charges) || 0"
							:discount="cobroDiscountTotal"
							:total="invoiceChargeTotal"
							:format-currency="formatSummaryCurrency"
							:currency-symbol="currencySymbol(invoice_doc.currency)"
						/>
						<!-- `hide-tendered` on Cobro only: the paper column prints
						     «Recibido / Falta por cubrir» and the band carries the
						     shortfall a third time. What is left is the Paid/Credit
						     Change pair, which are INPUTS for splitting change
						     between drawer and credit — occasional, so on Cobro
						     they fold with the rest of the tail. `v-show`, so a
						     half-typed credit change survives the fold; outside
						     Cobro the condition is constant. -->
						<PaymentSummary
							v-show="!cobroMode || cobroDetailsExpanded"
							:hide-tendered="cobroMode"
							:invoice_doc="invoice_doc"
							:total_payments_display="total_payments_display"
							:diff_payment_display="diff_payment_display"
							:diff_label="diff_label"
							:diff-payment="diff_payment"
							:change_due="change_due"
							:paid_change="paid_change"
							:credit_change="credit_change"
							:paid_change_rules="paid_change_rules"
							:currencySymbol="currencySymbol"
							:formatCurrency="formatCurrency"
							:gift-card-applied-amount="giftCardAppliedAmount"
							:gift-card-code="giftCardRedemptions[0]?.gift_card_code || ''"
							@show-paid-amount="showPaidAmount"
							@show-diff-payment="showDiffPayment"
							@show-paid-change="showPaidChange"
							@update-credit-change="handleCreditChangeUpdate"
						/>
					</section>

					<!--
						COBRO, column two — the money's HOW.

						The pad and the preset chips leave through
						`paymentMethodsHandlers`: the SAME object the payment
						cards below are wired to, landing on
						`handlePaymentAmountChange`, `set_full_amount` and
						`setPaymentToDenomination`. Not one new handler, not one
						new figure. The method rows below take the same object,
						which is where a split across two tenders is typed.

						This section is the column's ELASTIC half: the pad fills
						whatever height the grid gives it, which is what lets the
						panel fit a 1280×800 counter without a scrollbar.
					-->
					<section v-if="cobroMode" class="payment-section payment-section--tender">
						<CobroTenderPad
							:payments="visiblePaymentMethods"
							:currency="invoice_doc?.currency"
							:is-return="Boolean(invoice_doc?.is_return)"
							:format-currency="formatCurrency"
							:get-visible-denominations="getVisibleDenominations"
							v-on="paymentMethodsHandlers"
						/>
						<CobroOnClose
							:item-count="Number(invoice_doc?.total_qty) || 0"
							:updates-stock="Boolean(invoice_doc?.update_stock)"
						/>
					</section>

					<!--
						COBRO, column three — the money's PAPER.

						The band's primary prints (owner direction 2026-08-24),
						so this column carries the OTHER paper choice: the same
						`submit`, `print = false`. It is here because the footer
						does not render on this surface (the band owns the
						primary) and losing the paper-free path would be a
						regression dressed as a redesign. Outlined and
						unpainted: it is a paper choice, not a second primary.
					-->
					<section v-if="cobroMode" class="payment-section payment-section--paper">
						<CobroChangeCard
							:total="invoiceChargeTotal"
							:tendered="total_payments"
							:currency="invoice_doc?.currency"
							:format-currency="formatCurrency"
							:tax-id="customer_info?.tax_id || ''"
						/>
						<v-btn
							block
							variant="outlined"
							class="payment-cobro-print"
							data-testid="cobro-charge-no-print"
							:loading="loading"
							:disabled="loading || validatePayment"
							@click="submit(undefined, false, false)"
						>
							{{ __("Charge without printing") }}
						</v-btn>
						<!--
							The settlement fields and the print picker are this
							screen's legacy tail: real, rarely touched, and the
							reason the hosted surface read as "the new screen with
							the old one stacked below it". They fold behind one
							disclosure, in the column that already answers "what
							happens when this closes" — and they unfold themselves
							the moment a flag inside them is actually set, the same
							rule `moreMethodsExpanded` applies to a typed second
							tender.
						-->
						<button
							type="button"
							class="payment-disclosure"
							data-testid="cobro-more-options"
							:aria-expanded="cobroDetailsExpanded ? 'true' : 'false'"
							aria-controls="payment-cobro-adjustments payment-cobro-settlement payment-cobro-meta"
							@click="toggleCobroDetails()"
						>
							<v-icon
								:icon="cobroDetailsExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
								size="18"
							/>
							<span class="payment-disclosure__label">{{ __("More options") }}</span>
						</button>
					</section>

					<RestaurantTipSelector
						v-if="showRestaurantTips"
						v-model="restaurantTipAmount"
						:order-total="restaurantOrderTotal"
						:label="verticalStore.t('Tip')"
						:format-currency="(value) => formatCurrency(value, invoice_doc.currency)"
						:currency-symbol="currencySymbol(invoice_doc.currency)"
					/>

					<section
						v-if="is_cashback && invoice_doc"
						class="payment-section payment-section--methods"
					>
						<!-- Cobro's list carries its own «Forma de pago» heading,
						     the artboard's, so the section title would be the
						     second one. -->
						<div v-if="!cobroMode" class="payment-section__header">
							<h3 class="payment-section__title">{{ __("Payment Methods") }}</h3>
						</div>
						<!--
							COBRO: one compact line per configured tender — icon,
							name, amount — under the pad it feeds. Same events, same
							handlers object, no new seam on the money path; the card
							list below is what every other layout still renders.
						-->
						<CobroMethodRows
							v-if="cobroMode"
							:payments="visiblePaymentMethods"
							:currency="invoice_doc?.currency"
							:is-return="Boolean(invoice_doc?.is_return)"
							:request-payment-field="request_payment_field"
							:uses-gift-cards="Boolean(pos_profile?.posa_use_gift_cards)"
							:cart-has-items="Boolean(invoice_doc?.items?.length)"
							:currency-symbol="currencySymbol"
							:format-currency="formatCurrency"
							:is-number="isNumber"
							:is-cash-like-payment="isCashLikePayment"
							:is-mpesa-c2b-payment="is_mpesa_c2b_payment"
							:is-gift-card-payment="isGiftCardPayment"
							v-on="paymentMethodsHandlers"
						/>
						<!-- Phone: the default method keeps its full card (amount +
						     quick-cash chips) and the remaining methods collapse
						     behind one disclosure row, so the sheet is not a scroll
						     of identical cards. Desk is untouched —
						     `compactPaymentLayout` is false in dialog mode, and both
						     lists are the same component fed the same props, so a
						     split payment behaves identically either side of the
						     disclosure. -->
						<PaymentMethods
							v-else
							v-bind="paymentMethodsProps"
							v-on="paymentMethodsHandlers"
							:payments="compactPaymentLayout ? primaryPaymentMethods : visiblePaymentMethods"
						/>
						<div
							v-if="compactPaymentLayout && secondaryPaymentMethods.length"
							class="payment-more-methods"
						>
							<button
								type="button"
								class="payment-disclosure"
								:aria-expanded="moreMethodsExpanded ? 'true' : 'false'"
								aria-controls="payment-more-methods"
								@click="toggleMoreMethods()"
							>
								<v-icon
									:icon="moreMethodsExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
									size="18"
								/>
								<span class="payment-disclosure__label">{{
									__("More payment methods")
								}}</span>
								<span class="payment-disclosure__count">{{
									secondaryPaymentMethods.length
								}}</span>
							</button>
							<div id="payment-more-methods" v-show="moreMethodsExpanded">
								<PaymentMethods
									v-bind="paymentMethodsProps"
									v-on="paymentMethodsHandlers"
									:payments="secondaryPaymentMethods"
								/>
							</div>
						</div>
						<PaymentGiftCardSection
							:enabled="Boolean(pos_profile?.posa_use_gift_cards)"
							:expanded="giftCardInlineExpanded"
							:applied-amount="giftCardAppliedAmount"
							:card-code="giftCardCode || giftCardRedemptions[0]?.gift_card_code || ''"
							:redeem-amount="giftCardAmount"
							:balance="giftCardBalance"
							:status="giftCardStatus"
							:loading="giftCardLoading"
							:error-message="giftCardError"
							:format-currency="(value) => formatCurrency(value, invoice_doc.currency)"
							@toggle="toggleGiftCardInline"
							@update:card-code="giftCardCode = $event"
							@update:redeem-amount="giftCardAmount = $event"
							@check-balance="checkGiftCardBalance"
							@apply="applyGiftCardRedemption"
							@clear="clearGiftCardRedemption"
						/>
					</section>

					<!--
						«Canje y Totales», Fulfillment Details and the purchase
						order join the tail on Cobro. They are the fields the
						owner found in the PRIMARY column with a scrollbar of
						their own: real, occasionally needed, and never while the
						customer is holding out a note. `v-show`, so a half-typed
						PO number survives the fold; outside Cobro the condition
						is constant and the section renders outright.
					-->
					<section
						id="payment-cobro-adjustments"
						v-show="!cobroMode || cobroDetailsExpanded"
						class="payment-section payment-section--adjustments"
					>
						<div class="payment-section__header">
							<h3 class="payment-section__title">{{ __("Redemption and Totals") }}</h3>
						</div>
						<PaymentRedemption
							:invoice-doc="invoice_doc"
							:customer-info="customer_info"
							:pos-profile="pos_profile"
							:available-points-amount="available_points_amount"
							:loyalty-amount="loyalty_amount"
							:available-customer-credit="available_customer_credit"
							:redeem-customer-credit="redeem_customer_credit"
							:redeemed-customer-credit="redeemed_customer_credit"
							:format-currency="formatCurrency"
							:format-float="formatFloat"
							:currency-symbol="currencySymbol"
							@set-formatted-currency="handleRedemptionFormattedCurrency"
						/>
						<!-- Nine read-only totals fields are the single biggest block
						     of desk-list scroll on a phone. The headline number moved
						     to the summary strip above; the breakdown stays one tap
						     away. Desk renders it open, as today. -->
						<button
							v-if="compactPaymentLayout"
							type="button"
							class="payment-disclosure"
							:aria-expanded="breakdownOpen ? 'true' : 'false'"
							aria-controls="payment-totals-breakdown"
							@click="toggleBreakdown()"
						>
							<v-icon :icon="breakdownOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" />
							<span class="payment-disclosure__label">{{ __("Full breakdown") }}</span>
						</button>
						<div id="payment-totals-breakdown" v-show="!compactPaymentLayout || breakdownOpen">
							<InvoiceTotals
								:invoice_doc="invoice_doc"
								:displayCurrency="displayCurrency"
								:diff_payment="diff_payment"
								:diff_label="diff_label"
								:item-discount-total="paymentItemDiscountTotal"
								:currencySymbol="currencySymbol"
								:formatCurrency="formatCurrency"
							/>
						</div>
						<div class="payment-section__subsection">
							<h3 class="payment-section__title payment-section__title--subsection">
								{{ __("Fulfillment Details") }}
							</h3>
						</div>
						<PaymentAdditionalInfo
							:invoice-doc="invoice_doc"
							:pos-profile="pos_profile"
							:invoice-type="invoiceType"
							:return-validity-enabled="returnValidityEnabled"
							:return-validity-min-date="returnValidityMinDate"
							:addresses="addresses"
							:new-delivery-date="new_delivery_date"
							:return-valid-upto-date="return_valid_upto_date"
							:address-filter="addressFilter"
							@update:new-delivery-date="
								(val) => {
									new_delivery_date = val;
									update_delivery_date();
								}
							"
							@update:return-valid-upto-date="
								(val) => {
									return_valid_upto_date = val;
									updateReturnValidUpto();
								}
							"
							@new-address="new_address"
						/>
						<PaymentPurchaseOrder
							:invoice-doc="invoice_doc"
							:pos-profile="pos_profile"
							:new-po-date="new_po_date"
							@update:new-po-date="
								(val) => {
									new_po_date = val;
									update_po_date();
								}
							"
						/>
					</section>

					<!--
						`v-show`, never `v-if`: a half-typed write-off amount or a
						due date the cashier is still choosing must survive the
						disclosure closing over it. Outside Cobro the condition is
						constant, so the dialog and the phone sheet render exactly
						what they always did.
					-->
					<section
						id="payment-cobro-settlement"
						v-show="!cobroMode || cobroDetailsExpanded"
						class="payment-section payment-section--settlement"
					>
						<div class="payment-section__header">
							<h3 class="payment-section__title">{{ __("Credit and Output") }}</h3>
						</div>
						<PaymentOptions
							:invoice-doc="invoice_doc"
							:pos-profile="pos_profile"
							:diff-payment="diff_payment"
							:credit-change="credit_change"
							:is-write-off-change="is_write_off_change"
							:is-credit-sale="is_credit_sale"
							:is-cashback="is_cashback"
							:is-credit-return="is_credit_return"
							:new-credit-due-date="new_credit_due_date"
							:credit-due-days="credit_due_days"
							:credit-due-presets="credit_due_presets"
							:write-off-amount="invoice_doc.write_off_amount || Math.max(diff_payment, 0)"
							:write-off-max-amount="writeOffProfileLimit"
							:redeem-customer-credit="redeem_customer_credit"
							:available-customer-credit="available_customer_credit"
							:redeemed-customer-credit="redeemed_customer_credit"
							:customer-credit-sources="customer_credit_dict.length"
							:format-currency="formatCurrency"
							@update:is-write-off-change="is_write_off_change = $event"
							@update:is-credit-sale="is_credit_sale = $event"
							@update:is-cashback="is_cashback = $event"
							@update:is-credit-return="is_credit_return = $event"
							@update:new-credit-due-date="
								(val) => {
									new_credit_due_date = val;
									update_credit_due_date();
								}
							"
							@update:credit-due-days="credit_due_days = $event"
							@update:write-off-amount="handleWriteOffAmountUpdate"
							@apply-due-preset="applyDuePreset"
							@update:redeem-customer-credit="redeem_customer_credit = $event"
							@get-available-credit="get_available_credit"
						/>
						<PaymentCustomerCreditDetails
							:invoice-doc="invoice_doc"
							:available-customer-credit="available_customer_credit"
							:redeem-customer-credit="redeem_customer_credit"
							:customer-credit-dict="customer_credit_dict"
							:credit-source-label="creditSourceLabel"
							:format-currency="formatCurrency"
							:currency-symbol="currencySymbol"
							@set-formatted-currency="
								(data) =>
									setFormatedCurrency(data.target, data.field, null, false, data.value)
							"
						/>
					</section>

					<section
						id="payment-cobro-meta"
						v-show="!cobroMode || cobroDetailsExpanded"
						class="payment-section payment-section--meta"
					>
						<div class="payment-section__header">
							<h3 class="payment-section__title">{{ __("Sales Person and Print") }}</h3>
						</div>
						<PaymentSelectionFields
							:sales-persons="sales_persons"
							:sales-person="sales_person"
							:readonly="readonly"
							:print-formats="print_formats"
							:print-format="print_format"
							:show-print-format="
								parseBooleanSetting(pos_profile?.posa_allow_select_print_format_in_payments)
							"
							@update:sales-person="sales_person = $event"
							@update:print-format="print_format = $event"
						/>
					</section>
				</div>
			</div>
		</v-card>

		<!--
			The footer does not render on the Cobro surface. `ActionBand` owns
			the one action there (`sale.collectAndClose` → the same `submit`),
			and Submit is the payment screen's ONE accent — drawing it a second
			time under a band that already carries it is both a second primary
			and a second saturated fill. `Cancel Payment` is not lost either:
			the header's `Volver a la venta` is the same `cancel_payment()`.
			The component stays mounted on every other layout.
		-->
		<div
			v-if="!cobroMode"
			:class="['payment-footer', dialogMode ? 'payment-footer--dialog' : 'payment-footer--anchored']"
		>
			<PaymentActionButtons
				ref="submitButton"
				:loading="loading"
				:validatePayment="validatePayment"
				:highlightSubmit="highlightSubmit"
				:compact="dialogMode"
				@submit="submit"
				@submit-and-print="submit(undefined, false, true)"
				@cancel="cancel_payment()"
			/>
		</div>
		<!-- Dialogs Section (Custom Days, Phone Payment) -->
		<PaymentDialogs
			:custom-days-dialog="custom_days_dialog"
			:custom-days-value="custom_days_value"
			:phone-dialog="phone_dialog"
			:invoice-doc="invoice_doc"
			@update:custom-days-dialog="custom_days_dialog = $event"
			@update:custom-days-value="custom_days_value = $event"
			@apply-custom-days="applyCustomDays"
			@update:phone-dialog="phone_dialog = $event"
			@request-payment="request_payment"
		/>
		<!-- MP-INTEGRATION-POINT (sale checkout): terminal hard-gate modal -->
		<MpPointSaleGateDialog :gate="mpPointGate" />
		<GiftCardDialog
			:model-value="giftCardDialogOpen"
			:card-code="giftCardCode"
			:redeem-amount="giftCardAmount"
			:balance="giftCardBalance"
			:status="giftCardStatus"
			:is-supervisor="Boolean(currentCashier?.is_supervisor)"
			:loading="giftCardLoading"
			:mode="giftCardMode"
			:error-message="giftCardError"
			@update:model-value="giftCardDialogOpen = $event"
			@update:card-code="giftCardCode = $event"
			@update:redeem-amount="giftCardAmount = $event"
			@set-mode="setGiftCardMode"
			@check-balance="checkGiftCardBalance"
			@apply-redemption="applyGiftCardRedemption"
			@issue-card="issueGiftCard"
			@top-up-card="topUpGiftCard"
		/>
	</div>
</template>

<script>
// One deferred-print workflow per invoice (backtrace W9): a submit retry
// after a request exception re-schedules the same invoice while the first
// workflow may still be inside its 300 s patient wait — both would confirm
// docstatus 1 and the customer gets two tickets. MODULE scope, not setup
// scope: dialog-mode mounts Payments behind a v-if, so the instance dies
// between sales while the spawned workflow keeps running detached — a
// per-instance set would forget it on remount. Entries release in
// `finally`, so a workflow that ended (even in error) can be retried.
const deferredPrintInFlight = new Set();
</script>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, getCurrentInstance, nextTick } from "vue";
import { storeToRefs } from "pinia";

// Stores
import { useInvoiceStore } from "../../stores/invoiceStore";
import { useCustomersStore } from "../../stores/customersStore";
import { useUIStore } from "../../stores/uiStore";
import { useToastStore } from "../../stores/toastStore";
import { useSyncStore } from "../../stores/syncStore";
import { useSocketStore } from "../../stores/socketStore";
import { useEmployeeStore } from "../../stores/employeeStore";
import { useFloorStore } from "../../stores/floorStore";
import { useVerticalStore } from "../../stores/verticalStore";

// Composables
import { usePaymentCalculations } from "../../composables/pos/payments/usePaymentCalculations";
import { usePaymentSubmission } from "../../composables/pos/payments/usePaymentSubmission";
import { setCustomerDisplayCashbackPreview } from "../../composables/pos/shared/useCustomerDisplayPublisher";
import { useRedemptionLogic } from "../../composables/pos/payments/useRedemptionLogic";
import { usePaymentPrinting } from "../../composables/pos/payments/usePaymentPrinting";
import {
	waitForLateSubmission,
	assertSubmitNotKnownFailed,
} from "../../composables/pos/payments/usePatientSubmitWait";
import { usePaymentMethods } from "../../composables/pos/payments/usePaymentMethods";
import { useInvoiceDetails } from "../../composables/pos/invoice/useInvoiceDetails";
import { useFormat } from "../../format";
import { isOffline, getCachedGiftCardSnapshot, saveGiftCardSnapshot } from "../../../offline/index";
import GiftCardDialog from "./wallet/GiftCardDialog.vue";
import {
	initializePaymentLinesForDialog,
	rebalancePreferredPaymentLine,
	resolvePreferredPaymentLine,
	resolveReturnDefaultAmount,
} from "../../utils/paymentInitialization";
import { applyArmedPaymentPreference } from "./payments/armedTenderPreselect";
import { peekArmedTender } from "./invoice/armedTender";
import { resolvePaymentPrintFormatDoctypes } from "../../utils/paymentPrintDoctype";
import { resolvePaymentPrintFormat } from "../../utils/paymentPrintFormat";
import { parseBooleanSetting } from "../../utils/stock";
import { focusFirstKeyboardTarget } from "../../utils/keyboardNavigation";
import { track } from "../../utils/telemetry";
import { shouldShowRestaurantTips } from "../../utils/restaurantTips";

// Components
import PaymentSummary from "./payments/PaymentSummary.vue";
import InvoiceTotals from "./payments/InvoiceTotals.vue";
import PaymentActionButtons from "./payments/PaymentActionButtons.vue";
import PaymentMethods from "./payments/PaymentMethods.vue";
import PaymentGiftCardSection from "./payments/PaymentGiftCardSection.vue";
import PaymentRedemption from "./payments/PaymentRedemption.vue";
import PaymentAdditionalInfo from "./payments/PaymentAdditionalInfo.vue";
import PaymentPurchaseOrder from "./payments/PaymentPurchaseOrder.vue";
import PaymentCustomerCreditDetails from "./payments/PaymentCustomerCreditDetails.vue";
import PaymentOptions from "./payments/PaymentOptions.vue";
import PaymentSelectionFields from "./payments/PaymentSelectionFields.vue";
import PaymentSaleSummary from "./payments/PaymentSaleSummary.vue";
import PaymentReadinessHeader from "./payments/PaymentReadinessHeader.vue";
import { useHardwareReadiness } from "./payments/useHardwareReadiness";
import PaymentDialogs from "./payments/PaymentDialogs.vue";
import RestaurantTipSelector from "./payments/RestaurantTipSelector.vue";
// Cobro — the desktop payment SURFACE (build plan §14). Chrome only: these
// five render this component's own state and reach its own handlers through
// the contract `PaymentMethods` already has. Nothing below `<script setup>`
// changed for them beyond these imports, the `cobroMode` prop and two derived
// LABELS (`cobroTaxLabel`, `cobroDiscountTotal`) that move no money.
import CobroTenderPad from "./payments/cobro/CobroTenderPad.vue";
import CobroMethodRows from "./payments/cobro/CobroMethodRows.vue";
import CobroTotalsFooter from "./payments/cobro/CobroTotalsFooter.vue";
import CobroOnClose from "./payments/cobro/CobroOnClose.vue";
import CobroChangeCard from "./payments/cobro/CobroChangeCard.vue";
import { resolveTaxBreakdown } from "./invoice/saleTaxBreakdown";
// MP-INTEGRATION-POINT (sale checkout): hard gate — isolated, no-op when off.
import MpPointSaleGateDialog from "../pos_pay/MpPointSaleGateDialog.vue";
import { useMpPointSaleGate } from "../../composables/pos/payments/useMpPointSaleGate";

const props = defineProps({
	dialogMode: {
		type: Boolean,
		default: false,
	},
	/**
	 * The desktop Cobro surface, hosted beside the rail (build plan §14.2).
	 *
	 * A LAYOUT flag, and only that: the same sections, the same bindings, the
	 * same submit, arranged in the artboard's three columns instead of one
	 * scrolling list. Nothing in this file's state or handlers reads it —
	 * grep it and you will find the template and the stylesheet, which is the
	 * property §14.4 asked for.
	 */
	cobroMode: {
		type: Boolean,
		default: false,
	},
});

const { proxy } = getCurrentInstance();
const eventBus = proxy.eventBus;
const __ = window.__;
const frappe = window.frappe;

const invoiceStore = useInvoiceStore();
const customersStore = useCustomersStore();
const uiStore = useUIStore();
const toastStore = useToastStore();
const syncStore = useSyncStore();
const socketStore = useSocketStore();
const floorStore = useFloorStore();
const verticalStore = useVerticalStore();

// Destructure format utilities
const {
	currency_precision,
	formatCurrency,
	formatFloat,
	currencySymbol,
	isNumber,
	flt,
	setFormatedCurrency,
} = useFormat();

const { selectedCustomer, customerInfo } = storeToRefs(customersStore);
const { activeView, paymentDialogOpen } = storeToRefs(uiStore);
const { invoiceType } = storeToRefs(invoiceStore);
const employeeStore = useEmployeeStore();
const { currentCashier } = storeToRefs(employeeStore);

// State
const is_return = ref(false);
const is_credit_sale = ref(false);
const is_write_off_change = ref(false);
const redeem_customer_credit = ref(false);
const pos_profile = ref("");
const stock_settings = ref("");
const pos_settings = ref({});
const is_cashback = ref(true);
const paid_change = ref(0);

// MP-INTEGRATION-POINT (sale checkout): hard gate. No-op unless the connector
// is enabled AND the sale carries a MercadoPago Point payment amount.
const mpPointGate = useMpPointSaleGate({
	getInvoiceDoc: () => invoiceStore.invoiceDoc,
	getPosProfile: () => pos_profile.value,
	isSupervisor: () => Boolean(currentCashier.value?.is_supervisor),
});
const credit_change = ref(0);
const loading = ref(false);
const show_change_dialog = ref(false);
const sales_person = ref("");
const is_credit_return = ref(false);
// SEEDED FROM THE STORE, not left empty for a watcher that will never fire.
//
// The customer is chosen in the CART, and `get_customer_info` lands in
// `customersStore` there — long before this panel exists. Every mount of this
// component is a `v-if`: Cobro (`CobroSurface`), the payment dialog and the
// anchored panel all appear only once the cashier asks to be paid. So the
// watcher below, which is the ref's only other writer, has nothing left to
// observe: the value it was waiting for arrived before it was registered.
//
// Empty here meant `loyalty_program` and `stored_value_balance` were both
// undefined for the whole payment, which is why the wallet card was dark for
// an enrolled customer AND why `useRedemptionLogic` never even asked the
// server for the accrual — `cashbackAsksTheServer` reads this same ref.
const customer_info = ref(customerInfo.value || "");
const print_format = ref("");
const print_formats = ref([]);
const paid_change_rules = ref([]);
const is_user_editing_paid_change = ref(false);
const highlightSubmit = ref(false);
const last_payment_change_was_cash = ref(null);
// True once the cashier manually sets a payment amount (typed or tapped a
// denomination). While true, auto-defaulting (syncPreferredPaymentToCurrentTotal)
// backs off so changing another field / toggling credit doesn't wipe what they
// entered. Reset on new invoice / clear / submit. Credit-toggle uses its own
// snapshot (paymentSnapshotBeforeCredit) to restore amounts.
const paymentsTouched = ref(false);
let paymentSnapshotBeforeCredit = null;
const backgroundStatusCheck = ref(null);
const paymentVisible = ref(false);
const paymentRoot = ref(null);
const paymentContainer = ref(null);
const submitButton = ref(null);
const _shortcutHandlers = ref({});
const readonly = ref(false); // Add missing readonly ref
const submissionInFlight = ref(false);
const queuedShortcutSubmit = ref(null);
const giftCardDialogOpen = ref(false);
const giftCardInlineExpanded = ref(false);
const activeGiftCardPayment = ref(null);
const giftCardCode = ref("");
const giftCardAmount = ref(0);
const giftCardBalance = ref(0);
const giftCardStatus = ref("");
const giftCardLoading = ref(false);
const giftCardMode = ref("redeem");
const giftCardError = ref("");
const giftCardRedemptions = ref([]);
const restaurantTipAmount = ref(0);
let restaurantTipBaseTotals = null;
// Tip already folded into the doc totals — lets applyRestaurantTipTotal know
// what "the total before this change" was when deciding to follow the tip.
let lastAppliedRestaurantTip = 0;

// ── Compact ("payment sheet") layout ─────────────────────────────────────
// Pos.vue renders this component inline below 992px and inside the payment
// dialog at or above it, so the inline view is always the compact one. The
// width test uses the shell's own dock band (1100px) so the class and the
// stylesheet agree, and it is pinned to false in dialog mode — desk must not
// see any of the compact branches.
const COMPACT_PAYMENT_WIDTH = 1100;
// Seeded from the width so the first paint is already the right layout — a
// frame of the full desk list before the measurement lands reads as a flash.
const compactPaymentLayout = ref(
	typeof window !== "undefined" && !props.dialogMode && window.innerWidth < COMPACT_PAYMENT_WIDTH,
);
// Distance from the top of this panel to the bottom of the viewport. The
// navbar, the POS toolbar and the offline banner all sit above the panel, so
// the offset is measured rather than guessed; the stylesheet subtracts the
// dock from it. Document-relative (rect.top + scrollY) so a page that is
// still scrolled from the cart view does not measure short.
const shellViewportSpace = ref(0);
const moreMethodsOpen = ref(false);
const breakdownOpen = ref(false);
let shellMeasureFrame = null;

const measureShell = () => {
	if (typeof window === "undefined") return;
	compactPaymentLayout.value = !props.dialogMode && window.innerWidth < COMPACT_PAYMENT_WIDTH;

	const el = paymentRoot.value;
	if (!el || props.dialogMode) {
		shellViewportSpace.value = 0;
		return;
	}
	const documentTop = el.getBoundingClientRect().top + (window.scrollY || 0);
	// Floor it: a soft keyboard can shrink innerHeight below the panel's own
	// top, and a sheet with no room left is worse than one that overflows.
	shellViewportSpace.value = Math.max(Math.round(window.innerHeight - documentTop), 360);
};

const scheduleShellMeasure = () => {
	if (typeof window === "undefined") return;
	if (shellMeasureFrame) {
		cancelAnimationFrame(shellMeasureFrame);
	}
	shellMeasureFrame = requestAnimationFrame(() => {
		shellMeasureFrame = null;
		measureShell();
	});
};

const anchoredShellStyle = computed(() =>
	props.dialogMode || !shellViewportSpace.value
		? null
		: { "--payment-shell-space": `${shellViewportSpace.value}px` },
);

const toggleMoreMethods = (open) => {
	moreMethodsOpen.value = typeof open === "boolean" ? open : !moreMethodsOpen.value;
};

const toggleBreakdown = (open) => {
	breakdownOpen.value = typeof open === "boolean" ? open : !breakdownOpen.value;
};

// Cobro's legacy tail — settlement options and the print picker — behind one
// disclosure in the column that already answers "what happens when this
// closes". Only ever consulted under `cobroMode`; every other layout renders
// both sections outright, which is why the template asks `!cobroMode ||`.
const cobroDetailsOpen = ref(false);

const toggleCobroDetails = (open) => {
	cobroDetailsOpen.value = typeof open === "boolean" ? open : !cobroDetailsOpen.value;
};

// Computed Properties
const invoice_doc = computed({
	get: () => invoiceStore.invoiceDoc || {},
	set: (value) => invoiceStore.setInvoiceDoc(value),
});

const restaurantOrderTotal = computed(() =>
	(floorStore.activeOrder?.lines || []).reduce(
		(sum, line) => sum + (Number(line.qty) || 0) * (Number(line.rate) || 0),
		0,
	),
);
const showRestaurantTips = computed(
	() => shouldShowRestaurantTips(
		verticalStore.has("tips"),
		floorStore.isRecordOnly,
		Boolean(floorStore.activeOrder),
	),
);
const TIP_TOTAL_FIELDS = [
	"grand_total",
	"rounded_total",
	"base_grand_total",
	"base_rounded_total",
];

const captureRestaurantTipBaseTotals = () => {
	const doc = invoice_doc.value;
	restaurantTipBaseTotals = Object.fromEntries(
		TIP_TOTAL_FIELDS.map((field) => [field, Number(doc?.[field]) || 0]),
	);
};
const applyRestaurantTipTotal = () => {
	const doc = invoice_doc.value;
	if (!doc || !restaurantTipBaseTotals) return;
	for (const field of TIP_TOTAL_FIELDS) {
		const baseValue = restaurantTipBaseTotals[field];
		if (field.includes("rounded") && !baseValue) continue;
		if (doc[field] !== undefined && doc[field] !== null) {
			const tip = field.startsWith("base_")
				? restaurantTipAmount.value * (Number(doc.conversion_rate) || 1)
				: restaurantTipAmount.value;
			doc[field] = flt(
				baseValue + tip,
				currency_precision.value,
			);
		}
	}
	if (!paymentsTouched.value) {
		syncPreferredPaymentToCurrentTotal(doc);
	} else {
		// Tip chosen AFTER the cashier typed/tapped an amount — the routine
		// counter gesture. If their entry exactly covered the pre-change
		// total it meant "exact", so follow the tip; a deliberate over/under
		// tender (real cash in hand) is never rewritten and the shortfall
		// stays visible for the cashier to collect.
		const priorTotal = flt(
			(restaurantTipBaseTotals.rounded_total || restaurantTipBaseTotals.grand_total || 0) +
				lastAppliedRestaurantTip,
			currency_precision.value,
		);
		const paid = flt(
			(doc.payments || []).reduce((sum, p) => sum + (Number(p?.amount) || 0), 0),
			currency_precision.value,
		);
		if (paid === priorTotal) {
			paymentsTouched.value = false;
			syncPreferredPaymentToCurrentTotal(doc);
			paymentsTouched.value = true;
		}
	}
	lastAppliedRestaurantTip = restaurantTipAmount.value;
};

const paymentItemDiscountTotal = computed(() => {
	const items = Array.isArray(invoice_doc.value?.items) ? invoice_doc.value.items : [];

	const total = items.reduce((sum, item) => {
		const qty = Math.abs(flt(item?.qty || 0, currency_precision.value));
		const explicitDiscount = Math.abs(flt(item?.discount_amount || 0, currency_precision.value));
		const rateDiscount =
			explicitDiscount > 0
				? explicitDiscount
				: Math.max(
						flt(item?.price_list_rate || 0, currency_precision.value) -
							flt(item?.rate || 0, currency_precision.value),
						0,
					);

		return sum + qty * rateDiscount;
	}, 0);

	return flt(total, currency_precision.value);
});

const displayCurrency = computed(() => (invoice_doc.value ? invoice_doc.value.currency : ""));
const isPaymentOpen = computed(() => activeView.value === "payment" || paymentDialogOpen.value);
const netInvoiceSettlementAmount = computed(() => {
	if (!invoice_doc.value) return 0;

	const invoiceTotal = flt(
		invoice_doc.value.rounded_total || invoice_doc.value.grand_total,
		currency_precision.value,
	);
	const coveredAmount = flt(
		(invoice_doc.value?.loyalty_amount || loyalty_amount.value || 0) +
			(redeemed_customer_credit.value || 0),
		currency_precision.value,
	);

	const net = invoiceTotal - coveredAmount;
	return invoice_doc.value?.is_return ? Math.min(net, 0) : Math.max(net, 0);
});

const validatePayment = computed(() => {
	const profile = pos_profile.value;
	if (!profile || !profile.posa_allow_sales_order) {
		return false;
	}
	if (invoiceType.value !== "Order") {
		return false;
	}
	const doc = invoice_doc.value;
	return !doc || !doc.posa_delivery_date;
});

const getWriteOffLimit = (profile) => {
	if (!profile) return null;

	// ERPNext's native write_off_limit is the only limit field that exists;
	// the four aliases were never fields anywhere (2026-08-29 audit).
	const possibleLimitFields = ["write_off_limit"];

	for (const field of possibleLimitFields) {
		const rawValue = profile?.[field];
		if (rawValue === undefined || rawValue === null || rawValue === "") {
			continue;
		}

		const parsed = flt(rawValue, currency_precision.value);
		if (parsed > 0) {
			return parsed;
		}
	}

	return null;
};

const writeOffProfileLimit = computed(() => getWriteOffLimit(pos_profile.value));

const request_payment_field = computed(() => {
	return (
		pos_settings.value?.invoice_fields?.some(
			(el) => el.fieldtype === "Button" && el.fieldname === "request_for_payment",
		) || false
	);
});

const returnValidityEnabled = computed(() => {
	return Boolean(
		pos_profile.value?.posa_enable_return_validity || pos_settings.value?.posa_enable_return_validity,
	);
});

const returnValidityMinDate = computed(() => {
	const postingDate = invoice_doc.value?.posting_date || frappe.datetime?.nowdate?.();
	if (!postingDate) {
		return new Date();
	}
	const parsed = new Date(postingDate);
	if (Number.isNaN(parsed.getTime())) {
		return new Date();
	}
	return parsed;
});

// Logic Composables
const {
	loyalty_amount,
	redeemed_customer_credit,
	customer_credit_dict,
	available_customer_credit,
	available_points_amount,
	cashback_accrual,
	get_available_credit,
} = useRedemptionLogic({
	invoiceDoc: computed(() => invoiceStore.invoiceDoc),
	posProfile: pos_profile,
	customerInfo: customer_info,
	currencyPrecision: currency_precision,
	formatFloat: (val, prec) => flt(val, prec),
	stores: { toastStore },
	onClearAmounts: () => {},
});

// The customer's screen shows «Con esta compra acumulas» in its Done state
// (PANTALLA_CLIENTE_GOLDEN_FLOW.md §1). The preview is read from the server
// here and nowhere else, so this is the only place that can hand it over.
// `null` — cards off, unenrolled, offline — leaves the card absent.
watch(cashback_accrual, (value) => setCustomerDisplayCashbackPreview(value), {
	immediate: true,
});

const { loadPrintPage, printOfflineInvoice } = usePaymentPrinting({
	invoiceDoc: computed(() => invoiceStore.invoiceDoc),
	posProfile: pos_profile,
	invoiceType: invoiceType,
	printFormat: print_format,
});

const paymentCalculations = usePaymentCalculations({
	invoiceDoc: computed(() => invoiceStore.invoiceDoc),
	posProfile: pos_profile,
	currencyPrecision: currency_precision,
	loyaltyAmount: loyalty_amount,
	redeemedCustomerCredit: redeemed_customer_credit,
	customerCreditDict: customer_credit_dict,
	customerInfo: customer_info,
	giftCardRedemptions,
	formatCurrency: (val, _curr) => formatCurrency(val, currency_precision.value),
});

const { diff_payment, total_payments, total_payments_display, diff_payment_display, diff_label, change_due } =
	paymentCalculations;

const {
	phone_dialog,
	get_mpesa_modes,
	is_mpesa_c2b_payment,
	mpesa_c2b_dialog,
	set_mpesa_payment,
	set_full_amount,
	set_rest_amount,
	request_payment,
	getVisibleDenominations,
	isCashLikePayment,
} = usePaymentMethods({
	invoiceDoc: computed(() => invoiceStore.invoiceDoc),
	posProfile: pos_profile,
	diffPayment: diff_payment,
	getNetInvoiceAmount: () => netInvoiceSettlementAmount.value,
	formatFloat: (val) => flt(val, currency_precision.value),
	stores: {
		toastStore,
		uiStore,
		customersStore,
	},
	eventBus: eventBus,
	onSubmit: (args, submitPrint) => {
		submitInvoiceWrapper(submitPrint, {
			// onPrint only ever fires on the IMMEDIATE path: usePaymentSubmission
			// guards the call with `!waitForInvoiceProcessing && !hasPostSubmitPaymentWork`,
			// so both flags are false here by construction. Deferred sales reach
			// runDeferredPrintWorkflow through onScheduleBackgroundCheck instead —
			// this branch was unreachable (backtrace N1).
			onPrint: (doc, printOptions = {}) => {
				if (submitPrint) {
					if (isOffline()) {
						printOfflineInvoice(doc);
					} else {
						loadPrintPage({
							doc,
							doctype: printOptions.doctype,
							name: printOptions.name,
						});
					}
				}
			},
			onSuccess: () => {
				eventBus.emit("focus_item_search");
			},
		});
	},
	setRedeemCustomerCredit: (val) => {
		redeem_customer_credit.value = val;
	},
	customerCreditDict: customer_credit_dict,
	redeemedCustomerCredit: redeemed_customer_credit,
	isCashback: is_cashback,
	getTotalChange: () => Math.max(-diff_payment.value, 0),
	getPaidChange: () => paid_change.value,
	getCreditChange: () => credit_change.value,
	// "change_active_view" had no listener — the operator stayed stuck on
	// the payment screen. This is the same back-out as Cancel Payment (the
	// sale is still alive), so it takes the same exit. It used to emit
	// set_compact_panel alone, which showed the cart but left activeView on
	// "payment": the dock kept PAGAR lit and the next panel sync threw the
	// cashier back onto payment. No refocus — this path has just opened the
	// customer form, and that dialog owns the focus.
	onBackToInvoice: () => cancel_payment({ refocusSearch: false }),
});

const {
	addresses,
	sales_persons,
	new_delivery_date,
	new_po_date,
	new_credit_due_date,
	credit_due_days,
	credit_due_presets,
	custom_days_dialog,
	custom_days_value,
	return_valid_upto_date,
	get_addresses,
	new_address,
	addressFilter,
	normalizeAddress,
	get_sales_person_names,
	update_delivery_date,
	update_po_date,
	update_credit_due_date,
	applyDuePreset,
	applyCustomDays,
	initializeReturnValidity,
	updateReturnValidUpto,
	formatDateDisplay,
} = useInvoiceDetails({
	invoiceDoc: computed(() => invoiceStore.invoiceDoc),
	posProfile: pos_profile,
	invoiceType: invoiceType,
	posSettings: pos_settings,
	stores: {
		toastStore,
		invoiceStore,
	},
	eventBus: eventBus,
});

const { ensureReturnPaymentsAreNegative, restoreReturnPayments, validateSubmission, submitInvoice } =
	usePaymentSubmission({
		invoiceDoc: computed(() => invoiceStore.invoiceDoc),
		posProfile: pos_profile,
		stockSettings: stock_settings,
		invoiceType: invoiceType,
		is_write_off_change: is_write_off_change,
		isCashback: is_cashback,
		paidChange: paid_change,
		creditChange: credit_change,
		redeemedCustomerCredit: redeemed_customer_credit,
		customerCreditDict: customer_credit_dict,
		giftCardRedemptions: giftCardRedemptions,
		diff_payment: diff_payment,
		is_credit_sale: is_credit_sale,
		loyaltyAmount: loyalty_amount,
		formatFloat: (val, prec) => flt(val, prec),
		formatCurrency,
		stores: {
			toastStore,
			syncStore,
			customersStore,
			uiStore,
			invoiceStore,
		},
		currencyPrecision: currency_precision,
		restaurantTipAmount,
		// The settle seam's floor store. Handed over rather than looked up
		// inside the composable: this component resolved it through the app's
		// injected pinia, and that is the instance the salón, the mesa strip
		// and this screen's tip block all read. A lookup from inside the
		// lazily-imported payments chunk reached a SECOND pinia (the entry
		// bundle evaluates twice — once at `?v=<build>`, once bare) whose floor
		// store had no register and no cuenta, so `isRecordOnly && activeOrder`
		// was false on every mesa charge and the cuenta stayed Open.
		floorStore: () => floorStore,
	});

// ── The artboard's payment screen (§12 item B) ───────────────────────────
// Three presentation seams, all read-only. Not one of them can move a peso:
// they are handed what the register already holds and draw it.

// `PaymentSaleSummary` refuses to draw a second copy of a cart that is still
// on screen. Today neither mount has one — the dialog puts the cart behind a
// scrim and the anchored panel (only mounted below 992px, where the shell's
// switcher is compact) swaps it away — but the condition is written out
// rather than hardcoded to `false`, so a layout that brings the cart back
// silences the duplicate instead of shipping it.
const cartOnScreen = computed(() => !props.dialogMode && !compactPaymentLayout.value);

// The component's contract is `(value) => string`; ours takes a currency too.
const formatSummaryCurrency = (value) => formatCurrency(value, invoice_doc.value?.currency);

// Which wallet, and whether it may be claimed at all, is `walletSummary`'s
// decision — it is the module that knows loyalty accrues and stored value
// does not. This only sources the fields.
const customerWallet = computed(() => ({
	loyaltyProgram: customer_info.value?.loyalty_program ?? null,
	// `available_points_amount` answers 0 for "no points" AND for "no invoice
	// yet"; only the first is a fact, so the second reads null and the card
	// stays absent rather than promising an empty wallet.
	loyaltyValue: invoice_doc.value ? available_points_amount.value : null,
	storedValueBalance: customer_info.value?.stored_value_balance ?? null,
	// Read, never derived: `collection_factor` is a tier value picked from
	// spend the client does not have. `useRedemptionLogic` fills this from
	// `stored_value.get_cashback_preview`; it stays null for registers with
	// cards off, unenrolled customers and offline sales.
	accrual: cashback_accrual.value,
	isReturn: Boolean(invoice_doc.value?.is_return),
}));

// Subscribes to the print-health singleton the navbar dot already runs; it
// starts nothing and fetches nothing at the moment of taking money.
const hardwareReadiness = useHardwareReadiness({ posProfile: pos_profile });

const isGiftCardPayment = (payment) => {
	if (!pos_profile.value?.posa_use_gift_cards) {
		return false;
	}
	return String(payment?.mode_of_payment || "")
		.trim()
		.toLowerCase()
		.includes("gift");
};

const visiblePaymentMethods = computed(() =>
	(Array.isArray(invoice_doc.value?.payments) ? invoice_doc.value.payments : []).filter(
		(payment) => !isGiftCardPayment(payment),
	),
);

// The card a cashier reaches for first: the profile's default line, falling
// back to the first visible one so a profile with no default still leads with
// something usable.
const primaryPaymentMethod = computed(() => {
	const methods = visiblePaymentMethods.value;
	if (!methods.length) return null;
	return methods.find((payment) => payment?.default === 1) || methods[0];
});

const primaryPaymentMethods = computed(() =>
	primaryPaymentMethod.value ? [primaryPaymentMethod.value] : [],
);

const secondaryPaymentMethods = computed(() =>
	visiblePaymentMethods.value.filter((payment) => payment !== primaryPaymentMethod.value),
);

// A split payment must never hide behind the disclosure: any amount already
// sitting on a secondary method (typed here, or restored with a draft) forces
// the section open regardless of the toggle.
const secondaryMethodsHaveAmount = computed(() =>
	secondaryPaymentMethods.value.some(
		(payment) => flt(payment?.amount || 0, currency_precision.value) !== 0,
	),
);

const moreMethodsExpanded = computed(() => moreMethodsOpen.value || secondaryMethodsHaveAmount.value);

// Same rule one column over: a settlement the cashier has actually engaged
// must never hide behind the disclosure. `is_cashback` reads inverted on
// purpose — false is the state that HIDES the payment methods, and the switch
// that undoes it lives in the section this would have folded away.
const cobroDetailsExpanded = computed(
	() =>
		cobroDetailsOpen.value ||
		!is_cashback.value ||
		is_credit_sale.value ||
		is_credit_return.value ||
		is_write_off_change.value ||
		redeem_customer_credit.value,
);

// Both method lists are the same component with the same wiring — bound once
// so the collapsed list can never drift from the primary one. Computeds are
// lazy, so referencing handlers declared further down is safe: they resolve at
// render, not at setup.
const paymentMethodsProps = computed(() => ({
	currency: invoice_doc.value?.currency,
	isReturn: invoice_doc.value?.is_return,
	requestPaymentField: request_payment_field.value,
	currencySymbol,
	formatCurrency,
	isNumber,
	getVisibleDenominations,
	isCashLikePayment,
	isMpesaC2bPayment: is_mpesa_c2b_payment,
	isGiftCardPayment,
}));

const paymentMethodsHandlers = computed(() => ({
	"update-amount": handlePaymentAmountChange,
	"set-full-amount": set_full_amount,
	"set-denomination": setPaymentToDenomination,
	"mpesa-dialog": mpesa_c2b_dialog,
	"request-payment": request_payment,
	"set-rest-amount": set_rest_amount,
	"open-gift-card": openGiftCardDialog,
}));

// The amount the cashier is settling. Mirrors the rule diff_payment uses in
// usePaymentCalculations — a foreign-currency invoice under multi-currency is
// charged at grand_total, everything else at the rounded total — so the strip
// and "To Be Paid" can never disagree.
const invoiceChargeTotal = computed(() => {
	const doc = invoice_doc.value;
	if (!doc) return 0;
	const profile = pos_profile.value || {};
	if (profile.posa_allow_multi_currency && doc.currency !== profile.currency) {
		return flt(doc.grand_total, currency_precision.value);
	}
	return flt(doc.rounded_total || doc.grand_total, currency_precision.value);
});

// ── Cobro's totals footer — two derived LABELS, no arithmetic on money ────
// Both figures the footer states beside these come straight off the document
// (`net_total`, `total_taxes_and_charges`, `invoiceChargeTotal`). What is
// derived here is the tax's NAME and the sum of the two discount fields the
// nine-field breakdown states separately.

// `IVA 16 %` — the tenant's own word for its tax, from the document's own tax
// row, through the module the sale band already labels its pair with. Only the
// LABEL is taken: the amount is the server's `total_taxes_and_charges`, which
// is authoritative on a screen whose document has been through the server.
// Blank when the register cannot name one row confidently, which is the
// footer's signal to draw no tax line at all rather than an `IVA $0.00`.
const cobroTaxLabel = computed(() => {
	const doc = invoice_doc.value;
	if (!doc) return "";
	const breakdown = resolveTaxBreakdown({
		docTaxes: doc.taxes,
		subtotal: doc.net_total,
		taxLabel: __("Tax"),
	});
	return breakdown ? breakdown.label : __("Tax and Charges");
});

// `Descuento`: item/rate discounts plus the invoice-level one — the same sum
// `InvoiceTotals` publishes as «Total Discount», so the footer and the full
// breakdown behind `More options` cannot state two different discounts.
const cobroDiscountTotal = computed(
	() =>
		Math.abs(paymentItemDiscountTotal.value) +
		Math.abs(flt(invoice_doc.value?.discount_amount || 0, currency_precision.value)),
);

const giftCardAppliedAmount = computed(() =>
	(Array.isArray(giftCardRedemptions.value) ? giftCardRedemptions.value : []).reduce(
		(sum, row) => sum + flt(row?.amount || 0, currency_precision.value),
		0,
	),
);

const resetGiftCardState = ({ clearPayment = false } = {}) => {
	giftCardDialogOpen.value = false;
	giftCardInlineExpanded.value = false;
	giftCardCode.value = "";
	giftCardAmount.value = 0;
	giftCardBalance.value = 0;
	giftCardStatus.value = "";
	giftCardLoading.value = false;
	giftCardMode.value = "redeem";
	giftCardError.value = "";
	giftCardRedemptions.value = [];
	if (clearPayment && activeGiftCardPayment.value) {
		activeGiftCardPayment.value.amount = 0;
		if (activeGiftCardPayment.value.base_amount !== undefined) {
			activeGiftCardPayment.value.base_amount = 0;
		}
	}
	activeGiftCardPayment.value = null;
};

const setGiftCardMode = (mode) => {
	giftCardMode.value = mode || "redeem";
	giftCardError.value = "";
};

const getGiftCardRemainingAmount = () => {
	const flexiblePayment =
		activeGiftCardPayment.value || resolvePreferredPaymentLine(invoice_doc.value, isCashLikePayment);
	const payments = Array.isArray(invoice_doc.value?.payments) ? invoice_doc.value.payments : [];
	const otherPaymentsTotal = payments.reduce((sum, payment) => {
		if (!payment || payment === flexiblePayment) {
			return sum;
		}
		return sum + flt(payment.amount || 0, currency_precision.value);
	}, 0);
	return Math.max(flt(netInvoiceSettlementAmount.value - otherPaymentsTotal, currency_precision.value), 0);
};

const clearGiftCardRedemption = () => {
	if (activeGiftCardPayment.value) {
		activeGiftCardPayment.value.amount = 0;
		if (activeGiftCardPayment.value.base_amount !== undefined) {
			activeGiftCardPayment.value.base_amount = 0;
		}
	}
	giftCardRedemptions.value = [];
	giftCardCode.value = "";
	giftCardAmount.value = 0;
	giftCardBalance.value = 0;
	giftCardStatus.value = "";
	giftCardError.value = "";
	giftCardInlineExpanded.value = false;
	rebalancePreferredPaymentCoverage(0);
};

const toggleGiftCardInline = () => {
	giftCardInlineExpanded.value = !giftCardInlineExpanded.value;
	activeGiftCardPayment.value = null;
	if (giftCardInlineExpanded.value) {
		giftCardCode.value = giftCardRedemptions.value[0]?.gift_card_code || giftCardCode.value || "";
		giftCardAmount.value = flt(
			giftCardRedemptions.value[0]?.amount || giftCardAmount.value || 0,
			currency_precision.value,
		);
	} else {
		giftCardError.value = "";
	}
};

const openGiftCardDialog = (payment = null) => {
	activeGiftCardPayment.value = payment;
	giftCardDialogOpen.value = true;
	giftCardCode.value = giftCardRedemptions.value[0]?.gift_card_code || "";
	giftCardAmount.value = flt(
		giftCardRedemptions.value[0]?.amount || payment?.amount || 0,
		currency_precision.value,
	);
	giftCardBalance.value = flt(giftCardBalance.value || 0, currency_precision.value);
	giftCardStatus.value = giftCardStatus.value || "";
	giftCardMode.value = "redeem";
	giftCardError.value = "";
};

const checkGiftCardBalance = async () => {
	if (!giftCardCode.value || !pos_profile.value?.company) {
		giftCardError.value = __("Gift card code is required.");
		return;
	}

	if (isOffline()) {
		const cached = getCachedGiftCardSnapshot(giftCardCode.value);
		if (!cached) {
			giftCardError.value = __("No cached gift card balance is available offline.");
			return;
		}
		giftCardBalance.value = flt(cached.current_balance || 0, currency_precision.value);
		giftCardStatus.value = cached.status || "";
		return;
	}

	giftCardLoading.value = true;
	giftCardError.value = "";
	try {
		const response = await frappe.call({
			method: "posawesome.posawesome.api.gift_cards.check_gift_card_balance",
			args: {
				gift_card_code: giftCardCode.value,
				company: pos_profile.value.company,
			},
		});
		const card = response?.message || {};
		giftCardBalance.value = flt(card.current_balance || 0, currency_precision.value);
		giftCardStatus.value = card.status || "";
		saveGiftCardSnapshot(giftCardCode.value, card);
		if (!giftCardAmount.value && giftCardMode.value === "redeem") {
			giftCardAmount.value = Math.min(giftCardBalance.value, getGiftCardRemainingAmount());
		}
	} catch (error) {
		giftCardError.value = error?.message || __("Unable to load gift card balance.");
	}
	giftCardLoading.value = false;
};

const applyGiftCardRedemption = async () => {
	if (!giftCardBalance.value || !giftCardStatus.value) {
		await checkGiftCardBalance();
		if (!giftCardBalance.value || giftCardError.value) {
			return;
		}
	}

	const nextAmount = Math.min(
		flt(giftCardAmount.value || 0, currency_precision.value),
		giftCardBalance.value,
		getGiftCardRemainingAmount(),
	);

	if (nextAmount <= 0) {
		giftCardError.value = __("Gift card amount must be greater than zero.");
		return;
	}

	if (activeGiftCardPayment.value) {
		activeGiftCardPayment.value.amount = 0;
		if (activeGiftCardPayment.value.base_amount !== undefined) {
			activeGiftCardPayment.value.base_amount = 0;
		}
	}
	giftCardRedemptions.value = [
		{
			gift_card_code: giftCardCode.value,
			amount: nextAmount,
			cashier: currentCashier.value?.user || null,
		},
	];
	rebalancePreferredPaymentCoverage(nextAmount);
	giftCardInlineExpanded.value = false;
	giftCardDialogOpen.value = false;
};

const issueGiftCard = async () => {
	if (!currentCashier.value?.is_supervisor) {
		giftCardError.value = __("A POS supervisor is required for this action.");
		return;
	}
	giftCardLoading.value = true;
	giftCardError.value = "";
	try {
		const response = await frappe.call({
			method: "posawesome.posawesome.api.gift_cards.issue_gift_card",
			args: {
				pos_profile: pos_profile.value?.name,
				cashier: currentCashier.value?.user,
				company: pos_profile.value?.company,
				initial_amount: flt(giftCardAmount.value || 0, currency_precision.value),
				gift_card_code: giftCardCode.value || null,
				currency: invoice_doc.value?.currency || pos_profile.value?.currency,
			},
		});
		const card = response?.message || {};
		giftCardCode.value = card.gift_card_code || giftCardCode.value;
		giftCardBalance.value = flt(card.current_balance || 0, currency_precision.value);
		giftCardStatus.value = card.status || "Active";
		giftCardMode.value = "redeem";
	} catch (error) {
		giftCardError.value = error?.message || __("Unable to issue gift card.");
	}
	giftCardLoading.value = false;
};

const topUpGiftCard = async () => {
	if (!currentCashier.value?.is_supervisor) {
		giftCardError.value = __("A POS supervisor is required for this action.");
		return;
	}
	giftCardLoading.value = true;
	giftCardError.value = "";
	try {
		const response = await frappe.call({
			method: "posawesome.posawesome.api.gift_cards.top_up_gift_card",
			args: {
				pos_profile: pos_profile.value?.name,
				cashier: currentCashier.value?.user,
				gift_card_code: giftCardCode.value,
				amount: flt(giftCardAmount.value || 0, currency_precision.value),
			},
		});
		const card = response?.message || {};
		giftCardBalance.value = flt(card.current_balance || 0, currency_precision.value);
		giftCardStatus.value = card.status || "Active";
		giftCardMode.value = "redeem";
	} catch (error) {
		giftCardError.value = error?.message || __("Unable to top up gift card.");
	}
	giftCardLoading.value = false;
};

// Methods

const get_print_formats = async () => {
	const doctypes = resolvePaymentPrintFormatDoctypes({
		profile: pos_profile.value,
		invoiceType: invoiceType.value,
	});

	try {
		const responses = await Promise.all(
			doctypes.map((doctype) =>
				frappe.call({
					method: "posawesome.posawesome.api.print_formats.get_print_formats",
					args: { doctype },
				}),
			),
		);

		const mergedFormats = responses
			.flatMap((response) => response?.message || [])
			.map((pf) => (typeof pf === "object" && pf.name ? pf.name : pf))
			.filter(Boolean);

		print_formats.value = Array.from(new Set(mergedFormats));
		set_print_format();
	} catch (error) {
		console.error("Failed to fetch payment print formats", error);
		print_formats.value = [];
		set_print_format();
	}
};

const set_print_format = () => {
	print_format.value = resolvePaymentPrintFormat({
		profile: pos_profile.value,
		customerInfo: customer_info.value,
		availableFormats: print_formats.value,
	});
};

const releaseActiveFocus = () => {
	if (typeof document === "undefined") {
		return;
	}
	const active = document.activeElement;
	if (active instanceof HTMLElement && active !== document.body) {
		active.blur();
	}
};

const triggerSearchFocusRecovery = () => {
	nextTick(() => {
		uiStore.triggerItemSearchFocus();
		if (eventBus && typeof eventBus.emit === "function") {
			eventBus.emit("focus_item_search");
		}
	});
};

const queueSearchRefocusRecovery = () => {
	if (typeof window === "undefined") {
		triggerSearchFocusRecovery();
		return;
	}

	let fallbackTimer = null;
	let cleanupTimer = null;
	const recover = () => {
		triggerSearchFocusRecovery();
	};

	const cleanup = () => {
		window.removeEventListener("focus", onWindowFocus);
		if (fallbackTimer) {
			clearTimeout(fallbackTimer);
			fallbackTimer = null;
		}
		if (cleanupTimer) {
			clearTimeout(cleanupTimer);
			cleanupTimer = null;
		}
	};

	const onWindowFocus = () => {
		recover();
		cleanup();
	};

	window.addEventListener("focus", onWindowFocus);
	if (fallbackTimer) {
		clearTimeout(fallbackTimer);
		fallbackTimer = null;
	}
	fallbackTimer = setTimeout(() => {
		recover();
		cleanup();
	}, 900);
	if (cleanupTimer) {
		clearTimeout(cleanupTimer);
		cleanupTimer = null;
	}
	cleanupTimer = setTimeout(() => {
		cleanup();
	}, 10000);
};

// Two ways out of the payment view, and they land in different places.
//
// back_to_invoice() — the sale is DONE (submitted, cart possibly cleared).
// The next sale starts at item search, so Browse is right and the refocus
// recovery belongs here.
const back_to_invoice = () => {
	releaseActiveFocus();
	paymentVisible.value = false;
	if (paymentDialogOpen.value) {
		uiStore.closePaymentDialog();
	}
	if (activeView.value === "payment") {
		uiStore.setActiveView("items");
	}
	queueSearchRefocusRecovery();
};

// cancel_payment() — the cashier BACKED OUT with the sale still alive: the
// Cancel Payment button, or the phone-payment path that bounces to the
// customer form because there is no mobile number. They came from the cart
// and the cart still holds their items, so the cart is where they belong —
// not Browse with the item search autofocused and the Android keyboard up.
//
// The shell owns that transition: Pos.vue's showInvoicePanel sets the compact
// panel AND suppresses the activeView watcher that would otherwise force the
// selector straight back. Setting either half from here would race that
// watcher, so it is asked for over the bus instead.
const cancel_payment = ({ refocusSearch = true } = {}) => {
	releaseActiveFocus();
	paymentVisible.value = false;

	if (paymentDialogOpen.value) {
		// Desk: the cart never left the screen behind the overlay, so closing
		// the dialog already IS landing on the cart. Unchanged behaviour.
		uiStore.closePaymentDialog();
		if (refocusSearch) {
			queueSearchRefocusRecovery();
		}
		return;
	}

	if (activeView.value !== "payment") {
		return;
	}

	eventBus?.emit?.("show_invoice_panel");

	// The shell answers synchronously (mitt dispatches inline) and
	// showInvoicePanel moves activeView off "payment", so a handled event has
	// already landed by the time we look. Until the listener exists, fall
	// back to the old Browse exit rather than strand the cashier on a view
	// they asked to leave.
	if (activeView.value === "payment") {
		uiStore.setActiveView("items");
		if (refocusSearch) {
			queueSearchRefocusRecovery();
		}
	}
};

const finishSubmissionNavigation = (clearInvoice = false) => {
	const submittedType = invoiceType.value;
	back_to_invoice();
	if (clearInvoice) {
		addresses.value = [];
		invoiceStore.clear();
		invoiceStore.resetPostingDate();
		if (eventBus && typeof eventBus.emit === "function") {
			eventBus.emit("clear_invoice");
		}

		if (submittedType !== "Invoice") {
			invoiceType.value = "Invoice";
			if (eventBus && typeof eventBus.emit === "function") {
				eventBus.emit("reset_invoice_type_to_invoice");
			}
		}
	}
};

const buildProfilePaymentLines = () => {
	const profilePayments = Array.isArray(pos_profile.value?.payments) ? pos_profile.value.payments : [];

	return profilePayments
		.filter((payment) => payment?.mode_of_payment)
		.map((payment, index) => ({
			mode_of_payment: payment.mode_of_payment,
			amount: 0,
			base_amount: 0,
			account: payment.account,
			type: payment.type,
			default: payment.default === 1 || payment.default === true || index === 0 ? 1 : 0,
		}));
};

const syncPreferredPaymentToCurrentTotal = (doc = invoice_doc.value) => {
	if (
		!doc ||
		!Array.isArray(doc.payments) ||
		!doc.payments.length ||
		is_credit_sale.value ||
		is_credit_return.value
	) {
		return null;
	}
	// Once the cashier has set an amount, don't auto-overwrite it back to the
	// full total — that was wiping their entry when any other field changed.
	if (paymentsTouched.value) {
		return null;
	}

	const payments = doc.payments.filter((payment) => payment?.mode_of_payment);
	if (!payments.length) {
		return null;
	}

	const preferredPayment = resolvePreferredPaymentLine(doc, isCashLikePayment);
	if (!preferredPayment) {
		return null;
	}

	const otherMeaningfulPayments = payments.filter((payment) => {
		if (payment === preferredPayment) {
			return false;
		}
		return Math.abs(flt(payment.amount || 0, currency_precision.value)) > 0.0001;
	});

	if (otherMeaningfulPayments.length) {
		return preferredPayment;
	}

	const total = netInvoiceSettlementAmount.value;
	// For returns, cap the auto-filled refund at what was paid on the original
	// invoice (0 for an unpaid/credit invoice → recorded as a credit note).
	const normalizedTotal = resolveReturnDefaultAmount(doc, total);
	const conversionRate = flt(doc.conversion_rate || 1, currency_precision.value);

	payments.forEach((payment) => {
		if (payment !== preferredPayment) {
			payment.amount = 0;
			if (payment.base_amount !== undefined) {
				payment.base_amount = 0;
			}
		}
	});

	preferredPayment.amount = normalizedTotal;
	if (preferredPayment.base_amount !== undefined) {
		preferredPayment.base_amount = flt(normalizedTotal * conversionRate, currency_precision.value);
	}

	return preferredPayment;
};

const rebalancePreferredPaymentCoverage = (giftCardAmount = giftCardAppliedAmount.value) => {
	const doc = invoice_doc.value;
	if (
		!doc ||
		doc.is_return ||
		is_credit_sale.value ||
		!Array.isArray(doc.payments) ||
		!doc.payments.length
	) {
		return null;
	}

	return rebalancePreferredPaymentLine(doc, {
		precision: currency_precision.value,
		isCashLikePayment,
		loyaltyAmount: invoice_doc.value?.loyalty_amount || loyalty_amount.value,
		redeemedCustomerCredit: redeemed_customer_credit.value,
		giftCardAmount,
	});
};

const mergeProfilePaymentsIntoReturn = (doc) => {
	const profilePayments = buildProfilePaymentLines();
	if (!profilePayments.length) return;

	if (!Array.isArray(doc.payments)) {
		doc.payments = [];
	}

	const existingModes = new Set(doc.payments.map((p) => p?.mode_of_payment).filter(Boolean));

	profilePayments.forEach((pp) => {
		if (!existingModes.has(pp.mode_of_payment)) {
			doc.payments.push({
				mode_of_payment: pp.mode_of_payment,
				amount: 0,
				base_amount: 0,
				default: pp.default,
				account: pp.account,
				type: pp.type,
			});
		}
	});
};

const ensurePaymentLinesInitialized = (doc = invoice_doc.value) => {
	if (!doc) {
		return null;
	}

	if (!Array.isArray(doc.payments) || !doc.payments.length) {
		const fallbackPayments = buildProfilePaymentLines();
		if (fallbackPayments.length) {
			doc.payments = fallbackPayments;
		}
	}

	// The tender armed on the sale screen decides which line this screen opens
	// on (§11 item E → §12 item B). Before this call it was discarded, so the
	// chip strip cost a tap and bought nothing: PAGAR always landed on Efectivo.
	//
	// It runs HERE, above everything that fills an amount, because `default` is
	// what all four consumers read — the badge, the quick-cash denominations,
	// `primaryPaymentMethod` and `resolvePreferredPaymentLine`. Moving the flag
	// once keeps them agreeing; overriding them one at a time would not.
	// Nothing below changes: the same code fills, rounds, caps and splits the
	// same way, on the line the cashier chose instead of the one they did not.
	applyArmedPaymentPreference(doc.payments, peekArmedTender(), {
		isReturn: Boolean(doc.is_return),
		paymentsTouched: paymentsTouched.value,
	});

	// For returns, always show all profile payment methods so user can split refund
	// NOTE: the is_credit_return default is decided once when the return is loaded
	// (send_invoice_doc_payment handler), NOT here — so reopening the dialog or a
	// failed submit never overrides the cashier's manual toggle. Here we only
	// honour the current toggle state.
	if (doc.is_return) {
		mergeProfilePaymentsIntoReturn(doc);
		if (is_credit_return.value) {
			// Credit return: keep every payment row at 0 so it is recorded as a
			// credit note that reduces the customer's balance (no cash refund).
			doc.payments.forEach((payment) => {
				payment.amount = 0;
				if (payment.base_amount !== undefined) {
					payment.base_amount = 0;
				}
			});
			return null;
		}
	}

	const initializedPayment = initializePaymentLinesForDialog(
		doc,
		currency_precision.value,
		isCashLikePayment,
	);

	if (doc.is_return) {
		ensureReturnPaymentsAreNegative();
	}

	syncPreferredPaymentToCurrentTotal(doc);

	return initializedPayment;
};

// Default a return to "Store as Credit?" (is_credit_return) when the original
// invoice was not fully paid. For an unpaid (credit) invoice this avoids paying
// out cash that was never collected and instead reduces the customer's balance,
// while the toggle is visibly ON; a fully paid invoice keeps the normal cash
// refund. The cap comes from posa_refundable_amount (= amount paid on the
// original) set when the return is loaded; if unknown we leave behaviour as is.
const applyReturnCreditDefault = (doc) => {
	if (!doc || !doc.is_return) {
		return;
	}
	const refundable = doc.posa_refundable_amount;
	if (refundable === undefined || refundable === null) {
		return;
	}
	const returnTotal = Math.abs(flt(doc.rounded_total || doc.grand_total, currency_precision.value));
	const shouldCredit = flt(refundable, currency_precision.value) < returnTotal - 0.0001;
	is_credit_return.value = shouldCredit;
	is_cashback.value = !shouldCredit;
};

const restorePaymentLinesAfterFailedSubmit = () => {
	const doc = invoice_doc.value;
	if (!doc) {
		return;
	}

	ensurePaymentLinesInitialized(doc);
	is_credit_sale.value = false;
};

// NOTE: upstream's enableShortcutCreditSale (zero quick-cash → credit sale)
// was dropped — it belongs to the 8ce1752c credit-sale UI we skipped; our
// server-side _validate_credit_sale_allowed covers the invariant.
const focusSubmitButton = () => {
	const btn = submitButton.value;
	const el = btn && btn.$el ? btn.$el : btn;
	if (!el) {
		return false;
	}
	el.scrollIntoView?.({ behavior: "smooth", block: "center" });
	el.focus?.();
	highlightSubmit.value = true;
	return true;
};

const focusFirstPaymentTarget = () => {
	const root = paymentRoot.value;
	if (
		focusFirstKeyboardTarget(
			root,
			"[data-pos-keyboard-target='payment-amount'], [data-pos-keyboard-target='payment-action']",
		)
	) {
		highlightSubmit.value = false;
		return true;
	}

	return focusSubmitButton();
};

const handleShowPayment = () => {
	paymentVisible.value = true;
	nextTick(() => {
		setTimeout(() => {
			focusFirstPaymentTarget();
			if (queuedShortcutSubmit.value) {
				const payload = queuedShortcutSubmit.value;
				queuedShortcutSubmit.value = null;
				handleSubmitPaymentShortcut(payload || {});
			}
		}, 100);
	});
};

const handleCreditChangeUpdate = (value) => {
	setFormatedCurrency(credit_change, "value", null, false, value);
	updateCreditChange(credit_change.value);
};

const handleWriteOffAmountUpdate = (value) => {
	if (!invoice_doc.value) return;

	let nextAmount = flt(value || 0, currency_precision.value);
	const profileCap = writeOffProfileLimit.value;
	const diffCap = Math.max(diff_payment.value || 0, 0);
	const maxAmount = profileCap && profileCap > 0 ? Math.min(diffCap, profileCap) : diffCap;

	if (nextAmount < 0) {
		nextAmount = 0;
	}
	if (profileCap && profileCap > 0 && nextAmount > profileCap) {
		toastStore.show({
			title: __("Write off amount cannot exceed the POS profile maximum of {0}", [
				formatCurrency(profileCap),
			]),
			color: "error",
		});
		nextAmount = maxAmount;
	}
	if (nextAmount > maxAmount) {
		nextAmount = maxAmount;
	}

	invoice_doc.value.write_off_amount = nextAmount;
};

const handleRedemptionFormattedCurrency = (data) => {
	if (!data?.field) return;

	if (data.field === "loyalty_amount") {
		setFormatedCurrency(loyalty_amount, "value", null, false, data.value);
		return;
	}

	if (data.field === "redeemed_customer_credit") {
		setFormatedCurrency(redeemed_customer_credit, "value", null, false, data.value);
	}
};

const updateCreditChange = (rawValue) => {
	const changeLimit = Math.max(-diff_payment.value, 0);
	let requestedCredit = flt(Math.abs(rawValue) || 0, currency_precision.value);

	if (requestedCredit > changeLimit) {
		requestedCredit = changeLimit;
	}

	const remainingPaidChange = flt(changeLimit - requestedCredit, currency_precision.value);

	credit_change.value = requestedCredit;
	paid_change.value = remainingPaidChange;

	if (invoice_doc.value) {
		invoice_doc.value.credit_change = requestedCredit;
		invoice_doc.value.paid_change = remainingPaidChange;
	}
};

const handlePaymentAmountChange = (payment, event) => {
	paymentsTouched.value = true;
	last_payment_change_was_cash.value = isCashLikePayment(payment);
	setFormatedCurrency(payment, "amount", null, false, event);

	// For return invoices: user enters a positive number but we store it as negative (refund)
	if (invoice_doc.value?.is_return && payment.amount > 0) {
		payment.amount = -payment.amount;
	}
	if (payment.base_amount !== undefined) {
		const conversion_rate = invoice_doc.value.conversion_rate || 1;
		payment.base_amount = flt(payment.amount * conversion_rate, currency_precision.value);
	}
};

const setPaymentToDenomination = (payment, amount) => {
	paymentsTouched.value = true;
	payment.amount = amount;
	if (payment.base_amount !== undefined) {
		const conversion_rate = invoice_doc.value.conversion_rate || 1;
		payment.base_amount = flt(amount * conversion_rate, currency_precision.value);
	}
	last_payment_change_was_cash.value = isCashLikePayment(payment);
};

// UI Feedback Methods
const showPaidAmount = () => {
	toastStore.show({
		title: `Total Paid Amount: ${formatCurrency(total_payments.value)}`,
		color: "info",
	});
};

const creditSourceLabel = (row) => {
	if (!row) return "";
	const sourceLabel = row.source_type ? __(row.source_type) : null;
	if (sourceLabel) return `${sourceLabel}: ${row.credit_origin}`;
	return row.credit_origin;
};

const showDiffPayment = () => {
	if (!invoice_doc.value) return;
	toastStore.show({
		title: `To Be Paid: ${formatCurrency(
			diff_payment.value < 0 ? -diff_payment.value : diff_payment.value,
		)}`,
		color: "info",
	});
};

const showPaidChange = () => {
	toastStore.show({
		title: `Paid Change: ${formatCurrency(paid_change.value)}`,
		color: "info",
	});
};

// Background Check
const clearBackgroundStatusCheck = () => {
	if (backgroundStatusCheck.value) {
		clearTimeout(backgroundStatusCheck.value);
		backgroundStatusCheck.value = null;
	}
};

const resolveSubmittedDoctype = (doctype) => {
	if (doctype) return doctype;
	if (invoice_doc.value?.doctype) return invoice_doc.value.doctype;
	return pos_profile.value?.create_pos_invoice_instead_of_sales_invoice ? "POS Invoice" : "Sales Invoice";
};

const fetchSubmittedInvoiceDoc = async (invoiceName, doctype) => {
	const resolvedDoctype = resolveSubmittedDoctype(doctype);
	return frappe.db.get_doc(resolvedDoctype, invoiceName);
};

const waitForInvoiceSubmission = async (invoiceName, doctype) => {
	// 8 s ceiling: enough for a healthy bg submit + socket round-trip,
	// well below the operator's "is it hung?" patience window.
	// If the realtime event is missed (proxy hiccup, room subscribe
	// race, shim doc_subscribe failure, etc.) the catch path below
	// hits the DB and confirms docstatus — typically <500 ms. Total
	// worst case ~9 s vs the previous 45+ s hang (#150 follow-up).
	try {
		return await socketStore.waitForInvoiceProcessed(
			invoiceName,
			8000,
			resolveSubmittedDoctype(doctype),
		);
	} catch (error) {
		const result = await frappe.call({
			method: "frappe.client.get_value",
			args: {
				doctype: resolveSubmittedDoctype(doctype),
				filters: { name: invoiceName },
				fieldname: ["docstatus"],
			},
		});
		if (result?.message?.docstatus === 1) {
			return {
				status: "processed",
				doctype: resolveSubmittedDoctype(doctype),
			};
		}
		throw error;
	}
};

const runDeferredPrintWorkflow = async ({
	name,
	doctype,
	waitForPostSubmitPayments = false,
	waitForInvoiceProcessing = false,
}) => {
	if (!name) return;
	if (deferredPrintInFlight.has(name)) {
		try {
			track("warn:print_deferred_duplicate", 1, { invoice: name });
		} catch {
			// telemetry dispatch must never bubble
		}
		return;
	}
	deferredPrintInFlight.add(name);

	let resolvedDoctype = resolveSubmittedDoctype(doctype);

	let runPatientWait = null;

	try {
		if (waitForInvoiceProcessing) {
			// The bg submit can outlive the fast path (congested queue: prod
			// lag runs 45-230 s). Don't abandon the ticket — tell the operator
			// once and keep both channels open until it lands.
			let patientToastShown = false;
			runPatientWait = () => {
				// W3: BOTH entry points (fast-path miss below AND the
				// draft-after-fetch re-entry) must short-circuit on a failure
				// the server already reported — before the toast goes up.
				assertSubmitNotKnownFailed(socketStore.processedInvoices?.[name], name);
				if (!patientToastShown) {
					patientToastShown = true;
					toastStore.show({
						title: __("Sale is still processing — the ticket will print once it is confirmed."),
						color: "info",
						timeout: 6000,
					});
				}
				return waitForLateSubmission(name, resolvedDoctype, {
					waitForProcessed: (invoice, timeoutMs) =>
						socketStore.waitForInvoiceProcessed(invoice, timeoutMs, resolvedDoctype),
					getDocstatus: async (dt, invoice) => {
						try {
							const res = await frappe.call({
								method: "frappe.client.get_value",
								args: {
									doctype: dt,
									filters: { name: invoice },
									fieldname: ["docstatus"],
								},
							});
							const docstatus = res?.message?.docstatus;
							return typeof docstatus === "number" ? docstatus : null;
						} catch (_e) {
							return null; // transient — keep waiting
						}
					},
				});
			};
			let processedState;
			try {
				processedState = await waitForInvoiceSubmission(name, resolvedDoctype);
			} catch {
				// runPatientWait short-circuits with the server's real error
				// when the submit already failed (W3) — no wait for nothing.
				processedState = await runPatientWait();
			}
			resolvedDoctype = processedState?.doctype || resolvedDoctype;
		}

		if (waitForPostSubmitPayments) {
			// Same 8 s ceiling as waitForInvoiceSubmission. Payment-entry
			// creation is fast (no external IO); 8 s is generous. Falls
			// through silently — payment entries land in DB regardless.
			try {
				await socketStore.waitForPostSubmitPayments(name, 8000, resolvedDoctype);
			} catch (_e) {
				// Don't block print on missed payment-entry event;
				// receipt prints from invoice doc + DB-side payments.
			}
		}

		let freshDoc = await fetchSubmittedInvoiceDoc(name, resolvedDoctype);

		if (isOffline()) {
			await printOfflineInvoice(freshDoc);
			return;
		}

		// The FAST path resolves on socketStore's word, and socketStore
		// fabricates {status:"processed"} whenever the realtime socket is
		// down — the fetched doc is the truth. A draft here means the submit
		// job is still running: enter the patient wait rather than hand the
		// customer a receipt for an unrecorded sale (audit P1).
		if (runPatientWait && Number(freshDoc?.docstatus) !== 1) {
			const late = await runPatientWait();
			resolvedDoctype = late?.doctype || resolvedDoctype;
			freshDoc = await fetchSubmittedInvoiceDoc(name, resolvedDoctype);
		}

		// The background success path deliberately does NOT stamp the reprint
		// cache (its docstatus is still 0 there — backtrace B3); stamp here,
		// where the doc is confirmed submitted, so the navbar reprint serves
		// this sale instead of the previous one.
		if (Number(freshDoc?.docstatus) === 1) {
			uiStore.setLastInvoice(name);
		}

		await loadPrintPage({ doc: freshDoc, doctype: resolvedDoctype });
	} catch (error) {
		console.error("Deferred print failed", error);
		// Terminal event: every other print signal says an attempt was made
		// and how it went. This one says the ticket for a completed sale was
		// never printed at all — the pathology the whole deferred workflow
		// exists to prevent — so it is the number to alert on, not a ratio.
		try {
			track("warn:print_never_printed", 1, {
				invoice: name,
				reason: String(error?.message || "unknown").slice(0, 280),
				doctype: resolvedDoctype,
				waited_for_submit: Boolean(waitForInvoiceProcessing),
			});
		} catch {
			// telemetry dispatch must never bubble
		}
		// W5: a nameless failure left the operator with no next move — point
		// at the recovery path. Phrasing is conditional («once confirmed») so
		// the advice stays safe even when the sale never lands.
		toastStore.show({
			title: __("Unable to print submitted invoice"),
			color: "error",
			detail:
				error?.message ||
				`${__("Background processing did not finish in time.")} ${__(
					"Once the sale is confirmed, reprint the ticket from the menu: Print Last Invoice.",
				)}`,
		});
	} finally {
		deferredPrintInFlight.delete(name);
	}
};

const scheduleBackgroundStatusCheck = ({
	name,
	doctype,
	print = false,
	waitForPostSubmitPayments = false,
	waitForInvoiceProcessing = false,
} = {}) => {
	clearBackgroundStatusCheck();

	if (!name) {
		return;
	}

	if (print && (waitForInvoiceProcessing || waitForPostSubmitPayments)) {
		void runDeferredPrintWorkflow({
			name,
			doctype,
			waitForPostSubmitPayments,
			waitForInvoiceProcessing,
		});
	}

	if (waitForInvoiceProcessing) {
		return;
	}

	backgroundStatusCheck.value = setTimeout(async () => {
		try {
			const result = await frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: resolveSubmittedDoctype(doctype),
					filters: { name },
					fieldname: ["docstatus"],
				},
			});
			const status = result?.message?.docstatus;
			if (status === 1) {
				return;
			}
			const reason = __("Invoice is still in draft after background submission.");
			if (eventBus && typeof eventBus.emit === "function") {
				eventBus.emit("invoice_submission_failed", {
					invoice: name,
					reason,
				});
			}
			toastStore.show({
				title: __("Error submitting invoice: {0}", [name]),
				color: "error",
				detail: reason,
			});
		} catch (err) {
			console.error("Background status check failed", err);
		} finally {
			clearBackgroundStatusCheck();
		}
	}, 10000);
};

// Submission Wrapper
const submit = async (_event, payment_received = false, print = false) => {
	await submitInvoiceWrapper(print, undefined, {
		paymentReceived: payment_received,
	});
};

const submitInvoiceWrapper = async (print, callbackOverrides = {}, options = {}) => {
	if (submissionInFlight.value) {
		return;
	}

	submissionInFlight.value = true;
	loading.value = true;
	try {
		await validateSubmission(options.paymentReceived || false);
		// MP-INTEGRATION-POINT (sale checkout): hard gate — a MercadoPago Point
		// sale cannot finalize until the terminal approves the charge (or a
		// supervisor overrides). No-op when the connector is off / no MP amount.
		// Drop the loading overlay so the gate modal is interactive, restore after.
		loading.value = false;
		const mpTerminalOk = await mpPointGate.ensureChargedBeforeFinalize();
		loading.value = true;
		if (!mpTerminalOk) {
			return;
		}
		await submitInvoice(print, {
			// Immediate path only — see the note on the other onPrint above
			// (backtrace N1: the deferred branch here was unreachable).
			onPrint: (doc, printOptions = {}) => {
				if (print) {
					if (isOffline()) {
						printOfflineInvoice(doc);
					} else {
						loadPrintPage({
							doc,
							doctype: printOptions.doctype,
							name: printOptions.name,
						});
					}
				}
			},
			onSuccess: () => {
				customer_credit_dict.value = [];
				redeem_customer_credit.value = false;
				is_cashback.value = true;
				show_change_dialog.value = true;
				is_credit_return.value = false;
				sales_person.value = "";
			},
			onFinishNavigation: (clearInvoice) => {
				finishSubmissionNavigation(clearInvoice);
			},
			// Handed to the shell, not shown from here: in dialog mode this
			// component is behind a v-if and dies with the payment dialog that
			// onFinishNavigation closes moments later, taking any overlay it
			// owns with it. Pos.vue outlives both and centres the dialog over
			// the register in either payment mode. mitt dispatches inline, so
			// the shell has the amount before this instance goes away.
			onChangeDue: (payload) => {
				eventBus?.emit?.("show_change_due", payload);
			},
			onScheduleBackgroundCheck: (payload) => {
				scheduleBackgroundStatusCheck(payload);
			},
			...callbackOverrides,
		});
	} catch (error) {
		console.error("Submission failed propagate:", error);
		restorePaymentLinesAfterFailedSubmit();

		if (error?.message) {
			toastStore.show({
				title: error.message,
				color: "error",
			});
			frappe.utils.play_sound("error");
		}
	} finally {
		loading.value = false;
		submissionInFlight.value = false;
	}
};

// Keyboard Shortcuts
const handlePaymentShortcut = (event) => {
	if (event.defaultPrevented || submissionInFlight.value || loading.value) return;
	if (event.repeat) return;
	if (!paymentVisible.value) return;

	const isAltOnly = event.altKey && !event.ctrlKey && !event.metaKey;
	const key = event.key.toLowerCase();

	if (isAltOnly && key === "p") {
		event.preventDefault();
		event.stopPropagation();
		submit(null, false, true);
		return;
	}

	if ((isAltOnly || event.ctrlKey || event.metaKey) && key === "x") {
		event.preventDefault();
		event.stopPropagation();
		submit(null, false, false);
	}
};

const handleSubmitPaymentShortcut = ({ print = false } = {}) => {
	if (!paymentVisible.value || submissionInFlight.value || loading.value) return;
	nextTick(() => {
		submit(null, false, print);
	});
};

// MOVIL-COBRO-INTEGRATION-POINT — the phone keypad's COLLECT AND CLOSE.
// MovilCobroView captures {mode, amount} and emits an intent; every money
// decision stays HERE: which payment row, zeroing the other tenders (the
// same pattern set_full_amount uses), and the SAME submit the band shortcut
// rides, behind the same visibility and in-flight guards. A keyed amount is
// what the customer handed over — it may exceed the total, and change_due
// answers that exactly as it does for a typed amount. No keyed amount means
// exact tender: set_full_amount, as the desktop's own row tap does.
const handleMovilCollect = (payload = {}) => {
	if (!paymentVisible.value || submissionInFlight.value || loading.value) return;
	const doc = invoice_doc.value;
	const rows = Array.isArray(doc?.payments) ? doc.payments : [];
	if (!rows.length) return;
	const mode = typeof payload?.mode === "string" && payload.mode ? payload.mode : null;
	const row =
		(mode && rows.find((p) => p?.mode_of_payment === mode)) ||
		rows.find((p) => Number(p?.default)) ||
		rows[0];
	const isReturn = Boolean(doc?.is_return);
	const keyed = Number(payload?.amount);
	if (Number.isFinite(keyed) && keyed > 0 && !isReturn) {
		rows.forEach((p) => {
			if (p !== row) {
				p.amount = 0;
				if (p.base_amount !== undefined) p.base_amount = 0;
			}
		});
		row.amount = keyed;
		if (row.base_amount !== undefined) {
			row.base_amount = keyed;
		}
	} else {
		set_full_amount(row, isReturn);
	}
	nextTick(() => {
		submit(null, false, payload?.print !== false);
	});
};

const queueShortcutSubmit = (payload = {}) => {
	queuedShortcutSubmit.value = payload;
	if (isPaymentOpen.value) {
		nextTick(() => {
			setTimeout(() => {
				if (!queuedShortcutSubmit.value) {
					return;
				}
				const pendingPayload = queuedShortcutSubmit.value;
				queuedShortcutSubmit.value = null;
				handleSubmitPaymentShortcut(pendingPayload || {});
			}, 150);
		});
	}
};

// Watchers
watch(
	() => uiStore.posProfile,
	(p) => {
		if (p) {
			pos_profile.value = p;
			stock_settings.value = uiStore.stockSettings || {};
			get_mpesa_modes();
			get_print_formats();
			resetGiftCardState({ clearPayment: true });
		}
	},
	{ immediate: true },
);

// POS Settings ride uiStore (Pos.vue's get_pos_setting fetches them);
// the old "set_pos_settings" bus handoff was removed without wiring
// this side, so invoice_fields and the global return-validity fallback
// read {} forever.
watch(
	() => uiStore.posSettings,
	(doc) => {
		pos_settings.value = doc || {};
		if (invoice_doc.value && !invoice_doc.value.is_return) {
			initializeReturnValidity(invoice_doc.value);
		}
	},
	{ immediate: true },
);

watch(
	invoiceType,
	(data) => {
		get_print_formats();
		if (invoice_doc.value && data !== "Order") {
			invoice_doc.value.posa_delivery_date = null;
			invoice_doc.value.posa_notes = null;
			invoice_doc.value.posa_authorization_code = null;
			invoice_doc.value.shipping_address_name = null;
		} else if (invoice_doc.value && data === "Order") {
			new_delivery_date.value = formatDateDisplay(frappe.datetime.now_date());
			update_delivery_date();
		}
		if (invoice_doc.value && data === "Return") {
			invoice_doc.value.is_return = 1;
			ensureReturnPaymentsAreNegative();
			is_return.value = true;
			is_credit_return.value = false;
			return_valid_upto_date.value = null;
		} else if (invoice_doc.value) {
			invoice_doc.value.is_return = 0;
			is_return.value = false;
			is_credit_return.value = false;
			return_valid_upto_date.value = null;
			restoreReturnPayments();
		}
	},
	{ immediate: true },
);

watch(diff_payment, (newVal) => {
	if (is_user_editing_paid_change.value) return;

	const lastEditWasCash = last_payment_change_was_cash.value;

	if (newVal < 0) {
		const changeDue = -newVal;
		if (lastEditWasCash === false) {
			paid_change.value = flt(changeDue, currency_precision.value);
			credit_change.value = 0;
		} else {
			paid_change.value = changeDue;
		}
	} else {
		updateCreditChange(0);
	}

	last_payment_change_was_cash.value = null;
});

watch(paid_change, (newVal) => {
	const changeLimit = Math.max(-diff_payment.value, 0);
	if (newVal > changeLimit) {
		paid_change.value = changeLimit;
		credit_change.value = 0;
		paid_change_rules.value = ["Paid change can not be greater than total change!"];
	} else {
		paid_change_rules.value = [];
		credit_change.value = flt(changeLimit - newVal, currency_precision.value);
	}

	const effectivePaid = Math.min(paid_change.value, changeLimit);
	const creditAmount = flt(changeLimit - effectivePaid, currency_precision.value);

	if (invoice_doc.value) {
		invoice_doc.value.paid_change = effectivePaid;
		invoice_doc.value.credit_change = creditAmount > 0 ? creditAmount : 0;
	}
});

watch(loyalty_amount, (value) => {
	if (!invoice_doc.value) return;
	const amount = parseFloat(value) || 0;
	if (amount > available_points_amount.value + 0.001) {
		invoice_doc.value.loyalty_amount = 0;
		invoice_doc.value.redeem_loyalty_points = 0;
		invoice_doc.value.loyalty_points = 0;
		loyalty_amount.value = 0;
		toastStore.show({
			title: `Loyalty Amount can not be more than ${available_points_amount.value}`,
			color: "error",
		});
	} else {
		invoice_doc.value.loyalty_amount = flt(loyalty_amount.value);
		invoice_doc.value.redeem_loyalty_points = 1;

		let baseAmount = amount;
		const docCurrency = invoice_doc.value.currency;
		const baseCurrency = pos_profile.value.currency;

		if (docCurrency && baseCurrency && docCurrency !== baseCurrency) {
			baseAmount = amount * (invoice_doc.value.conversion_rate || 1);
		}

		invoice_doc.value.loyalty_points = parseInt(
			baseAmount / (customer_info.value.conversion_factor || 1),
		);

		rebalancePreferredPaymentCoverage();
	}
});

watch(redeemed_customer_credit, () => {
	rebalancePreferredPaymentCoverage();
});

watch(sales_person, (newVal) => {
	if (!invoice_doc.value) return;
	if (newVal) {
		invoice_doc.value.sales_team = [
			{
				sales_person: newVal,
				allocated_percentage: 100,
			},
		];
	} else {
		invoice_doc.value.sales_team = [];
	}
});

watch(is_credit_sale, (newVal) => {
	if (!invoice_doc.value || !Array.isArray(invoice_doc.value.payments)) return;

	const doc = invoice_doc.value;
	const conversionRate = doc.conversion_rate || 1;

	if (newVal) {
		// Credit sale ON: snapshot the cashier's amounts so toggling back
		// restores them, then clear (a credit sale is unpaid up front).
		paymentSnapshotBeforeCredit = doc.payments.map((p) => ({
			mode_of_payment: p.mode_of_payment,
			amount: flt(p.amount, currency_precision.value),
			base_amount: p.base_amount,
		}));
		doc.payments.forEach((payment) => {
			payment.amount = 0;
			if (payment.base_amount !== undefined) {
				payment.base_amount = 0;
			}
		});
		return;
	}

	// Credit sale OFF.
	const snap = paymentSnapshotBeforeCredit;
	paymentSnapshotBeforeCredit = null;
	const hadEntry = Array.isArray(snap) && snap.some((s) => Math.abs(s.amount) > 0.0001);

	if (hadEntry) {
		// Restore exactly what the cashier had typed before toggling credit.
		doc.payments.forEach((payment) => {
			const s = snap.find((x) => x.mode_of_payment === payment.mode_of_payment);
			if (s) {
				payment.amount = s.amount;
				if (payment.base_amount !== undefined) {
					payment.base_amount =
						s.base_amount !== undefined
							? s.base_amount
							: flt(s.amount * conversionRate, currency_precision.value);
				}
			}
		});
		return;
	}

	// No prior entry → default the preferred method to the full total.
	if (doc.payments.length) {
		const amount = flt(doc.rounded_total || doc.grand_total, currency_precision.value);
		doc.payments.forEach((payment) => {
			payment.amount = 0;
			if (payment.base_amount !== undefined) payment.base_amount = 0;
		});
		const defaultPayment =
			doc.payments.find((payment) => payment.default === 1) ||
			doc.payments.find((payment) => isCashLikePayment(payment)) ||
			doc.payments[0];

		if (defaultPayment) {
			defaultPayment.amount = amount;
			if (defaultPayment.base_amount !== undefined) {
				defaultPayment.base_amount = flt(amount * conversionRate, currency_precision.value);
			}
		}
	}
});

watch(is_credit_return, (newVal) => {
	if (!invoice_doc.value) return;
	if (newVal) {
		is_cashback.value = false;
		invoice_doc.value.payments.forEach((payment) => {
			payment.amount = 0;
			if (payment.base_amount !== undefined) {
				payment.base_amount = 0;
			}
		});
	} else {
		is_cashback.value = true;
		ensureReturnPaymentsAreNegative();
	}
});

// Keep "Cashback?" and "Store as Credit?" mutually exclusive for a return.
// The is_credit_return watch already flips is_cashback; this mirrors the other
// direction so toggling cashback also updates credit (you can't enable both).
// The reciprocal set lands on a value that is already correct, so the watches
// settle without looping.
watch(is_cashback, (newVal) => {
	if (!invoice_doc.value || !invoice_doc.value.is_return) return;
	const shouldCredit = !newVal;
	if (is_credit_return.value !== shouldCredit) {
		is_credit_return.value = shouldCredit;
	}
});

watch(
	() => invoice_doc.value.customer,
	(customer, previous) => {
		if (customer && customer !== previous) {
			get_addresses();
			set_print_format();
		} else if (!customer) {
			addresses.value = [];
			set_print_format();
		}
	},
);

watch(isPaymentOpen, (isOpen) => {
	if (isOpen) {
		restaurantTipAmount.value = 0;
		lastAppliedRestaurantTip = 0;
		captureRestaurantTipBaseTotals();
		ensurePaymentLinesInitialized();
		handleShowPayment();
		// The panel only has a box to measure once it is on screen.
		nextTick(scheduleShellMeasure);
	} else {
		restaurantTipAmount.value = 0;
		applyRestaurantTipTotal();
		restaurantTipBaseTotals = null;
		lastAppliedRestaurantTip = 0;
		releaseActiveFocus();
		paymentVisible.value = false;
		highlightSubmit.value = false;
		queuedShortcutSubmit.value = null;
		giftCardDialogOpen.value = false;
		// Next sale starts as a sheet again, not wherever this one was left.
		moreMethodsOpen.value = false;
		breakdownOpen.value = false;
		cobroDetailsOpen.value = false;
	}
});

watch(restaurantTipAmount, applyRestaurantTipTotal);

watch(
	() => invoice_doc.value.posa_delivery_date,
	(date) => {
		if (!date) {
			if (invoice_doc.value) {
				invoice_doc.value.shipping_address_name = null;
			}
			addresses.value = [];
			return;
		}
		if (invoice_doc.value && invoice_doc.value.customer) {
			get_addresses();
		}
	},
);

watch(customerInfo, (newInfo) => {
	customer_info.value = newInfo || "";
	set_print_format();
});

watch(selectedCustomer, (newCustomer, oldCustomer) => {
	if (newCustomer === oldCustomer) return;
	customer_credit_dict.value = [];
	redeem_customer_credit.value = false;
	is_cashback.value = true;
	is_credit_return.value = false;
	loyalty_amount.value = 0;
	resetGiftCardState({ clearPayment: true });

	if (invoice_doc.value) {
		invoice_doc.value.loyalty_amount = 0;
		invoice_doc.value.redeem_loyalty_points = 0;
		invoice_doc.value.loyalty_points = 0;
	}
});

const applyIncomingInvoiceDoc = (doc) => {
	if (!doc) {
		return;
	}
	invoiceStore.setInvoiceDoc(doc);
	paid_change.value = flt(doc.paid_change || 0, currency_precision.value);
	credit_change.value = flt(doc.credit_change || 0, currency_precision.value);
	last_payment_change_was_cash.value = null;
	is_credit_sale.value = false;
	is_write_off_change.value = false;
	// Fresh invoice → allow auto-default again.
	paymentsTouched.value = false;
	paymentSnapshotBeforeCredit = null;

	// Decide the credit-return default ONCE, when the return is first
	// loaded, so reopening the dialog / a failed submit never overrides a
	// manual toggle change by the cashier.
	if (doc.is_return) {
		applyReturnCreditDefault(doc);
	}

	const initializedPayment = ensurePaymentLinesInitialized(doc);

	if (doc.is_return) {
		is_return.value = true;
		// is_credit_return default was applied above on load; don't override.
	} else if (initializedPayment) {
		is_credit_return.value = false;
	}
	initializeReturnValidity(doc);
	loyalty_amount.value = 0;
	redeemed_customer_credit.value = 0;
	resetGiftCardState({ clearPayment: true });
	if (doc.customer) {
		get_addresses();
	}
	get_sales_person_names();
};

// Lifecycle
// mitt's off(event) with NO handler removes EVERY handler for that event —
// including other components'. This panel mounts/unmounts on every payment
// dialog open/close; keep named refs and always pass them to off().
const onNetworkOnline = () => syncStore.syncPendingInvoices();
const onAddTheNewAddress = (data) => {
	const normalized = normalizeAddress(data);
	if (normalized) {
		const existing = addresses.value.filter((addr) => addr.name !== normalized.name);
		addresses.value = [...existing, normalized];
		if (invoice_doc.value) {
			invoice_doc.value.shipping_address_name = normalized.name;
		}
	}
};
const onSetMpesaPayment = (data) => {
	set_mpesa_payment(data);
};
const onClearInvoice = () => {
	invoiceStore.clear();
	invoiceStore.resetPostingDate();
	paymentsTouched.value = false;
	paymentSnapshotBeforeCredit = null;
	is_return.value = false;
	is_credit_return.value = false;
	return_valid_upto_date.value = null;
	resetGiftCardState({ clearPayment: true });
};

onMounted(() => {
	_shortcutHandlers.value.handlePaymentShortcut = handlePaymentShortcut.bind(this);
	document.addEventListener("keydown", _shortcutHandlers.value.handlePaymentShortcut);

	measureShell();
	nextTick(scheduleShellMeasure);
	window.addEventListener("resize", scheduleShellMeasure);
	window.addEventListener("orientationchange", scheduleShellMeasure);

	syncStore.syncPendingInvoices();
	eventBus.on("network-online", onNetworkOnline);
	eventBus.on("server-online", onNetworkOnline);

	if (eventBus) {
		eventBus.on("send_invoice_doc_payment", applyIncomingInvoiceDoc);
		eventBus.on("add_the_new_address", onAddTheNewAddress);
		eventBus.on("set_mpesa_payment", onSetMpesaPayment);
		eventBus.on("queue_submit_payment_shortcut", queueShortcutSubmit);
		eventBus.on("movil_collect_payment", handleMovilCollect);
		eventBus.on("clear_invoice", onClearInvoice);
	}

	if (isPaymentOpen.value) {
		// This panel is an async component mounted behind v-if, so on the
		// first open of a session the "send_invoice_doc_payment" event can
		// fire while the chunk is still loading — before our listener exists.
		// Recover the doc from the store so the default payment line is not
		// left blank.
		const storeDoc = invoice_doc.value;
		if (storeDoc && Array.isArray(storeDoc.payments) && storeDoc.payments.length) {
			applyIncomingInvoiceDoc(storeDoc);
		}
		handleShowPayment("true");
	}
});

onBeforeUnmount(() => {
	eventBus.off("send_invoice_doc_payment", applyIncomingInvoiceDoc);
	eventBus.off("add_the_new_address", onAddTheNewAddress);
	eventBus.off("set_mpesa_payment", onSetMpesaPayment);
	eventBus.off("queue_submit_payment_shortcut", queueShortcutSubmit);
	eventBus.off("movil_collect_payment", handleMovilCollect);
	eventBus.off("clear_invoice", onClearInvoice);
	eventBus.off("network-online", onNetworkOnline);
	eventBus.off("server-online", onNetworkOnline);
	clearBackgroundStatusCheck();

	window.removeEventListener("resize", scheduleShellMeasure);
	window.removeEventListener("orientationchange", scheduleShellMeasure);
	if (shellMeasureFrame) {
		cancelAnimationFrame(shellMeasureFrame);
		shellMeasureFrame = null;
	}

	if (_shortcutHandlers.value.handlePaymentShortcut) {
		document.removeEventListener("keydown", _shortcutHandlers.value.handlePaymentShortcut);
	}
});

defineExpose({
	focusFirstPaymentTarget,
});
</script>

<style scoped>
/* Remove readonly styling */
.v-text-field--readonly {
	cursor: text;
}

.v-text-field--readonly:hover {
	background-color: transparent;
}

.cards {
	background-color: var(--pos-surface-muted) !important;
}

.payment-shell {
	padding: 0;
}

.payment-shell--dialog {
	height: calc(100dvh - 48px);
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-2);
}

.payment-card {
	padding: var(--pos-space-2);
}

.payment-card--dialog {
	flex: 1 1 auto;
	min-height: 0;
	height: auto;
	max-height: none;
	margin-top: 0;
	display: flex;
	flex-direction: column;
}

.payment-scroll {
	padding: var(--pos-space-3);
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-3);
	flex: 1 1 auto;
	min-height: 0;
}

.payment-sections {
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-3);
}

.payment-sections--dialog {
	display: grid;
	grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
	gap: var(--pos-space-2);
	align-items: start;
	grid-template-areas:
		"readiness readiness"
		"summary adjustments"
		"methods adjustments"
		"settlement adjustments"
		"settlement meta";
}

/* The dialog lays its sections out by NAME, so an unplaced child would be
   auto-placed into the first free cell and shove the summary out of it. The
   header owns a full-width row of its own above them. */
.payment-sections--dialog .payment-readiness {
	grid-area: readiness;
}

/* A thirty-line ticket must not push the payment methods below the fold —
   they sit in the row under the summary in the dialog's left column. The
   card is capped and its own list scrolls inside it, which is what
   `.pay-summary__lines` (flex:1, min-height:0, overflow-y:auto) was built
   for; it just never had a bounded parent until now. */
.payment-sale-summary {
	max-height: 34vh;
}

.payment-section {
	background: var(--pos-surface-muted);
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md);
	padding: var(--pos-space-3);
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-3);
}

.payment-sections--dialog .payment-section {
	padding: 10px;
	gap: 10px;
}

.payment-sections--dialog .payment-section--summary {
	grid-area: summary;
}

.payment-sections--dialog .payment-section--methods {
	grid-area: methods;
}

.payment-sections--dialog .payment-section--settlement {
	grid-area: settlement;
}

.payment-sections--dialog .payment-section--adjustments {
	grid-area: adjustments;
}

.payment-sections--dialog .payment-section--meta {
	grid-area: meta;
}

/* ── Cobro — the hosted payment surface (build plan §14.2) ────────────────
   The artboard's three columns, laid over the sections this screen already
   has rather than over a second markup tree. Column one is the money's WHY
   (the ticket and its totals), two is the HOW (the pad and the method rows a
   split is typed into), three is the PAPER (the outcome, print, the tail).
   The band below owns the one number and the one action, so nothing here
   draws a primary of its own.

   ── WHAT KEEPS IT ON ONE SCREEN, AND WHY IT IS NOT `fr` ROWS ──────────────
   The previous round bounded every row with `fr` and made each section its
   own scrollport. That is a correct way to stop a grid overflowing and a
   wrong way to build a control panel: four scrollbars appeared, half of them
   cutting a control in two (the numpad's «4 5 6» row, an amount field), and
   the owner rejected it — «why so many scrolls? it has to feel like one
   coherent ops control panel».

   So the rows are sized by their CONTENT, and one region gives:

     · the ticket's LINE LIST scrolls (`.pay-summary__lines`), because a
       fifty-line ticket has no other honest answer;
     · the PAD stretches (`minmax(0, 1fr)` on the tender row, and
       `CobroTenderPad` hands the slack to the keypad grid), so the column
       fills a 1080px-tall screen and compresses on an 800px one;
     · everything else — totals footer, method rows, change readout, buttons —
       is content-height and small enough to fit at 1280×800.

   `More options` is the one state that cannot fit: it unfolds three legacy
   form sections into a fourth row, so the SURFACE scrolls as one instead
   (`.payment-scroll--flow`). One scrollbar, only while the cashier asked for
   the fields behind it.

   Only ever above 1100px: `Pos.vue` hosts this when the rail is visible, and
   the rail's step and `COMPACT_PAYMENT_WIDTH` are the same 1100. */
.payment-shell--cobro {
	height: 100%;
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-2);
	overflow: hidden;
}

.payment-card--cobro {
	flex: 1 1 auto;
	min-height: 0;
	height: auto;
	max-height: none;
	margin-top: 0;
	display: flex;
	flex-direction: column;
}

/* The surface does not scroll while the panel fits, which is its default and
   the state a cashier lives in. `--flow` is the disclosure open: the fourth
   row of legacy forms cannot fit, so the whole surface becomes ONE scrollport
   rather than the columns becoming four. Declared after `--cobro` because the
   two tie on specificity and this one has to win. */
.payment-scroll--cobro {
	overflow: hidden;
}

.payment-scroll--flow {
	overflow-y: auto;
}

.payment-sections--cobro {
	display: grid;
	/* `Cobro.dc.html` measures 384 / flexible / 316 inside a 1344 content area.
	   Stated as shares rather than pixels so the same proportion survives a
	   1280 counter monitor and a 1920 one. */
	grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 0.85fr);
	/*
	 * THE EXPANDED shape. `More options` is open, so the panel keeps a floor
	 * (a 420px row is still a usable pad and a readable ticket) and the legacy
	 * row below it takes whatever height its forms need — the surface scrolls.
	 */
	grid-template-rows: auto minmax(420px, auto) auto auto auto;
	gap: var(--pos-space-2);
	/* `stretch`, not `start`: the ticket card and the change card fill the
	   height their column was given instead of floating at the top of it. */
	align-items: stretch;
	flex: 0 0 auto;
	min-height: 0;
	grid-template-areas:
		"readiness readiness readiness"
		"summary tender paper"
		"summary methods paper"
		"tip tip tip"
		"adjustments settlement meta";
}

/*
 * THE PANEL, folded — what the surface looks like the moment PAGAR is pressed.
 *
 * The three legacy sections are `display: none` here, so they are not grid
 * items at all and the fifth row simply does not exist. The panel row takes
 * the remaining height (`minmax(0, 1fr)`) and the grid fills its box exactly:
 * nothing to scroll, nothing clipped.
 */
.payment-sections--cobro-lean {
	grid-template-rows: auto minmax(0, 1fr) auto auto;
	grid-template-areas:
		"readiness readiness readiness"
		"summary tender paper"
		"summary methods paper"
		"tip tip tip";
	flex: 1 1 auto;
}

/*
 * The restaurant tip strip is the one child of this list that is not a
 * `payment-section`, so without an area of its own it would be AUTO-PLACED —
 * into an implicit row, which is the one way this grid can still overflow the
 * box it is clipped to. Full width and last: it is a decision about the whole
 * ticket, and the register that never draws it collapses the row to nothing.
 */
.payment-sections--cobro .restaurant-tip {
	grid-area: tip;
}

/* Same rule as the dialog: an unplaced child would be auto-placed into the
   first free cell and shove a named section out of it. */
.payment-sections--cobro .payment-readiness {
	grid-area: readiness;
}

/*
 * NO SCROLLPORT HERE. A section is a bare column of cards on this surface —
 * the card chrome belongs to what is inside it, and a card inside a card is
 * the density the panel exists to remove. `min-height: 0` stays because a
 * grid item defaults to `min-height: auto` and would refuse to let the pad
 * compress.
 */
.payment-sections--cobro .payment-section {
	background: transparent;
	border: 0;
	padding: 0;
	gap: var(--reg-space-md, 10px);
	min-height: 0;
}

/* The tail's three sections are FORMS, not cards of their own, so they keep
   the panel chrome the rest of the screen gives up. */
.payment-sections--cobro .payment-section--adjustments,
.payment-sections--cobro .payment-section--settlement,
.payment-sections--cobro .payment-section--meta {
	background: var(--pos-surface-muted);
	border: 1px solid var(--pos-border-light);
	border-radius: var(--pos-radius-md);
	padding: 10px;
	gap: 10px;
}

.payment-sections--cobro .payment-section--summary {
	grid-area: summary;
}

.payment-sections--cobro .payment-section--tender {
	grid-area: tender;
}

.payment-sections--cobro .payment-section--paper {
	grid-area: paper;
}

.payment-sections--cobro .payment-section--methods {
	grid-area: methods;
}

.payment-sections--cobro .payment-section--adjustments {
	grid-area: adjustments;
}

.payment-sections--cobro .payment-section--settlement {
	grid-area: settlement;
}

.payment-sections--cobro .payment-section--meta {
	grid-area: meta;
}

/* These two only ever exist under `--cobro` (both are `v-if="cobroMode"`), so
   the bare treatment is stated once rather than scoped twice. */
.payment-section--tender,
.payment-section--paper {
	background: transparent;
	border: 0;
	padding: 0;
}

/* The ticket has a whole column to itself here, and the column is bounded by
   its own grid row — so the cap that the dialog needs is not only unnecessary,
   it would leave the card short of the cell it is supposed to fill. THE ONE
   PERMITTED SCROLLPORT on this surface is inside it: `.pay-summary__lines`,
   which is what that element was built for. */
.payment-sections--cobro .payment-sale-summary {
	max-height: none;
	flex: 1 1 auto;
	min-height: 0;
}

/* The pad is the elastic half of column two; the method rows below are sized
   by their content, so the two together fill the column exactly. */
.payment-sections--cobro .payment-section--tender {
	min-height: 0;
}

/* A normal button, not a bordered rectangle with a word floating in it. The
   paper column's actions sit at the size any other secondary action gets. */
.payment-cobro-print {
	min-height: var(--reg-touch-min, 44px);
	flex: none;
}

.payment-sections--cobro .payment-disclosure {
	flex: none;
}

/*
 * BELOW THE HEIGHT THE PANEL IS DESIGNED FOR.
 *
 * The mandate is zero scrollports at 1280×800 and the panel meets it —
 * measured on the real box model in headless chromium, the numpad's keys
 * resolve to 45px with three tenders on the ticket and 58px with two, and no
 * region overflows at any of 1280×800, 1280×900, 1718×1023 or 1920×1080.
 * (`CobroMethodRows` carries the other half of that measurement: below 900px
 * of viewport the method list packs into columns, which is what buys the pad
 * those twelve points.)
 *
 * Under roughly 740px, though, the pad would keep shrinking past the point of
 * being a pad. Something has to give there, and CLIPPING a control is the one
 * answer worse than a scrollbar — so the panel keeps a floor and the surface
 * scrolls as ONE, the same mechanism `More options` already uses.
 */
@media (max-height: 739px) {
	.payment-scroll--cobro {
		overflow-y: auto;
	}

	.payment-sections--cobro-lean {
		grid-template-rows: auto minmax(440px, auto) auto auto;
		flex: 0 0 auto;
	}
}

.payment-section--summary {
	background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.08) 0%, var(--pos-surface-muted) 100%);
}

.payment-section__header {
	display: flex;
	flex-direction: column;
	gap: 0;
}

.payment-section__subsection {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding-top: var(--pos-space-1);
	border-top: 1px solid var(--pos-border-light);
}

.payment-section__title {
	margin: 0;
	font-size: 1rem;
	font-weight: 700;
	line-height: 1.2;
	color: var(--pos-text-primary);
}

.payment-section__title--subsection {
	font-size: 0.92rem;
}

/* Phone-only headline: the amount to charge, big enough to read at arm's
   length. Rendered behind `compactPaymentLayout`, so desk never sees it. */
.payment-total-strip {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: var(--pos-space-2);
	padding: 10px 12px;
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-raised);
	border: 1px solid var(--pos-border-light);
}

.payment-total-strip__label {
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--pos-text-secondary);
}

.payment-total-strip__amount {
	font-size: 1.35rem;
	font-weight: 800;
	line-height: 1.1;
	color: var(--pos-text-primary);
}

/* Shared disclosure row (more methods / full breakdown). Dashed edge so it
   reads as "there is more here", not as another action button competing with
   the money buttons in the bar. */
.payment-disclosure {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-height: 44px;
	padding: 0 12px;
	/* --pos-border, not --pos-border-light: at 6% the dashed edge reads as a
	   rendering artefact in dark mode instead of an affordance. The label and
	   chevron carry the contrast; the border only frames them. */
	border: 1px dashed var(--pos-border);
	border-radius: var(--pos-radius-sm);
	background: var(--pos-surface-raised);
	color: var(--pos-text-primary);
	font-size: 0.86rem;
	font-weight: 700;
	text-align: start;
	cursor: pointer;
	transition:
		border-color 0.18s ease,
		background-color 0.18s ease;
}

.payment-disclosure:hover,
.payment-disclosure:focus-visible {
	border-color: rgba(var(--v-theme-primary), 0.55);
	background: rgba(var(--v-theme-primary), 0.06);
}

.payment-disclosure__label {
	min-width: 0;
}

.payment-disclosure__count {
	margin-inline-start: auto;
	min-width: 22px;
	padding: 2px 8px;
	border-radius: 999px;
	background: rgba(var(--v-theme-primary), 0.12);
	color: rgb(var(--v-theme-primary));
	font-size: 0.78rem;
	text-align: center;
}

.payment-more-methods {
	display: flex;
	flex-direction: column;
	gap: var(--pos-space-2);
}

:deep(.payment-section .v-divider) {
	display: none;
}

:deep(.payment-section .v-field) {
	border-radius: var(--pos-radius-sm);
}

.payment-footer {
	flex: 0 0 auto;
	position: sticky;
	bottom: 0;
	z-index: 8;
	padding-top: 8px;
	background: linear-gradient(180deg, rgba(255, 255, 255, 0), var(--pos-surface) 30%);
}

.payment-footer--dialog {
	margin-top: 0;
}

:deep(.payment-footer--dialog .cards) {
	margin-top: 0 !important;
}

:deep(.payment-footer--dialog .v-btn) {
	min-height: 42px;
}

:deep(.payment-shell--dialog .payment-methods) {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--pos-space-2);
}

:deep(.payment-shell--dialog .payment-method-card) {
	padding: 10px;
	gap: 10px;
}

:deep(.payment-shell--dialog .payment-summary-grid),
:deep(.payment-shell--dialog .invoice-totals-grid),
:deep(.payment-shell--dialog .payments),
:deep(.payment-shell--dialog .selection-fields .v-row) {
	row-gap: 6px;
}

:deep(.payment-shell--dialog .selection-fields p) {
	display: none;
}

:deep(.payment-shell--dialog .payment-summary-grid .v-col),
:deep(.payment-shell--dialog .invoice-totals-grid .v-col),
:deep(.payment-shell--dialog .payments .v-col),
:deep(.payment-shell--dialog .selection-fields .v-col) {
	padding-top: 2px;
	padding-bottom: 2px;
}

:deep(.payment-shell--dialog .payment-section .v-field__input) {
	min-height: 34px;
	padding-top: 4px;
	padding-bottom: 4px;
}

:deep(.payment-shell--dialog .payment-section .v-label) {
	font-size: 0.78rem;
}

:deep(.payment-shell--dialog .payment-section .v-input) {
	font-size: 0.86rem;
}

:deep(.payment-shell--dialog .v-switch) {
	margin-top: 0;
	margin-bottom: 0;
}

:deep(.payment-shell--dialog .v-switch .v-label) {
	font-size: 0.82rem;
}

.pos-themed-card {
	background-color: rgb(var(--v-theme-surface));
	color: rgb(var(--v-theme-on-surface));
}

@media (max-width: 768px) {
	.payment-shell {
		display: flex;
		flex-direction: column;
		gap: var(--pos-space-2);
	}

	.payment-card {
		padding: var(--pos-space-1);
	}

	.payment-shell--dialog {
		height: auto;
	}

	.payment-scroll {
		padding: var(--pos-space-2);
		gap: var(--pos-space-2);
	}

	.payment-sections {
		overflow: visible;
	}

	.payment-sections--dialog {
		grid-template-columns: 1fr;
	}

	:deep(.payment-shell--dialog .payment-methods) {
		grid-template-columns: 1fr;
	}

	.payment-section {
		padding: var(--pos-space-2);
		gap: var(--pos-space-2);
	}
}

/* ── Compact payment sheet ────────────────────────────────────────────────
   Below 992px Pos.vue renders this panel inline (the dialog is >=992px only),
   and it used to grow to full content height with the DOCUMENT as its
   scrollport. `.payment-footer` was position:sticky, so instead of holding
   the bottom it was pulled UP off the end of that long panel and drew as a
   band floating mid-screen, with the rest of the card still rendering
   underneath it and the dock below that (Marco, phone screenshots
   2026-08-10). A shorter bar (52cd77a6a) made the band smaller, not absent —
   the mechanism was untouched.

   The mechanism is what changes here: the panel becomes a height-constrained
   flex column whose MIDDLE scrolls, with the action bar as a flex sibling
   BELOW the scrollport. That is what the dialog variant already does, and
   what ClosingDialog does with v-card-actions outside v-card-text. Nothing
   can render under the bar because there is no "under" left — the content is
   inside an overflow box that stops where the bar starts.

   Last block in the file on purpose: several rules here tie on specificity
   with the phone block above, and the sheet has to win those ties. */
@media (max-width: 1099px) {
	.payment-shell--anchored {
		display: flex;
		flex-direction: column;
		gap: 0;
		/* Measured top offset (JS, republished on resize) minus the dock the
		   rest of the shell already reserves via --bottom-safe-space. */
		height: calc(var(--payment-shell-space, calc(100dvh - 96px)) - var(--bottom-safe-space, 0px) - 4px);
		min-height: 240px;
		overflow: hidden;
	}

	.payment-shell--anchored .payment-card {
		/* v-card is display:block by default — without this the scroll child's
		   flex/min-height mean nothing, it grows to full content height and the
		   card's overflow just CLIPS it: no scrolling, every method below the
		   fold unreachable (prod report 2026-08-10, "can't scroll, no card or
		   mercadopago"). The card must be a flex column for the scrollport's
		   constraint to exist at all. */
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		height: auto;
		max-height: none;
		margin-top: 0 !important;
		overflow: hidden;
	}

	.payment-shell--anchored .payment-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		-webkit-overflow-scrolling: touch;
	}

	.payment-footer--anchored {
		position: static;
		flex: 0 0 auto;
		margin-top: 0;
		padding: 8px 4px calc(env(safe-area-inset-bottom) + 6px);
		/* Opaque. Nothing scrolls behind the bar any more, and the old
		   white-to-surface gradient washed its top edge in dark mode. */
		background: var(--pos-surface);
		border-top: 1px solid var(--pos-border-light);
		box-shadow: 0 -4px 14px var(--pos-shadow);
	}
}
</style>
