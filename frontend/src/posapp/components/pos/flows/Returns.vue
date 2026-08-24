<template>
	<v-row justify="center">
		<v-dialog
			v-model="invoicesDialog"
			v-bind="dialogProps"
			scrollable
			class="returns-dialog"
			:theme="isDarkTheme ? 'dark' : 'light'"
		>
			<v-card class="returns-card pos-themed-card" :theme="isDarkTheme ? 'dark' : 'light'">
				<v-card-title class="returns-card__title">
					<div class="returns-card__title-copy">
						<span class="text-h5 text-primary">{{ __("Select Return Invoice") }}</span>
						<span class="returns-card__subtitle">
							{{ __("Search an invoice and continue the return flow without extra steps.") }}
						</span>
					</div>
					<v-btn
						icon="mdi-close"
						variant="text"
						color="medium-emphasis"
						class="returns-card__close"
						:aria-label="__('Close returns dialog')"
						@click="close_dialog"
					/>
				</v-card-title>
				<v-card-text class="returns-card__content">
					<ReturnFinder
						:methods="findMethods"
						:active-method="activeFindMethod"
						:term="findTerm"
						:searching="finding"
						:searched-once="searched_once"
						:search-error="findError"
						:results="dialog_data"
						:selected-sale="selectedSale"
						:cashier="originalCashier"
						:cashier-on-duty="cashierOnDuty"
						:warranty="warranty"
						:lines="returnLines"
						:selection="returnSelection"
						:authorisers="authorisers"
						:no-ticket="noTicketView"
						:refund-methods="refundMethods"
						:refund-method="refundMethod"
						:format-currency="formatReturnCurrency"
						:format-date="formatSaleDate"
						@update:active-method="setFindMethod"
						@update:term="setFindTerm"
						@update:selection="setReturnSelection"
						@update:no-ticket="patchNoTicket"
						@update:refund-method="setRefundMethod"
						@search="search_invoices"
						@select-sale="selectSale"
						@proceed="proceed"
					>
						<template #filters>
							<!-- The old search form's date and amount ranges, kept
							     verbatim. The artboard replaces the four customer boxes
							     (one "por cliente" field now ORs all four server-side) but
							     says nothing about these, and the shipped dialog tells the
							     operator in so many words to reach for the date range when
							     an invoice is old. Losing that while converging a view
							     would be a capability traded for a layout. -->
							<div class="returns-filters">
								<VueDatePicker
									v-model="from_date"
									model-type="format"
									format="dd-MM-yyyy"
									:enable-time-picker="false"
									auto-apply
									class="pos-themed-input"
									@update:model-value="formatFromDate()"
								/>
								<VueDatePicker
									v-model="to_date"
									model-type="format"
									format="dd-MM-yyyy"
									:enable-time-picker="false"
									auto-apply
									class="pos-themed-input"
									@update:model-value="formatToDate()"
								/>
								<v-text-field
									color="primary"
									:label="frappe._('Minimum Amount')"
									class="pos-themed-input"
									hide-details
									v-model="min_amount"
									density="compact"
									type="number"
									inputmode="decimal"
									min="0"
									placeholder="0"
								></v-text-field>
								<v-text-field
									color="primary"
									:label="frappe._('Maximum Amount')"
									class="pos-themed-input"
									hide-details
									v-model="max_amount"
									density="compact"
									type="number"
									inputmode="decimal"
									min="0"
									placeholder="No limit"
								></v-text-field>
								<v-btn block variant="text" @click="clear_search">
									<v-icon start>mdi-refresh</v-icon>
									{{ __("Clear") }}
								</v-btn>
							</div>
						</template>
						<template #results-footer>
							<v-btn
								v-if="has_more_invoices"
								block
								color="primary"
								variant="outlined"
								:loading="loading_more"
								@click="load_more_invoices"
							>
								{{ __("Load More Invoices") }}
							</v-btn>
						</template>
					</ReturnFinder>
				</v-card-text>
				<v-card-actions class="mt-1 returns-card__footer">
					<!-- One primary per screen, and it is not here: "Continue the
					     return" lives inside the finder beside the record it commits,
					     which is the only place a cashier can read what they are about
					     to hand back. Close is a dismissal, so it stays neutral text. -->
					<v-btn variant="text" @click="close_dialog">
						{{ __("Close") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script>
import { ref } from "vue";
import format, { formatUtils } from "../../../format";
import { useHostedSheet } from "../../../composables/pos/shell/useHostedSheet";
import { useInvoiceStore } from "../../../stores/invoiceStore.js";
import { useUIStore } from "../../../stores/uiStore.js";
import { useEmployeeStore } from "../../../stores/employeeStore";
import { useVerticalStore } from "../../../stores/verticalStore";
import { useDialogFullscreen } from "../../../composables/core/useDialogFullscreen";
import { useTheme } from "../../../composables/core/useTheme";
import { getActiveKeymap } from "../../../shortcuts";
import ReturnFinder from "./returns/ReturnFinder.vue";
import { defaultFindMethod, describeFindMethods } from "./returns/findMethods";
import { fetchSaleCashier, runFind } from "./returns/findOriginalSale";
import { buildNoTicketRecord, evaluateNoTicketReturn } from "./returns/noTicketGate";
import {
	CREDIT_NOTE_MINTED_KEY,
	defaultRefundMethod,
	describeRefundMethods,
	resolveRefundMethod,
} from "./returns/refundMethods";
import { defaultSelection, planReturnLines, selectedSourceItems } from "./returns/returnLines";
import { printInvoiceByName } from "../../../utils/printInvoiceByName";
import { resolveWarrantyWindow } from "./returns/warrantyWindow";

/**
 * The operator's half of the no-ticket request. `allowedByProfile` is NOT
 * here: the profile answers that question, the operator cannot, and holding a
 * copy of it in component state means holding a copy that is wrong for the
 * first render — `openRequest`'s immediate watcher runs before `created`
 * wires the POS Profile in.
 */
const emptyNoTicketState = () => ({
	authoriserUser: null,
	signatureTaken: false,
	reason: null,
});

export default {
	components: { ReturnFinder },
	props: {
		openRequest: {
			type: Object,
			default: null,
		},
	},
	mixins: [format],
	// `close` is only ever emitted while hosted as a rail destination — see
	// `useHostedSheet`. The floating modal closes itself.
	emits: ["close"],
	setup(_props, { emit }) {
		const invoiceStore = useInvoiceStore();
		const uiStore = useUIStore();
		const employeeStore = useEmployeeStore();
		const verticalStore = useVerticalStore();
		const theme = useTheme();
		// Fullscreen below 1100 has to mean no inline geometry at all — VOverlay
		// writes width/max-width as inline styles that beat the fullscreen rule.
		const { isFullscreenDialog: isCompactReturns, dialogProps } = useDialogFullscreen({
			breakpoint: 1100,
			width: "min(1120px, 96vw)",
			maxWidth: "1120px",
		});
		// Lives here rather than in `data()` so the hosted-sheet contract can
		// watch it; `this.invoicesDialog` reads and writes it the same way.
		const invoicesDialog = ref(false);
		// The open itself happens in `mounted()`: it needs the company off the
		// POS Profile, which `created` wires onto the instance.
		const hosted = useHostedSheet({ open: invoicesDialog, emit });
		return {
			invoiceStore,
			uiStore,
			employeeStore,
			verticalStore,
			isCompactReturns,
			dialogProps,
			invoicesDialog,
			isHosted: hosted.isHosted,
			isDarkTheme: theme.isDark,
		};
	},
	data: () => ({
		dialog_data: [],
		company: "",
		from_date: null,
		to_date: null,
		from_date_formatted: null,
		to_date_formatted: null,
		min_amount: "",
		max_amount: "",
		pos_profile: "",
		page: 1,
		has_more_invoices: false,
		loading_more: false,
		searched_once: false,

		// ── the finder (docs/POS-RIEL-Y-CAJON-BUILD.md §12 D) ──────────────
		// Which of the five ways is open, what has been typed into it, and what
		// came back. `findError` is kept apart from an empty result on purpose:
		// "no sale matched" sends the cashier to another way, "the search could
		// not run" sends them to a supervisor.
		activeFindMethod: "ticket",
		findTerm: "",
		finding: false,
		findError: null,

		// The resolved original and everything read off it. `return_doc` is the
		// server's answer to `get_invoice_for_return` and stays the single
		// source for the money mapping in `submit_dialog`.
		selectedSale: null,
		return_doc: null,
		originalCashier: null,
		warranty: null,
		returnLines: [],
		returnSelection: {},

		// How the money goes back (DOCUMENTOS_GOLDEN_FLOW §2). Cash by default
		// and always — a refund that defaulted to credit would hand the customer
		// a balance nobody asked for, past a cashier who only reads the one big
		// button.
		refundMethod: defaultRefundMethod(),
		mintingCreditNote: false,

		noTicketState: emptyNoTicketState(),
	}),
	computed: {
		findGates() {
			return {
				// Capability, never a giro: a register that does not track
				// serials simply has four ways instead of five (R3).
				serialIdentity: Boolean(this.verticalStore?.has?.("serial_imei")),
				noReceiptReturns: Number(this.pos_profile?.posa_allow_return_without_invoice) === 1,
			};
		},
		findMethods() {
			// Chips come from the ACTIVE keymap, not from the artboard's F1–F4
			// (R8). Today that resolves to no chips at all, which is the honest
			// answer until the three-file change registers the actions.
			return describeFindMethods(this.findGates, getActiveKeymap());
		},
		/**
		 * The two refund chips, resolved against the SELECTED sale.
		 *
		 * `return_doc` first: it is the server's own answer about the original,
		 * so its customer is the one the credit note would actually be written
		 * against. The list row is the fallback for the moment between choosing
		 * a sale and the detail arriving.
		 */
		refundMethods() {
			return describeRefundMethods({
				customer: this.return_doc?.customer || this.selectedSale?.customer || null,
				walkInCustomer: this.pos_profile?.customer || null,
			});
		},
		authorisers() {
			return this.employeeStore?.terminalEmployees || [];
		},
		cashierOnDuty() {
			return this.employeeStore?.currentCashierDisplay || "";
		},
		returnPlan() {
			return planReturnLines(this.returnLines, this.returnSelection);
		},
		noTicketView() {
			return { allowedByProfile: this.findGates.noReceiptReturns, ...this.noTicketState };
		},
		findContext() {
			return {
				call: (options) => frappe.call(options),
				company: this.company,
				posProfileName: this.pos_profile?.name,
				doctype:
					this.pos_profile && this.pos_profile.create_pos_invoice_instead_of_sales_invoice
						? "POS Invoice"
						: "Sales Invoice",
			};
		},
		formatSaleDate() {
			// The results table's own formatter, kept: it flips ISO to the
			// operator's DD-MM-YYYY and round-trips Arabic numerals, and a
			// register that suddenly printed ISO dates would be a regression
			// hiding inside a redesign.
			return (value) => this.formatDateDisplay(value);
		},
		formatReturnCurrency() {
			// An arrow in a computed, not a method: the child receives this as a
			// prop and a plain method reference would arrive unbound.
			return (value) =>
				`${this.currencySymbol(
					this.selectedSale?.currency || this.pos_profile?.currency,
				)}${this.formatCurrency(value)}`;
		},
	},
	watch: {
		openRequest: {
			handler(request) {
				if (!request) return;
				this.open_dialog(request.company);
			},
			immediate: true,
		},
		from_date() {
			this.formatFromDate();
		},
		to_date() {
			this.formatToDate();
		},
	},
	methods: {
		open_dialog(data) {
			this.invoicesDialog = true;
			this.company = data;
			this.from_date = null;
			this.to_date = null;
			this.from_date_formatted = null;
			this.to_date_formatted = null;
			this.min_amount = "";
			this.max_amount = "";
			this.dialog_data = [];
			this.page = 1;
			this.has_more_invoices = false;
			this.searched_once = false;
			this.reset_finder();
		},
		/**
		 * Everything downstream of "which sale?" — cleared together, because a
		 * half-reset finder is how a second return inherits the first one's
		 * authoriser or its line selection.
		 */
		reset_finder() {
			this.activeFindMethod = defaultFindMethod(this.findGates);
			this.findTerm = "";
			this.finding = false;
			this.findError = null;
			this.selectedSale = null;
			this.return_doc = null;
			this.originalCashier = null;
			this.warranty = null;
			this.returnLines = [];
			this.returnSelection = {};
			this.noTicketState = emptyNoTicketState();
		},
		setFindMethod(id) {
			this.activeFindMethod = id;
			this.findError = null;
		},
		setFindTerm(value) {
			this.findTerm = value;
		},
		setReturnSelection(value) {
			this.returnSelection = value;
		},
		patchNoTicket(patch) {
			this.noTicketState = { ...this.noTicketState, ...patch };
		},
		formatDateDisplay(dateStr) {
			if (!dateStr) return "";
			try {
				const western = formatUtils.fromArabicNumerals(String(dateStr));
				const parts = western.split("-");
				if (parts.length === 3) {
					const formatted = `${parts[2]}-${parts[1]}-${parts[0]}`;
					return formatUtils.toArabicNumerals(formatted);
				}
			} catch (error) {
				console.error("Error formatting date:", error);
			}
			return formatUtils.toArabicNumerals(String(dateStr));
		},
		formatFromDate() {
			if (this.from_date) {
				try {
					let dateString = "";

					// Handle Date object
					if (typeof this.from_date === "object" && this.from_date instanceof Date) {
						const day = String(this.from_date.getDate()).padStart(2, "0");
						const month = String(this.from_date.getMonth() + 1).padStart(2, "0");
						const year = this.from_date.getFullYear();
						dateString = `${day}-${month}-${year}`;
					}
					// Handle string in YYYY-MM-DD format
					else if (typeof this.from_date === "string" && this.from_date.includes("-")) {
						const parts = formatUtils.fromArabicNumerals(this.from_date).split("-");
						if (parts.length === 3) {
							dateString = `${parts[2]}-${parts[1]}-${parts[0]}`;
						} else {
							dateString = formatUtils.fromArabicNumerals(this.from_date);
						}
					}
					// Handle any other format - just display as is
					else {
						dateString = formatUtils.fromArabicNumerals(String(this.from_date));
					}

					this.from_date_formatted = formatUtils.toArabicNumerals(dateString);
				} catch (error) {
					console.error("Error formatting from_date:", error);
					this.from_date_formatted = formatUtils.toArabicNumerals(String(this.from_date));
				}
			} else {
				this.from_date_formatted = null;
			}
		},
		formatToDate() {
			if (this.to_date) {
				try {
					let dateString = "";

					// Handle Date object
					if (typeof this.to_date === "object" && this.to_date instanceof Date) {
						const day = String(this.to_date.getDate()).padStart(2, "0");
						const month = String(this.to_date.getMonth() + 1).padStart(2, "0");
						const year = this.to_date.getFullYear();
						dateString = `${day}-${month}-${year}`;
					}
					// Handle string in YYYY-MM-DD format
					else if (typeof this.to_date === "string" && this.to_date.includes("-")) {
						const parts = formatUtils.fromArabicNumerals(this.to_date).split("-");
						if (parts.length === 3) {
							dateString = `${parts[2]}-${parts[1]}-${parts[0]}`;
						} else {
							dateString = formatUtils.fromArabicNumerals(this.to_date);
						}
					}
					// Handle any other format - just display as is
					else {
						dateString = formatUtils.fromArabicNumerals(String(this.to_date));
					}

					this.to_date_formatted = formatUtils.toArabicNumerals(dateString);
				} catch (error) {
					console.error("Error formatting to_date:", error);
					this.to_date_formatted = formatUtils.toArabicNumerals(String(this.to_date));
				}
			} else {
				this.to_date_formatted = null;
			}
		},
		close_dialog() {
			this.invoicesDialog = false;
		},
		clear_search() {
			this.from_date = null;
			this.to_date = null;
			this.from_date_formatted = null;
			this.to_date_formatted = null;
			this.min_amount = "";
			this.max_amount = "";
			this.dialog_data = [];
			this.page = 1;
			this.has_more_invoices = false;
			this.searched_once = false;
			this.reset_finder();
		},
		search_invoices() {
			this.page = 1;
			this.dialog_data = [];
			this.perform_search();
		},
		/**
		 * Normalise whichever shape the date picker last handed us into the
		 * `YYYY-MM-DD` the endpoint wants, or null.
		 *
		 * Lifted out of the old inline search body unchanged in behaviour: the
		 * picker can hold a Date, a `DD-MM-YYYY` string, a `YYYY-MM-DD` string
		 * or a `DD/MM/YYYY` one depending on how it was last set, and a wrong
		 * guess here silently drops the filter rather than failing.
		 */
		normalizedDate(value) {
			if (!value) return null;
			if (typeof value === "object" && value instanceof Date) {
				return [
					value.getFullYear(),
					String(value.getMonth() + 1).padStart(2, "0"),
					String(value.getDate()).padStart(2, "0"),
				].join("-");
			}
			if (typeof value !== "string") return null;
			const text = formatUtils.fromArabicNumerals(value);
			const parts = text.includes("/") ? text.split("/") : text.split("-");
			if (parts.length !== 3) return null;
			return parts[0].length === 4 ? `${parts[0]}-${parts[1]}-${parts[2]}` : `${parts[2]}-${parts[1]}-${parts[0]}`;
		},
		/**
		 * Run the active way of finding a sale.
		 *
		 * Every route below reaches
		 * `posawesome.posawesome.api.invoices.search_invoices_for_return` —
		 * directly for ticket and customer, and as the second hop for item and
		 * serial (`returns/findOriginalSale.ts`). Naming it here because this
		 * method is where an operator's search becomes a server round trip, and
		 * that is the fact §7's offline claim for `return` rests on: none of
		 * these five ways can answer without the network.
		 */
		async perform_search() {
			this.loading_more = true;
			this.finding = true;
			this.findError = null;

			const parseAmount = (raw) => {
				if (!raw) return null;
				const parsed = parseFloat(formatUtils.fromArabicNumerals(String(raw)));
				return Number.isFinite(parsed) ? parsed : null;
			};

			const outcome = await runFind(this.findContext, this.activeFindMethod, this.findTerm, {
				from_date: this.normalizedDate(this.from_date),
				to_date: this.normalizedDate(this.to_date),
				min_amount: parseAmount(this.min_amount),
				max_amount: parseAmount(this.max_amount),
				page: this.page,
			});

			this.loading_more = false;
			this.finding = false;
			this.searched_once = true;
			this.findError = outcome.error;

			if (outcome.error) {
				console.error("Error searching invoices:", outcome.error);
				this.toastStore.show({ title: __("Error searching invoices"), color: "error" });
				this.dialog_data = this.page === 1 ? [] : this.dialog_data;
				this.has_more_invoices = false;
				return;
			}

			this.dialog_data = this.page === 1 ? outcome.rows : [...this.dialog_data, ...outcome.rows];
			this.has_more_invoices = outcome.hasMore;

			if (!this.dialog_data.length) {
				this.toastStore.show({ title: __("No invoices found"), color: "warning" });
			}
		},
		load_more_invoices() {
			this.page += 1;
			this.perform_search();
		},
		/**
		 * The operator picked an original sale: pull its returnable lines and
		 * everything the panel says about it.
		 *
		 * The detail fetch moves here from `submit_dialog` because the line
		 * picker cannot exist without it — the artboard's whole middle column
		 * is what this call returns. `submit_dialog` then commits exactly what
		 * the cashier read, instead of fetching a second copy of it between the
		 * reading and the button.
		 */
		async selectSale(row) {
			if (!row?.name) return;
			this.selectedSale = row;
			this.return_doc = null;
			this.returnLines = [];
			this.returnSelection = {};
			this.originalCashier = null;
			this.warranty = null;

			let return_doc = null;
			try {
				const { message } = await frappe.call({
					method: "posawesome.posawesome.api.invoices.get_invoice_for_return",
					args: {
						invoice_name: row.name,
						pos_profile: this.pos_profile?.name,
						doctype: this.findContext.doctype,
					},
				});
				return_doc = message;
			} catch (error) {
				console.error("Error loading invoice for return:", error);
				this.toastStore.show({ title: __("Error loading invoice details"), color: "error" });
				return;
			}

			if (!return_doc || !Array.isArray(return_doc.items) || return_doc.items.length === 0) {
				this.toastStore.show({
					title: __("No returnable items found for this invoice"),
					color: "warning",
				});
				return;
			}

			this.return_doc = return_doc;
			this.returnLines = return_doc.items;
			// Everything, at full quantity — see returnLines.defaultSelection for
			// why the artboard's partial tick is a state and not a default.
			this.returnSelection = defaultSelection(return_doc.items);
			// `frappe.datetime` is the SERVER's day, which is the one the warranty
			// window was stamped against. Falling back to the browser's clock is
			// the lesser evil of two — a register with a skewed clock reads the
			// window a day out; a register with no date at all cannot say whether
			// the return needs a supervisor.
			// The original's customer decides whether a credit note is even
			// legal, and the original just changed — see `setRefundMethod`.
			this.refundMethod = resolveRefundMethod(this.refundMethod, {
				customer: return_doc.customer || row.customer || null,
				walkInCustomer: this.pos_profile?.customer || null,
			});
			this.warranty = resolveWarrantyWindow(
				return_doc,
				frappe?.datetime?.nowdate?.() || new Date().toISOString().slice(0, 10),
			);
			this.originalCashier = await fetchSaleCashier(this.findContext, row.name);
		},
		/**
		 * The one primary action. It ROUTES; it does not decide. The supervised
		 * path's decision belongs to `evaluateNoTicketReturn` and is re-checked
		 * inside `return_without_invoice` rather than trusted from the render
		 * that happened to draw the button enabled.
		 */
		proceed() {
			if (this.activeFindMethod === "noReceipt") {
				this.return_without_invoice();
				return;
			}
			if (this.refundMethod === "credit_note") {
				this.submit_credit_note();
				return;
			}
			this.submit_dialog();
		},
		/**
		 * The chosen refund method, re-checked against the current sale.
		 *
		 * A cashier who picks Nota de crédito on a named customer and then
		 * changes their mind about WHICH sale must not carry the choice onto a
		 * counter ticket, where the server would refuse it after the press.
		 */
		setRefundMethod(method) {
			this.refundMethod = resolveRefundMethod(method, {
				customer: this.return_doc?.customer || this.selectedSale?.customer || null,
				walkInCustomer: this.pos_profile?.customer || null,
			});
		},
		/**
		 * «Nota de crédito» — minted server-side, printed, and that is the
		 * whole act. It never reaches the cart or the tender screen: a credit
		 * note is a submitted return with no payments, and Cobro has no way to
		 * express paying a refund with nothing.
		 */
		async submit_credit_note() {
			const return_doc = this.return_doc;
			const chosen = selectedSourceItems(return_doc?.items, this.returnPlan);
			if (!return_doc || !chosen.length) {
				this.toastStore.show({
					title: __("Choose at least one item to return"),
					color: "warning",
				});
				return;
			}
			if (this.mintingCreditNote) return;
			this.mintingCreditNote = true;
			try {
				const { message } = await frappe.call({
					method:
						"posawesome.posawesome.api.invoice_processing.credit_note.create_credit_note_return",
					args: {
						pos_profile: this.pos_profile?.name,
						invoice_name: return_doc.name,
						items: chosen.map((item) => ({
							item_code: item.item_code,
							qty: Math.abs(Number(item.qty) || 0),
						})),
						doctype: return_doc.doctype || "Sales Invoice",
					},
				});
				if (!message?.name) {
					throw new Error(__("Server returned no credit note."));
				}
				this.toastStore.show({
					title: __("Credit note issued"),
					message: __(CREDIT_NOTE_MINTED_KEY, [
						message.customer_name || message.customer,
						message.name,
					]),
					color: "success",
				});
				// Printed here rather than left to the operator: the folio IS the
				// customer's claim on the balance, and a credit note nobody
				// printed is a balance nobody can present.
				await printInvoiceByName(
					{ ...(this.pos_profile || {}), print_format: message.print_format },
					message.doctype,
					message.name,
				);
				this.invoicesDialog = false;
			} catch (error) {
				console.error("Error issuing credit note:", error);
				this.toastStore.show({
					title: this.serverMessage(error) || __("Could not issue the credit note"),
					color: "error",
				});
			} finally {
				this.mintingCreditNote = false;
			}
		},
		/**
		 * Frappe throws carry their text in `_server_messages`, never in
		 * `message` — so a bare `error.message` on a refusal shows the generic
		 * fallback and hides the sentence the server wrote for the cashier.
		 */
		serverMessage(error) {
			try {
				const parsed = JSON.parse(error?._server_messages || "[]");
				const first = parsed.length ? JSON.parse(parsed[0]) : null;
				const text = first?.message || "";
				return frappe?.utils?.strip_html ? frappe.utils.strip_html(text) : text;
			} catch {
				return "";
			}
		},
		noTicketRequest() {
			return {
				allowedByProfile: this.noTicketView.allowedByProfile,
				authorisers: this.authorisers,
				authoriserUser: this.noTicketState.authoriserUser,
				signatureTaken: this.noTicketState.signatureTaken,
				reason: this.noTicketState.reason,
			};
		},
		return_without_invoice() {
			const record = buildNoTicketRecord(this.noTicketRequest());
			if (!record) {
				// Refused. The panel is already naming every blocker, so a toast
				// would only make the cashier read the same list somewhere else.
				console.warn(
					"[POSA][Returns] no-ticket return refused",
					evaluateNoTicketReturn(this.noTicketRequest()).blockers,
				);
				return;
			}

			// The record is NOT attached to the document, and that is a gap worth
			// stating rather than papering over: `Sales Invoice` has no
			// `posa_return_authorised_by` / `posa_return_reason` custom field
			// (fixtures carry only `posa_return_validity_days` and
			// `posa_return_valid_upto`), and Frappe drops an unknown key from a
			// doc silently. Setting them here would look like an audit trail and
			// persist nothing — the worst of the three options. What this gate
			// does today is REFUSE the return until a supervisor is named, a
			// signature is taken and a reason is given; §5.4's exception inbox
			// needs those two fields before it can read any of it back.
			console.info("[POSA][Returns] no-ticket return authorised", record);

			const invoice_doc = {};
			invoice_doc.items = [];
			invoice_doc.is_return = 1;
			const data = { invoice_doc };
			this.eventBus.emit("load_return_invoice", data);
			this.invoicesDialog = false;
		},
		async submit_dialog() {
			const return_doc = this.return_doc;
			// Which rows, at which quantities — the ONLY thing the picker changes
			// about this document. Every money field below is still the server's
			// own value, copied across untouched.
			const chosen = selectedSourceItems(return_doc?.items, this.returnPlan);

			if (!return_doc || !chosen.length) {
				this.toastStore.show({
					title: __("Choose at least one item to return"),
					color: "warning",
				});
				return;
			}

			if (chosen.length) {
				const invoice_doc = {};
				const items = [];

				chosen.forEach((item) => {
					const new_item = { ...item };
					// reference original invoice row for backend validation
					if (return_doc.doctype === "POS Invoice") {
						new_item.pos_invoice_item = item.name;
					} else {
						new_item.sales_invoice_item = item.name;
					}
					delete new_item.name;

					// Preserve original pricing and discounts
					new_item.rate = item.rate;
					new_item.price_list_rate = item.price_list_rate;
					new_item.discount_percentage = item.discount_percentage;
					new_item.discount_amount = item.discount_amount;
					new_item.is_free_item = item.is_free_item;
					new_item.net_rate = item.net_rate;
					new_item.net_amount = item.net_amount > 0 ? item.net_amount * -1 : item.net_amount;
					new_item.locked_price = true;

					// Make sure quantities are negative for returns
					new_item.qty = item.qty > 0 ? item.qty * -1 : item.qty;
					new_item.stock_qty = item.stock_qty > 0 ? item.stock_qty * -1 : item.stock_qty;
					new_item.amount = item.amount > 0 ? item.amount * -1 : item.amount;
					items.push(new_item);
				});

				invoice_doc.items = items;
				invoice_doc.is_return = 1;
				invoice_doc.return_against = return_doc.name;
				invoice_doc.customer = return_doc.customer;
				invoice_doc.discount_amount = return_doc.discount_amount;
				invoice_doc.additional_discount_percentage = return_doc.additional_discount_percentage;
				const normalizeRefundAmount = (value) => {
					const amount = this.flt(value || 0, this.currency_precision);
					return amount ? -Math.abs(amount) : 0;
				};
				invoice_doc.payments = Array.isArray(return_doc.payments)
					? return_doc.payments.map((payment) => ({
							mode_of_payment: payment.mode_of_payment,
							amount: normalizeRefundAmount(payment.amount),
							base_amount:
								payment.base_amount !== undefined
									? normalizeRefundAmount(payment.base_amount)
									: payment.base_amount,
							default: payment.default,
							account: payment.account,
							type: payment.type,
							currency: payment.currency,
							conversion_rate: payment.conversion_rate,
						}))
					: [];

				// Make sure grand_total is negative for returns
				if (return_doc.grand_total > 0) {
					invoice_doc.grand_total = return_doc.grand_total * -1;
				} else {
					invoice_doc.grand_total = return_doc.grand_total;
				}

				// Cap on how much of this return may be refunded as cash: only what
				// the customer actually paid on the original invoice. For an unpaid
				// (credit) invoice this is 0, so the return defaults to a credit note
				// that reduces the customer's balance instead of paying out cash.
				const originalPaid = this.flt(
					return_doc.paid_amount != null
						? return_doc.paid_amount
						: (return_doc.grand_total || 0) - (return_doc.outstanding_amount || 0),
					this.currency_precision,
				);
				invoice_doc.posa_refundable_amount = originalPaid > 0 ? originalPaid : 0;

				// These fields ensure proper return handling
				invoice_doc.update_stock = 1;
				invoice_doc.pos_profile = this.pos_profile.name;
				invoice_doc.company = this.company;

				const data = { invoice_doc, return_doc };

				this.eventBus.emit("load_return_invoice", data);
				this.invoicesDialog = false;
			}
		},
	},
	created: function () {
		// Kept on the instance so `beforeUnmount` can remove THIS listener. A
		// bare `off("open_returns")` strips every listener on the event —
		// including the shell's — and this component now unmounts every time
		// the rail leaves Devolución.
		this.handleOpenReturnsEvent = (data) => {
			this.open_dialog(data);
		};
		this.eventBus.on("open_returns", this.handleOpenReturnsEvent);

		this.$watch(
			() => this.uiStore.posProfile,
			(profile) => {
				if (profile) this.pos_profile = profile;
			},
			{ deep: false, immediate: true },
		);
	},
	mounted() {
		// Hosted by the rail: the destination being chosen IS the open request
		// (see `useHostedSheet`). The floating copy keeps waiting for the bus.
		if (this.isHosted) {
			this.open_dialog(this.uiStore.posProfile?.company || this.pos_profile?.company || "");
		}
	},
	beforeUnmount() {
		this.eventBus.off("open_returns", this.handleOpenReturnsEvent);
	},
};
</script>

<style scoped>
.returns-card {
	display: flex;
	flex-direction: column;
	max-height: min(92vh, 100%);
	background: var(--pos-surface-raised) !important;
	color: var(--pos-text-primary) !important;
	border: 1px solid var(--pos-border);
}

.returns-card__title {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	padding: 20px 20px 12px;
	border-bottom: 1px solid var(--pos-border);
}

.returns-card__title-copy {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.returns-card__subtitle {
	font-size: 0.88rem;
	line-height: 1.4;
	color: var(--pos-text-secondary);
}

/* The finder owns the only scrollport inside this card (59c5fe1ad): it is a
 * flex column whose line list scrolls, so a second `overflow: auto` here would
 * nest one scrollbar inside another. `min-height: 0` is the half that lets the
 * child shrink at all — flex items default to `min-height: auto`. */
.returns-card__content {
	display: flex;
	flex-direction: column;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	padding: 0;
}

.returns-filters {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-top: 8px;
}

.returns-card__footer {
	position: sticky;
	bottom: 0;
	display: flex;
	justify-content: flex-end;
	gap: 12px;
	padding: 14px 20px 18px;
	background: linear-gradient(180deg, transparent, var(--pos-surface) 30%);
	border-top: 1px solid var(--pos-border);
}


@media (max-width: 1279px) {
	.returns-card {
		max-height: 100vh;
		height: 100vh;
		border-radius: 0;
	}

	.returns-card__title {
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 16px 16px 10px;
		background: var(--pos-surface);
		border-bottom: 1px solid var(--pos-border);
	}

	.returns-card__content {
		padding-left: 12px;
		padding-right: 12px;
		padding-bottom: 12px;
	}

	.returns-card__footer {
		padding: 12px;
	}

	.returns-card__footer .v-btn {
		flex: 1 1 0;
		min-height: 46px;
	}
}

@media (max-width: 767px) {
	.returns-result-card {
		padding: 12px;
	}

	.returns-result-card__top {
		flex-direction: column;
	}

	.returns-result-card__amount {
		white-space: normal;
	}

	.returns-card__subtitle {
		font-size: 0.82rem;
	}
}
</style>
