// @vitest-environment jsdom

import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastShow = vi.hoisted(() => vi.fn());
const trackMock = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({
	connectAndRecheck: vi.fn(),
	downloadInstaller: vi.fn(async () => undefined),
	printTestPage: vi.fn(async () => ({ sent: true, error: "" })),
	recordSelfTest: vi.fn(),
	markSetupDone: vi.fn(),
}));

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastShow }),
}));
vi.mock("../src/posapp/utils/telemetry", () => ({ track: trackMock }));

vi.mock("../src/posapp/services/qzTray", async () => {
	const { ref: vueRef } = await import("vue");
	const selectedQzPrinter = vueRef("Counter Printer");
	return {
		qzPrinters: vueRef(["Counter Printer", "Back Office"]),
		selectedQzPrinter,
		setSelectedQzPrinter: vi.fn((v: string) => {
			selectedQzPrinter.value = v;
		}),
	};
});

vi.mock("../src/posapp/composables/core/usePrintHealthActions", () => ({
	usePrintHealthActions: () => ({
		health: {
			checks: ref([
				{ id: "bundle", status: "ok", title: "Installer available", detail: "", hint: "" },
			]),
			rollup: ref("ok"),
			bundleInfo: ref({
				available: true,
				qz_version: "2.2.5",
				built_at: "",
				cert_fingerprint: "",
				platforms: {
					win: { filename: "qz-win.zip", size: 10, sha256: "a", present: true },
				},
			}),
			platform: "win",
			lastSelfTest: ref(null),
			recordSelfTest: actions.recordSelfTest,
			markSetupDone: actions.markSetupDone,
		},
		connectAndRecheck: actions.connectAndRecheck,
		downloadInstaller: actions.downloadInstaller,
		printTestPage: actions.printTestPage,
		installSteps: () => ["Unzip the downloaded file."],
	}),
}));

import PrintSetupWizard from "../src/posapp/components/pos/PrintSetupWizard.vue";
import { WIZARD_EVENT } from "../src/posapp/composables/core/usePrintHealth";

const Box = defineComponent({
	setup: (_, { slots, attrs }) => () =>
		h("div", { "data-test": attrs["data-test"] }, slots.default?.()),
});

const VBtn = defineComponent({
	props: { disabled: { type: Boolean, default: false } },
	emits: ["click"],
	setup: (props, { slots, attrs, emit }) => () =>
		h(
			"button",
			{
				type: "button",
				disabled: props.disabled,
				"data-test": attrs["data-test"],
				onClick: () => emit("click"),
			},
			slots.default?.(),
		),
});

const VSelect = defineComponent({
	props: { modelValue: { type: String, default: "" } },
	emits: ["update:modelValue"],
	setup: (props, { emit, attrs }) => () =>
		h("input", {
			"data-test": attrs["data-test"],
			value: props.modelValue ?? "",
			onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
		}),
});

const globalComponents = {
	VDialog: Box,
	VCard: Box,
	VCardTitle: Box,
	VCardText: Box,
	VCardActions: Box,
	VSpacer: Box,
	VDivider: Box,
	VIcon: Box,
	VList: Box,
	VListItem: Box,
	VAlert: Box,
	VProgressLinear: Box,
	VBtn,
	VSelect,
};

// VTU cannot record emits from a <script setup> root that is itself a stub,
// so the close contract is asserted through the parent handler — which is
// what v-model actually wires up.
const onClose = vi.fn();

const mountWizard = async () => {
	const wrapper = mount(PrintSetupWizard, {
		props: { modelValue: true, "onUpdate:modelValue": onClose },
		global: { components: globalComponents },
	});
	await flushPromises();
	return wrapper;
};

const stepsEmitted = () =>
	trackMock.mock.calls
		.filter((c) => c[0] === WIZARD_EVENT)
		.map((c) => `${c[2].step}:${c[2].outcome}`);

