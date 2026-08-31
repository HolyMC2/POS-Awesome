/**
 * El cajón — the catalogue drawer (roadmap §17.7, direction E).
 *
 * The catalogue stops being a permanent 40% column and becomes a drawer, so
 * the ticket gets the full width. `Cajon.dc.html` states the rule the design
 * settled on, and it is not the usual modal-drawer rule:
 *
 *     "drawer: anchored by default, pushes, never covers"
 *     "total band: full width, the drawer never reaches it"
 *
 * So the drawn state is an ANCHORED panel — a flex sibling of the cart sized
 * against the row (`min(62%, 720px)`, see below), inside the content row, above
 * a band it never overlaps. Two consequences that this module exists to keep
 * straight:
 *
 * 1. An anchored panel is NOT a modal. It must not trap focus, must not lock
 *    body scroll and must not lay a scrim over the register: the cashier keeps
 *    working the cart with the catalogue open beside it. Trapping focus there
 *    would be an accessibility defect, not a nicety.
 * 2. Below the two-column boundary an anchored panel cannot fit beside a cart
 *    at all (1024px tablet leaves ~304px after the rail; 390px phone nothing),
 *    so narrow viewports fall back to an OVERLAY, which IS modal. The design
 *    does not draw that state because it only draws the desktop register, but
 *    geometry forces it.
 * 3. Where the shell is COMPACT there is no cart to sit beside or to cover:
 *    the dock switches one panel at a time, and the catalogue is one of those
 *    panels. So it presents INLINE — in flow, full width, not modal, and with
 *    no transition, because a Browse tab that animates while Cart and Cupones
 *    flip instantly reads as the slow one rather than as the considered one.
 *    That is the whole difference between a drawer and a panel, and it is why
 *    `inline` is a presentation here rather than a second component.
 *
 * Presentation therefore decides behaviour, and both live here rather than in
 * the component, so the policy can be unit-tested without mounting anything.
 *
 * On animation: pushing IS layout, so an anchored drawer cannot be animated by
 * compositor-only properties — there is no honest `transform` that also moves
 * the cart. Rather than animate `width` and pay a reflow per frame, anchored
 * open/close is INSTANT (one reflow, once) and only the overlay animates, with
 * `transform`/`opacity`. `catalogDrawerAnimation.spec.ts` scans the stylesheet
 * and fails if any layout property ever appears in a transition.
 */

import { computed, ref, type ComputedRef, type Ref } from "vue";

/** Registered by the lead in `shortcuts/actions.ts`; bound to F4 per the artboard. */
export const CATALOG_DRAWER_ACTION_ID = "catalog.toggleDrawer";

/**
 * Anchored width: a share of the content row, and a ceiling. ONE pair of
 * figures, for both views.
 *
 * It used to be two answers. `Cajon.dc.html` draws 400px because it draws a
 * phone-repair register, whose catalogue is a drawer of accessories two cards
 * wide, so LIST anchored at a flat 400px; `Cafeteria.dc.html` draws the other
 * end of the same trade-off — there the card MENU is the surface the cashier
 * works from — so CARD anchored at `min(45%, 560px)`. The reasoning for keeping
 * LIST narrow was that a list packs at any width (`itemSelectorLayout.ts`), so
 * widening it would take room off the ticket for nothing.
 *
 * What that reasoning never checked was whether the ticket was SPENDING the
 * room. Measured on the cafetería demo at 1718x1023 on 2026-08-23: with 1572px
 * of cart, the item-name column rendered 39.3px wide and its own header
 * truncated, because the sized columns claimed 95% of the table and the name
 * took a share of the 5% left. The extra width was going to eight columns
 * fighting, not to the ticket reading well. Golden flow §5 settles it at the
 * floating card panel's footprint for both views, and §4's collapse ladder is
 * what makes the narrower cart legible.
 *
 * A share rather than a pixel width so the split tracks the row instead of
 * being a number two files have to keep agreeing on. The ceiling exists because
 * past ~three columns the cards stop being a menu and start being wallpaper
 * (`CARD_MAX_COLUMNS` makes the same argument).
 *
 * The share is past half, so on a narrow register it would take the ticket
 * below the width at which the cart is a table at all — hence the floor below.
 *
 * `CatalogDrawer.vue` states these figures in CSS; the stylesheet cannot read a
 * module, so `catalogDrawerWidth.spec.ts` checks they still agree.
 */
