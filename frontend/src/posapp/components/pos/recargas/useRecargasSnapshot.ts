/**
 * The seam that feeds the Recargas destination (build plan §12 item F).
 *
 * ## This file may only READ
 *
 * A recharge is bought from TAECEL in real time and TAECEL's spec is blunt
 * about it: *toda solicitud que llega a `requestTXN` genera cargo*. There is no
 * test mode and no rollback at the carrier, so a stray call from a view that
 * was only supposed to draw the screen spends the owner's money and credits a
 * stranger's phone.
 *
 * So this module cannot reach a sale even by accident. `RECARGAS_READS` is the
 * complete set of methods it is allowed to name, every one of them a read, and
 * `readOnlyCall` refuses anything else BEFORE the request leaves — not as
 * documentation, as a throw. The selling path is untouched: a recharge is still
 * armed by the band and sent by the existing saldo capture flow through
 * `Pos.vue`'s `SALDO-INTEGRATION-POINT`, exactly as it was before this screen
 * existed.
 *
 * ## Why a seam at all
 *
 * The saldo Vue components live in the saldo Frappe app, not here, and this
 * destination is posawesome's CHROME around saldo's domain. It therefore reads
 * saldo's published RPC contract — the same three methods the existing picker
 * and holds badge already call — and imports none of its internals. Everything
 * is injectable, so a spec proves which method was dispatched without a server,
 * the shape `useOfflineQueue.ts` established for the offline surface.
 */

import { ref, shallowRef } from "vue";

type AnyRecord = Record<string, any>;

/**
 * Every method this destination is allowed to call. All three are reads:
 * a cached pouch balance, a SELECT over the recharge ledger, and the enabled
 * catalogue. None of them submits, retries, refunds or reaches `requestTXN`.
 */
export const RECARGAS_READS = Object.freeze({
	balance: "saldo.api.status.get_pos_available_balance",
	ledger: "saldo.api.status.list_transactions",
	catalog: "saldo.api.catalog_admin.catalog_tree",
} as const);

export const RECARGAS_READ_METHODS: readonly string[] = Object.freeze(Object.values(RECARGAS_READS));

export const isRecargasReadMethod = (method: unknown): boolean =>
	RECARGAS_READ_METHODS.includes(String(method ?? ""));

export type FrappeCall = (options: { method: string; args?: AnyRecord }) => Promise<AnyRecord>;

/** How many of today's rows to pull. Well under the server's own 500 cap, and
 * high enough that a busy counter's day is complete — `buildTodayLedger` marks
 * the counters absent rather than wrong if it ever is not. */
export const LEDGER_PAGE = 200;

/**
 * Wrap a caller so it can only dispatch a read.
 *
 * The guard is here rather than in each call site because a call site is where
 * someone adds "just one more method" in a hurry. Refusing by throwing (and not
 * by returning empty) makes the mistake loud in a spec instead of silent on a
 * counter.
 */
export function readOnlyCall(call: FrappeCall): FrappeCall {
	return (options) => {
		if (!isRecargasReadMethod(options?.method)) {
			return Promise.reject(
				new Error(
					`Recargas may only read. Refused: ${String(options?.method)}. ` +
						"Anything that reaches TAECEL is charged on request and cannot be undone.",
				),
			);
		}
		return call(options);
	};
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

export interface UseRecargasSnapshotOptions {
	/** Injected for specs; defaults to the app's own `frappe.call`. */
	call?: FrappeCall;
	/** Scopes the ledger to this register's shop — the rows carry phone numbers. */
	posProfile?: () => string | null | undefined;
	/** `YYYY-MM-DD`; defaults to Frappe's own idea of today. */
	today?: () => string;
	limit?: number;
}

function serverToday(): string {
	const frappe = (globalThis as AnyRecord)?.frappe;
	const nowdate = frappe?.datetime?.nowdate;
	if (typeof nowdate === "function") {
		return String(nowdate());
	}
	// Local midnight, not `toISOString()` — that converts to UTC and hands back
	// yesterday for every Mexican evening after 18:00.
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Fetch the three payloads, independently.
 *
 * Independently because they fail for different reasons and a screen that
 * blanks entirely when one of them is down is worse than a screen missing one
 * card: the pouch balance can be switched off by a manager while the catalogue
 * is perfectly healthy, and the ledger is a plain SELECT that will answer when
 * TAECEL will not.
 */
export function useRecargasSnapshot(options: UseRecargasSnapshotOptions = {}) {
	const call = readOnlyCall(options.call ?? defaultCall());
	const limit = options.limit ?? LEDGER_PAGE;

	const bolsa = shallowRef<AnyRecord | null>(null);
	const rows = shallowRef<AnyRecord[]>([]);
	const catalog = shallowRef<AnyRecord | null>(null);
	const loading = ref(false);
	const today = ref(options.today?.() ?? serverToday());

	async function read(method: string, args?: AnyRecord): Promise<AnyRecord | null> {
		try {
			const response = await call({ method, args });
			return (response?.message ?? null) as AnyRecord | null;
		} catch (error) {
			// A source we cannot read is not a source that says zero. Leaving the
			// ref alone keeps the last good card on screen and, on a first load,
			// keeps the figure ABSENT rather than showing a confident nought.
			console.error(`Recargas could not read ${method}`, error);
			return null;
		}
	}

	async function refresh(): Promise<void> {
		loading.value = true;
		today.value = options.today?.() ?? serverToday();
		const profile = options.posProfile?.() ?? null;
		try {
			const [balancePayload, ledgerPayload, catalogPayload] = await Promise.all([
				read(RECARGAS_READS.balance, { pos_profile: profile }),
				read(RECARGAS_READS.ledger, {
					pos_profile: profile,
					from_date: today.value,
					limit,
				}),
				read(RECARGAS_READS.catalog),
			]);
			if (balancePayload) {
				bolsa.value = balancePayload;
			}
			if (ledgerPayload && Array.isArray(ledgerPayload.rows)) {
				rows.value = ledgerPayload.rows as AnyRecord[];
			}
			if (catalogPayload) {
				catalog.value = catalogPayload;
			}
		} finally {
			loading.value = false;
		}
	}

	return { bolsa, rows, catalog, today, loading, limit, refresh };
}

export default useRecargasSnapshot;
