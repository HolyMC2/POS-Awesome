// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * «Cliente» — the contact view, from the strip that opens it to the two acts
 * on it.
 *
 * WHAT THIS SUITE IS ACTUALLY GUARDING is absence. The wallet endpoints ship
 * in a sibling task and will be missing on every register that has not
 * migrated, so the interesting assertions are the ones that prove the view is
 * still worth opening when none of them answers: the story renders, the header
 * renders, and the money card is simply not drawn — no zeros, no dead
 * «Depositar», no toast about a thing the cashier cannot fix.
 *
 * Vuetify's real components cannot be registered here — the barrel import
 * pulls per-component CSS that vitest hands to node's ESM loader, the wall
 * `tests/mdiIconSet.spec.ts` documents. Stand-ins go in through
 * `global.components`, NOT through `global.stubs`, which is the same route
 * `tests/customerSelectorAffordances.spec.ts` takes and it is not a style
 * preference: these tags resolve to nothing in this environment, and VTU's
 * stub layer renders an unresolved component as an empty root — the whole
 * surface comes back as "". Registering the name instead makes
 * `resolveComponent` find the stand-in, and the component's OWN markup and
 * handlers are then what is under test.
 */

// The customers store reaches into Dexie on the way in; same stand-in as
// tests/customerSelectorAffordances.spec.ts.
vi.mock("../src/offline/index", () => ({
	db: {
		isOpen: () => true,
		open: vi.fn(async () => undefined),
		table: vi.fn(() => ({
			filter: vi.fn().mockReturnThis(),
			offset: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			toArray: vi.fn(async () => []),
		})),
	},
	checkDbHealth: vi.fn(async () => undefined),
	setCustomerStorage: vi.fn(async () => undefined),
	saveStoredValueSnapshot: vi.fn(),
	memoryInitPromise: Promise.resolve(),
	getCustomersLastSync: vi.fn(() => null),
	setCustomersLastSync: vi.fn(),
	getCustomerStorageCount: vi.fn(async () => 0),
	clearCustomerStorage: vi.fn(async () => undefined),
	isOffline: vi.fn(() => false),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));

// The formatter reaches for `frappe`, `flt` and `get_currency_symbol` globals
// and for the tenant's number system. None of that is what this suite is
// about, and a real one would make every expectation a locale assertion.
vi.mock("../src/posapp/format", () => ({
	useFormat: () => ({ formatCurrency: (value: number) => `$${Number(value || 0).toFixed(2)}` }),
}));

// `__esModule` is not decoration. Both of these are reached through
// `defineAsyncComponent(() => import(...))`, and Vue unwraps `.default` only
// when the resolved value LOOKS like an ES module; without the flag it treats
// vitest's mock namespace as the component itself and dies reading
// `__v_isVNode` off a proxy that throws for unknown exports.
//
// The CRM strip probes its own endpoint on mount and hides itself on failure.
// It is covered by tests/crmBridge.spec.ts; here it only has to exist.
vi.mock("../src/posapp/components/pos/customer/CustomerCrmStrip.vue", () => ({
	__esModule: true,
	default: { name: "CustomerCrmStrip", render: () => h("div", { class: "crm-strip-stub" }) },
}));

// The create/update modal drags in the whole address + tax graph; this suite is
// about the control that opens it.
vi.mock("../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue", () => ({
	__esModule: true,
	default: { name: "UpdateCustomer", render: () => null },
}));

const fetchCustomerWallet = vi.fn();
const fetchCashbackPreview = vi.fn();
const depositStoredValue = vi.fn();
const enrollCustomerCard = vi.fn();

vi.mock("../src/posapp/components/pos/customer/customerCardService", async () => {
	const actual = await vi.importActual<
		typeof import("../src/posapp/components/pos/customer/customerCardService")
	>("../src/posapp/components/pos/customer/customerCardService");
	return {
		...actual,
		fetchCustomerWallet: (...args: unknown[]) => fetchCustomerWallet(...args),
		fetchCashbackPreview: (...args: unknown[]) => fetchCashbackPreview(...args),
		depositStoredValue: (...args: unknown[]) => depositStoredValue(...args),
		enrollCustomerCard: (...args: unknown[]) => enrollCustomerCard(...args),
	};
});

const fetchCustomerStory = vi.fn();

// `fetchOrderStory` is listed even though nothing here calls it: `OrderStory`
// imports it by name, and a mocked module that omits an export is a proxy that
// throws the moment the binding is touched — which surfaces as an async
// component that silently never resolves.
vi.mock("../src/posapp/services/serviceOrderService", () => ({
	fetchCustomerStory: (...args: unknown[]) => fetchCustomerStory(...args),
	fetchOrderStory: vi.fn(async () => ({ events: [], truncated: false, cap: 50 })),
}));

import ClienteView from "../src/posapp/components/pos/customer/ClienteView.vue";
import { normalizeWallet } from "../src/posapp/components/pos/customer/customerCard";
import CustomerStrip from "../src/posapp/components/pos/customer/CustomerStrip.vue";
// Imported for its side effect on the module cache, not for its value: the
// strip reaches both sheets through `defineAsyncComponent(() => import(...))`,
// and a module vitest has not transformed yet takes longer than the two flushes
// a test is willing to wait — which reads as a component that never mounts.
import "../src/posapp/components/pos/customer/CustomerStory.vue";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import { useUIStore } from "../src/posapp/stores/uiStore";
import {
	registerUpdateCustomerHost,
	resetUpdateCustomerHosts,
} from "../src/posapp/components/pos/customer/updateCustomerHost";

/** A Vuetify component that is only in the way: render the slot, keep going. */
const passthrough = (name: string, tag = "div") =>
	defineComponent({
		name,
		inheritAttrs: false,
		setup(_props, { slots, attrs }) {
			return () => h(tag, { ...attrs }, slots.default?.());
		},
	});

const VBtnStub = defineComponent({
	name: "VBtn",
	inheritAttrs: false,
	props: { disabled: { type: Boolean, default: false }, loading: { type: Boolean, default: false } },
	setup(props, { slots, attrs }) {
		return () =>
			h(
				"button",
				{ ...attrs, type: "button", disabled: props.disabled || props.loading },
				slots.default?.(),
			);
	},
});

/** A field that honours `v-model`, which is the whole of what the form needs. */
const VFieldStub = (name: string) =>
	defineComponent({
		name,
		inheritAttrs: false,
		props: { modelValue: { type: [String, Number], default: "" } },
		emits: ["update:modelValue"],
		setup(props, { emit, attrs }) {
			return () =>
				h("input", {
					...attrs,
					value: props.modelValue,
					onInput: (event: Event) =>
						emit("update:modelValue", (event.target as HTMLInputElement).value),
				});
		},
	});

/**
 * The one Vuetify stand-in that has to do more than render its slot: a dialog
 * that ignored `modelValue` would make «volver» untestable, because the
 * surface would still be in the DOM after it closed.
 */
const VDialogStub = defineComponent({
	name: "VDialog",
	inheritAttrs: false,
	props: { modelValue: { type: Boolean, default: false } },
	setup(props, { slots, attrs }) {
		return () => (props.modelValue ? h("div", { ...attrs }, slots.default?.()) : null);
	},
});

const components = {
	VDialog: VDialogStub,
	VCard: passthrough("VCard"),
	VCardTitle: passthrough("VCardTitle"),
	VCardText: passthrough("VCardText"),
	VCardActions: passthrough("VCardActions"),
	VAlert: passthrough("VAlert"),
	VSpacer: passthrough("VSpacer", "span"),
	VIcon: passthrough("VIcon", "span"),
	VBtn: VBtnStub,
	VTextField: VFieldStub("VTextField"),
	VSelect: VFieldStub("VSelect"),
};

const PROFILE = {
	name: "Doco Ventas",
	company: "Doco",
	customer: "Público en General",
	posa_use_customer_cards: 1,
	payments: [{ mode_of_payment: "Cash" }, { mode_of_payment: "Card" }],
};

const EMPTY_STORY = { events: [], truncated: false, cap: 50, days: 90 };

/**
 * The wire shape, put through the REAL normalizer.
 *
 * The mock stands in for the transport and nothing else: `normalizeWallet` is
 * where a wire key becomes a row, and a fixture that skipped it would let the
 * view be tested against a shape the server never sends — the exact class of
 * defect a mock is famous for hiding. So the fixture is written the way
 * `stored_value.get_customer_wallet` actually answers, grouped objects and
 * server-side labels included, and normalized here.
 *
 * $200 of monedero and $14 of cashback: the pair that must never appear as
 * $214 anywhere on this surface.
 */
const WALLET = normalizeWallet({
	customer: "FINRECON Cliente",
	company: "Doco",
	balance: 200.0,
	deposited: 200.0,
	cashback_value: 14.0,
	enrolled: true,
	program: "Cashback Doco",
	program_name: "Cashback Doco",
	cashback_percent: 10.0,
	points: 7,
	cap: 40,
	truncated: false,
	movements: [
		{
			kind: "deposit",
			label: "Deposit",
			detail: "Efectivo",
			amount: 200.0,
			ts: "2026-08-18 11:04:22.113000",
			posting_date: "2026-08-18",
			reference: "ACC-PAY-2026-00031",
			mode_of_payment: "Efectivo",
		},
		{
			kind: "redemption",
			label: "Paid with wallet",
			detail: null,
			amount: -60.0,
			ts: "2026-08-18 12:40:02.900000",
			posting_date: "2026-08-18",
			reference: "ACC-SINV-2026-00214",
		},
		{
			kind: "cashback",
			label: "Cashback earned",
			// The server's own secondary fact on this kind is the PROGRAMME,
			// which this surface deliberately drops — see the assertion below.
			detail: "Cashback Doco",
			amount: 14.0,
			ts: "2026-08-18 12:40:03.100000",
			posting_date: "2026-08-18",
			reference: "ACC-SINV-2026-00214",
			points: 14,
		},
	],
	stored_value: { balance: 200.0, source_count: 1, sources: [] },
	cashback: { enrolled: true, program: "Cashback Doco", points: 7, value: 14.0, percent: 10.0 },
})!;

/** The same wallet on a customer who is not on the programme yet. */
const UNENROLLED = {
	...WALLET,
	enrolled: false,
	program: null,
	programName: null,
	cashbackValue: 0,
	points: 0,
	cashbackPercent: null,
};

/** Put a real customer on the ticket, on a card-enabled register. */
function seed(options: { customer?: string; profile?: Record<string, unknown> } = {}) {
	const customers = useCustomersStore();
	const ui = useUIStore();
	ui.posProfile = { ...PROFILE, ...(options.profile ?? {}) } as never;
	const name = options.customer ?? "CUST-0001";
	customers.selectedCustomer = name;
	customers.customerInfo = {
		name,
		customer_name: "Sofía Ramírez Peña",
		mobile_no: "669 112 8734",
		territory: "Escuinapa",
		// `get_customer_info` carries this since the tarjetas round.
		creation: "2025-03-14 09:12:44.201000",
	};
	return { customers, ui };
}

const mountView = () =>
	mount(ClienteView, {
		props: { modelValue: true },
		global: { components },
	});

beforeEach(() => {
	setActivePinia(createPinia());
	vi.stubGlobal("__", (value: string) => value);
	vi.clearAllMocks();
	resetUpdateCustomerHosts();
	fetchCustomerStory.mockResolvedValue({ ...EMPTY_STORY });
	fetchCustomerWallet.mockResolvedValue(null);
	fetchCashbackPreview.mockResolvedValue(null);
});

describe("the way in is the name on the ticket", () => {
	const mountStrip = (props: Record<string, unknown> = {}) =>
		mount(CustomerStrip, {
			props: { customerName: "Sofía Ramírez Peña", ...props },
			global: { components },
		});

	it("opens the person's file in one tap on the name", async () => {
		seed();
		const strip = mountStrip();
		await flushPromises();

		// Nothing is fetched and no chunk is loaded until it is asked for: the
		// strip renders on every sale, the file is opened on a few of them.
		expect(strip.find('[data-testid="cliente-view"]').exists()).toBe(false);
		expect(fetchCustomerWallet).not.toHaveBeenCalled();

		await strip.find('[data-testid="customer-strip-name"]').trigger("click");
		await flushPromises();

		expect(strip.find('[data-testid="cliente-view"]').exists()).toBe(true);
		expect(strip.find('[data-testid="cliente-view-name"]').text()).toBe("Sofía Ramírez Peña");
	});

	it("closes back onto the same sale", async () => {
		seed();
		const strip = mountStrip();
		await strip.find('[data-testid="customer-strip-name"]').trigger("click");
		await flushPromises();

		await strip.find('[data-testid="cliente-view-back"]').trigger("click");
		await flushPromises();

		expect(strip.find('[data-testid="cliente-view"]').exists()).toBe(false);
		// The ticket is untouched — nothing about the sale went through here.
		expect(strip.find('[data-testid="customer-strip-name"]').text()).toBe("Sofía Ramírez Peña");
	});

	it("leaves «historial» and «cambiar» doing exactly what they did", async () => {
		seed();
		const onChange = vi.fn();
		const strip = mountStrip({ onChange });

		await strip.find('[data-testid="customer-strip-history"]').trigger("click");
		// Twice: the history sheet's own import chain is one level deeper than
		// the contact view's, and a single flush leaves the async placeholder
		// on screen — which reads exactly like a component that never mounted.
		await flushPromises();
		await flushPromises();
		// The quick glance still opens its own dialog, and NOT the file.
		expect(strip.find('.customer-story').exists()).toBe(true);
		expect(strip.find('[data-testid="cliente-view"]').exists()).toBe(false);

		await strip.find('[data-testid="customer-strip-change"]').trigger("click");
		expect(onChange).toHaveBeenCalled();
	});
});

describe("the walk-in identity is refused, gently", () => {
	it("says what it is and what to do instead", async () => {
		seed({ customer: "Público en General" });
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-view-refusal"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-story"]').exists()).toBe(false);
		expect(view.text()).toContain("Choose a customer on the ticket first.");
	});

	it("asks the server nothing about a customer that is not one", async () => {
		seed({ customer: "Público en General" });
		mountView();
		await flushPromises();

		expect(fetchCustomerWallet).not.toHaveBeenCalled();
	});
});

