/**
 * "One accent" as a build failure, not a review note (roadmap §17.7).
 *
 * The canvas raised the register's density twice and stayed readable for one
 * reason: exactly ONE saturated colour per screen, on the primary button.
 * Amber and green are STATE — a shortfall, a change due — and never emphasis.
 * Lose that and the density becomes noise, which is the failure mode this
 * suite exists to prevent.
 *
 * Source-scanned rather than mounted, for the same reason
 * tests/priceCheckReadOnly.spec.ts is: the guarantee is "no such declaration
 * exists", and only a scan can prove a negative. A mounted assertion proves
 * one render did not do it today.
 *
 * No jsdom — this reads real files.
 *
 * ## Why the scope is a walk and not a list
 *
 * It used to be `components/pos/shell/**`. Every file under that root was
 * written in one wave, by one agent, to this invariant — so the suite was
 * enforcing the rule precisely where it was never at risk, and enforcing
 * nothing where it was most visibly broken. Eleven state-coloured action
 * fills survived outside it, on surfaces a cashier meets every day: the
 * drafts picker, the sales-order picker, the phone-payment dialogs, the
 * change-due modal.
 *
 * That is the second hand-kept scope in this programme to go stale. The
 * translation scan did the same thing SIX times and was fixed in `dcf38edec`
 * by walking the tree instead of naming directories. This does the same: the
 * scope is `src/posapp`, walked, and a new directory is in scope the moment
 * it exists. There is nothing left to remember to update.
 *
 * ## One traversal, two mechanisms
 *
 * The invariant can be broken two ways, and until now two half-scans watched
 * one each:
 *
 * 1. **A stylesheet** painting a non-primary element with the brand accent.
 * 2. **A Vuetify `color=` prop** putting a STATE colour on a filled button.
 *
 * Both are checked here, over the same walk. `accentDestinations.spec.ts`
 * used to own (2) for five named files and `auditAccentCoverage.spec.ts` used
 * to ratchet a hand-kept inventory of six more; the first now keeps only the
 * colourblind-readability assertions a scan cannot express, and the second is
 * deleted — its own closing comment asked for exactly that once a real scan
 * existed.
 *
 * ## WHY `color=` IS THE FILL
 *
 * Vuetify routes `color` to the BACKGROUND for the `elevated`, `flat` and
 * `tonal` variants (and `elevated` is the default when no variant is given),
 * and to the TEXT for `text` and `outlined`. So a coloured `text` button is a
 * tint and legitimate, while a coloured `flat` button is a saturated fill
 * competing with the primary. Counting occurrences instead of fills is how an
 * earlier audit reported 41 violations in a set of files that held 17.
 *
 * ## Exclusions — each one argues for itself
 *
 * An exclusion nobody can justify is the same failure in a new shape; it just
 * hides in a different file. There are only two, and neither is a directory:
 *
 * - **`*.vue.css` sidecars.** 124 of them exist on disk and NOT ONE is
 *   tracked by git or imported by anything; each is a byte-identical copy of
 *   the `<style>` block in the `.vue` beside it (verified: `ActionBand.vue`'s
 *   block and `ActionBand.vue.css` are the same 4,247 characters). Scanning
 *   both double-counts every finding and, worse, makes a fix in the `.vue`
 *   look unfixed because the stale artifact still reports it.
 * - **Elements that are not ACTIONS.** `v-chip`, `v-alert`, `v-icon` and
 *   `v-progress-linear` carry colour as a LABEL or a FIGURE, which is exactly
 *   what the invariant reserves state colours for — `InvoiceManagement.vue`'s
 *   status chips pair their colour with the status word, so a colourblind
 *   operator still reads it. `Reports.vue`'s 63 `color="state"` occurrences,
 *   recorded in §13 as the whole remaining accent debt, are chips, icons and
 *   progress bars: measured, that file holds four `v-btn` and none of them is
 *   a state fill. So Reports is NOT excluded here — there was nothing to
 *   exclude, and walking it means a fill added there tomorrow fails this.
 *
 * `components/reports/**` remains off limits to EDIT — 5,393 lines is its own
 * piece of work — but that is a scope-of-work boundary, not a scan boundary.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src/posapp");
const SHELL = resolve(SRC, "components/pos/shell");
const TOKENS = resolve(SRC, "styles/register-tokens.css");

/**
 * The SATURATED brand accent, in every spelling it can reach a stylesheet:
 * the token, what the token forwards to, and the raw hexes behind those in
 * both themes. Hard-coding the hexes matters — a component that writes
 * `#0097a7` directly bypasses the token layer, and the §17.4 brand layer
 * with it.
 *
 * The pale derivatives are deliberately NOT here. `--pos-primary-container`
 * / `--reg-accent-soft` (#e0f7fa) is a wash, and the canvas uses it freely —
 * the tender chips on Main and Recargas are exactly that. The invariant is
 * about one SATURATED colour competing for the eye, not about banning the
 * hue. Matching them would have failed BarcodePrinting.vue's quantity pill,
 * which is not an emphasis leak.
 */
