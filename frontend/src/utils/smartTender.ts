export const defaultDenominations: Record<string, number[]> = {
	MXN: [20, 50, 100, 200, 500, 1000],
	PKR: [10, 20, 50, 100, 500, 1000, 5000],
	INR: [10, 20, 50, 100, 200, 500, 2000],
	USD: [1, 5, 10, 20, 50, 100],
	EUR: [5, 10, 20, 50, 100, 200, 500],
	GBP: [5, 10, 20, 50],
	AED: [5, 10, 20, 50, 100, 200, 500, 1000],
	SAR: [1, 5, 10, 50, 100, 500],
	QAR: [1, 5, 10, 50, 100, 500],
};

// MXN (Mexican peso) cash quick-tender. Unlike the generic "round-up to each
// denomination" logic, Mexican cashiers want: the EXACT amount, the next
// round-hundred steps the customer realistically hands (e.g. 590 → 600, 700),
// the next single big bill (1000), AND the standard MXN bill denominations that
// bracket the amount — including a few BELOW total, which the operator taps for
// split/partial entry (the bill the customer actually hands over).
//   590 → [100, 200, 500, 590, 600, 700, 1000]
function getMxnTenderSuggestions(amount: number): number[] {
	if (amount <= 0) return [];
	const bills = [20, 50, 100, 200, 500, 1000];
	const out = new Set<number>();
	out.add(Number(amount.toFixed(2))); // exact
	const next100 = Math.ceil(amount / 100) * 100;
	out.add(Math.ceil(amount / 50) * 50); // next 50
	out.add(next100); // next 100 (e.g. 600)
	out.add(next100 + 100); // one more (700)
	out.add(Math.ceil(amount / 500) * 500); // next 500
	out.add(Math.ceil(amount / 1000) * 1000); // next 1000 (single big bill)
	// standard bills in a sensible window around the amount (>= ~1/10 of it so
	// we don't offer absurdly small bills for big sales; <= a couple bills over)
	bills.forEach((b) => {
		if (b >= amount / 10 && b <= next100 + 500) out.add(b);
	});
	return Array.from(out)
		.filter((v) => v > 0)
		.sort((a, b) => a - b)
		.slice(0, 8);
}

export function getSmartTenderSuggestions(amount: number, currency: string) {
	if (currency === "MXN") return getMxnTenderSuggestions(amount);

	const denoms = defaultDenominations[currency] || [
		1, 5, 10, 20, 50, 100, 500, 1000,
	];
	const suggestions = new Set<number>();

	if (amount <= 0) return [];

	denoms.forEach((d) => {
		const multiple = Math.ceil(amount / d);
		const val = multiple * d;
		suggestions.add(val);
	});

	const sorted = Array.from(suggestions).sort((a, b) => a - b);

	const unique: number[] = [];
	const seen = new Set<number>();

	sorted.forEach((v) => {
		const fixed = Number(v.toFixed(2));

		if (fixed >= amount - 0.0001 && !seen.has(fixed)) {
			if (!(fixed < amount && Math.abs(fixed - amount) >= 0.001)) {
				seen.add(fixed);
				unique.push(fixed);
			}
		}
	});

	return unique.slice(0, 6);
}
