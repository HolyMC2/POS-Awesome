// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";

const { route, ui, emit } = vi.hoisted(() => ({ route: { path: "/registers", meta: {} }, ui: { posOpeningShift: null as any }, emit: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => reactive(route) }));
vi.mock("../src/posapp/stores/uiStore", () => ({ useUIStore: () => reactive(ui) }));
vi.mock("../src/posapp/components/pos/shell/Pos.vue", () => ({ default: { template: "<div />" } }));
import DestinationRouteShell from "../src/posapp/components/pos/shell/destinations/DestinationRouteShell.vue";

beforeEach(() => { route.path = "/registers"; ui.posOpeningShift = null; emit.mockClear(); });

it.each([["/registers", "registers"], ["/cash-custody", "cashCustody"]])("hands cold-boot %s to the shell without waiting for a selling shift", async (path, destination) => {
	route.path = path;
	const wrapper = mount(DestinationRouteShell, { global: { provide: { eventBus: { emit } } } });
	await flushPromises();
	expect(emit).toHaveBeenCalledWith("open_destination", destination);
	expect(ui.posOpeningShift).toBeNull();
	wrapper.unmount();
});

it("still waits for a shift before handing over transactional routes", async () => {
	route.path = "/cash-movement";
	const wrapper = mount(DestinationRouteShell, { global: { provide: { eventBus: { emit } } } });
	await flushPromises();
	expect(emit).not.toHaveBeenCalled();
	reactive(ui).posOpeningShift = { name: "OPEN-1" };
	await flushPromises();
	expect(emit).toHaveBeenCalledOnce();
	expect(emit).toHaveBeenCalledWith("open_destination", "expense");
	wrapper.unmount();
});
