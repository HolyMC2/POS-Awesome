// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useRegisterHeartbeat } from "../src/posapp/composables/pos/shared/useRegisterHeartbeat";

const beat = vi.hoisted(() => vi.fn());
vi.mock("../src/posapp/components/pos/registers/foundationApi", () => ({ heartbeat: beat }));
vi.mock("../src/offline/shiftTerminal", () => ({ getTerminalCredentials: () => ({ terminal_id: "id", terminal_token: "token" }) }));

beforeEach(() => {
	vi.useFakeTimers();
	beat.mockReset().mockResolvedValue({ observed: true });
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => vi.useRealTimers());

function host(shift: any) {
	const opening = ref(shift);
	const wrapper = mount(defineComponent({ setup() { useRegisterHeartbeat(opening); return () => h("div"); } }));
	return { opening, wrapper };
}

it("never beats for legacy profile shifts", async () => {
	const { wrapper } = host({ name: "OS-1" });
	await vi.advanceTimersByTimeAsync(120_000);
	expect(beat).not.toHaveBeenCalled();
	wrapper.unmount();
});

it("beats every 30 s ± 5 s for a caja shift and stops on unmount", async () => {
	const { wrapper } = host({ name: "OS-1", posa_register: "R1" });
	await vi.advanceTimersByTimeAsync(0);
	expect(beat).toHaveBeenCalledTimes(1);
	expect(beat.mock.calls[0][0]).toBe("R1");
	await vi.advanceTimersByTimeAsync(24_999);
	expect(beat).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(10_001);
	expect(beat).toHaveBeenCalledTimes(2);
	wrapper.unmount();
	await vi.advanceTimersByTimeAsync(120_000);
	expect(beat).toHaveBeenCalledTimes(2);
});

it("pauses in background tabs and resumes on return", async () => {
	const { opening, wrapper } = host({ name: "OS-1", posa_register: "R1" });
	await vi.advanceTimersByTimeAsync(0);
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
	await vi.advanceTimersByTimeAsync(200_000);
	expect(beat).toHaveBeenCalledTimes(1);
	Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
	document.dispatchEvent(new Event("visibilitychange"));
	await vi.advanceTimersByTimeAsync(0);
	expect(beat).toHaveBeenCalledTimes(2);
	opening.value = null; // shift closed
	await nextTick();
	await vi.advanceTimersByTimeAsync(200_000);
	expect(beat).toHaveBeenCalledTimes(2);
	wrapper.unmount();
});
