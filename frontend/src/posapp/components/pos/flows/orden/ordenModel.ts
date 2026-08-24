/**
 * The Orden de servicio surface, as rules (artboard `Orden.dc.html`).
 *
 * Pure by construction — no Vue, no store, no `__()`, no `frappe`. Same
 * reasoning as `ledger/ledgerModel.ts` and `shell/railDestinations.ts`: every
 * decision this screen makes about a repair order has to be checkable in a
 * test, and none of them is if the only way to produce it is to mount the
 * surface.
 *
 * TWO RULES THE ARTBOARD CANNOT STATE:
 *
 * 1. **A card's chip is the FIRST true thing about it, not all of them.** An
 *    order can be a warranty claim AND already invoiced AND ready; the
 *    artboard draws one chip. The order below is the order that matters to a
 *    cashier reaching for it: an invoiced order must not be charged again,
 *    which outranks everything else on the card.
 * 2. **This module computes no money.** `saldo` is `orderTotal − advance`, two
 *    figures the server already holds, and nothing here rounds, taxes or
 *    discounts. `bandState.ts` states the same rule for the band and it is the
 *    same rule here — the invoice is priced by
 *    `prepare_charge_request_invoice`, on the server, from `items_json`.
 */

import type { BandInput } from "../../../../composables/pos/shell/bandState";
import type { ServiceOrderCard, ServiceOrderLine } from "../../../../services/serviceOrderService";
// The phone's service-order module, reused rather than mirrored — see
// `describeLine`. It is pure (no Vue, no store), which is what makes an import
// across the mobile/desktop boundary a shared RULE rather than a shared screen.
import {
	LINE_KINDS,
	maskDeviceId,
	type ServiceOrderLineKind,
} from "../../mobile/orders/serviceOrderLines";

/* -------------------------------------------------------------------------- */
/* Buckets                                                                     */
/* -------------------------------------------------------------------------- */

export const ORDEN_BUCKET_IDS = ["ready", "working", "delivered"] as const;

export type OrdenBucketId = (typeof ORDEN_BUCKET_IDS)[number];

export interface OrdenBucket {
	id: OrdenBucketId;
	/** English source string; the view wraps it in `__()`. */
	labelKey: string;
	/**
	 * `false` for `working`: those orders are still on a bench in Taller, and
	 * the only verb on this surface is COBRAR Y ENTREGAR. The chip carries the
	 * count so the counter knows how much is coming; pressing it would open a
	 * list of things it cannot do anything with.
	 */
	selectable: boolean;
}

/**
 * Keys of their own, not the app-wide `Ready` and `Delivered`.
 *
 * Those two are already translated masculine — "Listo", "Entregado" — because
 * elsewhere they describe an invoice or a shipment. Every noun on this surface
 * is *una orden*, and these chips count several of them, so the Spanish is
 * "Listas" and "Entregadas". A two-column CSV has no context column;
 * `ledgerModel.ts` hit the same wall with "Pagada" and solved it the same way.
 */
export const ORDEN_BUCKETS: readonly OrdenBucket[] = [
	{ id: "ready", labelKey: "Ready to charge", selectable: true },
	{ id: "working", labelKey: "In progress", selectable: false },
	{ id: "delivered", labelKey: "Handed over", selectable: true },
] as const;

export interface OrdenCounts {
	ready: number;
	/** `null` on a tenant with no repair app — the chip is ABSENT, not zero. */
	working: number | null;
	delivered: number;
}

export interface OrdenChip extends OrdenBucket {
	count: number | null;
	active: boolean;
}

/**
 * The chips over the queue, in artboard order.
 *
 * A `null` count drops the chip entirely rather than drawing it empty. That is
 * the same absent-not-disabled rule the rail follows: a register whose tenant
 * has no workshop has no «En trabajo» to report, and "En trabajo 0" would read
 * as an idle bench rather than as a missing app.
 */
export const describeBuckets = (counts: OrdenCounts, active: OrdenBucketId): OrdenChip[] =>
	ORDEN_BUCKETS.map((bucket) => ({
		...bucket,
		count: counts[bucket.id],
		active: bucket.id === active,
	})).filter((chip) => chip.count !== null && chip.count !== undefined);

