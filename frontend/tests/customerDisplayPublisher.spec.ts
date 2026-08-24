// @vitest-environment jsdom

/**
 * What the register is allowed to tell the customer's screen.
 *
 * `useCustomerDisplayPublisher` is the only thing that fills the transport, so
 * this file is where the display's absence rules become enforceable. The
 * display's own five spec files prove that a snapshot carrying `cashback_earned`
 * renders an accrual card; nothing there can prove that a snapshot for a
 * walk-in customer does not carry one, because the component never sees the
 * register that built it.
 *
 * Every assertion below is about ABSENCE — `toHaveProperty` on a key rather
 * than a value, because the whole contract turns on the difference between a
 * field that says zero and a field that is not there. `docs/PANTALLA_CLIENTE_GOLDEN_FLOW.md`
 * §1: "only for enrolled customers on card-enabled registers — absence, not
 * zeros".
 *
 * The publisher is a composable with `onMounted` and watchers, so it is driven
 * through a host component and the real Pinia stores rather than mocks: the
 * fields it publishes are read off `invoiceDoc.payments`, `customerInfo` and
 * `uiStore.paymentDialogOpen`, and a mock of those would prove the test's
 * shape rather than the register's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";

import {
	CUSTOMER_DISPLAY_CHANNEL_SESSION_KEY,
	getCustomerDisplayStorageKey,
	type CustomerDisplaySnapshot,
} from "../src/posapp/utils/customerDisplay";
import {
	setCustomerDisplayCashbackPreview,
	useCustomerDisplayPublisher,
} from "../src/posapp/composables/pos/shared/useCustomerDisplayPublisher";
import { resolveDisplayView } from "../src/posapp/components/customer_display/displayModel";
import { useInvoiceStore } from "../src/posapp/stores/invoiceStore";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const CHANNEL = "cd_spec";

/** mitt's surface, minus everything this composable does not use. */
const createBus = () => {
	const handlers = new Map<string, Set<(_payload?: any) => void>>();
	return {
		on(event: string, handler: (_payload?: any) => void) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(handler);
		},
		off(event: string, handler: (_payload?: any) => void) {
			handlers.get(event)?.delete(handler);
		},
		emit(event: string, payload?: any) {
			handlers.get(event)?.forEach((handler) => handler(payload));
		},
	};
};

const enabledProfile = (overrides: Record<string, any> = {}) => ({
	posa_enable_customer_display: 1,
	posa_auto_open_customer_display: 0,
	currency: "MXN",
	company: "Docomexico",
	...overrides,
});

let wrapper: VueWrapper<any> | null = null;
let bus: ReturnType<typeof createBus>;
let posProfile: ReturnType<typeof ref<any>>;

const mountPublisher = (profile: Record<string, any> = enabledProfile()) => {
	posProfile = ref(profile);
	bus = createBus();
	const host = defineComponent({
		setup() {
			useCustomerDisplayPublisher({ posProfile: posProfile as any, eventBus: bus });
			return () => h("div");
		},
	});
	wrapper = mount(host);
};

/** The snapshot as it actually crossed the window, read back off the mirror. */
const published = (): CustomerDisplaySnapshot | null => {
	const raw = window.localStorage.getItem(getCustomerDisplayStorageKey(CHANNEL));
	if (!raw) return null;
	return JSON.parse(raw).payload as CustomerDisplaySnapshot;
};

/** Let the watchers run, then let the 80 ms publish debounce fire. */
const settle = async () => {
	await nextTick();
	vi.advanceTimersByTime(200);
	await nextTick();
};

const plainLine = (overrides: Record<string, any> = {}) => ({
	posa_row_id: "row-plain",
	item_code: "MICA-9H",
	item_name: "Mica 9H",
	qty: 1,
	rate: 120,
	uom: "Nos",
	...overrides,
});