describe("every wallet element degrades to absence", () => {
	it("keeps the story and the header when the wallet endpoint is missing", async () => {
		// The register that has not migrated yet: `get_customer_wallet` 404s,
		// the service swallows it, and the view is still the answer to «who is
		// this person».
		fetchCustomerWallet.mockResolvedValue(null);
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet"]').exists()).toBe(false);
		expect(view.find('[data-testid="cliente-story"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-view-name"]').text()).toBe("Sofía Ramírez Peña");
	});

	it("draws no card-state chip at all rather than «Sin tarjeta»", async () => {
		fetchCustomerWallet.mockResolvedValue(null);
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-view-card-chip"]').exists()).toBe(false);
	});

	it("never asks when the register's profile has no card flag", async () => {
		seed({ profile: { posa_use_customer_cards: 0 } });
		const view = mountView();
		await flushPromises();

		expect(fetchCustomerWallet).not.toHaveBeenCalled();
		expect(view.find('[data-testid="cliente-wallet"]').exists()).toBe(false);
		expect(view.find('[data-testid="cliente-story"]').exists()).toBe(true);
	});

	it("drops the accrual line when the preview endpoint says nothing", async () => {
		// `walletSummary.ts`'s socket: no server figure, no claim. The rest of
		// the card — balance, movements, «puede pagar hasta» — still renders.
		fetchCustomerWallet.mockResolvedValue(WALLET);
		fetchCashbackPreview.mockResolvedValue(null);
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-next"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-wallet-accrual"]').exists()).toBe(false);
		expect(view.find('[data-testid="cliente-wallet-balance"]').text()).toBe("$200.00");
	});

	it("keeps the wallet card when the STORY endpoint is the one that fails", async () => {
		fetchCustomerWallet.mockResolvedValue(WALLET);
		fetchCustomerStory.mockRejectedValue({ message: "No se pudo leer el historial." });
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-story-error"]').text()).toContain(
			"No se pudo leer el historial.",
		);
	});
});