const ACCENT_PATTERNS = [
	/var\(\s*--reg-accent\s*[,)]/,
	/var\(\s*--reg-accent-pressed\s*[,)]/,
	/var\(\s*--pos-primary\s*[,)]/,
	/var\(\s*--pos-primary-variant\s*[,)]/,
	/#0097a7/i,
	/#00838f/i,
	/#00d4ff/i,
	/#00a0cc/i,
	/#ff6b35/i, // theme.css's legacy orange `--pos-accent`; also emphasis.
];

/** Amber and green: allowed as surface, caption and figure — never as fill. */
const STATE_PATTERNS = [/#f0dcae/i, /#8a5a0d/i, /#fdf9f0/i, /#cdead8/i, /#157a48/i, /#f4fbf7/i];

/** Every accent spelling again, as ONE global matcher, for the wash rule. */
const ACCENT_REFERENCE =
	/var\(\s*--reg-accent(?:-pressed)?\s*[,)]|var\(\s*--pos-primary(?:-variant)?\s*[,)]|#0097a7|#00838f|#00d4ff|#00a0cc|#ff6b35/gi;

/**
 * The wash rule, which is the pale-derivative exemption above computed inline
 * instead of named.
 *
 * `color-mix(in srgb, var(--pos-primary) 14%, var(--pos-surface))` is not a
 * saturated fill any more than `--pos-primary-container` is; it is the same
 * wash written a different way, and the drawer, the empty cart and the
 * customer display all use it as a background wash on purpose. A rule beats a
 * list here: a new wash at a new percentage needs no maintenance, while the
 * gradient at `.posa-section-header::after` — full `--pos-primary` into
 * `--pos-primary-container`, no mix at all — still fails, as it should.
 *
 * 25% is the ceiling because every wash in the tree today sits at 10–22% and
 * nothing above it reads as anything but the brand colour.
 */
const isWash = (declaration: string): boolean => {
	const flat = declaration.replace(/\s+/g, " ");
	if (!/color-mix\(/.test(flat)) return false;
	ACCENT_REFERENCE.lastIndex = 0;
	let match: RegExpExecArray | null;
	let sawAccent = false;
	while ((match = ACCENT_REFERENCE.exec(flat)) !== null) {
		sawAccent = true;
		const share = /^\s*(\d{1,3})%/.exec(flat.slice(match.index + match[0].length));
		if (!share || Number(share[1]) > 25) return false;
	}
	return sawAccent;
};

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const walk = (dir: string): string[] => {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
};

/** Repo-relative and stable, so an allowlist key survives a move of `SRC`. */
const key = (file: string) => relative(SRC, file).split("\\").join("/");

/** The whole register tree, walked once. Sidecars dropped — see the header. */
const ALL_FILES = walk(SRC).filter((f) => !f.endsWith(".vue.css"));
const STYLE_FILES = ALL_FILES.filter((f) => f.endsWith(".vue") || f.endsWith(".css"));
const TEMPLATE_FILES = ALL_FILES.filter((f) => f.endsWith(".vue"));

interface Rule {
	selector: string;
	body: string;
}

/** Flat list of `selector { body }` pairs; nested at-rules are unwrapped. */
const rules = (css: string): Rule[] => {
	const found: Rule[] = [];
	let depth = 0;
	let start = 0;
	let selectorStart = 0;
	for (let i = 0; i < css.length; i += 1) {
		const char = css[i];
		if (char === "{") {
			if (depth === 0) {
				const selector = css.slice(selectorStart, i).trim();
				if (selector.startsWith("@")) {
					// at-rule: recurse into its block rather than treating the
					// whole media query as one selector.
					const open = i;
					let d = 0;
					for (let j = open; j < css.length; j += 1) {
						if (css[j] === "{") d += 1;
						else if (css[j] === "}") {
							d -= 1;
							if (d === 0) {
								found.push(...rules(css.slice(open + 1, j)));
								i = j;
								selectorStart = j + 1;
								break;
							}
						}
					}
					continue;
				}
				start = i + 1;
			}
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				found.push({ selector: css.slice(selectorStart, start - 1).trim(), body: css.slice(start, i) });
				selectorStart = i + 1;
			}
		}
	}
	return found;
};

/** Every `<style>` block in an SFC, or the whole file for a .css. */
const stylesOf = (file: string) => {
	const source = readFileSync(file, "utf8");
	if (file.endsWith(".css")) return stripComments(source);
	return stripComments(
		[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
	);
};

const fillDeclarations = (body: string) =>
	body
		.split(";")
		.map((d) => d.trim())
		.filter((d) => /^background(-color)?\s*:/.test(d));

const isPrimaryAction = (selector: string) =>
	/__primary\b/.test(selector) || /band-primary/.test(selector);

/**
 * CSS accent fills that stay, each argued.
 *
 * Keyed by file, valued by the exact set of selectors. Exact, not "at most":
 * a fill removed here must be struck from this list too, so the list can
 * never quietly describe a tree that has moved on.
 *
 * Every one of these lives in a path this task may not write —
 * `styles/theme.css`, `components/navbar/**` and `components/pos/invoice/**`
 * are the lead's alone (§3), and `components/floor/**` is Salón, gated behind
 * §14 evidence and not built in this programme. So they are REPORTED here,
 * with the reasoning, rather than fixed or hidden.
 */
const CSS_SURVIVORS: Record<string, readonly string[]> = {
	// Salón's drag handle. Gated surface; the accent on a drag affordance is
	// the same category error as the accent on a badge, and it will be
	// answered when Salón is built rather than by a drive-by edit now.
	"components/floor/floor-editor.css": [".floor-editor__handle"],
	// A sync-progress badge painted with the brand accent. A badge is a
	// figure, not an action — but a SATURATED one competes with the primary,
	// which is why it is listed rather than exempted by category.
	"components/navbar/NavbarAppBar.vue": [".progress-badge"],
	// The cashier PIN form's Save. This one is legitimate: it IS the primary
	// action of its own screen, and the invariant reserves the accent for
	// exactly that. It is listed rather than pattern-matched because
	// `isPrimaryAction` follows the shell's `__primary` naming, and teaching
	// it to guess at `__save`, `__confirm`, `__submit` would be a heuristic
	// that lets a real leak through the first time someone names one `__go`.
	"components/navbar/NavbarCashierPinForm.vue": [".navbar-cashier-pin-form__save"],
	// A 3px section underline, accent into accent-container. Decoration, and
	// the one entry here that is plainly worth removing when the cart's
	// stylesheet is next opened.
	"components/pos/invoice/items-table-styles.css": [".posa-section-header::after"],
	// theme.css, dark theme only: the SELECTED member of a toggle group and
	// the datepicker's active date and its Select action. Each is "the chosen
	// control", which is the primary-action use the invariant permits; they
	// are here because they are third-party class names no selector
	// convention can recognise.
	"styles/theme.css": [
		'[data-theme="dark"] .view-toggle-btn .v-btn--selected',
		'[data-theme="dark"] .dp__active_date,\n[data-theme="dark"] .dp__range_start,\n[data-theme="dark"] .dp__range_end',
		'[data-theme="dark"] .dp__action_select',
	],
};

/** Variants where Vuetify paints `color` as the background. */
const FILL_VARIANTS = ["flat", "elevated", "tonal"];

/**
 * The four names §17.7 reserves as STATE. Matched as whole words, not
 * substrings: `mode === 'redeem' ? …` contains "red" and
 * `activeTab === tab ? 'primary' : 'secondary'` contains "secondary", and a
 * scan that cries wolf on those gets muted within a week.
 *
 * The wider Vuetify palette (`secondary`, `teal`, `purple`, `orange`…) is
 * deliberately NOT here. Eight `color="secondary"` fills do exist in the tree
 * and they are a real second saturated hue, but that is an argument about
 * brand layering rather than about state spent as emphasis, and widening the
 * vocabulary in the same change that widens the scope would make it
 * impossible to say which of the two found what. Reported, not folded in.
 */
const STATE_COLOURS = ["error", "success", "warning", "info"];
const STATE_COLOUR = new RegExp(`\\b(?:${STATE_COLOURS.join("|")})\\b`);

interface Button {
	file: string;
	line: number;
	variant: string;
	color: string;
}

/**
 * Only `<v-btn>`. See the header: chips, alerts, icons and progress bars
 * carry colour as a label or a figure, which is the use the invariant exists
 * to protect.
 */
const buttons = (file: string): Button[] => {
	const source = readFileSync(file, "utf8");
	const out: Button[] = [];
	for (const match of source.matchAll(/<v-btn\b[^>]*?>/gs)) {
		const tag = match[0];
		const color = /:?color="([^"]+)"/.exec(tag);
		if (!color) continue;
		const variant = /variant="([^"]+)"/.exec(tag);
		out.push({
			file,
			line: source.slice(0, match.index).split("\n").length,
			// No `variant` attribute means Vuetify's default, which is elevated.
			// A BOUND variant (`:variant="x ? 'flat' : 'text'"`) is read whole and
			// counts as a fill if any branch fills — the conservative direction.
			variant: variant ? variant[1] : "elevated",
			color: color[1],
		});
	}
	return out;
};

