/**
 * Grid arithmetic for the item catalogue's CARD view.
 *
 * ## Why this file changed
 *
 * The catalogue used to be a permanent column of roughly 40% of a 1440 screen
 * — about 560px. It is now an anchored drawer of **400px** (`Cajon.dc.html`:
 * "anclado por defecto, empuja, nunca tapa"), and by the time the drawer's
 * chrome, the selector card's `--dynamic-sm` padding and the results card's
 * `--dynamic-xs` padding are paid for, `.items-card-container` measures about
 * **374px**.
 *
 * The old rule was `floor(width / 216)`. 374/216 is 1.7, so the drawer got ONE
 * column — and because `cardColumnWidth` then divides the whole container by
 * that one column, the single card grew to ~342 × 300px. That is the "one big
 * card" the owner photographed. Nothing was broken in the card; the track was
 * sized for a panel that no longer exists.
 *
 * ## What replaced it
 *
 * A minimum CARD width instead of a magic track, and arithmetic that pays for
 * the gap, the padding and the scrollbar gutter the grid actually sits inside —
 * the 216 pretended none of them existed, which is the second half of why the
 * old numbers overflowed as soon as they fitted.
 *
 * The target is the artboards, which both draw two columns at exactly the
 * widths we now have:
 *
 *   - `Cajon.dc.html` — a 400px drawer, `repeat(2, minmax(0,1fr))`, 10px gap,
 *     14px side padding: cards of ~181px.
 *   - `MovilExplorar.dc.html` — a 390px phone, the same two columns, 11px
 *     padding: cards of ~179px.
 *
 * So ~180px is the card the design draws, and `CARD_MIN_WIDTH` sits below it
 * at 148 so the narrowest real chain (a 360px phone, whose container measures
 * ~336px) still gets two columns rather than falling back to one giant card.
 * Below that — a 320px phone — one column is the honest answer.
 *
 * `Rejilla.dc.html` is the DISCARDED direction for this same trade-off: it put
 * a 440px text-only LIST beside the ticket. It was rejected because at a narrow
 * width a list of names is slower to hit than a wall of pictures — a cashier
 * recognises the case by its colour, not by reading "Anillo Case Honor X8A
 * Rojo". That is why the answer here is "smaller cards", never "drop the
 * images and make it a list".
 *
 * Everything here is pure and unit-tested (`tests/catalogCardGrid.spec.ts`);
 * `useItemSelectorLayout` measures, and this decides.
 */

/**
 * `.virtual-scroller` sets `scrollbar-gutter: stable` unconditionally, which
 * reserves this much of the container's content box whether or not a scrollbar
 * is painted. The old arithmetic ignored it and handed the grid the full
 * container width, so at two columns the right-hand card sat 8px outside its
 * own scrollport.
 */
export const CARD_SCROLLBAR_GUTTER = 8;

/**
 * The card we would rather draw, and the one every panel wider than the drawer
 * gets. Also the compact threshold: a card is compact exactly when the panel
 * could not afford this and it was squeezed to fit a second column in.
 */
export const CARD_PREFERRED_WIDTH = 200;

/**
 * The narrowest card we will draw at all. Under this a two-line name plus a
 * price and a stock figure stop fitting on one baseline, which is the moment
 * the card stops being faster to read than a list — the trade-off
 * `Rejilla.dc.html` was rejected over.
 */
export const CARD_MIN_WIDTH = 148;

/** Cards stop being scannable and start being wallpaper past this. */
export const CARD_MAX_COLUMNS = 6;

/**
 * Under this the card switches to its compact anatomy — same four things
 * (picture, name, code, price + stock), smaller. See `ItemCard.vue`.
 */
export const COMPACT_CARD_MAX_WIDTH = CARD_PREFERRED_WIDTH;

/**
 * Dense desk tier — a landscape tablet (or a laptop) keeping the two-column
 * register: ≥1100px wide (the shell's own compact boundary) but ≤820px tall.
 * HEIGHT is what starves that screen, not width: at 1195×741 the anchored
 * drawer showed one row of 280px cards and the cart table got 86px (Marco,
 * 08-30). These two numbers are the media query every CSS tier of the same
 * name carries — `tests/denseDeskTier.spec.ts` keeps them in lockstep.
 */
export const DENSE_DESK_MIN_WIDTH = 1100;
export const DENSE_DESK_MAX_HEIGHT = 820;
/**
 * The mini card the dense tier packs: 68px plate, one-line name, no code.
 * 112 so that Marco's 1143px window — a 407px anchored drawer, 375px of
 * usable row — still seats three; at 124 it fell back to two 181px cards
 * whose 68px plates read as a strip of letterboxed thumbnails.
 */
export const DENSE_CARD_MIN_WIDTH = 112;
/** 64px plate + one-line name + price line + a stock chip allowed to wrap under it. */
export const DENSE_CARD_ROW_HEIGHT = 132;
/**
 * Gap AND container padding on the dense tier. The 405px drawer of a 1143px
 * window hands the scroller ~385px; at the roomy 12/12 that is 353px of row
 * and two columns, at 8/8 it is 361px and three 115px columns.
 */
export const DENSE_CARD_GUTTER = 8;

export type CardGeometryOptions = { dense?: boolean };

export const isDenseDeskViewport = (windowWidth: number, windowHeight: number): boolean =>
	windowWidth >= DENSE_DESK_MIN_WIDTH && windowHeight > 0 && windowHeight <= DENSE_DESK_MAX_HEIGHT;