const comboLine = (overrides: Record<string, any> = {}) => ({
	posa_row_id: "row-combo",
	item_code: "COMBO-PROT",
	item_name: "Combo Protección",
	qty: 1,
	rate: 299,
	uom: "Nos",
	posa_combo_components: [
		{ item_code: "FUNDA", item_name: "Funda", qty: 1, rate: 180 },
		{ item_code: "MICA-9H", item_name: "Mica 9H", qty: 1, rate: 120 },
		{ item_code: "INSTAL", item_name: "Instalación", qty: 1, rate: 78 },
	],
	...overrides,
});

/** A sale with money keyed on an armed pay surface. */
const armTender = (received: number, total: number) => {
	const invoiceStore = useInvoiceStore();
	const uiStore = useUIStore();
	invoiceStore.setInvoiceDoc({
		currency: "MXN",
		rounded_total: total,
		grand_total: total,
		payments: [{ mode_of_payment: "Cash", amount: received }],
	} as any);
	uiStore.openPaymentDialog();
};

beforeEach(() => {
	vi.useFakeTimers();
	// `invoiceStore` reads the desk's date at store-creation time.
	(globalThis as any).frappe = {
		datetime: {
			nowdate: () => "2026-08-23",
			now_datetime: () => "2026-08-23 10:00:00",
		},
		show_alert: () => undefined,
	};
	setActivePinia(createPinia());
	window.localStorage.clear();
	window.sessionStorage.clear();
	window.sessionStorage.setItem(CUSTOMER_DISPLAY_CHANNEL_SESSION_KEY, CHANNEL);
	setCustomerDisplayCashbackPreview(null);
	(globalThis as any).__ = (text: string) => text;
});

afterEach(() => {
	wrapper?.unmount();
	wrapper = null;
	vi.useRealTimers();
	delete (globalThis as any).__;
	delete (globalThis as any).frappe;
});

describe("the accrual crosses only when the register holds every fact", () => {
	// The one field on this screen that is about the customer rather than about
	// the sale. §1 admits it for "enrolled customers on card-enabled
	// registers"; each test below removes exactly one of those conditions.
	const enrol = () => {
		const customersStore = useCustomersStore();
		customersStore.customerInfo = {
			customer_name: "Sofía",
			loyalty_program: "Monedero Doco",
			loyalty_points: 4000,
			conversion_factor: 0.1,
		} as any;
	};

	it("publishes the accrual and where the card lands for an enrolled customer", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 1 }));
		enrol();
		useInvoiceStore().setItems([plainLine()]);
		setCustomerDisplayCashbackPreview(15);
		await settle();

		const snapshot = published()!;
		expect(snapshot.cashback_earned).toBe(15);
		// 4000 points × 0.1 = $400 on the loyalty wallet, plus what this sale
		// adds. Both halves were read; neither was assumed.
		expect(snapshot.cashback_balance_after).toBe(415);
	});

	it("says nothing about a card for an unenrolled walk-in", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 1 }));
		useCustomersStore().customerInfo = { customer_name: "Walk-in" } as any;
		useInvoiceStore().setItems([plainLine()]);
		setCustomerDisplayCashbackPreview(15);
		await settle();

		const snapshot = published()!;
		expect(snapshot).not.toHaveProperty("cashback_earned");
		expect(snapshot).not.toHaveProperty("cashback_balance_after");
	});

	it("says nothing about a card on a register with cards switched off", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 0 }));
		enrol();
		useInvoiceStore().setItems([plainLine()]);
		setCustomerDisplayCashbackPreview(15);
		await settle();

		expect(published()).not.toHaveProperty("cashback_earned");
	});

	it("omits the field rather than publishing a zero when no preview came back", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 1 }));
		enrol();
		useInvoiceStore().setItems([plainLine()]);
		// What `get_cashback_preview` answers for an offline sale, a refusal, or
		// a customer the programme does not cover.
		setCustomerDisplayCashbackPreview(null);
		await settle();

		const snapshot = published()!;
		expect(snapshot).not.toHaveProperty("cashback_earned");
		expect(snapshot.cashback_earned).toBeUndefined();
	});

	it("publishes the accrual without a balance when the loyalty wallet is unknown", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 1 }));
		useCustomersStore().customerInfo = {
			loyalty_program: "Monedero Doco",
			// No points and no conversion factor: `get_customer_info` returns
			// them only sometimes, and a balance is not something to guess at
			// somebody's wallet.
		} as any;
		useInvoiceStore().setItems([plainLine()]);
		setCustomerDisplayCashbackPreview(15);
		await settle();

		const snapshot = published()!;
		expect(snapshot.cashback_earned).toBe(15);
		expect(snapshot).not.toHaveProperty("cashback_balance_after");
	});
});

