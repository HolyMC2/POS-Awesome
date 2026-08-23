// @vitest-environment jsdom
/**
 * One corte on screen, not two.
 *
 * `DefaultLayout` mounts a `<ClosingDialog />` unconditionally, and has to:
 * the navbar's «Close shift» must work from `/reports` and `/payments`, where
 * there is no rail to host anything. Now that the corte is also a rail
 * destination, the shell mounts a SECOND copy inside `DestinationHost` — and
 * both hear the same `open_ClosingDialog` on the same bus. Left alone that
 * puts a floating modal on top of the hosted surface, which is the shape of
 * bug that only ever shows up on a real register.
 *
 * Three joins are asserted here because each one is money-facing:
 *
 *   1. the floating copy stands down while the shell is showing the corte;
 *   2. the hosted copy ASKS for the shift (`open_shift_details`) rather than
 *      forking the close flow — `make_closing_shift_from_opening` submits
 *      printed drafts and can refuse, so the rail and the navbar must reach it
 *      the same way;
 *   3. unmounting the hosted copy does not take the floating copy's listener
 *      with it, which a bare `eventBus.off("open_ClosingDialog")` would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

import ClosingDialog from "../src/posapp/components/pos/shell/ClosingDialog.vue";
import { DESTINATION_SURFACE } from "../src/posapp/components/pos/shell/destinations/surfaceContext";

/** Minimal mitt stand-in that respects the handler argument to `off`. */
const makeBus = () => {
	const handlers: Record<string, Array<(_payload?: unknown) => void>> = {};
	return {
		handlers,
		on: (event: string, fn: (_payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn?: (_payload?: unknown) => void) => {
			if (!fn) {
				delete handlers[event];
				return;
			}
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit: (event: string, payload?: unknown) => {
			for (const fn of [...(handlers[event] ?? [])]) fn(payload);
		},
	};
};

const closingShift = () => ({
	pos_opening_shift: "POS-OPEN-0001",
	period_start_date: "2026-08-22 09:02:00",
	period_end_date: "2026-08-22 20:05:00",
	payment_reconciliation: [
		{ mode_of_payment: "Efectivo", opening_amount: 1500, expected_amount: 5391, closing_amount: 0 },
	],
});

const overviewMessage = {
	total_invoices: 31,
	company_currency: "MXN",
	cash_expected: { mode_of_payment: "Efectivo", company_currency_total: 5391, by_currency: [] },
	payments_by_mode: [],
	cash_movements: { count: 0, company_currency_total: 0, by_currency: [], by_type: [] },
	draft_invoices: { count: 0 },
};

const mountCorte = (
	eventBus: ReturnType<typeof makeBus>,
	hosted: boolean,
	listeners: Record<string, unknown> = {},
) =>
	mount(ClosingDialog, {
		props: listeners as never,
		global: {
			plugins: [createVuetify()],
			provide: {
				eventBus,
				...(hosted
					? {
							[DESTINATION_SURFACE as symbol]: {
								attachTo: { value: document.createElement("div") },
								destinationId: { value: "closing" },
							},
						}
					: {}),
			},
			mocks: { __: window.__, frappe: { _: (text: string) => text } },
		},
	});

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("__", (text: string) => text);
	vi.stubGlobal("format_number", (value: number) => Number(value || 0).toFixed(2));
	vi.stubGlobal("flt", (value: number) => Number(value) || 0);
	vi.stubGlobal("get_currency_symbol", () => "$");
	vi.stubGlobal("frappe", {
		_: (text: string) => text,
		call: () => Promise.resolve({ message: overviewMessage }),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the corte as a rail destination", () => {
	it("asks the shell to prepare the shift when it is hosted", async () => {
		const bus = makeBus();
		const asked: number[] = [];
		bus.on("open_shift_details", () => asked.push(1));

		const hosted = mountCorte(bus, true);
		await nextTick();

		expect(asked, "a hosted corte that never asks renders an empty surface").toHaveLength(1);
		hosted.unmount();
	});

	it("does NOT ask when it is the floating copy the layout always mounts", async () => {
		const bus = makeBus();
		const asked: number[] = [];
		bus.on("open_shift_details", () => asked.push(1));

		const floating = mountCorte(bus, false);
		await nextTick();

		// Otherwise every page load would fire a close-shift preparation, which
		// submits printed drafts server-side.
		expect(asked).toHaveLength(0);
		floating.unmount();
	});

	it("stands the floating copy down while the shell is showing the corte", async () => {
		const bus = makeBus();
		const floating = mountCorte(bus, false);
		const hosted = mountCorte(bus, true);
		await nextTick();

		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();
		await nextTick();

		expect((hosted.vm as unknown as { closingDialog: boolean }).closingDialog).toBe(true);
		expect(
			(floating.vm as unknown as { closingDialog: boolean }).closingDialog,
			"one act opened two corte screens",
		).toBe(false);

		hosted.unmount();
		floating.unmount();
	});

	it("closes a floating copy that was already up when the rail opened the corte", async () => {
		const bus = makeBus();
		const floating = mountCorte(bus, false);
		await nextTick();

		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();
		expect((floating.vm as unknown as { closingDialog: boolean }).closingDialog).toBe(true);

		const hosted = mountCorte(bus, true);
		await nextTick();
		await nextTick();

		expect((floating.vm as unknown as { closingDialog: boolean }).closingDialog).toBe(false);

		hosted.unmount();
		floating.unmount();
	});

	it("gives the floating copy its listener back when the hosted one goes away", async () => {
		const bus = makeBus();
		const floating = mountCorte(bus, false);
		const hosted = mountCorte(bus, true);
		await nextTick();

		hosted.unmount();
		await nextTick();

		// A bare `off("open_ClosingDialog")` would have removed EVERY listener
		// for the event, and the navbar's «Close shift» would have gone quiet.
		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();

		expect((floating.vm as unknown as { closingDialog: boolean }).closingDialog).toBe(true);
		floating.unmount();
	});

	it("leaves the destination rather than just hiding its own overlay", async () => {
		const bus = makeBus();
		// Listened for the way `DestinationHost` listens (`@close`), rather than
		// read off `wrapper.emitted()`: this dialog destructures `emit` from its
		// setup context, and VTU's recorder does not see those.
		const closed = vi.fn();
		const hosted = mountCorte(bus, true, { onClose: closed });
		await nextTick();
		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();

		(hosted.vm as unknown as { dismissCorte: () => void }).dismissCorte();
		await nextTick();

		// Closing the overlay alone would leave `DestinationHost` on screen
		// showing nothing, with the rail beside it and no way out. `close`
		// becomes the host's `dismiss`, which returns to the PREVIOUS
		// destination rather than a hardcoded sale.
		expect((hosted.vm as unknown as { closingDialog: boolean }).closingDialog).toBe(false);
		expect(closed).toHaveBeenCalledOnce();
		hosted.unmount();
	});

	it("prints the difference itself when the shell owns the band lane", async () => {
		const bus = makeBus();
		const hosted = mountCorte(bus, true);
		await nextTick();
		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();
		await nextTick();
		await nextTick();

		const difference = hosted.element.querySelector('[data-testid="closing-difference"]');
		expect(difference, "the corte lost the number it exists to produce").toBeTruthy();
		// Nothing counted yet against 5,391 expected.
		expect(
			hosted.element
				.querySelector('[data-testid="closing-difference-value"]')
				?.textContent?.trim(),
		).toBe("$ -5391.00");
		// And it is NOT a second band: no action band, no second primary.
		expect(hosted.element.querySelector('[data-testid="action-band"]')).toBeNull();
		expect(hosted.element.querySelector('[data-testid="closing-submit"]')).toBeTruthy();
		hosted.unmount();
	});
});
