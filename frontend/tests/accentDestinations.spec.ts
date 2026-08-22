/**
 * "One accent" on the five surfaces the rail promoted from dialogs to
 * destinations (docs/POS-RIEL-Y-CAJON-BUILD.md §2, roadmap §17.7 invariant 2).
 *
 * `singleAccent.spec.ts` walks `components/pos/shell/**` and enforces the
 * invariant in the stylesheets. It cannot see these five: they live under
 * `flows/`, `cash/` and the components root, and they break the rule through
 * Vuetify's `color=` prop rather than through CSS. That gap is why the
 * register still showed a rainbow directly above a disciplined band — the
 * invariant was enforced precisely where it was never at risk.
 *
 * WHY `color=` IS THE FILL. Vuetify routes `color` to the BACKGROUND for the
 * `elevated`, `flat` and `tonal` variants, and to the TEXT for `text` and
 * `outlined`. So a coloured `text` button is a tint and not a violation, while
 * a coloured `flat` button is a saturated fill competing with the primary.
 * This spec only counts the fills, which is why the raw `color=` count is a
 * bad proxy — most of the occurrences in these files were always tints.
 *
 * Source-scanned, not mounted, for the reason `singleAccent.spec.ts` gives:
 * the guarantee is "no such declaration exists", and only a scan proves a
 * negative. No jsdom — this reads real files.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = resolve(__dirname, "../src/posapp/components");

/** The five surfaces the rail now reaches, by the operator's name for them. */
const DESTINATIONS: Record<string, string> = {
	Facturas: "pos/flows/InvoiceManagement.vue",
	"Facturas offline": "OfflineInvoices.vue",
	Devolución: "pos/flows/Returns.vue",
	"Movimientos de caja": "pos/cash/CashMovementHistory.vue",
	Corte: "pos/shell/ClosingDialog.vue",
};

/** Variants where Vuetify paints `color` as the background. */
const FILL_VARIANTS = ["flat", "elevated", "tonal"];

/**
 * State palette names. These are the ones §17.7 reserves: amber and green are
 * STATE, never emphasis. `info` joins them because it is used the same way —
 * as a category label on a peer action.
 */
const STATE_COLOURS = ["error", "success", "warning", "info"];

/**
 * Two fills keep a state colour on purpose, and each is commented in place.
 * Listed here so they are a decision on the record rather than a hole: if a
 * third appears, this spec fails and someone has to argue for it.
 *
 * - `OfflineInvoices.vue` "Eliminar definitivamente" is the primary action of
 *   its OWN confirm modal and the only coloured element on it, so "one
 *   saturated colour on the primary" holds. Red on an irreversible delete is a
 *   safety affordance; the label carries the meaning without the colour.
 * - `CashMovementHistory.vue`'s row Delete is the single irreversible action
 *   in its group, rendered as a tint rather than a fill.
 */
const DOCUMENTED_EXCEPTIONS: Record<string, number> = {
	"Facturas offline": 1,
	"Movimientos de caja": 1,
};

interface Button {
	line: number;
	variant: string;
	color: string;
}

const buttons = (source: string): Button[] => {
	const out: Button[] = [];
	for (const match of source.matchAll(/<v-btn\b[^>]*?>/gs)) {
		const tag = match[0];
		const color = /:?color="([^"]+)"/.exec(tag);
		if (!color) continue;
		const variant = /variant="([^"]+)"/.exec(tag);
		out.push({
			line: source.slice(0, match.index).split("\n").length,
			// No `variant` attribute means Vuetify's default, which is elevated.
			variant: variant ? variant[1] : "elevated",
			color: color[1],
		});
	}
	return out;
};

const isFill = (variant: string) => FILL_VARIANTS.some((v) => variant.includes(v));
const usesStateColour = (color: string) => STATE_COLOURS.some((c) => color.includes(c));

describe("rail destinations keep one accent", () => {
	it.each(Object.entries(DESTINATIONS))(
		"%s spends no state colour on an action fill",
		(name, path) => {
			const source = readFileSync(resolve(COMPONENTS, path), "utf8");
			const offenders = buttons(source).filter(
				(b) => isFill(b.variant) && usesStateColour(b.color),
			);
			const allowed = DOCUMENTED_EXCEPTIONS[name] ?? 0;
			const detail = offenders
				.map((b) => `    L${b.line} variant=${b.variant} color=${b.color}`)
				.join("\n");
			expect(
				offenders.length,
				`${name} (${path}) has ${offenders.length} state-coloured action fill(s), ` +
					`${allowed} documented:\n${detail}\n` +
					`Amber, green, red and info are STATE. A filled button wearing one ` +
					`teaches the cashier they are decoration, and the band's amber ` +
					`shortfall stops meaning anything.`,
			).toBe(allowed);
		},
	);

	it("has surfaces to scan at all", () => {
		// A path typo would silently pass every assertion above.
		for (const path of Object.values(DESTINATIONS)) {
			expect(readFileSync(resolve(COMPONENTS, path), "utf8").length).toBeGreaterThan(0);
		}
	});
});

describe("state stays readable without colour", () => {
	it("the movements status chip pairs its colour with a text label", () => {
		// The invariant permits colour as STATE. It does not permit colour as
		// the ONLY carrier — a colourblind operator must still read the status.
		const source = readFileSync(resolve(COMPONENTS, DESTINATIONS["Movimientos de caja"]), "utf8");
		expect(source).toMatch(/:color="statusColor\(item\.docstatus\)"/);
		expect(source).toMatch(/statusLabel\(item\.docstatus\)/);
		expect(source).toMatch(/function statusLabel/);
	});

	it("keeps the offline pending-count chip, which is state and not emphasis", () => {
		const source = readFileSync(resolve(COMPONENTS, DESTINATIONS["Movimientos de caja"]), "utf8");
		expect(source).toMatch(/pendingOfflineCount > 0/);
	});
});
