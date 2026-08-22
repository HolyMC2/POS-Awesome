// @vitest-environment jsdom

/**
 * What the cajón's chrome actually does when mounted (roadmap §17.7).
 *
 * The composable decides policy (`catalogDrawerState.spec.ts`); this file
 * covers the half that only exists in the DOM: the focus trap, the scrim, the
 * category chips, and the ARIA that must follow the behaviour rather than
 * lead it — an anchored panel is announced as a complementary region because
 * it genuinely is one, and only the overlay claims `aria-modal`.
 *
 * Vuetify is not installed here; this component deliberately uses plain
 * elements, so nothing needs stubbing — same reason tests/changeDueDialog
 * stubs and this one does not.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import CatalogDrawer from "../src/posapp/components/pos/shell/drawer/CatalogDrawer.vue";
import type { CatalogCategory } from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const CATEGORIES: CatalogCategory[] = [
	{ id: "combos", label: "Combos", count: 6, featured: true },
	{ id: "fundas", label: "Fundas", count: 18 },
	{ id: "sin-conteo", label: "Sin conteo" },
];

/*
 * Listener props rather than `wrapper.emitted()`, matching tests/changeDueDialog:
 * VTU records only the native events that bubble to this wrapper's root, so an
 * `emit()` from inside `<script setup>` never reaches `emitted()` here. The spy
 * is the honest observation point.
 */
function mountDrawer(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
	return mount(CatalogDrawer, {
		attachTo: document.body,
		props: {
			phase: "open",
			presentation: "anchored",
			categories: CATEGORIES,
			activeCategory: "combos",
			...props,
		},
		slots,
	});
}

describe("rendering", () => {
	it("keeps the panel mounted while closed, hidden by the layer alone", () => {
		// The panel deliberately survives the closed state. `useScannerInput`
		// binds the keyboard wedge to the document behind a singleton flag, so
		// unmounting anything in here once takes the shop's barcode gun down
		// until a reload. `display: none` on the layer is the only hiding
		// mechanism, and it is what keeps the hidden panel inert.
		const wrapper = mountDrawer({ phase: "closed" });
		expect(wrapper.find('[data-testid="catalog-drawer-panel"]').exists()).toBe(true);
		expect(wrapper.attributes("data-drawer-state")).toBe("closed");
		expect(wrapper.classes()).toContain("catalog-drawer-layer--closed");
		wrapper.unmount();
	});

	it("renders persistent slot content, and renders no wrapper without it", () => {
		const without = mountDrawer();
		expect(without.find(".catalog-drawer__persistent").exists()).toBe(false);
		without.unmount();

		const wrapper = mountDrawer({}, { persistent: '<p class="grid">catalogue</p>' });
		expect(wrapper.find(".catalog-drawer__persistent .grid").exists()).toBe(true);
		wrapper.unmount();
	});

	it("puts persistent content inside the panel body, not beside the chrome", () => {
		// The visual bug this closes: the grid sitting in the selector column
		// next to the drawer instead of within it.
		const wrapper = mountDrawer({}, { persistent: '<p class="grid">catalogue</p>' });
		const grid = wrapper.find(".grid").element;
		const body = wrapper.find(".catalog-drawer__body").element;
		const panel = wrapper.find('[data-testid="catalog-drawer-panel"]').element;
		expect(body.contains(grid)).toBe(true);
		expect(panel.contains(grid)).toBe(true);
		wrapper.unmount();
	});

	it("puts the slotted catalogue in the body rather than re-creating it", () => {
		const wrapper = mountDrawer({}, { default: '<p class="slotted">selector</p>' });
		expect(wrapper.find(".catalog-drawer__body .slotted").exists()).toBe(true);
		wrapper.unmount();
	});

	it("renders the compat strip only when the register supplies one", () => {
		const without = mountDrawer();
		expect(without.find(".catalog-drawer__compat").exists()).toBe(false);
		without.unmount();

		const with_ = mountDrawer({}, { compat: "<span>iPhone 15 Pro</span>" });
		expect(with_.find(".catalog-drawer__compat").exists()).toBe(true);
		with_.unmount();
	});

	it("renders no chip row when the register feeds no categories", () => {
		// A shell that prefers the selector's own grouping passes none and must
		// not get a second row of chips.
		const wrapper = mountDrawer({ categories: [] });
		expect(wrapper.find(".catalog-drawer__chips").exists()).toBe(false);
		wrapper.unmount();
	});

	it("omits the count on a category that has none, rather than printing 0", () => {
		const wrapper = mountDrawer();
		const chip = wrapper.find('[data-testid="catalog-drawer-category-sin-conteo"]');
		expect(chip.find(".catalog-drawer__count").exists()).toBe(false);
		wrapper.unmount();
	});

	it("always promises Esc, because the artboard footer does", () => {
		const wrapper = mountDrawer();
		expect(wrapper.find(".catalog-drawer__footer").text()).toContain("Esc");
		wrapper.unmount();
	});
});