export const CATALOG_DRAWER_WIDTH_SHARE = 0.62;
export const CATALOG_DRAWER_MAX_WIDTH = 720;

/**
 * The ticket's floor: how much of the content row the drawer must leave behind,
 * applied as `max-width: calc(100% - Npx)` on the anchored layer.
 *
 * Without it, `min(62%, 720px)` left a 420px cart at a 1280px viewport — under
 * the 500px where `items-table-styles.css` abandons the table formatting
 * context and reflows each row into a phone card. A desktop register should not
 * get the phone treatment because a drawer is open.
 *
 * ## Why 640 and not 544
 *
 * 544 is the arithmetic answer and it is wrong by the padding chain. This number
 * is an allowance out of the CONTENT ROW, but the cart's breakpoint is decided
 * by the ResizeObserver on `.posa-items-table-container`, which reports that
 * element's CONTENT box — and between the two sit the Vuetify column's 9px
 * gutters, the invoice card, and the container's own 1px borders. Measured in
 * the browser on the cafetería demo at 1280x900 (content row 1184px) that chain
 * costs 46px:
 *
 *     allowance 544 -> drawer 640 -> cart content 498 -> breakpoint-xs, CARD ROWS
 *     allowance 600 -> drawer 584 -> cart content 554 -> breakpoint-sm, name 128
 *     allowance 620 -> drawer 564 -> cart content 574 -> breakpoint-sm, name 148
 *     allowance 640 -> drawer 544 -> cart content 594 -> breakpoint-sm, name 168
 *
 * 544 misses the threshold it exists to clear by two pixels. 620 clears it but
 * leaves the item name under its own 150px floor (`CART_NAME_MIN_WIDTH`) — the
 * same kind of boundary this rule exists to stop being fragile about. 640 is the
 * first round number where the table AND the name have real margin, and it costs
 * the catalogue almost nothing that was ever on offer: 544px of drawer at 1280,
 * within 3% of the 560px the anchored CARD view had before this round.
 *
 * At the 1100px anchoring floor the allowance binds hard — drawer 364px, cart
 * content 598px — so the narrowest anchoring register gives the ticket the row
 * and the catalogue a column. Un-anchoring is the way out; the overlay is
 * governed by its own widths and ignores this entirely.
 */
export const CATALOG_DRAWER_MIN_TICKET_WIDTH = 640;

/**
 * What the slotted selector is drawing. The drawer never asks a store for it —
 * the toolbar owns the choice and `ItemsSelector` publishes it upward, so the
 * frame learns it the same way it learns everything else: as a prop.
 */
export type CatalogItemsView = "card" | "list";

/**
 * The register's existing two-column boundary. Above it the desktop register
 * is viewport-locked and an anchored drawer fits; below it the compact
 * switcher shows one panel at a time, so the drawer must overlay instead.
 * Kept equal to the 1100px breakpoint the shell already uses — if that moves,
 * this moves with it or the drawer anchors into a column that is not there.
 */
export const CATALOG_DRAWER_ANCHOR_MIN_WIDTH = 1100;

/** Overlay transition budget. Anchored is instant, so this never applies to it. */
/**
 * The register's motion tokens, in JS — `--motion-base` and `--motion-fast`
 * from `styles/register-tokens.css` (native-feel round 2). The CSS reads the
 * duration back off the inline custom property this composable writes, so
 * these two numbers ARE the drawer's animation; if they drift from the tokens
 * the cajón becomes the one surface moving at its own speed again.
 *
 * Opening decelerates over `base`; closing is a `fast` dismissal, because the
 * cashier who closed the catalogue is already looking at the cart.
 */
