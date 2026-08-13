// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";

import { useItemSelectorLayout } from "../src/posapp/composables/pos/items/useItemSelectorLayout";

type Layout = ReturnType<typeof useItemSelectorLayout>;

const mountLayout = () => {
	let layout!: Layout;
	const wrapper = mount(
		defineComponent({
			setup() {
				layout = useItemSelectorLayout();
				return () => h("div");
			},
		}),
	);
	return { layout, wrapper };
};

/**
 * Rebuilds the real card-view DOM: the selector shell carries
 * `--container-height` as a vh token (that is what `useResponsive` emits), the
 * sticky search header is a sibling of the results card, and the card grid is a
 * virtual scroller inside `.items-card-container`.
 */
const buildDom = ({
	containerHeightVar = "70vh",
	headerHeight = 56,
	scrollHeight = 2400,
	clientHeight = 620,
} = {}) => {
	document.body.innerHTML = `
		<div class="items-selector-shell" style="--container-height: ${containerHeightVar}">
			<div class="dynamic-padding">
				<div class="sticky-header"></div>
				<div class="selector-results-card">
					<div class="items-card-container">
						<div class="virtual-scroller"></div>
					</div>
				</div>
			</div>
		</div>
	`;

	const header = document.querySelector(".sticky-header") as HTMLElement;
	const container = document.querySelector(".items-card-container") as HTMLElement;
	const scroller = document.querySelector(".virtual-scroller") as HTMLElement;

	// Restated on the container itself: in the browser the token INHERITS from
	// the shell, but jsdom's getComputedStyle does not inherit custom
	// properties — without this the regression guard below is false-green
	// (parseFloat("") is NaN, so even the broken code took an early return).
	container.style.setProperty("--container-height", containerHeightVar);

	Object.defineProperty(header, "offsetHeight", { value: headerHeight, configurable: true });
	Object.defineProperty(scroller, "scrollHeight", { value: scrollHeight, configurable: true });
	Object.defineProperty(scroller, "clientHeight", { value: clientHeight, configurable: true });

	return { container, scroller };
};

describe("useItemSelectorLayout — checkItemContainerOverflow", () => {
	it("never writes an inline max-height on the card container", async () => {
		// REGRESSION (prod cafetería demo, 2026-08-13): the old implementation
		// did parseFloat(getComputedStyle(el).getPropertyValue("--container-height")).
		// A custom property computes to its SPECIFIED token, so that read "70vh"
		// as the NUMBER 70, subtracted the 56px sticky header, and pinned the
		// grid at max-height:14px — every item card clipped to a sliver.
		const { container } = buildDom();
		const { layout, wrapper } = mountLayout();

		layout.itemsContainerRef.value = container;
		await nextTick();
		layout.checkItemContainerOverflow();

		expect(container.style.maxHeight).toBe("");
		wrapper.unmount();
	});

	it("reports overflow from the scroller's own measurements", async () => {
		const { container } = buildDom({ scrollHeight: 2400, clientHeight: 620 });
		const { layout, wrapper } = mountLayout();

		layout.itemsContainerRef.value = container;
		await nextTick();
		layout.checkItemContainerOverflow();

		expect(layout.isOverflowing.value).toBe(true);
		wrapper.unmount();
	});

	it("reports no overflow when the grid fits", async () => {
		const { container } = buildDom({ scrollHeight: 400, clientHeight: 620 });
		const { layout, wrapper } = mountLayout();

		layout.itemsContainerRef.value = container;
		await nextTick();
		layout.checkItemContainerOverflow();

		expect(layout.isOverflowing.value).toBe(false);
		wrapper.unmount();
	});

	it("stays inert when the container ref is unbound (list view)", () => {
		buildDom();
		const { layout, wrapper } = mountLayout();

		layout.checkItemContainerOverflow();

		expect(layout.isOverflowing.value).toBe(false);
		wrapper.unmount();
	});
});
