/**
 * The desktop offline queue, as a pure function (build plan §12 item E,
 * `Offline.dc.html`).
 *
 * The artboard's claim is the feature: *"Todo se guarda en esta caja y se sube
 * solo en cuanto vuelva la señal. Ningún ticket se pierde y nadie tiene que
 * apuntar nada en papel."* A shopkeeper whose internet died needs to believe
 * that, and the only thing that earns belief is the list itself — every sale
 * the register is holding, named, timed and totalled. So this module turns
 * write-queue snapshots into that list and nothing else.
 *
 * READ-ONLY over state that already exists. Nothing here enqueues, claims,
 * marks, retries or deletes; `src/offline/writeQueue.ts` owns all of that and
 * a second writer is how a sale gets submitted twice.
 *
 * Pure by construction — no Vue, no store, no `__()`, no `new Date()` without
 * being handed one — for the same reason `bandState.ts` and
 * `navbar/registerStatusLine.ts` are: the whole table can then be asserted
 * against the canvas without mounting anything, and the clock is testable.
 * Labels come out as translation KEYS and the component calls `__()`.
 */

import type { BandInput } from "../../../composables/pos/shell/bandState";

type AnyRecord = Record<string, any>;

/**
 * What the register is doing about one held sale.
 *
 * These are NOT the write queue's statuses renamed for fun — they are the
 * operator-facing collapse of them, and the collapse is where the honesty
 * lives. `dead_letter` must never read as "waiting": that row is cash in the
 * drawer with no invoice behind it (roadmap §7, class C), and the artboard's
 * calm amber "En espera" would be a lie on it.
 */
export type HeldSaleState =
	| "waiting"
	| "uploading"
	| "retrying"
	| "draftReview"
	| "stuck"
	| "uploaded";

/** Tone the row asks for. Amber and green are STATE here, never emphasis. */
export type HeldSaleTone = "warning" | "neutral" | "positive" | "danger";

export interface HeldSale {
	/** Stable list key — the queue row id when there is one, else the request id. */
	key: string;
	/**
	 * What the Ticket column renders. Offline there is no server folio yet, so
	 * this is a LOCAL reference and `ticketIsLocal` says so — the artboard's
	 * `B-04835` is a folio the register cannot mint without the server, and
	 * printing an invented one would be the worst kind of reassuring.
	 */
	ticket: string;
	ticketIsLocal: boolean;
	/** ISO instant the sale was accepted locally. THE ordering key. */
	takenAt: string;
	/** `19:44`, read off `takenAt`. */
	timeLabel: string;
	customer: string;
	/** `Cable USB-C + cargador 20 W`, from the queued invoice's own lines. */
	contents: string;
	lineCount: number;
	/** `Efectivo` — tenant data, already in the operator's language. */
	tenderLabel: string;
	/** False when `tenderLabel` is a translation key rather than tenant data. */
	tenderIsLiteral: boolean;
	amount: number;
	state: HeldSaleState;
	statusKey: string;
	statusParams?: (string | number)[];
	tone: HeldSaleTone;
	attempts: number;
	/** Present only on the rows an operator has to act on. */
	lastError: string | null;
}

const text = (value: unknown): string => String(value ?? "").trim();

const num = (value: unknown): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/** Same rounding as `bandState.ts`, for the same IEEE-754 reason. */
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * `19:44` from an ISO instant. Read with `Date` because `created_at` is a real
 * UTC instant (`new Date().toISOString()`), unlike the Frappe site-local
 * strings `registerStatusLine.formatShiftStart` has to parse textually.
 */
