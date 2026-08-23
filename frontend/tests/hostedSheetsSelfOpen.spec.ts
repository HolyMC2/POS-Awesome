// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";

import { useHostedSheet } from "../src/posapp/composables/pos/shell/useHostedSheet";
import { useDialogFullscreen } from "../src/posapp/composables/core/useDialogFullscreen";
import { DESTINATION_SURFACE } from "../src/posapp/components/pos/shell/destinations/surfaceContext";

/**
 * The hosted-sheet contract (roadmap §17.7).
 *
 * The destination audit recorded `hostText: ""` for drafts, invoices, return
 * and recharge: the rail lit the item and the host rendered a component whose
 * dialog was waiting for a trigger nobody sends. These tests pin the three
 * things a hosted sheet has to do — open on mount, hand `close` up, lower its
 * store flag silently on unmount — and the one thing it must NOT do when it is
 * the floating copy: anything at all.
 *
 * Listeners are PROPS (`onClose`, `onBand`), never `wrapper.emitted()` — VTU
 * does not record component emits in this repo (see aperturaReadinessView,
 * cobroHardwareReadiness, catalogDrawerComponent for the same note).
 */

function surfaceFor(destinationId: string) {
	return {
		attachTo: ref<HTMLElement | null>(document.createElement("section")),
		destinationId: ref(destinationId),
	};
}

/** A sheet reduced to its contract: a flag, an open, a close, and `close`. */
function makeSheet(open: Ref<boolean>, calls: string[]) {
	return defineComponent({
		emits: ["close"],
		setup(_props, { emit }) {
			const hosted = useHostedSheet({
				open,
				openSheet: () => {
					calls.push("open");
					open.value = true;
				},
				closeSheet: () => {
					calls.push("closeFlag");
					open.value = false;
				},
				emit: emit as (event: "close") => void,
			});
			return () =>
				h("div", {
					"data-hosted": String(hosted.isHosted),
					"data-destination": hosted.destinationId?.value ?? "",
				});
		},
	});
}

function hostedProvide(destinationId: string) {
	return { [DESTINATION_SURFACE as symbol]: surfaceFor(destinationId) };
}

