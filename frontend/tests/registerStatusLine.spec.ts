// @vitest-environment jsdom

/**
 * Register status line — convergence checklist item A (`Main.dc.html` 13-19).
 *
 * The centrepiece is `describe("the synced claim")`. Everything else on this
 * strip is information; that one chip is a claim about whether money already
 * taken has reached the server, and a cashier reads it immediately before
 * deciding to close a shift. It is the only assertion here worth
 * mutation-testing, and it was.
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import {
	claimsSynced,
	formatClock,
	formatShiftStart,
	resolveRegisterStatusLine,
	type RegisterStatusInput,
} from "../src/posapp/components/navbar/registerStatusLine";
import RegisterStatusLine from "../src/posapp/components/navbar/RegisterStatusLine.vue";

/** A register mid-shift, online, nothing queued — the artboard's own state. */
const SELLING: RegisterStatusInput = {
	context: "sale",
	ticketName: "B-04812",
	profileName: "Doco Ventas",
	cashierName: "Jenni",
	shiftStart: "2026-08-22 09:02:11",
	now: new Date("2026-08-22T19:52:00"),
	locale: "es-MX",
	printerStatus: "ok",
	usesSilentPrint: true,
	online: true,
	pendingCount: 0,
};

const chip = (input: RegisterStatusInput, id: string) =>
	resolveRegisterStatusLine(input).chips.find((c) => c.id === id);

describe("the synced claim — the only chip that can lie about money", () => {
	it("says online AND synced when the queue is empty", () => {
		const line = resolveRegisterStatusLine(SELLING);
		expect(claimsSynced(line)).toBe(true);
		expect(chip(SELLING, "connection")).toMatchObject({
			labelKey: "Online · synced",
			tone: "positive",
		});
	});

	it("REFUSES the synced claim while invoices are still queued", () => {
		// The register is back online — but the sales taken while it was gone
		// have not reached the server. "Online" is true and "synced" is not,
		// and a cashier closing the shift on that promise would strand them.
		const reconnected = { ...SELLING, online: true, pendingCount: 3 };
		const line = resolveRegisterStatusLine(reconnected);
		expect(claimsSynced(line)).toBe(false);
		expect(chip(reconnected, "connection")).toMatchObject({
			labelKey: "To upload · {0}",
			labelParams: [3],
			tone: "warning",
		});
	});

	it("refuses it offline, whatever the queue says", () => {
		for (const pendingCount of [0, 7]) {
			const offline = { ...SELLING, online: false, pendingCount };
			expect(claimsSynced(resolveRegisterStatusLine(offline))).toBe(false);
			expect(chip(offline, "connection")).toMatchObject({
				labelKey: "No connection",
				tone: "warning",
			});
		}
	});

	it("treats a missing queue count as zero rather than as unknown", () => {
		// `pendingCount` absent means the sync store has not reported yet. The
		// weaker reading would be to withhold the claim, but the store reports
		// 0 as 0 and absent only before it initialises — on a register that
		// has taken no sales. Documented so the choice is deliberate.
		const line = resolveRegisterStatusLine({ ...SELLING, pendingCount: undefined });
		expect(claimsSynced(line)).toBe(true);
	});

	it("never renders a negative or fractional queue depth", () => {
		expect(chip({ ...SELLING, pendingCount: -4 }, "connection")?.labelKey).toBe(
			"Online · synced",
		);
	});
});

describe("identity", () => {
	// Used to assert the cashier's name appeared here too. It no longer does:
	// the avatar chip in the actions row states it, and there it is the label
	// of a control rather than prose, so the bar stated one fact twice.
	it("names the ticket, the register and the shift start — not the cashier", () => {
		const line = resolveRegisterStatusLine(SELLING);
		expect(line.titleKey).toBe("B-04812");
		expect(line.titleIsLiteral).toBe(true);
		expect(line.subtitleKey).toBe("{0} · shift since {1}");
		expect(line.subtitleParams).toEqual(["Doco Ventas", "09:02"]);
		expect(JSON.stringify(line.subtitleParams)).not.toContain("Jenni");
	});

	it("reads the shift clock off the string, not through a timezone", () => {
		// Frappe hands back site-local time. `new Date()` would re-interpret it
		// against the browser's zone and could move an early shift into the
		// previous day — quiet wrongness on a corte screen.
		expect(formatShiftStart("2026-08-22 09:02:11")).toBe("09:02");
		expect(formatShiftStart("2026-08-22 07:05:00")).toBe("07:05");
		expect(formatShiftStart("")).toBe("");
		expect(formatShiftStart(null)).toBe("");
	});

	it("drops absent segments instead of rendering gaps", () => {
		// No profile and no cashier, but the shift time is known — so the
		// subtitle falls back to the shift clause ALONE rather than emitting a
		// leading separator where the identity would have been.
		const line = resolveRegisterStatusLine({
			...SELLING,
			profileName: null,
			cashierName: "",
		});
		expect(line.subtitleKey).toBe("Shift since {0}");
		expect(line.subtitleParams).toEqual(["09:02"]);
		expect(JSON.stringify(line)).not.toContain("undefined");
		expect(JSON.stringify(line)).not.toContain("null ·");
		expect(JSON.stringify(line)).not.toContain(" ·  ·");
	});

	it("says nothing at all about a register that has not answered yet", () => {
		const line = resolveRegisterStatusLine({ context: "sale" });
		expect(line.subtitleKey).toBe("");
		expect(JSON.stringify(line)).not.toContain("undefined");
	});
});

