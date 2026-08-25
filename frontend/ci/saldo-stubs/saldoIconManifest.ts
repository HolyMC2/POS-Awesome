// Icon inventory of the real @saldo sibling sources (SaldoCatalogPicker.vue,
// SaldoStatusView.vue, SaldoHoldsBadge.vue). The mdiIconCoverage spec derives
// "which mdi-* names are referenced" by scanning either the real sibling
// checkout or these stubs; without this manifest, every saldo-only entry in
// mdiIconPaths.ts reads as an orphan on CI runners (no sibling checkout) and
// the suite fails only there. Keep in sync when saldo templates change icons.
export const SALDO_ICONS = [
	"mdi-cancel",
	"mdi-cellphone-wireless",
	"mdi-history",
	"mdi-home-lightning-bolt",
	"mdi-progress-check",
	"mdi-wallet-outline",
] as const;