describe("the wallet card, once there is a wallet", () => {
	beforeEach(() => {
		fetchCustomerWallet.mockResolvedValue(WALLET);
		fetchCashbackPreview.mockResolvedValue({ points: 15, value: 15 });
	});

	it("prints the monedero as the headline and the cashback apart from it", async () => {
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-balance"]').text()).toBe("$200.00");
		expect(view.find('[data-testid="cliente-wallet-cashback"]').text()).toBe(
			"Cashback Doco, kept apart · $14.00 · 7 points",
		);
		expect(view.find('[data-testid="cliente-wallet-rate"]').text()).toBe("Cashback 10%");
		expect(view.find('[data-testid="cliente-view-card-chip"]').text()).toBe("Active card");
	});

	it("never shows the two as one figure, anywhere on the surface", async () => {
		// THE guardrail (`CUSTOMER_CARDS_GOLDEN_FLOW.md` §4). $200 of monedero
		// plus $14 of cashback is not $214 of anything: the cashback has to be
		// redeemed through the programme, and a counter that read $214 off this
		// screen would promise money the tender cannot take.
		seed();
		const view = mountView();
		await flushPromises();

		// Matched as a FIGURE, not as digits: a bare "214" also occurs inside
		// the invoice folio ACC-SINV-2026-00214, and an assertion that cried
		// wolf on a document number would be muted within a week.
		expect(view.text()).not.toContain("$214");
		// And what the customer can actually hand over is the monedero alone.
		expect(view.find('[data-testid="cliente-wallet-next"]').text()).toContain("$200.00");
	});

	it("stays silent about cashback a customer has not earned yet", async () => {
		// An enrolled customer with nothing accrued: «$0.00 de cashback» reads
		// as a programme that does not pay, which is worse than saying nothing.
		fetchCustomerWallet.mockResolvedValue({ ...WALLET, cashbackValue: 0, points: 0 });
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-cashback"]').exists()).toBe(false);
		expect(view.find('[data-testid="cliente-wallet-balance"]').text()).toBe("$200.00");
	});

	it("draws the ledger with the signs the server sent", async () => {
		seed();
		const view = mountView();
		await flushPromises();

		const rows = view.findAll('[data-testid="cliente-wallet-movement"]');
		expect(rows).toHaveLength(3);
		expect(rows[0]?.text()).toContain("+$200.00");
		expect(rows[0]?.text()).toContain("Efectivo");
		expect(rows[1]?.text()).toContain("−$60.00");
		expect(rows[2]?.text()).toContain("+$14.00");
	});

	it("names the programme once, not once per cashback row", async () => {
		// §3 asks for the programme name on an enrolled card, and the server
		// puts it on every cashback row's `detail`. Down a column it is the
		// same word repeated, so it lives on the summary line instead.
		seed();
		const view = mountView();
		await flushPromises();

		for (const row of view.findAll('[data-testid="cliente-wallet-movement"]')) {
			expect(row.text()).not.toContain("Cashback Doco");
		}
		expect(view.find('[data-testid="cliente-wallet-cashback"]').text()).toContain(
			"Cashback Doco",
		);
	});

	it("says what happened once, not twice", async () => {
		// The server labels every row too («Deposit», already translated).
		// Rendering both its label and ours would print the same words twice.
		seed();
		const view = mountView();
		await flushPromises();

		const deposit = view.findAll('[data-testid="cliente-wallet-movement"]')[0]!;
		expect(deposit.text().match(/Deposit/g) ?? []).toHaveLength(1);
		// And the server's own label for the cashback row never appears.
		expect(view.text()).not.toContain("Cashback earned");
	});

	it("states the cap on screen, the way the story does", async () => {
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-cap"]').text()).toBe("Last 40");
	});

	it("names when this person became a customer, to the month", async () => {
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-view-subline"]').text()).toBe(
			"Customer since mar 2025 · Escuinapa",
		);
	});
});

