// @vitest-environment jsdom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

/**
 * The corte's seam: the drawer count, the field the close posts, and the band.
 *
 * `corteDenominations.spec.ts` holds the derivation. This file holds the three
 * joins around it, because each one is a place where "counted by denomination"
 * could quietly become something else:
 *
 *   1. the counted figure lands in `payment_reconciliation[].closing_amount`,
 *      the SAME field the reconciliation table has always written, so what the
 *      close posts is unchanged and only the way it is entered has moved;
 *   2. the difference reaches the band through `resolveBandState`, not through
 *      arithmetic this screen does for itself;
 *   3. the band and the dialog's Submit are never both on screen — they are one
 *      act, and two of them would be two accents (§17.7 invariant 2).
 */

import ClosingDialog from "../src/posapp/components/pos/shell/ClosingDialog.vue";
import { DESTINATION_SURFACE } from "../src/posapp/components/pos/shell/destinations/surfaceContext";

/** Minimal mitt stand-in; the dialog registers a real listener on mount. */
const makeBus = () => {
	const handlers: Record<string, Array<(_payload?: any) => void>> = {};
	return {
		on: (event: string, fn: (_payload?: any) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string) => {
			delete handlers[event];
		},
		emit: (event: string, payload?: any) => {
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const CASH = "Efectivo";

/** The artboard's shift, as the server hands it over. */
const closingShift = () => ({
	pos_opening_shift: "POS-OPEN-0001",
	period_start_date: "2026-08-22 09:02:00",
	period_end_date: "2026-08-22 20:05:00",
	payment_reconciliation: [
		{ mode_of_payment: CASH, opening_amount: 1500, expected_amount: 5391, closing_amount: 0 },
		{ mode_of_payment: "Tarjeta", opening_amount: 0, expected_amount: 3890, closing_amount: 3890 },
	],
});

const overviewMessage = {
	total_invoices: 31,
	company_currency: "MXN",
	cash_expected: { mode_of_payment: CASH, company_currency_total: 5391, by_currency: [] },
	payments_by_mode: [{ mode_of_payment: CASH, currency: "MXN", total: 5120, company_currency_total: 5120 }],
	cash_movements: { count: 6, company_currency_total: 1829, by_currency: [], by_type: [] },
	draft_invoices: { count: 0 },
};

let dialog: ReturnType<typeof mount> | null = null;

const mountDialog = async (options: { hosted?: boolean } = {}) => {
	const eventBus = makeBus();
	const wrapper = mount(ClosingDialog, {
		global: {
			plugins: [createVuetify()],
			provide: {
				eventBus,
				// A hosted destination means the SHELL owns the band; standalone
				// at /closing there is no shell and the corte carries its own.
				...(options.hosted
					? { [DESTINATION_SURFACE as symbol]: { attachTo: { value: null }, destinationId: { value: "closing" } } }
					: {}),
			},
			// `__` reaches templates as an app global (frappe-shim installs it),
			// not through each component's setup.
			mocks: { __: window.__, frappe: { _: (text: string) => text } },
		},
	});

	dialog = wrapper;
	const data = closingShift();
	eventBus.emit("open_ClosingDialog", data);
	await nextTick();
	await nextTick();
	await nextTick();
	return { wrapper, data };
};

/**
 * `createVuetify()` alone registers no components, so `v-dialog` stays an
 * unknown element and renders its children inline rather than teleporting them.
 * That is what makes this dialog assertable at all without dragging the whole
 * Vuetify component graph into a unit spec.
 */
const inDialog = (selector: string) => dialog?.element.querySelector(selector) ?? null;

const setCount = async (faceMinor: number, count: number) => {
	const row = inDialog(`[data-face-minor="${faceMinor}"]`);
	const input = row?.querySelector('[data-testid="denomination-count"]') as HTMLInputElement;
	if (!input) throw new Error(`no stepper for face ${faceMinor}`);
	input.value = String(count);
	input.dispatchEvent(new Event("input"));
	await nextTick();
};

beforeEach(() => {
	// Desktop by default: the movil boundary moved to the compact band
	// (< 1100, 2026-08-26) and jsdom's 1024 default now falls inside it.
	window.innerWidth = 1440;
	setActivePinia(createPinia());
	vi.stubGlobal("__", (text: string, args?: (string | number)[]) =>
		args && args.length ? text.replace(/\{(\d+)\}/g, (m, i) => String(args[Number(i)] ?? m)) : text,
	);
	vi.stubGlobal("format_number", (value: number) => Number(value || 0).toFixed(2));
	vi.stubGlobal("flt", (value: number) => Number(value) || 0);
	vi.stubGlobal("get_currency_symbol", () => "$");
	vi.stubGlobal("frappe", {
		_: (text: string) => text,
		call: () => Promise.resolve({ message: overviewMessage }),
	});
});

afterEach(() => {
	dialog?.unmount();
	dialog = null;
	vi.unstubAllGlobals();
});

describe("the counted figure lands where the close reads it", () => {
	it("writes the cash row's closing_amount, and touches no other row", async () => {
		const { data } = await mountDialog();

		// $1,000 × 2 and $500 × 3 — the top of the artboard's count.
		await setCount(100_000, 2);
		await setCount(50_000, 3);

		expect(data.payment_reconciliation[0]?.closing_amount).toBe(3500);
		// The card row is reconciled from a terminal slip, not from the drawer.
		expect(data.payment_reconciliation[1]?.closing_amount).toBe(3890);
	});

	it("submits the same payload it always did, on the same event", async () => {
		const { wrapper, data } = await mountDialog();
		await setCount(100_000, 2);

		const submitted: unknown[] = [];
		const bus = (wrapper.vm as any).eventBus;
		bus.on("submit_closing_pos", (payload: unknown) => submitted.push(payload));

		expect((wrapper.vm as any).submitDialog()).toBe(true);
		expect(submitted).toHaveLength(1);
		// The very object the server was always handed, count and all.
		expect(submitted[0]).toBe((wrapper.vm as any).dialog_data);
		expect(submitted[0]).toEqual({ ...data, payment_reconciliation: data.payment_reconciliation });
	});
});

describe("the difference reaches the band", () => {
	it("renders the artboard's short count in amber", async () => {
		await mountDialog();
		for (const [face, count] of [
			[100_000, 2],
			[50_000, 3],
			[20_000, 4],
			[10_000, 6],
			[5_000, 5],
			[2_000, 8],
			[1_000, 3],
			[500, 3],
			[200, 3],
			[100, 5],
		] as const) {
			await setCount(face, count);
		}

		const band = inDialog('[data-testid="action-band"]');
		expect(band).toBeTruthy();
		// 5,366 counted against 5,391 expected.
		expect(band?.getAttribute("data-band-value")).toBe("-25");
		expect(band?.getAttribute("data-band-tone")).toBe("warning");
		expect(band?.getAttribute("data-band-action")).toBe("shift.close");
	});

	it("is amber for a surplus too", async () => {
		await mountDialog();
		// Six $1,000 notes: 6,000 against 5,391 expected.
		await setCount(100_000, 6);

		const band = inDialog('[data-testid="action-band"]');
		expect(band?.getAttribute("data-band-value")).toBe("609");
		expect(band?.getAttribute("data-band-tone")).toBe("warning");
	});

	it("is calm only when the drawer counts clean", async () => {
		await mountDialog();
		await setCount(100_000, 5);
		await setCount(20_000, 1);
		await setCount(10_000, 1);
		await setCount(5_000, 1);
		await setCount(2_000, 2);
		await setCount(100, 1);

		const band = inDialog('[data-testid="action-band"]');
		expect(band?.getAttribute("data-band-value")).toBe("0");
		expect(band?.getAttribute("data-band-tone")).toBe("positive");
	});
});

describe("one action, not two", () => {
	it("drops the dialog's own Submit while the band carries CLOSE SHIFT", async () => {
		await mountDialog();

		expect(inDialog('[data-testid="band-primary"]')).toBeTruthy();
		expect(inDialog('[data-testid="closing-submit"]')).toBeNull();
	});

	it("keeps Submit and mounts no band when a shell already owns the lane", async () => {
		await mountDialog({ hosted: true });

		expect(inDialog('[data-testid="action-band"]')).toBeNull();
		expect(inDialog('[data-testid="closing-submit"]')).toBeTruthy();
	});
});

describe("the phone's corte (movil round 3)", () => {
	it("renders MovilCorte inside the dialog at phone width, desktop body and band standing down", async () => {
		window.innerWidth = 390;
		await mountDialog();

		expect(inDialog('[data-testid="movil-corte"]')).toBeTruthy();
		expect(inDialog('[data-testid="movil-corte-primary"]')).toBeTruthy();
		// One primary: the desktop actions row and both band forms stand down.
		expect(inDialog('[data-testid="closing-submit"]')).toBeNull();
		expect(inDialog('[data-testid="action-band"]')).toBeNull();
		expect(inDialog('[data-testid="closing-difference"]')).toBeNull();
	});

	it("close-shift stamps the counted figure and the note onto the doc, then submits", async () => {
		window.innerWidth = 390;
		const { wrapper } = await mountDialog();
		const vm = wrapper.vm as any;

		vm.onMovilCloseShift({ counted: 5391, source: "manual", note: "billete roto en caja" });
		await nextTick();

		const cashRow = vm.dialog_data.payment_reconciliation.find(
			(row: any) => row.mode_of_payment === CASH,
		);
		expect(Number(cashRow.closing_amount)).toBe(5391);
		expect(vm.dialog_data.posa_difference_note).toBe("billete roto en caja");
	});

	it("draws the MOVIL corte at tablet width too — one compact boundary", async () => {
		// Inverted 2026-08-26 (owner: «there's still wired the old mobile
		// view … on my tablet»): the 768–1099 band joins the movil register.
		window.innerWidth = 900;
		await mountDialog();

		expect(inDialog('[data-testid="movil-corte"]')).toBeTruthy();
	});

	it("keeps the desktop corte at desktop width", async () => {
		window.innerWidth = 1440;
		await mountDialog();

		expect(inDialog('[data-testid="movil-corte"]')).toBeNull();
		// Standalone, the dialog's own band owns the action — the desktop
		// corte exactly as it was before the movil branch existed.
		expect(inDialog('[data-testid="action-band"]')).toBeTruthy();
	});
});

describe("the header carries the shift", () => {
	it("shows the span, the tickets and the open drafts", async () => {
		await mountDialog();

		expect(inDialog('[data-testid="closing-shift-span"]')?.textContent?.trim()).toBe(
			"09:02 → 20:05 · 11 h 03 m",
		);
		expect(inDialog('[data-testid="closing-ticket-count"]')?.textContent).toContain("31");
		expect(inDialog('[data-testid="closing-open-drafts"]')?.textContent).toContain("0");
	});
});
