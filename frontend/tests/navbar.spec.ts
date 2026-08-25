// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount } from "@vue/test-utils";

vi.mock("../src/posapp/composables/core/useRtl", () => ({
	useRtl: () => ({
		isRtl: false,
		rtlStyles: {},
		rtlClasses: [],
	}),
}));

vi.mock("../src/offline/index", () => ({
	clearDerivedOfflineCaches: vi.fn(async () => undefined),
	getPendingTransactionalWorkCounts: vi.fn(async () => ({
		writeQueue: 0,
		invoiceOutbox: 0,
		total: 0,
	})),
	isOffline: vi.fn(() => false),
}));

vi.mock("../src/utils/clearAllCaches", () => ({
	clearAllCaches: vi.fn(async () => undefined),
}));

import Navbar from "../src/posapp/components/Navbar.vue";
import { useEmployeeStore } from "../src/posapp/stores/employeeStore";
import {
	clearDerivedOfflineCaches,
	getPendingTransactionalWorkCounts,
} from "../src/offline/index";
import { clearAllCaches } from "../src/utils/clearAllCaches";

const navbarOptions = Navbar as unknown as {
	methods: Record<string, (this: Record<string, any>) => Promise<void>>;
};

function cacheContext() {
	const notifications: Array<Record<string, unknown>> = [];
	return {
		notifications,
		context: {
			clearingCache: false,
			__: (text: string) => text,
			toastStore: { show: (entry: Record<string, unknown>) => notifications.push(entry) },
		},
	};
}