describe("PrintSetupWizard state machine", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		toastShow.mockReset();
		trackMock.mockReset();
		onClose.mockReset();
		Object.values(actions).forEach((fn) => fn.mockClear());
		actions.connectAndRecheck.mockResolvedValue({
			connected: true,
			printers: ["Counter Printer"],
			error: "",
		});
		actions.printTestPage.mockResolvedValue({ sent: true, error: "" });
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("jumps straight to the printer step when QZ Tray is already running", async () => {
		const wrapper = await mountWizard();

		// Nothing to install, so the install step must not be shown at all.
		expect(wrapper.find('[data-test="print-wizard-install"]').exists()).toBe(false);
		expect(wrapper.find('[data-test="print-wizard-printer"]').exists()).toBe(true);
		expect(stepsEmitted()).toContain("detect:connected");
	});

	it("routes to the install step when no tray answers", async () => {
		actions.connectAndRecheck.mockResolvedValue({
			connected: false,
			printers: [],
			error: "QZ Tray did not answer.",
		});
		const wrapper = await mountWizard();

		expect(wrapper.find('[data-test="print-wizard-install"]').exists()).toBe(true);
		expect(wrapper.find('[data-test="print-wizard-install-error"]').text()).toContain(
			"QZ Tray did not answer.",
		);
		expect(stepsEmitted()).toContain("detect:not_found");
	});

	it("retries detection from the install step and advances on success", async () => {
		actions.connectAndRecheck.mockResolvedValueOnce({
			connected: false,
			printers: [],
			error: "not running",
		});
		const wrapper = await mountWizard();
		expect(wrapper.find('[data-test="print-wizard-install"]').exists()).toBe(true);

		actions.connectAndRecheck.mockResolvedValue({
			connected: true,
			printers: ["Counter Printer"],
			error: "",
		});
		await wrapper.get('[data-test="print-wizard-installed"]').trigger("click");
		await flushPromises();

		expect(wrapper.find('[data-test="print-wizard-printer"]').exists()).toBe(true);
	});

	it("walks printer → test → done on a confirmed print", async () => {
		const wrapper = await mountWizard();

		await wrapper.get('[data-test="print-wizard-printer-next"]').trigger("click");
		expect(wrapper.find('[data-test="print-wizard-test-step"]').exists()).toBe(true);

		await wrapper.get('[data-test="print-wizard-test"]').trigger("click");
		await flushPromises();
		// Sent is not printed — the operator has to answer first.
		expect(actions.recordSelfTest).not.toHaveBeenCalled();
		expect(wrapper.find('[data-test="print-wizard-confirm"]').exists()).toBe(true);

		await wrapper.get('[data-test="print-wizard-confirm-yes"]').trigger("click");
		expect(actions.recordSelfTest).toHaveBeenCalledWith(true, "wizard");
		expect(actions.markSetupDone).toHaveBeenCalled();
		expect(wrapper.find('[data-test="print-wizard-done"]').exists()).toBe(true);
	});

	it("shows troubleshooting instead of finishing when the operator says No", async () => {
		const wrapper = await mountWizard();
		await wrapper.get('[data-test="print-wizard-printer-next"]').trigger("click");
		await wrapper.get('[data-test="print-wizard-test"]').trigger("click");
		await flushPromises();

		await wrapper.get('[data-test="print-wizard-confirm-no"]').trigger("click");

		expect(actions.recordSelfTest).toHaveBeenCalledWith(false, "wizard");
		expect(actions.markSetupDone).not.toHaveBeenCalled();
		expect(wrapper.find('[data-test="print-wizard-done"]').exists()).toBe(false);
		expect(wrapper.find('[data-test="print-wizard-troubleshooting"]').exists()).toBe(true);
		expect(stepsEmitted()).toContain("test:test_denied");
	});

	it("offers retry and a route back to the printer step after a failure", async () => {
		const wrapper = await mountWizard();
		await wrapper.get('[data-test="print-wizard-printer-next"]').trigger("click");
		await wrapper.get('[data-test="print-wizard-test"]').trigger("click");
		await flushPromises();
		await wrapper.get('[data-test="print-wizard-confirm-no"]').trigger("click");

		await wrapper.get('[data-test="print-wizard-back-printer"]').trigger("click");
		expect(wrapper.find('[data-test="print-wizard-printer"]').exists()).toBe(true);
		expect(stepsEmitted()).toContain("test:back_to_printer");
	});

	it("records a failed self-test when the job never reaches the printer", async () => {
		actions.printTestPage.mockResolvedValue({ sent: false, error: "QZ Tray unavailable" });
		const wrapper = await mountWizard();
		await wrapper.get('[data-test="print-wizard-printer-next"]').trigger("click");
		await wrapper.get('[data-test="print-wizard-test"]').trigger("click");
		await flushPromises();

		expect(actions.recordSelfTest).toHaveBeenCalledWith(false, "wizard");
		// No point asking about a slip that never left the SPA.
		expect(wrapper.find('[data-test="print-wizard-confirm"]').exists()).toBe(false);
		expect(wrapper.find('[data-test="print-wizard-troubleshooting"]').exists()).toBe(true);
	});

	it("is skippable and never marks setup done on the way out", async () => {
		const wrapper = await mountWizard();

		await wrapper.get('[data-test="print-wizard-skip"]').trigger("click");

		expect(actions.markSetupDone).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledWith(false);
		expect(stepsEmitted()).toContain("printer:skipped");
	});

	it("downloads the installer for the requested platform", async () => {
		actions.connectAndRecheck.mockResolvedValue({
			connected: false,
			printers: [],
			error: "not running",
		});
		const wrapper = await mountWizard();

		await wrapper.get('[data-test="print-wizard-download-win"]').trigger("click");
		await flushPromises();

		expect(actions.downloadInstaller).toHaveBeenCalledWith("win");
		expect(stepsEmitted()).toContain("install:downloaded");
	});

	it("disables the Linux button when that archive is not published", async () => {
		actions.connectAndRecheck.mockResolvedValue({
			connected: false,
			printers: [],
			error: "not running",
		});
		const wrapper = await mountWizard();

		expect(
			wrapper.get('[data-test="print-wizard-download-linux"]').attributes("disabled"),
		).toBeDefined();
	});
});
