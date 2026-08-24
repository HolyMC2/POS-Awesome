/**
 * Pinia store registry for the POS application.
 *
 * Re-exports all application stores from a single entry point. Import stores
 * from here rather than directly from their individual files.
 *
 * **Stores:**
 * - `useCustomersStore` — customer list and active customer selection for the
 *   current POS session.
 * - `useEmployeeStore` — current cashier/employee identity used for shift
 *   ownership and cashier assignment.
 * - `useItemsStore` — item catalogue with multi-layer caching, search, and
 *   pagination; the primary data source for the item selector component.
 * - `useInvoiceStore` — active POS invoice document and cart items (normalized
 *   Map-based storage); the central state shared by the cart and payment views.
 * - `useUpdateStore` / `formatBuildVersion` — tracks available application
 *   updates and provides build-version string formatting for display.
 * - `usePricingRulesStore` — offline pricing-rules snapshot and rule evaluation
 *   applied to cart items during price calculation.
 * - `useVerticalStore` — capability + layout resolution for vertical presets;
 *   components ask `has(capability)` / read resolved layout, never a vertical
 *   name (docs/VERTICAL_PROFILES_PLAN.md).
 */

import { createPinia } from "pinia";

/**
 * ONE pinia per document, even though this module evaluates twice.
 *
 * The loader boots the SPA from `posawesome-<hash>.js?v=<build>`; every lazy
 * chunk the app then pulls (`Pos-*.js`, `Payments-*.js`, `sw-updater-*.js`)
 * imports the entry back by its RELATIVE specifier, which has no `?v=`. Two
 * URLs are two module records to the browser, so this file used to run
 * `createPinia()` twice: the app installed the stamped copy's instance, while
 * everything reaching for this binding from a lazy chunk got a bare second one
 * with no stores in it. `sw-updater` even made that empty instance the ACTIVE
 * pinia, so any `useStore()` outside a component context resolved against it.
 *
 * Pinning the instance on `globalThis` collapses both copies onto the same
 * store registry. The symbol keeps it off the global namespace, and per-file
 * test isolation gives every spec a fresh realm, so this is a no-op there.
 */
const PINIA_KEY = Symbol.for("posawesome.pinia");
const globalScope = globalThis as any;

export const pinia = (globalScope[PINIA_KEY] ||= createPinia());

// Export stores
export { useCustomersStore } from "./customersStore";
export { useEmployeeStore } from "./employeeStore";
export { useItemsStore } from "./itemsStore";
export { useInvoiceStore } from "./invoiceStore";
export { useUpdateStore, formatBuildVersion } from "./updateStore";
export { usePricingRulesStore } from "./pricingRulesStore";
export { useVerticalStore } from "./verticalStore";

export default pinia;
