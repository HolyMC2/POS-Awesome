/**
 * The service order, as the register has to BILL it (roadmap §4.6, artboard
 * `MovilOrden.dc.html`).
 *
 * Pure on purpose, for the same reason `composables/pos/shell/bandState.ts`
 * is: the three facts this screen can get wrong are all arithmetic or
 * disclosure, and neither is worth testing through a mounted component.
 *
 * The three facts:
 *
 * 1. **A line that costs nothing is still a line.** The customer's own glass
 *    is inside their phone; it belongs on the ticket and it must not be
 *    billed. Nothing here filters a zero amount out of the list, and
 *    `billsTo: "none"` keeps it out of every sum — the two halves of the same
 *    promise, which is why they live in one table (`LINE_KINDS`) rather than
 *    in two places that can drift.
 *
 * 2. **The device id is masked before it is a view model.** `ServiceOrderView`
 *    has no field for the raw IMEI, so a component physically cannot render
 *    one, and no `title`/`aria-label`/`data-*` can leak it back. Masking in
 *    the template would be a convention; masking here is a type.
 *
 * 3. **The balance is not the order total.** `Orden − Anticipo + Mostrador`
 *    is decided by `resolveBandState`, which already models this exact case.
 *    This module feeds it; it never computes a competing figure.
 *
 * Strings are English source keys — the component calls `__()` on them. Same
 * rule `railDestinations.ts` follows, and for the same reason: a preset that
 * renames "refacción" must not have to fork a module.
 */

import type { BandInput } from "../../../../composables/pos/shell/bandState";

/**
 * What a line IS, in the workshop's own terms. The kind is not decoration:
 * it decides where the money goes, which is why `billsTo` is derived from it
 * rather than sent alongside it.
 */
export type ServiceOrderLineKind =
	/** Mano de obra — the technician's time. */
	| "labour"
	/** Refacción — a part the job consumes. */
	| "part"
	/** A catalogue line billed on the order with no further qualifier. */
	| "item"
	/** Pieza del cliente — their own part, fitted, never charged. */
	| "customerPart"
	/** De mostrador — a retail sale riding the same ticket (§4.6). */
	| "counter";

/**
 * Which sum a line lands in. Three destinations, not two: the counter sale is
 * on the ticket but it is NOT part of what the workshop quoted, and the
 * anticipo was taken against the quote. Folding it into the order total would
 * make the advance look smaller than it was.
 */
export type ServiceOrderBillsTo = "order" | "counter" | "none";

interface LineKindRule {
	/** Qualifier under the description. `null` renders the code alone. */
	labelKey: string | null;
	/** Second qualifier, after the label. */
	noteKey: string | null;
	billsTo: ServiceOrderBillsTo;
}

/**
 * The whole rule set, as data.
 *
 * `item` carries no label because the artboard draws none — `Mica Cristal
 * instalada · IPN003614` stands on its own, while the two lines either side
 * of it say "mano de obra" and "refacción". A qualifier that appears on every
 * line stops qualifying anything.
 */
export const LINE_KINDS: Readonly<Record<ServiceOrderLineKind, LineKindRule>> =
	Object.freeze({
		labour: { labelKey: "labour", noteKey: null, billsTo: "order" },
		part: { labelKey: "part", noteKey: null, billsTo: "order" },
		item: { labelKey: null, noteKey: null, billsTo: "order" },
		// "no charge" is a NOTE, not the label, because the two facts are
		// independent: whose part it is, and whether it is billed. A future
		// warranty replacement is someone else's part at no charge.
		customerPart: {
			labelKey: "customer's part",
			noteKey: "no charge",
			billsTo: "none",
		},
		counter: {
			labelKey: "from the counter",
			noteKey: "same ticket",
			billsTo: "counter",
		},
	});

export const isServiceOrderLineKind = (
	value: unknown,
): value is ServiceOrderLineKind =>
	typeof value === "string" &&
	Object.prototype.hasOwnProperty.call(LINE_KINDS, value);

/**
 * Spellings Taller may send for a kind.
 *
 * Deliberately small and exact. It maps snake_case and the Spanish the
 * workshop's own doctype is likely to use onto the canonical ids — it does
 * NOT guess from the price. A zero-rate line is not evidence of a customer's
 * part: it is equally a warranty replacement or a courtesy, and printing
 * "pieza del cliente" on someone else's free part is its own lie. An
 * unrecognised kind falls back to `item`, which bills to the order exactly as
 * the server already does today.
 */
