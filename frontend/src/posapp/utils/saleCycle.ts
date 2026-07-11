/**
 * Cashier-felt sale-cycle timing (audit SPEC C): stamp when the FIRST item
 * lands in an empty cart, emit pos:sale_cycle_ms when the sale submits
 * (success or hold-parked). Starting on an empty cart self-heals after
 * cancelled sales — the next fresh add simply re-stamps.
 */
let startedAt: number | null = null;

export function stampSaleCycleStart(cartWasEmpty: boolean) {
	if (cartWasEmpty) {
		startedAt = Date.now();
	} else if (startedAt === null) {
		// mid-sale boot/reload: start counting from first observed add
		startedAt = Date.now();
	}
}

export function takeSaleCycleMs(): number | null {
	if (startedAt === null) {
		return null;
	}
	const elapsed = Date.now() - startedAt;
	startedAt = null;
	return elapsed;
}