describe("depositing", () => {
	beforeEach(() => {
		fetchCustomerWallet.mockResolvedValue(WALLET);
	});

	const openDeposit = async () => {
		seed();
		const view = mountView();
		await flushPromises();
		await view.find('[data-testid="cliente-wallet-deposit"]').trigger("click");
		await flushPromises();
		return view;
	};

	it("posts the amount and the tender, then re-reads the wallet", async () => {
		depositStoredValue.mockResolvedValue({});
		const view = await openDeposit();

		await view.find('[data-testid="cliente-deposit-amount"]').setValue("200");
		await view.find('[data-testid="cliente-deposit-submit"]').trigger("click");
		await flushPromises();

		expect(depositStoredValue).toHaveBeenCalledWith("Doco Ventas", "CUST-0001", 200, "Cash");
		// Twice: once on open, once because the deposit moved the balance. The
		// figure on screen is the one the server holds, never a local sum.
		expect(fetchCustomerWallet).toHaveBeenCalledTimes(2);
	});

	it("defaults the tender to the profile's first, not to nothing", async () => {
		const view = await openDeposit();
		expect(
			(view.find('[data-testid="cliente-deposit-mode"]').element as HTMLInputElement).value,
		).toBe("Cash");
	});

	it("reads a typed «1,200» as one thousand two hundred", async () => {
		// A `type="number"` input yields "" for this, and a deposit that
		// quietly becomes zero is the failure with cash already on the counter.
		depositStoredValue.mockResolvedValue({});
		const view = await openDeposit();

		await view.find('[data-testid="cliente-deposit-amount"]').setValue("$1,200");
		await view.find('[data-testid="cliente-deposit-submit"]').trigger("click");
		await flushPromises();

		expect(depositStoredValue).toHaveBeenCalledWith("Doco Ventas", "CUST-0001", 1200, "Cash");
	});

	it("refuses a zero without asking the server", async () => {
		const view = await openDeposit();

		await view.find('[data-testid="cliente-deposit-amount"]').setValue("0");
		await view.find('[data-testid="cliente-deposit-submit"]').trigger("click");
		await flushPromises();

		expect(depositStoredValue).not.toHaveBeenCalled();
		expect(view.find('[data-testid="cliente-deposit-error"]').exists()).toBe(true);
	});

	it("prints the server's refusal verbatim and keeps the amount", async () => {
		// A frappe throw carries its sentence in `_server_messages`, which
		// `api.call` has already lifted onto the error's `message`.
		depositStoredValue.mockRejectedValue({ message: "El turno de esta caja está cerrado." });
		const view = await openDeposit();

		await view.find('[data-testid="cliente-deposit-amount"]').setValue("200");
		await view.find('[data-testid="cliente-deposit-submit"]').trigger("click");
		await flushPromises();

		expect(view.find('[data-testid="cliente-deposit-error"]').text()).toBe(
			"El turno de esta caja está cerrado.",
		);
		expect(
			(view.find('[data-testid="cliente-deposit-amount"]').element as HTMLInputElement).value,
		).toBe("200");
		// The wallet was NOT re-read: nothing moved.
		expect(fetchCustomerWallet).toHaveBeenCalledTimes(1);
	});
});

