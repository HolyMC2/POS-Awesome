// @vitest-environment jsdom

/**
 * The cajón's DOM state contract, driven by the real composable.
 *
 * `catalogDrawerState.spec.ts` proves the machine; `catalogDrawerComponent`
 * proves the chrome. This file is the seam between them, and it exists because
 * the screenshot/e2e lane selects on it: the drawer publishes
 * `data-drawer-state` and `data-open-reason` so a harness can wait for a
 * settled state instead of racing a label or sleeping on a guess.
 *
 * Selecting on a class would tie the evidence lane to styling, and a restyle
 * would silently start screenshotting the wrong frame. These attributes are a
 * contract; the classes are not.
 */

import { defineComponent, h, nextTick, onMounted, onUnmounted, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CatalogDrawer from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue";
import {
	CATALOG_DRAWER_CLOSE_MS,
	CATALOG_DRAWER_OPEN_MS,
	useCatalogDrawer,
	type CatalogCategory,
	type CatalogDrawerOpenReason,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const CATEGORIES: CatalogCategory[] = [
	{ id: "combos", label: "Combos", count: 6, featured: true },
	{ id: "fundas", label: "Fundas", count: 18 },
];

/**
 * Counts its own lifecycle. Standing in for `ItemsView`, whose `useScannerInput`
 * binds the keyboard wedge to the DOCUMENT behind a singleton flag: unmount it
 * once and the shop's barcode gun stops working until a reload. So "mounted
 * exactly once, never unmounted" is a hard guarantee, and this is how it is
 * proven — a screenshot cannot see it.
 */
const lifecycle = { mounted: 0, unmounted: 0 };

/*
 * Counted through a forwarded listener rather than `emitted()`: VTU here
 * records only native events that bubble to the wrapper root, so an `emit()`
 * from inside `<script setup>` never reaches `emitted()`. Same reason
 * tests/changeDueDialog uses listener props.
 */
const openedCount = { value: 0 };

const ScannerProbe = defineComponent({
	setup() {
		onMounted(() => {
			lifecycle.mounted += 1;
		});
		onUnmounted(() => {
			lifecycle.unmounted += 1;
		});
		return () => h("p", { class: "scanner-probe", "data-testid": "scanner-probe" }, "catalogue");
	},
});

/**
 * The wiring the shell will do, in miniature: composable in, props out. Kept
 * faithful so this test fails if that binding is ever wrong, not merely if the
 * component is.
 */
const Host = defineComponent({
	props: { width: { type: Number, default: 900 } },
	setup(props, { expose }) {
		const registerId = ref("Caja 2");
		const viewportWidth = ref(props.width);
		const categories = ref<CatalogCategory[]>([...CATEGORIES]);
		const drawer = useCatalogDrawer({ registerId, viewportWidth, categories });
		expose({ drawer });

		return () =>
			h(
				CatalogDrawer,
				{
					phase: drawer.phase.value,
					presentation: drawer.presentation.value,
					openReason: drawer.openReason.value,
					categories: categories.value,
					activeCategory: drawer.activeCategory.value,
					trapsFocus: drawer.trapsFocus.value,
					showsScrim: drawer.showsScrim.value,
					transitionDurationMs: drawer.transitionDurationMs.value,
					canAnchor: drawer.fitsAnchored.value,
					onClose: () => drawer.close(),
					onOpened: () => {
						openedCount.value += 1;
					},
				},
				// Provided UNCONDITIONALLY, as the slot's contract requires.
				{ persistent: () => h(ScannerProbe) },
			);
	},
});

function mountHost(width = 900) {
	return mount(Host, { attachTo: document.body, props: { width } });
}

async function settle(ms: number) {
	vi.advanceTimersByTime(ms);
	await nextTick();
}

function stateOf(wrapper: ReturnType<typeof mountHost>): string | undefined {
	return wrapper.find('[data-testid="catalog-drawer"]').attributes("data-drawer-state");
}

function reasonOf(wrapper: ReturnType<typeof mountHost>): string | undefined {
	return wrapper.find('[data-testid="catalog-drawer"]').attributes("data-open-reason");
}

beforeEach(() => {
	vi.useFakeTimers();
	window.sessionStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("data-drawer-state tracks the machine", () => {
	it("is present and closed before anything happens", () => {
		// Present, not absent: the harness needs something to select before the
		// first open, or its very first wait has nothing to wait on.
		const wrapper = mountHost();
		expect(wrapper.find('[data-testid="catalog-drawer"]').exists()).toBe(true);
		expect(stateOf(wrapper)).toBe("closed");
		expect(reasonOf(wrapper)).toBeUndefined();
		wrapper.unmount();
	});

	it("walks closed → opening → open → closing → closed across a full cycle", async () => {
		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await nextTick();
		expect(stateOf(wrapper)).toBe("opening");

		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(stateOf(wrapper)).toBe("open");

		drawer.close();
		await nextTick();
		expect(stateOf(wrapper)).toBe("closing");

		await settle(CATALOG_DRAWER_CLOSE_MS);
		expect(stateOf(wrapper)).toBe("closed");
		wrapper.unmount();
	});

	it("returns to closed by the ESC path", async () => {
		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("shortcut");
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(stateOf(wrapper)).toBe("open");

		await wrapper
			.find('[data-testid="catalog-drawer-panel"]')
			.trigger("keydown", { key: "Escape" });
		expect(stateOf(wrapper)).toBe("closing");

		await settle(CATALOG_DRAWER_CLOSE_MS);
		expect(stateOf(wrapper)).toBe("closed");
		wrapper.unmount();
	});

	it("returns to closed by the scrim path", async () => {
		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);

		await wrapper.find('[data-testid="catalog-drawer-scrim"]').trigger("click");
		expect(stateOf(wrapper)).toBe("closing");

		await settle(CATALOG_DRAWER_CLOSE_MS);
		expect(stateOf(wrapper)).toBe("closed");
		wrapper.unmount();
	});

	it("settles in one step when anchored, since anchored never animates", async () => {
		const wrapper = mountHost(1440);
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await settle(0);
		expect(stateOf(wrapper)).toBe("open");
		expect(
			wrapper.find('[data-testid="catalog-drawer-panel"]').attributes("data-presentation"),
		).toBe("anchored");
		wrapper.unmount();
	});
});

describe("data-open-reason", () => {
	it.each<[CatalogDrawerOpenReason]>([["rail"], ["scan-miss"], ["shortcut"], ["empty-cart"]])(
		"publishes %s so the harness can screenshot each entry path",
		async (reason) => {
			const wrapper = mountHost();
			const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

			drawer.open(reason);
			await settle(CATALOG_DRAWER_OPEN_MS);

			expect(reasonOf(wrapper)).toBe(reason);
			wrapper.unmount();
		},
	);

	it("lands a scan miss on no category, and a rail open on the remembered one", async () => {
		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);
		drawer.setCategory("fundas");
		drawer.close();
		await settle(CATALOG_DRAWER_CLOSE_MS);

		drawer.open("scan-miss");
		await settle(CATALOG_DRAWER_OPEN_MS);
		// The barcode that failed may be in any category; filtering to the last
		// one would hide it.
		expect(drawer.activeCategory.value).toBeNull();

		drawer.close();
		await settle(CATALOG_DRAWER_CLOSE_MS);
		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(drawer.activeCategory.value).toBe("fundas");
		wrapper.unmount();
	});
});

describe("the persistent slot never unmounts", () => {
	it("mounts once and survives a full closed → open → closed cycle", async () => {
		lifecycle.mounted = 0;
		lifecycle.unmounted = 0;

		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		// Present and mounted before the drawer has ever opened.
		expect(lifecycle.mounted).toBe(1);
		expect(wrapper.find('[data-testid="scanner-probe"]').exists()).toBe(true);
		const node = wrapper.find('[data-testid="scanner-probe"]').element;

		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(stateOf(wrapper)).toBe("open");

		drawer.close();
		await settle(CATALOG_DRAWER_CLOSE_MS);
		expect(stateOf(wrapper)).toBe("closed");

		// The guarantee: one mount, zero unmounts, and the SAME DOM node —
		// a re-created node would mean the component was torn down and rebuilt,
		// which is exactly what kills the wedge.
		expect(lifecycle.mounted).toBe(1);
		expect(lifecycle.unmounted).toBe(0);
		expect(wrapper.find('[data-testid="scanner-probe"]').element).toBe(node);
		expect(node.isConnected).toBe(true);

		wrapper.unmount();
	});

	it("survives repeated toggling, which is what a cashier actually does", async () => {
		lifecycle.mounted = 0;
		lifecycle.unmounted = 0;

		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };
		const node = wrapper.find('[data-testid="scanner-probe"]').element;

		for (let cycle = 0; cycle < 5; cycle += 1) {
			drawer.open("shortcut");
			await settle(CATALOG_DRAWER_OPEN_MS);
			drawer.close();
			await settle(CATALOG_DRAWER_CLOSE_MS);
		}

		expect(lifecycle.mounted).toBe(1);
		expect(lifecycle.unmounted).toBe(0);
		expect(wrapper.find('[data-testid="scanner-probe"]').element).toBe(node);
		wrapper.unmount();
	});

	it("stays mounted across the anchored ↔ overlay switch", async () => {
		lifecycle.mounted = 0;
		lifecycle.unmounted = 0;

		const wrapper = mountHost(1440);
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await settle(0);
		expect(
			wrapper.find('[data-testid="catalog-drawer-panel"]').attributes("data-presentation"),
		).toBe("anchored");

		// Un-anchoring re-parents nothing: the panel is the same element in both
		// presentations, which is why the persistent content can live inside it.
		drawer.setAnchored(false);
		await nextTick();
		expect(
			wrapper.find('[data-testid="catalog-drawer-panel"]').attributes("data-presentation"),
		).toBe("overlay");

		expect(lifecycle.mounted).toBe(1);
		expect(lifecycle.unmounted).toBe(0);
		wrapper.unmount();
	});

	it("fires `opened` once per open so a hidden grid can re-measure", async () => {
		openedCount.value = 0;
		const wrapper = mountHost();
		const { drawer } = wrapper.vm as unknown as { drawer: ReturnType<typeof useCatalogDrawer> };

		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(openedCount.value).toBe(1);

		// Not re-fired while it merely sits open.
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(openedCount.value).toBe(1);

		drawer.close();
		await settle(CATALOG_DRAWER_CLOSE_MS);
		drawer.open("rail");
		await settle(CATALOG_DRAWER_OPEN_MS);
		expect(openedCount.value).toBe(2);

		wrapper.unmount();
	});
});
