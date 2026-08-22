// @vitest-environment jsdom

/**
 * The cajón's state machine and its presentation policy (roadmap §17.7).
 *
 * The load-bearing claim under test is the one the artboard states and a
 * generic "drawer" implementation would get wrong: an ANCHORED drawer pushes
 * and is not modal, so it must not trap focus, lock scroll or raise a scrim.
 * Only the narrow-viewport overlay does. Getting that backwards would leave a
 * cashier unable to tab into their own cart.
 */

import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	CATALOG_DRAWER_ANCHOR_MIN_WIDTH,
	CATALOG_DRAWER_CLOSE_MS,
	CATALOG_DRAWER_OPEN_MS,
	resolveLandingCategory,
	useCatalogDrawer,
	type CatalogCategory,
} from "../src/posapp/composables/pos/shell/useCatalogDrawer";

const CATEGORIES: CatalogCategory[] = [
	{ id: "combos", label: "Combos", count: 6, featured: true },
	{ id: "fundas", label: "Fundas", count: 18 },
	{ id: "micas", label: "Micas", count: 9 },
];

function makeDrawer(width = 1440) {
	const registerId = ref("Caja 2");
	const viewportWidth = ref(width);
	const categories = ref<CatalogCategory[]>([...CATEGORIES]);
	const prefersReducedMotion = ref(false);
	const drawer = useCatalogDrawer({
		registerId,
		viewportWidth,
		categories: computed(() => categories.value),
		prefersReducedMotion,
	});
	return { drawer, registerId, viewportWidth, categories, prefersReducedMotion };
}

beforeEach(() => {
	vi.useFakeTimers();
	window.sessionStorage.clear();
	document.body.style.overflow = "";
});

afterEach(() => {
	vi.useRealTimers();
});

describe("phases", () => {
	it("walks closed → opening → open and back, settling on the timer", () => {
		const { drawer, viewportWidth } = makeDrawer();
		// Overlay so the transition has a non-zero duration to observe.
		viewportWidth.value = 900;

		expect(drawer.phase.value).toBe("closed");
		drawer.open("rail");
		expect(drawer.phase.value).toBe("opening");
		expect(drawer.isVisible.value).toBe(true);

		vi.advanceTimersByTime(CATALOG_DRAWER_OPEN_MS);
		expect(drawer.phase.value).toBe("open");

		drawer.close();
		expect(drawer.phase.value).toBe("closing");
		// Still visible while closing — otherwise the exit animation has
		// nothing left to animate.
		expect(drawer.isVisible.value).toBe(true);

		vi.advanceTimersByTime(CATALOG_DRAWER_CLOSE_MS);
		expect(drawer.phase.value).toBe("closed");
	});

	it("opens instantly when anchored, because pushing is layout", () => {
		const { drawer } = makeDrawer(1440);
		drawer.open("rail");
		expect(drawer.transitionDurationMs.value).toBe(0);
		vi.advanceTimersByTime(0);
		expect(drawer.phase.value).toBe("open");
	});

	it("opens instantly when the operator asked for reduced motion", () => {
		const { drawer, viewportWidth, prefersReducedMotion } = makeDrawer();
		viewportWidth.value = 900;
		prefersReducedMotion.value = true;
		drawer.open("rail");
		expect(drawer.transitionDurationMs.value).toBe(0);
	});

	it("re-opening while open only updates the reason, never restarts the phase", () => {
		const { drawer } = makeDrawer();
		drawer.open("rail");
		vi.advanceTimersByTime(0);
		drawer.open("shortcut");
		expect(drawer.phase.value).toBe("open");
		expect(drawer.openReason.value).toBe("shortcut");
	});

	it("closing twice is a no-op rather than a second timer", () => {
		const { drawer, viewportWidth } = makeDrawer();
		viewportWidth.value = 900;
		drawer.open("rail");
		vi.advanceTimersByTime(CATALOG_DRAWER_OPEN_MS);
		drawer.close();
		drawer.close();
		vi.advanceTimersByTime(CATALOG_DRAWER_CLOSE_MS);
		expect(drawer.phase.value).toBe("closed");
	});
});

describe("presentation decides behaviour", () => {
	it("anchors on a desktop register and is not modal there", () => {
		const { drawer } = makeDrawer(CATALOG_DRAWER_ANCHOR_MIN_WIDTH);
		drawer.open("rail");
		vi.advanceTimersByTime(0);

		expect(drawer.presentation.value).toBe("anchored");
		expect(drawer.isModal.value).toBe(false);
		// The three properties that would strand the cashier if they were on.
		expect(drawer.trapsFocus.value).toBe(false);
		expect(drawer.locksScroll.value).toBe(false);
		expect(drawer.showsScrim.value).toBe(false);
	});

	it("overlays below the two-column boundary and is modal there", () => {
		const { drawer } = makeDrawer(CATALOG_DRAWER_ANCHOR_MIN_WIDTH - 1);
		drawer.open("rail");
		vi.advanceTimersByTime(CATALOG_DRAWER_OPEN_MS);

		expect(drawer.presentation.value).toBe("overlay");
		expect(drawer.isModal.value).toBe(true);
		expect(drawer.trapsFocus.value).toBe(true);
		expect(drawer.locksScroll.value).toBe(true);
		expect(drawer.showsScrim.value).toBe(true);
	});

	it("lets a wide register float the drawer, but a narrow one cannot anchor", () => {
		const { drawer, viewportWidth } = makeDrawer(1440);
		drawer.setAnchored(false);
		expect(drawer.presentation.value).toBe("overlay");

		viewportWidth.value = 900;
		drawer.setAnchored(true);
		// There is no 400px to anchor into; the choice is refused, not honoured.
		expect(drawer.presentation.value).toBe("overlay");
		expect(drawer.fitsAnchored.value).toBe(false);
	});

	it("locks and restores body scroll only on the overlay path", () => {
		document.body.style.overflow = "scroll";
		const { drawer } = makeDrawer(900);

		drawer.open("rail");
		expect(document.body.style.overflow).toBe("hidden");

		drawer.close();
		vi.advanceTimersByTime(CATALOG_DRAWER_CLOSE_MS);
		// Restored to what it was, not blanked.
		expect(document.body.style.overflow).toBe("scroll");
	});

	it("leaves body scroll alone when anchored", () => {
		document.body.style.overflow = "scroll";
		const { drawer } = makeDrawer(1440);
		drawer.open("rail");
		expect(document.body.style.overflow).toBe("scroll");
	});
});

