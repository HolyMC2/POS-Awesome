// @vitest-environment jsdom

import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastShow = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({
	connectAndRecheck: vi.fn(async () => ({ connected: true, printers: ["P"], error: "" })),
	downloadInstaller: vi.fn(async () => undefined),
	printTestPage: vi.fn(async () => ({ sent: true, error: "" })),
	recordSelfTest: vi.fn(),
	refresh: vi.fn(async () => undefined),
}));

const checks = vi.hoisted(() => ({
	value: [
		{ id: "bundle", status: "ok", title: "Installer available", detail: "QZ Tray 2.2.5", hint: "" },
		{ id: "connection", status: "ok", title: "QZ Tray connected", detail: "2.2.5", hint: "" },
		{ id: "version", status: "ok", title: "Up to date", detail: "", hint: "" },
		{
			id: "signing",
			status: "fail",
			title: "Certificate signing failed",
			detail: "get_certificate returned empty",
			hint: "Ask support to run Setup QZ Certificate.",
		},
		{ id: "printer", status: "ok", title: "Printer selected", detail: "P", hint: "" },
		{ id: "selftest", status: "unknown", title: "Never tested", detail: "", hint: "Print a test page." },
	],
}));

vi.mock("../src/posapp/stores/toastStore", () => ({
	useToastStore: () => ({ show: toastShow }),
}));

vi.mock("../src/posapp/composables/core/usePrintHealthActions", () => ({
	usePrintHealthActions: () => ({
		health: {
			checks: ref(checks.value),
			rollup: ref("fail"),
			checking: ref(false),
			platform: "win",
			bundleInfo: ref({
				available: true,
				qz_version: "2.2.5",
				built_at: "",
				cert_fingerprint: "",
				platforms: {
					win: { filename: "qz-win.zip", size: 10, sha256: "a", present: true },
					linux: { filename: "qz-linux.tgz", size: 9, sha256: "b", present: false },
				},
			}),
			recordSelfTest: actions.recordSelfTest,
			refresh: actions.refresh,
		},
		connectAndRecheck: actions.connectAndRecheck,
		downloadInstaller: actions.downloadInstaller,
		printTestPage: actions.printTestPage,
		installSteps: () => ["Unzip the downloaded file.", "Right-click install.bat."],
	}),
}));

import PrintHealthDialog from "../src/posapp/components/pos/PrintHealthDialog.vue";

const Box = defineComponent({
	setup: (_, { slots, attrs }) => () =>
		h("div", { "data-test": attrs["data-test"] }, slots.default?.()),
});

const VListItem = defineComponent({
	props: { title: { type: String, default: "" } },
	setup: (props, { slots, attrs }) => () =>
		h("div", { "data-test": attrs["data-test"] }, [
			h("span", {}, props.title),
			slots.subtitle?.(),
			slots.prepend?.(),
		]),
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
	VListItem,
	VAlert: Box,
	VChip: Box,
	VBtn,
};

const onClose = vi.fn();
const onWizard = vi.fn();

const mountDialog = async () => {
	const wrapper = mount(PrintHealthDialog, {
		props: {
			modelValue: true,
			"onUpdate:modelValue": onClose,
			onOpenWizard: onWizard,
		},
		global: { components: globalComponents },
	});
	await flushPromises();
	return wrapper;
};

describe("PrintHealthDialog", () => {
	beforeEach(() => {
		(globalThis as any).__ = (value: string) => value;
		toastShow.mockReset();
		onClose.mockReset();
		onWizard.mockReset();
		Object.values(actions).forEach((fn) => fn.mockClear());
		actions.printTestPage.mockResolvedValue({ sent: true, error: "" });
		actions.connectAndRecheck.mockResolvedValue({ connected: true, printers: ["P"], error: "" });
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("renders a row per check with its fix hint", async () => {
		const wrapper = await mountDialog();

		for (const id of ["bundle", "connection", "version", "signing", "printer", "selftest"]) {
			expect(wrapper.find(`[data-test="print-health-${id}"]`).exists()).toBe(true);
		}
		// The hint is the actionable half — a red row with no "what now" is
		// just an alarm.
		expect(wrapper.get('[data-test="print-health-signing"]').text()).toContain(
			"Ask support to run Setup QZ Certificate.",
		);
	});

	it("does not record a self-test on the send alone", async () => {
		const wrapper = await mountDialog();

		await wrapper.get('[data-test="print-health-test"]').trigger("click");
		await flushPromises();

		// QZ reports "sent" the moment the job leaves the websocket.
		expect(actions.printTestPage).toHaveBeenCalledTimes(1);
		expect(actions.recordSelfTest).not.toHaveBeenCalled();
		expect(wrapper.find('[data-test="print-health-confirm"]').exists()).toBe(true);
	});

	it("records the manual verdict once the operator confirms", async () => {
		const wrapper = await mountDialog();
		await wrapper.get('[data-test="print-health-test"]').trigger("click");
		await flushPromises();

		await wrapper.get('[data-test="print-health-confirm-yes"]').trigger("click");

		expect(actions.recordSelfTest).toHaveBeenCalledWith(true, "manual");
		expect(wrapper.find('[data-test="print-health-confirm"]').exists()).toBe(false);
	});

	it("records a failure when the operator says nothing printed", async () => {
		const wrapper = await mountDialog();
		await wrapper.get('[data-test="print-health-test"]').trigger("click");
		await flushPromises();

		await wrapper.get('[data-test="print-health-confirm-no"]').trigger("click");

		expect(actions.recordSelfTest).toHaveBeenCalledWith(false, "manual");
	});

	it("records a failure and skips the prompt when the job never left the SPA", async () => {
		actions.printTestPage.mockResolvedValue({ sent: false, error: "QZ Tray unavailable" });
		const wrapper = await mountDialog();

		await wrapper.get('[data-test="print-health-test"]').trigger("click");
		await flushPromises();

		expect(actions.recordSelfTest).toHaveBeenCalledWith(false, "manual");
		expect(wrapper.find('[data-test="print-health-confirm"]').exists()).toBe(false);
		expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ color: "error" }));
	});

	it("re-runs the checks on demand", async () => {
		const wrapper = await mountDialog();
		await wrapper.get('[data-test="print-health-recheck"]').trigger("click");
		await flushPromises();

		expect(actions.connectAndRecheck).toHaveBeenCalled();
	});

	it("offers both platforms but only enables the archives really published", async () => {
		const wrapper = await mountDialog();

		expect(
			wrapper.get('[data-test="print-health-download-win"]').attributes("disabled"),
		).toBeUndefined();
		// The manifest describes a Linux archive the deploy never landed.
		expect(
			wrapper.get('[data-test="print-health-download-linux"]').attributes("disabled"),
		).toBeDefined();

		await wrapper.get('[data-test="print-health-download-win"]').trigger("click");
		await flushPromises();
		expect(actions.downloadInstaller).toHaveBeenCalledWith("win");
	});

	it("hands off to the wizard and closes itself", async () => {
		const wrapper = await mountDialog();

		await wrapper.get('[data-test="print-health-wizard"]').trigger("click");

		expect(onClose).toHaveBeenCalledWith(false);
		expect(onWizard).toHaveBeenCalled();
	});
});
