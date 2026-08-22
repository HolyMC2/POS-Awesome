/**
 * What the register can and cannot do while the server is unreachable.
 *
 * §7 of the roadmap requires every surface to DECLARE its offline availability
 * rather than discover it by failing. This is that declaration, as data.
 *
 * Deliberately NOT the same axis as `offlineSyncStore.capabilitySummaries`,
 * and not a duplicate of it: that store answers "has the cache finished
 * downloading this resource?", which changes minute to minute. This answers
 * "is this surface usable with no server at all?", which is a property of the
 * product and changes only when we build something. The cashier needs the
 * second question answered in one glance; the manager needs the first.
 *
 * NOR is it the same axis as `composables/pos/shell/railDestinations.ts`,
 * which declares offline availability per RAIL DESTINATION. That file answers
 * "can the cashier open this screen?"; this one answers "can the shop still
 * do this thing?". A surface can appear in both with DIFFERENT and equally
 * correct values — `service_order_capture` below is the worked example, and
 * it is the reason these ids are not shared. Do not "reconcile" the two files
 * by making their values match; read what each one is asking first.
 */

export type OfflineAvailability =
	/** Fully usable with no server. */
	| "available"
	/** Accepted now, submitted when the signal returns. */
	| "queued"
	/** Readable from cache; cannot be changed. */
	| "cached-read-only"
	/** Cannot be done at all until the server answers. */
	| "blocked";

export interface OfflineSurface {
	id: string;
	/** Untranslated key — the shell passes it through `__()`. */
	labelKey: string;
	availability: OfflineAvailability;
}

/**
 * Ordered for the artboard's two columns: everything the cashier can still do,
 * then the short list that has to wait. The order inside each column is by how
 * often the surface comes up at the counter, not alphabetically.
 */
export const OFFLINE_SURFACES: readonly OfflineSurface[] = Object.freeze([
	{ id: "checkout", labelKey: "Charge and print", availability: "queued" },
	{ id: "catalog", labelKey: "Prices and stock", availability: "cached-read-only" },
	// `service_order_capture`, not `service_orders`: this is Taller CAPTURING a
	// new order — form plus photos — which queues like any other local write.
	// The rail's `serviceOrder` destination is the POS READING an existing
	// Charge Request off the server, and is correctly `blocked`. Same words,
	// opposite directions of travel. The id says which one this is because the
	// two were briefly mistaken for a contradiction (R4, wave-3 audit).
	{ id: "service_order_capture", labelKey: "Service orders with photos", availability: "queued" },
	// Timbrado is a round trip to the PAC; there is no local fallback and
	// pretending otherwise would hand the customer an invalid invoice.
	{ id: "cfdi", labelKey: "Stamp CFDI", availability: "blocked" },
	// Airtime is bought from the carrier in real time — a queued recharge is a
	// promise we cannot keep.
	{ id: "recharges", labelKey: "Airtime recharges", availability: "blocked" },
	{ id: "whatsapp", labelKey: "Send by WhatsApp", availability: "blocked" },
]);

/** Surfaces the cashier can still use — the "Sí puedes" column. */
export const surfacesThatWorkOffline = (
	surfaces: readonly OfflineSurface[] = OFFLINE_SURFACES,
): OfflineSurface[] => surfaces.filter((surface) => surface.availability !== "blocked");

/** Surfaces that have to wait — the "Espera señal" column. */
export const surfacesThatNeedSignal = (
	surfaces: readonly OfflineSurface[] = OFFLINE_SURFACES,
): OfflineSurface[] => surfaces.filter((surface) => surface.availability === "blocked");