export const CATALOG_DRAWER_OPEN_MS = 200;
export const CATALOG_DRAWER_CLOSE_MS = 120;

export type CatalogDrawerPhase = "closed" | "opening" | "open" | "closing";
export type CatalogDrawerPresentation = "anchored" | "overlay" | "inline";

/**
 * Why the drawer opened. Not decoration: it decides where the operator lands.
 * A scan that missed and a deliberate browse want different first screens.
 */
export type CatalogDrawerOpenReason = "rail" | "scan-miss" | "shortcut" | "empty-cart" | "search";

/**
 * What typing into the scan field should do to the drawer.
 *
 * The field sits on the sale screen with the ticket at full width (direction
 * E); the matches it filters live in the drawer. Until 2026-08-22 the drawer
 * stayed closed while the operator typed, so the register filtered a list
 * nobody could see and the cashier learned to press Browse first (the Cobro
 * lane recorded it as `typedOnlyHits: 0`).
 *
 * - A term on a closed, ANCHORED drawer opens it. Overlay is excluded on
 *   purpose: an overlay traps focus, and a drawer that opens under a typing
 *   cashier and takes the keyboard away from the field is worse than the
 *   closed one. Below the anchor width the dock's Browse tab remains the way.
 * - An empty term closes a drawer that THIS typing opened (reason `search`),
 *   and leaves alone one the operator opened deliberately.
 * - Everything else is not this helper's business.
 *
 * Pure, so the shell can debounce it and a spec can walk every branch.
 */
export type SearchDrawerIntent = "open" | "close" | null;

export function resolveSearchDrawerIntent(input: {
	term: string;
	isOpen: boolean;
	presentation: CatalogDrawerPresentation;
	openReason: CatalogDrawerOpenReason | null;
}): SearchDrawerIntent {
	const term = String(input.term ?? "").trim();
	if (term) {
		return !input.isOpen && input.presentation === "anchored" ? "open" : null;
	}
	return input.isOpen && input.openReason === "search" ? "close" : null;
}

/**
 * Contract for the `categories` prop. Combos arrive through it from T6; the
 * drawer knows nothing about combos, or about any other category — it renders
 * whatever the register hands it, in the order it is handed.
 */
export interface CatalogCategory {
	/** Stable id, persisted as the remembered category. Not a label. */
	id: string;
	/** Already translated by the provider — the drawer does not translate. */
	label: string;
	/** Muted mono count on the chip. `null`/omitted renders no count. */
	count?: number | null;
	/**
	 * Sits first and is where an `empty-cart` open lands. Combos set this;
	 * if nothing does, `empty-cart` falls back to the first category.
	 */
	featured?: boolean;
}

export interface UseCatalogDrawerOptions {
	/** Register identity — the remembered category is scoped per register. */
	registerId: Ref<string> | ComputedRef<string>;
	/** Live viewport width; drives the anchored/overlay decision. */
	viewportWidth: Ref<number> | ComputedRef<number>;
	/**
	 * The shell is showing one panel at a time (`useCompactPosSwitcher`), so
	 * the catalogue is a panel rather than a drawer — see rule 3 in the header.
	 * Asked of the shell rather than re-derived from the width, because a lean
	 * vertical preset is compact at any width and geometry cannot see that.
	 */
	compact?: Ref<boolean> | ComputedRef<boolean>;
	/** Categories currently offered, for resolving the landing category. */
	categories: Ref<CatalogCategory[]> | ComputedRef<CatalogCategory[]>;
	/** Honour `prefers-reduced-motion`; when true the overlay is instant too. */
	prefersReducedMotion?: Ref<boolean> | ComputedRef<boolean>;
}

const SESSION_KEY_PREFIX = "posa:catalog-drawer:category:";

/**
 * sessionStorage throws outright in some contexts (private windows with site
 * data blocked, sandboxed frames), and a remembered category is a convenience.
 * Never let it take the drawer down with it.
 */
