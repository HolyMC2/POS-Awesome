// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

// jsdom ships no matchMedia. useTheme.ts builds its singleton at import time and
// reads it there, so unlike the other specs this stub has to beat the imports.
vi.hoisted(() => {
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		})) as unknown as typeof window.matchMedia;
	}
});

vi.mock("../src/offline/index", () => ({
	initPromise: Promise.resolve(),
	isOffline: () => false,
	checkDbHealth: vi.fn(async () => undefined),
	getOpeningDialogStorage: vi.fn(() => null),
	setOpeningDialogStorage: vi.fn(),
	setOpeningStorage: vi.fn(),
	getBootstrapSnapshot: vi.fn(() => null),
	setBootstrapSnapshot: vi.fn(),
}));

vi.mock("../src/offline/bootstrapSnapshot", () => ({
	createBootstrapSnapshotFromRegisterData: vi.fn(() => ({})),
}));

import Drafts from "../src/posapp/components/pos/flows/Drafts.vue";
import EmployeeSwitchDialog from "../src/posapp/components/pos/employee/EmployeeSwitchDialog.vue";
import GiftCardDialog from "../src/posapp/components/pos/wallet/GiftCardDialog.vue";
import InvoiceManagement from "../src/posapp/components/pos/flows/InvoiceManagement.vue";
import MpesaPayments from "../src/posapp/components/pos/payments/Mpesa-Payments.vue";
import OpeningDialog from "../src/posapp/components/pos/shift/OpeningDialog.vue";
import {
	DIALOG_FULLSCREEN_BREAKPOINT,
	useDialogFullscreen,
} from "../src/posapp/composables/core/useDialogFullscreen";

const PHONE_WIDTH = 390;
// Inside the flows sheets' fullscreen range (<1100) but above sm — the band
// where their inline width used to defeat `fullscreen`.
const TABLET_WIDTH = 900;
const DESKTOP_WIDTH = 1440;

const setViewportWidth = (value: number) => {
	Object.defineProperty(window, "innerWidth", {
		value,
		writable: true,
		configurable: true,
	});
};

/**
 * Renders nothing: the assertions are about the dialog's own geometry props,
 * and skipping the slot keeps these five components mountable without their
 * whole Vuetify subtree.
 */
const VDialogStub = defineComponent({
	name: "VDialogStub",
	props: {
		modelValue: { type: Boolean, default: false },
		fullscreen: { type: Boolean, default: false },
		scrollable: { type: Boolean, default: false },
		width: { type: [String, Number], default: undefined },
		maxWidth: { type: [String, Number], default: undefined },
		minWidth: { type: [String, Number], default: undefined },
		maxHeight: { type: [String, Number], default: undefined },
	},
	setup() {
		return () => null;
	},
});

const PassThroughStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const mountWithDialogStub = (
	component: any,
	options: Record<string, any> = {},
) =>
	mount(component, {
		...options,
		global: {
			components: { VDialog: VDialogStub, VRow: PassThroughStub },
			...(options.global || {}),
		},
	});

const dialogPropsOf = (wrapper: any, index = 0) =>
	wrapper.findAllComponents(VDialogStub)[index].props();

