export type PaymentEntryType = "Receive" | "Pay";
export type PaymentPartyType = "Customer" | "Supplier" | "Employee";

const PAY_PARTY_TYPES: PaymentPartyType[] = [
	"Customer",
	"Supplier",
	"Employee",
];
const RECEIVE_PARTY_TYPES: PaymentPartyType[] = ["Customer", "Supplier"];

export function getAllowedPartyTypes(
	paymentType: string | null | undefined,
): PaymentPartyType[] {
	return paymentType === "Pay" ? PAY_PARTY_TYPES : RECEIVE_PARTY_TYPES;
}

export function normalizePartyTypeForPaymentType(
	paymentType: string | null | undefined,
	partyType: string | null | undefined,
): PaymentPartyType {
	const allowed = getAllowedPartyTypes(paymentType);
	return allowed.includes(partyType as PaymentPartyType)
		? (partyType as PaymentPartyType)
		: (allowed[0] as PaymentPartyType);
}

export function shouldShowReconciliationSections(
	paymentType: string | null | undefined,
	partyType: string | null | undefined,
): boolean {
	return getAllowedPartyTypes(paymentType).includes(partyType as PaymentPartyType)
		&& partyType !== "Employee";
}

/** Credits settle normal bills; a cash refund uses the opposite direction. */
export function canApplyExistingCredits(paymentType = "Receive", partyType = "Customer"): boolean {
	return (partyType === "Customer" && paymentType === "Receive")
		|| (partyType === "Supplier" && paymentType === "Pay");
}

export function matchesInvoiceDirection(amount: unknown, paymentType = "Receive", partyType = "Customer"): boolean {
	const value = Number(amount);
	if (!Number.isFinite(value) || !shouldShowReconciliationSections(paymentType, partyType)) return false;
	return canApplyExistingCredits(paymentType, partyType) ? value > 0 : value < 0;
}