/* -------------------------------------------------------------------------- */
/* Card state                                                                  */
/* -------------------------------------------------------------------------- */

export type OrdenCardTone = "ready" | "warning" | "muted";

export interface OrdenCardState {
	/** English source string for the chip; the view wraps it in `__()`. */
	labelKey: string;
	tone: OrdenCardTone;
	/**
	 * A note under the money, when there is one to make. The artboard prints
	 * "No se puede cobrar dos veces" under an invoiced order and "Sin cargo ·
	 * 90 d" under a warranty — both are the REASON the card looks the way it
	 * does, and a card that dims without saying why is a card that gets
	 * clicked twice.
	 */
	noteKey: string | null;
	noteParams?: (string | number)[];
	/** Whether the band may arm on this card at all. */
	chargeable: boolean;
}

/**
 * What the card says about itself.
 *
 * Ordered by what stops a cashier, not by what is most interesting: an
 * already-invoiced order is the one mistake that costs a customer money, so it
 * wins over every other state including warranty.
 */
export const describeCardState = (card: ServiceOrderCard): OrdenCardState => {
	if (card.invoiced) {
		return {
			labelKey: "Already invoiced",
			tone: "muted",
			noteKey: "It cannot be charged twice",
			chargeable: false,
		};
	}
	if (card.no_charge) {
		return {
			labelKey: card.warranty ? "Warranty" : "No charge",
			tone: "warning",
			noteKey: card.warranty_days ? "No charge · {0} d" : "No charge",
			noteParams: card.warranty_days ? [card.warranty_days] : undefined,
			// A zero-balance order still has to be handed over, and handing it
			// over is what COBRAR Y ENTREGAR does. The band decides whether the
			// button is pressable from the balance; this only says it is not a
			// mistake to arm it.
			chargeable: true,
		};
	}
	if (card.warranty) {
		return { labelKey: "Warranty", tone: "warning", noteKey: null, chargeable: true };
	}
	return { labelKey: "Order ready", tone: "ready", noteKey: null, chargeable: true };
};

/**
 * The advance line on a card. `null` means the card says nothing there —
 * "Anticipo $0" is a placeholder that costs the same width as a fact.
 */
export const describeAdvance = (
	card: ServiceOrderCard,
): { labelKey: string; amount: number } | null =>
	card.advance > 0 ? { labelKey: "Advance", amount: card.advance } : null;

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fold what a counter types onto what a card holds.
 *
 * Accents come out because a customer's name is written "Ríos" on the ticket
 * and typed "rios" at the counter; separators come out of the number because
 * an IMEI is read aloud in groups and a phone is written with dashes. Both are
 * about the SAME failure — a search that finds nothing because of a keystroke
 * nobody thinks of as a keystroke.
 */
