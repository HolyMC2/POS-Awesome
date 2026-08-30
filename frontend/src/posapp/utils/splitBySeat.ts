/**
 * Per-seat split arithmetic for the payment screen (critique B4's payoff).
 *
 * The mesa lines already know who ordered what — `OrderLine.seat` exists
 * "for per-seat settling" and 0 means the table (shared). This module turns
 * that into money, pure and alone, under the same house rules as
 * splitEvenly.ts: everything in cents, shares floored, the residue rides
 * the LAST payer so the sum is cent-exact by construction.
 *
 * Two decisions worth naming:
 *
 * - Shared lines (seat 0) are split EQUALLY across the seats present. The
 *   guacamole in the middle of the table belongs to everyone at it; weighting
 *   it by consumption would be a guess dressed as arithmetic.
 * - Each seat's share of the SETTLE total (tax, tip and discounts included)
 *   is proportional to its lines' worth, not the raw line sum itself. The
 *   quote must add up to what the register is actually collecting, and
 *   proportional allocation is the only rule where a 10% tip costs the
 *   $300 seat ten times what it costs the $30 seat.
 *
 * Collection is sequential (seats pay in order), so the plan is always
 * computed over WHAT IS LEFT: `skip` seats have paid, and the remaining
 * amount re-divides over the remaining seats by their weights. A tip added
 * after two seats paid lands on the seats still open — the people already
 * collected keep their receipts, same honesty rule as splitEvenly.
 */

export interface SeatSplitLine {
	seat?: number | null;
	qty?: unknown;
	rate?: unknown;
	amount?: unknown;
}

export interface SeatShare {
	/** The seat number as the waiter knows it (A1, A2…). */
	seat: number;
	amount: number;
}

const toCents = (value: number) => Math.round(value * 100);

const num = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/** A line's worth in cents: its own amount when it has one, else qty × rate.
 *  A present-but-zero amount is a comp and stays zero on purpose. */
const lineCents = (line: SeatSplitLine): number => {
	const amount = line.amount;
	if (amount !== null && amount !== undefined && Number.isFinite(Number(amount))) {
		return Math.max(toCents(Number(amount)), 0);
	}
	return Math.max(toCents(num(line.qty) * num(line.rate)), 0);
};

/** Distinct seats > 0, ascending — the collection order. */
const seatNumbers = (lines: SeatSplitLine[]): number[] =>
	[...new Set(lines.map((line) => Math.trunc(num(line.seat))).filter((seat) => seat > 0))].sort(
		(a, b) => a - b,
	);

/** Weight per seat in cents: its own lines plus an equal cut of the shared
 *  ones. All-zero weights (a table of comps) fall back to equal weights so
 *  the allocation below still divides instead of dying on 0/0. */
const seatWeights = (lines: SeatSplitLine[], seats: number[]): Map<number, number> => {
	const weights = new Map<number, number>(seats.map((seat) => [seat, 0]));
	let shared = 0;
	for (const line of lines) {
		const seat = Math.trunc(num(line.seat));
		const cents = lineCents(line);
		if (seat > 0 && weights.has(seat)) weights.set(seat, (weights.get(seat) ?? 0) + cents);
		else shared += cents;
	}
	const base = Math.floor(shared / seats.length);
	seats.forEach((seat, idx) => {
		const cut = idx === seats.length - 1 ? shared - base * (seats.length - 1) : base;
		weights.set(seat, (weights.get(seat) ?? 0) + cut);
	});
	if ([...weights.values()].every((weight) => weight === 0)) {
		seats.forEach((seat) => weights.set(seat, 1));
	}
	return weights;
};

/** Whether the panel should offer «Por asiento» at all: it takes at least
 *  two seats for a per-seat split to mean anything. */
export function seatSplitAvailable(lines: SeatSplitLine[]): boolean {
	return seatNumbers(lines).length >= 2;
}

/**
 * The remaining collection plan: seats still to pay (the first `skip` seats
 * already have), each with its floored proportional share of `remainingTotal`
 * — except the last, who pays exactly what is left.
 */
export function seatSplitPlan(
	lines: SeatSplitLine[],
	remainingTotal: unknown,
	skip = 0,
): SeatShare[] {
	const seats = seatNumbers(lines).slice(Math.max(Math.trunc(num(skip)), 0));
	const cents = Math.max(toCents(num(remainingTotal)), 0);
	if (!seats.length) return [];
	const weights = seatWeights(lines, seatNumbers(lines));
	// The seats still open can all weigh zero (they ordered nothing and a tip
	// arrived late) — divide equally then, instead of dumping it on the last.
	const totalWeight = seats.reduce((sum, seat) => sum + (weights.get(seat) ?? 0), 0);
	let allocated = 0;
	return seats.map((seat, idx) => {
		if (idx === seats.length - 1) return { seat, amount: (cents - allocated) / 100 };
		const weight = totalWeight ? (weights.get(seat) ?? 0) : 1;
		const share = Math.floor((cents * weight) / (totalWeight || seats.length));
		allocated += share;
		return { seat, amount: share / 100 };
	});
}
