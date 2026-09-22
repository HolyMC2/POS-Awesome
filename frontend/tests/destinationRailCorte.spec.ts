// @vitest-environment jsdom
/** The canonical closing destination owns preparation, its footer and dismissal. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

vi.mock("../src/posapp/components/pos/closing/ClosingRecovery.vue", () => ({
	default: {
		template: "<div />",
		mounted() {
			this.$emit("ready", true);
		},
	},
}));

import ClosingDialog from "../src/posapp/components/pos/shell/ClosingDialog.vue";
import { useUIStore } from "../src/posapp/stores/uiStore";
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
		{
			mode_of_payment: "Efectivo",
			opening_amount: 1500,
			expected_amount: 5391,
			closing_amount: 0,
		},
	],
});

const overviewMessage = {
	total_invoices: 31,
	company_currency: "MXN",
	cash_expected: {
		mode_of_payment: "Efectivo",
		company_currency_total: 5391,
		by_currency: [],
	},
	payments_by_mode: [],
	cash_movements: {
		count: 0,
		company_currency_total: 0,
		by_currency: [],
		by_type: [],
	},
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
								attachTo: {
									value: document.createElement("div"),
								},
								destinationId: { value: "closing" },
							},
						}
					: {}),
			},
			mocks: { __: window.__, frappe: { _: (text: string) => text } },
		},
	});

beforeEach(() => {
	// Desktop by default: the movil boundary moved to the compact band
	// (< 1100, 2026-08-26) and jsdom's 1024 default now falls inside it.
	window.innerWidth = 1440;
	setActivePinia(createPinia());
	vi.stubGlobal("__", (text: string) => text);
	vi.stubGlobal("format_number", (value: number) =>
		Number(value || 0).toFixed(2),
	);
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
	it("removes expected headers when moving to a blind-count profile", async () => {
		const ui = useUIStore();
		ui.posProfile = { name: "Visible", hide_expected_amount: 0 } as any;
		const wrapper = mountCorte(makeBus(), false);
		await nextTick();
		expect((wrapper.vm as any).headers.some((h: any) => h.value === "expected_amount")).toBe(true);
		ui.posProfile = { name: "Blind count", hide_expected_amount: 1 } as any;
		await nextTick();
		expect((wrapper.vm as any).headers.map((h: any) => h.value)).toEqual(["mode_of_payment", "opening_amount", "closing_amount"]);
		wrapper.unmount();
	});
	it("asks the shell to prepare the shift when it is hosted", async () => {
		const bus = makeBus();
		const asked: number[] = [];
		bus.on("open_shift_details", () => asked.push(1));

		const hosted = mountCorte(bus, true);
		await nextTick();

		expect(
			asked,
			"a hosted corte that never asks renders an empty surface",
		).toHaveLength(1);
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
		expect(
			(hosted.vm as unknown as { closingDialog: boolean }).closingDialog,
		).toBe(false);
		expect(closed).toHaveBeenCalledOnce();
		hosted.unmount();
	});

	it("owns one close action and difference in the hosted view", async () => {
		const bus = makeBus();
		const hosted = mountCorte(bus, true);
		bus.emit("open_ClosingDialog", closingShift());
		await nextTick();
		await nextTick();
		await nextTick();
		expect(hosted.findAll('[data-testid="band-primary"]')).toHaveLength(1);
		expect(
			hosted
				.get('[data-testid="action-band"]')
				.attributes("data-band-value"),
		).toBe("-5391");
		expect(hosted.find('[data-testid="closing-submit"]').exists()).toBe(
			false,
		);
		hosted.unmount();
	});
});