export function formatHeldTime(iso: string, locale?: string | null): string {
	const parsed = new Date(text(iso));
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	try {
		return new Intl.DateTimeFormat(text(locale) || undefined, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(parsed);
	} catch {
		return "";
	}
}

/**
 * `1 h 47 m`. Derived from two instants every time it is asked for — never
 * stored, never counted up. A stored duration is wrong the moment the tab
 * sleeps, and this number is read by someone deciding whether to worry.
 */
export function elapsedLabel(fromIso: string | null | undefined, now: Date): string {
	const from = new Date(text(fromIso));
	if (!text(fromIso) || Number.isNaN(from.getTime()) || Number.isNaN(now.getTime())) {
		return "";
	}
	const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
	if (minutes < 0) {
		// A clock that went backwards (NTP step, tab restored) is not an
		// elapsed time. Say nothing rather than say "-3 m".
		return "";
	}
	if (minutes < 1) {
		return "< 1 m";
	}
	const hours = Math.floor(minutes / 60);
	return hours ? `${hours} h ${minutes % 60} m` : `${minutes} m`;
}

const STATE_BY_QUEUE_STATUS: Record<string, HeldSaleState> = {
	pending: "waiting",
	syncing: "uploading",
	failed: "retrying",
	draft_review: "draftReview",
	dead_letter: "stuck",
	synced: "uploaded",
	resolved: "uploaded",
};

const STATUS_KEY: Record<HeldSaleState, string> = {
	waiting: "Waiting",
	uploading: "Uploading",
	retrying: "Retrying · attempt {0}",
	draftReview: "Saved as draft — review",
	stuck: "Not uploaded — needs attention",
	uploaded: "Uploaded",
};

const STATUS_TONE: Record<HeldSaleState, HeldSaleTone> = {
	waiting: "warning",
	uploading: "neutral",
	retrying: "warning",
	draftReview: "warning",
	// The one row that is not calm. §7: a dead letter is cash collected with
	// no invoice, and it is "visible, exportable, attributable and requeueable"
	// precisely because it cannot be allowed to sit inside a pending count.
	stuck: "danger",
	uploaded: "positive",
};

/** Rows an operator has to do something about, rather than wait out. */
export const NEEDS_ATTENTION: readonly HeldSaleState[] = Object.freeze([
	"stuck",
	"draftReview",
]);

/**
 * The Ticket column.
 *
 * Precedence is server truth first: a draft the replay already minted, then a
 * name the document carries, and only then the local request id — shortened to
 * its random tail, which is what makes two queued sales tellable apart on
 * screen without printing a 30-character key at a cashier.
 */
function resolveTicket(snapshot: AnyRecord): { ticket: string; ticketIsLocal: boolean } {
	const draftName = text(snapshot.draft_invoice_name);
	if (draftName) {
		return { ticket: draftName, ticketIsLocal: false };
	}
	const invoiceName = text(snapshot.invoice?.name);
	if (invoiceName) {
		return { ticket: invoiceName, ticketIsLocal: false };
	}
	const requestId =
		text(snapshot.invoice?.posa_client_request_id) || text(snapshot.idempotency_key);
	if (requestId) {
		const tail = requestId.split("-").pop() || requestId;
		return { ticket: tail.toUpperCase(), ticketIsLocal: true };
	}
	return { ticket: "", ticketIsLocal: true };
}

/**
 * `Combo Protección + 2 fundas` — the first lines of the sale, so the row is
 * recognisable as a transaction the cashier remembers making.
 *
 * Quantity is prefixed rather than pluralised into the name: `2 × Funda` is
 * language-neutral, and inflecting a tenant's item name is a promise no
 * catalogue can keep.
 */
function summariseItems(items: AnyRecord[], maxNames = 2): string {
	return items
		.slice(0, maxNames)
		.map((item) => {
			const name = text(item?.item_name) || text(item?.item_code);
			const qty = num(item?.qty);
			return qty > 1 && name ? `${qty} × ${name}` : name;
		})
		.filter(Boolean)
		.join(" + ");
}

/**
 * The Payment column, from the invoice's own `payments` table.
 *
 * `mode_of_payment` is tenant data and already reads in the operator's
 * language, so it passes through literally. Only the two derived cases —
 * several tenders, or none at all — are translation keys.
 */
function resolveTender(snapshot: AnyRecord): { tenderLabel: string; tenderIsLiteral: boolean } {
	const payments = Array.isArray(snapshot.invoice?.payments) ? snapshot.invoice.payments : [];
	const used = payments
		.filter((row: AnyRecord) => num(row?.amount) !== 0)
		.map((row: AnyRecord) => text(row?.mode_of_payment))
		.filter(Boolean);
	const distinct = [...new Set<string>(used)];
	if (distinct.length === 1) {
		return { tenderLabel: distinct[0]!, tenderIsLiteral: true };
	}
	if (distinct.length > 1) {
		return { tenderLabel: "Mixed", tenderIsLiteral: false };
	}
	if (num(snapshot.data?.is_credit_sale) === 1 || snapshot.data?.is_credit_sale === true) {
		return { tenderLabel: "On credit", tenderIsLiteral: false };
	}
	return { tenderLabel: "No payment recorded", tenderIsLiteral: false };
}

/**
 * Build the table.
 *
 * OLDEST FIRST, and the sort is explicit rather than inherited from
 * `getQueueEntries`'s `sortBy("created_at")`: the screen states the rule out
 * loud — *"se suben en orden, de la más vieja a la más nueva"* — so it is a
 * promise this module has to keep on its own, not a side effect of how the
 * rows happened to arrive.
 */
export function buildHeldSales(
	snapshots: readonly AnyRecord[] | null | undefined,
	options: { locale?: string | null } = {},
): HeldSale[] {
	const rows = Array.isArray(snapshots) ? snapshots : [];
	return rows
		.filter((snapshot) => snapshot && typeof snapshot === "object")
		.map((snapshot, index) => {
			const items = Array.isArray(snapshot.invoice?.items) ? snapshot.invoice.items : [];
			const takenAt = text(snapshot.created_at);
			const { ticket, ticketIsLocal } = resolveTicket(snapshot);
			const { tenderLabel, tenderIsLiteral } = resolveTender(snapshot);
			const state = STATE_BY_QUEUE_STATUS[text(snapshot.status)] ?? "waiting";
			const attempts = Math.trunc(num(snapshot.retry_count));
			const amount =
				snapshot.invoice?.grand_total ?? snapshot.invoice?.rounded_total ?? 0;

			return {
				key: text(snapshot.queue_id) || text(snapshot.idempotency_key) || `held-${index}`,
				ticket,
				ticketIsLocal,
				takenAt,
				timeLabel: formatHeldTime(takenAt, options.locale),
				customer: text(snapshot.invoice?.customer_name) || text(snapshot.invoice?.customer),
				contents: summariseItems(items),
				lineCount: items.length,
				tenderLabel,
				tenderIsLiteral,
				amount: round2(num(amount)),
				state,
				statusKey: STATUS_KEY[state],
				statusParams: state === "retrying" ? [attempts] : undefined,
				tone: STATUS_TONE[state],
				attempts,
				lastError: text(snapshot.last_error) || null,
			} satisfies HeldSale;
		})
		.sort((left, right) => left.takenAt.localeCompare(right.takenAt));
}

export interface TenderTotal {
	label: string;
	isLiteral: boolean;
	amount: number;
}

export interface HeldSalesSummary {
	/** Rows still held. `uploaded` rows are history and are not counted. */
	ticketCount: number;
	/** THE number: money taken here that the server has not confirmed. */
	totalHeld: number;
	byTender: TenderTotal[];
	/** Oldest held sale — how long the register has been carrying the queue. */
	oldestHeldAt: string | null;
	stuckCount: number;
	draftReviewCount: number;
	uploadedCount: number;
}

const isHeld = (row: HeldSale) => row.state !== "uploaded";

/**
 * Totals for the band and the side panel.
 *
 * Only HELD rows are counted. A sale that reached the server is history the
 * table may still show (dimmed, as the artboard draws it) but it is not money
 * waiting to upload, and folding it into the total would overstate the one
 * figure this screen exists to state correctly.
 */
export function summariseHeldSales(rows: readonly HeldSale[]): HeldSalesSummary {
	const held = rows.filter(isHeld);
	const byTender = new Map<string, TenderTotal>();
	for (const row of held) {
		const key = `${row.tenderIsLiteral ? "literal" : "key"}:${row.tenderLabel}`;
		const current = byTender.get(key);
		if (current) {
			current.amount = round2(current.amount + row.amount);
		} else {
			byTender.set(key, {
				label: row.tenderLabel,
				isLiteral: row.tenderIsLiteral,
				amount: row.amount,
			});
		}
	}

	return {
		ticketCount: held.length,
		totalHeld: round2(held.reduce((sum, row) => sum + row.amount, 0)),
		byTender: [...byTender.values()].sort((left, right) => right.amount - left.amount),
		oldestHeldAt: held[0]?.takenAt ?? null,
		stuckCount: held.filter((row) => row.state === "stuck").length,
		draftReviewCount: held.filter((row) => row.state === "draftReview").length,
		uploadedCount: rows.length - held.length,
	};
}

/** The band input for this screen. `bandState.ts` already models it. */
export function queuedBandInput(summary: HeldSalesSummary): BandInput {
	return { kind: "queued", amount: summary.totalHeld, ticketCount: summary.ticketCount };
}

export type UploadClaimId = "offline" | "uploading" | "clear";

export interface UploadClaim {
	id: UploadClaimId;
	labelKey: string;
	labelParams?: (string | number)[];
	tone: "warning" | "positive";
}

/**
 * The one sentence on this screen that can lie about money, and the same rule
 * `registerStatusLine.connectionChip` earned: **online is true the moment the
 * network returns, but the sales taken while it was gone have not reached the
 * server.** When the two facts disagree the weaker one wins.
 *
 * Hence three states rather than two — "back online" is not "uploaded", and a
 * cashier who reads the second one closes their shift on a promise nobody
 * made.
 */
export function resolveUploadClaim(input: {
	online?: boolean;
	summary: HeldSalesSummary;
}): UploadClaim {
	if (input.online === false) {
		return { id: "offline", labelKey: "No connection", tone: "warning" };
	}
	if (input.summary.ticketCount > 0) {
		return {
			id: "uploading",
			labelKey: "Back online · {0} still to upload",
			labelParams: [input.summary.ticketCount],
			tone: "warning",
		};
	}
	return { id: "clear", labelKey: "Everything is uploaded", tone: "positive" };
}

/**
 * Exported so the view and its tests agree on what "claims everything is
 * uploaded" means without either restating the rule — the same seam
 * `claimsSynced` gives the status line.
 */
export function claimsEverythingUploaded(claim: UploadClaim): boolean {
	return claim.id === "clear";
}

/**
 * Which of the artboard's "nada se pierde" reassurances this build can back.
 *
 * R4's ruling, applied before it can be earned twice: an offline claim ships
 * with the module that makes it checkable, or it does not ship. The artboard
 * also draws *"folios reservados por adelantado"* — nothing in this repo
 * reserves a folio, so that line is deliberately absent rather than rendered
 * as a comforting sentence with nothing behind it.
 */
export interface QueuePromise {
	id: string;
	labelKey: string;
	/** Repo path that makes the promise checkable, exactly as `backedBy` does. */
	backedBy: string;
}

export const QUEUE_PROMISES: readonly QueuePromise[] = Object.freeze([
	{
		id: "durable",
		labelKey: "Saved on this register — survives a reload",
		backedBy: "src/offline/writeQueue.ts",
	},
	{
		id: "idempotent",
		labelKey: "Each sale carries its own id, so a retry cannot bill twice",
		backedBy: "src/offline/idempotency.ts",
	},
	{
		id: "stock",
		labelKey: "Stock is discounted here while the signal is gone",
		backedBy: "src/offline/stock.ts",
	},
]);
