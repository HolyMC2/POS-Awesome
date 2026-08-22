/**
 * The phone's offline surface, as a pure function (build plan §12 G,
 * `MovilOffline.dc.html`).
 *
 * Three things exist already and are REUSED rather than restated:
 *
 *   - `pos/offline/offlineQueueModel.ts` turns write-queue snapshots into
 *     `HeldSale` rows and sums them. The money on this screen comes from
 *     there, so the phone and the desktop cannot disagree about how much the
 *     shop is carrying.
 *   - `shell/mobile/offlineSurfaceManifest.ts` declares what the register can
 *     still do with no server. That is the audited answer (§8 R4) and this
 *     file never hardcodes a second copy of it.
 *   - `pos/offline/useOfflineQueue.ts` owns Reintentar, which dispatches the
 *     EXISTING drain. Nothing here retries, enqueues or writes.
 *
 * What is genuinely new — and the reason this module exists rather than a few
 * computeds in a component — is that a 390 px screen shows FIVE rows out of
 * twenty-seven, and choosing which five is a decision about money. See
 * `buildMobileOfflinePage`.
 *
 * Pure by construction, like `offlineQueueModel.ts` and `bandState.ts`: no
 * Vue, no store, no `__()`, no `new Date()` without being handed one.
 */

import {
	summariseHeldSales,
	elapsedLabel,
	type HeldSale,
	type HeldSalesSummary,
} from "../../offline/offlineQueueModel";
import {
	OFFLINE_SURFACES,
	surfacesThatNeedSignal,
	surfacesThatWorkOffline,
	type OfflineSurface,
} from "../../shell/mobile/offlineSurfaceManifest";

/** A sale the server has confirmed. History on this screen, never money. */
const isUploaded = (row: HeldSale) => row.state === "uploaded";

export interface MobileOfflinePage {
	/** Exactly the rows to draw, in draw order. */
	rows: HeldSale[];
	/**
	 * Sales still HELD that did not fit — what `…y 19 tickets más en la cola`
	 * counts. Never includes uploaded history: the sentence says "in the
	 * queue", and history is not in the queue.
	 */
	hiddenHeldCount: number;
	/** The totals, from the queue itself. */
	summary: HeldSalesSummary;
}

export interface MobileOfflinePageOptions {
	/** Rows the phone draws before folding the rest into a count. */
	maxRows?: number;
	/** Recently-confirmed sales shown as evidence that uploads happen. */
	uploadedTail?: number;
}

/**
 * Choose the rows the phone draws.
 *
 * The desktop can show forty rows and the ordering promise — oldest first — is
 * the whole story. The phone shows five, so a naive `slice(0, 5)` over the
 * same oldest-first list would show five sales that ALREADY UPLOADED and hide
 * every one still waiting: uploaded rows are, by definition, the ones from
 * before the outage, which is to say the oldest. A shopkeeper would read an
 * all-green list while twenty-three tickets sat behind it.
 *
 * So held rows are drawn first, oldest first, and the artboard's single dimmed
 * `subido` row is appended as a TAIL — the most recently confirmed sale, which
 * is the one that actually evidences "se sube solo". `uploadedTail` never eats
 * a held row's place beyond the one it occupies, and when nothing is held the
 * page is empty so the list can say so honestly rather than showing history
 * under a heading that promises a queue.
 *
 * The oldest-first sort is applied here rather than inherited from
 * `buildHeldSales`: the screen states the rule out loud, so this module keeps
 * it on its own instead of depending on how the rows happened to arrive.
 */
export function buildMobileOfflinePage(
	rows: readonly HeldSale[] | null | undefined,
	options: MobileOfflinePageOptions = {},
): MobileOfflinePage {
	const all = Array.isArray(rows) ? rows.filter(Boolean) : [];
	const maxRows = Math.max(0, Math.trunc(options.maxRows ?? 5));
	const uploadedTail = Math.max(0, Math.trunc(options.uploadedTail ?? 1));

	const byOldest = (left: HeldSale, right: HeldSale) =>
		left.takenAt.localeCompare(right.takenAt);

	const held = all.filter((row) => !isUploaded(row)).sort(byOldest);
	const summary = summariseHeldSales(all);

	if (!held.length) {
		return { rows: [], hiddenHeldCount: 0, summary };
	}

	// Newest first, then take the tail: the most recent confirmation is the
	// one that says the queue is moving NOW.
	const uploaded = all
		.filter(isUploaded)
		.sort((left, right) => right.takenAt.localeCompare(left.takenAt))
		.slice(0, uploadedTail);

	const heldSlots = Math.max(0, maxRows - uploaded.length);
	const shownHeld = held.slice(0, heldSlots);

	return {
		rows: [...shownHeld, ...uploaded],
		hiddenHeldCount: held.length - shownHeld.length,
		summary,
	};
}

export interface MobileCapabilityColumns {
	/** `Sí puedes` — everything still usable with no server. */
	canDo: OfflineSurface[];
	/** `Espera señal` — the round trips with no local answer. */
	mustWait: OfflineSurface[];
}

/**
 * The two columns, from the manifest and from nothing else.
 *
 * One call rather than two filters at the call site, so a future edit cannot
 * narrow one column and leave the other showing a surface it no longer
 * contradicts. Every surface lands in exactly one column by construction,
 * which is the property `movilOfflineSurface.spec.ts` asserts.
 */
export function mobileCapabilityColumns(
	surfaces: readonly OfflineSurface[] = OFFLINE_SURFACES,
): MobileCapabilityColumns {
	return {
		canDo: surfacesThatWorkOffline(surfaces),
		mustWait: surfacesThatNeedSignal(surfaces),
	};
}

export type OfflineElapsedSource = "connection" | "queue" | "none";

export interface OfflineElapsed {
	source: OfflineElapsedSource;
	/** Untranslated; the component calls `__()`. Empty when there is nothing true to say. */
	labelKey: string;
	/** `1 h 47 m`. Empty hides the block rather than showing a zero. */
	value: string;
}

/**
 * How long this has been going on — and WHICH fact that is.
 *
 * Two sources, and the label changes with them because they are two different
 * things: the shell's `offlineSince` is when the connection dropped; the
 * oldest held sale is when the register last managed to hand money to the
 * server. Labelling the second one "sin conexión desde" is the same class of
 * lie as "En línea · sincronizado" over a full queue, so the weaker fact gets
 * the weaker sentence.
 *
 * `OfflineQueueView.vue` states the same rule inline, with the longer wording a
 * desktop banner has room for (`Sin conexión desde`); the phone uses the
 * artboard's `sin señal`. The words differ by viewport, the rule does not —
 * which is why it is a tested function here and a reported cleanup there.
 */
export function resolveOfflineElapsed(input: {
	offlineSince?: string | null;
	summary: HeldSalesSummary;
	now: Date;
}): OfflineElapsed {
	if (input.offlineSince) {
		return {
			source: "connection",
			labelKey: "no signal",
			value: elapsedLabel(input.offlineSince, input.now),
		};
	}
	if (input.summary.oldestHeldAt) {
		return {
			source: "queue",
			labelKey: "Holding sales for",
			value: elapsedLabel(input.summary.oldestHeldAt, input.now),
		};
	}
	return { source: "none", labelKey: "", value: "" };
}
