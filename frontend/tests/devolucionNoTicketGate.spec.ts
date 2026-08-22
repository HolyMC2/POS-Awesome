import { describe, expect, it } from "vitest";

import {
	buildNoTicketRecord,
	eligibleAuthorisers,
	evaluateNoTicketReturn,
	type NoTicketRequest,
} from "../src/posapp/components/pos/flows/returns/noTicketGate";

/**
 * The gate with money behind it.
 *
 * Every other route on Devolución starts from a submitted invoice; this one
 * starts from nothing, and a cashier with drawer access can hand back cash for
 * goods that were never sold here. These assertions are therefore written to
 * be MUTATION-SENSITIVE: each requirement is tested alone, with every other
 * requirement satisfied, so flipping one condition in the gate cannot be
 * covered up by another failing at the same time.
 */

const ROSA = { user: "rosa@doco.mx", full_name: "Rosa Elena Pech", is_supervisor: true };
const JENNI = { user: "jenni@doco.mx", full_name: "Jenni Robledo", is_supervisor: false };
const DIEGO = { user: "diego@doco.mx", full_name: "Diego Arriaga", is_supervisor: true };

/** Everything in order — each test below breaks exactly one thing. */
const ok = (patch: Partial<NoTicketRequest> = {}): NoTicketRequest => ({
	allowedByProfile: true,
	authorisers: [JENNI, ROSA, DIEGO],
	authoriserUser: ROSA.user,
	signatureTaken: true,
	reason: "No traía el ticket",
	...patch,
});

describe("a no-ticket return needs every one of its conditions", () => {
	it("passes when the profile allows it, a supervisor authorises, and paper backs it", () => {
		const decision = evaluateNoTicketReturn(ok());
		expect(decision.allowed).toBe(true);
		expect(decision.blockers).toEqual([]);
		expect(decision.authoriser?.user).toBe(ROSA.user);
	});

	it("refuses when the register's profile does not allow it at all", () => {
		const decision = evaluateNoTicketReturn(ok({ allowedByProfile: false }));
		expect(decision.allowed).toBe(false);
		expect(decision.blockers).toContain("profile_does_not_allow");
	});

	it("refuses with nobody named", () => {
		expect(evaluateNoTicketReturn(ok({ authoriserUser: null })).blockers).toContain(
			"no_authoriser_named",
		);
		// Whitespace is not a name.
		expect(evaluateNoTicketReturn(ok({ authoriserUser: "   " })).blockers).toContain(
			"no_authoriser_named",
		);
	});

	it("refuses a name the terminal does not know", () => {
		// A stale pick after an employee-list refresh, or a value written
		// straight into state — an authorisation with no person behind it.
		const decision = evaluateNoTicketReturn(ok({ authoriserUser: "ghost@doco.mx" }));
		expect(decision.allowed).toBe(false);
		expect(decision.blockers).toContain("authoriser_unknown");
	});

	it("refuses a cashier who is not a supervisor", () => {
		const decision = evaluateNoTicketReturn(ok({ authoriserUser: JENNI.user }));
		expect(decision.allowed).toBe(false);
		expect(decision.blockers).toContain("authoriser_not_a_supervisor");
	});

	it("refuses without the signature", () => {
		expect(evaluateNoTicketReturn(ok({ signatureTaken: false })).blockers).toContain(
			"signature_not_taken",
		);
	});

	it("refuses without a reason, and whitespace is not one", () => {
		expect(evaluateNoTicketReturn(ok({ reason: null })).blockers).toContain("reason_missing");
		expect(evaluateNoTicketReturn(ok({ reason: "  \t " })).blockers).toContain("reason_missing");
	});

	it("takes only a real boolean for the supervisor flag", () => {
		// `employeeStore.setTerminalEmployees` coerces this with `Boolean()`, so
		// a real terminal list can only carry true/false. The gate stays strict
		// anyway, and strict in the safe direction: a payload that reached the
		// view without passing through the store must not be able to authorise
		// on a truthy string. `eligibleAuthorisers` filters the same way, so
		// such a person is never offered in the picker either — the two agree.
		const rawOne = { user: "raw@doco.mx", full_name: "Raw", is_supervisor: 1 as unknown as boolean };
		const decision = evaluateNoTicketReturn(
			ok({ authorisers: [rawOne], authoriserUser: rawOne.user }),
		);
		expect(decision.allowed).toBe(false);
		expect(decision.blockers).toContain("authoriser_not_a_supervisor");
		expect(eligibleAuthorisers([rawOne])).toEqual([]);
	});

	it("takes only a real boolean for the two attestations", () => {
		// Guarding against the truthy-string shape a v-model or a persisted
		// value can arrive in: "false", "0" and 1 are not a signature.
		const truthyNotTrue = evaluateNoTicketReturn(
			ok({ signatureTaken: "yes" as unknown as boolean }),
		);
		expect(truthyNotTrue.allowed).toBe(false);
		expect(
			evaluateNoTicketReturn(ok({ allowedByProfile: 1 as unknown as boolean })).allowed,
		).toBe(false);
	});
});