describe("activating the card", () => {
	it("offers «Activar» only while the customer is not enrolled", async () => {
		fetchCustomerWallet.mockResolvedValue(UNENROLLED);
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-enroll"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-view-card-chip"]').text()).toBe("No card");
		// The money is real without a programme: the balance and «Depositar»
		// stay, because a customer can hold monedero and earn nothing.
		expect(view.find('[data-testid="cliente-wallet-balance"]').exists()).toBe(true);
		expect(view.find('[data-testid="cliente-wallet-deposit"]').exists()).toBe(true);
	});

	it("enrols through the register's own profile, then re-reads", async () => {
		fetchCustomerWallet.mockResolvedValue(UNENROLLED);
		enrollCustomerCard.mockResolvedValue({});
		seed();
		const view = mountView();
		await flushPromises();

		await view.find('[data-testid="cliente-wallet-enroll"]').trigger("click");
		await flushPromises();

		// The programme is NEVER passed from the client: which one a shop runs
		// is a profile decision, and a client that could name one could enrol a
		// customer into somebody else's.
		expect(enrollCustomerCard).toHaveBeenCalledWith("Doco Ventas", "CUST-0001");
		expect(fetchCustomerWallet).toHaveBeenCalledTimes(2);
	});

	it("prints the refusal in place — usually a profile with no programme", async () => {
		fetchCustomerWallet.mockResolvedValue(UNENROLLED);
		enrollCustomerCard.mockRejectedValue({
			message: "Esta caja no tiene programa de cashback configurado.",
		});
		seed();
		const view = mountView();
		await flushPromises();

		await view.find('[data-testid="cliente-wallet-enroll"]').trigger("click");
		await flushPromises();

		expect(view.find('[data-testid="cliente-wallet-enroll-error"]').text()).toBe(
			"Esta caja no tiene programa de cashback configurado.",
		);
	});

	it("does not ask for an accrual preview for a customer with no programme", async () => {
		fetchCustomerWallet.mockResolvedValue(UNENROLLED);
		seed();
		mountView();
		await flushPromises();

		expect(fetchCashbackPreview).not.toHaveBeenCalled();
	});
});

