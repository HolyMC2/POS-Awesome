/**
 * Does the shell's ActionBand own the bottom lane right now?
 *
 * Riel y Cajón's first invariant (§17.7) is ONE number and ONE primary action.
 * The band and `InvoiceSummary` both want that lane, so exactly one of them
 * must yield — and the summary is the one that yields, because the band is the
 * surface the design reserves for it.
 *
 * ⚠ This predicate INTENTIONALLY duplicates `Pos.vue`'s `railVisible`
 * (`!useCompactPosSwitcher`, itself `leanVerticalLayout || width < 1100`).
 * The summary cannot be told by the shell — it is mounted through `Invoice.vue`
 * and no prop carries the answer down, and inventing one would mean editing
 * `Pos.vue`, which this change deliberately does not touch.
 *
 * Duplication that nobody guards is drift, so `tests/bandOwnsTheLane*.spec.ts`
 * source-scans `Pos.vue` and fails if its `railVisible` stops being expressible
 * by these same two inputs. When someone next has both files open, the right
 * fix is to lift this into a shared composable and have BOTH import it; the
 * test exists so that day is chosen rather than discovered.
 */
export function bandOwnsLane(leanVerticalLayout: boolean, windowWidth: number): boolean {
	return !(leanVerticalLayout || windowWidth < 1100);
}