describe("the tender crosses only once money has been received", () => {
	it("publishes nothing about money before the pay surface is armed", async () => {
		mountPublisher();
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([plainLine()]);
		invoiceStore.setInvoiceDoc({
			rounded_total: 120,
			payments: [{ mode_of_payment: "Cash", amount: 500 }],
		} as any);
		await settle();

		const snapshot = published()!;
		expect(snapshot).not.toHaveProperty("received_amount");
		expect(snapshot).not.toHaveProperty("change_amount");
		expect(snapshot).not.toHaveProperty("stage");
	});

	it("calls it tender when the pay surface arms, with no figures yet", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		armTender(0, 120);
		await settle();

		const snapshot = published()!;
		expect(snapshot.stage).toBe("tender");
		// Zero keyed is the ABSENCE of a tender written as a number. A
		// «Recibido $0.00» card in front of someone who has not paid is a
		// statement about their money that is not true.
		expect(snapshot).not.toHaveProperty("received_amount");
		expect(snapshot).not.toHaveProperty("change_amount");
	});

	it("publishes what was handed over and what is owed back", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		armTender(500, 348);
		await settle();

		const snapshot = published()!;
		expect(snapshot.stage).toBe("tender");
		expect(snapshot.received_amount).toBe(500);
		expect(snapshot.change_amount).toBe(152);
	});

	it("stays silent about change when there is none to give", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		armTender(348, 348);
		await settle();

		const snapshot = published()!;
		expect(snapshot.received_amount).toBe(348);
		expect(snapshot).not.toHaveProperty("change_amount");
	});
});

describe("done is declared by the register, never inferred from an empty cart", () => {
	it("says «gracias» on a submitted sale and holds it through the clear", async () => {
		mountPublisher();
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([plainLine()]);
		armTender(500, 348);
		await settle();

		// What `usePaymentSubmission` emits once the server has booked the
		// change Payment Entry.
		bus.emit("show_change_due", { amount: 152, currency: "MXN" });
		expect(published()!.stage).toBe("done");

		// …and the invoice is cleared a few statements later, on the same path.
		invoiceStore.clear();
		invoiceStore.setInvoiceDoc(null);
		bus.emit("clear_invoice");
		await settle();

		const snapshot = published()!;
		expect(snapshot.stage).toBe("done");
		expect(snapshot.change_amount).toBe(152);
		expect(snapshot.received_amount).toBe(500);
		// The basket the customer just paid for is still on the screen rather
		// than blanking behind the thank-you.
		expect(snapshot.items).toHaveLength(1);
	});

	it("goes idle, not done, when a sale is voided", async () => {
		mountPublisher();
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([plainLine()]);
		await settle();

		// A void empties the cart by exactly the same route a completed sale
		// does. Printing «Gracias» at a customer whose sale the cashier just
		// cancelled is a lie with their money in it.
		invoiceStore.clear();
		bus.emit("clear_invoice");
		await settle();

		const snapshot = published()!;
		expect(snapshot.stage).toBe("idle");
		expect(snapshot.items).toHaveLength(0);
	});

	it("returns to the greeting after the thank-you has been read", async () => {
		mountPublisher();
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([plainLine()]);
		armTender(500, 348);
		await settle();

		bus.emit("show_change_due", { amount: 152 });
		expect(published()!.stage).toBe("done");

		// The rest of the completion, in the order the register runs it.
		useUIStore().closePaymentDialog();
		invoiceStore.clear();
		invoiceStore.setInvoiceDoc(null);
		bus.emit("clear_invoice");
		await settle();
		expect(published()!.stage).toBe("done");

		// §1: "Done → back to Idle". Nobody else owns that transition.
		vi.advanceTimersByTime(12000);
		await nextTick();
		expect(published()!.stage).toBe("idle");
	});

	it("ends the thank-you as soon as the next sale starts", async () => {
		mountPublisher();
		const invoiceStore = useInvoiceStore();
		invoiceStore.setItems([plainLine()]);
		armTender(500, 348);
		await settle();
		bus.emit("show_change_due", { amount: 152 });

		// The pay surface closed with the sale; the next scan lands on a fresh cart.
		useUIStore().closePaymentDialog();
		invoiceStore.setInvoiceDoc(null);
		invoiceStore.setItems([plainLine({ posa_row_id: "row-next", item_name: "Cable USB-C" })]);
		await settle();

		const snapshot = published()!;
		expect(snapshot).not.toHaveProperty("stage");
		expect(snapshot.items[0]!.item_name).toBe("Cable USB-C");
	});
});