describe("useHostedSheet", () => {
	it("opens itself on mount when a destination surface is provided", async () => {
		const open = ref(false);
		const calls: string[] = [];
		const wrapper = mount(makeSheet(open, calls), {
			global: { provide: hostedProvide("drafts") },
		});
		await nextTick();

		expect(calls).toEqual(["open"]);
		expect(open.value).toBe(true);
		expect(wrapper.attributes("data-hosted")).toBe("true");
		expect(wrapper.attributes("data-destination")).toBe("drafts");
	});

	it("hands `close` to the host when its own overlay closes", async () => {
		const open = ref(false);
		const onClose = vi.fn();
		mount(makeSheet(open, []), {
			props: { onClose },
			global: { provide: hostedProvide("return") },
		});
		await nextTick();
		expect(onClose).not.toHaveBeenCalled();

		open.value = false;
		await nextTick();

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("lowers the flag on unmount WITHOUT emitting close — the host is already switching", async () => {
		const open = ref(false);
		const calls: string[] = [];
		const onClose = vi.fn();
		const wrapper = mount(makeSheet(open, calls), {
			props: { onClose },
			global: { provide: hostedProvide("invoices") },
		});
		await nextTick();
		expect(open.value).toBe(true);

		wrapper.unmount();
		await nextTick();

		expect(calls).toEqual(["open", "closeFlag"]);
		expect(open.value).toBe(false);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("does nothing at all for the floating copy", async () => {
		const open = ref(false);
		const calls: string[] = [];
		const onClose = vi.fn();
		const wrapper = mount(makeSheet(open, calls), { props: { onClose } });
		await nextTick();

		expect(wrapper.attributes("data-hosted")).toBe("false");
		expect(calls).toEqual([]);
		expect(open.value).toBe(false);

		open.value = true;
		await nextTick();
		open.value = false;
		await nextTick();
		expect(onClose).not.toHaveBeenCalled();

		wrapper.unmount();
		expect(calls).toEqual([]);
	});
});

describe("useDialogFullscreen under a destination surface", () => {
	it("teleports into the surface, CONTAINED, with no scrim and no outside-click dismissal", () => {
		const surface = surfaceFor("drafts");
		let props: Record<string, unknown> = {};
		const Probe = defineComponent({
			setup() {
				const { dialogProps } = useDialogFullscreen({ breakpoint: 1100, maxWidth: "960px" });
				props = dialogProps.value as Record<string, unknown>;
				return () => h("div");
			},
		});
		mount(Probe, { global: { provide: { [DESTINATION_SURFACE as symbol]: surface } } });

		expect(props).toEqual({
			fullscreen: false,
			attach: surface.attachTo.value,
			contained: true,
			scrim: false,
			persistent: true,
		});
	});
});

/* -------------------------------------------------------------------------- */
/* Recargas: the hand-off to the cart                                          */
/* -------------------------------------------------------------------------- */

vi.mock("../src/posapp/components/pos/recargas/useRecargasSnapshot", () => ({
	useRecargasSnapshot: () => ({
		bolsa: ref(null),
		rows: ref([]),
		catalog: ref({
			categorias: [
				{
					name: "Tiempo Aire",
					carriers: [
						{
							name: "Telcel",
							label: "Telcel",
							tipo: "0",
							products: [{ codigo: "TEL050", nombre: "Telcel $50", monto: 50 }],
						},
					],
				},
			],
		}),
		today: ref("2026-08-22"),
		loading: ref(false),
		limit: 200,
		refresh: vi.fn().mockResolvedValue(undefined),
	}),
}));

vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value).toFixed(2)}` }),
}));

import RecargasDestination from "../src/posapp/components/pos/recargas/RecargasDestination.vue";

type Handler = (payload?: unknown) => void;

function makeBus() {
	const handlers = new Map<string, Handler[]>();
	const emitted: Array<[string, unknown]> = [];
	return {
		emitted,
		emit: (event: string, payload?: unknown) => {
			emitted.push([event, payload]);
			for (const handler of handlers.get(event) ?? []) handler(payload);
		},
		on: (event: string, handler: Handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		off: (event: string, handler?: Handler) => {
			handlers.set(
				event,
				(handlers.get(event) ?? []).filter((candidate) => candidate !== handler),
			);
		},
		listeners: (event: string) => (handlers.get(event) ?? []).length,
	};
}

const READY_INTENT = {
	intent: {
		carrier: "Telcel",
		carrierLabel: "Telcel",
		reference: "5512345678",
		amount: 50,
		itemCode: "TEL050",
	},
	band: { kind: "recharge", amount: 50, carrier: "Telcel", msisdn: "5512345678", ready: true },
};

function mountDestination(bus: ReturnType<typeof makeBus>) {
	const onBand = vi.fn();
	const onClose = vi.fn();
	const wrapper = mount(RecargasDestination, {
		props: { onBand, onClose },
		global: {
			plugins: [createPinia()],
			provide: { eventBus: bus, ...hostedProvide("recharge") },
			stubs: { RecargasView: true },
		},
	});
	const view = () => wrapper.findComponent({ name: "RecargasView" });
	return { wrapper, onBand, onClose, view };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RecargasDestination", () => {
	let calls: Array<Record<string, unknown>>;

	beforeEach(() => {
		setActivePinia(createPinia());
		calls = [];
		(globalThis as any).__ = (value: string) => value;
		(globalThis as any).frappe = {
			call: vi.fn(async (options: Record<string, unknown>) => {
				calls.push(options);
				return { message: { ok: true } };
			}),
			defaults: { get_default: () => 2 },
		};
	});

	it("arms the band from every intent and listens for the band's submit", async () => {
		const bus = makeBus();
		const { wrapper, onBand, view } = mountDestination(bus);
		await nextTick();
		expect(bus.listeners("recharge:submit")).toBe(1);

		view().vm.$emit("intent", READY_INTENT);
		await nextTick();

		// At least once, and the LAST state is what the shell shows. VTU's stub
		// delivers a `$emit` through both the stub and the listener attr, so a
		// count here would measure the harness rather than the relay.
		expect(onBand).toHaveBeenCalled();
		const band = onBand.mock.calls.at(-1)![0] as { kind: string; primaryAction: { id: string } };
		expect(band.kind).toBe("recharge");
		expect(band.primaryAction.id).toBe("recharge.submit");

		wrapper.unmount();
		expect(bus.listeners("recharge:submit")).toBe(0);
	});

	it("validates with the picker's own read, hands the line over by the picker's own event, then closes", async () => {
		const bus = makeBus();
		const { onClose, view } = mountDestination(bus);
		await nextTick();
		view().vm.$emit("intent", READY_INTENT);

		bus.emit("recharge:submit");
		await flush();
		await nextTick();

		expect(calls).toEqual([
			{
				method: "saldo.api.transactions.validate_referencia",
				args: { item_code: "TEL050", referencia: "5512345678", monto: 50 },
			},
		]);
		const handoff = bus.emitted.find(([event]) => event === "saldo:picker-add");
		expect(handoff?.[1]).toEqual({
			item_code: "TEL050",
			item_name: "Telcel $50",
			rate: 50,
			price_list_rate: 50,
			saldo_referencia: "5512345678",
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("sends NOTHING to the cart when the reference fails validation", async () => {
		(globalThis as any).frappe.call = vi.fn(async () => ({
			message: { ok: false, error: "La referencia debe ser de 2-32 dígitos." },
		}));
		const bus = makeBus();
		const { onClose, view } = mountDestination(bus);
		await nextTick();
		view().vm.$emit("intent", READY_INTENT);

		bus.emit("recharge:submit");
		await flush();

		expect(bus.emitted.some(([event]) => event === "saldo:picker-add")).toBe(false);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("refuses to send an intent the band would not have enabled", async () => {
		const bus = makeBus();
		const { view } = mountDestination(bus);
		await nextTick();
		view().vm.$emit("intent", {
			intent: { ...READY_INTENT.intent, itemCode: null },
			band: { ...READY_INTENT.band, ready: false },
		});

		bus.emit("recharge:submit");
		await flush();

		expect(calls).toEqual([]);
		expect(bus.emitted.some(([event]) => event === "saldo:picker-add")).toBe(false);
	});
});