describe("useDialogFullscreen", () => {
	const Harness = defineComponent({
		props: { geometry: { type: Object, default: () => ({}) } },
		setup(props) {
			const { isFullscreenDialog, dialogProps, dialogPropsFor } =
				useDialogFullscreen(props.geometry);
			return {
				isFullscreenDialog,
				dialogProps,
				secondaryProps: dialogPropsFor({ maxWidth: 480 }),
				overrideProps: dialogPropsFor({
					breakpoint: DIALOG_FULLSCREEN_BREAKPOINT,
					maxWidth: 480,
				}),
			};
		},
		render: () => null,
	});

	it("drops every geometry prop under the sm breakpoint", () => {
		setViewportWidth(PHONE_WIDTH);

		const wrapper = mount(Harness, {
			props: {
				geometry: {
					maxWidth: "800px",
					minWidth: "800px",
					maxHeight: "90vh",
				},
			},
		});

		expect(wrapper.vm.isFullscreenDialog).toBe(true);
		// Not merely widened: VOverlay writes these as inline styles that
		// outrank the .v-dialog--fullscreen stylesheet rule.
		expect(wrapper.vm.dialogProps).toEqual({ fullscreen: true });
	});

	it("keeps the desktop geometry untouched at and above the breakpoint", () => {
		setViewportWidth(DIALOG_FULLSCREEN_BREAKPOINT);

		const wrapper = mount(Harness, {
			props: { geometry: { maxWidth: "800px", maxHeight: "90vh" } },
		});

		expect(wrapper.vm.isFullscreenDialog).toBe(false);
		expect(wrapper.vm.dialogProps).toEqual({
			fullscreen: false,
			maxWidth: "800px",
			maxHeight: "90vh",
		});
	});

	it("honours a custom breakpoint and drops the paired width prop", () => {
		setViewportWidth(TABLET_WIDTH);

		const wrapper = mount(Harness, {
			props: {
				geometry: {
					breakpoint: 1100,
					width: "min(960px, 96vw)",
					maxWidth: "960px",
				},
			},
		});

		expect(wrapper.vm.isFullscreenDialog).toBe(true);
		// The flows bug in one line: `width` used to survive `fullscreen`.
		expect(wrapper.vm.dialogProps).toEqual({ fullscreen: true });
	});

	it("keeps width and max-width above a custom breakpoint, and never leaks it", () => {
		setViewportWidth(DESKTOP_WIDTH);

		const wrapper = mount(Harness, {
			props: {
				geometry: {
					breakpoint: 1100,
					width: "min(960px, 96vw)",
					maxWidth: "960px",
				},
			},
		});

		// `breakpoint` is config, not a dialog prop — it must not reach the DOM.
		expect(wrapper.vm.dialogProps).toEqual({
			fullscreen: false,
			width: "min(960px, 96vw)",
			maxWidth: "960px",
		});
	});

	it("lets an extra dialog keep the sm floor while the parent uses 1100", () => {
		setViewportWidth(TABLET_WIDTH);

		const wrapper = mount(Harness, {
			props: { geometry: { breakpoint: 1100, maxWidth: "1420px" } },
		});

		// Inherits the parent's 1100 unless it says otherwise.
		expect(wrapper.vm.dialogProps).toEqual({ fullscreen: true });
		expect(wrapper.vm.secondaryProps).toEqual({ fullscreen: true });
		expect(wrapper.vm.overrideProps).toEqual({
			fullscreen: false,
			maxWidth: 480,
		});
	});

	it("follows a resize across the breakpoint and covers extra dialogs", async () => {
		setViewportWidth(DESKTOP_WIDTH);
		const wrapper = mount(Harness, {
			props: { geometry: { maxWidth: 520 } },
		});

		expect(wrapper.vm.secondaryProps).toEqual({
			fullscreen: false,
			maxWidth: 480,
		});

		setViewportWidth(PHONE_WIDTH);
		window.dispatchEvent(new Event("resize"));
		await wrapper.vm.$nextTick();

		expect(wrapper.vm.dialogProps).toEqual({ fullscreen: true });
		expect(wrapper.vm.secondaryProps).toEqual({ fullscreen: true });
	});
});

describe("xs dialogs", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(window as any).__ = (value: string) => value;
		(window as any).frappe = {
			_: (value: string) => value,
			call: vi.fn(async () => ({ message: null })),
			session: { user: "cashier@example.com" },
		};
	});

	it("takes the M-Pesa sheet fullscreen instead of holding it at 800px", () => {
		setViewportWidth(PHONE_WIDTH);

		const wrapper = mountWithDialogStub(MpesaPayments);

		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: true,
			minWidth: undefined,
			maxWidth: undefined,
		});
	});

	it("lets the M-Pesa sheet go fluid below 800px without changing the desktop cap", () => {
		setViewportWidth(DESKTOP_WIDTH);

		const wrapper = mountWithDialogStub(MpesaPayments);

		// min-width:800px was the hard bug — the cap stays, the floor goes.
		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: false,
			maxWidth: "800px",
			minWidth: undefined,
		});
	});

	it("takes the opening shift dialog fullscreen on a phone", () => {
		setViewportWidth(PHONE_WIDTH);

		const wrapper = mountWithDialogStub(OpeningDialog);

		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: true,
			maxWidth: undefined,
			maxHeight: undefined,
		});
	});

	it("keeps the opening shift dialog a centred card on desktop", () => {
		setViewportWidth(DESKTOP_WIDTH);

		const wrapper = mountWithDialogStub(OpeningDialog);

		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: false,
			maxWidth: "800px",
			maxHeight: "90vh",
		});
	});

	it("takes the gift card dialog fullscreen and makes it scrollable on a phone", () => {
		setViewportWidth(PHONE_WIDTH);

		const wrapper = mountWithDialogStub(GiftCardDialog, {
			props: { modelValue: true },
		});

		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: true,
			scrollable: true,
			maxWidth: undefined,
		});
	});

	it("keeps the gift card dialog at 520px on desktop", () => {
		setViewportWidth(DESKTOP_WIDTH);

		const wrapper = mountWithDialogStub(GiftCardDialog, {
			props: { modelValue: true },
		});

		expect(dialogPropsOf(wrapper)).toMatchObject({
			fullscreen: false,
			scrollable: false,
			maxWidth: 520,
		});
	});

	it("takes both cashier sheets fullscreen on a phone", () => {
		setViewportWidth(PHONE_WIDTH);

		const wrapper = mountWithDialogStub(EmployeeSwitchDialog);

		expect(dialogPropsOf(wrapper, 0)).toMatchObject({
			fullscreen: true,
			maxWidth: undefined,
		});
		expect(dialogPropsOf(wrapper, 1)).toMatchObject({
			fullscreen: true,
			maxWidth: undefined,
		});
	});

	it("keeps the cashier sheets at their own widths on desktop", () => {
		setViewportWidth(DESKTOP_WIDTH);

		const wrapper = mountWithDialogStub(EmployeeSwitchDialog);

		expect(dialogPropsOf(wrapper, 0)).toMatchObject({
			fullscreen: false,
			maxWidth: 520,
		});
		expect(dialogPropsOf(wrapper, 1)).toMatchObject({
			fullscreen: false,
			maxWidth: 480,
		});
	});
});