const fold = (value: unknown): string =>
	String(value ?? "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

/**
 * Does this card answer the query?
 *
 * An IMEI and a phone match on their SUFFIX, because that is what a customer
 * reads out — the last four of the IMEI on the sticker, the last digits of the
 * phone they gave. A prefix match would fail every one of those.
 */
export const matchesQuery = (card: ServiceOrderCard, query: string): boolean => {
	const needle = fold(query);
	if (!needle) return true;
	const text = [card.folio, card.name, card.title, card.customer_name].map(fold);
	if (text.some((value) => value.includes(needle))) return true;

	const numeric = digits(query);
	if (numeric.length < 3) return false;
	const numbers = [...(card.serials ?? []), card.customer_phone].map(digits);
	return numbers.some((value) => value.length > 0 && value.endsWith(numeric));
};

/* -------------------------------------------------------------------------- */
/* Lines                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The server's provenance key, in the phone's own vocabulary.
 *
 * `mobile/orders/serviceOrderLines.ts` already named these five kinds and
 * their labels, and its `KIND_ALIASES` block explains at length why it refused
 * to GUESS a kind from a zero rate: "a zero-rate line is not evidence of a
 * customer's part: it is equally a warranty replacement or a courtesy". The
 * server's read model is the evidence that module said it did not have — it
 * reads `Repair Order Part.source` — so this maps one onto the other rather
 * than inventing a second vocabulary for the same four facts.
 *
 * Reusing it also means the phone and the desk say the SAME words for the same
 * line. Four new `es.csv` rows saying "refacción" a second way is how one
 * ticket ends up reading differently on two screens.
 */
const PROVENANCE_KINDS: ReadonlyArray<{
	provenance: ServiceOrderLine["provenance"];
	kind: ServiceOrderLineKind;
	/** Extra qualifier, where the workshop knows something the kind does not. */
	noteKey: string | null;
}> = [
	{ provenance: "labor", kind: "labour", noteKey: null },
	{ provenance: "stock", kind: "part", noteKey: "from stock" },
	// A part the shop had to order in is still a part; where it came from is
	// the note, because a customer asking "why did it take a week" is asking
	// about exactly this row.
	{ provenance: "ordered", kind: "part", noteKey: "ordered in" },
	{ provenance: "customer_supplied", kind: "customerPart", noteKey: null },
];

export interface OrdenLinePresentation {
	kind: ServiceOrderLineKind;
	/** English source strings; the view wraps each in `__()`. */
	labelKey: string | null;
	noteKey: string | null;
	/**
	 * The handles printed in the mono face — item code, then serial. An array
	 * rather than a joined string so the view can set the code in mono and the
	 * qualifier in the body face; joining here would force one typeface on both.
	 */
	handles: string[];
}

export const describeLine = (line: ServiceOrderLine): OrdenLinePresentation => {
	const entry = PROVENANCE_KINDS.find((candidate) => candidate.provenance === line.provenance);
	const kind: ServiceOrderLineKind = entry?.kind ?? "item";
	const rule = LINE_KINDS[kind];
	const handles: string[] = [];
	if (line.item_code) handles.push(line.item_code);
	// Masked, never raw. `serviceOrderLines.ts` states the rule: an IMEI
	// identifies a handset and through it a person, and the only defence that
	// survives a refactor is having no field to render. Same rule, same helper.
	if (line.serial_no) handles.push(maskDeviceId(line.serial_no));
	return {
		kind,
		labelKey: rule.labelKey,
		noteKey: entry?.noteKey ?? rule.noteKey,
		handles,
	};
};

/**
 * The device ids on the order, masked for the screen.
 *
 * `35•••••••••4821` is what the artboard prints, and it is all a counter needs
 * to confirm the phone in their hand is the phone on the ticket.
 */
export const describeDeviceIds = (card: ServiceOrderCard | null): string[] =>
	(card?.serials ?? []).map((serial) => maskDeviceId(serial)).filter((value) => value.length > 0);

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

export interface OrdenBalance {
	orderTotal: number;
	advance: number;
	/** What the customer hands over. Never below zero. */
	saldo: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const num = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The order's balance, from the two figures the server already holds.
 *
 * Clamped at zero because an advance larger than the order is a REFUND, and a
 * refund is not this surface's business — Devolución owns money going the
 * other way, and a negative "COBRAR Y ENTREGAR" would ask a cashier to collect
 * a negative amount.
 */
export const describeBalance = (card: ServiceOrderCard | null): OrdenBalance => {
	const orderTotal = round2(num(card?.amount_total));
	const advance = round2(num(card?.advance));
	return { orderTotal, advance, saldo: round2(Math.max(orderTotal - advance, 0)) };
};

/**
 * The band input for the selected order.
 *
 * `null` when nothing is selected: the shell then keeps its own sale band, and
 * the surface does not put a zero under a screen with no order on it.
 *
 * `payable` is the artboard's guard made explicit — an already-invoiced order
 * arms nothing, because charging it twice is the one mistake this surface
 * exists to prevent.
 */
export const ordenBandInput = (card: ServiceOrderCard | null): BandInput | null => {
	if (!card) return null;
	const balance = describeBalance(card);
	const state = describeCardState(card);
	return {
		kind: "balanceDue",
		orderTotal: balance.orderTotal,
		advance: balance.advance,
		counterSales: 0,
		orderId: card.folio,
		payable: state.chargeable && !card.invoiced,
	};
};
