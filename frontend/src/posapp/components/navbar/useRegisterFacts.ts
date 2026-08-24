/**
 * The two facts the status line was drawn with and shipped without.
 *
 * `registerStatusLine.ts` has always had somewhere to put «31 tickets hoy» and
 * «Saldo $1,240» — `Main.dc.html` nodes 17 and 19 — and `NavbarAppBar` passed
 * `null` for both with a note saying there was no source. There is one for
 * each; this module is it.
 *
 * ## Both reads, and why each is allowed to be here
 *
 * **Tickets.** `frappe.client.get_count` over Sales Invoice, filtered to this
 * register's open shift AND to today's posting date. It is a COUNT, it routes
 * through `frappe.desk.reportview.get_count`, and it therefore applies the
 * caller's own read and user permissions — a cashier counts what a cashier can
 * already list. Both filters, not one: a shift is normally a day, but a tenant
 * with `posa_force_close_stale_shift` off can carry one across midnight, and a
 * chip that says «hoy» has to mean it.
 *
 * **Saldo.** `saldo.api.status.get_pos_available_balance`, the same read the
 * Recargas destination's pouch card makes, reached through the SAME frozen
 * method constant so there is one name for it in this tree. Gated twice
 * over: `recargasEnabled()` first, so a register that does not sell airtime
 * never asks, and then the server's own `visible` flag
 * (`Saldo Settings.show_available_balance_in_pos`, default OFF), so a manager
 * who hid the pouch keeps it hidden here too. A hidden balance is a SETTING,
 * not a fault, and neither one renders a chip.
 *
 * ## Failure is silence, never a zero
 *
 * Every read leaves its ref alone when it fails. `resolveRegisterStatusLine`
 * already treats `null` as "omit the chip" — «0 tickets hoy» is a claim about
 * the day's trade and «we could not ask» is not, and the register must not
 * make the first one while meaning the second.
 *
 * Injectable throughout so a spec proves which method was dispatched, with
 * which filters, without a server — the shape `useRecargasSnapshot.ts`
 * established.
 */

import { onBeforeUnmount, ref, shallowRef } from "vue";
import { RECARGAS_READS } from "../pos/recargas/useRecargasSnapshot";
import { resolveBolsa, type BolsaPayload } from "../pos/recargas/recargasModel";
import { recargasEnabled } from "../pos/recargas/recargasGate";

type AnyRecord = Record<string, any>;

export type FrappeCall = (options: { method: string; args?: AnyRecord }) => Promise<AnyRecord>;

/** Frappe's own permission-checked count. Named once. */
export const TICKET_COUNT_METHOD = "frappe.client.get_count";

/** How stale the day's count is allowed to get. */
export const FACTS_REFRESH_MS = 60_000;

export interface RegisterFactsOptions {
	/** Injected for specs; defaults to the app's own `frappe.call`. */
	call?: FrappeCall;
	/** `POS Opening Shift.name`, or null before the shift opens. */
	openingShift?: () => string | null | undefined;
	/** The active POS Profile document. */
	posProfile?: () => AnyRecord | null | undefined;
	/** `verticalStore.has` — capabilities, never a vertical NAME. */
	hasCapability?: (capability: string) => boolean;
	/** `YYYY-MM-DD`; defaults to Frappe's own idea of today. */
	today?: () => string;
	/** Formats the pouch figure the way the rest of the register formats money. */
	formatMoney?: (value: number) => string;
	/** The pouch chip's word, already translated by the caller. */
	saldoWord?: () => string;
	/** The doctype the register posts sales into. */
	doctype?: string;
}

function defaultCall(): FrappeCall {
	return (options) => {
		const frappe = (globalThis as AnyRecord)?.frappe;
		if (!frappe?.call) {
			return Promise.reject(new Error("frappe.call unavailable"));
		}
		return frappe.call(options) as Promise<AnyRecord>;
	};
}

/**
 * Local midnight, never `toISOString()`. That converts to UTC and hands back
 * yesterday for every Mexican evening after 18:00 — which on this chip would
 * mean a counter watching the day's count reset while it was still trading.
 */
