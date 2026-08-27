/**
 * Where «31 tickets hoy» and «Saldo $1,240» come from.
 *
 * `registerStatusLine.spec.ts` proves the strip OMITS both chips when it is
 * handed `null`. That was the whole story until now, because the app bar had
 * nothing to hand it. This file covers the sources — and most of it is about
 * the cases where the right answer is to say nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	bolsaChipLabel,
	FACTS_REFRESH_MS,
	TICKET_COUNT_METHOD,
	ticketCountFilters,
	useRegisterFacts,
} from "../src/posapp/components/navbar/useRegisterFacts";
import { RECARGAS_READS } from "../src/posapp/components/pos/recargas/useRecargasSnapshot";

const money = (value: number) => `$${value.toLocaleString("en-US")}`;

/** A recording caller, so a spec asserts the wire rather than the outcome. */
function recorder(responses: Record<string, unknown> = {}) {
	const calls: Array<{ method: string; args?: Record<string, any> }> = [];
	const call = vi.fn(async (options: { method: string; args?: Record<string, any> }) => {
		calls.push(options);
		if (Object.prototype.hasOwnProperty.call(responses, options.method)) {
			const value = responses[options.method];
			if (value instanceof Error) throw value;
			return { message: value };
		}
		return {};
	});
	return { call, calls };
}

const SALDO_PROFILE = { name: "Doco Ventas", saldo_enabled: 1, currency: "MXN" };
const PLAIN_PROFILE = { name: "Carnicería", currency: "MXN" };

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the day's ticket count", () => {
	it("counts SUBMITTED sales on this shift and on today's date", () => {
		// Both filters, not one. A shift can outlive midnight on a tenant that
		// does not force stale shifts closed, and the chip says «hoy».
		expect(ticketCountFilters("POS-OPEN-7", "2026-08-23")).toEqual({
			docstatus: 1,
			posa_pos_opening_shift: "POS-OPEN-7",
			posting_date: "2026-08-23",
		});
	});

	it("asks Frappe's own permission-checked count, not a bespoke endpoint", async () => {
		const { call, calls } = recorder({ [TICKET_COUNT_METHOD]: 31 });
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
			today: () => "2026-08-23",
		});
		await facts.refresh();

		const counted = calls.find((entry) => entry.method === TICKET_COUNT_METHOD);
		expect(counted).toBeDefined();
		expect(counted!.args).toEqual({
			doctype: "Sales Invoice",
			filters: ticketCountFilters("POS-OPEN-7", "2026-08-23"),
		});
		expect(facts.ticketsToday.value).toBe(31);
	});

	it("stays unknown before a shift is open, rather than reporting zero", async () => {
		const { call, calls } = recorder({ [TICKET_COUNT_METHOD]: 31 });
		const facts = useRegisterFacts({
			call,
			openingShift: () => null,
			posProfile: () => PLAIN_PROFILE,
		});
		await facts.refresh();

		expect(facts.ticketsToday.value).toBeNull();
		expect(calls.some((entry) => entry.method === TICKET_COUNT_METHOD)).toBe(false);
	});

	it("keeps the last good count when the read fails", async () => {
		const { call } = recorder({ [TICKET_COUNT_METHOD]: 31 });
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
		});
		await facts.refresh();
		expect(facts.ticketsToday.value).toBe(31);

		const failing = recorder({ [TICKET_COUNT_METHOD]: new Error("offline") });
		const stubborn = useRegisterFacts({
			call: failing.call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
		});
		// Seed it, then break the server.
		stubborn.ticketsToday.value = 31;
		await stubborn.refresh();
		// A register that lost the server for ten seconds did not stop having
		// sold anything, and «0 tickets hoy» would say it had.
		expect(stubborn.ticketsToday.value).toBe(31);
	});

	it("refuses a nonsense count", async () => {
		const { call } = recorder({ [TICKET_COUNT_METHOD]: "many" });
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
		});
		await facts.refresh();
		expect(facts.ticketsToday.value).toBeNull();
	});
});