/**
 * Columns from the MEASURED container width (never the window). The grid lives
 * in panels of very different widths — the 400px drawer, the phone's full-width
 * tab, a wide purchase panel — so only the container can size it.
 *
 * `gap` and `padding` are the ones the grid will actually be laid out with, so
 * the count and the width agree; defaults are the desktop values.
 */
export const getCardColumnsForContainer = (
	width: number,
	gap: number = 16,
	padding: number = 16,
	options: CardGeometryOptions = {},
): number => {
	if (!width || width <= 0) {
		// 0 means "not measured yet" — the caller falls back to the window
		// buckets until the ResizeObserver reports. Never 1, which would read
		// as a decision.
		return 0;
	}
	const usable = width - CARD_SCROLLBAR_GUTTER - padding * 2;
	if (usable <= 0) {
		return 1;
	}
	// n cards of w need n*w + (n-1)*gap. Adding one gap to both sides of that
	// inequality turns it into a plain division.
	const fit = (cardWidth: number) => Math.floor((usable + gap) / (cardWidth + gap));
	if (options.dense) {
		// Pack the mini card: a 441px anchored drawer seats three 128px
		// columns where the roomy rule below seats two 208px posters.
		return Math.max(1, Math.min(CARD_MAX_COLUMNS, fit(DENSE_CARD_MIN_WIDTH)));
	}

	// TWO TIERS, and the second one is the whole fix.
	//
	// A wide panel packs at the preferred width, exactly as it did before —
	// a 560px legacy column still gets 2 columns of ~252px, a 900px purchase
	// panel 4 of ~203px. Packing everything at CARD_MIN_WIDTH instead would
	// have shredded those into five and six tiny cards to fix a defect that
	// only existed at 400px.
	//
	// A narrow panel that cannot afford two preferred cards but CAN afford two
	// minimum ones takes them. That is the drawer: 374px of container holds two
	// 159px cards and cannot hold two 200px ones, and one 334px card is not a
	// grid — it is the poster the owner photographed. Never three at the
	// squeezed width; the squeeze buys the second column and nothing more.
	const preferred = fit(CARD_PREFERRED_WIDTH);
	const columns = preferred >= 2 ? preferred : Math.min(2, fit(CARD_MIN_WIDTH));
	return Math.max(1, Math.min(CARD_MAX_COLUMNS, columns));
};

/**
 * The width of one card, given the count above.
 *
 * The old version floored at 180px, which is precisely how a narrow container
 * came to hold a card wider than itself: the floor overrode the division
 * instead of the column count absorbing it. The count now guarantees the
 * result clears `CARD_MIN_WIDTH` whenever the container can afford it, so this
 * only has to divide honestly.
 */
export const getCardColumnWidth = (
	containerWidth: number,
	columns: number,
	gap: number = 16,
	padding: number = 16,
): number => {
	const count = Math.max(1, columns);
	const usable = containerWidth - CARD_SCROLLBAR_GUTTER - padding * 2;
	const width = Math.floor((usable - gap * (count - 1)) / count);
	return Math.max(0, width);
};

/**
 * Does a grid of `columns` cards of `columnWidth` fit inside the container it
 * was measured from? The scroller positions items at `index * slotWidth`, so
 * "fits" has to include the gutter and both paddings — this is the invariant
 * `tests/catalogCardGrid.spec.ts` sweeps every real width against.
 */
export const cardGridFits = (
	containerWidth: number,
	columns: number,
	columnWidth: number,
	gap: number = 16,
	padding: number = 16,
): boolean =>
	padding * 2 + columns * columnWidth + Math.max(0, columns - 1) * gap + CARD_SCROLLBAR_GUTTER <=
	containerWidth;

/** Whether a card of this width draws its compact anatomy. */
export const isCompactCard = (columnWidth: number): boolean =>
	columnWidth > 0 && columnWidth < COMPACT_CARD_MAX_WIDTH;

/**
 * How tall one card is.
 *
 * Keyed off the CARD's width, not the window's. A 400px drawer on a 1440
 * screen used to get 300px-tall rows because the window said "desktop" — a
 * 159px-wide card in a 300px-tall slot, which is most of what made the single
 * card look like a poster.
 *
 * The compact figure is the artboard's card measured: 88px plate + a two-line
 * name + the code + the price/stock baseline + padding.
 */
export const getCardRowHeight = (
	columnWidth: number,
	windowWidth: number,
	options: CardGeometryOptions = {},
): number => {
	if (options.dense) {
		return DENSE_CARD_ROW_HEIGHT;
	}
	if (isCompactCard(columnWidth)) {
		return 184;
	}
	if (windowWidth <= 768) {
		return 260;
	}
	if (windowWidth <= 1200) {
		return 280;
	}
	return 300;
};

/**
 * Column count from the WINDOW — the pre-measurement fallback only, used for
 * the frame between mount and the first ResizeObserver callback.
 */
export const getCardColumns = (width: number): number => {
	if (width <= 768) {
		return 1;
	}
	if (width <= 1200) {
		return 2;
	}
	return 3;
};

/**
 * Calculates the gap between cards based on container width.
 */
export const getCardGap = (width: number, options: CardGeometryOptions = {}): number => {
	if (options.dense) {
		return DENSE_CARD_GUTTER;
	}
	if (width <= 768) {
		return 10;
	}
	if (width <= 1200) {
		return 12;
	}
	return 16;
};

/**
 * Calculates the padding for the card container based on container width.
 */
export const getCardPadding = (width: number, options: CardGeometryOptions = {}): number => {
	if (options.dense) {
		return DENSE_CARD_GUTTER;
	}
	if (width <= 768) {
		return 10;
	}
	if (width <= 1200) {
		return 12;
	}
	return 16;
};
