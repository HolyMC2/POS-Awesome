// @vitest-environment jsdom

import { mdiClose, mdiMenuDown } from "@mdi/js";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createVuetify } from "vuetify";

import { posawesomeIcons } from "../src/posapp/plugins/icons";
import { mdiIconPaths } from "../src/posapp/plugins/icons/mdiIconPaths";

// Templates still write `mdi-close`, not a raw SVG path. These assertions pin
// the translation layer that keeps that working without the webfont.
//
// The set component is mounted directly rather than through `VIcon`: VIcon
// pulls in a stylesheet that vitest will not resolve out of node_modules, and
// the translation is what belongs to this app anyway. What VIcon contributes —
// the props and classes it hands down — is reproduced here as `props`/`attrs`.

const IconComponent = posawesomeIcons.sets.mdi.component as never;

function mountIcon(icon: string, attrs: Record<string, unknown> = {}) {
	return mount(IconComponent, {
		props: { icon, tag: "i" },
		attrs,
		// Vuetify components resolve their defaults off the app instance.
		global: { plugins: [createVuetify({ icons: posawesomeIcons })] },
	});
}

describe("posawesome mdi icon set", () => {
	it("renders the SVG path for a plain mdi- name", () => {
		const wrapper = mountIcon("mdi-close");

		expect(wrapper.find("svg path").attributes("d")).toBe(mdiClose);
	});

	it("keeps the mdi- name as a class so existing CSS selectors still match", () => {
		// e.g. `.pos-navbar-enhanced .mdi-menu-down` in NavbarAppBar.vue — with
		// the webfont that class was how the icon got styled, and dropping it
		// would silently un-style those icons.
		const wrapper = mountIcon("mdi-menu-down");

		expect(wrapper.classes()).toContain("mdi-menu-down");
	});

	it("keeps the classes VIcon passes down alongside the icon name", () => {
		const wrapper = mountIcon("mdi-close", { class: "v-icon v-icon--size-default" });

		expect(wrapper.classes()).toEqual(
			expect.arrayContaining(["v-icon", "v-icon--size-default", "mdi-close"]),
		);
	});

	it("resolves Vuetify's own aliases to names this set can render", () => {
		// $dropdown is what v-select renders. Vuetify looks it up in `aliases`
		// before handing the result to this set, so the alias has to land on a
		// name the map knows.
		expect(posawesomeIcons.aliases.dropdown).toBe("mdi-menu-down");
		expect(mdiIconPaths["mdi-menu-down"]).toBe(mdiMenuDown);
	});

	it("renders an empty path and warns instead of throwing on an unknown name", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const wrapper = mountIcon("mdi-not-a-real-icon");

		expect(wrapper.find("svg path").attributes("d")).toBe("");
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("mdi-not-a-real-icon"));
		warn.mockRestore();
	});

	it("warns once for a name with no path and no known-missing entry", () => {
		// KNOWN_MISSING_ICONS is empty since the three blank references were
		// repointed at real glyphs — an unmapped name is a bug again and must
		// warn (the coverage spec fails the build for in-repo references; this
		// covers runtime-only names).
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const wrapper = mountIcon("mdi-cart-search");

		expect(wrapper.find("svg path").attributes("d")).toBe("");
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
