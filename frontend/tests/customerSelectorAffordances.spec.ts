// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createVuetify } from "vuetify";

// The store reaches into Dexie on the way in; same stand-in as
// tests/customersStore.spec.ts.
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

// The create/update modal drags in the whole address + tax graph; this suite
// is about the control that opens it, not the modal.
vi.mock("../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue", () => ({
	default: { name: "UpdateCustomer", render: () => null },
}));

vi.mock("../src/posapp/modules/customers/customerLoadingCoordinator", () => ({
	ensureCustomersReady: vi.fn(async () => undefined),
}));

import Customer from "../src/posapp/components/pos/customer/Customer.vue";
import { useCustomersStore } from "../src/posapp/stores/customersStore";

// Vuetify's real components cannot be registered here — the barrel import
// pulls per-component .css that vitest hands to node's ESM loader, the same
// wall tests/mdiIconSet.spec.ts documents. The one component this suite has to
// exercise for real is the autocomplete, because `focusCustomerSearch` drives
// it through its instance (`menu`), its method (`focus`) and its DOM
// (`$el.querySelector("input")`). This stand-in honours all three, so the tap
// path under test is the component's own code, not Vuetify's.
const VAutocompleteStub = defineComponent({
	name: "VAutocomplete",
	props: {
		modelValue: { type: [String, Object], default: null },
		disabled: { type: Boolean, default: false },
	},
	emits: ["update:modelValue", "update:menu", "update:search"],
	data: () => ({ menu: false }),
	watch: {
		menu(value: boolean) {
			this.$emit("update:menu", value);
		},
	},
	methods: {
		focus() {
			(this.$el as HTMLElement).querySelector("input")?.focus();
		},
	},
	render() {
		return h("div", { class: "v-field" }, [
			h("input", {
				class: "v-field__input",
				disabled: this.disabled,
			}),
		]);
	},
});

// The dropdown's own rows are teleported out of the wrapper; their labels are
// pinned at source level in tests/touchTargetSweep.spec.ts, which reads this
// component under the node environment (jsdom shims node:fs away).

/** Mitt stand-in — the component registers `set_customer_readonly` on mount. */
const makeBus = () => {
	const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
	return {
		on: (event: string, fn: (payload?: unknown) => void) => {
			(handlers[event] ||= []).push(fn);
		},
		off: (event: string, fn: (payload?: unknown) => void) => {
			handlers[event] = (handlers[event] ?? []).filter((h) => h !== fn);
		},
		emit: (event: string, payload?: unknown) => {
			for (const fn of handlers[event] ?? []) fn(payload);
		},
	};
};

const mountCustomer = (eventBus = makeBus()) =>
	mount(Customer, {
		attachTo: document.body,
		global: {
			plugins: [createVuetify()],
			components: { VAutocomplete: VAutocompleteStub },
			config: {
				globalProperties: {
					__: (value: string) => value,
					frappe: (globalThis as never as { frappe: unknown }).frappe,
					eventBus,
				},
			},
		},
	});

/** Labelled action buttons, in render order. */
const actionLabels = (wrapper: ReturnType<typeof mountCustomer>) =>
	wrapper.findAll(".customer-action-btn").map((button) => button.text());

describe("customer selector affordances", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			_: (value: string) => value,
			call: vi.fn(),
		});
	});

	it("names the create action instead of showing a bare +", async () => {
		// "+ is no obvious its to create a new one" — every cashier on the
		// fleet had to be told what the glyph did.
		const wrapper = mountCustomer();
		await flushPromises();

		expect(actionLabels(wrapper)).toContain("New Customer");
		wrapper.unmount();
	});

	it("shows the edit affordance only once a customer is selected", async () => {
		const wrapper = mountCustomer();
		await flushPromises();
		const store = useCustomersStore();

		expect(actionLabels(wrapper)).not.toContain("Edit");

		store.setSelectedCustomer("CUST-001");
		await flushPromises();

		expect(actionLabels(wrapper)).toContain("Edit");
		wrapper.unmount();
	});

	it("opens the create dialog from the labelled button", async () => {
		const wrapper = mountCustomer();
		await flushPromises();
		const store = useCustomersStore();
		const open = vi.spyOn(store, "openUpdateCustomerDialog");

		await wrapper.find(".customer-action-btn--new").trigger("click");

		expect(open).toHaveBeenCalledWith(null);
		wrapper.unmount();
	});

	it("opens the edit dialog on the selected customer's own record", async () => {
		const wrapper = mountCustomer();
		await flushPromises();
		const store = useCustomersStore();
		store.setSelectedCustomer("CUST-001");
		store.setCustomerInfo({ name: "CUST-001", customer_name: "Jane Doe" });
		await flushPromises();
		const open = vi.spyOn(store, "openUpdateCustomerDialog");

		await wrapper.find(".customer-action-btn--edit").trigger("click");

		expect(open).toHaveBeenCalledWith(
			expect.objectContaining({ name: "CUST-001" }),
		);
		wrapper.unmount();
	});

	it("puts the caret in the search from a tap anywhere on the field", async () => {
		// Before: the clear-x was the only reliably tappable thing in the
		// row, so "tap the x" was how the fleet searched.
		const wrapper = mountCustomer();
		await flushPromises();

		await wrapper.find(".customer-field-shell").trigger("click");
		await flushPromises();

		const input = wrapper.find("input");
		expect(document.activeElement).toBe(input.element);
		wrapper.unmount();
	});

	it("opens the list on that same tap, not only the caret", async () => {
		const wrapper = mountCustomer();
		await flushPromises();

		await wrapper.find(".customer-field-shell").trigger("click");
		await flushPromises();

		expect(wrapper.findComponent(VAutocompleteStub).vm.menu).toBe(true);
		wrapper.unmount();
	});

	it("leaves the field alone while a return has it locked", async () => {
		const bus = makeBus();
		const wrapper = mountCustomer(bus);
		await flushPromises();

		bus.emit("set_customer_readonly", true);
		await flushPromises();

		(document.activeElement as HTMLElement | null)?.blur();
		await wrapper.find(".customer-field-shell").trigger("click");
		await flushPromises();

		expect(document.activeElement).toBe(document.body);
		expect(wrapper.findComponent(VAutocompleteStub).vm.menu).toBe(false);
		wrapper.unmount();
	});

	it("keeps the contract the invoice and its shortcuts call through", async () => {
		const wrapper = mountCustomer();
		await flushPromises();
		const store = useCustomersStore();
		const open = vi.spyOn(store, "openUpdateCustomerDialog");
		const select = vi.spyOn(store, "setSelectedCustomer");
		store.customers = [
			{ name: "CUST-007", customer_name: "Bond" },
			{ name: "CUST-008", customer_name: "Other" },
		];
		await flushPromises();

		const exposed = wrapper.vm as unknown as {
			focusCustomerSearch: () => void;
			selectFirstCustomer: () => void;
			openNewCustomer: () => void;
		};
		expect(typeof exposed.focusCustomerSearch).toBe("function");

		exposed.openNewCustomer();
		expect(open).toHaveBeenCalledWith(null);

		exposed.selectFirstCustomer();
		expect(select).toHaveBeenCalledWith("CUST-007");
		wrapper.unmount();
	});
});
