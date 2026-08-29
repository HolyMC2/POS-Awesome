/**
 * Even-split arithmetic for the payment screen (critique C1, 08-29).
 *
 * Pure on purpose, like bandState: the residue rule is a money decision and
 * lives in exactly one testable place. Shares are floored to cents and the
 * residue rides the LAST payer — 353.00 ÷ 3 quotes 117.66 twice and 117.68
 * once, never 117.67 × 3 = 353.01 charging a centavo that does not exist.
 *
 * The panel collects SEQUENTIALLY (guests pay one at a time), so the live
 * question is always "what does the NEXT person owe?" — answered from the
 * remaining amount and the remaining headcount, which also keeps the shares
 * honest when the total moves mid-split (a tip added after two guests paid):
 * the people already collected keep their receipts, the rest re-divide what
 * is actually left.
 */

const toCents = (value: number) => Math.round(value * 100);

const num = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/** What the next payer owes: floor-to-cents share, exact remainder for the last. */
export function nextShareAmount(remaining: unknown, remainingCount: unknown): number {
	const amount = Math.max(num(remaining), 0);
	const count = Math.max(Math.trunc(num(remainingCount)), 0);
	if (!count || !amount) return 0;
	if (count === 1) return Math.round(toCents(amount)) / 100;
	return Math.floor(toCents(amount) / count) / 100;
}

/** The full quote up front («son $117.66 cada quien, $117.68 el último»). */
export function previewShares(total: unknown, count: unknown): number[] {
	const amount = Math.max(num(total), 0);
	const people = Math.max(Math.trunc(num(count)), 0);
	if (!people || !amount) return [];
	const cents = toCents(amount);
	const base = Math.floor(cents / people);
	const shares = Array.from({ length: people }, () => base / 100);
	shares[people - 1] = (cents - base * (people - 1)) / 100;
	return shares;
}
