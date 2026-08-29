/**
 * The register's bottom band, as a pure function (roadmap §17.7).
 *
 * The design invariant is "one number, one action": at any moment the band
 * carries the single number that matters and the single thing to do about it.
 * That invariant is enforced HERE, by the return type — `BandState` has one
 * `value` and one `primaryAction`, so a surface physically cannot render two
 * competing totals without going around this module. A rule that lives only
 * in a reviewer's memory is a rule that decays; this one fails the build.
 *
 * Pure on purpose: no Vue, no store, no formatter, no `__()`. The caller
 * passes a discriminated `BandInput` in and gets a description out, which is
 * what lets the whole eight-state matrix be tested against the design canvas
 * without mounting anything. Formatting belongs to the component (the repo
 * already has `useFormatters` for that) — a pure module that formats is a
 * pure module that has to know the tenant's currency and precision.
 *
 * Reference: muelle-site/design/register-hifi, artboards Main, Cobro, Corte,
 * Devolucion, Offline, Recargas, Orden, Apertura.
 */

/**
 * Tint the band asks for. Four tones, but only THREE tints on screen — see
 * `TONE_IS_TINTED` below. The canvas states it plainly: "neutro para vender,
 * verde para el cambio, ámbar para el faltante".
 */
export type BandTone = "neutral" | "positive" | "warning" | "queued";

/** Which of the eight numbers the band is currently showing. */
export type BandKind =
	| "sale"
	| "change"
	| "shortfall"
	| "balanceDue"
	| "refund"
	| "recharge"
	| "opening"
	| "closing"
	| "queued"
	| "floorAccount"
	| "tableSale"
	| "hostedContext";

/**
 * Stable action ids, decoupled from key bindings so the shortcuts engine
 * (§17.3) can bind them without the band knowing which key it got.
 */
export type BandActionId =
	| "sale.pay"
	| "sale.collectAndClose"
	| "order.collectAndDeliver"
	| "return.refund"
	| "recharge.submit"
	| "shift.open"
	| "shift.close"
	| "offline.keepSelling"
	| "floor.chargeAccount"
	| "table.saveAndReturn"
	| "sale.return";

export interface BandAction {
	id: BandActionId;
	/** Translation key; the component calls `__()` on it. */
	labelKey: string;
	/** Interpolation values for `labelKey`, in `{0}`-style order. */
	labelParams?: (string | number)[];
}

export interface BandState {
	kind: BandKind;
	tone: BandTone;
	/** THE number. Raw — the component formats it. */
	value: number;
	/** Translation key for the caption above the number. */
	labelKey: string;
	labelParams?: (string | number)[];
	/** THE action. Exactly one, never a list. */
	primaryAction: BandAction;
	primaryEnabled: boolean;
}

/**
 * `queued` deliberately shares the neutral tint. Money waiting to upload is
 * not money that is wrong, and the offline STATE is already signalled where
 * it belongs — the overlay and the amber dot on the dock. Tinting the band
 * too would spend the warning colour on a situation the cashier can do
 * nothing about, and §17.7's whole point is that amber means "look at this".
 * The tone still exists so tests and `aria` can tell the two apart.
 */
const TONE_TINT: Record<BandTone, "neutral" | "positive" | "warning"> = {
	neutral: "neutral",
	positive: "positive",
	warning: "warning",
	queued: "neutral",
};

export const tintForTone = (tone: BandTone) => TONE_TINT[tone];

/**
 * Money rounding. `973.28 + 155.72` is `1129.0000000000002` in IEEE 754, and
 * a band that renders a total one ten-trillionth off is a band that fails its
 * own canvas test for the silliest possible reason.
 */
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const num = (value: unknown) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

