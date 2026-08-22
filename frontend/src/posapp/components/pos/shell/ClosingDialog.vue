<template>
	<v-dialog v-model="closingDialog" v-bind="dialogProps" persistent scrollable>
		<v-card elevation="8" class="closing-dialog-card">
			<ClosingHeader
				:period-start="dialog_data.period_start_date"
				:period-end="dialog_data.period_end_date"
				:ticket-count="shiftTicketCount"
				:open-drafts="shiftOpenDrafts"
				@close="closeDialog"
			/>

			<v-card-text class="pa-0 white-background">
				<v-container class="closing-container">
					<v-row class="mb-6">
						<v-col cols="12" class="pa-1">
							<ShiftOverview
								:loading="overviewLoading"
								:primary-insights="primaryInsights"
								:secondary-insights="secondaryInsights"
								:multi-currency-totals="multiCurrencyTotals"
								:credit-invoices-by-currency="creditInvoicesByCurrency"
								:returns-by-currency="returnsByCurrency"
								:change-returned-rows="changeReturnedRows"
								:cash-expected-by-currency="cashExpectedByCurrency"
								:cash-movement-summary="cashMovementSummary"
								:payments-by-mode="paymentsByMode"
								:overview-company-currency="overviewCompanyCurrency"
								:format-currency-with-symbol="formatCurrencyWithSymbol"
								:should-show-company-equivalent="shouldShowCompanyEquivalent"
								:show-exchange-rates="showExchangeRates"
								:format-exchange-rates="formatExchangeRates"
								:is-cash-mode="isCashMode"
								:overpayment-deduction-for-currency="overpaymentDeductionForCurrency"
							/>
						</v-col>
					</v-row>
					<v-row>
						<!-- The drawer is counted by denomination and the other
						     tenders are reconciled beside it, because they are two
						     different acts: one is physical counting, the other is
						     reading a terminal's totals off a slip. -->
						<v-col v-if="cashRow" cols="12" md="5" class="pa-1">
							<DrawerCount
								:currency="drawerCurrency"
								:expected="expectedCash"
								:breakdown="expectedBreakdown"
								:initial-counted="initialCountedCash"
								:format-currency="formatCurrencyWithSymbolForDrawer"
								@update:counted="onDrawerCounted"
							/>
						</v-col>
						<v-col cols="12" :md="cashRow ? 7 : 12" class="pa-1">
							<PaymentReconciliation
								:payments="dialog_data.payment_reconciliation"
								:headers="headers"
								:items-per-page="itemsPerPage"
								:company-currency-symbol="companyCurrencySymbol"
								:format-currency="formatCurrency"
								:format-float="formatFloat"
							/>
						</v-col>
					</v-row>
				</v-container>
			</v-card-text>

			<v-divider></v-divider>

			<!-- One number, one action (§17.7 invariant 1). On the corte that
			     number is the DIFFERENCE, and `resolveBandState` decides it —
			     this screen feeds it `expected` and `counted` and computes no
			     competing total of its own.

			     Mounted only when nothing else owns the lane. At `/closing` the
			     dialog IS the screen and there is no shell band; hosted as a rail
			     destination, `DESTINATION_SURFACE` is injected and the shell's
			     band is already on screen, so a second one here would be two
			     numbers and two accents. -->
			<div v-if="bandOwnsAction && bandState" class="closing-band">
				<ActionBand
					:state="bandState"
					:format-currency="formatCurrency"
					@primary="submitDialog"
				>
					<template #breakdown>
						<div class="closing-band__row">
							<span>{{ __("Expected in drawer") }}</span>
							<span class="reg-mono" data-money-role="expected">{{
								formatCurrencyWithSymbolForDrawer(expectedCash)
							}}</span>
						</div>
						<div class="closing-band__row">
							<span>{{ __("Counted") }}</span>
							<span class="reg-mono" data-money-role="counted">{{
								formatCurrencyWithSymbolForDrawer(countedCash)
							}}</span>
						</div>
					</template>
				</ActionBand>
			</div>

			<v-card-actions class="dialog-actions-container">
				<v-spacer></v-spacer>
				<!-- The corte is a destination now, not a dialog over the sale, so
				     "the primary action of this screen" is answerable: submitting
				     the close. It carries the one accent (§17.7 invariant 2).
				     Closing is a dismissal, not a destructive act — it was red for
				     emphasis, which is the colour spending this invariant exists
				     to stop, so it drops to neutral text.

				     Green mattered most here. This screen's own band tints amber
				     when the count differs from expected, and a green SUBMIT
				     beside an amber difference taught the cashier that green is a
				     button colour rather than a signal. -->
				<v-btn
					variant="text"
					@click="closeDialog"
					class="pos-action-btn cancel-action-btn"
					size="large"
				>
					<v-icon start>mdi-close-circle-outline</v-icon>
					<span>{{ __("Close") }}</span>
				</v-btn>
				<!-- Yielded when the band is up, the same way InvoiceSummary
				     yields to it on the sale screen: CERRAR TURNO and Submit are
				     the same act, and two of them would be two accents on one
				     screen. Same handler either way — the submission path does
				     not fork. -->
				<v-btn
					v-if="!bandOwnsAction"
					color="primary"
					variant="flat"
					data-testid="closing-submit"
					@click="submitDialog"
					class="pos-action-btn submit-action-btn"
					size="large"
					elevation="2"
				>
					<v-icon start>mdi-check-circle-outline</v-icon>
					<span>{{ __("Submit") }}</span>
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
// Extensionless: the store is `uiStore.ts`, and a `.js` specifier against it
// resolves under Vite but throws under the vitest transform (build plan §10),
// which made this dialog unmountable in a spec.
import { useUIStore } from "../../../stores/uiStore";
import { ref, computed, inject, onMounted, onBeforeUnmount, watch } from "vue";
import { useClosingShift } from "../../../composables/pos/closing/useClosingShift";
import { useClosingSummary } from "../../../composables/pos/closing/useClosingSummary";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { resolveBandState } from "../../../composables/pos/shell/bandState";