describe("open reason decides where the operator lands", () => {
	it("a scan miss ignores the remembered category", () => {
		// Landing them in "Fundas" because that is where they were last would
		// hide the item whose barcode just failed.
		expect(resolveLandingCategory("scan-miss", "fundas", CATEGORIES)).toBeNull();
	});

	it("an empty cart lands on the featured category", () => {
		expect(resolveLandingCategory("empty-cart", "fundas", CATEGORIES)).toBe("combos");
	});

	it("an empty cart falls back to the first category when nothing is featured", () => {
		const plain = CATEGORIES.map((c) => ({ ...c, featured: false }));
		expect(resolveLandingCategory("empty-cart", null, plain)).toBe("combos");
	});

	it("rail and shortcut resume the remembered category", () => {
		expect(resolveLandingCategory("rail", "micas", CATEGORIES)).toBe("micas");
		expect(resolveLandingCategory("shortcut", "micas", CATEGORIES)).toBe("micas");
	});

	it("drops a remembered category that no longer exists", () => {
		// The register's catalogue changed under the operator; resuming into a
		// category that is gone would render an empty grid with no explanation.
		expect(resolveLandingCategory("rail", "descontinuados", CATEGORIES)).toBeNull();
	});
});

describe("remembered category", () => {
	it("is scoped per register and survives a close/open within the session", () => {
		const { drawer } = makeDrawer();
		drawer.open("rail");
		vi.advanceTimersByTime(0);
		drawer.setCategory("micas");
		drawer.close();
		vi.advanceTimersByTime(0);

		drawer.open("rail");
		vi.advanceTimersByTime(0);
		expect(drawer.activeCategory.value).toBe("micas");
	});

	it("does not leak between registers", () => {
		const { drawer, registerId } = makeDrawer();
		drawer.open("rail");
		vi.advanceTimersByTime(0);
		drawer.setCategory("micas");
		drawer.close();
		vi.advanceTimersByTime(0);

		registerId.value = "Caja 3";
		drawer.open("rail");
		vi.advanceTimersByTime(0);
		expect(drawer.activeCategory.value).toBeNull();
	});

	it("survives sessionStorage throwing outright", () => {
		const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("site data blocked");
		});
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("site data blocked");
		});

		const { drawer } = makeDrawer();
		// Remembering is a convenience; it must never take the drawer down.
		expect(() => {
			drawer.open("rail");
			drawer.setCategory("micas");
		}).not.toThrow();
		expect(drawer.activeCategory.value).toBe("micas");

		getItem.mockRestore();
		setItem.mockRestore();
	});
});

describe("escape", () => {
	it("closes and consumes the event while visible", () => {
		const { drawer } = makeDrawer();
		drawer.open("rail");
		vi.advanceTimersByTime(0);

		const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
		drawer.handleKeydown(event);
		expect(event.defaultPrevented).toBe(true);
		expect(drawer.phase.value).toBe("closing");
	});

	it("ignores escape when already closed, so it stays available to the cart", () => {
		const { drawer } = makeDrawer();
		const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
		drawer.handleKeydown(event);
		expect(event.defaultPrevented).toBe(false);
		expect(drawer.phase.value).toBe("closed");
	});
});

describe("focus restoration", () => {
	it("hands focus back to the control that opened it", () => {
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		opener.focus();

		const { drawer } = makeDrawer(900);
		drawer.open("rail");
		vi.advanceTimersByTime(CATALOG_DRAWER_OPEN_MS);

		// Something inside the drawer takes focus while it is open.
		const inside = document.createElement("button");
		document.body.appendChild(inside);
		inside.focus();

		drawer.close();
		vi.advanceTimersByTime(CATALOG_DRAWER_CLOSE_MS);
		expect(document.activeElement).toBe(opener);

		opener.remove();
		inside.remove();
	});

	it("does not focus a control that has since been removed", () => {
		const opener = document.createElement("button");
		document.body.appendChild(opener);
		opener.focus();

		const { drawer } = makeDrawer(900);
		drawer.open("rail");
		vi.advanceTimersByTime(CATALOG_DRAWER_OPEN_MS);

		// The rail re-rendered while the drawer was open.
		opener.remove();

		expect(() => {
			drawer.close();
			vi.advanceTimersByTime(CATALOG_DRAWER_CLOSE_MS);
		}).not.toThrow();
	});
});

describe("dispose", () => {
	it("releases body scroll if the shell tears down mid-open", () => {
		document.body.style.overflow = "scroll";
		const { drawer } = makeDrawer(900);
		drawer.open("rail");
		expect(document.body.style.overflow).toBe("hidden");

		drawer.dispose();
		expect(document.body.style.overflow).toBe("scroll");
	});
});
