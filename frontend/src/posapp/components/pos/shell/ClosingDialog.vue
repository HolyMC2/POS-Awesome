<template>
	<v-dialog v-model="closingDialog" v-bind="dialogProps" persistent scrollable>
		<v-card elevation="8" class="closing-dialog-card">
			<ClosingHeader
				:period-start="dialog_data.period_start_date"
				:period-end="dialog_data.period_end_date"
				:ticket-count="shiftTicketCount"
				:open-drafts="shiftOpenDrafts"
				@close="dismissCorte"
			/>

			<!--
				`Corte.dc.html` draws three columns that fill the height, with
				the band across the bottom — never one scrolling list. This body
				is the frame for that: `v-dialog scrollable` hands the scroll to
				`.v-card-text`, which is how the count, the reconciliation and
				seven overview tables ended up in ONE scrollport, and how the
				figure the cashier is counting against scrolled off the screen
				while they counted.

				So the body stops being the scroller and the columns below own
				their own scrollports. It stays a plain flex column here — a
				`min-height: 0` flex child cannot push a parent that is already
				sized by the card's flex chain, so Vuetify's own `overflow-y`
				on this element simply never has anything to scroll.
			-->
			<v-card-text class="pa-0 white-background closing-body">
				<ClosingReview v-if="!dialog_data.pos_opening_shift" :prepared="false" @retry="retryPreparation" @drafts="reviewDrafts" @sync="syncSavedWork" />
				<div v-if="dialog_data.pos_opening_shift" class="closing-layout" :class="{ 'closing-layout--no-count': !cashRow, 'closing-layout--custody': custodyEnabled }">
					<!-- Counting the drawer is the ACT this screen exists for, so
					     it holds its own column and never scrolls away from the
					     difference band below it. -->
					<div v-if="cashRow" class="closing-layout__count">
						<CashClosingAllocation :profile="dialog_data.pos_profile" :opening="dialog_data.pos_opening_shift" :currency="drawerCurrency" :expected="showsExpected ? expectedCash : undefined" @enabled="custodyEnabled=$event" @prepared="dialog_data.cash_custody=$event" @counted="onDrawerCounted" @note="closingNote=$event" />
						<DrawerCount v-if="!custodyEnabled"
							:currency="drawerCurrency"
							:expected="expectedCash"
							:breakdown="expectedBreakdown"
							:initial-counted="initialCountedCash"
							:format-currency="formatCurrencyWithSymbolForDrawer"
							@update:counted="onDrawerCounted"
						/>
					</div>

					<!-- The evidence: the other tenders reconciled first, because
					     that is the other thing the cashier has to TYPE. The
					     shift's seven tables fold behind one disclosure — open,
					     they are the reason the body scrolls; closed (the
					     default), the whole corte fits and NOTHING scrolls.
					     `v-show`, so an inspection in progress survives the
					     fold. -->
					<div class="closing-layout__detail">
						<ClosingReview :prepared="Boolean(dialog_data.pos_opening_shift)" @retry="retryPreparation" @drafts="reviewDrafts" @sync="syncSavedWork" />
						<PaymentReconciliation
							:payments="dialog_data.payment_reconciliation"
							:headers="headers"
							:items-per-page="itemsPerPage"
							:company-currency-symbol="companyCurrencySymbol"
							:format-currency="formatCurrency"
							:format-float="formatFloat"
						/>
						<DifferenceNote v-if="movilCorte && showsExpected && !custodyEnabled" v-model="closingNote" :gate="noteGate" :tolerance-label="formatCurrencyWithSymbolForDrawer(noteGate.tolerance)" />
						<button
							type="button"
							class="closing-overview-toggle"
							data-testid="closing-overview-toggle"
							:aria-expanded="overviewOpen ? 'true' : 'false'"
							@click="overviewOpen = !overviewOpen"
						>
							<v-icon size="16">{{
								overviewOpen ? "mdi-chevron-down" : "mdi-chevron-right"
							}}</v-icon>
							{{ __("Shift movements and evidence") }}
						</button>
						<ShiftOverview
							v-show="overviewOpen"
							:loading="overviewLoading"
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
					</div>
				</div>
			</v-card-text>

			<v-divider></v-divider>
			<p v-if="submitHint" class="closing-submit-hint" role="status" data-testid="closing-submit-hint">{{ submitHint }}</p>

			<!-- The closing screen owns its footer; the shell hides the sale band. -->
			<div v-if="bandState" class="closing-band">
				<ActionBand
					:state="bandState"
					:format-currency="formatCurrencyWithSymbolForDrawer"
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
					<template #actions><button type="button" class="closing-back" :disabled="closingFlow.submitting" @click="dismissCorte">{{ __("Back") }}</button></template>
				</ActionBand>
			</div>

			<v-card-actions v-if="!bandState" class="dialog-actions-container">
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					@click="dismissCorte"
					class="pos-action-btn cancel-action-btn"
					size="large"
				>
					<v-icon start>mdi-close-circle-outline</v-icon>
					<span>{{ __("Back") }}</span>
				</v-btn>
				<!-- Cashless and blind-count profiles still need an explicit close action. -->
				<v-btn
					v-if="!bandState"
					:disabled="!canSubmit"
					:loading="closingFlow.submitting"
					color="primary"
					variant="flat"
					data-testid="closing-submit"
					@click="submitDialog"
					class="pos-action-btn submit-action-btn"
					size="large"
					elevation="2"
				>
					<v-icon start>mdi-check-circle-outline</v-icon>
					<span>{{ __("Close shift") }}</span>
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