const isFill = (variant: string) => FILL_VARIANTS.some((v) => variant.includes(v));
const stateFills = (file: string) =>
	buttons(file).filter((b) => isFill(b.variant) && STATE_COLOUR.test(b.color));

/**
 * State-coloured button fills that stay, each argued, keyed by file and
 * valued by an exact count and the fix.
 *
 * Two kinds, and they are not the same thing.
 *
 * **Survivors** are decisions on the record: an irreversible act where red is
 * a safety affordance rather than decoration. Closing a dialog is a
 * dismissal, not a destructive act, and every Close in the register is
 * neutral now — these two delete something that does not come back.
 *
 * **Debt** is everything else the widened walk surfaced: nineteen fills in
 * files this task does not own (§3 reserves `components/pos/invoice/**`,
 * `components/pos/items/**` and `components/navbar/**` to the lead, and §7
 * says an agent that needs a change outside its paths REPORTS it). Each entry
 * carries the fix, which makes this a work item rather than a bucket. Adding
 * a row for one of them without doing the work would be worse than leaving
 * it: it would make the next reader believe the surface was handled.
 *
 * Counts are EXACT. Fixing one of these without striking it from the list
 * fails this suite, which is the only way a debt list stays true.
 */
const BUTTON_ALLOWLIST: Record<string, { fills: number; note: string }> = {
	// ── Documented survivors ────────────────────────────────────────────────
	"components/OfflineInvoices.vue": {
		fills: 1,
		note: '"Eliminar definitivamente" is the primary action of its own confirm modal and the only coloured element on it; red on an irreversible delete is a safety affordance, and the label carries the meaning without the colour',
	},
	"components/pos/cash/CashMovementHistory.vue": {
		fills: 1,
		note: "the row Delete is the single irreversible action in its group, rendered as a tint rather than a fill",
	},

	// ── Debt: reported, not owned. Each line is the fix. ────────────────────
	// §3 lead-only path.
	"components/navbar/QzTrayDialog.vue": {
		fills: 1,
		note: 'amber "Generate Certificate" is a setup step, not a warning → color="primary" if it is the wizard\'s primary, otherwise variant="outlined"',
	},
	// A yes/no self-test answer pair. Green "Yes" and red "No" are the answer
	// CATEGORIES, not states — the same green-means-a-button-colour trap.
	"components/pos/PrintHealthDialog.vue": {
		fills: 1,
		note: 'the "Did the ticket come out?" Yes → color="primary"; its No is already a tint',
	},
	"components/pos/PrintSetupWizard.vue": {
		fills: 1,
		note: 'same self-test pair as PrintHealthDialog; Yes → color="primary"',
	},
	// The one entry where the colour is arguably doing work: green when the
	// movement ENTERS the drawer, neutral when it leaves. That is direction
	// encoded as hue on the primary action, which is precisely "state moving
	// the accent" — the thing ActionBand refuses to do.
	"components/pos/cash/CashMovementForm.vue": {
		fills: 1,
		note: 'the submit is color="primary" either way; put the in/out direction on the icon and the label, where ActionBand puts its tone',
	},
	"components/pos/customer/NewAddress.vue": {
		fills: 2,
		note: 'Close → variant="text" with no colour, Submit → color="primary"; drop theme="dark" with the colour or the text button paints white on white',
	},
	"components/pos/dialogs/customer/UpdateCustomer.vue": {
		fills: 3,
		note: 'Close → variant="text", Submit → color="primary"; the confirm modal\'s "Yes, Close" discards unsaved edits, so red there is a survivor once the other two are neutral',
	},
	// §3 lead-only path.
	"components/pos/invoice/CancelSaleDialog.vue": {
		fills: 2,
		note: 'cancelling a sale IS irreversible, so red on "Yes, Cancel sale" survives; amber on "Back" is a dismissal → variant="text"',
	},
	// §3 lead-only path.
	"components/pos/items/Variants.vue": {
		// Redesigned 2026-08-26 into the register vocabulary: plain buttons
		// on --reg tokens, no Vuetify colour fills left.
		fills: 0,
		note: "picker rebuilt on --reg tokens; the close is a muted icon button",
	},
	"components/pos/offers/PosCoupons.vue": {
		fills: 2,
		note: 'green "Add" is the primary of its row → color="primary"; amber on the coupon list action is a category label → variant="outlined"',
	},
	"components/pos/purchase/PurchasePaymentDialog.vue": {
		fills: 1,
		note: '"Submit and print" is a second primary beside "Submit"; one of the two carries color="primary" and the other goes variant="outlined"',
	},
	"components/pos_pay/PayActionButtons.vue": {
		fills: 1,
		note: 'same submit/submit-and-print pair as PurchasePaymentDialog',
	},
	"components/pos_pay/PayInvoicesTable.vue": {
		fills: 2,
		note: 'amber Search is the primary of its filter row → color="primary"; red "Clear" clears a SELECTION, not data → variant="text"',
	},
	"components/pos_pay/PayMpesaSection.vue": {
		fills: 1,
		note: "amber Search, same as PayInvoicesTable",
	},
};

