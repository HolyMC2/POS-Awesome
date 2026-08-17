/**
 * Single source of truth for the user-facing brand (roadmap §17.4).
 *
 * The app remains `posawesome` internally — fork hygiene: storage keys,
 * telemetry event names, DOM test ids and API paths NEVER derive from this
 * module, so upstream merges and existing tests stay unaffected. Only what
 * an operator READS carries the brand.
 *
 * The server-rendered shell carries the same strings in
 * posawesome/www/{posapp.py,manifest.json,posapp.html,offline.html};
 * tests/brandConsistency.spec.ts pins the two halves together.
 */
export const BRAND = {
	/** Full product name — window titles, dialogs, PWA install name. */
	name: "Muelle POS",
	/** Navbar wordmark halves (light + bold). Brand words never translate. */
	wordmarkLight: "Muelle",
	wordmarkBold: "POS",
	/** Compact wordmark for narrow screens. */
	wordmarkCompact: "POS",
	/** PWA short name (home-screen label — keep it short). */
	shortName: "Muelle POS",
} as const;