describe("Navbar supervisor access", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		vi.mocked(getPendingTransactionalWorkCounts).mockResolvedValue({
			writeQueue: 0,
			invoiceOutbox: 0,
			total: 0,
		});
		vi.mocked(clearDerivedOfflineCaches).mockResolvedValue(undefined);
		vi.mocked(clearAllCaches).mockResolvedValue(undefined);
		setActivePinia(createPinia());
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", {
			session: {
				user: "cashier@example.com",
				user_fullname: "Main Cashier",
			},
			boot: {
				sysdefaults: { company: "Test Co" },
				website_settings: {},
			},
			call: vi.fn(async () => ({
				message: [
					{
						user: "cashier@example.com",
						full_name: "Main Cashier",
						is_current: true,
						is_supervisor: false,
					},
				],
			})),
		});
	});

	it("blocks cache clearing while transactional work is pending", async () => {
		vi.mocked(getPendingTransactionalWorkCounts).mockResolvedValueOnce({
			writeQueue: 1,
			invoiceOutbox: 1,
			total: 2,
		});

		const { context, notifications } = cacheContext();

		await navbarOptions.methods.clearCache.call(context);

		expect(clearDerivedOfflineCaches).not.toHaveBeenCalled();
		expect(clearAllCaches).not.toHaveBeenCalled();
		expect(notifications).toContainEqual({
			title: "Cannot clear cache while sales are pending",
			color: "warning",
			detail: "Sync or resolve {0} queued operation(s) and {1} invoice(s) first.",
		});
	});

	it("clears only derived/browser caches and reloads when queues are empty", async () => {
		vi.useFakeTimers();
		const { context } = cacheContext();

		await navbarOptions.methods.clearCache.call(context);

		expect(clearDerivedOfflineCaches).toHaveBeenCalledTimes(1);
		expect(clearAllCaches).toHaveBeenCalledWith({
			confirmBeforeClear: false,
			skipStorage: ["localStorage", "sessionStorage", "indexedDB"],
		});
		expect(vi.getTimerCount()).toBe(1);
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("shows the dashboard drawer item only for POS supervisors", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: false,
		});

		const wrapper = shallowMount(Navbar, {
			props: {
				posProfile: { name: "Main POS" },
			},
			global: {
				mocks: {
					__: (value: string) => value,
				},
				stubs: {
					NavbarAppBar: true,
					MobileNavPanel: true,
					NavbarMenu: true,
					NotificationBell: true,
					StatusIndicator: true,
					CacheUsageMeter: true,
					AboutDialog: true,
					EmployeeSwitchDialog: true,
					OfflineInvoicesDialog: true,
					ServerUsageGadget: true,
					DatabaseUsageGadget: true,
					VDialog: true,
					VCard: true,
					VCardTitle: true,
					VCardText: true,
					VSnackbar: true,
					VBtn: true,
					VProgressCircular: true,
				},
			},
		});

		await Promise.resolve();
		expect((wrapper.vm as any).items.some((item: any) => item.to === "/dashboard")).toBe(false);

		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: true,
		});
		await (wrapper.vm as any).$nextTick();

		expect((wrapper.vm as any).items.some((item: any) => item.to === "/dashboard")).toBe(true);
	});

	it("shows the gift cards drawer item when gift cards are enabled on the POS profile", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: true,
		});

		const wrapper = shallowMount(Navbar, {
			props: {
				posProfile: { name: "Main POS", posa_use_gift_cards: 1 },
			},
			global: {
				mocks: {
					__: (value: string) => value,
				},
				stubs: {
					NavbarAppBar: true,
					MobileNavPanel: true,
					NavbarMenu: true,
					NotificationBell: true,
					StatusIndicator: true,
					CacheUsageMeter: true,
					AboutDialog: true,
					EmployeeSwitchDialog: true,
					OfflineInvoicesDialog: true,
					ServerUsageGadget: true,
					DatabaseUsageGadget: true,
					VDialog: true,
					VCard: true,
					VCardTitle: true,
					VCardText: true,
					VSnackbar: true,
					VBtn: true,
					VProgressCircular: true,
				},
			},
		});

		await Promise.resolve();
		expect((wrapper.vm as any).items.some((item: any) => item.to === "/gift-cards")).toBe(true);
	});

	it("passes a footer settings launcher to the drawer and opens the settings panel from it", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: true,
		});

		const wrapper = shallowMount(Navbar, {
			props: {
				posProfile: { name: "Main POS", posa_enable_customer_display: 1 },
				manualOffline: false,
				networkOnline: true,
				serverOnline: true,
			},
			global: {
				mocks: {
					__: (value: string) => value,
				},
				stubs: {
					NotificationBell: true,
					AboutDialog: true,
					EmployeeSwitchDialog: true,
					OfflineInvoicesDialog: true,
					ServerUsageGadget: true,
					DatabaseUsageGadget: true,
					VDialog: true,
					VCard: true,
					VCardTitle: true,
					VCardText: true,
					VSnackbar: true,
					VBtn: true,
					VProgressCircular: true,
				},
			},
		});

		await Promise.resolve();
		(wrapper.vm as any).drawer = true;
		await nextTick();

		expect(wrapper.get('[data-test="drawer-footer-action"]').text()).toContain("Settings");

		await wrapper.get('[data-test="drawer-footer-action"]').trigger("click");
		await nextTick();

		expect((wrapper.vm as any).drawer).toBe(false);
		expect((wrapper.vm as any).settingsPanelOpen).toBe(true);
	});

	it("shows an error toast instead of a false success toast when cache clearing fails", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: true,
		});

		(clearAllCaches as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("boom"),
		);

		const wrapper = shallowMount(Navbar, {
			props: {
				posProfile: { name: "Main POS" },
			},
			global: {
				mocks: {
					__: (value: string) => value,
				},
				stubs: {
					NavbarAppBar: true,
					MobileNavPanel: true,
					NavbarMenu: true,
					NotificationBell: true,
					StatusIndicator: true,
					CacheUsageMeter: true,
					AboutDialog: true,
					EmployeeSwitchDialog: true,
					OfflineInvoicesDialog: true,
					ServerUsageGadget: true,
					DatabaseUsageGadget: true,
					VDialog: true,
					VCard: true,
					VCardTitle: true,
					VCardText: true,
					VSnackbar: true,
					VBtn: true,
					VProgressCircular: true,
				},
			},
		});

		await (wrapper.vm as any).clearCache();

		const shownTitles = (wrapper.vm as any).toastStore.history.map(
			(entry: { title: string }) => entry.title,
		);
		expect(shownTitles).toContain("Failed to clear cache");
		expect(shownTitles).not.toContain("Cache cleared successfully");
	});
});