describe("the walk reaches the whole register, not a corner of it", () => {
	it("scans the tree rather than a directory somebody remembered", () => {
		// A scan over zero files passes vacuously, and a scan over three passes
		// almost as vacuously. Both are the quiet way this kind of guarantee
		// stops guarding anything, and the shell-only scope is what let eleven
		// fills through. 150 is comfortably under today's 176 and comfortably
		// over any plausible single directory.
		expect(STYLE_FILES.length).toBeGreaterThan(150);
		expect(TEMPLATE_FILES.length).toBeGreaterThan(150);
	});

	it("reaches the surfaces the old scope could not see", () => {
		// Named checks, because "many files" and "the right files" are not the
		// same claim. Each of these is a directory the shell-only walk missed.
		for (const path of [
			"components/pos/flows/Drafts.vue",
			"components/pos/payments/ChangeDueDialog.vue",
			"components/reports/Reports.vue",
			"components/pos_pay/PayActionButtons.vue",
			"components/OfflineInvoices.vue",
		]) {
			expect(ALL_FILES.map(key), `${path} is outside the walk`).toContain(path);
		}
	});

	it("drops only sidecars that nothing imports", () => {
		// The exclusion rests on these being unreachable artifacts. If one ever
		// becomes a real imported stylesheet, this fails and the exclusion has
		// to be argued again rather than inherited.
		//
		// Evidence that they are artifacts rather than sources, beyond the
		// import check: `components/settings/PrintSetupWizard.vue.css` has no
		// `.vue` beside it at all — the component moved to `components/pos/`
		// and the copy stayed behind, still describing a file that is no longer
		// there. That is precisely the "a fix looks unfixed" hazard.
		const sidecars = walk(SRC).filter((f) => f.endsWith(".vue.css"));
		// Local trees carry these gitignored build artifacts (**/*.vue.css in
		// .gitignore); a clean CI checkout has none, and the invariant below
		// is then vacuously true — do not require their presence.
		if (sidecars.length === 0) return;
		const importers = walk(SRC)
			.filter((f) => /\.(vue|ts)$/.test(f))
			.filter((f) => /["'][^"']*\.vue\.css["']/.test(readFileSync(f, "utf8")))
			.map(key);
		expect(importers, `a .vue.css is being imported; it is no longer an artifact`).toEqual([]);
	});
});

