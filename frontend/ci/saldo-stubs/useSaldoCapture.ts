/**
 * CI stub of saldo/public/saldo_pos/useSaldoCapture.ts — see README.md.
 * Behaviour-faithful no-op: resolves null ("not a saldo item") always.
 * Types mirror the real module exactly so consumers type-check identically.
 */

import mitt from "mitt";

type Meta = {
	saldo_enabled: boolean;
	item_code: string;
	carrier: string | null;
	carrier_label: string | null;
	carrier_logo: string | null;
	carrier_tipo: string | null;
	bolsa: string | null;
	product: string | null;
	monto: number | null;
	monto_libre: boolean;
	campos: Array<Record<string, unknown>>;
};

type CaptureResult = { referencia: string; monto: number };
type BusEvents = {
	"saldo:open": { meta: Meta; resolve: (r: CaptureResult) => void; reject: (r: unknown) => void };
	"saldo:result": Record<string, unknown>;
	// Hold-until-confirm (ventas retenidas):
	// checkout parked a sale at draft → badge refetches.
	"saldo:hold_registered": { invoice: string; doctype: string };
	// held sale submitted server-side → Pos.vue prints the receipt.
	"saldo:hold_print": { invoice: string; doctype: string };
};

export const saldoCaptureBus = mitt<BusEvents>();
// Alias for SaldoStatusDialog (status payloads, post-TAECEL).
export const saldoBus = saldoCaptureBus;

export async function requireSaldoCapture(item: {
	item_code: string;
	saldo_referencia?: string;
}): Promise<CaptureResult | null> {
	void item;
	return null;
}
