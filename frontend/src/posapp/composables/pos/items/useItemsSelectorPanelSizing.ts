import { computed, type CSSProperties, type Ref } from "vue";

type ResponsiveStyleMap = Record<string, string | number | undefined>;

type UseItemsSelectorPanelSizingArgs = {
	isPhone: Ref<boolean>;
	windowWidth: Ref<number>;
	windowHeight: Ref<number>;
	responsiveStyles: Ref<ResponsiveStyleMap>;
};

const PHONE_SELECTOR_HEIGHT =
	"calc(var(--viewport-height) - var(--bottom-safe-space) - 24px)";

export function useItemsSelectorPanelSizing({
	isPhone,
	windowWidth,
	windowHeight,
	responsiveStyles,
}: UseItemsSelectorPanelSizingArgs) {
	const canResizeSelectorPanel = computed(
		() => windowWidth.value >= 1280 && windowHeight.value >= 860,
	);

	const selectorCardStyle = computed<CSSProperties>(() => {
		if (isPhone.value) {
			// Phone keeps an explicit height: the document scrolls below 768px
			// and the fixed dock eats the bottom, so the panel has to be told
			// how much room it actually has. The virtual scroller owns all
			// vertical scroll here — letting the card scroll too gave two
			// nested scrollers and rows sliding behind the sticky search bar.
			return {
				height: PHONE_SELECTOR_HEIGHT,
				maxHeight: PHONE_SELECTOR_HEIGHT,
				minHeight: "calc(var(--viewport-height) * 0.46)",
				overflow: "hidden",
				position: "relative",
			};
		}

		// Desktop takes the leftover space in its column instead of a slice of
		// the viewport. The old version set `height: var(--container-height)`
		// (58–74vh, guessed per breakpoint in useResponsive) plus
		// `overflow: auto`, so the panel scrolled internally whenever the guess
		// undershot the real column — while the page scrolled whenever it
		// overshot. Both at once is what the cashier was fighting. The inner
		// chain is already correct: `.selector-header-card` is `flex: 0 0 auto`
		// and `.selector-results-card` is `flex: 1 1 auto; min-height: 0`, so
		// the virtual scroller ends up the single scrollport.
		return {
			overflow: "hidden",
			position: "relative",
		};
	});

	return {
		canResizeSelectorPanel,
		selectorCardStyle,
	};
}
