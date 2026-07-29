// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

// The scanner pulls in a live MediaStream reader and the OpenCV WASM
// loader; neither exists in jsdom and neither is what this spec is about.
// The stub republishes the style object it is handed as a data attribute
// so the assertions read the authored value rather than whatever jsdom's
// CSS parser makes of `min()`.
vi.mock("vue-qrcode-reader", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		QrcodeStream: defineComponent({
			name: "QrcodeStream",
			inheritAttrs: false,
			emits: ["detect", "error", "camera-on", "camera-off"],
			setup(_props, { attrs, slots }) {
				return () =>
					h(
						"div",
						{
							class: "qrcode-stream-stub",
							"data-height": (attrs.style as { height?: string })?.height,
						},
						slots.default?.(),
					);
			},
		}),
	};
});

vi.mock("../src/posapp/utils/opencvProcessor", () => ({
	default: {
		ensureInitialized: vi.fn(async () => false),
		quickProcess: vi.fn(async (imageData: unknown) => imageData),
		destroy: vi.fn(async () => undefined),
	},
}));

import CameraScanner from "../src/posapp/components/pos/items/CameraScanner.vue";

const setViewportWidth = (width: number) => {
	Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
};

Object.defineProperty(navigator, "mediaDevices", {
	configurable: true,
	value: {
		enumerateDevices: async () => [
			{ kind: "videoinput", deviceId: "front", label: "front camera" },
			{ kind: "videoinput", deviceId: "rear", label: "back camera" },
		],
	},
});

/**
 * Open the scanner the way the operator does, and report a torch-capable
 * camera — the state the phone layout has to hold up in. Vuetify is not
 * installed here, so its components render as inert custom elements and
 * the props under test show up verbatim as attributes.
 */
const mountScanner = async (width: number) => {
	setViewportWidth(width);
	const wrapper = mount(CameraScanner);
	await wrapper.vm.startScanning();
	await wrapper.findComponent({ name: "QrcodeStream" }).vm.$emit("camera-on", { torch: true });
	await wrapper.vm.$nextTick();
	return wrapper;
};

const torchButton = (wrapper: Awaited<ReturnType<typeof mountScanner>>) =>
	wrapper.findAll("v-btn").find((button) => button.attributes("aria-label") === "Flash Off");

afterEach(() => {
	setViewportWidth(1440);
});

describe("CameraScanner phone layout", () => {
	it("goes fullscreen on a phone instead of a corner-docked 520px card", async () => {
		const wrapper = await mountScanner(390);

		expect(wrapper.attributes("fullscreen")).toBe("true");
		expect(wrapper.attributes("max-width")).toBeUndefined();
		// `location: top right` shrink-wraps the dialog into a corner,
		// which is the opposite of what a fullscreen sheet wants — and the
		// content-class that margins it in goes with it.
		expect(wrapper.attributes("location")).toBeUndefined();
		expect(wrapper.attributes("content-class")).toBeUndefined();
		expect(wrapper.get("v-card").classes()).toContain("camera-scanner-card--fullscreen");
	});

	it("keeps the desktop dialog exactly as it was", async () => {
		const wrapper = await mountScanner(1440);

		expect(wrapper.attributes("fullscreen")).toBe("false");
		expect(wrapper.attributes("max-width")).toBe("520px");
		expect(wrapper.attributes("location")).toBe("top right");
		expect(wrapper.attributes("content-class")).toBe("camera-scanner-dialog");
		expect(wrapper.get("v-card").classes()).not.toContain("camera-scanner-card--fullscreen");
	});

	it("sizes the viewfinder to the sheet rather than a fixed 400px", async () => {
		const wrapper = await mountScanner(390);

		expect(wrapper.get(".qrcode-stream-stub").attributes("data-height")).toBe("100%");
	});

	it("caps the desktop viewfinder against short laptop viewports", async () => {
		const wrapper = await mountScanner(1440);

		expect(wrapper.get(".qrcode-stream-stub").attributes("data-height")).toBe("min(400px, 52vh)");
	});

	it("collapses the scanning hint to a single line on a phone", async () => {
		const wrapper = await mountScanner(390);
		const text = wrapper.text();

		expect(text).toContain("Position the QR code or barcode within the scanning area");
		// The format list and the OpenCV note are three more lines that
		// push the torch off the bottom of the screen.
		expect(text).not.toContain("Detecting formats:");
		expect(text).not.toContain("OpenCV image processing enabled");
	});

	it("keeps the full detail on desktop", async () => {
		const wrapper = await mountScanner(1440);

		expect(wrapper.text()).toContain("Detecting formats:");
	});

	it("keeps the torch labelled for assistive tech once the visible label drops", async () => {
		const wrapper = await mountScanner(390);
		const torch = torchButton(wrapper);

		expect(torch).toBeTruthy();
		// Icon-only on a phone, so torch / camera / OpenCV / Cancel fit one
		// un-wrapped row and the torch is always one tap away. The label
		// lives in a span; the icon is the button's only remaining child.
		expect(torch?.findAll("span")).toHaveLength(0);
		expect(torch?.attributes("title")).toBe("Flash Off");
	});

	it("keeps the torch label visible on desktop", async () => {
		const torch = torchButton(await mountScanner(1440));

		expect(torch?.findAll("span")).toHaveLength(1);
		expect(torch?.text()).toContain("Flash Off");
	});

	it("drops the format chip from the phone title bar", async () => {
		const phone = await mountScanner(390);
		expect(phone.text()).not.toContain("Auto Detect");

		const desktop = await mountScanner(1440);
		expect(desktop.text()).toContain("Auto Detect");
	});

	it("offers the camera switch on a phone as an icon-only control", async () => {
		const wrapper = await mountScanner(390);
		const switchCamera = wrapper
			.findAll("v-btn")
			.find((button) => button.attributes("aria-label") === "Switch Camera");

		expect(switchCamera).toBeTruthy();
		expect(switchCamera?.findAll("span")).toHaveLength(0);
	});
});