import ClosingHeader from "../closing/ClosingHeader.vue";
import ShiftOverview from "../closing/ShiftOverview.vue";
import PaymentReconciliation from "../closing/PaymentReconciliation.vue";
import DrawerCount from "../closing/DrawerCount.vue";
import ActionBand from "./band/ActionBand.vue";
import { DESTINATION_SURFACE } from "./destinations/surfaceContext";

export default {
	name: "ClosingDialog",
	components: {
		ClosingHeader,
		ShiftOverview,
		PaymentReconciliation,
		DrawerCount,
		ActionBand,
	},
	emits: ["band"],
	setup(_props, { emit }) {
		const uiStore = useUIStore();
		const eventBus = inject("eventBus");
		const __ = window.__ || ((t) => t);

		// Fullscreen on phones — a 900px card at 390px was a floating sheet
		// scrolling in two axes over a wall of stat cards + a wide recon
		// table (user report 2026-08-10).
		const { dialogProps } = useDialogFullscreen({ maxWidth: 900 });

		// Initialize composables
		const {
			closingDialog,
			dialog_data,
			overview,
			overviewLoading,
			pos_profile,
			closeDialog,
			fetchOverview,
			submitDialog,
		} = useClosingShift(eventBus);

		// Formatters
		// Return a BARE formatted number (no symbol). Callers add the currency
		// symbol themselves — the reconciliation cells via a template prefix and
		// formatCurrencyWithSymbol via the per-currency symbol — so using
		// window.format_currency here (which prepends a symbol) double-printed
		// it as "MX$ MX$1,000.00".
		const formatCurrency = (v, precision) => window.format_number(v, null, precision ?? 2);
		const formatFloat = (v, d) => window.flt(v, d);
		const currencySymbol = (c) => window.get_currency_symbol(c);
		const translate = (t) => window.__(t);

		const summaryFormatters = {
			formatCurrencyWithSymbol: (amount, currency) => {
				const resolvedCurrency = currency || "";
				const symbol = currencySymbol(resolvedCurrency);
				const formatted = formatCurrency(amount || 0);
				if (symbol) return `${symbol} ${formatted}`;
				return `${resolvedCurrency} ${formatted}`.trim();
			},
			formatCount: (value) => formatFloat(value || 0, 0),
			formatCurrency,
			currencySymbol,
			__: translate,
		};

		const summary = useClosingSummary(overview, pos_profile, dialog_data, summaryFormatters);

		const headers = ref([]);
		const baseHeaders = [
			{
				title: __("Mode of Payment"),
				value: "mode_of_payment",
				align: "start",
				sortable: true,
			},
			{
				title: __("Opening Amount"),
				align: "end",
				sortable: true,
				value: "opening_amount",
			},
			{
				title: __("Closing Amount"),
				value: "closing_amount",
				align: "end",
				sortable: true,
			},
		];
		const extendedHeaders = [
			{
				title: __("Expected Amount (In Company Currency)"),
				value: "expected_amount",
				align: "end",
				sortable: false,
			},
			{
				title: __("Difference (In Company Currency)"),
				value: "difference",
				align: "end",
				sortable: false,
			},
			{
				title: __("Variance %"),
				value: "variance_percent",
				align: "end",
				sortable: false,
			},
		];

		// ---- the drawer count ------------------------------------------------
		//
		// Everything below changes how the CASH figure is entered and shown. The
		// close still posts `payment_reconciliation[].closing_amount` and the
		// difference is still expected-minus-counted; `DrawerCount` writes into
		// the same field the reconciliation table has always written into.

		const reconciliationRows = computed(() =>
			Array.isArray(dialog_data.value.payment_reconciliation)
				? dialog_data.value.payment_reconciliation
				: [],
		);

		/**
		 * The cash row, identified by the mode the shift overview names as cash.
		 * No guessing from a label: `isCashMode` already answers this from the
		 * server's own `cash_expected.mode_of_payment`, and a profile with no
		 * cash mode configured genuinely has no drawer to count.
		 */
		const cashRow = computed(
			() => reconciliationRows.value.find((row) => summary.isCashMode(row?.mode_of_payment)) || null,
		);

		const drawerCurrency = computed(
			() => summary.overviewCompanyCurrency.value || pos_profile.value?.currency || "",
		);

		const expectedCash = computed(() => Number(cashRow.value?.expected_amount) || 0);
		const countedCash = computed(() => Number(cashRow.value?.closing_amount) || 0);

		/**
		 * A figure the doc already carried. Only ever read at mount — after that
		 * the count owns the field, and feeding our own writes back in would make
		 * every keystroke look like a manual override.
		 */
		const initialCountedCash = ref(null);
		watch(
			cashRow,
			(row) => {
				if (initialCountedCash.value !== null || !row) return;
				const seeded = Number(row.closing_amount);
				initialCountedCash.value = Number.isFinite(seeded) && seeded !== 0 ? seeded : null;
			},
			{ immediate: true },
		);

		const onDrawerCounted = (amount) => {
			const row = cashRow.value;
			if (!row) return;
			row.closing_amount = amount;
		};

		/**
		 * Provenance of the expected figure, in the artboard's four lines.
		 * `advances` is absent because the shift overview does not publish it
		 * yet — `DrawerCount` drops the whole box unless the parts it IS given
		 * account for `expected`, so an incomplete decomposition shows nothing
		 * rather than an identity that does not add up.
		 */
		const expectedBreakdown = computed(() => {
			const row = cashRow.value;
			if (!row) return null;
			const cashSales =
				summary.paymentsByMode.value?.find((entry) => summary.isCashMode(entry?.mode_of_payment))
					?.company_currency_total ?? null;
			return {
				openingFloat: Number(row.opening_amount) || 0,
				cashSales,
				withdrawals: summary.cashMovementSummary.value?.company_currency_total ?? null,
			};
		});

		// The reconciliation table already respects this flag by dropping the
		// expected and difference columns; a band that announced the difference
		// beside it would hand back exactly what the tenant chose to withhold.
		const showsExpected = computed(() => !pos_profile.value?.hide_expected_amount);

		/** Mirrors what `submitDialog` refuses, so the action can say so first. */
		const reconciliationIsValid = computed(() =>
			reconciliationRows.value.every((row) => !isNaN(parseFloat(row?.closing_amount))),
		);

		const bandState = computed(() => {
			if (!cashRow.value || !showsExpected.value) return null;
			return resolveBandState({
				kind: "closing",
				expected: expectedCash.value,
				counted: countedCash.value,
				canClose: reconciliationIsValid.value,
			});
		});

		// Published upward whether or not we render a band ourselves, so a shell
		// hosting this surface can feed its own band from the same state.
		watch(bandState, (state) => emit("band", state), { immediate: true });

		// Injected only when DestinationHost is rendering us; absent on the
		// standalone `/closing` route, which is where this dialog lives today.
		const destinationSurface = inject(DESTINATION_SURFACE, null);
		const bandOwnsAction = computed(() => !destinationSurface);

		/** The drawer counts in ONE currency, so its figures carry that symbol. */
		const formatCurrencyWithSymbolForDrawer = (value) =>
			summaryFormatters.formatCurrencyWithSymbol(value, drawerCurrency.value);

		// Header facts. Null until the overview lands: "not loaded" and "none"
		// are different answers, and a confident 0 tickets on a 31-ticket shift
		// is the worse of the two errors.
		const shiftTicketCount = computed(() =>
			overview.value ? Number(overview.value.total_invoices) || 0 : null,
		);
		const shiftOpenDrafts = computed(() =>
			overview.value ? Number(overview.value.draft_invoices?.count) || 0 : null,
		);

		const handleKeydown = (event) => {
			if (event.key === "Escape" && closingDialog.value) {
				closeDialog();
			}
		};

		onMounted(() => {
			headers.value = [...baseHeaders];
			window.addEventListener("keydown", handleKeydown);

			if (eventBus) {
				eventBus.on("open_ClosingDialog", (data) => {
					closingDialog.value = true;
					dialog_data.value = data;
					fetchOverview(data.pos_opening_shift, pos_profile.value?.currency);
				});
			} else {
				console.error("ClosingDialog: eventBus not provided");
			}
		});

		onBeforeUnmount(() => {
			window.removeEventListener("keydown", handleKeydown);
			if (eventBus) {
				eventBus.off("open_ClosingDialog");
			}
		});

		watch(
			() => uiStore.posProfile,
			(profile) => {
				if (profile) {
					pos_profile.value = profile;
					if (!pos_profile.value.hide_expected_amount) {
						headers.value = [...baseHeaders, ...extendedHeaders];
					} else {
						headers.value = [...baseHeaders];
					}
				}
			},
			{ deep: true, immediate: true },
		);

		return {
			uiStore,
			eventBus,
			dialogProps,
			closingDialog,
			dialog_data,
			overview,
			overviewLoading,
			pos_profile,
			closeDialog,
			fetchOverview,
			submitDialog,
			...summary,
			// Expose formatters used in template
			formatCurrency,
			formatFloat,
			formatCurrencyWithSymbol: summaryFormatters.formatCurrencyWithSymbol,
			// The corte's own bindings.
			cashRow,
			drawerCurrency,
			expectedCash,
			countedCash,
			initialCountedCash,
			expectedBreakdown,
			onDrawerCounted,
			formatCurrencyWithSymbolForDrawer,
			bandState,
			bandOwnsAction,
			shiftTicketCount,
			shiftOpenDrafts,
			shouldShowCompanyEquivalent: summary.shouldShowCompanyEquivalent,
			showExchangeRates: summary.showExchangeRates,
			formatExchangeRates: summary.formatExchangeRates,
			isCashMode: summary.isCashMode,
			overpaymentDeductionForCurrency: summary.overpaymentDeductionForCurrency,
			headers,
			itemsPerPage: 20,
		};
	},
};
</script>