describe("the accent appears on the primary action and nowhere else", () => {
	it("no stylesheet fills a non-primary element with the brand accent", () => {
		const offenders: string[] = [];
		for (const file of STYLE_FILES) {
			const allowed = CSS_SURVIVORS[key(file)] ?? [];
			for (const rule of rules(stylesOf(file))) {
				if (isPrimaryAction(rule.selector)) continue;
				if (allowed.includes(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (isWash(declaration)) continue;
					if (ACCENT_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(
							`${key(file)} → ${rule.selector} { ${declaration.replace(/\s+/g, " ")} }`,
						);
					}
				}
			}
		}
		expect(
			offenders,
			`the accent is a fill reserved for the primary action:\n${offenders.join("\n")}`,
		).toEqual([]);
	});

	it("every documented CSS survivor is still there", () => {
		// An allowlist entry for a fill that no longer exists is a hole waiting
		// for a new one to fall into.
		for (const [path, selectors] of Object.entries(CSS_SURVIVORS)) {
			const file = resolve(SRC, path);
			expect(existsSync(file), `${path} is allowlisted but gone`).toBe(true);
			const present = rules(stylesOf(file))
				.filter((rule) =>
					fillDeclarations(rule.body).some(
						(d) => !isWash(d) && ACCENT_PATTERNS.some((p) => p.test(d)),
					),
				)
				.map((rule) => rule.selector);
			for (const selector of selectors) {
				expect(present, `${path} no longer fills ${selector}; strike it from CSS_SURVIVORS`).toContain(
					selector,
				);
			}
		}
	});

	it("state colours never become a fill on an action", () => {
		// The inverse leak: tinting the BUTTON green when change is due would
		// move the accent with the state, which is the same invariant read
		// from the other side.
		const offenders: string[] = [];
		for (const file of STYLE_FILES) {
			for (const rule of rules(stylesOf(file))) {
				if (!isPrimaryAction(rule.selector)) continue;
				for (const declaration of fillDeclarations(rule.body)) {
					if (STATE_PATTERNS.some((pattern) => pattern.test(declaration))) {
						offenders.push(`${key(file)} → ${rule.selector} { ${declaration} }`);
					}
				}
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});
});

describe("no button wears a state colour as a fill", () => {
	it("finds no state fill outside the allowlist", () => {
		const offenders: string[] = [];
		for (const file of TEMPLATE_FILES) {
			if (BUTTON_ALLOWLIST[key(file)]) continue;
			for (const button of stateFills(file)) {
				offenders.push(
					`${key(file)}:${button.line} color="${button.color}" variant="${button.variant}"`,
				);
			}
		}
		expect(
			offenders,
			`Vuetify paints \`color\` as the BACKGROUND for flat/elevated/tonal and for ` +
				`the default variant, so each of these is a saturated fill:\n${offenders.join("\n")}\n\n` +
				`Amber, green, red and info are STATE. A filled button wearing one teaches ` +
				`the cashier they are decoration, and the band's amber shortfall stops ` +
				`meaning anything. Make it color="primary" if it is the primary action, ` +
				`variant="text" or "outlined" if it is not.`,
		).toEqual([]);
	});

	it.each(Object.entries(BUTTON_ALLOWLIST))(
		"%s still carries exactly its recorded fills",
		(path, { fills, note }) => {
			const file = resolve(SRC, path);
			expect(existsSync(file), `${path} is allowlisted but gone`).toBe(true);
			const found = stateFills(file);
			const detail = found
				.map((b) => `    L${b.line} color="${b.color}" variant="${b.variant}"`)
				.join("\n");
			expect(
				found.length,
				`${path}: recorded ${fills} state-coloured action fill(s), found ${found.length}.\n` +
					`${detail}\n` +
					`If one was FIXED, lower the number here — an allowlist that overstates ` +
					`the debt is a place for a new fill to hide. If one was ADDED, it does not ` +
					`belong: ${note}.`,
			).toBe(fills);
		},
	);
});

describe("the band spends its one accent exactly once", () => {
	const bandCss = stylesOf(resolve(SHELL, "band/ActionBand.vue"));

	it("only the primary button carries an accent fill", () => {
		const accented = rules(bandCss).filter((rule) =>
			fillDeclarations(rule.body).some((d) => ACCENT_PATTERNS.some((p) => p.test(d))),
		);
		expect(accented.length).toBeGreaterThan(0);
		for (const rule of accented) {
			// `:active` is the same control under the finger, not a second
			// accent — so the rule is "every accented selector IS the primary
			// button", not "there is exactly one such rule".
			expect(rule.selector, `accent fill outside the primary action: ${rule.selector}`).toMatch(
				/^\.action-band__primary\b/,
			);
		}
	});

	it("no tone modifier reaches the button", () => {
		for (const rule of rules(bandCss)) {
			if (!/action-band--/.test(rule.selector)) continue;
			expect(rule.selector, `tone must not restyle the action: ${rule.selector}`).not.toMatch(
				/__primary/,
			);
		}
	});

	it("disabled drops the accent rather than fading it", () => {
		const disabled = rules(bandCss).find((r) => r.selector === ".action-band__primary:disabled");
		expect(disabled).toBeDefined();
		for (const declaration of fillDeclarations(disabled!.body)) {
			expect(ACCENT_PATTERNS.some((p) => p.test(declaration))).toBe(false);
		}
	});
});

describe("the sale-path action strip cannot regrow its fills", () => {
	/**
	 * Carried over from `auditAccentCoverage.spec.ts`, which this file
	 * replaces. That suite ratcheted a hand-kept inventory of six sale-path
	 * files and closed with the instruction to delete it once a real scan
	 * reached them; the walk above now does. Its inventory is fully covered —
	 * the four survivors it recorded are `tonal` chips and `text`/`outlined`
	 * actions, which are tints — but this one assertion is not expressible by
	 * a scan, because it pins the MECHANISM rather than the result.
	 *
	 * `secondaryVariant` used to resolve to `elevated` on desktop, and that
	 * single ternary is what turned eight hues into eight backgrounds directly
	 * above a disciplined band.
	 */
	const strip = readFileSync(
		resolve(SRC, "components/pos/invoice/InvoiceActionButtons.vue"),
		"utf8",
	);

	it("never resolves a secondary action's variant to a fill again", () => {
		expect(strip).not.toContain('"elevated"');
		expect(strip).not.toMatch(/isPhone\.value\s*\?\s*"tonal"\s*:\s*"elevated"/);
	});
});

describe("the token layer keeps the accent brandable", () => {
	const tokens = stripComments(readFileSync(TOKENS, "utf8"));

	it("forwards --pos-primary instead of hard-coding the teal", () => {
		// A literal hex here would freeze the accent past dark mode and past
		// the §17.4 brand layer, which is the whole reason the token exists.
		expect(tokens).toMatch(/--reg-accent:\s*var\(--pos-primary/);
	});

	it("never routes the accent through theme.css's orange --pos-accent", () => {
		// A real trap: the name matches, the colour does not.
		expect(tokens).not.toMatch(/--reg-accent[^;]*var\(--pos-accent\b/);
	});

	it("states the band geometry the artboards use", () => {
		expect(tokens).toMatch(/--reg-band-height:\s*134px/);
		expect(tokens).toMatch(/--reg-band-number-size:\s*60px/);
	});
});

describe("the band stays off the layout-reading path", () => {
	it("never measures the DOM, because §6 budgets payment-open at 150 ms p95", () => {
		const source = readFileSync(resolve(SHELL, "band/ActionBand.vue"), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");
		for (const forbidden of [
			"getBoundingClientRect",
			"offsetWidth",
			"offsetHeight",
			"clientWidth",
			"clientHeight",
			"getComputedStyle",
		]) {
			expect(source, `band must not force layout via ${forbidden}`).not.toContain(forbidden);
		}
	});
});