describe("a line says what it is worth, and an ordinary line says nothing extra", () => {
	it("carries the combo's parts and its saving", async () => {
		mountPublisher();
		useInvoiceStore().setItems([comboLine()]);
		await settle();

		const line = published()!.items[0]!;
		// The parts are what make the saving beside them worth reading, and
		// they are customer-facing names by construction — never the SKU.
		expect(line.note).toBe("Funda · Mica 9H · Instalación");
		expect(line.saving).toBe(79);
	});

	it("multiplies the saving by the quantity sold", async () => {
		mountPublisher();
		useInvoiceStore().setItems([comboLine({ qty: 2 })]);
		await settle();

		expect(published()!.items[0]!.saving).toBe(158);
	});

	it("carries neither on a plain line", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		await settle();

		const line = published()!.items[0]!;
		expect(line).not.toHaveProperty("note");
		expect(line).not.toHaveProperty("saving");
	});

	it("drops both when the combo is broken", async () => {
		mountPublisher();
		useInvoiceStore().setItems([comboLine({ posa_combo_broken: 1 })]);
		await settle();

		const line = published()!.items[0]!;
		expect(line).not.toHaveProperty("note");
		expect(line).not.toHaveProperty("saving");
	});
});

describe("round trip: what the register publishes is what the screen resolves", () => {
	// The two halves were built against the same interface but never against
	// each other. A publisher that spelled a field `cashbackEarned` would pass
	// every test above and light nothing up.
	it("resolves tender, and the accrual, off a real published snapshot", async () => {
		mountPublisher(enabledProfile({ posa_use_customer_cards: 1 }));
		useCustomersStore().customerInfo = {
			loyalty_program: "Monedero Doco",
			loyalty_points: 4000,
			conversion_factor: 0.1,
		} as any;
		useInvoiceStore().setItems([comboLine()]);
		armTender(500, 348);
		setCustomerDisplayCashbackPreview(15);
		await settle();

		const view = resolveDisplayView(published());

		expect(view.state).toBe("tender");
		expect(view.tender).toEqual({ received: 500, change: 152 });
		expect(view.accrual).toEqual({ earned: 15, balanceAfter: 415 });
		expect(view.lines[0]!.note).toBe("Funda · Mica 9H · Instalación");
		expect(view.lines[0]!.saving).toBe(79);
	});

	it("resolves done off the snapshot the completion froze", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		armTender(500, 348);
		await settle();
		bus.emit("show_change_due", { amount: 152 });

		const view = resolveDisplayView(published());
		expect(view.state).toBe("done");
		expect(view.tender?.change).toBe(152);
	});

	it("resolves idle off a cleared register", async () => {
		mountPublisher();
		useInvoiceStore().setItems([plainLine()]);
		await settle();
		useInvoiceStore().clear();
		bus.emit("clear_invoice");
		await settle();

		const view = resolveDisplayView(published());
		expect(view.state).toBe("idle");
		expect(view.tender).toBeNull();
		expect(view.accrual).toBeNull();
	});
});