describe("the saldo pouch", () => {
	it("never asks a register that does not sell airtime", async () => {
		const { call, calls } = recorder();
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
			formatMoney: money,
		});
		await facts.refresh();

		expect(calls.some((entry) => entry.method === RECARGAS_READS.balance)).toBe(false);
		expect(facts.saldoLabel.value).toBeNull();
	});

	it("reads the pouch through the SAME method the Recargas screen uses", async () => {
		const { call, calls } = recorder({
			[RECARGAS_READS.balance]: { visible: true, balance: 1240 },
		});
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => SALDO_PROFILE,
			formatMoney: money,
		});
		await facts.refresh();

		const read = calls.find((entry) => entry.method === RECARGAS_READS.balance);
		expect(read).toBeDefined();
		expect(read!.args).toEqual({ pos_profile: "Doco Ventas" });
		expect(facts.saldoLabel.value).toBe("Saldo $1,240");
	});

	it("needs the tenant's own flag — the vertical capability alone spends no call", async () => {
		// The default retail-phones preset declares "saldo" on EVERY register
		// that resolves it, so a capability-gated read meant every saldo-less
		// tenant 417-ing this method once a minute forever (2026-08-27 sweep).
		// `saldo_enabled` is the saldo app's own field: flag absent = app
		// absent, and the pouch read must stay home.
		const { call, calls } = recorder({
			[RECARGAS_READS.balance]: { visible: true, balance: 500 },
		});
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
			formatMoney: money,
		});
		await facts.refresh();
		expect(calls.some((entry) => entry.method === RECARGAS_READS.balance)).toBe(false);
		expect(facts.saldoLabel.value).toBeNull();
	});

	it("takes its word from the caller, so the chip can be translated", async () => {
		// The module holds no `__()`; the app bar passes `__("Balance")`, which
		// es.csv already resolves to «Saldo».
		const { call } = recorder({
			[RECARGAS_READS.balance]: { visible: true, balance: 1240 },
		});
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => SALDO_PROFILE,
			formatMoney: money,
			saldoWord: () => "Balance",
		});
		await facts.refresh();
		expect(facts.saldoLabel.value).toBe("Balance $1,240");
	});

	it("respects the manager's switch — a hidden balance is a setting, not a fault", () => {
		expect(bolsaChipLabel({ visible: false, balance: 1240 }, money)).toBeNull();
	});

	it("says nothing when the balance is visible but unknown", () => {
		// TAECEL unreachable with no cached snapshot. That is a fault, and a
		// fault is not a figure.
		expect(bolsaChipLabel({ visible: true, balance: null }, money)).toBeNull();
		expect(bolsaChipLabel(null, money)).toBeNull();
	});

	it("keeps the last good pouch figure when the read fails", async () => {
		const { call } = recorder({
			[RECARGAS_READS.balance]: new Error("taecel down"),
		});
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => SALDO_PROFILE,
			formatMoney: money,
		});
		facts.saldoLabel.value = "Saldo $1,240";
		await facts.refresh();
		expect(facts.saldoLabel.value).toBe("Saldo $1,240");
	});
});

describe("refreshing", () => {
	it("reads once immediately and then on a cadence", async () => {
		vi.useFakeTimers();
		const { call, calls } = recorder({ [TICKET_COUNT_METHOD]: 4 });
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
		});
		facts.start(FACTS_REFRESH_MS);
		await vi.advanceTimersByTimeAsync(0);
		const afterStart = calls.length;
		expect(afterStart).toBeGreaterThan(0);

		await vi.advanceTimersByTimeAsync(FACTS_REFRESH_MS + 10);
		expect(calls.length).toBeGreaterThan(afterStart);

		facts.stop();
		const beforeIdle = calls.length;
		await vi.advanceTimersByTimeAsync(FACTS_REFRESH_MS * 3);
		expect(calls.length).toBe(beforeIdle);
		vi.useRealTimers();
	});

	it("does not stack a second timer when started twice", async () => {
		vi.useFakeTimers();
		const { call, calls } = recorder({ [TICKET_COUNT_METHOD]: 4 });
		const facts = useRegisterFacts({
			call,
			openingShift: () => "POS-OPEN-7",
			posProfile: () => PLAIN_PROFILE,
		});
		facts.start(1000);
		facts.start(1000);
		await vi.advanceTimersByTimeAsync(0);
		const seeded = calls.length;
		await vi.advanceTimersByTimeAsync(1010);
		// One tick, one read pair — not two.
		expect(calls.length - seeded).toBe(1);
		facts.stop();
		vi.useRealTimers();
	});
});
