// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import WorkspaceDock from "../src/posapp/components/pos/shell/mobile/WorkspaceDock.vue";
const state = {
	kind: "custody",
	tone: "neutral",
	value: 90,
	labelKey: "Counted cash",
	primaryAction: {
		id: "custody.primary",
		labelKey: "Return this cash to the safe",
	},
	primaryEnabled: true,
} as const;
const render = (over = {}) =>
	mount(WorkspaceDock, {
		props: {
			label: "Cash custody",
			activeId: "cashCustody",
			destinations: [],
			state,
			currency: "MXN",
			...over,
		},
		global: {
			stubs: { VIcon: true, VMenu: true, VList: true, VListItem: true },
		},
	});
beforeEach(() => vi.stubGlobal("__", (key: string) => key));
describe("workspace dock", () => {
	it("shows the workspace's amount and forwards its existing primary action", async () => {
		const onPrimary = vi.fn();
		const wrapper = render({ onPrimary });
		expect(wrapper.text()).toContain("Cash custody");
		expect(wrapper.text()).toContain("$90");
		await wrapper.get('[data-testid="workspace-primary"]').trigger("click");
		expect(onPrimary).toHaveBeenCalledWith("custody.primary");
	});
	it("preserves the confirmation gate and has an independent return action", async () => {
		const onPrimary = vi.fn(),
			onBack = vi.fn();
		const wrapper = render({
			state: { ...state, primaryEnabled: false },
			onPrimary,
			onBack,
		});
		await wrapper.get('[data-testid="workspace-primary"]').trigger("click");
		expect(onPrimary).not.toHaveBeenCalled();
		await wrapper.get('[data-testid="workspace-back"]').trigger("click");
		expect(onBack).toHaveBeenCalledOnce();
	});
	it("never substitutes sale payment or coupon controls when a workspace has no action", () => {
		const wrapper = render({ state: null });
		expect(wrapper.find('[data-testid="workspace-primary"]').exists()).toBe(
			false,
		);
		expect(wrapper.text()).not.toContain("$90");
		expect(wrapper.find('[data-testid="workspace-back"]').exists()).toBe(
			true,
		);
	});
});
