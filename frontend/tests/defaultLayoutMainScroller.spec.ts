import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * DefaultLayout sizes VMain's inner element so the POS page can scroll.
 *
 * That element's class was `v-main__wrap`; Vuetify renamed it to
 * `v-main__scroller`, and for a while the stylesheet still targeted the old
 * name. A dead selector here is silent and brutal: `.main-content`'s
 * height:100% has nothing definite to resolve against, `.page-content`'s
 * overflow:auto never becomes a scrollport, and `.container1`'s
 * height:100dvh + overflow:hidden clips every control below the fold with no
 * scrollbar to reach them. Measured at 900x740: zero scrollable elements and
 * the PAY button a 2px sliver above the dock.
 *
 * So this reads the class the *installed* VMain actually renders and asserts
 * the stylesheet still targets it. A version bump that renames the element
 * again fails here instead of in a cashier's hands.
 */

const fromRoot = (relativePath: string) =>
	fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

const layoutSource = readFileSync(
	fromRoot("src/posapp/layouts/DefaultLayout.vue"),
	"utf8",
);

const scopedStyles =
	/<style scoped>([\s\S]*?)<\/style>/.exec(layoutSource)?.[1] ?? "";

/** Every class VMain puts on a rendered element, straight from node_modules. */
const vmainRenderedClasses = () => {
	const source = readFileSync(
		fromRoot("node_modules/vuetify/lib/components/VMain/VMain.js"),
		"utf8",
	);
	const classes = new Set<string>();
	const literal = /"class":\s*"([^"]+)"/g;
	let match: RegExpExecArray | null;
	while ((match = literal.exec(source)) !== null) {
		for (const name of match[1].split(/\s+/)) {
			if (name) classes.add(name);
		}
	}
	return classes;
};

describe("DefaultLayout targets the element VMain actually renders", () => {
	it("styles the scroller class the installed Vuetify emits", () => {
		const rendered = vmainRenderedClasses();

		// Guards the guard: if this ever comes up empty the assertion below
		// would pass vacuously and the whole spec would go quiet.
		expect(rendered.size).toBeGreaterThan(0);

		const scroller = [...rendered].find((name) => name.startsWith("v-main__"));
		expect(
			scroller,
			"VMain no longer renders an inner v-main__* element — DefaultLayout's sizing rules need rechecking against the new markup",
		).toBeTruthy();

		expect(
			scopedStyles,
			`DefaultLayout.vue must style :deep(.${scroller}) — the installed Vuetify renders that class, and a stale selector silently clips the POS below the fold`,
		).toContain(`:deep(.${scroller})`);
	});

	it("keeps the desktop sizing block and its mobile override on the same selector", () => {
		// The base block gives the element a definite height; the <=768px block
		// hands scrolling back to .container1. If a rename only lands in one of
		// them, one band or the other breaks — so they move together.
		const occurrences = scopedStyles.match(/:deep\(\.v-main__scroller\)/g) ?? [];
		expect(occurrences.length).toBe(2);
	});
});
