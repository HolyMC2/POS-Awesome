import { ref, watch, computed, unref, type Ref } from "vue";
import {
	isOffline,
	getCachedStoredValueSnapshot,
	saveStoredValueSnapshot,
} from "../../../../offline/index";

declare const frappe: any;

export interface RedemptionLogicOptions {
	invoiceDoc: Ref<any>;
	posProfile: Ref<any>;
	customerInfo?: Ref<any>;
	currencyPrecision: Ref<number>;
	formatFloat: (_val: any, _prec?: number) => number;
	stores?: {
		toastStore?: any;
	};
	onClearAmounts?: () => void;
}

export function useRedemptionLogic(options: RedemptionLogicOptions) {
	const { invoiceDoc, posProfile, customerInfo, currencyPrecision, formatFloat, stores } =
		options;

	// State
	const loyalty_amount = ref(0);
	const redeemed_customer_credit = ref(0);
	const customer_credit_dict = ref<any[]>([]);
	const available_customer_credit = computed(() => {
		return customer_credit_dict.value.reduce(
			(total, row) => total + normalizeFloat(row?.total_credit || 0),
			0,
		);
	});

	const available_points_amount = computed(() => {
		const info = unref(customerInfo) || {};
		const doc = unref(invoiceDoc);
		const profile = unref(posProfile);

		if (!doc || !info?.loyalty_points) {
			return 0;
		}

		let amount =
			normalizeFloat(info.loyalty_points) *
			normalizeFloat(info.conversion_factor || 1);

		if (doc.currency && profile?.currency && doc.currency !== profile.currency) {
			amount = normalizeFloat(amount / normalizeFloat(doc.conversion_rate || 1));
		}

		return amount;
	});

	/**
	 * «Acumula $Y con esta compra» — the socket `walletSummary.ts` left null.
	 *
	 * `null` still means NOT AVAILABLE, and it stays null for every register
	 * that has not switched customer cards on, for every unenrolled customer
	 * and for every offline sale. What changed is that an enrolled customer on
	 * a card-enabled register now has an answer, and it comes from the SERVER —
	 * `stored_value.get_cashback_preview`, which computes the accrual with
	 * ERPNext's own `cint(eligible / collection_factor)` truncation.
	 *
	 * It is not derived here even though `conversion_factor` is already in
	 * `customer_info`: `collection_factor` is a TIER value, chosen from the
	 * customer's total spend WITH this sale folded in, and the client has
	 * neither the tiers nor the spend. A locally computed figure would agree
	 * with the posted accrual right up until a customer crossed a tier.
	 */
	const cashback_accrual = ref<number | null>(null);

	/** ERPNext: `flt(grand_total) - cint(loyalty_amount)` on a fresh sale. */
	const cashbackEligibleAmount = computed(() => {
		const doc = unref(invoiceDoc);
		if (!doc || doc.is_return) return null;
		const total = normalizeFloat(doc.grand_total ?? doc.rounded_total ?? 0);
		const loyaltyCovered = Math.trunc(normalizeFloat(unref(loyalty_amount) || 0));
		const eligible = normalizeFloat(total - loyaltyCovered);
		return eligible > 0 ? eligible : 0;
	});

	const cashbackAsksTheServer = computed(() => {
		const profile = unref(posProfile);
		const info = unref(customerInfo) || {};
		return Boolean(
			profile?.posa_use_customer_cards &&
				profile?.company &&
				String(info.loyalty_program ?? "").trim() &&
				String(unref(invoiceDoc)?.customer ?? "").trim(),
		);
	});

	let accrualTimer: ReturnType<typeof setTimeout> | null = null;
	// A cart changes faster than a round trip; only the newest answer may be
	// drawn, or a deleted line leaves its accrual on screen.
	let accrualRequest = 0;

	const requestCashbackPreview = () => {
		const token = ++accrualRequest;
		if (!cashbackAsksTheServer.value || isOffline()) {
			cashback_accrual.value = null;
			return;
		}

		const eligible = cashbackEligibleAmount.value;
		if (eligible === null || eligible <= 0) {
			cashback_accrual.value = null;
			return;
		}

		const doc = unref(invoiceDoc);
		const profile = unref(posProfile);
		const call = frappe.call("posawesome.posawesome.api.stored_value.get_cashback_preview", {
			customer: doc?.customer,
			company: profile?.company,
			eligible_amount: eligible,
		});
		if (!call || typeof call.then !== "function") return;

		call
			.then((response: any) => {
				if (token !== accrualRequest) return;
				const preview = response?.message;
				const value = normalizeFloat(preview?.value ?? 0);
				cashback_accrual.value = preview?.enrolled && value > 0 ? value : null;
			})
			.catch(() => {
				if (token !== accrualRequest) return;
				// A refusal is not a zero. Absent, like every other unknown on
				// this card.
				cashback_accrual.value = null;
			});
	};

	const scheduleCashbackPreview = () => {
		if (accrualTimer) clearTimeout(accrualTimer);
		accrualTimer = setTimeout(requestCashbackPreview, 250);
	};

	const getMaxRedeemableCustomerCredit = () => {
		const doc = unref(invoiceDoc);
		if (!doc) {
			return 0;
		}

		const invoiceTotal = normalizeFloat(doc.rounded_total || doc.grand_total || 0);
		const loyaltyCovered = normalizeFloat(unref(loyalty_amount) || 0);
		return Math.max(normalizeFloat(invoiceTotal - loyaltyCovered), 0);
	};

	// Get available customer credit
	const get_available_credit = (use_credit: boolean) => {
		if (options.onClearAmounts) {
			options.onClearAmounts();
		}

		if (use_credit) {
			const customer = unref(invoiceDoc)?.customer;
			const company = unref(posProfile)?.company;

			if (!customer || !company) return;

			if (isOffline()) {
				const cachedSnapshot = getCachedStoredValueSnapshot(customer, company);
				const data = Array.isArray(cachedSnapshot?.sources)
					? JSON.parse(JSON.stringify(cachedSnapshot.sources))
					: [];
				if (data.length) {
					const doc = unref(invoiceDoc);
					const amount = doc.rounded_total || doc.grand_total;
					let remainAmount = amount;
					data.forEach((row: any) => {
						if (remainAmount > 0) {
							if (remainAmount >= row.total_credit) {
								row.credit_to_redeem = row.total_credit;
								remainAmount -= row.total_credit;
							} else {
								row.credit_to_redeem = remainAmount;
								remainAmount = 0;
							}
						} else {
							row.credit_to_redeem = 0;
						}
					});
					customer_credit_dict.value = data;
				} else {
					customer_credit_dict.value = [];
				}
				return;
			}

			frappe
				.call(
					"posawesome.posawesome.api.payments.get_available_credit",
					{
						customer,
						company,
					},
				)
				.then((r: any) => {
					const data = r.message;
					if (data && data.length) {
						saveStoredValueSnapshot(customer, company, data);
						const doc = unref(invoiceDoc);
						const amount = doc.rounded_total || doc.grand_total;
						let remainAmount = amount;
						data.forEach((row: any) => {
							if (remainAmount > 0) {
								if (remainAmount >= row.total_credit) {
									row.credit_to_redeem = row.total_credit;
									remainAmount -= row.total_credit;
								} else {
									row.credit_to_redeem = remainAmount;
									remainAmount = 0;
								}
							} else {
								row.credit_to_redeem = 0;
							}
						});
						customer_credit_dict.value = data;
					} else {
						customer_credit_dict.value = [];
					}
				});
		} else {
			customer_credit_dict.value = [];
		}
	};

	// Watchers
	const normalizeFloat = (value: any, precision?: number) => {
		const parser =
			formatFloat || ((v: any) => parseFloat(String(v)) || 0);
		const prec = precision ?? unref(currencyPrecision) ?? 2;
		return parser(value, prec);
	};

	const normalizeCustomerCreditAllocations = () => {
		const rows = Array.isArray(customer_credit_dict.value) ? customer_credit_dict.value : [];
		let remainingAllowed = getMaxRedeemableCustomerCredit();

		rows.forEach((row: any) => {
			const available = Math.max(normalizeFloat(row?.total_credit || 0), 0);
			const requested = Math.max(normalizeFloat(row?.credit_to_redeem || 0), 0);
			const allowed = Math.min(requested, available, Math.max(remainingAllowed, 0));
			row.credit_to_redeem = normalizeFloat(allowed);
			remainingAllowed = normalizeFloat(Math.max(remainingAllowed - row.credit_to_redeem, 0));
		});

		const total = rows.reduce(
			(sum, row) => sum + normalizeFloat(row?.credit_to_redeem || 0),
			0,
		);
		redeemed_customer_credit.value = normalizeFloat(total);
	};

	watch(redeemed_customer_credit, (newVal) => {
		const limit = Math.min(
			unref(available_customer_credit),
			getMaxRedeemableCustomerCredit(),
		);
		if (normalizeFloat(newVal) > normalizeFloat(limit)) {
			redeemed_customer_credit.value = limit;
			if (stores?.toastStore) {
				stores.toastStore.show({
					title: `You can redeem customer credit up to ${limit}`,
					color: "error",
				});
			}
		}
	});

	watch(
		customer_credit_dict,
		() => {
			normalizeCustomerCreditAllocations();
		},
		{ deep: true },
	);

	watch(loyalty_amount, () => {
		normalizeCustomerCreditAllocations();
	});

	watch(
		() => [cashbackAsksTheServer.value, cashbackEligibleAmount.value] as const,
		([asks, eligible], previous) => {
			if (!asks || eligible === null || eligible <= 0) {
				// Cancel anything in flight: its answer would be about a cart
				// that no longer exists.
				accrualRequest += 1;
				if (accrualTimer) clearTimeout(accrualTimer);
				cashback_accrual.value = null;
				return;
			}
			if (previous && previous[0] === asks && previous[1] === eligible) return;
			scheduleCashbackPreview();
		},
		{ immediate: true },
	);

	// Kept for backward compatibility with previous interface.
	const get_loyalty_points = () => {
		return unref(available_points_amount);
	};

	return {
		loyalty_amount,
		redeemed_customer_credit,
		customer_credit_dict,
		available_customer_credit,
		available_points_amount,
		cashback_accrual,
		get_available_credit,
		get_loyalty_points,
	};
}