describe("the refusal tells the cashier everything at once", () => {
	it("lists every missing thing rather than the first one", () => {
		// A cashier told "name a supervisor", who fetches one and is only then
		// told "and take a signature", has crossed the shop twice.
		const decision = evaluateNoTicketReturn({
			allowedByProfile: true,
			authorisers: [JENNI],
			authoriserUser: null,
			signatureTaken: false,
			reason: "",
		});
		expect(decision.blockers).toEqual([
			"no_authoriser_named",
			"signature_not_taken",
			"reason_missing",
		]);
	});

	it("never names a half-checked authoriser", () => {
		// The record prints this name. A return blocked for a missing signature
		// must not leave one lying around for the record to pick up.
		const decision = evaluateNoTicketReturn(ok({ signatureTaken: false }));
		expect(decision.authoriser).toBeNull();
	});

	it("ties the named authoriser to the verdict across every combination", () => {
		// `buildNoTicketRecord` guards on BOTH `allowed` and `authoriser`, and a
		// mutation test showed the second check alone is currently enough —
		// which is only true while this coupling holds. Pinning it here is what
		// makes that redundancy safe rather than accidental: break the coupling
		// and this fails before the record can quietly follow the wrong half.
		const combos = [true, false];
		for (const allowedByProfile of combos) {
			for (const signatureTaken of combos) {
				for (const reason of ["Se equivocó", ""]) {
					for (const authoriserUser of [ROSA.user, JENNI.user, null]) {
						const decision = evaluateNoTicketReturn(
							ok({ allowedByProfile, signatureTaken, reason, authoriserUser }),
						);
						expect(
							Boolean(decision.authoriser),
							JSON.stringify({ allowedByProfile, signatureTaken, reason, authoriserUser }),
						).toBe(decision.allowed);
					}
				}
			}
		}
	});
});

describe("who may appear in the authoriser picker", () => {
	it("offers supervisors only", () => {
		expect(eligibleAuthorisers([JENNI, ROSA, DIEGO]).map((c) => c.user)).toEqual([
			ROSA.user,
			DIEGO.user,
		]);
	});

	it("survives a malformed employee list", () => {
		expect(eligibleAuthorisers(null)).toEqual([]);
		expect(
			eligibleAuthorisers([{ user: "", full_name: "x", is_supervisor: true }]),
		).toEqual([]);
	});

	it("lets a lone supervisor-cashier authorise their own exception", () => {
		// Four eyes reads well and would close a one-person counter. The record
		// names both roles and the exception inbox is where it becomes visible;
		// that is the control §5.4 actually asks for.
		const decision = evaluateNoTicketReturn(ok({ authorisers: [ROSA], authoriserUser: ROSA.user }));
		expect(decision.allowed).toBe(true);
	});
});

describe("what gets written down", () => {
	it("records who allowed it and why", () => {
		expect(buildNoTicketRecord(ok())).toEqual({
			authorisedBy: ROSA.user,
			authorisedByName: ROSA.full_name,
			reason: "No traía el ticket",
			signatureTaken: true,
		});
	});

	it("trims the reason rather than storing the operator's whitespace", () => {
		expect(buildNoTicketRecord(ok({ reason: "  se equivocó  " }))?.reason).toBe("se equivocó");
	});

	it("produces NO record at all when the gate refused", () => {
		// The one that matters: an incomplete record is worse than none,
		// because it looks like an authorisation happened.
		expect(buildNoTicketRecord(ok({ signatureTaken: false }))).toBeNull();
		expect(buildNoTicketRecord(ok({ authoriserUser: JENNI.user }))).toBeNull();
		expect(buildNoTicketRecord(ok({ allowedByProfile: false }))).toBeNull();
		expect(buildNoTicketRecord(ok({ reason: "" }))).toBeNull();
	});
});
