// @vitest-environment jsdom

/**
 * The status line's ONE-LINE guarantee, and the order it sheds words in.
 *
 * `registerStatusLine.spec.ts` covers what each chip says. This file covers
 * what happens when there is not room for all of them, which is a different
 * property and the one the artboard is strictest about: the strip degrades by
 * dropping the least essential WORDS, never by wrapping onto a second line and
 * never by ellipsing a value mid-word.
 *
 * That rule is enforced in two places that have to agree — `priority` on each
 * chip, and the media queries that hide by `data-priority` — so both are
 * asserted here against each other rather than each against a hand-copied
 * list. A ladder written twice is a ladder that drifts.
 */

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import {
	NARROW_IDENTITY_BUDGET,
	resolveRegisterStatusLine,
} from "../src/posapp/components/navbar/registerStatusLine";
import RegisterStatusLine from "../src/posapp/components/navbar/RegisterStatusLine.vue";
import statusLineSource from "../src/posapp/components/navbar/RegisterStatusLine.vue?raw";

/** A busy desktop register with every fact available. */
const FULL = {
	ticketName: "ACC-SINV-2026-04812",
	profileName: "Doco Ventas",
	registerLabel: "Caja 2",
	shiftStart: "2026-08-22 09:02:00",
	now: new Date("2026-08-22T19:52:00"),
	locale: "es-MX",
	ticketsToday: 31,
	printerStatus: "ok" as const,
	usesSilentPrint: true,
	online: true,
	pendingCount: 0,
	saldoLabel: "Saldo $1,240",
};

const priorities = (input = FULL) =>
	Object.fromEntries(
		resolveRegisterStatusLine(input).chips.map((chip) => [chip.id, chip.priority]),
	);

/** Every `@container (max-width: N)` block that hides a priority, widest first.
 * Container rules, not media rules: the ladder measures the chips' own box
 * since 08-24, because a viewport ladder was blind to the actions cluster
 * growing beside it (the saldo badge pushed the chips under the connection
 * button at 1920 — a width the media ladder was sure was safe). */
function dropRules() {
	const rules: Array<{ width: number; priority: number }> = [];
	const pattern =
		/@container\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.register-status-chip\[data-priority="(\d+)"\]/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(statusLineSource)) !== null) {
		rules.push({ width: Number(match[1]), priority: Number(match[2]) });
	}
	return rules;
}

describe("the drop ladder", () => {
	it("ranks the chips by what a cashier can afford to lose", () => {
		const rank = priorities();
		// The connection chip is the one claim about whether money reached the
		// server. It never drops, and nothing may rank below it.
		expect(rank.connection).toBe(1);
		expect(Math.min(...Object.values(rank))).toBe(1);
		// Saldo is the owner's float; the day's count and the wall clock can go
		// first. (The printer is absent here on purpose — see the next test.)
		expect(rank.saldo).toBeLessThan(rank["tickets-today"]);
		expect(rank["tickets-today"]).toBeLessThan(rank.clock);
	});

	it("a healthy printer says nothing; a fault earns an icon on saldo's shelf", () => {
		// E1 (08-29): «Impresora lista» in the bar all day was reassurance-
		// wallpaper — the cobro header and opening readiness own that promise.
		// The FAULT keeps a seat because it is an instruction, and it sits on
		// the same rung as saldo: both outlast everything except the one claim
		// about money, which nothing may outrank.
		const healthy = priorities();
		const faulty = priorities({ ...FULL, printerStatus: "fail" as const });
		expect(healthy.printer).toBeUndefined();
		expect(faulty.printer).toBe(faulty.saldo);
		expect(faulty.printer).toBeGreaterThan(faulty.connection);
		expect(faulty.printer).toBeLessThan(faulty["tickets-today"]);
	});

	it("hides in strictly descending priority as the bar narrows", () => {
		const rules = dropRules();
		expect(rules.length).toBeGreaterThan(0);
		// Widest breakpoint first, dropping the highest priority number first.
		const byWidth = [...rules].sort((a, b) => b.width - a.width);
		expect(rules).toEqual(byWidth);
		for (let i = 1; i < byWidth.length; i++) {
			expect(byWidth[i]!.priority).toBeLessThan(byWidth[i - 1]!.priority);
		}
	});

	it("never writes a rule that would hide the connection chip", () => {
		// Priority 1 has no rule at all, which is what makes "never drops" a
		// property of the stylesheet rather than a promise in a comment.
		expect(dropRules().some((rule) => rule.priority <= 1)).toBe(false);
	});

	it("shows the whole row whenever the box affords it", () => {
		// The full healthy row measures under ~704px (it lost the printer text
		// chip to E1); nothing may drop while the box still fits it, so the
		// widest breakpoint stays at or under that measure.
		const widest = Math.max(...dropRules().map((rule) => rule.width));
		expect(widest).toBeLessThanOrEqual(720);
		const shown = resolveRegisterStatusLine(FULL).chips.map((chip) => chip.id);
		expect(shown).toEqual(
			expect.arrayContaining(["clock", "tickets-today", "saldo", "connection"]),
		);
	});

	it("in a 500px box has shed the clock and the day count, and nothing else", () => {
		const dropped = dropRules()
			.filter((rule) => rule.width >= 500)
			.map((rule) => rule.priority);
		// The degraded-printer row is the crowded one now, so the ladder is
		// asserted against it: the icon and saldo survive, the niceties go.
		const rank = priorities({ ...FULL, printerStatus: "fail" as const });
		const survives = (id: string) => !dropped.includes(rank[id]!);

		expect(survives("clock")).toBe(false);
		expect(survives("tickets-today")).toBe(false);
		expect(survives("printer")).toBe(true);
		expect(survives("saldo")).toBe(true);
		expect(survives("connection")).toBe(true);
	});
});

