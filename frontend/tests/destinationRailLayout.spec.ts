// @vitest-environment node
/**
 * The two converted destinations stop overflowing their container.
 *
 * The cause was not a stray margin. It was a MISSING STYLESHEET, and the
 * evidence is in the bundle rather than in a screenshot:
 *
 *   `frontend/src/posapp/plugins/vuetify.ts` does `import * as components from
 *   "vuetify/components"`, which pulls each component's own CSS — including
 *   `VGrid`, so `.v-row { margin: -12px }` and `.v-row--dense { margin: -4px }`
 *   are real. Nothing anywhere imports `vuetify/styles`, which is where the
 *   SPACING AND DISPLAY UTILITIES live. `loader.ts` injects the full
 *   `vuetify.min.css` — but only in `setupDeskPageChrome`, i.e. only on
 *   `/app/posapp`. On the web route (`/posapp`) `pa-3`, `pa-4`, `d-flex`,
 *   `ga-3`, `align-center`, `justify-space-between`, `text-h6` and
 *   `text-body-2` all resolve to NOTHING.
 *
 * So `CashMovementView`'s `pa-3` wrapper contributed zero padding while the
 * `v-row` inside it kept its real −4px dense margin: the row and everything in
 * it hung outside the container on both sides, `.page-content`'s `overflow:
 * auto` clipped the left overhang (scrolling only ever reveals the right one),
 * and "Cash Movement" lost its C. The same absence stacked the heading and the
 * posting-date field that `d-flex … justify-space-between` was supposed to put
 * on one line, which is exactly what the owner's capture shows.
 *
 * This file holds the two views to geometry they OWN. It is source-scanned
 * because the failure is a stylesheet that is not there — jsdom has no layout
 * engine, so a mounted assertion would be green either way, which is how this
 * survived a suite that was already 3,400 tests long.
 *
 * `node:fs` named imports do not interop under jsdom (build plan §10), hence
 * the node environment and hence a file of its own.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const VIEW = "../src/posapp/components/pos/cash/CashMovementView.vue";
const FORM = "../src/posapp/components/pos/cash/CashMovementForm.vue";
const HISTORY = "../src/posapp/components/pos/cash/CashMovementHistory.vue";
const CORTE = "../src/posapp/components/pos/shell/ClosingDialog.vue";

const templateOf = (source: string) =>
	source.slice(source.indexOf("<template>"), source.indexOf("</template>"));

/**
 * The Vuetify utilities that are absent from the web route's stylesheet AND
 * that carry geometry. Deliberately not every utility: `mb-*` happens to
 * survive because frappe-ui's Tailwind emits identically named margin classes,
 * and a rule that flagged those would be 90% false positives and get switched
 * off. These eight are the ones that silently did nothing.
 */
const GEOMETRY_UTILITIES = [
	"pa-1",
	"pa-2",
	"pa-3",
	"pa-4",
	"d-flex",
	"ga-1",
	"ga-2",
	"ga-3",
	"align-center",
	"align-end",
	"justify-space-between",
	"flex-column",
];

const classAttributes = (template: string) =>
	[...template.matchAll(/class="([^"]*)"/g)].map((match) => match[1] ?? "");