describe("context shifts with the screen, as the artboard draws it", () => {
	it("names the action when there is no sale to name", () => {
		expect(resolveRegisterStatusLine({ ...SELLING, ticketName: null }).titleKey).toBe(
			"New sale",
		);
	});

	it("explains on the opening screen why the register cannot charge", () => {
		const line = resolveRegisterStatusLine({ ...SELLING, context: "opening" });
		expect(line.titleKey).toBe("Open shift");
		expect(line.subtitleKey).toContain("cannot charge");
	});

	it("names the corte on the closing screen", () => {
		expect(
			resolveRegisterStatusLine({ ...SELLING, context: "closing" }).titleKey,
		).toBe("Cash count");
	});
});

describe("what each viewport keeps", () => {
	it("desktop carries clock, day count, printer, connection", () => {
		const ids = resolveRegisterStatusLine({ ...SELLING, ticketsToday: 31 }).chips.map(
			(c) => c.id,
		);
		expect(ids).toEqual(["clock", "tickets-today", "printer", "connection"]);
	});

	it("compact sheds everything but the connection", () => {
		const ids = resolveRegisterStatusLine({
			...SELLING,
			ticketsToday: 31,
			compact: true,
		}).chips.map((c) => c.id);
		expect(ids).toEqual(["connection"]);
	});

	it("shortens the synced wording on a phone", () => {
		expect(chip({ ...SELLING, compact: true }, "connection")?.labelKey).toBe("Online");
	});
});

describe("chips that must not appear rather than appear wrong", () => {
	it("omits the day count when there is no read model for it", () => {
		// `null` means NOT AVAILABLE. A `0` would be a claim the register
		// cannot support — there is no endpoint behind this number yet.
		expect(chip({ ...SELLING, ticketsToday: null }, "tickets-today")).toBeUndefined();
	});

	it("omits the printer where silent printing is not configured", () => {
		expect(chip({ ...SELLING, usesSilentPrint: false }, "printer")).toBeUndefined();
	});

	it("omits the printer when its health is unknown", () => {
		// A chip that is always grey teaches the operator to stop reading the
		// row, which costs more than the chip is worth.
		expect(
			chip({ ...SELLING, printerStatus: "unknown" }, "printer"),
		).toBeUndefined();
	});

	it("warns rather than reassures when the printer is unhealthy", () => {
		expect(chip({ ...SELLING, printerStatus: "warn" }, "printer")?.tone).toBe("warning");
		expect(chip({ ...SELLING, printerStatus: "fail" }, "printer")?.tone).toBe("warning");
	});

	it("omits saldo when the app is not installed", () => {
		expect(chip(SELLING, "saldo")).toBeUndefined();
		expect(chip({ ...SELLING, saldoLabel: "$1,240" }, "saldo")?.tone).toBe("warning");
	});

	it("returns an empty clock rather than an Invalid Date", () => {
		expect(formatClock(null)).toBe("");
		expect(formatClock(new Date("nonsense"))).toBe("");
	});
});

describe("the invariant: this strip spends no accent", () => {
	it("uses only state tones, never the brand accent", () => {
		const tones = new Set(
			resolveRegisterStatusLine({ ...SELLING, ticketsToday: 31, saldoLabel: "$1,240" })
				.chips.map((c) => c.tone),
		);
		// Invariant 2: the screen's one saturated colour belongs to the primary
		// action. Information never competes with it.
		expect([...tones].every((t) => ["neutral", "positive", "warning"].includes(t))).toBe(
			true,
		);
	});
});

describe("rendering", () => {
	const mountLine = (input: RegisterStatusInput) =>
		mount(RegisterStatusLine, { props: { input } });

	it("renders the folio, the identity and the chips", () => {
		const wrapper = mountLine({ ...SELLING, ticketsToday: 31 });
		expect(wrapper.get('[data-testid="register-status-title"]').text()).toBe("B-04812");
		expect(wrapper.get('[data-testid="register-status-subtitle"]').text()).toContain(
			"Doco Ventas",
		);
		expect(wrapper.get('[data-testid="register-status-chip-connection"]').text()).toContain(
			"synced",
		);
	});

	it("marks the connection chip's tone on the element for the evidence lane", () => {
		const wrapper = mountLine({ ...SELLING, online: false });
		expect(
			wrapper.get('[data-testid="register-status-chip-connection"]').attributes("data-tone"),
		).toBe("warning");
	});

	it("holds its place while the register is still booting", () => {
		// The strip replaces the app bar's spacer, so the wrapper must exist
		// before any data arrives — otherwise the actions jump left and then
		// jump back. The title legitimately falls back to "New sale"; what must
		// NOT render is a subtitle, because there is no identity to state yet.
		const wrapper = mountLine({});
		expect(wrapper.find('[data-testid="register-status-line"]').exists()).toBe(true);
		expect(wrapper.find('[data-testid="register-status-subtitle"]').exists()).toBe(false);
		expect(wrapper.text()).not.toContain("undefined");
	});

	it("never prints undefined into the DOM", () => {
		const wrapper = mountLine({ context: "sale", profileName: "Doco Ventas" });
		expect(wrapper.text()).not.toContain("undefined");
		expect(wrapper.text()).not.toContain("NaN");
	});

});