function readRememberedCategory(registerId: string): string | null {
	if (!registerId) {
		return null;
	}
	try {
		return window.sessionStorage.getItem(SESSION_KEY_PREFIX + registerId);
	} catch {
		return null;
	}
}

function writeRememberedCategory(registerId: string, categoryId: string | null): void {
	if (!registerId) {
		return;
	}
	try {
		if (categoryId === null) {
			window.sessionStorage.removeItem(SESSION_KEY_PREFIX + registerId);
		} else {
			window.sessionStorage.setItem(SESSION_KEY_PREFIX + registerId, categoryId);
		}
	} catch {
		/* remembering is a convenience; losing it is not a failure */
	}
}

/**
 * Where an open lands, by reason. Pure, so the rule is testable on its own.
 *
 * `scan-miss` deliberately IGNORES the remembered category: the operator is
 * here because a barcode did not resolve, and dropping them into "Fundas"
 * because that is where they were last would hide the item they are hunting.
 * They get the unfiltered catalogue and their search.
 */
export function resolveLandingCategory(
	reason: CatalogDrawerOpenReason,
	remembered: string | null,
	categories: readonly CatalogCategory[],
): string | null {
	const has = (id: string | null): id is string =>
		id !== null && categories.some((category) => category.id === id);

	// A search lands on ALL categories for the same reason a miss does: a
	// category filter on top of the term would hide the very matches the
	// drawer opened to show.
	if (reason === "scan-miss" || reason === "search") {
		return null;
	}
	if (reason === "empty-cart") {
		const featured = categories.find((category) => category.featured);
		return featured?.id ?? categories[0]?.id ?? null;
	}
	// rail + shortcut: pick up where the operator left off, if it still exists.
	return has(remembered) ? remembered : null;
}