describe("«Editar datos» reaches the editor that already exists", () => {
	it("supplies an editor only where nothing else is drawing one", async () => {
		// The mobile sale screen mounts no `Customer.vue`, so this view has to
		// bring the form itself or the button is dead.
		fetchCustomerWallet.mockResolvedValue(null);
		seed();
		const view = mountView();
		await flushPromises();

		expect(view.findComponent({ name: "UpdateCustomer" }).exists()).toBe(false);
		await view.find('[data-testid="cliente-view-edit"]').trigger("click");
		await flushPromises();
		await flushPromises();
		expect(view.findComponent({ name: "UpdateCustomer" }).exists()).toBe(true);
	});

	it("stays out of the way when the sale already hosts one", async () => {
		// The desktop sale: `Customer.vue` is mounted behind the Sale details
		// disclosure and answers the same store flag. A second copy here would
		// put two identical dialogs on screen, on the same flag, at once.
		const release = registerUpdateCustomerHost();
		try {
			fetchCustomerWallet.mockResolvedValue(null);
			seed();
			const view = mountView();
			await flushPromises();

			await view.find('[data-testid="cliente-view-edit"]').trigger("click");
			await flushPromises();
			await flushPromises();

			expect(view.findComponent({ name: "UpdateCustomer" }).exists()).toBe(false);
			// The flag still went up — the sale's own host is what answers it.
			expect(useCustomersStore().isUpdateCustomerDialogOpen).toBe(true);
		} finally {
			release();
		}
	});

	it("opens the update dialog on the customer whose file is on screen", async () => {
		fetchCustomerWallet.mockResolvedValue(null);
		const { customers } = seed();
		const view = mountView();
		await flushPromises();

		await view.find('[data-testid="cliente-view-edit"]').trigger("click");

		expect(customers.isUpdateCustomerDialogOpen).toBe(true);
		// The current customer, not `null`: `null` opens a blank new-customer
		// form and loses the person being looked at.
		expect((customers.customerToUpdate as { name?: string } | null)?.name).toBe("CUST-0001");
	});
});
