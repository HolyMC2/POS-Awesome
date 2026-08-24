import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	getDestination,
	SHEET_COMPONENTS,
} from "../src/posapp/composables/pos/shell/destinationRegistry";
import { getRailDestination } from "../src/posapp/composables/pos/shell/railDestinations";

/**
 * Cobranza's wiring — the parts no mounted component can prove
 * (COBRANZA_GOLDEN_FLOW §2, acceptance 2 and 3).
 *
 * Two of the three guarantees here live in PLAIN JS files that vue-tsc does not
 * check: `Pos.vue`'s `<script>` and the shell's count wiring. The rail round
 * (2026-08-22) already recorded what that costs — a gate the shell forgets to
 * answer reads `undefined`, the destination silently vanishes from every
 * register, and nothing fails. The same hole exists one step over for badges: a
 * `badgeSource` the shell has no count for reads `0` forever, and `resolveBadge`
 * renders nothing for `0`, so a rail that should be shouting «6 vencidas» is
 * indistinguishable from a register that owes nothing.
 *
 * So the answers are pinned by READING THE SOURCE. That is a weaker guarantee
 * than mounting — it proves the wire exists, not that the number is right — but
 * the alternative here is no guarantee at all.
 *
 * The third is the capture handoff: COBRAR must drive the SAME
 * `paymentRouteTarget` seam `PayView` already consumes, because that seam is
 * what makes the amount pre-fill without this panel computing one.
 */

/**
 * `api.call` is mocked because what is under test in the last block is the
 * CALLING — how many round trips one badge costs, and on what evidence the
 * cache lets go — not the transport.
 */
const call = vi.fn();

vi.mock("../src/posapp/services/api", () => ({
	default: { call: (...args: unknown[]) => call(...args) },
}));

const service = await import("../src/posapp/services/receivablesService");

const SRC = resolve(__dirname, "../src/posapp");
const read = (relative: string) => readFileSync(resolve(SRC, relative), "utf8");

const POS_SHELL = read("components/pos/shell/Pos.vue");
const PAY_VIEW = read("components/pos/shell/PayView.vue");
const PAY_SUBMISSION = read("composables/pos/payments/usePosPaySubmission.ts");
const SURFACE = read("components/pos/payments/cobranza/CobranzaSurface.vue");

describe("the rail badge, end to end", () => {
	it("is declared on the destination in BOTH registries, with one name", () => {
		// Two registries describe this destination — the rail's (what it draws)
		// and the router's (where it goes) — and `destinationRegistry` says in
		// its own header that two copies of a fact is the drift the evidence
		// lane cannot survive.
		expect(getRailDestination("payments")?.badgeSource).toBe("receivablesOverdueCount");
		expect(getDestination("payments")?.badgeSource).toBe("receivablesOverdueCount");
	});

	it("has a count under that exact key in the shell's rail context", () => {
		// `Pos.vue` is plain JS: a typo here is silent, and the badge simply
		// never appears. `shellIntegrationShell.spec.ts` pins the whole key set
		// by mounting; this pins the one that matters to Cobranza by name.
		const source = getRailDestination("payments")?.badgeSource;
		expect(source).toBeTruthy();
		const counts = POS_SHELL.slice(
			POS_SHELL.indexOf("counts: {"),
			POS_SHELL.indexOf("navigate: (id)"),
		);
		expect(counts).toContain(String(source));
	});

	it("is fetched through the session cache rather than per render", () => {
		expect(POS_SHELL).toContain("getReceivablesBadgeCached");
		// Forced past the cache when the register changes: a badge left over
		// from the previous profile is a debt on somebody else's books.
		expect(POS_SHELL).toContain("invalidateReceivablesBadge");
	});

	it("refreshes on `useRegisterFacts`' clock and stops when the shell unmounts", () => {
		expect(POS_SHELL).toContain("const RECEIVABLES_BADGE_MS = 60_000");
		expect(POS_SHELL).toContain("receivablesBadgeTimer = setInterval");
		// A timer that outlives its shell is the leak that turns a background
		// refresh into a request storm across a shift's worth of remounts.
		expect(POS_SHELL).toContain("clearInterval(receivablesBadgeTimer)");
	});

	it("re-reads after a capture instead of waiting out the interval", () => {
		expect(POS_SHELL).toContain('eventBus.on("payment_captured", onPaymentCaptured)');
		expect(POS_SHELL).toContain('eventBus.off("payment_captured", onPaymentCaptured)');
	});
});