const KIND_ALIASES: Readonly<Record<string, ServiceOrderLineKind>> =
	Object.freeze({
		labor: "labour",
		labour: "labour",
		mano_de_obra: "labour",
		service: "labour",
		part: "part",
		refaccion: "part",
		spare: "part",
		item: "item",
		customer_part: "customerPart",
		customerpart: "customerPart",
		pieza_del_cliente: "customerPart",
		counter: "counter",
		mostrador: "counter",
		retail: "counter",
	});

export const resolveLineKind = (value: unknown): ServiceOrderLineKind => {
	if (isServiceOrderLineKind(value)) return value;
	if (typeof value !== "string") return "item";
	return KIND_ALIASES[value.trim().toLowerCase()] ?? "item";
};

/**
 * A line as the Charge Request sends it.
 *
 * `item_code`, `qty`, `uom`, `rate` and `description` are what
 * `api/charge_requests.load_charge_request` actually returns today — it
 * `json.loads`es the request's `items_json` and hands it over untouched, and
 * `prepare_charge_request_invoice` reads exactly those five. `kind` is the
 * field this screen NEEDS and the payload does not yet carry; absent it,
 * every line resolves to `item` and bills to the order, which is what happens
 * today anyway. Nothing here silently improves on the wire.
 */
export interface ServiceOrderLineInput {
	item_code?: string | null;
	description?: string | null;
	qty?: unknown;
	rate?: unknown;
	uom?: string | null;
	/** Proposed wire field — see `KIND_ALIASES` for the spellings accepted. */
	kind?: unknown;
}

export interface ServiceOrderLine {
	/** Stable `v-for` key. Item codes repeat across a job; the index does not. */
	key: string;
	kind: ServiceOrderLineKind;
	description: string;
	itemCode: string;
	kindLabelKey: string | null;
	noteKey: string | null;
	billsTo: ServiceOrderBillsTo;
	chargeable: boolean;
	/** What this line adds to the ticket. Already rounded; raw, not formatted. */
	amount: number;
}

/**
 * `1450.00000000002` is what `qty * rate` gives often enough to matter, and a
 * ticket that renders a total one ten-trillionth off is a ticket someone
 * re-adds by hand.
 */
const round2 = (value: number) =>
	Math.round((value + Number.EPSILON) * 100) / 100;

const num = (value: unknown) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";

/**
 * `qty × rate`, and nothing else.
 *
 * Not an `amount` field even if one arrives: `prepare_charge_request_invoice`
 * builds the invoice line from `qty` and `rate`, so those two ARE what the
 * customer pays. A screen that showed a supplied `amount` would be showing a
 * number the register is not about to charge.
 */
export const lineAmount = (
	line: ServiceOrderLineInput,
	kind: ServiceOrderLineKind,
): number => {
	if (LINE_KINDS[kind].billsTo === "none") {
		// The money guard, and the reason it is HERE rather than in the sum:
		// a customer's part that arrives priced — a mis-keyed order, a
		// template that carried a rate over — must read zero on screen as
		// well as add zero to the total. Two places to forget is one too many.
		return 0;
	}
	return round2(num(line.qty) * num(line.rate));
};

export const toServiceOrderLine = (
	input: ServiceOrderLineInput,
	index: number,
): ServiceOrderLine => {
	const kind = resolveLineKind(input.kind);
	const rule = LINE_KINDS[kind];
	const itemCode = text(input.item_code);
	return {
		key: `${index}:${itemCode || "line"}`,
		kind,
		description: text(input.description) || itemCode,
		itemCode,
		kindLabelKey: rule.labelKey,
		noteKey: rule.noteKey,
		billsTo: rule.billsTo,
		chargeable: rule.billsTo !== "none",
		amount: lineAmount(input, kind),
	};
};

/**
 * Every line, in the order Taller sent them.
 *
 * No filter. Not on zero, not on kind, not on an empty description — a line
 * the workshop wrote down is a line the customer is entitled to see. The
 * customer's own glass is the case that makes this load-bearing: drop it for
 * being worth nothing and the ticket reads as though the shop supplied it.
 */
export const toServiceOrderLines = (
	inputs: readonly ServiceOrderLineInput[] | null | undefined,
): ServiceOrderLine[] =>
	Array.isArray(inputs) ? inputs.map(toServiceOrderLine) : [];

export interface ServiceOrderTotals {
	/** What the workshop quoted — the figure the anticipo was taken against. */
	orderTotal: number;
	/** Retail riding the same ticket. */
	counterSales: number;
	/** Lines the customer is not charged for. Shown, never summed. */
	uncharged: number;
	lineCount: number;
}

