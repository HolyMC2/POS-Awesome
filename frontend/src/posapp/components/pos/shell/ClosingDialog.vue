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
				<div class="closing-layout" :class="{ 'closing-layout--no-count': !cashRow }">
					<!-- The shift's headline figures stay ON SCREEN: they are what
					     the count is being checked against. -->
					<ShiftInsightTiles
						class="closing-layout__tiles"
						:primary-insights="primaryInsights"
						:secondary-insights="secondaryInsights"
					/>

					<!-- Counting the drawer is the ACT this screen exists for, so
					     it holds its own column and never scrolls away from the
					     difference band below it. -->
					<div v-if="cashRow" class="closing-layout__count">
						<DrawerCount
							:currency="drawerCurrency"
							:expected="expectedCash"
							:breakdown="expectedBreakdown"
							:initial-counted="initialCountedCash"
							:format-currency="formatCurrencyWithSymbolForDrawer"
							@update:counted="onDrawerCounted"
						/>
					</div>

					<!-- The evidence: the other tenders reconciled first, because
					     that is the other thing the cashier has to TYPE, and the
					     shift's tables under them. This is the one region that
					     genuinely overflows, so this is the one region that
					     scrolls. -->
					<div class="closing-layout__detail">
						<PaymentReconciliation
							:payments="dialog_data.payment_reconciliation"
							:headers="headers"
							:items-per-page="itemsPerPage"
							:company-currency-symbol="companyCurrencySymbol"
							:format-currency="formatCurrency"
							:format-float="formatFloat"
						/>
						<ShiftOverview
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

			<!-- Hosted as a rail destination the shell already owns the band
			     lane, so the corte does not draw a second one — but the
			     DIFFERENCE is the number this whole screen exists to produce,
			     and the artboard prints it beside «Debe haber» and «Contado».
			     So it stays, as a summary line rather than a band: no accent,
			     no second primary, same strings `resolveBandState` already
			     names. -->
			<div
				v-else-if="bandState"
				class="closing-difference"
				:class="`closing-difference--${bandState.tone}`"
				data-testid="closing-difference"
			>
				<div class="closing-difference__row">
					<span>{{ __("Expected in drawer") }}</span>
					<span class="reg-mono" data-money-role="expected">{{
						formatCurrencyWithSymbolForDrawer(expectedCash)
					}}</span>
				</div>
				<div class="closing-difference__row">
					<span>{{ __("Counted") }}</span>
					<span class="reg-mono" data-money-role="counted">{{
						formatCurrencyWithSymbolForDrawer(countedCash)
					}}</span>
				</div>
				<div class="closing-difference__row closing-difference__row--total">
					<span>{{ __(bandState.labelKey) }}</span>
					<span
						class="reg-mono"
						data-money-role="difference"
						data-testid="closing-difference-value"
						>{{ formatCurrencyWithSymbolForDrawer(bandState.value) }}</span
					>
				</div>
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
					@click="dismissCorte"
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
import ShiftInsightTiles from "../closing/ShiftInsightTiles.vue";
import ShiftOverview from "../closing/ShiftOverview.vue";
import PaymentReconciliation from "../closing/PaymentReconciliation.vue";
import DrawerCount from "../closing/DrawerCount.vue";
import ActionBand from "./band/ActionBand.vue";
import { DESTINATION_SURFACE } from "./destinations/surfaceContext";

/**
 * How many copies of the corte are currently on screen AS A DESTINATION.
 *
 * There is always one `<ClosingDialog />` in `DefaultLayout`, because the
 * navbar's «Close shift» has to work from `/reports` and `/payments` too,
 * where there is no rail to host anything. Once the corte is also a rail
 * destination, the shell mounts a second copy inside `DestinationHost` — and
 * both hear the same `open_ClosingDialog` on the same bus, which would put a
 * floating modal on top of the hosted surface.
 *
 * Module scope rather than a store because it is not state anybody outside
 * this component may ask about: it exists for exactly one rule, stated once —
 * while the shell is showing the corte, the floating copy stands down.
 */
const hostedCorteCount = ref(0);