export type BandInput =
	/** Venta: the cart is open and the number is what the customer owes. */
	| { kind: "sale"; total: unknown; itemCount?: unknown; payable?: boolean }
	/**
	 * Cobro: tender in progress. Whether this reads as change or as a
	 * shortfall is decided here, not by the caller — that decision IS the
	 * band's job.
	 */
	| { kind: "tender"; total: unknown; received: unknown }
	/** Orden de servicio: order total less advances, plus counter sales. */
	| {
			kind: "balanceDue";
			orderTotal: unknown;
			advance?: unknown;
			counterSales?: unknown;
			orderId?: string;
			payable?: boolean;
	  }
	/** Devolución: what goes back, and by which tender it came in. */
	| { kind: "refund"; amount: unknown; ticketId?: string; refundable?: boolean }
	/** Recarga: airtime or service payment about to be sent. */
	| {
			kind: "recharge";
			amount: unknown;
			carrier?: string;
			msisdn?: string;
			ready?: boolean;
	  }
	/** Apertura: the float, gated on §5.1's verified readiness check. */
	| { kind: "opening"; float: unknown; blockingIssues?: unknown }
	/** Corte: counted against expected. */
	| { kind: "closing"; expected: unknown; counted: unknown; canClose?: boolean }
	/** Sin conexión: what is still waiting to upload. */
	| { kind: "queued"; amount: unknown; ticketCount?: unknown }
	/**
	 * Salón: the floor owns the stage and the number is the SELECTED cuenta's
	 * own total — never the table's aggregate, which cannot be charged in one
	 * press (RESTAURANT_UX_MAP §5).
	 */
	| { kind: "floorAccount"; total: unknown; accountLabel?: string; chargeable?: boolean }
	/**
	 * A sale owned by a table order. The verb is SAVE, not PAY: the seated loop
	 * ends by putting the round on the cuenta and going back to the room
	 * (CAFETERIA_GOLDEN_FLOW.md §3).
	 */
	| { kind: "tableSale"; total: unknown; accountLabel?: string; lineCount?: unknown }
	/**
	 * A hosted destination (Gasto, Cobranza, Borradores…) owns the stage and
	 * has published no band of its own. The band must not keep wearing the
	 * sale's PAGAR over a surface that cannot pay — the one thing it can
	 * honestly say is that the sale is still there behind the sheet, and the
	 * one thing it can honestly do is go back to it (critique A1, 08-29).
	 */
	| { kind: "hostedContext"; total: unknown; itemCount?: unknown };

/**
 * Resolve the band for the current moment.
 *
 * Every branch returns exactly one number and exactly one action; that is the
 * whole contract, and `tests/bandState.spec.ts` walks all eight against the
 * canvas's own money so the code and the reference cannot drift apart.
 */
