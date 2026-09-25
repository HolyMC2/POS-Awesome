/**
 * Provider-financed credit sales («venta a crédito») on this register.
 *
 * Holds two things:
 *  - the register's credit CONTEXT from `mercado.api.pos_credit.get_context`
 *    (whether credit sales are on here, the providers, each provider's ticket
 *    shape, required documents and ticket print format). Nothing is loaded
 *    unless the POS Profile carries `mercado_credit_sales`, the flag the
 *    mercado app installs; registers without it keep today's behaviour.
 *  - the DRAFT the cashier declared for the sale on screen: the provider's
 *    credit price and down payment. Applying it reprices the covered cart lines
 *    (through `Invoice.vue`, which owns every line write, on the bus), keeps
 *    their own prices for a later removal, writes the credit fields on the live
 *    invoice document and becomes the provider payment row at submit.
 *
 * A Pinia store (not a module-level ref) because lazy chunks evaluate the entry
 * bundle a second time; the pinia instance is pinned per document.
 */
import { defineStore } from "pinia";
import { bus } from "../bus";
import { parseBooleanSetting } from "../utils/stock";
import { useInvoiceStore } from "./invoiceStore";
import { useUIStore } from "./uiStore";
import {
	applyCreditToDoc,
	creditLinesFromItems,
	creditSubmission,
	defaultCoveredRowIds,
	planCreditReprice,
	planCreditRestore,
	summarizeCredit,
	type CreditDraft,
	type CreditLinePricesIntent,
	type CreditSubmission,
	type CreditSummary,
} from "../composables/pos/credit/creditMath";
import {
	loadCreditContext,
	type CreditContext,
	type CreditProviderOption,
} from "../components/pos/credit/creditApi";

export type { CreditContext, CreditDocumentKind, CreditProviderOption } from "../components/pos/credit/creditApi";

declare const frappe: any;

/** How long the cart may take to reprice and re-send the payment document. */
const REPRICE_TIMEOUT_MS = 30000;

/** Ask the cart to reprice; resolves with its `credit:repriced` answer. */
const requestReprice = (intent: CreditLinePricesIntent): Promise<boolean> =>
	new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const done = (payload?: { ok?: boolean }) => {
			bus.off("credit:repriced", done);
			if (timer) clearTimeout(timer);
			resolve(Boolean(payload?.ok));
		};
		bus.on("credit:repriced", done);
		timer = setTimeout(() => done({ ok: false }), REPRICE_TIMEOUT_MS);
		bus.emit("credit:line-prices", intent);
	});

const currencyPrecision = (): number => {
	const profilePrecision = parseInt(useUIStore().posProfile?.posa_decimal_precision as any, 10);
	if (!Number.isNaN(profilePrecision)) return profilePrecision;
	const fallback = Number(frappe?.defaults?.get_default?.("currency_precision"));
	return Number.isFinite(fallback) && fallback > 0 ? fallback : 2;
};