describe("Gasto's geometry is its own, not a utility that may not exist", () => {
	for (const [label, file] of [
		["CashMovementView", VIEW],
		["CashMovementForm", FORM],
		["CashMovementHistory", HISTORY],
	] as const) {
		it(`${label} lays itself out without the absent Vuetify utilities`, () => {
			const template = templateOf(read(file));
			const offenders: string[] = [];
			for (const attribute of classAttributes(template)) {
				for (const utility of GEOMETRY_UTILITIES) {
					if (attribute.split(/\s+/).includes(utility)) {
						offenders.push(`${utility} (in class="${attribute}")`);
					}
				}
			}
			expect(
				offenders,
				`${label} still sizes itself with utilities the web route does not ship`,
			).toEqual([]);
		});
	}

	it("the destination root is a surface, not a padded div wrapping a v-row", () => {
		const template = templateOf(read(VIEW));
		// The old root was `<div class="pa-3"><v-row dense>…`, and the −4px the
		// row kept was the whole overhang.
		expect(template).toContain('<div class="cash-movement-destination">');
		expect(template).not.toContain("<v-row");
		expect(template).not.toContain("<v-col");
	});

	it("fills the destination surface with the same height chain the shell uses", () => {
		const style = read(VIEW);
		// `flex: 1 1 auto` + `min-height: 0` is the pair `.destination-host` and
		// the register columns already use; the second half is the one that
		// actually lets a flex child shrink (commit 59c5fe1ad).
		expect(style).toContain(".cash-movement-destination {");
		expect(style).toMatch(/\.cash-movement-destination\s*\{[^}]*flex:\s*1 1 auto/);
		expect(style).toMatch(/\.cash-movement-destination\s*\{[^}]*min-height:\s*0/);
	});

	it("opens exactly ONE scrollport, and it is the body", () => {
		const style = read(VIEW).slice(read(VIEW).indexOf("<style"));
		const scrollports = [...style.matchAll(/overflow(-y)?:\s*(auto|scroll)/g)];
		expect(
			scrollports.length,
			"a destination surface has its own scroll needs but must not nest a second scrollport",
		).toBe(1);
		expect(style).toMatch(/\.cash-movement-destination__body\s*\{[^}]*overflow-y:\s*auto/);
	});

	it("puts the form and its history in ONE grid, so they share a column edge", () => {
		const style = read(VIEW);
		// They used to be two `v-col`s that shared nothing but a row, which is
		// why they did not line up.
		expect(style).toMatch(/\.cash-movement-destination__body\s*\{[^}]*display:\s*grid/);
		expect(style).toMatch(/grid-template-columns:\s*minmax\(320px, 5fr\) minmax\(0, 7fr\)/);
		// The row takes the leftover height instead of leaving half the surface
		// empty under the form.
		expect(style).toMatch(/grid-template-rows:\s*minmax\(min-content, 1fr\)/);
	});

	it("keeps the direction strip, the account labels and the submit untouched", () => {
		// Commit 649f2ba66: the form states which way the money moves, because
		// a role-based payload made Deposit and Cash In look identical and "a
		// form that looks identical for both is a form that posts 2,500 the
		// wrong way". This task moved where the form sits, not what it says.
		const form = read(FORM);
		expect(form).toContain('data-testid="cash-movement-direction"');
		expect(form).toContain("cash-movement-form__direction--in");
		expect(form).toContain("cash-movement-form__direction--out");
		expect(form).toContain("{{ fromAccountLabel }}");
		expect(form).toContain("{{ toAccountLabel }}");
		expect(form).toContain("cash-movement-form__submit");
	});
});

describe("the corte, hosted beside the rail", () => {
	it("still refuses to draw a second band when a shell owns the lane", () => {
		const corte = read(CORTE);
		expect(corte).toContain("const bandOwnsAction = computed(() => !destinationSurface);");
		expect(corte).toContain('<div v-if="bandOwnsAction && bandState" class="closing-band">');
	});

	it("keeps the DIFFERENCE on screen when the band is not its to draw", () => {
		// It is the number the whole screen exists to produce, and the artboard
		// prints it beside «Debe haber» and «Contado». A summary line, not a
		// band: no accent, no second primary — Submit keeps the one accent.
		const corte = read(CORTE);
		expect(corte).toContain('data-testid="closing-difference"');
		expect(corte).toContain('data-money-role="difference"');
		expect(corte).toContain("__(bandState.labelKey)");
		expect(corte).not.toMatch(/closing-difference[\s\S]{0,400}<ActionBand/);
	});

	it("removes its OWN listener and not everybody's", () => {
		// Two copies of this dialog now exist: the floating one DefaultLayout
		// keeps for the routes with no rail, and the hosted one. A bare
		// `off("open_ClosingDialog")` removes EVERY listener for the event, so
		// the hosted copy unmounting would have taken the navbar's «Close
		// shift» with it.
		const corte = read(CORTE);
		expect(corte).toContain('eventBus.off("open_ClosingDialog", handleOpenClosingDialog)');
		expect(corte).not.toContain('eventBus.off("open_ClosingDialog");');
	});

	it("stands the floating copy down while the shell is showing the corte", () => {
		const corte = read(CORTE);
		expect(corte).toContain("const hostedCorteCount = ref(0)");
		expect(corte).toContain("if (!isHosted && hostedCorteCount.value > 0)");
	});

	it("relays its band state to the shell boundary instead of dead-ending", () => {
		// ClosingDialog already published one — "so a shell hosting this
		// surface can feed its own band from the same state" — and the host
		// used to drop it. `Pos.vue` is free to ignore it and does today; the
		// corte keeps its own Submit and prints the difference itself.
		const host = read("../src/posapp/components/pos/shell/destinations/DestinationHost.vue");
		expect(host).toContain("@band=\"$emit('band', $event)\"");
		expect(host).toContain("defineEmits<{ dismiss: []; band: [BandState] }>()");
		expect(read(CORTE)).toContain('watch(bandState, (state) => emit("band", state)');
	});

	it("asks the shell to prepare the shift rather than forking the close flow", () => {
		// `make_closing_shift_from_opening` submits printed drafts and can
		// refuse; the rail and the navbar must reach it the same way.
		const corte = read(CORTE);
		expect(corte).toContain('eventBus.emit("open_shift_details")');
	});
});