describe("the identity is on the ladder too", () => {
	it("keeps the profile name while there is room for it", () => {
		const line = resolveRegisterStatusLine(FULL);
		expect(line.subtitleParams?.[0]).toContain("Doco Ventas");
		expect(line.subtitleParams?.[0]).toContain("Caja 2");
	});

	it("keeps an ORDINARY identity whole on a narrow bar", () => {
		// The register measured fine at every width with this subtitle, so a
		// width-only rule would have deleted a fact nobody was short of room
		// for. `narrow` alone must change nothing.
		const line = resolveRegisterStatusLine({ ...FULL, narrow: true });
		expect(String(line.subtitleParams?.[0] ?? "")).toContain("Doco Ventas");
		expect(String(line.subtitleParams?.[0] ?? "")).toContain("Caja 2");
	});

	it("gives up the profile name when the identity genuinely overruns", () => {
		// Measured at 1280: this is the shape that pushed the chips out of
		// their own box and under the actions cluster. The row stayed one row,
		// as designed, and overflowed sideways instead.
		const long = {
			...FULL,
			profileName: "Docomexico Sucursal Centro Mostrador",
			registerLabel: "Caja 12",
			narrow: true,
		};
		expect(
			String(resolveRegisterStatusLine({ ...long, narrow: false }).subtitleParams?.[0] ?? ""),
		).toContain("Docomexico Sucursal Centro Mostrador");

		const line = resolveRegisterStatusLine(long);
		const subtitle = String(line.subtitleParams?.[0] ?? "");
		expect(subtitle).not.toContain("Docomexico");
		// The specific facts survive; the static one is what goes.
		expect(subtitle).toContain("Caja 12");
		expect(line.subtitleKey).toContain("shift since");
		expect(line.subtitleParams?.[1]).toBe("09:02");
	});

	it("keeps the budget below what the bar measured at", () => {
		// The measurement put the break near a 49-character subtitle, of which
		// the shift clause is about twenty. A proxy set at the edge is a proxy
		// that fails on the first wide glyph.
		expect(NARROW_IDENTITY_BUDGET).toBeLessThan(49 - 20 + 2);
		expect(NARROW_IDENTITY_BUDGET).toBeGreaterThan("Doco Ventas · Caja 2".length);
	});

	it("still names the ticket — the folio is not a droppable word", () => {
		const line = resolveRegisterStatusLine({
			...FULL,
			profileName: "Docomexico Sucursal Centro Mostrador",
			narrow: true,
		});
		expect(line.titleIsLiteral).toBe(true);
		expect(line.titleKey).toBe("ACC-SINV-2026-04812");
	});

	it("drops nothing twice when a bar is both narrow and compact", () => {
		const long = { ...FULL, profileName: "Docomexico Sucursal Centro Mostrador" };
		const narrow = resolveRegisterStatusLine({ ...long, narrow: true });
		const both = resolveRegisterStatusLine({ ...long, narrow: true, compact: true });
		expect(String(both.subtitleParams?.[0] ?? "")).toBe(
			String(narrow.subtitleParams?.[0] ?? ""),
		);
	});
});

describe("the one-line guarantee", () => {
	it("lets nothing in the strip wrap onto a second line", () => {
		// A wrapped status line is the failure the ladder exists to prevent —
		// it doubles the bar's height and pushes the sale down the screen.
		expect(statusLineSource).not.toMatch(/flex-wrap:\s*wrap/);
	});

	it("keeps the identity whole rather than ellipsing it", () => {
		// This shipped once as "…shift since 0…" — a shift start severed before
		// its own digits. An icon looks deliberate; a cut word looks broken.
		expect(statusLineSource).toMatch(
			/\.register-status-line__title\s*\{[^}]*white-space:\s*nowrap/,
		);
		expect(statusLineSource).toMatch(
			/\.register-status-line__subtitle\s*\{[^}]*white-space:\s*nowrap/,
		);
	});

	it("never squashes a chip instead of dropping it", () => {
		expect(statusLineSource).toMatch(/\.register-status-chip\s*\{[^}]*flex:\s*0 0 auto/);
		expect(statusLineSource).toMatch(/\.register-status-chip\s*\{[^}]*white-space:\s*nowrap/);
	});

	it("renders every chip it was given, carrying its priority for the ladder", () => {
		const wrapper = mount(RegisterStatusLine, {
			props: { input: FULL },
			global: { mocks: { __: (value: string) => value } },
		});
		const chips = wrapper.findAll(".register-status-chip");
		expect(chips).toHaveLength(resolveRegisterStatusLine(FULL).chips.length);
		chips.forEach((chip) => {
			// Without the attribute the media queries match nothing and the row
			// silently stops degrading at all.
			expect(chip.attributes("data-priority")).toBeTruthy();
		});
		wrapper.unmount();
	});
});