export default {
	name: "ClosingDialog",
	components: {
		ClosingHeader,
		ShiftInsightTiles,
		ShiftOverview,
		PaymentReconciliation,
		DrawerCount,
		ActionBand,
	},
	emits: ["band", "close"],
	setup(_props, { emit }) {
		const uiStore = useUIStore();
		const eventBus = inject("eventBus");
		const __ = window.__ || ((t) => t);

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

		// Injected only when DestinationHost is rendering us; absent for the
		// floating copy `DefaultLayout` keeps for the routes with no rail.
		const destinationSurface = inject(DESTINATION_SURFACE, null);
		const bandOwnsAction = computed(() => !destinationSurface);
		const isHosted = Boolean(destinationSurface);

		/**
		 * Leaving the corte is leaving the DESTINATION, not just hiding a
		 * dialog: closing the overlay alone would leave the host showing an
		 * empty surface with no way out. `DestinationHost` turns this into its
		 * own `dismiss`, which returns to whatever the cashier was on before —
		 * never a hardcoded sale.
		 */
		const dismissCorte = () => {
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

		const handleKeydown = (event) => {
			if (event.key === "Escape" && closingDialog.value) {
				closeDialog();
			}
		};

		const handleOpenClosingDialog = (data) => {
			// The floating copy stands down while the shell is showing the
			// corte as a destination — one act must not open two screens.
			if (!isHosted && hostedCorteCount.value > 0) {
				return;
			}
			closingDialog.value = true;
			dialog_data.value = data;
			fetchOverview(data.pos_opening_shift, pos_profile.value?.currency);
		};

		// A floating copy that was ALREADY up when the rail opened the corte
		// steps aside rather than sitting over it.
		watch(hostedCorteCount, (hosted) => {
			if (hosted > 0 && !isHosted && closingDialog.value) {
				closeDialog();
			}
		});

		onMounted(() => {
			headers.value = [...baseHeaders];
			window.addEventListener("keydown", handleKeydown);

			if (eventBus) {
				eventBus.on("open_ClosingDialog", handleOpenClosingDialog);
			} else {
				console.error("ClosingDialog: eventBus not provided");
			}

			if (isHosted) {
				hostedCorteCount.value += 1;
				// The corte cannot be drawn from nothing: the closing shift is
				// PREPARED server-side (`make_closing_shift_from_opening`,
				// which also submits printed drafts and can refuse). The shell
				// already answers `open_shift_details` with exactly that call,
				// so the destination asks for it instead of forking the flow —
				// the rail and the navbar close the same shift the same way.
				if (eventBus && !closingDialog.value) {
					eventBus.emit("open_shift_details");
				}
			}
		});

		onBeforeUnmount(() => {
			window.removeEventListener("keydown", handleKeydown);
			if (isHosted) {
				hostedCorteCount.value = Math.max(0, hostedCorteCount.value - 1);
			}
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
/* The difference, when the shell owns the band lane. A summary line, not a
 * second band: it carries no accent and no primary action, so §17.7's one
 * accent per screen still lands on the corte's Submit. */
.closing-difference {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 10px 16px;
	font-size: 13px;
	border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.closing-difference__row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
}

.closing-difference__row--total {
	font-weight: 700;
	font-size: 15px;
	margin-top: 2px;
}

/* Amber is STATE here, exactly as in the band: a count that does not match is
 * an exception whether it is short or over. Never emphasis. */
.closing-difference--warning .closing-difference__row--total {
	color: rgb(var(--v-theme-warning));
}

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
	display: flex;
	flex-direction: column;
	min-height: 0;
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
	grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
	/* 280px floor on the columns row: the tiles and the header spend first,
	 * and on the hosted surface what was LEFT for the count and the tables
	 * could be ~135px — unusable. Under the floor the body (overflow auto)
	 * scrolls instead; the difference band and the actions live outside the
	 * scrollport either way. */
	grid-template-rows: auto minmax(280px, 1fr);
	grid-template-areas:
		"tiles tiles"
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
.closing-layout--no-count {
	grid-template-columns: minmax(0, 1fr);
	grid-template-areas:
		"tiles"
		"detail";
}

.closing-layout__tiles {
	grid-area: tiles;
}

/* The count holds still. It is what the difference band below is counting
   against, and a figure you have to scroll back to is a figure you retype. */
.closing-layout__count {
	grid-area: count;
	min-height: 0;
	overflow-y: auto;
}

/* The one region that genuinely overflows, and therefore the only one that
   scrolls: the other tenders, then the shift's evidence tables. */
.closing-layout__detail {
	grid-area: detail;
	display: flex;
	flex-direction: column;
	gap: 24px;
	min-height: 0;
	overflow-y: auto;
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
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto auto;
		grid-template-areas:
			"tiles"
			"count"
			"detail";
	}

	.closing-layout__count,
	.closing-layout__detail {
		overflow: visible;
	}
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
