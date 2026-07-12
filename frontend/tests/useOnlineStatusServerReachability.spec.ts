// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";

import { useOnlineStatus } from "../src/posapp/composables/core/useOnlineStatus";

const Harness = defineComponent({
	setup() {
		const { isOnline } = useOnlineStatus();
		return { isOnline };
	},
	template: `<div>{{ isOnline }}</div>`,
});

function setServerOnline(value: boolean) {
	(window as any).serverOnline = value;
	window.dispatchEvent(
		new CustomEvent("posa:network-status", {
			detail: { networkOnline: true, serverOnline: value },
		}),
	);
}

describe("useOnlineStatus reflects probed server reachability", () => {
	beforeEach(() => {
		(window as any).serverOnline = true;
	});

	it("reads offline when the server is unreachable even though navigator.onLine is true", async () => {
		const wrapper = mount(Harness);
		expect(navigator.onLine).toBe(true);

		// Server probe reports the backend unreachable (captive portal / dead WiFi).
		setServerOnline(false);
		await nextTick();
		expect(wrapper.vm.isOnline).toBe(false);

		// Recovers when the server becomes reachable again.
		setServerOnline(true);
		await nextTick();
		expect(wrapper.vm.isOnline).toBe(true);

		wrapper.unmount();
	});
});
