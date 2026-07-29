/**
 * Patient wait for a background-submitted invoice — the deferred-print
 * follow-up after the 8 s fast path gives up.
 *
 * Why it exists: with `posa_allow_submissions_in_background_job` ON the
 * submit job can sit in a congested RQ queue far longer than the fast
 * path's ceiling (prod docomexico 2026-07-29: 45–230 s submit lag on 5 of
 * 7 sales). The old flow threw at ~9 s and the ticket silently never
 * printed — the operator's only recourse was «print last invoice» minutes
 * later. This helper keeps BOTH channels open until the invoice actually
 * lands: the doc-room lifecycle event (fires the moment the job finishes)
 * raced against a slow DB docstatus poll, bounded by a hard ceiling.
 *
 * Dependency-injected so the logic is unit-testable without a socket or a
 * server; `Payments.vue` wires the real socketStore + frappe.call.
 */

export interface PatientWaitDeps {
	/** socketStore.waitForInvoiceProcessed — resolves when the lifecycle
	 * event lands, rejects when the server reports a failed submit. */
	waitForProcessed: (invoice: string, timeoutMs: number) => Promise<any>;
	/** DB truth: docstatus of the invoice, or null when unreadable
	 * (transient errors must be swallowed by the impl, not thrown). */
	getDocstatus: (doctype: string, invoice: string) => Promise<number | null>;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Hard ceiling. Default 300 s — the RQ job timeout / saldo
	 * poll_ceiling_seconds; past it the job is dead, not slow. */
	ceilingMs?: number;
	pollMs?: number;
}

const DEFAULT_CEILING_MS = 300_000;
const DEFAULT_POLL_MS = 10_000;

export async function waitForLateSubmission(
	invoice: string,
	doctype: string,
	deps: PatientWaitDeps,
): Promise<{ doctype: string }> {
	const {
		waitForProcessed,
		getDocstatus,
		sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
		now = () => Date.now(),
		ceilingMs = DEFAULT_CEILING_MS,
		pollMs = DEFAULT_POLL_MS,
	} = deps;

	const deadline = now() + ceilingMs;
	let socketState: any = null;
	let socketError: Error | null = null;
	// Fire-and-observe: the event may land while we sleep between polls.
	void waitForProcessed(invoice, ceilingMs)
		.then((state) => {
			socketState = state || {};
		})
		.catch((error) => {
			// A rejection is the server saying the submit FAILED — that is a
			// real answer, not a timeout; surface it instead of polling on.
			socketError =
				error instanceof Error ? error : new Error(String(error ?? ""));
		});

	// Never print on the socket's word alone: socketStore RESOLVES
	// OPTIMISTICALLY with a fabricated {status:"processed"} whenever the
	// socket is disconnected — printing then would hand the customer a
	// receipt for a still-draft sale. The DB is the truth; the event only
	// tells us when to look and which doctype won.
	const confirmSubmitted = async (): Promise<{ doctype: string } | null> => {
		const observed = socketState;
		const eventDoctype = observed?.doctype || doctype;
		const docstatus = await getDocstatus(eventDoctype, invoice);
		if (docstatus === 1) {
			return { doctype: eventDoctype };
		}
		if (docstatus === 2) {
			throw new Error(`Invoice ${invoice} was cancelled before it could print`);
		}
		// A "processed" the DB contradicts is the fabricated kind — discard
		// it and keep polling. Only discard what THIS check actually tested:
		// a real event landing during the await above must survive to drive
		// the next confirm. null (unreadable) / 0 (job queued) → wait on.
		if (socketState === observed) {
			socketState = null;
		}
		return null;
	};

	// One immediate look before the first sleep: the fast path already burned
	// its 8 s, and a submit that landed in the gap should print NOW, not one
	// poll interval later (backtrace N6 — this alone cuts the typical slow
	// path from ~18 s to ~8 s).
	if (socketError) throw socketError;
	{
		const confirmed = await confirmSubmitted();
		if (confirmed) return confirmed;
	}

	while (now() < deadline) {
		if (socketError) throw socketError;
		if (socketState) {
			const confirmed = await confirmSubmitted();
			if (confirmed) return confirmed;
		}
		await sleep(pollMs);
		if (socketError) throw socketError;
		const confirmed = await confirmSubmitted();
		if (confirmed) return confirmed;
	}
	throw new Error(
		`Invoice ${invoice} did not finish submitting within ${Math.round(ceilingMs / 1000)}s`,
	);
}