<style scoped>
.closing-dialog-card {
	border-radius: 16px;
	overflow: hidden;
}

.closing-container {
	padding: 24px;
}

/* Fullscreen sheet on phones: square the card, reclaim the padding the
   stat grid + recon table need, and let actions stay reachable. */
@media (max-width: 600px) {
	.closing-dialog-card {
		border-radius: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.closing-container {
		padding: 10px;
	}

	.closing-container :deep(.mb-6) {
		margin-bottom: 12px !important;
	}
}

.white-background {
	background-color: rgb(var(--v-theme-surface));
}

/* The band keeps its own lane below the scrollport: `flex: none` so it can
   never scroll out of reach, which is the same rule the height chain applies to
   the sale screen's summary grid (59c5fe1ad). */
.closing-band {
	flex: none;
	padding: 12px 24px 0;
}

@media (max-width: 600px) {
	.closing-band {
		padding: 8px 10px 0;
	}
}

.closing-band__row {
	display: flex;
	justify-content: space-between;
	gap: 16px;
}

.dialog-actions-container {
	padding: 16px 24px;
	border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.pos-action-btn {
	border-radius: 8px;
	text-transform: none;
	font-weight: 600;
	letter-spacing: 0.5px;
	padding: 0 24px;
}

.cancel-action-btn {
	border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.submit-action-btn {
	margin-left: 16px;
}
</style>