export function useCatalogDrawer(options: UseCatalogDrawerOptions) {
	const { registerId, viewportWidth, categories, prefersReducedMotion, compact } = options;

	const phase = ref<CatalogDrawerPhase>("closed");
	const openReason = ref<CatalogDrawerOpenReason | null>(null);
	const activeCategory = ref<string | null>(null);

	/**
	 * Explicit un-anchor (the "Anclado" chip in the artboard header). Only ever
	 * relaxes the presentation: a wide register may choose to float the drawer,
	 * but a narrow one cannot choose to anchor a column it does not have.
	 */
	const anchorOptOut = ref(false);

	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let restoreFocusTo: HTMLElement | null = null;
	let previousBodyOverflow: string | null = null;

	const fitsAnchored = computed(() => viewportWidth.value >= CATALOG_DRAWER_ANCHOR_MIN_WIDTH);

	const presentation = computed<CatalogDrawerPresentation>(() => {
		// Compact wins over geometry: a lean vertical preset shows one panel at
		// a time on a 1440px screen too, and anchoring a column beside a cart that
		// is not on screen would leave the register drawing half a layout.
		if (compact?.value === true) {
			return "inline";
		}
		return fitsAnchored.value && !anchorOptOut.value ? "anchored" : "overlay";
	});

	/**
	 * Whether to OFFER the anchored/floating choice. Geometry is only half the
	 * question: inline has no cart beside it to push either, so a wide lean
	 * register would otherwise get a chip that cannot change anything.
	 */
	const canAnchor = computed(() => fitsAnchored.value && presentation.value !== "inline");

	/** An overlay is modal; anchored and inline panels are siblings of the cart. */
	const isModal = computed(() => presentation.value === "overlay");

	const isVisible = computed(() => phase.value !== "closed");
	const isOpen = computed(() => phase.value === "open" || phase.value === "opening");

	const reducedMotion = computed(() => prefersReducedMotion?.value === true);

	/**
	 * Zero for anchored (pushing is layout — see the file header), zero for
	 * inline (it is one of the dock's panels, and the others flip instantly)
	 * and zero when the operator asked for reduced motion. The component reads
	 * this rather than hard-coding a duration, so the paths cannot drift.
	 */
	const transitionDurationMs = computed(() => {
		if (presentation.value !== "overlay" || reducedMotion.value) {
			return 0;
		}
		return phase.value === "closing" ? CATALOG_DRAWER_CLOSE_MS : CATALOG_DRAWER_OPEN_MS;
	});

	const trapsFocus = computed(() => isModal.value && phase.value !== "closed");
	const locksScroll = computed(() => isModal.value && phase.value !== "closed");
	const showsScrim = computed(() => isModal.value && phase.value !== "closed");

	function clearSettleTimer(): void {
		if (settleTimer !== null) {
			clearTimeout(settleTimer);
			settleTimer = null;
		}
	}

	function settleAfter(ms: number, next: CatalogDrawerPhase): void {
		clearSettleTimer();
		settleTimer = setTimeout(() => {
			settleTimer = null;
			phase.value = next;
			if (next === "closed") {
				releaseScroll();
				returnFocus();
			}
		}, ms);
	}

	function lockScroll(): void {
		if (!isModal.value || previousBodyOverflow !== null) {
			return;
		}
		try {
			previousBodyOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
		} catch {
			previousBodyOverflow = null;
		}
	}

	function releaseScroll(): void {
		if (previousBodyOverflow === null) {
			return;
		}
		try {
			document.body.style.overflow = previousBodyOverflow;
		} catch {
			/* nothing to restore to */
		}
		previousBodyOverflow = null;
	}

	function returnFocus(): void {
		const target = restoreFocusTo;
		restoreFocusTo = null;
		// `isConnected` matters: the invoking control may have been a rail item
		// on a rail that re-rendered, and focusing a detached node silently
		// drops focus to <body>, stranding keyboard operators.
		if (target && target.isConnected && typeof target.focus === "function") {
			target.focus();
		}
	}

	function open(reason: CatalogDrawerOpenReason): void {
		if (phase.value === "open" || phase.value === "opening") {
			openReason.value = reason;
			return;
		}

		// Captured BEFORE the drawer takes focus, so close() can hand it back.
		const active = typeof document !== "undefined" ? document.activeElement : null;
		restoreFocusTo = active instanceof HTMLElement ? active : null;

		openReason.value = reason;
		activeCategory.value = resolveLandingCategory(
			reason,
			readRememberedCategory(registerId.value),
			categories.value,
		);

		phase.value = "opening";
		lockScroll();
		settleAfter(transitionDurationMs.value, "open");
	}

	function close(): void {
		if (phase.value === "closed" || phase.value === "closing") {
			return;
		}
		phase.value = "closing";
		settleAfter(transitionDurationMs.value, "closed");
	}

	function toggle(reason: CatalogDrawerOpenReason): void {
		if (isOpen.value) {
			close();
		} else {
			open(reason);
		}
	}

	/** Operator picked a category; remember it for this register this session. */
	function setCategory(categoryId: string | null): void {
		activeCategory.value = categoryId;
		writeRememberedCategory(registerId.value, categoryId);
	}

	/** The "Anclado" chip. Ignored where anchoring does not fit anyway. */
	function setAnchored(anchored: boolean): void {
		anchorOptOut.value = !anchored;
	}

	/** Escape closes — the artboard footer promises "Esc cierra". */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape" && isVisible.value) {
			event.preventDefault();
			close();
		}
	}

	function dispose(): void {
		clearSettleTimer();
		releaseScroll();
		restoreFocusTo = null;
	}

	return {
		// state
		phase,
		isOpen,
		isVisible,
		openReason,
		activeCategory,
		presentation,
		isModal,
		fitsAnchored,
		canAnchor,
		// policy — the component reads these instead of re-deciding
		trapsFocus,
		locksScroll,
		showsScrim,
		transitionDurationMs,
		// actions
		open,
		close,
		toggle,
		setCategory,
		setAnchored,
		handleKeydown,
		dispose,
	};
}
