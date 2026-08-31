/**
 * Single source of truth for the register's responsive boundaries (audit
 * systemic S3 / LAYOUT-F2).
 *
 * The register partitions width with a STRICT `< N` in JS (`isPhone = w < 768`),
 * so the matching CSS `@media` boundary must be `N - 0.02` — a `max-width: Npx`
 * rule ALSO fires at exactly N, which disagrees with `< N` at that one width and
 * is exactly what an iPad in portrait (768 CSS px) or an exactly-600px window
 * met: the CSS said phone while the JS said tablet. The `.98` form (Vuetify's
 * convention) makes `max-width` partition at the same point as `<`.
 *
 * JS reads BREAKPOINTS; CSS rules use the CSS_MAX values; breakpointCoherence
 * spec asserts every `@media (max-width:)` on these boundaries uses the `.98`
 * form and that the JS numbers here match the composables.
 */
export const BREAKPOINTS = {
	/** `< phone` is the movil shell; `>=` is tablet. */
	phone: 768,
	/** `< compact` is the compact band (movil/tablet); `>=` is the desk tier. */
	compact: 1100,
	/** `< dialogFullscreen` sends a dialog fullscreen (useDialogFullscreen). */
	dialogFullscreen: 600,
} as const;

/** The `max-width` value (px) that partitions at the SAME point as `< BREAKPOINT`. */
export const CSS_MAX = {
	phone: BREAKPOINTS.phone - 0.02, // 767.98
	compact: BREAKPOINTS.compact - 0.02, // 1099.98
	dialogFullscreen: BREAKPOINTS.dialogFullscreen - 0.02, // 599.98
} as const;
