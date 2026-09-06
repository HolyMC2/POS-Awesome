// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";
import { mount, flushPromises, DOMWrapper, enableAutoUnmount } from "@vue/test-utils";

import * as writeQueue from "../src/offline/writeQueue";
import OfflineStatusPanel from "../src/posapp/components/navbar/OfflineStatusPanel.vue";
import { useOfflineSyncStore } from "../src/posapp/stores/offlineSyncStore";

enableAutoUnmount(afterEach);
afterEach(() => { document.body.innerHTML = ""; });
const body = () => new DOMWrapper(document.body);

const VMenuStub = defineComponent({
	props: {
		modelValue: {
			type: Boolean,
			default: false,
		},
	},
	emits: ["update:modelValue"],
	setup(props, { slots }) {
		return () =>
			h("div", { class: "v-menu-stub" }, [
				slots.activator?.({
					props: {},
				}),
				props.modelValue
					? h("div", { class: "v-menu-stub__content" }, slots.default?.())
					: null,
			]);
	},
});

const VBtnStub = defineComponent({
	emits: ["click"],
	setup(_, { attrs, slots, emit }) {
		return () =>
			h(
				"button",
				{
					...attrs,
					onClick: () => {
						(attrs.onClick as (() => void) | undefined)?.();
						emit("click");
					},
				},
				slots.default?.(),
			);
	},
});

const SimpleStub = defineComponent({
	setup(_, { slots }) {
		return () => h("div", {}, slots.default?.());
	},
});