describe("semantics follow behaviour", () => {
	it("anchored is a complementary region, not a modal", () => {
		const wrapper = mountDrawer({ presentation: "anchored", trapsFocus: false });
		const root = wrapper.find('[data-testid="catalog-drawer-panel"]');
		expect(root.attributes("role")).toBeUndefined();
		expect(root.attributes("aria-modal")).toBeUndefined();
		expect(root.element.tagName).toBe("ASIDE");
		wrapper.unmount();
	});

	it("overlay claims dialog and aria-modal, because it does trap", () => {
		const wrapper = mountDrawer({ presentation: "overlay", trapsFocus: true });
		const root = wrapper.find('[data-testid="catalog-drawer-panel"]');
		expect(root.attributes("role")).toBe("dialog");
		expect(root.attributes("aria-modal")).toBe("true");
		wrapper.unmount();
	});

	it("marks the active category with aria-selected, not colour alone", () => {
		const wrapper = mountDrawer();
		expect(
			wrapper.find('[data-testid="catalog-drawer-category-combos"]').attributes("aria-selected"),
		).toBe("true");
		expect(
			wrapper.find('[data-testid="catalog-drawer-category-fundas"]').attributes("aria-selected"),
		).toBe("false");
		wrapper.unmount();
	});
});

describe("scrim", () => {
	it("appears only when asked, and closing is one click away", async () => {
		const onClose = vi.fn();
		const wrapper = mountDrawer({ showsScrim: true, presentation: "overlay", onClose });
		const scrim = wrapper.find('[data-testid="catalog-drawer-scrim"]');
		expect(scrim.exists()).toBe(true);

		await scrim.trigger("click");
		expect(onClose).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("is absent when anchored, so the register is never dimmed beside it", () => {
		const wrapper = mountDrawer({ showsScrim: false });
		expect(wrapper.find('[data-testid="catalog-drawer-scrim"]').exists()).toBe(false);
		wrapper.unmount();
	});
});

describe("category selection", () => {
	it("emits the picked category", async () => {
		const onPick = vi.fn();
		const wrapper = mountDrawer({ "onUpdate:activeCategory": onPick });
		await wrapper.find('[data-testid="catalog-drawer-category-fundas"]').trigger("click");
		expect(onPick).toHaveBeenCalledWith("fundas");
		wrapper.unmount();
	});

	it("clicking the active category clears it instead of re-selecting it", async () => {
		// A second click on the same chip means "show me everything again".
		const onPick = vi.fn();
		const wrapper = mountDrawer({ "onUpdate:activeCategory": onPick });
		await wrapper.find('[data-testid="catalog-drawer-category-combos"]').trigger("click");
		expect(onPick).toHaveBeenCalledWith(null);
		wrapper.unmount();
	});
});

describe("anchor toggle", () => {
	it("is offered only where anchoring fits", () => {
		const narrow = mountDrawer({ canAnchor: false });
		expect(narrow.find('[data-testid="catalog-drawer-anchor"]').exists()).toBe(false);
		narrow.unmount();

		const wide = mountDrawer({ canAnchor: true });
		expect(wide.find('[data-testid="catalog-drawer-anchor"]').exists()).toBe(true);
		wide.unmount();
	});

	it("reports its state with aria-pressed and asks for the opposite", async () => {
		const onAnchor = vi.fn();
		const wrapper = mountDrawer({
			canAnchor: true,
			presentation: "anchored",
			"onUpdate:anchored": onAnchor,
		});
		const toggle = wrapper.find('[data-testid="catalog-drawer-anchor"]');
		expect(toggle.attributes("aria-pressed")).toBe("true");

		await toggle.trigger("click");
		expect(onAnchor).toHaveBeenCalledWith(false);
		wrapper.unmount();
	});
});

describe("keyboard", () => {
	it("closes on Escape and consumes the key", async () => {
		const onClose = vi.fn();
		const wrapper = mountDrawer({ onClose });
		await wrapper
			.find('[data-testid="catalog-drawer-panel"]')
			.trigger("keydown", { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("traps Tab inside the overlay, wrapping last → first", async () => {
		const wrapper = mountDrawer(
			{ presentation: "overlay", trapsFocus: true },
			{ default: '<button class="inner">add</button>' },
		);

		const focusable = wrapper.vm.focusableChildren();
		expect(focusable.length).toBeGreaterThan(1);
		const first = focusable[0]!;
		const last = focusable[focusable.length - 1]!;

		last.focus();
		expect(document.activeElement).toBe(last);
		await wrapper.find('[data-testid="catalog-drawer-panel"]').trigger("keydown", { key: "Tab" });
		expect(document.activeElement).toBe(first);

		wrapper.unmount();
	});

	it("wraps first → last on Shift+Tab", async () => {
		const wrapper = mountDrawer(
			{ presentation: "overlay", trapsFocus: true },
			{ default: '<button class="inner">add</button>' },
		);

		const focusable = wrapper.vm.focusableChildren();
		const first = focusable[0]!;
		const last = focusable[focusable.length - 1]!;

		first.focus();
		await wrapper
			.find('[data-testid="catalog-drawer-panel"]')
			.trigger("keydown", { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(last);

		wrapper.unmount();
	});

	it("does NOT trap Tab when anchored — the cart must stay reachable", async () => {
		const outside = document.createElement("button");
		document.body.appendChild(outside);

		const wrapper = mountDrawer(
			{ presentation: "anchored", trapsFocus: false },
			{ default: '<button class="inner">add</button>' },
		);

		const focusable = wrapper.vm.focusableChildren();
		const last = focusable[focusable.length - 1]!;
		last.focus();

		const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
		wrapper.find('[data-testid="catalog-drawer-panel"]').element.dispatchEvent(event);

		// Not prevented — the browser's own tab order carries focus out to the
		// cart, which is the entire point of an anchored panel.
		expect(event.defaultPrevented).toBe(false);

		wrapper.unmount();
		outside.remove();
	});
});