describe("the destination is the panel, and the panel contains the tool", () => {
	it("keeps the id and the path, so every deep link still resolves", () => {
		// §3: "the destination id stays `payments`". `/payments` is what
		// Facturas' «Agregar pago» pushes and what the tools flyout opens.
		expect(getDestination("payments")?.path).toBe("/payments");
		expect(getDestination("payments")?.kind).toBe("sheet");
	});

	it("mounts Cobranza where it used to mount PayView", () => {
		expect(String(SHEET_COMPONENTS.payments)).toContain("cobranza/CobranzaSurface.vue");
	});

	it("hosts PayView rather than navigating to it", () => {
		// `DestinationHost` renders exactly one component per destination id, so
		// "navigate to capture" would mean either a rail entry for something
		// that is not a place, or leaving the shell — the dead end the `route`
		// kind was retired for.
		expect(SURFACE).toContain('import PayView from "../../shell/PayView.vue"');
		expect(SURFACE).toContain("<PayView");
	});

	it("stays online-required, because the worklist has no cache behind it", () => {
		expect(getDestination("payments")?.offline).toBe("online_required");
		expect(getRailDestination("payments")?.offlineAvailability).toBe("blocked");
	});
});

describe("the COBRAR handoff", () => {
	it("drives the seam PayView already consumes, and sends no amount", () => {
		// PayView's own auto-allocation fills the amount from the invoice it
		// selects — which is why this panel must not send one. And the target
		// alone carries the customer: the first wiring ALSO wrote
		// `customersStore.selectedCustomer`, a ref the live sale register owns,
		// and the register re-asserted its own customer over the pick — the
		// capture arrived un-filled («it doesn't autofill», 2026-08-24).
		expect(SURFACE).not.toContain("customersStore.setSelectedCustomer");
		expect(SURFACE).toContain("uiStore.setPaymentRouteTarget({");
		expect(SURFACE).not.toMatch(/setPaymentRouteTarget\([\s\S]{0,200}amount/);
		// The consuming half: PayView syncs the routed customer itself, and
		// its store-driven syncs stand down while a target is pending.
		expect(PAY_VIEW).toContain("void syncCustomerPaymentContext(target.customer)");
		expect(PAY_VIEW).toMatch(/paymentRouteTarget\.value\?\.invoiceName[\s\S]{0,40}\breturn;/);
	});

	it("hands over the same three fields PayView reads back", () => {
		const armed = SURFACE.slice(
			SURFACE.indexOf("uiStore.setPaymentRouteTarget({"),
			SURFACE.indexOf("captureTarget.value = {"),
		);
		for (const field of ["invoiceName", "customer", "currency"]) {
			expect(armed).toContain(field);
		}
		// The other half of the contract: PayView matches on `invoiceName` and
		// clears the target once it has consumed it.
		expect(PAY_VIEW).toContain("target.invoiceName");
		expect(PAY_VIEW).toContain("uiStore.clearPaymentRouteTarget()");
	});

	it("opens straight into capture when Facturas armed the target first", () => {
		// `/payments` used to land on PayView, which consumed the target on
		// mount. Now it lands on a worklist, and dropping the cashier there
		// would throw away the invoice they had already chosen.
		expect(SURFACE).toContain("const target = paymentRouteTarget.value");
		expect(SURFACE).toContain('step.value = "capture"');
	});

	it("records no money of its own — there is exactly one capture path", () => {
		// §3: no new money-write surface. `process_pos_payment` is the only
		// endpoint that may take a payment, and it is PayView's.
		expect(SURFACE).not.toContain("process_pos_payment");
		expect(SURFACE).not.toContain("Payment Entry");
	});
});

describe("«payment_captured» is a real success signal, not a hopeful one", () => {
	it("rides the callback the submission composable fires only on success", () => {
		// `usePosPaySubmission` calls its `get_outstanding_invoices` callback
		// from exactly one place — `finalizeSubmission()` — and that runs only
		// after the server accepted the capture or the offline queue took it.
		const calls = PAY_SUBMISSION.match(/get_outstanding_invoices\(\)/g) || [];
		expect(calls).toHaveLength(1);

		const finalize = PAY_SUBMISSION.indexOf("const finalizeSubmission = () => {");
		const callSite = PAY_SUBMISSION.indexOf("get_outstanding_invoices();");
		expect(finalize).toBeGreaterThan(-1);
		expect(callSite).toBeGreaterThan(finalize);
		expect(callSite).toBeLessThan(PAY_SUBMISSION.indexOf("try {", finalize));
	});

	it("is emitted from that callback in PayView, not from awaiting submit", () => {
		// `processPayment()` resolves `undefined` on success AND on its
		// `!response.message` early return, so anything hung off awaiting it
		// would announce settlements that never happened.
		expect(PAY_VIEW).toContain("function announceCapture()");
		expect(PAY_VIEW).toContain('emit("payment_captured"');
		expect(PAY_VIEW).toContain("get_outstanding_invoices: announceCapture");
	});

	it("marks an offline capture as queued, and the panel skips it", () => {
		// Offline, the register accepted it and the server has not: re-reading
		// receivables would show the same debt and look broken.
		expect(PAY_VIEW).toContain("queued: isOffline()");
		expect(SURFACE).toContain("if (payload?.queued) return;");
	});
});

describe("the service seam", () => {
	beforeEach(() => {
		call.mockReset();
		service.invalidateReceivablesBadge();
	});

	it("scopes every read by the profile and never by a company", () => {
		// The server derives the company from the POS Profile precisely so a
		// client cannot widen its own scope; sending one from here would invite
		// the endpoint to start trusting it.
		const source = readFileSync(resolve(SRC, "services/receivablesService.ts"), "utf8");
		expect(source).toContain("pos_profile: posProfile");
		expect(source).not.toContain("company:");
	});

	it("has no write of any kind", () => {
		const source = readFileSync(resolve(SRC, "services/receivablesService.ts"), "utf8");
		expect(source).not.toMatch(/\.(create|submit|collect|pay)[A-Za-z]*\(/);
	});

	it("asks for the badge once per profile and shares the answer", async () => {
		call.mockResolvedValue({ overdue: 6, due_soon: 3, all: 14, today: "2026-08-24" });

		await Promise.all([
			service.getReceivablesBadgeCached("Doco Ventas"),
			service.getReceivablesBadgeCached("Doco Ventas"),
			service.getReceivablesBadgeCached("Doco Ventas"),
		]);

		expect(call).toHaveBeenCalledTimes(1);
	});

	it("re-asks past the cache when told to, which is what a capture does", async () => {
		call.mockResolvedValue({ overdue: 6, due_soon: 3, all: 14, today: "2026-08-24" });

		await service.getReceivablesBadgeCached("Doco Ventas");
		await service.getReceivablesBadgeCached("Doco Ventas", true);

		expect(call).toHaveBeenCalledTimes(2);
	});

	it("starts a new cache for a new register rather than badging it with the old debt", async () => {
		call.mockResolvedValue({ overdue: 6, due_soon: 3, all: 14, today: "2026-08-24" });

		await service.getReceivablesBadgeCached("Doco Ventas");
		await service.getReceivablesBadgeCached("Mumu Caja 2");

		expect(call).toHaveBeenCalledTimes(2);
	});

	it("lets the next caller retry after a transport failure", async () => {
		call.mockRejectedValueOnce(new Error("offline"));
		await expect(service.getReceivablesBadgeCached("Doco Ventas")).rejects.toThrow();

		call.mockResolvedValue({ overdue: 1, due_soon: 0, all: 1, today: "2026-08-24" });
		await expect(service.getReceivablesBadgeCached("Doco Ventas")).resolves.toMatchObject({
			overdue: 1,
		});
	});
});

describe("«Recordatorio» is the CRM round's seguimiento, idempotent per invoice", () => {
	it("files through the existing bridge rather than writing its own note", () => {
		// The bridge is idempotent at customer + day: pressed twice it UPDATES
		// the same follow-up. A second write path here would file duplicates
		// into a queue somebody has to triage by hand.
		expect(SURFACE).toContain('from "../../../../services/crmService"');
		expect(SURFACE).toContain("createSeguimiento(row.customer, profile, {");
	});

	it("carries the folio and the pendiente in the note, per §1", () => {
		const note = SURFACE.slice(
			SURFACE.indexOf("createSeguimiento(row.customer, profile, {"),
			SURFACE.indexOf("reference_doctype: row.doctype"),
		);
		expect(note).toContain("row.name");
		expect(note).toContain("row.outstanding");
	});

	it("references the invoice itself, so the back office can open it", () => {
		expect(SURFACE).toContain("reference_doctype: row.doctype");
		expect(SURFACE).toContain("reference_name: row.name");
	});

	it("tells the cashier when a press UPDATED an existing follow-up", () => {
		// The bridge answers `updated` on the second press of a day. Saying so
		// is what stops a cashier pressing it a third time in case it did not
		// take.
		expect(SURFACE).toContain('result?.action === "updated"');
	});

	it("says so rather than failing silently on a site with no CRM", () => {
		expect(SURFACE).toContain("crmIsUnavailable()");
	});
});