describe("OfflineStatusPanel", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.spyOn(writeQueue, "getLegacyQueueRecoveryCount").mockResolvedValue(0);
		vi.stubGlobal("__", (value: string) => value);
	});

	it("shows warning summary, attention resources, and repair actions", () => {
		const store = useOfflineSyncStore();
		store.setSummary({
			networkOnline: true,
			serverOnline: true,
			serverConnecting: false,
			manualOffline: false,
			pendingInvoices: 2,
			cacheUsage: 46,
			cacheUsageDetails: { total: 4096, indexedDB: 3072, localStorage: 1024 },
		});
		store.setBootstrapWarning({
			active: true,
			title: "Pricing Offline",
			messages: [
				"Offline pricing is unverified. Offers, customer pricing, taxes, or discounts may differ after reconnect.",
			],
		});
		store.setCapabilitySummaries([
			{
				id: "pricing_offline",
				label: "Pricing Offline",
				status: "degraded",
				severity: "warning",
				message:
					"Offline pricing is unverified. Offers, customer pricing, taxes, or discounts may differ after reconnect.",
				action:
					"Allow sale with warning and flag the invoice as offline pricing unverified.",
				warningCodes: [
					"pricing_rules_snapshot",
					"pricing_rules_context",
					"tax_inclusive",
				],
				prerequisites: [
					"pricing_rules_snapshot",
					"pricing_rules_context",
					"tax_inclusive",
				],
				policy: "allow_with_warning",
			},
			{
				id: "stock_confidence_offline",
				label: "Stock Confidence Offline",
				status: "override_required",
				severity: "warning",
				message:
					"Stock confidence is low and a local supervisor override is required by policy.",
				action:
					"Collect a local supervisor PIN or privileged approval before selling uncertain stock.",
				warningCodes: ["stock_cache_ready"],
				prerequisites: ["stock_cache_ready"],
				policy: "require_manager_override",
			},
		]);
		store.setResourceStates([
			{
				resourceId: "bootstrap_config",
				status: "limited",
				lastSyncedAt: "2026-04-09T12:00:00.000Z",
				watermark: null,
				lastSuccessHash: null,
				lastError: null,
				consecutiveFailures: 0,
				scopeSignature: "profile:Main POS",
				schemaVersion: null,
			},
			{
				resourceId: "currency_matrix",
				status: "error",
				lastSyncedAt: null,
				watermark: null,
				lastSuccessHash: null,
				lastError: "Timed out while refreshing exchange rates.",
				consecutiveFailures: 2,
				scopeSignature: "company:Test Co",
				schemaVersion: null,
			},
		]);

		const wrapper = mount(OfflineStatusPanel, {
			props: {
				modelValue: true,
			},
			slots: {
				activator: "<button data-test='activator'>status</button>",
			},
			global: {
				components: {
					VMenu: VMenuStub,
					VBtn: VBtnStub,
					VCard: SimpleStub,
					VCardTitle: SimpleStub,
					VCardText: SimpleStub,
					VCardActions: SimpleStub,
					VChip: SimpleStub,
					VDivider: SimpleStub,
					VIcon: SimpleStub,
				},
			},
		});

		expect(body().get('[data-test="offline-status-panel"]').text()).toContain(
			"Pricing Offline",
		);
		expect(body().text()).toContain(
			"Offline pricing is unverified. Offers, customer pricing, taxes, or discounts may differ after reconnect.",
		);
		expect(body().text()).toContain("Stock Confidence Offline");
		expect(body().text()).toContain(
			"Collect a local supervisor PIN or privileged approval before selling uncertain stock.",
		);
		expect(body().text()).toContain("bootstrap_config");
		expect(body().text()).toContain("currency_matrix");
		expect(body().text()).toContain(
			"Timed out while refreshing exchange rates.",
		);
		expect(body().get('[data-test="offline-status-action-refresh"]').text()).toContain(
			"Refresh Offline Data",
		);
		expect(body().get('[data-test="offline-status-action-rebuild"]').text()).toContain(
			"Rebuild Offline Data",
		);
		expect(body().get('[data-test="offline-status-action-clear-cache"]').text()).toContain(
			"Clear Cache",
		);
		expect(body().get('[data-test="offline-status-action-diagnostics"]').text()).toContain(
			"View Data Diagnostics",
		);
	});

	it("emits repair actions from the panel surface", async () => {
		const store = useOfflineSyncStore();
		store.setSummary({
			networkOnline: false,
			serverOnline: false,
			serverConnecting: false,
			manualOffline: true,
			pendingInvoices: 0,
			cacheUsage: 12,
			cacheUsageDetails: { total: 1024, indexedDB: 768, localStorage: 256 },
		});

		const Parent = defineComponent({
			components: { OfflineStatusPanel },
			setup() {
				return {
					toggleCount: ref(0),
					refreshCount: ref(0),
					rebuildCount: ref(0),
					clearCacheCount: ref(0),
					diagnosticCount: ref(0),
				};
			},
			template: `
				<OfflineStatusPanel
					:model-value="true"
					@toggle-offline="toggleCount += 1"
					@refresh-offline-data="refreshCount += 1"
					@rebuild-offline-data="rebuildCount += 1"
					@clear-cache="clearCacheCount += 1"
					@open-diagnostics="diagnosticCount += 1"
				/>
			`,
		});

		const wrapper = mount(Parent, {
			global: {
				components: {
					VMenu: VMenuStub,
					VBtn: VBtnStub,
					VCard: SimpleStub,
					VCardTitle: SimpleStub,
					VCardText: SimpleStub,
					VCardActions: SimpleStub,
					VChip: SimpleStub,
					VDivider: SimpleStub,
					VIcon: SimpleStub,
				},
			},
		});

		await body().get('[data-test="offline-status-action-connectivity"]').trigger("click");
		await body().get('[data-test="offline-status-action-refresh"]').trigger("click");
		await body().get('[data-test="offline-status-action-rebuild"]').trigger("click");
		await body().get('[data-test="offline-status-action-clear-cache"]').trigger("click");
		await body().get('[data-test="offline-status-action-diagnostics"]').trigger("click");

		expect((wrapper.vm as any).toggleCount).toBe(1);
		expect((wrapper.vm as any).refreshCount).toBe(1);
		expect((wrapper.vm as any).rebuildCount).toBe(1);
		expect((wrapper.vm as any).clearCacheCount).toBe(1);
		expect((wrapper.vm as any).diagnosticCount).toBe(1);
	});
	it("shows denied storage protection and lets the cashier retry", async () => {
		const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		Object.defineProperty(navigator, "storage", { configurable: true, value: {
			persisted: async () => false, persist,
		} });
		const wrapper = mount(OfflineStatusPanel, {
			props: { modelValue: true },
			global: { components: { VCard: SimpleStub, VChip: SimpleStub } },
		});
		await flushPromises();
		await body().get('[data-test="storage-persistence-request"]').trigger("click");
		await flushPromises();
		expect(body().get('[data-test="storage-persistence-status"]').text()).toContain("did not grant");
		await body().get('[data-test="storage-persistence-request"]').trigger("click");
		await flushPromises();
		expect(body().get('[data-test="storage-persistence-status"]').text()).toContain("protection is enabled");
		expect(body().find('[data-test="storage-persistence-request"]').exists()).toBe(false);
		wrapper.unmount();
	});

	it("keeps unassigned legacy work visible as a recovery warning without exposing payloads", async () => {
		vi.mocked(writeQueue.getLegacyQueueRecoveryCount).mockResolvedValueOnce(2);
		const wrapper = mount(OfflineStatusPanel, {
			props: { modelValue: true },
			global: { components: { VCard: SimpleStub, VChip: SimpleStub } },
		});
		await flushPromises();
		expect(body().get('[data-test="legacy-queue-recovery"]').text()).toContain("check invoice names and request IDs");
		expect(body().find('[data-test="legacy-queue-export"]').exists()).toBe(false);
		wrapper.unmount();
	});

	it.each([390, 1440])("escapes a clipping navbar at %spx and closes through its real teleported control", async (width) => {
		const previousWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
		const navbar = document.createElement("div");
		navbar.style.cssText = "height:60px;overflow:hidden;transform:translateZ(0)";
		document.body.appendChild(navbar);
		const opened = ref(true);
		const Parent = defineComponent({
			setup: () => () => h(OfflineStatusPanel, {
				modelValue: opened.value,
				"onUpdate:modelValue": (value: boolean) => { opened.value = value; },
			}),
		});
		const wrapper = mount(Parent, {
			attachTo: navbar,
			global: { stubs: { ShiftTerminalStatus: true }, components: { VCard: SimpleStub, VChip: SimpleStub } },
		});
		try {
			await flushPromises();
			const panel = document.querySelector('[data-test="offline-status-panel"]');
			expect(panel?.parentElement).toBe(document.body);
			expect(navbar.querySelector('[data-test="offline-status-panel"]')).toBeNull();
			expect(panel?.classList.contains("pos-themed-card")).toBe(true);
			(panel!.querySelector('.offline-status-panel__close') as HTMLButtonElement).click();
			await flushPromises();
			expect(opened.value).toBe(false);
			await vi.waitFor(() => expect(document.querySelector('[data-test="offline-status-panel"]')).toBeNull());
		} finally {
			wrapper.unmount();
			navbar.remove();
			Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
		}
	});

});
