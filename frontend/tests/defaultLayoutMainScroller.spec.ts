import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The POS page scrolls in the 769-1099px band through .main-content +
 * .page-content, NOT any VMain inner wrapper.
 *
 * Without the `scrollable` prop (DefaultLayout never sets it), VMain renders
 * its slot DIRECTLY inside <main> — the `props.scrollable ?
 * <div class="v-main__scroller"> : slots.default()` ternary in VMain.js. So
 * there is no .v-main__wrap / .v-main__scroller element; an earlier version
 * of this stylesheet (and this spec) targeted one, which was dead code that
 * happened to sit next to the rules that actually work.
 *
 * The real scrollport: .main-content (the <main>) carries height:100% +
 * flex-column + min-height:0, and .page-content carries flex:1 1 auto +
 * overflow:auto. Drop either and .container1's height:100dvh + overflow:hidden
 * clips every control below the fold with no scrollbar (measured at 900x740:
 * zero scrollable elements, PAY a 2px sliver above the dock). This spec guards
 * those two rules, and guards that VMain still renders the slot directly so a
 * future Vuetify that reintroduces a wrapper fails here, not in a till.
 */

const fromRoot = (relativePath: string) =>
	fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

const layoutSource = readFileSync(
	fromRoot("src/posapp/layouts/DefaultLayout.vue"),
	"utf8",
);

const scopedStyles =
	/<style scoped>([\s\S]*?)<\/style>/.exec(layoutSource)?.[1] ?? "";

/** The rule body for a bare `.selector {…}` inside the scoped block. */
const ruleBody = (selector: string) => {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(
		scopedStyles,
	);
	return match?.[1] ?? "";
};

describe("DefaultLayout scrollport lives on .main-content + .page-content", () => {
	it("VMain renders its slot directly (no scrollable wrapper) — the premise", () => {
		const vmain = readFileSync(
			fromRoot("node_modules/vuetify/lib/components/VMain/VMain.js"),
			"utf8",
		);
		// The wrapper is gated behind `scrollable`; DefaultLayout never sets it.
		expect(vmain).toContain("props.scrollable");
		expect(vmain).toContain('"v-main__scroller"');
		// If a future Vuetify unconditionally wraps the slot, this premise breaks
		// and the sizing chain below must be rechecked against the new markup.
		expect(
			/props\.scrollable\s*\?[\s\S]*?v-main__scroller[\s\S]*?:\s*slots\.default/.test(
				vmain,
			),
			"VMain no longer gates its inner wrapper on `scrollable` — recheck DefaultLayout's height chain against the new markup",
		).toBe(true);

		// The <v-main> itself must NOT opt into the scroller wrapper, or the
		// premise above (slot renders directly) no longer holds for our layout.
		const vmainTag = /<v-main\b[^>]*>/.exec(layoutSource)?.[0] ?? "";
		expect(vmainTag).not.toContain("scrollable");
	});

	it(".main-content is a definite-height flex column", () => {
		const body = ruleBody(".main-content");
		expect(body).toMatch(/height:\s*100%/);
		expect(body).toMatch(/display:\s*flex/);
		expect(body).toMatch(/flex-direction:\s*column/);
		expect(body).toMatch(/min-height:\s*0/);
	});

	it(".page-content is the flex-grown scrollport", () => {
		const body = ruleBody(".page-content");
		expect(body).toMatch(/flex:\s*1 1 auto/);
		expect(body).toMatch(/min-height:\s*0/);
		expect(body).toMatch(/overflow:\s*auto/);
	});

	it("no dead :deep(.v-main__*) selectors linger to mislead a future edit", () => {
		expect(scopedStyles).not.toContain(":deep(.v-main__wrap)");
		expect(scopedStyles).not.toContain(":deep(.v-main__scroller)");
	});
});