import { useClosingFlowStore } from "../../../stores/closingFlowStore";
import ClosingReview from "../closing/ClosingReview.vue";
import ClosingHeader from "../closing/ClosingHeader.vue";
import ShiftOverview from "../closing/ShiftOverview.vue";
import PaymentReconciliation from "../closing/PaymentReconciliation.vue";
import CashClosingAllocation from "../custody/CashClosingAllocation.vue";
import DrawerCount from "../closing/DrawerCount.vue";
import DifferenceNote from "../mobile/closing/DifferenceNote.vue";
import { evaluateNoteGate } from "../mobile/closing/differenceNote";
import { denominationsFor } from "../closing/denominations";
import ActionBand from "./band/ActionBand.vue";
import { useResponsive } from "../../../composables/core/useResponsive";
import { DESTINATION_SURFACE } from "./destinations/surfaceContext";

export default {
	name: "ClosingDialog",
	components: {
		ClosingHeader,
		ClosingReview,
		ShiftOverview,
		PaymentReconciliation,
		DrawerCount,
		CashClosingAllocation,
		DifferenceNote,
		ActionBand,
	},
	emits: ["band", "close"],
	setup(_props, { emit }) {
		const uiStore = useUIStore();
		const closingFlow = useClosingFlowStore();
		const eventBus = inject("eventBus");
		const __ = window.__ || ((t) => t);

		// The seven overview tables, folded by default: open, they are the one
		// reason this surface scrolls; closed, the corte fits whole. Resets
		// with the component, not the shift — an inspection is a moment.
		const overviewOpen = ref(false);

		// Fullscreen on phones — a 900px card at 390px was a floating sheet
		// scrolling in two axes over a wall of stat cards + a wide recon
		// table (user report 2026-08-10).
		//
		// 1100 rather than 900: the corte is two columns now — the drawer
		// count beside the reconciliation — and 900 left the recon table's six
		// columns about 500px. Nothing under the `sm` floor changes (the sheet
		// is fullscreen there) and nothing between the two changes either,
		// because VOverlay already caps its content at the viewport.
		const { dialogProps } = useDialogFullscreen({ maxWidth: 1100 });

		// Initialize composables
		const {
			closingDialog,
			dialog_data,
			overview,
			overviewLoading,
			pos_profile,
			closeDialog,
			fetchOverview,
			submitDialog: submitClosingDraft,
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
				title: __("Opening"),
				align: "end",
				sortable: true,
				value: "opening_amount",
			},
			{
				title: __("Counted"),
				value: "closing_amount",
				align: "end",
				sortable: true,
			},
		];
		const extendedHeaders = [
			{
				title: __("Expected"),
				value: "expected_amount",
				align: "end",
				sortable: false,
			},
			{
				title: __("Difference"),
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
		const custodyEnabled = ref(false);
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

		const responsive = useResponsive();
		const movilCorte = computed(() => responsive.isCompact.value);
		const closingNote = ref(dialog_data.value.posa_difference_note || "");
		const noteGate = computed(() => evaluateNoteGate({
			difference: countedCash.value - expectedCash.value,
			takings: Number(dialog_data.value.grand_total) || 0,
			note: closingNote.value,
			minorPerMajor: denominationsFor(drawerCurrency.value).minorPerMajor,
		}));
		watch(closingNote, (note) => { dialog_data.value.posa_difference_note = note; });
		const canSubmit = computed(() => Boolean(dialog_data.value.pos_opening_shift) && (!custodyEnabled.value || Boolean(dialog_data.value.cash_custody)) && reconciliationIsValid.value &&
			closingFlow.terminalReady && !closingFlow.preparing && !closingFlow.submitting && !closingFlow.completed &&
			!closingFlow.reviewBlocked && (!closingFlow.reviewRequired || closingFlow.reviewAccepted) &&
			(!movilCorte.value || !showsExpected.value || noteGate.value.canClose));

		const submitHint = computed(() => {
			if (closingFlow.submitting) return __("Closing shift…");
			if (closingFlow.preparing) return __("Loading shift totals and checking saved work…");
			if (!dialog_data.value.pos_opening_shift) return __("Load the closing details before continuing.");
			if (!closingFlow.terminalReady) return __("Complete the browser review above before closing.");
			if (closingFlow.reviewBlocked) return __("Finish or delete the listed drafts, then reload closing details.");
			if (closingFlow.reviewRequired && !closingFlow.reviewAccepted) return __("Confirm the unfinished-sales review above.");
			if (custodyEnabled.value && !dialog_data.value.cash_custody) return __("Save the current count and allocate its exact total before closing.");
			if (!reconciliationIsValid.value) return __("Enter a closing amount for every payment method. Use 0 when there were no payments.");
			if (movilCorte.value && showsExpected.value && !noteGate.value.canClose) return __("Add a note explaining the cash difference before closing.");
			return "";
		});

		const submitDialog = () => {
			if (!canSubmit.value) { closingFlow.error = submitHint.value; return false; }
			if (movilCorte.value && showsExpected.value && !noteGate.value.canClose) {
				closingFlow.error = __("Add a note explaining the cash difference before closing.");
				return false;
			}
			return submitClosingDraft();
		};

		const bandState = computed(() => {
			if (!cashRow.value || !showsExpected.value) return null;
			const state = resolveBandState({
				kind: "closing",
				expected: expectedCash.value,
				counted: countedCash.value,
				canClose: canSubmit.value,
			});
			state.primaryAction.labelKey = closingFlow.submitting ? "Closing shift…" : "Close shift";
			return state;
		});

		// Published upward whether or not we render a band ourselves, so a shell
		// hosting this surface can feed its own band from the same state.
		watch(bandState, (state) => emit("band", state), { immediate: true });

		// Injected only when DestinationHost is rendering us; absent for the
		// floating copy `DefaultLayout` keeps for the routes with no rail.
		const destinationSurface = inject(DESTINATION_SURFACE, null);
		const isHosted = Boolean(destinationSurface);

		/**
		 * Leaving the corte is leaving the DESTINATION, not just hiding a
		 * dialog: closing the overlay alone would leave the host showing an
		 * empty surface with no way out. `DestinationHost` turns this into its
		 * own `dismiss`, which returns to whatever the cashier was on before —
		 * never a hardcoded sale.
		 */
		const dismissCorte = () => {
			if (closingFlow.submitting) return;
			closeDialog();
			emit("close");
		};

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

		const syncSavedWork = () => eventBus?.emit("run_menu_action", { id: "sync-offline-sales" });
		const retryPreparation = () => eventBus?.emit("open_shift_details");
		const reviewDrafts = () => eventBus?.emit("open_destination", "drafts");
		watch(() => [closingFlow.completed, closingFlow.submitting], ([done, busy]) => { if (done && !busy) dismissCorte(); });

		const handleKeydown = (event) => {
			if (event.key === "Escape" && closingDialog.value) {
				dismissCorte();
			}
		};

		const handleOpenClosingDialog = (data) => {
			closingDialog.value = true;
			dialog_data.value = data;
			fetchOverview(data.pos_opening_shift, pos_profile.value?.currency);
		};

		onMounted(() => {
			window.addEventListener("keydown", handleKeydown);

			if (eventBus) {
				eventBus.on("open_ClosingDialog", handleOpenClosingDialog);
			} else {
				console.error("ClosingDialog: eventBus not provided");
			}

			if (isHosted) {
				// The corte cannot be drawn from nothing: the closing shift is
				// PREPARED server-side (`make_closing_shift_from_opening`,
				// which also submits printed drafts and can refuse). The shell
				// already answers `open_shift_details` with exactly that call,
				// so the destination asks for it instead of forking the flow —
				// the rail and the navbar close the same shift the same way.
				if (eventBus) {
					closingDialog.value = true;
					eventBus.emit("open_shift_details");
				}
			}
		});

		onBeforeUnmount(() => {
			window.removeEventListener("keydown", handleKeydown);
			if (eventBus) {
				// Always pass the handler: a bare `off("open_ClosingDialog")`
				// removes EVERY listener for the event, so the hosted copy
				// unmounting would take the layout copy's listener with it and
				// the navbar's «Close shift» would silently stop working.
				eventBus.off("open_ClosingDialog", handleOpenClosingDialog);
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
								}
				}
			},
			{ deep: true, immediate: true },
		);

		return {
			uiStore,
			closingFlow,
			canSubmit,
			submitHint,
			retryPreparation,
			syncSavedWork,
			reviewDrafts,
			eventBus,
			dialogProps,
			closingDialog,
			dialog_data,
			overview,
			overviewOpen,
			overviewLoading,
			pos_profile,
			closeDialog,
			dismissCorte,
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
			custodyEnabled,
			initialCountedCash,
			expectedBreakdown,
			onDrawerCounted,
			formatCurrencyWithSymbolForDrawer,
			bandState,
			movilCorte,
			closingNote,
			noteGate,
			showsExpected,
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
.closing-submit-hint { margin: 0; padding: 8px 16px 0; font-size: 13px; line-height: 1.4; }

.closing-dialog-card {
	border-radius: 16px;
	overflow: hidden;
}

/*
 * The body is a frame, not a scrollport. `min-height: 0` is the load-bearing
 * half: a flex child defaults to `min-height: auto` and would refuse to shrink
 * below the seven overview tables inside it, which is exactly how the card's
 * own scroll came to own the whole corte.
 */
.closing-body {
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	min-height: 0;
	/* The corte is 1100px floating and ~1330px full-bleed inside the destination
	   host, on the same 1440px screen. The columns below therefore answer to the
	   width THIS body has, never to the window. */
	container: closing-body / inline-size;
}

/*
 * `Corte.dc.html`: columns that fill the height, with the band across the
 * bottom. Two of the artboard's three exist here — the count and the evidence;
 * its third is «Equipo en piso», which this register has no data for and which
 * is therefore not drawn rather than faked.
 *
 * The tiles row is `auto` and the column row is `1fr`, so the grid is exactly
 * as tall as the body and the columns divide what is left.
 */
.closing-layout {
	display: grid;
	grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
	/* `auto auto`, not fr rows with per-column scrollports: three scrollbars
	 * on one corte was the report (Marco, 08-23). The columns size to their
	 * content — the count never scrolls, the reconciliation never scrolls —
	 * and with the overview folded (its default) the whole corte fits with
	 * NO scrollbar. Open the disclosure and the BODY scrolls: one scroll,
	 * with the difference band and the actions pinned outside it. */
	grid-template-rows: auto;
	grid-template-areas:
		"count detail";
	gap: 16px;
	padding: 16px;
	flex: 1 1 auto;
	min-height: 0;
}

/*
 * A profile with no cash mode has no drawer to count — `isCashMode` answers
 * that from the server's own figures, not from a label — so the column goes
 * with it rather than standing there empty beside the evidence.
 */
/*
 * Custody closing, wide: count · bags · payment evidence, three readable
 * columns across the surface. `CashClosingAllocation` makes the first two out
 * of the count area — it queries `corte-count` below — so the area is sized to
 * carry both, and the evidence keeps enough width for the reconciliation's six
 * columns instead of the empty half-screen the live capture showed.
 */
.closing-layout--custody { grid-template-columns: minmax(690px, 1.2fr) minmax(360px, 1fr); }

/* Room enough for the reconciliation's six columns to stand without its own
   sideways scroll; the count area keeps everything above that. */
@container closing-body (min-width: 1500px) {
	.closing-layout--custody { grid-template-columns: minmax(690px, 1fr) minmax(660px, 0.9fr); }
}

/*
 * Under ~1280px of body the three columns cannot all be read: 1.2fr of it is
 * under the 686px the count workspace needs to split, so a two-column corte
 * would be the tall single count again beside a starved table. The corte
 * stacks instead — the review that can block the close first, then the count
 * with its bags side by side across the FULL width, then the payment evidence
 * — and the body's one scroll carries it. Same shape the phone already uses.
 */
@container closing-body (max-width: 1279.98px) {
	.closing-layout--custody {
		display: flex;
		flex-direction: column;
	}

	.closing-layout--custody .closing-layout__detail { display: contents; }
	.closing-layout--custody .closing-layout__detail > :not(.closing-review) { order: 2; }
	.closing-layout--custody .closing-layout__count { order: 1; }
	.closing-layout--custody :deep(.closing-review) { order: 0; }
}
.closing-layout--no-count {
	grid-template-columns: minmax(0, 1fr);
	grid-template-areas:
		"detail";
}

.closing-layout__tiles {
	grid-area: tiles;
}

/* The count holds still AND whole: every denomination row visible, no
   scrollport of its own — a figure you have to scroll back to is a figure
   you retype. */
.closing-layout__count {
	grid-area: count;
	min-inline-size: 0;
	/* What the custody workspace measures itself against: the area it was
	   given, which is not the window and not the card. */
	container: corte-count / inline-size;
}

/* Content-sized like the count. Its tall half — the seven overview tables —
   sits behind the disclosure, so this column only grows when the cashier
   asks it to, and the growth is what the body's one scroll carries. */
.closing-layout__detail {
	grid-area: detail;
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
}

.closing-overview-toggle {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	align-self: flex-start;
	padding: 6px 12px;
	border: 1px solid var(--reg-tone-neutral-divider, #eceff3);
	border-radius: 999px;
	background: var(--reg-surface-muted, #f7f8fa);
	color: var(--reg-text-muted, #667085);
	font-size: 12.5px;
	font-weight: 600;
	cursor: pointer;
}

/*
 * Under the two-column width there is no room to put the count beside the
 * evidence, so the corte becomes one column again — and the body hands the
 * scroll back to the card, because a single column that cannot scroll is worse
 * than one that does.
 */
@media (max-width: 959px) {
	.closing-body {
		display: block;
	}

	.closing-layout {
		display: flex;
		flex-direction: column;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto;
		grid-template-areas:
			"count"
			"detail";
	}

	.closing-layout__detail { display: contents; }
	.closing-layout__detail > :not(.closing-review) { order: 2; }
	.closing-layout__count { order: 1; }
	.closing-layout :deep(.closing-review) { order: 0; }

	.closing-layout__count,
	.closing-layout__detail {
		overflow: visible;
	}
}

/* Fullscreen sheet on phones: square the card, reclaim the padding the
   stat grid + recon table need, and let actions stay reachable. */
@media (max-width: 599.98px) {
	.closing-dialog-card {
		border-radius: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.closing-layout {
		padding: 10px;
		gap: 12px;
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
	padding: 12px 16px;
}

@media (max-width: 599.98px) {
	.closing-band {
		padding: 8px 10px 0;
	}
}

.closing-band :deep(.action-band) { min-height: 100px; }
.closing-band :deep(.action-band__primary) { min-height: 56px; }
.closing-back { padding: 10px 16px; min-height: 44px; border: 1px solid currentColor; border-radius: 8px; }
.closing-back:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }

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

@media (max-width: 599.98px) {
	.closing-band :deep(.action-band) { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 12px; min-height: 0; }
	.closing-band :deep(.action-band__divider), .closing-band :deep(.action-band__spacer), .closing-band :deep(.action-band__context) { display: none; }
	.closing-band :deep(.action-band__number) { font-size: 28px; }
	.closing-band :deep(.action-band__primary) { grid-column: 2; grid-row: 1; min-height: 48px; height: auto; min-width: 110px; padding: 8px 12px; font-size: 16px; }
	.closing-band :deep(.action-band__breakdown) { grid-column: 1; grid-row: 2; font-size: 11px; }
	.closing-band :deep(.action-band__actions) { grid-column: 2; grid-row: 2; justify-content: end; }
	.closing-back { padding: 6px 12px; min-height: 36px; }
}
</style>