/**
 * All four were built the same way: :fullscreen below 1100 alongside an inline
 * :width, so between sm and 1100 the sheet rendered at its desktop width pinned
 * to the left of a fullscreen overlay.
 */
describe("flows sheets below 1100", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		(window as any).__ = (value: string) => value;
		(window as any).frappe = {
			_: (value: string) => value,
			call: vi.fn(async () => ({ message: null })),
			session: { user: "cashier@example.com" },
			utils: { get_url: (path: string) => path },
			// invoiceStore seeds postingDate from this the moment it is created.
			datetime: { nowdate: () => "2026-07-29" },
			// the format mixin reads precision defaults in mounted().
			defaults: { get_default: () => 2 },
		};
	});

	// Returns.vue and SalesOrders.vue import their stores as "…Store.js" while
	// the files are .ts. Vite's .js→.ts fallback skips them because those SFC
	// scripts are plain JS, so vitest cannot resolve the import even though the
	// production build ships both. They are guarded in dialogFullscreenSource.
	const sheets = [
		{
			label: "Drafts",
			component: Drafts,
			width: "min(960px, 96vw)",
			maxWidth: "960px",
		},
		{
			label: "Invoice Management",
			component: InvoiceManagement,
			width: "min(1420px, 97vw)",
			maxWidth: "1420px",
		},
	];

	sheets.forEach(({ label, component, width, maxWidth }) => {
		it(`${label} carries no inline width while fullscreen`, () => {
			setViewportWidth(TABLET_WIDTH);

			const wrapper = mountWithDialogStub(component);

			expect(dialogPropsOf(wrapper)).toMatchObject({
				fullscreen: true,
				width: undefined,
				maxWidth: undefined,
			});
		});

		it(`${label} keeps its desktop width pair above 1100`, () => {
			setViewportWidth(DESKTOP_WIDTH);

			const wrapper = mountWithDialogStub(component);

			expect(dialogPropsOf(wrapper)).toMatchObject({
				fullscreen: false,
				width,
				maxWidth,
			});
		});
	});

	// Layered over the sheet above, so it keeps the sm floor rather than 1100.
	describe("invoice-detail sheet", () => {
		const DETAIL_DIALOG_INDEX = 1;

		it("goes fullscreen on a phone", () => {
			setViewportWidth(PHONE_WIDTH);

			const wrapper = mountWithDialogStub(InvoiceManagement);

			expect(dialogPropsOf(wrapper, DETAIL_DIALOG_INDEX)).toMatchObject({
				fullscreen: true,
				maxWidth: undefined,
			});
		});

		it("stays a centred card over a fullscreen parent between sm and 1100", () => {
			setViewportWidth(TABLET_WIDTH);

			const wrapper = mountWithDialogStub(InvoiceManagement);

			// Parent fullscreen, detail still a layer on top of it.
			expect(dialogPropsOf(wrapper)).toMatchObject({ fullscreen: true });
			expect(dialogPropsOf(wrapper, DETAIL_DIALOG_INDEX)).toMatchObject({
				fullscreen: false,
				maxWidth: "1040px",
			});
		});

		it("keeps its 1040px cap on desktop", () => {
			setViewportWidth(DESKTOP_WIDTH);

			const wrapper = mountWithDialogStub(InvoiceManagement);

			expect(dialogPropsOf(wrapper, DETAIL_DIALOG_INDEX)).toMatchObject({
				fullscreen: false,
				maxWidth: "1040px",
			});
		});
	});
});
