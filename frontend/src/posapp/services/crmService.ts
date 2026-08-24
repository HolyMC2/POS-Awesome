import api from "./api";

/**
 * The CRM seam, from the SPA's side — and the capability probe in front of it.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: never poll an endpoint that is going
 * to refuse. `crm_context` answers `{"installed": false}` rather than raising
 * when the tenant has no CRM, and the FIRST such answer disables every later
 * call for the session. A strip that asks once per customer on a register with
 * no CRM would be a guaranteed round trip on every ticket, forever — the same
 * shape as the floors/tables 403 loop.
 *
 * A thrown error is NOT treated as absence. A dead network and a
 * customer-scope refusal are both temporary and both throw, and marking the
 * whole app missing because of one would hide a strip that works. They are
 * counted instead: three consecutive failures and the session gives up, which
 * bounds the damage without confusing "unreachable" with "not installed".
 */

const CONTEXT_METHOD = "posawesome.posawesome.api.crm_bridge.crm_context";
const SEGUIMIENTO_METHOD = "posawesome.posawesome.api.crm_bridge.create_seguimiento";

/** Consecutive throws after which the session stops asking. */
const FAILURE_BUDGET = 3;

export interface CrmDeal {
	name: string;
	status?: string | null;
	amount?: number | null;
	currency?: string | null;
	owner?: string | null;
	modified?: string | null;
}

export interface CrmLead {
	name: string;
	status?: string | null;
	label?: string | null;
	modified?: string | null;
}

export interface CrmContext {
	installed: boolean;
	customer?: string;
	deals?: CrmDeal[];
	lead?: CrmLead | null;
}

export interface SeguimientoResult {
	action: "created" | "updated" | "noted";
	doctype: string;
	/** `CRM Task` names are integers on this fork; a deal's is a string. */
	name: string | number;
	deal?: string;
}

/** `null` = not asked yet, `false` = the server said the app is absent. */
let installed: boolean | null = null;
let failures = 0;

/** True once the register knows there is no CRM to ask about. */
export const crmIsUnavailable = (): boolean => installed === false || failures >= FAILURE_BUDGET;

/**
 * The back office's view of this customer, or `null` when there is nothing to
 * show — no CRM, no answer, or a refusal. `null` means HIDE THE STRIP; it is
 * never an error the cashier has to read, because a context strip failing is
 * not something they can do anything about mid-sale.
 */
export async function fetchCrmContext(
	customer: string,
	posProfile: string,
): Promise<CrmContext | null> {
	if (crmIsUnavailable() || !customer || !posProfile) return null;
	try {
		const answer = await api.call<CrmContext>(CONTEXT_METHOD, {
			customer,
			pos_profile: posProfile,
		});
		failures = 0;
		installed = Boolean(answer?.installed);
		return installed ? answer : null;
	} catch {
		failures += 1;
		return null;
	}
}

/**
 * Ask the back office to follow up. POST only, and the one act on this strip
 * that writes — which is why it is a button somebody presses rather than
 * something the strip does on open.
 */
export function createSeguimiento(
	customer: string,
	posProfile: string,
	payload: { note?: string; reference_doctype?: string; reference_name?: string } = {},
) {
	return api.call<SeguimientoResult>(SEGUIMIENTO_METHOD, {
		customer,
		pos_profile: posProfile,
		...payload,
	});
}

/** Forget what the session learned. Exported for tests and profile switches. */
export function resetCrmAvailability() {
	installed = null;
	failures = 0;
}
