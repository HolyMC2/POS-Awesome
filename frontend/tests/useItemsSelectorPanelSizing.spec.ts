import { describe, expect, it } from "vitest";
import { ref } from "vue";

import { useItemsSelectorPanelSizing } from "../src/posapp/composables/pos/items/useItemsSelectorPanelSizing";

const PHONE_HEIGHT = "calc(var(--viewport-height) - var(--bottom-safe-space) - 24px)";

describe("useItemsSelectorPanelSizing", () => {
	// The panel used to be pinned to `--container-height` (a 58-74vh guess) with
	// `overflow: auto`, which scrolled internally whenever the guess undershot
	// the real column while the page scrolled whenever it overshot. Desktop now
	// takes the leftover space via the CSS flex chain instead, so the composable
	// must contribute NO height at all.
	it("sets no height on desktop so the flex chain owns the sizing", () => {
		const sizing = useItemsSelectorPanelSizing({
			isPhone: ref(false),
			windowWidth: ref(1280),
			windowHeight: ref(860),
			responsiveStyles: ref({ "--container-height": "640px" }),
		});

		const style = sizing.selectorCardStyle.value;
		expect(style).toEqual({ overflow: "hidden", position: "relative" });
		expect(style.height).toBeUndefined();
		expect(style.maxHeight).toBeUndefined();
		expect(style.minHeight).toBeUndefined();
	});

	it("ignores --container-height entirely on desktop", () => {
		const responsiveStyles = ref({ "--container-height": "640px" });
		const sizing = useItemsSelectorPanelSizing({
			isPhone: ref(false),
			windowWidth: ref(1600),
			windowHeight: ref(1200),
			responsiveStyles,
		});

		const before = { ...sizing.selectorCardStyle.value };
		responsiveStyles.value = { "--container-height": "58vh" };
		expect(sizing.selectorCardStyle.value).toEqual(before);
	});

	// Desktop must never scroll the card itself — the virtual scroller inside
	// `.selector-results-card` is the single scrollport for this column.
	it("never gives the desktop card its own scrollbar", () => {
		for (const width of [1100, 1279, 1280, 1920]) {
			const sizing = useItemsSelectorPanelSizing({
				isPhone: ref(false),
				windowWidth: ref(width),
				windowHeight: ref(900),
				responsiveStyles: ref({ "--container-height": "640px" }),
			});
			expect(sizing.selectorCardStyle.value.overflow).toBe("hidden");
		}
	});

	// Phone keeps an explicit height: the document scrolls below 768px and the
	// fixed dock eats the bottom, so the panel has to be told its real room.
	it("keeps the explicit viewport height constraints on phones", () => {
		const sizing = useItemsSelectorPanelSizing({
			isPhone: ref(true),
			windowWidth: ref(390),
			windowHeight: ref(780),
			responsiveStyles: ref({ "--container-height": "640px" }),
		});

		expect(sizing.selectorCardStyle.value).toMatchObject({
			height: PHONE_HEIGHT,
			maxHeight: PHONE_HEIGHT,
			minHeight: "calc(var(--viewport-height) * 0.46)",
			overflow: "hidden",
		});
	});

	it("still reports the resize capability threshold", () => {
		const large = useItemsSelectorPanelSizing({
			isPhone: ref(false),
			windowWidth: ref(1280),
			windowHeight: ref(860),
			responsiveStyles: ref({}),
		});
		const small = useItemsSelectorPanelSizing({
			isPhone: ref(false),
			windowWidth: ref(1279),
			windowHeight: ref(860),
			responsiveStyles: ref({}),
		});

		expect(large.canResizeSelectorPanel.value).toBe(true);
		expect(small.canResizeSelectorPanel.value).toBe(false);
		// ...but it no longer puts a drag handle on the panel: that handle only
		// existed so the operator could drag around a wrong computed height.
		expect(large.selectorCardStyle.value.resize).toBeUndefined();
		expect(small.selectorCardStyle.value.resize).toBeUndefined();
	});
});
