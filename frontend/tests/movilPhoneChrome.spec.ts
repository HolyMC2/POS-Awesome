// @vitest-environment node
import { describe, expect, it } from "vitest";
import posSource from "../src/posapp/components/pos/shell/Pos.vue?raw";
import navbarSource from "../src/posapp/components/Navbar.vue?raw";
import appBarSource from "../src/posapp/components/navbar/NavbarAppBar.vue?raw";

/**
 * Two phone-chrome defects Marco reported on 2026-08-30, both pinned at the
 * source so they cannot quietly come back:
 *
 * 1. «old searchbar leaks to other views» — the legacy scan bar (ItemHeader,
 *    teleported into #register-scan-bar) was ghosted only while the movil
 *    BROWSE screen was on stage, so Ofertas / Carrito / Cupones / Pagar all
 *    showed it above their own content. On the movil shell it ghosts on every
 *    tab; the teal bar in MobileBrowseScreen is the one search.
 *
 * 2. «the topbar just keeps overlapping» — the status cluster (wifi + saldo
 *    badge) was allowed to shrink (`min-width: 0`) while its children are
 *    fixed-size buttons, so at phone width the badge slid under the drafts
 *    button. The cluster and the whole actions group never shrink now; the
 *    register status line (min-width: 0 + ellipsis) is what gives ground.
 */
const rule = (css: string, selector: string): string => {
	const start = css.indexOf(`\n${selector} {`);
	if (start < 0) return "";
	const end = css.indexOf("}", start);
	return css.slice(start, end);
};

describe("movil phone chrome", () => {
	it("ghosts the legacy scan bar on the whole movil shell, not only on browse", () => {
		expect(posSource).toContain(`:class="{ 'register-scan-bar--movil-ghost': movilPhone }"`);
		expect(posSource).not.toContain(`'register-scan-bar--movil-ghost': movilBrowseActive`);
		// Opacity, never display:none — the wedge and the teal bar's focus
		// hand-off depend on the input staying in layout.
		const ghost = rule(posSource, "#register-scan-bar.register-scan-bar--movil-ghost");
		expect(ghost).toContain("opacity: 0;");
		expect(ghost).not.toContain("display: none");
	});

	it("the status cluster and the actions group never shrink below their buttons", () => {
		const cluster = rule(navbarSource, ".status-entry-surface");
		expect(cluster).toContain("flex: 0 0 auto;");
		expect(cluster).not.toContain("min-width: 0;");
		expect(navbarSource).toContain(".status-entry-surface > * {\n\tflex: 0 0 auto;");
		const actions = rule(appBarSource, ".pos-navbar-actions-section");
		expect(actions).toContain("flex: 0 0 auto;");
		expect(actions).not.toContain("min-width: 0;");
		// The party that DOES give ground: the brand section stays flexible.
		const brand = rule(appBarSource, ".pos-navbar-brand-section");
		expect(brand).toContain("flex: 1 1 auto;");
		expect(brand).toContain("min-width: 0;");
	});
});
