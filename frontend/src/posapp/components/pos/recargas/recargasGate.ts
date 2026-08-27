/**
 * Does this register sell airtime at all? (roadmap §17.2, build plan §12 F.)
 *
 * Saldo runs on docomexico only. Every other tenant must not see this
 * destination — not greyed, not empty, ABSENT — which is ruling R3: *what the
 * giro does not use does not appear*. A carnicería with a dead Recargas screen
 * is a support call about a feature it was never sold.
 *
 * ## Why this is not just `isDestinationEnabled()`
 *
 * There are two gates in the tree today and they do not agree:
 *
 * - `destinationRegistry.ts` gives `recharge` `capability: "saldo"` and
 *   `profileFlag: null`, so the rail asks the capability profile only.
 * - `Pos.vue` (`saldoEnabledForProfile`) and `invoice/actionChips.ts`
 *   (`profileFlag: "saldo_enabled"`) both ask the POS Profile flag, which is
 *   the gate that actually shipped — the field is installed by the saldo app
 *   itself and predates the capability profile.
 *
 * A register carrying `saldo_enabled: 1` without the capability declared gets a
 * rail with no Recarga and an invoice chip that opens the picker: two surfaces
 * disagreeing about whether this shop sells airtime. This helper ORs them, the
 * way `serviceOrder` already ORs `external_document_checkout` with
 * `posa_use_charge_requests`, so the chrome cannot contradict the launcher
 * beside it. The registry's own `profileFlag` is the better fix and is
 * REPORTED, not edited — that file is not this task's to write.
 */

import { parseBooleanSetting } from "../../../utils/stock";

export const SALDO_CAPABILITY = "saldo";
export const SALDO_PROFILE_FLAG = "saldo_enabled";

export interface RecargasGateContext {
	/** The active POS Profile document, or null before one is chosen. */
	posProfile?: Record<string, any> | null;
	/** `verticalStore.has` — capabilities, never a vertical NAME (§2). */
	hasCapability?: (capability: string) => boolean;
}

/**
 * True only when this register is configured to sell airtime.
 *
 * Defaults to FALSE on every uncertainty — no profile, no store, an
 * unparseable flag. The safe direction is obvious here and worth stating: a
 * hidden surface on a shop that does sell airtime is a missing feature someone
 * reports in a minute, while a visible one on a shop that does not is a cashier
 * being offered a product the owner has no bolsa for.
 */
export function recargasEnabled(context: RecargasGateContext): boolean {
	if (parseBooleanSetting(context.posProfile?.[SALDO_PROFILE_FLAG])) {
		return true;
	}
	try {
		return Boolean(context.hasCapability?.(SALDO_CAPABILITY));
	} catch {
		// A capability store that throws is not a capability that is granted.
		return false;
	}
}

/**
 * May this register SPEND A NETWORK CALL on the saldo server?
 *
 * A different question from `recargasEnabled()`, and the difference is the
 * truth source. The capability leg above reads the vertical preset, and the
 * default `retail-phones` preset declares "saldo" for every register that
 * resolves it — it answers "this vertical class COULD sell airtime", which is
 * the right gate for chrome. A `saldo.api.*` call needs "this TENANT has the
 * app": `saldo_enabled` is a field the saldo app itself installs on POS
 * Profile, so on a tenant without the app the flag cannot be set — the flag
 * IS the installation fact. Gating reads on the capability had every
 * saldo-less tenant 417-ing `get_pos_available_balance` at boot and then
 * every 60 seconds, forever (found by the 2026-08-27 register error sweep).
 */
export function saldoProfileConfigured(
	posProfile: Record<string, any> | null | undefined,
): boolean {
	return parseBooleanSetting(posProfile?.[SALDO_PROFILE_FLAG]);
}