export function resolveBandState(input: BandInput): BandState {
	switch (input.kind) {
		case "sale": {
			const total = round2(num(input.total));
			const itemCount = Math.trunc(num(input.itemCount));
			return {
				kind: "sale",
				tone: "neutral",
				value: total,
				labelKey: "Total to charge · {0} items",
				labelParams: [itemCount],
				primaryAction: { id: "sale.pay", labelKey: "PAY" },
				// A zero cart is not payable. The button stays visible so the
				// band never changes shape mid-sale — it just cannot be pressed.
				primaryEnabled: input.payable ?? total > 0,
			};
		}

		case "tender": {
			const total = round2(num(input.total));
			const received = round2(num(input.received));
			const delta = round2(received - total);

			// THE boundary. `received === total` is exact change: nothing is
			// missing, so it is not a shortfall, and the sale can close. Below
			// it the number is what is still owed; at or above it the number is
			// what goes back to the customer.
			if (delta < 0) {
				return {
					kind: "shortfall",
					tone: "warning",
					value: round2(-delta),
					labelKey: "Still owed",
					primaryAction: { id: "sale.collectAndClose", labelKey: "CHARGE AND PRINT" },
					primaryEnabled: false,
				};
			}

			return {
				kind: "change",
				tone: "positive",
				value: delta,
				labelKey: "Change to give",
				// The register's default close PRINTS (owner direction
				// 2026-08-24): the ticket is the receipt the customer walks
				// away with, so paper is the primary and the no-paper close
				// is the outlined option on the Cobro column. The action id
				// stays `sale.collectAndClose` — the shell wires the print
				// flag, not the label.
				primaryAction: { id: "sale.collectAndClose", labelKey: "CHARGE AND PRINT" },
				primaryEnabled: true,
			};
		}

		case "balanceDue": {
			const balance = round2(
				num(input.orderTotal) - num(input.advance) + num(input.counterSales),
			);
			return {
				kind: "balanceDue",
				tone: "neutral",
				value: balance,
				labelKey: "Balance due · order {0}",
				labelParams: [input.orderId ?? ""],
				primaryAction: { id: "order.collectAndDeliver", labelKey: "COLLECT AND DELIVER" },
				primaryEnabled: input.payable ?? balance > 0,
			};
		}

		case "refund": {
			const amount = round2(num(input.amount));
			return {
				kind: "refund",
				// Amber, not green. Money leaving the drawer against an earlier
				// sale is an exception the supervisor's inbox cares about (§5.4),
				// not a success state.
				tone: "warning",
				value: amount,
				labelKey: "To refund · ticket {0}",
				labelParams: [input.ticketId ?? ""],
				primaryAction: {
					id: "return.refund",
					labelKey: "REFUND {0}",
					labelParams: [amount],
				},
				primaryEnabled: input.refundable ?? amount > 0,
			};
		}

		case "recharge": {
			const amount = round2(num(input.amount));
			// The caption names what the register knows and nothing else. With
			// the destination just opened — no company, no number — the full
			// form rendered as "To recharge · ·", two separators around two
			// blanks. Same rule as the readiness chips: no chip without evidence.
			const known = [input.carrier, input.msisdn].filter(
				(part): part is string => typeof part === "string" && part.trim().length > 0,
			);
			const labelKey =
				known.length === 2
					? "To recharge · {0} · {1}"
					: known.length === 1
						? "To recharge · {0}"
						: "To recharge";
			return {
				kind: "recharge",
				tone: "neutral",
				value: amount,
				labelKey,
				labelParams: known,
				primaryAction: { id: "recharge.submit", labelKey: "RECHARGE" },
				primaryEnabled: input.ready ?? amount > 0,
			};
		}

		case "opening": {
			const float = round2(num(input.float));
			const blocking = Math.trunc(num(input.blockingIssues));
			return {
				kind: "opening",
				tone: "neutral",
				value: float,
				labelKey: "Opening float",
				primaryAction: { id: "shift.open", labelKey: "OPEN SHIFT" },
				// §5.1: opening VERIFIES rather than asks. One unmet requirement
				// and the register genuinely cannot open, so the button says so.
				// Optional warnings do not reach `blockingIssues`.
				primaryEnabled: blocking === 0,
			};
		}

		case "closing": {
			const expected = round2(num(input.expected));
			const counted = round2(num(input.counted));
			const difference = round2(counted - expected);
			return {
				kind: "closing",
				// A surplus is an exception too — cash that appeared is as
				// unexplained as cash that vanished, and both need a reason
				// before the drawer closes. Only a clean zero is calm.
				tone: difference === 0 ? "positive" : "warning",
				value: difference,
				labelKey: difference < 0 ? "Difference · short" : difference > 0 ? "Difference · over" : "Difference",
				primaryAction: { id: "shift.close", labelKey: "CLOSE SHIFT" },
				primaryEnabled: input.canClose ?? true,
			};
		}

		case "queued": {
			const amount = round2(num(input.amount));
			const ticketCount = Math.trunc(num(input.ticketCount));
			return {
				kind: "queued",
				tone: "queued",
				value: amount,
				labelKey: "To upload · {0} tickets queued",
				labelParams: [ticketCount],
				// Offline's whole promise is that the queue is not the cashier's
				// problem, so the action returns them to the sale rather than
				// asking them to do something about the backlog.
				primaryAction: { id: "offline.keepSelling", labelKey: "KEEP SELLING" },
				primaryEnabled: true,
			};
		}

		case "floorAccount": {
			const total = round2(num(input.total));
			const label = (input.accountLabel ?? "").trim();
			return {
				kind: "floorAccount",
				tone: "neutral",
				value: total,
				// No account picked yet is a real state of this screen — the
				// waiter walks in on it — so it gets its own caption rather than
				// an identity line with a hole in it (the same rule `recharge`
				// follows for a destination with no carrier yet).
				labelKey: label ? "Open account · {0}" : "No account selected",
				labelParams: label ? [label] : undefined,
				primaryAction: { id: "floor.chargeAccount", labelKey: "CHARGE ACCOUNT" },
				// UX map §5: Charge is never OFFERED for an empty account. The
				// button keeps its place (the band must not change shape while a
				// waiter taps around the room) and refuses the press.
				primaryEnabled: input.chargeable ?? total > 0,
			};
		}

		case "tableSale": {
			const total = round2(num(input.total));
			const label = (input.accountLabel ?? "").trim();
			const lineCount = Math.trunc(num(input.lineCount));
			return {
				kind: "tableSale",
				tone: "neutral",
				value: total,
				labelKey: label ? "{0} · {1} lines" : "Table account · {0} lines",
				labelParams: label ? [label, lineCount] : [lineCount],
				primaryAction: { id: "table.saveAndReturn", labelKey: "SAVE · BACK TO FLOOR" },
				// Always pressable, including on an empty cuenta: going back to
				// the room is how a waiter leaves a table they opened by mistake,
				// and «Liberar mesa» lives on the mesa sheet, not here.
				primaryEnabled: true,
			};
		}

		case "hostedContext": {
			const total = round2(num(input.total));
			const itemCount = Math.trunc(num(input.itemCount));
			return {
				kind: "hostedContext",
				tone: "neutral",
				value: total,
				labelKey: "Sale in progress · {0} items",
				labelParams: [itemCount],
				primaryAction: { id: "sale.return", labelKey: "BACK TO SALE" },
				// Always pressable: the sale view is always there to return to,
				// empty cart included — the way out must never be greyed.
				primaryEnabled: true,
			};
		}
	}
}

export default resolveBandState;