export const serviceOrderTotals = (
	lines: readonly ServiceOrderLine[],
): ServiceOrderTotals => {
	let orderTotal = 0;
	let counterSales = 0;
	let uncharged = 0;
	for (const line of lines) {
		if (line.billsTo === "order") orderTotal += line.amount;
		else if (line.billsTo === "counter") counterSales += line.amount;
		else uncharged += 1;
	}
	return {
		orderTotal: round2(orderTotal),
		counterSales: round2(counterSales),
		uncharged,
		lineCount: lines.length,
	};
};

/**
 * The band input for this screen. `resolveBandState` owns the arithmetic;
 * this only decides which of our three sums is which of its three inputs.
 */
export const serviceOrderBandInput = (
	lines: readonly ServiceOrderLine[],
	options: { advance?: unknown; orderId?: string; payable?: boolean } = {},
): Extract<BandInput, { kind: "balanceDue" }> => {
	const totals = serviceOrderTotals(lines);
	return {
		kind: "balanceDue",
		orderTotal: totals.orderTotal,
		advance: round2(num(options.advance)),
		counterSales: totals.counterSales,
		orderId: options.orderId ?? "",
		payable: options.payable,
	};
};

/**
 * How much of a device id stays readable: enough to confirm the phone on the
 * counter is the phone on the ticket, not enough to copy down.
 */
const HEAD = 2;
const TAIL = 4;
/** Layout, not secrecy — a 40-character serial would blow the card open. */
const MAX_DOTS = 12;

/**
 * Mask an IMEI or serial: `356938035643821` → `35•••••••••4821`.
 *
 * An IMEI identifies a handset and, through it, a person; it is the one field
 * on this screen that is worth stealing. Short ids are masked ENTIRELY rather
 * than mostly-revealed, because head+tail on a six-character serial leaves
 * nothing hidden.
 */
export const maskDeviceId = (raw: unknown): string => {
	const compact = text(raw).replace(/[\s-]/g, "");
	if (!compact) return "";
	if (compact.length <= HEAD + TAIL) return "•".repeat(compact.length);
	const dots = Math.min(compact.length - HEAD - TAIL, MAX_DOTS);
	return `${compact.slice(0, HEAD)}${"•".repeat(dots)}${compact.slice(-TAIL)}`;
};

/** The last four, for a screen reader that would otherwise read out bullets. */
export const deviceIdTail = (raw: unknown): string => {
	const compact = text(raw).replace(/[\s-]/g, "");
	return compact.length > HEAD + TAIL ? compact.slice(-TAIL) : "";
};

/**
 * Evidence state. `unknown` is a first-class value and not a synonym for
 * "fine": a tick the register never actually checked is worse than a blank,
 * because it tells the cashier a verification happened.
 */
export type EvidenceState = "ok" | "attention" | "unknown";

export interface ServiceOrderEvidenceChip {
	id: string;
	state: EvidenceState;
	labelKey: string;
	labelParams?: (string | number)[];
	/**
	 * True when this chip should stop the sale. Only one does — §4.6's
	 * already-invoiced guard — and the server enforces it too
	 * (`prepare_charge_request_invoice`'s money guard 1). This is the
	 * cashier's copy of that refusal, arriving before they press the button
	 * rather than after.
	 */
	blocking?: true;
}

export interface ServiceOrderEvidenceInput {
	/** `null` when the workshop never recorded a check. */
	deviceIdVerified?: boolean | null;
	photoCount?: number | null;
	/** True means it HAS been invoiced before — the exception, not the norm. */
	invoicedBefore?: boolean | null;
	warrantyDays?: number | null;
}

