// @vitest-environment jsdom
/**
 * «Credit sale recorded», the sheet raised right after charging.
 *
 * Leaving is never blocked; when paperwork is still missing, the footer says
 * the sale waits in Credit sales → Pending and the button reads «Finish
 * later». Vuetify is not installed here, so the dialog and card are stubbed
 * with real elements (the tests/changeDueDialog.spec.ts approach), and
 * listeners ride as props (VTU does not record component emits here).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

vi.mock("../src/posapp/components/pos/credit/CreditSaleDetail.vue", () => ({
	default: defineComponent({
		name: "CreditSaleDetail",
		props: { invoice: { type: String, required: true }, mode: { type: String, required: true } },
		emits: ["loaded", "changed", "print", "close"],
		setup(props) {
			return () => h("div", { "data-testid": "detail-stub", "data-mode": props.mode }, props.invoice);
		},
	}),
}));

import CreditAfterSaleDialog from "../src/posapp/components/pos/credit/CreditAfterSaleDialog.vue";

const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: { modelValue: { type: Boolean, default: false }, persistent: { type: Boolean, default: false } },
	setup(props, { slots }) {
		return () =>
			h("div", { "data-testid": "dialog", "data-persistent": String(props.persistent) }, props.modelValue ? slots.default?.() : undefined);
	},
});
const VCardStub = defineComponent({
	name: "VCardStub",
	setup(_props, { slots }) {
		return () => h("div", slots.default?.());
	},
});

const listeners = { "onUpdate:modelValue": vi.fn(), onPrint: vi.fn() };
const render = (props: Record<string, unknown> = {}) =>
	mount(CreditAfterSaleDialog, {
		props: { modelValue: true, invoice: "ACC-SINV-2026-00042", ...listeners, ...props },
		global: { components: { "v-dialog": VDialogStub, "v-card": VCardStub } },
	});

const withDocuments = (complete: boolean) => ({ name: "ACC-SINV-2026-00042", documents: { complete, missing: complete ? 0 : 2 } });

beforeEach(() => {
	(window as any).__ = undefined;
	for (const mock of Object.values(listeners)) mock.mockReset();
});

describe("CreditAfterSaleDialog", () => {
	it("hosts the after-sale detail of the invoice it was given", () => {
		const wrapper = render();
		expect(wrapper.text()).toContain("Credit sale recorded");
		expect(wrapper.get('[data-testid="detail-stub"]').text()).toBe("ACC-SINV-2026-00042");
		expect(wrapper.get('[data-testid="detail-stub"]').attributes("data-mode")).toBe("after-sale");
		expect(wrapper.get('[data-testid="dialog"]').attributes("data-persistent")).toBe("true");
	});

	it("says the sale waits in Pending while documents are missing, and reads «Finish later»", async () => {
		const wrapper = render();
		expect(wrapper.get('[data-testid="credit-after-done"]').text()).toBe("Done");
		const detail = wrapper.findComponent({ name: "CreditSaleDetail" });
		detail.vm.$emit("loaded", withDocuments(false));
		await flushPromises();
		expect(wrapper.get('[data-testid="credit-after-pending"]').text()).toContain("Credit sales → Pending");
		expect(wrapper.get('[data-testid="credit-after-done"]').text()).toBe("Finish later");

		detail.vm.$emit("changed", withDocuments(true));
		await flushPromises();
		expect(wrapper.find('[data-testid="credit-after-pending"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="credit-after-done"]').text()).toBe("Done");
	});

	it("closes from the footer or the corner, and relays print", async () => {
		const wrapper = render();
		await wrapper.get('[data-testid="credit-after-done"]').trigger("click");
		await wrapper.get('[data-testid="credit-after-close"]').trigger("click");
		expect(listeners["onUpdate:modelValue"].mock.calls).toEqual([[false], [false]]);
		wrapper.findComponent({ name: "CreditSaleDetail" }).vm.$emit("print", "ACC-SINV-2026-00042");
		expect(listeners.onPrint).toHaveBeenCalledWith("ACC-SINV-2026-00042");
	});

	it("renders no detail without an invoice", () => {
		const wrapper = render({ invoice: null });
		expect(wrapper.find('[data-testid="detail-stub"]').exists()).toBe(false);
	});
});