export function serverToday(): string {
	const frappe = (globalThis as AnyRecord)?.frappe;
	const nowdate = frappe?.datetime?.nowdate;
	if (typeof nowdate === "function") {
		return String(nowdate());
	}
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The filters behind «N tickets hoy», exported so a spec can assert the scope
 * rather than re-typing it. Submitted only: a draft is not a ticket, and a
 * cancelled one stopped being one.
 */
export function ticketCountFilters(shift: string, today: string): AnyRecord {
	return {
		docstatus: 1,
		posa_pos_opening_shift: shift,
		posting_date: today,
	};
}

/**
 * The pouch chip's text, or null when there is nothing honest to say.
 *
 * The word is passed in rather than written here. This module holds no `__()`
 * — same contract as `registerStatusLine.ts` — and the chip renders as a
 * literal because it carries money, so the translation has to happen at the
 * component that builds it. `Balance` already resolves to «Saldo», which is
 * the artboard's own word for this chip.
 */
export function bolsaChipLabel(
	payload: BolsaPayload | null | undefined,
	formatMoney: (value: number) => string,
	label = "Saldo",
): string | null {
	const figures = resolveBolsa(payload, 0);
	if (!figures.visible || figures.available === null) {
		return null;
	}
	return `${label} ${formatMoney(figures.available)}`;
}

export function useRegisterFacts(options: RegisterFactsOptions = {}) {
	const call = options.call ?? defaultCall();
	const doctype = options.doctype || "Sales Invoice";
	const formatMoney = options.formatMoney ?? ((value: number) => String(value));

	/** null means NOT KNOWN, which omits the chip. Never coerce it to 0. */
	const ticketsToday = ref<number | null>(null);
	const saldoLabel = ref<string | null>(null);
	const bolsa = shallowRef<BolsaPayload | null>(null);

	async function readTickets(): Promise<void> {
		const shift = String(options.openingShift?.() ?? "").trim();
		if (!shift) {
			// No shift, no register-day to count. Not a failure — the opening
			// screen has nothing to report yet.
			ticketsToday.value = null;
			return;
		}
		try {
			const response = await call({
				method: TICKET_COUNT_METHOD,
				args: {
					doctype,
					filters: ticketCountFilters(shift, options.today?.() ?? serverToday()),
				},
			});
			const count = Number(response?.message);
			if (Number.isFinite(count) && count >= 0) {
				ticketsToday.value = count;
			}
		} catch (error) {
			// Leave the last good count standing; a register that lost the
			// server for ten seconds did not stop having sold anything.
			console.error("Register status: could not count today's tickets", error);
		}
	}

	async function readSaldo(): Promise<void> {
		const posProfile = options.posProfile?.() ?? null;
		if (!recargasEnabled({ posProfile, hasCapability: options.hasCapability })) {
			// This register does not sell airtime. Nothing to show, and nothing
			// to ask the server about either.
			bolsa.value = null;
			saldoLabel.value = null;
			return;
		}
		try {
			const response = await call({
				method: RECARGAS_READS.balance,
				args: { pos_profile: posProfile?.name ?? null },
			});
			const payload = (response?.message ?? null) as BolsaPayload | null;
			if (payload) {
				bolsa.value = payload;
				saldoLabel.value = bolsaChipLabel(
					payload,
					formatMoney,
					options.saldoWord?.() || "Saldo",
				);
			}
		} catch (error) {
			console.error("Register status: could not read the saldo pouch", error);
		}
	}

	async function refresh(): Promise<void> {
		await Promise.all([readTickets(), readSaldo()]);
	}

	let timer: ReturnType<typeof setInterval> | null = null;

	function start(intervalMs: number = FACTS_REFRESH_MS): void {
		void refresh();
		if (timer !== null) {
			return;
		}
		// An interval rather than a hook on the submit path, deliberately. The
		// count is ambient — nobody makes a decision on it the way they do on
		// the connection chip — and hanging a read off a money path this module
		// does not own is a coupling that outlives whatever it was worth.
		timer = setInterval(() => {
			void refresh();
		}, intervalMs);
	}

	function stop(): void {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	try {
		onBeforeUnmount(stop);
	} catch {
		// Called outside a component (a spec); the caller owns `stop` then.
	}

	return { ticketsToday, saldoLabel, bolsa, refresh, start, stop };
}

export default useRegisterFacts;
