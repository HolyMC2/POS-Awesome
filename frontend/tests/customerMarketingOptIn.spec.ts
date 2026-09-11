// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

/**
 * Promotion consent on customer quick-create.
 *
 * `marketing_opt_in` is a Customer field another app adds, so the register
 * learns whether it exists from the opening payload and offers the checkbox
 * only then. Ticked, it needs a mobile and an email, and it reaches the server
 * on both the online call and the offline queue.
 *
 * Vuetify's real components cannot be registered here (see
 * tests/customerSelectorAffordances.spec.ts); stand-ins go in through
 * `global.components` so the dialog's own markup and handlers are under test.
 */

const m = vi.hoisted(() => ({ offline: false }));

vi.mock("../src/offline/index", () => ({
	db: {
		isOpen: () => true,
		open: vi.fn(async () => undefined),
		table: vi.fn(() => ({
			filter: vi.fn().mockReturnThis(),
			offset: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			toArray: vi.fn(async () => []),
			bulkPut: vi.fn(async () => undefined),
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
	isOffline: vi.fn(() => m.offline),
	saveOfflineCustomer: vi.fn(async () => undefined),
	refreshBootstrapSnapshotFromCacheState: vi.fn(),
}));

vi.mock("../src/posapp/api/cfdi", () => ({
	getCustomerFiscal: vi.fn(async () => ({})),
	saveCustomerFiscal: vi.fn(async () => undefined),
}));

vi.mock("../src/posapp/stores/cfdiStore", () => ({
	useCfdiStore: () => ({ catalogs: {}, usesForRegime: () => [], loadBootstrap: vi.fn() }),
}));

vi.mock("../src/posapp/components/pos/cfdi/CustomerFiscalFields.vue", () => ({
	__esModule: true,
	default: { name: "CustomerFiscalFields", render: () => null },
}));

import UpdateCustomer from "../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue";
import { saveOfflineCustomer } from "../src/offline/index";
import { useCustomersStore } from "../src/posapp/stores/customersStore";
import { useToastStore } from "../src/posapp/stores/toastStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const LABEL = "Register for promotions";
const GENERIC_CONSENT = "Agrees to receive promotions by WhatsApp and email";
const CAMPAIGN_CONSENT = "Consentimiento explícito para recibir promociones por WhatsApp y correo.";
const REQUIRED = "Mobile number and email are required to register for promotions";
const CHECKBOX = '[data-testid="customer-marketing-opt-in"]';
const CONSENT = '[data-testid="customer-marketing-opt-in-consent"]';

const pass = (name: string) =>
	defineComponent({
		name,
		setup(_props, { slots }) {
			return () => h("div", { class: name }, slots.default?.());
		},
	});

const VDialogStub = defineComponent({
	name: "VDialog",
	inheritAttrs: false,
	props: { modelValue: { type: Boolean, default: false } },
	setup(props, { slots }) {
		return () => (props.modelValue ? h("div", { class: "v-dialog" }, slots.default?.()) : null);
	},
});

const VTextFieldStub = defineComponent({
	name: "VTextField",
	props: { modelValue: { default: "" }, label: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup(props, { emit }) {
		return () =>
			h("input", {
				"data-label": props.label,
				value: props.modelValue ?? "",
				onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
			});
	},
});

const VCheckboxStub = defineComponent({
	name: "VCheckbox",
	props: { modelValue: { type: Boolean, default: false }, label: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup(props, { emit }) {
		return () =>
			h("label", [
				h("input", {
					type: "checkbox",
					checked: props.modelValue,
					onChange: (event: Event) =>
						emit("update:modelValue", (event.target as HTMLInputElement).checked),
				}),
				props.label,
			]);
	},
});

const VBtnStub = defineComponent({
	name: "VBtn",
	setup(_props, { slots }) {
		return () => h("button", slots.default?.());
	},
});

const fakeFrappe = () => ({
	_: (value: string) => value,
	call: vi.fn((options: { callback?: (r: unknown) => unknown }) => {
		const response = { message: { name: "Ana Pérez" } };
		options.callback?.(response);
		return Promise.resolve(response);
	}),
	throw: vi.fn((message: string) => {
		throw new Error(message);
	}),
	defaults: { get_user_default: (key: string) => (key === "Customer Group" ? "Individual" : "Mexico") },
	db: { get_list: vi.fn(async () => []) },
	utils: { play_sound: vi.fn() },
});

let frappe: ReturnType<typeof fakeFrappe>;

const mountDialog = async (register: Record<string, unknown>, customer: unknown = null) => {
	useUIStore().setRegisterData({ pos_profile: { name: "Doco Ventas", company: "Grupo Doco" } as never, ...register });
	const wrapper = mount(UpdateCustomer, {
		global: {
			components: {
				VRow: pass("VRow"),
				VCol: pass("VCol"),
				VCard: pass("VCard"),
				VCardTitle: pass("VCardTitle"),
				VCardText: pass("VCardText"),
				VCardActions: pass("VCardActions"),
				VContainer: pass("VContainer"),
				VSpacer: pass("VSpacer"),
				VSwitch: pass("VSwitch"),
				VSelect: pass("VSelect"),
				VAutocomplete: pass("VAutocomplete"),
				VDialog: VDialogStub,
				VTextField: VTextFieldStub,
				VCheckbox: VCheckboxStub,
				VBtn: VBtnStub,
			},
			config: { globalProperties: { __: (value: string) => value, frappe } },
		},
	});
	useCustomersStore().openUpdateCustomerDialog(customer as never);
	await flushPromises();
	return wrapper;
};

const type = async (wrapper: Awaited<ReturnType<typeof mountDialog>>, label: string, value: string) => {
	await wrapper.find(`input[data-label="${label}"]`).setValue(value);
};

const submit = async (wrapper: Awaited<ReturnType<typeof mountDialog>>) => {
	const button = wrapper.findAll("button").find((candidate) => candidate.text() === "Submit");
	await button!.trigger("click");
	await flushPromises();
};

const sentArgs = () => (frappe.call.mock.calls.at(-1)?.[0] as { args: Record<string, unknown> }).args;

describe("customer quick-create promotion consent", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		m.offline = false;
		vi.mocked(saveOfflineCustomer).mockClear();
		frappe = fakeFrappe();
		vi.stubGlobal("frappe", frappe);
		vi.stubGlobal("__", (value: string) => value);
	});

	it("is not offered when the Customer doctype has no consent field", async () => {
		const wrapper = await mountDialog({});
		expect(wrapper.find('input[data-label="Customer Name *"]').exists()).toBe(true);
		expect(wrapper.find(CHECKBOX).exists()).toBe(false);
		expect(wrapper.find(CONSENT).exists()).toBe(false);
	});

	it("an opening payload without the keys hides a previously offered checkbox", () => {
		const ui = useUIStore();
		ui.setRegisterData({ customer_marketing_opt_in: true, customer_marketing_opt_in_description: CAMPAIGN_CONSENT });
		expect(ui.customerMarketingOptIn).toBe(true);
		expect(ui.customerMarketingOptInDescription).toBe(CAMPAIGN_CONSENT);
		ui.setRegisterData({ pos_profile: { name: "Doco Ventas" } as never });
		expect(ui.customerMarketingOptIn).toBe(false);
		expect(ui.customerMarketingOptInDescription).toBe("");
	});

	it("is offered unticked with the short label and generic consent when the field has no description", async () => {
		const wrapper = await mountDialog({ customer_marketing_opt_in: true });
		const checkbox = wrapper.find(CHECKBOX);
		expect(checkbox.exists()).toBe(true);
		expect(checkbox.text()).toBe(LABEL);
		expect((checkbox.find("input").element as HTMLInputElement).checked).toBe(false);
		expect(wrapper.find(CONSENT).text()).toBe(GENERIC_CONSENT);
	});

	it("shows the field description as the consent text under the short label", async () => {
		const wrapper = await mountDialog({
			customer_marketing_opt_in: true,
			customer_marketing_opt_in_description: CAMPAIGN_CONSENT,
		});
		expect(wrapper.find(CHECKBOX).text()).toBe(LABEL);
		expect(wrapper.find(CONSENT).text()).toBe(CAMPAIGN_CONSENT);
	});

	it("offline, the cached opening payload still supplies the wording", async () => {
		m.offline = true;
		const wrapper = await mountDialog({
			customer_marketing_opt_in: true,
			customer_marketing_opt_in_description: CAMPAIGN_CONSENT,
		});
		expect(wrapper.find(CONSENT).text()).toBe(CAMPAIGN_CONSENT);
		expect(frappe.call).not.toHaveBeenCalled();
	});

	it("ticked, it requires both a mobile and an email", async () => {
		const wrapper = await mountDialog({ customer_marketing_opt_in: true });
		const toast = vi.spyOn(useToastStore(), "show");
		await type(wrapper, "Customer Name *", "Ana Pérez");
		await type(wrapper, "Mobile No", "6691234567");
		await wrapper.find(`${CHECKBOX} input`).setValue(true);
		await submit(wrapper);
		// A toast the cashier can read, not a throw that surfaces as an
		// unexpected error; the dialog stays open with what was typed.
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: REQUIRED, color: "error" }));
		expect(frappe.throw).not.toHaveBeenCalled();
		expect(frappe.call).not.toHaveBeenCalled();
		expect(wrapper.find('input[data-label="Customer Name *"]').exists()).toBe(true);
	});

	it("ticked with both channels, the online create sends consent", async () => {
		const wrapper = await mountDialog({ customer_marketing_opt_in: true });
		await type(wrapper, "Customer Name *", "Ana Pérez");
		await type(wrapper, "Mobile No", "6691234567");
		await type(wrapper, "Email Id", "ana@example.com");
		await wrapper.find(`${CHECKBOX} input`).setValue(true);
		await submit(wrapper);
		expect(frappe.throw).not.toHaveBeenCalled();
		expect(sentArgs()).toMatchObject({ method: "create", marketing_opt_in: 1 });
	});

	it("unticked, a create sends no consent and needs no email", async () => {
		const wrapper = await mountDialog({ customer_marketing_opt_in: true });
		await type(wrapper, "Customer Name *", "Ana Pérez");
		await submit(wrapper);
		expect(sentArgs()).not.toHaveProperty("marketing_opt_in");
	});

	it("the offline queue carries consent for replay", async () => {
		m.offline = true;
		const wrapper = await mountDialog({ customer_marketing_opt_in: true });
		await type(wrapper, "Customer Name *", "Ana Pérez");
		await type(wrapper, "Mobile No", "6691234567");
		await type(wrapper, "Email Id", "ana@example.com");
		await wrapper.find(`${CHECKBOX} input`).setValue(true);
		await submit(wrapper);
		expect(frappe.call).not.toHaveBeenCalled();
		expect(vi.mocked(saveOfflineCustomer).mock.calls[0]?.[0]).toMatchObject({
			args: { marketing_opt_in: 1, mobile_no: "6691234567", email_id: "ana@example.com" },
		});
	});

	it("an update shows stored consent and unticking withdraws it", async () => {
		const wrapper = await mountDialog(
			{ customer_marketing_opt_in: true },
			{
				name: "Ana Pérez",
				customer_name: "Ana Pérez",
				mobile_no: "6691234567",
				email_id: "ana@example.com",
				customer_group: "Individual",
				territory: "Mexico",
				marketing_opt_in: 1,
			},
		);
		const input = wrapper.find(`${CHECKBOX} input`);
		expect((input.element as HTMLInputElement).checked).toBe(true);
		await input.setValue(false);
		await submit(wrapper);
		expect(sentArgs()).toMatchObject({ method: "update", marketing_opt_in: 0 });
	});

	it("an update that did not load consent leaves it alone", async () => {
		const wrapper = await mountDialog(
			{ customer_marketing_opt_in: true },
			{ name: "Ana Pérez", customer_name: "Ana Pérez", customer_group: "Individual", territory: "Mexico" },
		);
		await submit(wrapper);
		expect(sentArgs()).not.toHaveProperty("marketing_opt_in");
	});
});