export const serviceOrderEvidence = (
	input: ServiceOrderEvidenceInput = {},
): ServiceOrderEvidenceChip[] => {
	const chips: ServiceOrderEvidenceChip[] = [];

	if (input.deviceIdVerified === true) {
		chips.push({ id: "deviceId", state: "ok", labelKey: "IMEI verified" });
	} else if (input.deviceIdVerified === false) {
		chips.push({
			id: "deviceId",
			state: "attention",
			labelKey: "IMEI not verified",
		});
	} else {
		chips.push({
			id: "deviceId",
			state: "unknown",
			labelKey: "IMEI check not recorded",
		});
	}

	const photos = input.photoCount;
	if (typeof photos === "number" && Number.isFinite(photos) && photos > 0) {
		chips.push({
			id: "photos",
			state: "ok",
			labelKey: "{0} photos",
			labelParams: [Math.trunc(photos)],
		});
	} else if (photos === 0) {
		chips.push({ id: "photos", state: "attention", labelKey: "No photos" });
	} else {
		chips.push({
			id: "photos",
			state: "unknown",
			labelKey: "Photos not recorded",
		});
	}

	if (input.invoicedBefore === false) {
		chips.push({
			id: "invoiced",
			state: "ok",
			labelKey: "Not invoiced before",
		});
	} else if (input.invoicedBefore === true) {
		chips.push({
			id: "invoiced",
			state: "attention",
			labelKey: "Already invoiced",
			blocking: true,
		});
	} else {
		chips.push({
			id: "invoiced",
			state: "unknown",
			labelKey: "Invoicing history not checked",
		});
	}

	const warranty = input.warrantyDays;
	if (
		typeof warranty === "number" &&
		Number.isFinite(warranty) &&
		warranty > 0
	) {
		chips.push({
			id: "warranty",
			state: "ok",
			labelKey: "{0} d warranty",
			labelParams: [Math.trunc(warranty)],
		});
	} else {
		chips.push({
			id: "warranty",
			state: "unknown",
			labelKey: "No warranty recorded",
		});
	}

	return chips;
};

export const evidenceBlocks = (
	chips: readonly ServiceOrderEvidenceChip[],
): boolean => chips.some((chip) => chip.blocking === true);

/**
 * The Charge Request as this screen consumes it.
 *
 * SHIPPED TODAY by `load_charge_request`: `name`, `customer`, `company`,
 * `source_label`, `reference_doctype`, `reference_name`, `amount_total`,
 * `items`.
 *
 * PROPOSED, and absent from the payload as of 2026-08-22: `customer_name`,
 * `device_label`, `device_id`, `device_id_label`, `technician`, `advance`,
 * `fiscal`, `status`, the per-line `kind`, and the whole evidence block. The
 * screen degrades honestly without each of them — an absent device id hides
 * the row, an absent advance is zero, absent evidence reads "not recorded" —
 * rather than inventing a value. What it must never do is show a tick for a
 * check that did not happen.
 */
export interface ServiceOrderPayload {
	name?: string | null;
	customer?: string | null;
	customer_name?: string | null;
	source_label?: string | null;
	items?: readonly ServiceOrderLineInput[] | null;
	device_label?: string | null;
	/** Raw IMEI/serial. Consumed here and never re-emitted — see the header. */
	device_id?: string | null;
	device_id_label?: string | null;
	technician?: string | null;
	advance?: unknown;
	fiscal?: boolean | null;
	status_key?: string | null;
	evidence?: ServiceOrderEvidenceInput | null;
}

/**
 * What the component is allowed to know.
 *
 * Note what is NOT on this interface: the raw device id. `toServiceOrderView`
 * is the only place it exists, and it leaves as a mask. That is the whole
 * disclosure control — there is no template discipline to remember, because
 * there is no field to render.
 */
export interface ServiceOrderView {
	orderId: string;
	statusKey: string;
	fiscal: boolean;
	customerName: string;
	deviceLabel: string;
	deviceIdLabelKey: string;
	deviceIdMasked: string;
	deviceIdTail: string;
	technician: string;
	advance: number;
	lines: ServiceOrderLine[];
	totals: ServiceOrderTotals;
	evidence: ServiceOrderEvidenceChip[];
	blocked: boolean;
}

export const toServiceOrderView = (
	payload: ServiceOrderPayload | null | undefined,
): ServiceOrderView | null => {
	if (!payload) return null;
	const lines = toServiceOrderLines(payload.items);
	const evidence = serviceOrderEvidence(payload.evidence ?? {});
	return {
		orderId: text(payload.source_label) || text(payload.name),
		statusKey: text(payload.status_key) || "Ready for pickup",
		fiscal: payload.fiscal === true,
		customerName: text(payload.customer_name) || text(payload.customer),
		deviceLabel: text(payload.device_label),
		deviceIdLabelKey: text(payload.device_id_label) || "IMEI",
		deviceIdMasked: maskDeviceId(payload.device_id),
		deviceIdTail: deviceIdTail(payload.device_id),
		technician: text(payload.technician),
		advance: round2(num(payload.advance)),
		lines,
		totals: serviceOrderTotals(lines),
		evidence,
		blocked: evidenceBlocks(evidence),
	};
};