export const useCreditSaleStore = defineStore("creditSale", {
	state: () => ({
		context: null as CreditContext | null,
		contextProfile: "",
		contextLoading: false,
		contextError: "",
		draft: null as CreditDraft | null,
		/** The invoice (server draft name) the credit declaration belongs to. */
		draftInvoice: "" as string,
		sheetOpen: false,
		/** The cart is repricing the covered lines for the draft. */
		repricing: false,
		/** The last repricing could not refresh the payment screen. */
		repriceFailed: false,
		/** Invoice whose after-sale paperwork dialog is open. */
		afterSaleInvoice: null as string | null,
	}),
	getters: {
		enabled: (state): boolean => Boolean(state.context?.enabled),
		providers: (state): CreditProviderOption[] =>
			state.context?.enabled ? state.context.providers || [] : [],
		/** Every enabled provider's Mode of Payment: driven by the credit sheet only. */
		providerModes(): Set<string> {
			return new Set(
				this.providers.map((provider) => provider.mode_of_payment || "").filter(Boolean),
			);
		},
		activeProvider(state): CreditProviderOption | null {
			if (!state.draft) return null;
			return this.providers.find((provider) => provider.name === state.draft?.provider) || null;
		},
		summary(state): CreditSummary | null {
			const provider = this.activeProvider;
			if (!state.draft || !provider) return null;
			return summarizeCredit(
				state.draft,
				provider.shape,
				useInvoiceStore().invoiceDoc?.items || [],
				currencyPrecision(),
			);
		},
		/** The provider's share, treated as already settled on the pay screen. */
		providerPayment(): number {
			return this.summary?.providerPayment || 0;
		},
		submission(state): CreditSubmission | null {
			const provider = this.activeProvider;
			const summary = this.summary;
			if (!state.draft || !provider || !summary) return null;
			return creditSubmission(state.draft, provider, summary);
		},
		/** A declared credit sale that cannot be submitted yet. */
		blocked(state): boolean {
			return Boolean(state.draft) && !this.submission;
		},
	},
	actions: {
		profileAllows(profile: any): boolean {
			return parseBooleanSetting(profile?.mercado_credit_sales);
		},
		async loadContext(profile: any, { force = false } = {}): Promise<CreditContext | null> {
			const name = String(profile?.name || "");
			if (!name || !this.profileAllows(profile)) {
				this.context = null;
				this.contextProfile = "";
				return null;
			}
			if (!force && this.context && this.contextProfile === name) return this.context;
			this.contextLoading = true;
			this.contextError = "";
			try {
				// GET, through the shared per-page cache the credit surfaces read too.
				const context = await loadCreditContext(name, { force });
				this.context = context || null;
				this.contextProfile = name;
				return this.context;
			} catch (error: any) {
				this.context = null;
				this.contextProfile = "";
				this.contextError = error?.message || "";
				return null;
			} finally {
				this.contextLoading = false;
			}
		},
		isProviderMode(mode: string | null | undefined): boolean {
			return Boolean(mode) && this.providerModes.has(String(mode));
		},
		/** A profile copy whose `payments` omit provider modes, for tender chips. */
		tenderProfile<T extends { payments?: readonly any[] | null } | null | undefined>(profile: T): T {
			if (!profile || !this.providerModes.size || !Array.isArray(profile.payments)) return profile;
			return {
				...profile,
				payments: profile.payments.filter((row: any) => !this.isProviderMode(row?.mode_of_payment)),
			};
		},
		openSheet() {
			if (this.enabled) this.sheetOpen = true;
		},
		closeSheet() {
			this.sheetOpen = false;
		},
		/**
		 * Declare the credit and price the ticket for it: the covered lines carry
		 * the credit price (split) or the down payment (enganche). Resolves once
		 * the payment screen has the repriced document, false if it could not.
		 */
		async apply(draft: CreditDraft): Promise<boolean> {
			const provider = this.providers.find((row) => row.name === draft.provider);
			if (!provider) return false;
			const cart = useInvoiceStore().items;
			const plan = planCreditReprice(
				draft,
				provider.shape,
				cart,
				currencyPrecision(),
				this.draft?.lineRowIds || [],
			);
			this.draft = { ...draft, lineRowIds: [...draft.lineRowIds], originalPrices: plan.originalPrices };
			this.draftInvoice = String(useInvoiceStore().invoiceDoc?.name || "");
			this.syncDoc();
			return this.reprice({ set: plan.set, restore: plan.restore });
		},
		/** Back to a plain sale: every covered line returns to its own price. */
		async remove(): Promise<boolean> {
			const plan = planCreditRestore(this.draft, useInvoiceStore().items);
			this.draft = null;
			this.draftInvoice = "";
			this.syncDoc();
			if (!plan.restore.length) return true;
			return this.reprice({ set: [], restore: plan.restore });
		},
		async reprice(intent: CreditLinePricesIntent): Promise<boolean> {
			this.repricing = true;
			this.repriceFailed = false;
			try {
				const ok = await requestReprice(intent);
				this.repriceFailed = !ok;
				return ok;
			} finally {
				this.repricing = false;
			}
		},
		/**
		 * Bind the declaration to the document now on the payment screen.
		 *
		 * Same invoice → keep the draft and re-apply it (the server copy lost the
		 * line flags when the cart was re-saved). Another invoice → the draft
		 * belonged to a different sale; a resumed draft that the server saved
		 * as financed is adopted back from its own fields.
		 */
		adoptDoc(doc: any = useInvoiceStore().invoiceDoc) {
			if (!this.enabled || !doc) return;
			const name = String(doc.name || "");
			if (this.draft && (!this.draftInvoice || !name || this.draftInvoice === name)) {
				if (name) this.draftInvoice = name;
				this.syncDoc(doc);
				return;
			}
			this.draft = null;
			this.draftInvoice = "";
			const provider = this.providers.find((row) => row.name === doc.credit_provider);
			if (!parseBooleanSetting(doc.is_financed) || !provider || doc.is_return) {
				this.syncDoc(doc);
				return;
			}
			const lines = creditLinesFromItems(doc.items || []);
			const flagged = (doc.items || [])
				.filter((item: any) => parseBooleanSetting(item?.mercado_financed) && item?.posa_row_id)
				.map((item: any) => String(item.posa_row_id));
			const positive = (value: any): number | null => {
				const parsed = Number(value);
				return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
			};
			const enganche = Number(doc.enganche);
			this.draft = {
				provider: provider.name,
				lineRowIds: flagged.length ? flagged : defaultCoveredRowIds(lines),
				creditPrice: positive(doc.customer_offered_price),
				enganche: Number.isFinite(enganche) && enganche >= 0 ? enganche : null,
				planMonths: positive(doc.plan_months),
				planMonthly: positive(doc.plan_monthly),
				// The saved sale already carries the credit prices; its own prices
				// come back from the price list if the credit is removed.
				originalPrices: {},
			};
			this.draftInvoice = name;
			this.syncDoc(doc);
			// Keep the covered lines at those prices through any repricing.
			bus.emit("credit:line-prices", { set: [], restore: [], lock: [...this.draft.lineRowIds], refresh: false });
		},
		/** Keep the live document in step with the draft (or clear it). */
		syncDoc(doc: any = useInvoiceStore().invoiceDoc) {
			if (!this.enabled || !doc) return;
			applyCreditToDoc(doc, this.submission);
		},
		/** A new sale starts without a credit declaration. */
		reset() {
			this.draft = null;
			this.draftInvoice = "";
			this.sheetOpen = false;
			this.repricing = false;
			this.repriceFailed = false;
		},
		/** The ticket format for a financed invoice, or null for any other. */
		printFormatFor(doc: any): string | null {
			if (!doc || !parseBooleanSetting(doc.is_financed)) return null;
			const provider = (this.context?.providers || []).find((row) => row.name === doc.credit_provider);
			return provider?.print_format || null;
		},
		openAfterSale(invoice: string) {
			this.afterSaleInvoice = invoice || null;
		},
		closeAfterSale() {
			this.afterSaleInvoice = null;
		},
	},
});
