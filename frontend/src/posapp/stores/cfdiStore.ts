/**
 * Pinia store for the Facturación (CFDI stamping) surface.
 *
 * Holds the SAT catalogs (fetched once per profile via the bootstrap
 * endpoint), the invoice search state, and the stamp state machine for the
 * currently open invoice. Online-only: nothing here queues offline —
 * stamping is a live legal act against the PAC.
 *
 * Options API style (state/getters/actions) to match syncStore and friends.
 */
import { defineStore } from "pinia";

import {
	type CfdiBootstrap,
	type CfdiInvoiceDetail,
	type CfdiInvoiceRow,
	type CfdiUseRow,
	type StampFiscalData,
	type StampResult,
	getCfdiBootstrap,
	getInvoiceCfdi,
	searchCfdiInvoices,
	stampInvoice,
} from "../api/cfdi";
import { extractServerErrorMessage } from "../utils/serverErrorToast";

export type CfdiStampPhase = "idle" | "stamping" | "success" | "error";

export const useCfdiStore = defineStore("cfdi", {
	state: () => ({
		profileName: "",
		bootstrap: null as CfdiBootstrap | null,
		bootstrapLoading: false,

		rows: [] as CfdiInvoiceRow[],
		searchTerm: "",
		statusFilter: "all",
		searching: false,
		searchError: "",

		detail: null as CfdiInvoiceDetail | null,
		detailLoading: false,
		detailError: "",

		stampPhase: "idle" as CfdiStampPhase,
		stampResult: null as StampResult | null,
		// The PAC's rejection text, verbatim — the operator must see WHY.
		stampError: "",
	}),

	getters: {
		enabled(state): boolean {
			return Boolean(state.bootstrap?.enabled);
		},
		catalogs(state) {
			return (
				state.bootstrap?.catalogs ?? {
					tax_regimes: [],
					cfdi_uses: [],
					payment_options: [],
					payment_methods: [],
				}
			);
		},
		/**
		 * Uso CFDI options narrowed to the selected régimen — SAT rejects an
		 * incompatible pair, so don't offer it. An empty compatibility list on
		 * a row means "no restriction recorded"; keep those visible.
		 */
		usesForRegime() {
			return (regime: string): CfdiUseRow[] => {
				const uses: CfdiUseRow[] = this.catalogs.cfdi_uses;
				if (!regime) return uses;
				return uses.filter(
					(use) => !use.tax_regimes.length || use.tax_regimes.includes(regime),
				);
			};
		},
	},

	actions: {
		async loadBootstrap(profileName: string, force = false) {
			if (!profileName) return;
			if (!force && this.bootstrap && this.profileName === profileName) return;
			this.bootstrapLoading = true;
			try {
				this.profileName = profileName;
				this.bootstrap = await getCfdiBootstrap(profileName);
			} catch (error) {
				console.error("cfdi: bootstrap failed", error);
				this.bootstrap = { enabled: false, reason: "load_failed" };
			} finally {
				this.bootstrapLoading = false;
			}
		},

		async search() {
			if (!this.profileName) return;
			this.searching = true;
			this.searchError = "";
			try {
				this.rows = await searchCfdiInvoices(this.profileName, {
					search: this.searchTerm,
					status: this.statusFilter,
					limit: 30,
				});
			} catch (error) {
				console.error("cfdi: search failed", error);
				this.searchError = extractServerErrorMessage(error);
				this.rows = [];
			} finally {
				this.searching = false;
			}
		},

		async openInvoice(invoiceName: string) {
			this.detail = null;
			this.detailError = "";
			this.detailLoading = true;
			this.resetStampState();
			try {
				this.detail = await getInvoiceCfdi(invoiceName);
			} catch (error) {
				console.error("cfdi: detail failed", error);
				this.detailError = extractServerErrorMessage(error);
			} finally {
				this.detailLoading = false;
			}
		},

		closeInvoice() {
			this.detail = null;
			this.detailError = "";
			this.resetStampState();
		},

		resetStampState() {
			this.stampPhase = "idle";
			this.stampResult = null;
			this.stampError = "";
		},

		/**
		 * Fire the stamp. Re-entrancy guard: while a stamp is in flight the
		 * second tap is ignored client-side; the server's row lock +
		 * is_stamped guard is the real dedupe, this just avoids a pointless
		 * round trip.
		 */
		async stamp(fiscal: StampFiscalData): Promise<StampResult | null> {
			if (!this.detail || this.stampPhase === "stamping") return null;
			this.stampPhase = "stamping";
			this.stampError = "";
			try {
				const result = await stampInvoice(
					this.detail.invoice.name,
					this.profileName,
					fiscal,
				);
				this.stampResult = result;
				this.stampPhase = "success";
				// Reflect the new state in the open detail + the search rows so
				// the list badge flips without a refetch.
				this.detail.invoice.is_stamped = true;
				this.detail.invoice.mx_uuid = result.uuid;
				this.detail.files = result.files || this.detail.files;
				const row = this.rows.find((r) => r.name === result.invoice);
				if (row) {
					row.stamp_status = "stamped";
					row.mx_uuid = result.uuid;
					row.stamp_error = "";
				}
				return result;
			} catch (error) {
				console.error("cfdi: stamp failed", error);
				this.stampError = extractServerErrorMessage(error);
				this.stampPhase = "error";
				return null;
			}
		},
	},
});
