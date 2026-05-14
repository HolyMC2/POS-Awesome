// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("../src/posapp/services/dashboardService", async () => {
	const actual: any = await vi.importActual("../src/posapp/services/dashboardService");
	return {
		...actual,
		fetchDashboardData: vi.fn(async () => ({
			enabled: false,
			disabled_reason: "profile_disabled",
			sales_overview: {},
		})),
		fetchDashboardEnvelope: vi.fn(async () => ({
			enabled: false,
			disabled_reason: "profile_disabled",
			default_scope: "current",
			global_enabled: true,
			allow_all_profiles: false,
			profile_scope_enabled: true,
			selected_profiles: [],
			available_profiles: [],
			company: "Acme",
			currency: "PKR",
			generated_at: new Date().toISOString(),
			date_context: { today: "2026-05-12", month_start: "2026-05-01", report_month: "2026-05" },
		})),
		fetchDashboardSection: vi.fn(async () => ({})),
	};
});

import Reports from "../src/posapp/components/reports/Reports.vue";
import {
	fetchDashboardEnvelope,
	fetchDashboardSection,
} from "../src/posapp/services/dashboardService";
import { useEmployeeStore } from "../src/posapp/stores/employeeStore";
import { useUIStore } from "../src/posapp/stores/uiStore";

const BoxStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

const flushPromises = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

describe("Reports supervisor gating", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string) => value);
		const uiStore = useUIStore();
		uiStore.setPosProfile({ name: "Main POS", currency: "PKR" } as any);
	});

	it("blocks non-supervisors from loading the dashboard", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "cashier@example.com",
			full_name: "Main Cashier",
			is_supervisor: false,
		});

		const wrapper = mount(Reports, {
			global: {
				components: {
					VContainer: BoxStub,
					VChip: BoxStub,
					VSelect: BoxStub,
					VTextField: BoxStub,
					VBtn: BoxStub,
					VAlert: BoxStub,
				},
			},
		});

		await flushPromises();

		expect(fetchDashboardEnvelope).not.toHaveBeenCalled();
		expect(fetchDashboardSection).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("POS supervisor");
	});

	it("allows supervisors to request dashboard data via the envelope endpoint", async () => {
		const employeeStore = useEmployeeStore();
		employeeStore.setCurrentCashier({
			user: "supervisor@example.com",
			full_name: "Supervisor",
			is_supervisor: true,
		});

		mount(Reports, {
			global: {
				components: {
					VContainer: BoxStub,
					VChip: BoxStub,
					VSelect: BoxStub,
					VTextField: BoxStub,
					VBtn: BoxStub,
					VAlert: BoxStub,
				},
			},
		});

		await flushPromises();

		expect(fetchDashboardEnvelope).toHaveBeenCalledWith(
			expect.objectContaining({
				pos_profile: "Main POS",
			}),
		);
		// Envelope reports enabled=false so per-section fetches must be skipped.
		expect(fetchDashboardSection).not.toHaveBeenCalled();
	});
});
