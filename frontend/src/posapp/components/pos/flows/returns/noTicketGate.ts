/**
 * The supervised no-ticket return — the one path on this screen with money
 * behind it (roadmap §5.4, `Devolucion.dc.html`).
 *
 * Every other route on the Devolución screen starts from a submitted invoice:
 * the price, the tax and the tender all come off a document the register
 * already posted, and the worst a mistake can do is reverse the wrong sale.
 * This route starts from nothing. A cashier with drawer access can hand back
 * cash for goods with no record that they were ever sold here, which is why
 * §5.4 names it "supervised no-receipt path" rather than "return without
 * invoice", and why the artboard writes *pide firma* beside it in amber while
 * the other four ways are plain.
 *
 * So the decision is a PURE FUNCTION with an explicit blocker list, not a
 * scatter of `v-if`s on a button. Three reasons:
 *
 *   - a gate assembled out of template conditions can only be tested by
 *     mounting, and a gate that is expensive to test stops being tested;
 *   - the operator needs to be told what is still missing, which means the
 *     failures have to be VALUES, not an absence of true;
 *   - and the same decision has to be re-checked at the moment of sending,
 *     not only at the moment of drawing, so it must be callable twice.
 *
 * What it deliberately does NOT do: require the authoriser to be someone
 * other than the cashier. Four eyes reads well and would close a one-person
 * shop's counter — docomexico's own registers are frequently staffed by one
 * supervisor. The record names both roles separately, and the exception
 * inbox is where a self-authorised return becomes visible; that is the
 * control §5.4 actually asks for.
 */

/** Just enough of `stores/employeeStore.TerminalEmployee` to decide. */
export interface ReturnAuthoriser {
	user: string;
	full_name: string;
	is_supervisor?: boolean;
}

/**
 * Why this return cannot proceed yet. Ordered by how a cashier meets them:
 * the register's own configuration first, then the person, then the paper.
 */
export type NoTicketBlocker =
	| "profile_does_not_allow"
	| "no_authoriser_named"
	| "authoriser_unknown"
	| "authoriser_not_a_supervisor"
	| "signature_not_taken"
	| "reason_missing";

export interface NoTicketRequest {
	/** `POS Profile.posa_allow_return_without_invoice`. */
	allowedByProfile: boolean;
	/** The terminal's employee list — the only names that may authorise. */
	authorisers: readonly ReturnAuthoriser[];
	/** The user id the operator picked, or null while nobody is picked. */
	authoriserUser: string | null;
	/**
	 * The cashier confirmed the customer signed the printed nota. There is no
	 * signature capture anywhere in this app, so this is an ATTESTATION about
	 * paper, and the wording on screen has to say so — a checkbox that implies
	 * a captured signature would be the register lying about its own evidence.
	 */
	signatureTaken: boolean;
	/** Free text or a chip id; whitespace is not a reason. */
	reason: string | null;
}

export interface NoTicketDecision {
	allowed: boolean;
	blockers: readonly NoTicketBlocker[];
	/** Resolved only when the named authoriser is a supervisor on this terminal. */
	authoriser: ReturnAuthoriser | null;
}

const BLOCKER_ORDER: readonly NoTicketBlocker[] = [
	"profile_does_not_allow",
	"no_authoriser_named",
	"authoriser_unknown",
	"authoriser_not_a_supervisor",
	"signature_not_taken",
	"reason_missing",
];

/** English source strings; the view wraps them in `__()`. */
export const NO_TICKET_BLOCKER_MESSAGES: Readonly<Record<NoTicketBlocker, string>> = {
	profile_does_not_allow: "This register does not accept returns without a ticket.",
	no_authoriser_named: "Name the supervisor who authorises this return.",
	authoriser_unknown: "That supervisor is not signed in to this terminal.",
	authoriser_not_a_supervisor: "Only a supervisor can authorise a return without a ticket.",
	signature_not_taken: "Confirm the customer signed the return note.",
	reason_missing: "Say why the goods are coming back.",
};

/** Supervisors on this terminal, in list order — the picker's whole universe. */
export const eligibleAuthorisers = (
	authorisers: readonly ReturnAuthoriser[] | null | undefined,
): ReturnAuthoriser[] =>
	(authorisers ?? []).filter(
		(candidate) => Boolean(candidate?.user) && candidate.is_supervisor === true,
	);

/**
 * Can this no-ticket return proceed, and if not, what is still missing?
 *
 * Every blocker is collected rather than short-circuiting on the first one:
 * a cashier told "name a supervisor", who then fetches one, and is only then
 * told "and take a signature", has been sent across the shop twice.
 */
export const evaluateNoTicketReturn = (request: NoTicketRequest): NoTicketDecision => {
	const blockers = new Set<NoTicketBlocker>();

	if (request.allowedByProfile !== true) {
		blockers.add("profile_does_not_allow");
	}

	const named = typeof request.authoriserUser === "string" ? request.authoriserUser.trim() : "";
	const match = named
		? (request.authorisers ?? []).find((candidate) => candidate?.user === named) ?? null
		: null;

	if (!named) {
		blockers.add("no_authoriser_named");
	} else if (!match) {
		// Named somebody the terminal does not know: a stale pick after an
		// employee list refresh, or a value typed straight into state. Either
		// way the authorisation has no person behind it.
		blockers.add("authoriser_unknown");
	} else if (match.is_supervisor !== true) {
		blockers.add("authoriser_not_a_supervisor");
	}

	if (request.signatureTaken !== true) {
		blockers.add("signature_not_taken");
	}

	if (!String(request.reason ?? "").trim()) {
		blockers.add("reason_missing");
	}

	const ordered = BLOCKER_ORDER.filter((blocker) => blockers.has(blocker));

	return {
		allowed: ordered.length === 0,
		blockers: ordered,
		// Never hand back a half-checked person. `authoriser` is what the audit
		// line prints, so it resolves only when every check about that person
		// passed — a return blocked for a missing signature must not leave a
		// named authoriser lying around for the record to pick up.
		authoriser: ordered.length === 0 ? match : null,
	};
};

/**
 * What the register writes down about a no-ticket return.
 *
 * Built here rather than in the view so the record cannot drift from the
 * decision that allowed it — `evaluateNoTicketReturn` is called again, not
 * trusted from a previous render, and a blocked request produces no record
 * at all rather than an incomplete one.
 */
export interface NoTicketRecord {
	authorisedBy: string;
	authorisedByName: string;
	reason: string;
	signatureTaken: true;
}

export const buildNoTicketRecord = (request: NoTicketRequest): NoTicketRecord | null => {
	const decision = evaluateNoTicketReturn(request);
	if (!decision.allowed || !decision.authoriser) {
		return null;
	}
	return {
		authorisedBy: decision.authoriser.user,
		authorisedByName: decision.authoriser.full_name || decision.authoriser.user,
		reason: String(request.reason ?? "").trim(),
		signatureTaken: true,
	};
};
