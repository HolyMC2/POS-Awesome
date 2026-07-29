import { h } from "vue";
import type { IconAliases, IconProps, IconSet } from "vuetify";
import { aliases } from "vuetify/iconsets/mdi";
import { mdi as mdiSvgIconSet } from "vuetify/iconsets/mdi-svg";
import { mdiIconPaths } from "./mdiIconPaths";

// Icons are rendered as inline SVG paths from @mdi/js instead of glyphs from
// the @mdi/font webfont. The font shipped all 7,447 icons — a ~307 kB block of
// render-blocking CSS plus a ~394 kB woff2 — to draw the ~200 this POS uses.
//
// Templates keep writing plain `mdi-*` names: this set resolves the name to a
// path, so nothing in the app had to change. Vuetify's own aliases ($dropdown,
// $checkboxOn, …) are the class-style ones on purpose, so they resolve through
// this same set rather than `mdi-svg`'s inline paths — that keeps every icon
// carrying its `mdi-*` class, which app CSS selects on (see the
// `.pos-navbar-enhanced .mdi-menu-down` rule in NavbarAppBar.vue).

// Escape hatch for a name referenced in src that no Material Design Icons
// release provides — listing it here suppresses the runtime warning below.
//
// Empty on purpose. Three references (mdi-cart-search, mdi-link-wrench,
// mdi-receipt-text-multiple) named glyphs that never existed, so they drew
// nothing under the webfont too; they were repointed at real icons rather than
// parked here. Adding a name to this list hides it from the coverage spec, so
// prefer correcting the call site.
export const KNOWN_MISSING_ICONS = [] as const;

const warned = new Set<string>();

function warnUnknownIcon(name: string) {
	if (warned.has(name)) {
		return;
	}
	warned.add(name);
	console.warn(
		`[posawesome] icon "${name}" has no path in mdiIconPaths and will render blank. ` +
			"Add it to src/posapp/plugins/icons/mdiIconPaths.ts.",
	);
}

const VSvgIcon = mdiSvgIconSet.component;

// Same shape as Vuetify's own iconsets: a functional component that forwards
// everything it was handed and swaps in what it resolved. Passing `icon` on
// through as the path is what turns `mdi-close` into a drawable <path d>; the
// extra `class` re-applies the icon's own name, which the webfont used to put
// there and which app CSS still selects on.
const mdiNameSet: IconSet = {
	component: (props: IconProps) => {
		const name = typeof props.icon === "string" ? props.icon.trim() : "";
		const path = mdiIconPaths[name];
		if (name && !path && !(KNOWN_MISSING_ICONS as readonly string[]).includes(name)) {
			warnUnknownIcon(name);
		}
		return h(VSvgIcon, { ...props, icon: path ?? "", class: name || undefined });
	},
};

export const posawesomeIcons = {
	defaultSet: "mdi",
	aliases: aliases as IconAliases,
	sets: { mdi: mdiNameSet },
};

export type { IconProps };
export { mdiIconPaths };
