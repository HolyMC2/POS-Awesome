import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desktop payment screen actually MOUNTS what was built for it (§12 item B).
 *
 * `5155643fc` added `PaymentSaleSummary`, `PaymentReadinessHeader`,
 * `saleSummary.ts`, `walletSummary.ts`, `hardwareReadiness.ts`,
 * `useHardwareReadiness.ts` and `armedTenderPreselect.ts`, every one of them
 * unit-tested and green. Not one was imported by a component the cashier can
 * reach — the specs were the only callers. Green tests on an unmounted
 * component prove the component works, not that anyone can see it, and the
 * owner's report was the first thing that noticed.
 *
 * This file is the guard for that class of failure on this screen, in the same
 * shape `shellIntegrationWiring.spec.ts` guards it for `Pos.vue`: source-level,
 * because `Payments.vue` cannot be imported under jsdom without dragging the
 * whole POS stack in (build plan §10, and the same reason `changeDueWiring`
 * and `showInvoicePanelWiring` scan rather than mount).
 *
 * ⚠ NAMES. The register's payment screen is `components/pos/Payments.vue`,
 * mounted from `Pos.vue` both as the 96vw dialog and as the anchored panel.
 * `components/pos/shell/PayView.vue` is a DIFFERENT screen — Payment Entry,
 * receive/pay against outstanding invoices, routed at `/pay` — and it has no
 * tender, no cart and no sale summary. This file's name follows the task that
 * asked for it; its subject is `Payments.vue`.
 *
 * No jsdom — this reads real files.
 */

const SRC = resolve(__dirname, "../src/posapp");
const PAYMENTS = resolve(SRC, "components/pos/Payments.vue");
const PAYMENTS_DIR = resolve(SRC, "components/pos/payments");

const read = (file: string) => readFileSync(file, "utf8");
const source = () => read(PAYMENTS);
const key = (file: string) => relative(SRC, file).split("\\").join("/");

describe("the payment screen mounts what §12 item B built for it", () => {
	it.each([
		["PaymentSaleSummary", "./payments/PaymentSaleSummary.vue"],
		["PaymentReadinessHeader", "./payments/PaymentReadinessHeader.vue"],
	])("imports and renders %s", (component, path) => {
		const text = source();
		expect(text, `${component} must be imported from ${path}`).toContain(
			`import ${component} from "${path}"`,
		);
		// `<script setup>` needs no `components:` block — being in scope and in
		// the template IS the registration.
		expect(text, `<${component} must appear in the template`).toContain(`<${component}`);
	});

	it("mounts exactly one of each", () => {
		// Two summaries would put the ticket on the screen twice, which is the
		// duplication `cobroSaysItOnce.spec.ts` exists to prevent.
		for (const component of ["PaymentSaleSummary", "PaymentReadinessHeader"]) {
			expect(
				source().match(new RegExp(`<${component}\\b`, "g")) ?? [],
				`${component} is mounted more than once`,
			).toHaveLength(1);
		}
	});

	it("feeds the summary the cart, the wallet and a currency formatter", () => {
		// A mounted component bound to nothing renders nothing, which looks
		// exactly like not being mounted at all.
		const text = source();
		const tag = /<PaymentSaleSummary[\s\S]*?\/>/.exec(text)?.[0] ?? "";
		expect(tag, "PaymentSaleSummary must be bound to the invoice's items").toMatch(
			/:items="[^"]*items"/,
		);
		expect(tag, "the wallet is the artboard's own block; bind it").toMatch(/:wallet=/);
		expect(tag, "the summary needs a currency formatter").toMatch(/:format-currency=/);
		// Its own rule: it refuses to draw a cart that is still on screen. The
		// binding must be real, not hardcoded false.
		expect(tag).toMatch(/:cart-on-screen="cartOnScreen"/);
		expect(text).toMatch(/const cartOnScreen = computed\(/);
	});

	it("sources the wallet from a ledger the register actually reads", () => {
		// `walletSummary.ts` refuses to claim an accrual because
		// `collection_factor` never reaches the client. The binding must not
		// quietly invent one — an accrual is a promise printed on a ticket.
		const text = source();
		const wallet = /const customerWallet = computed\(\(\) => \(\{[\s\S]*?\}\)\);/.exec(text)?.[0] ?? "";
		expect(wallet, "customerWallet must exist").not.toBe("");
		expect(wallet).toMatch(/loyaltyProgram:/);
		expect(wallet).toMatch(/storedValueBalance:/);
		expect(wallet, "the accrual has no read model; it stays null").toMatch(/accrual: null/);
		expect(wallet, "a refund does not accrue").toMatch(/isReturn:/);
	});

	it("feeds the readiness header from the print-health singleton", () => {
		const text = source();
		expect(text).toContain(
			'import { useHardwareReadiness } from "./payments/useHardwareReadiness"',
		);
		expect(text).toMatch(/useHardwareReadiness\(\{\s*posProfile: pos_profile\s*\}\)/);
		expect(text, "the header must be bound to it").toMatch(
			/<PaymentReadinessHeader[^>]*:hardware="hardwareReadiness"/,
		);
		// The artboard's back affordance is the EXISTING exit, not a new one:
		// `cancel_payment()` leaves the sale alive and lands on the cart.
		expect(text).toMatch(/<PaymentReadinessHeader[^>]*@back="cancel_payment\(\)"/);
	});
});

describe("the armed tender reaches the payment screen", () => {
	it("imports the resolver and the holder", () => {
		const text = source();
		expect(text).toContain(
			'import { applyArmedPaymentPreference } from "./payments/armedTenderPreselect"',
		);
		expect(text).toContain('import { peekArmedTender } from "./invoice/armedTender"');
	});

	it("applies the preference inside the one funnel that opens the screen", () => {
		// `ensurePaymentLinesInitialized` is called from both entry points — the
		// invoice arriving (`applyIncomingInvoiceDoc`) and the panel opening
		// (`isPaymentOpen`). Applying it anywhere else would honour the arm on
		// one path and drop it on the other.
		const text = source();
		const body =
			/const ensurePaymentLinesInitialized = \(doc = invoice_doc\.value\) => \{[\s\S]*?\n\};/.exec(
				text,
			)?.[0] ?? "";
		expect(body, "ensurePaymentLinesInitialized must exist").not.toBe("");
		expect(
			body,
			"the armed tender must decide the line before anything fills an amount",
		).toContain("applyArmedPaymentPreference(");
		expect(body.indexOf("applyArmedPaymentPreference(")).toBeLessThan(
			body.indexOf("initializePaymentLinesForDialog("),
		);
	});

	it("passes the two guards that withdraw the arm's authority", () => {
		const call =
			/applyArmedPaymentPreference\([\s\S]*?\}\);/.exec(source())?.[0] ?? "";
		expect(call, "a refund is not `cobrar con`").toMatch(/isReturn:/);
		expect(call, "once an amount is typed the screen is the cashier's").toMatch(
			/paymentsTouched:/,
		);
		// The stale guard lives in `armedTender.ts` and is read, never bypassed.
		expect(call).toMatch(/peekArmedTender\(\)/);
	});

	it("does not reach into the money path to do it", () => {
		// The bound on this task: which line is SELECTED may move; how an amount
		// is captured, split, rounded, validated, authorised or submitted may
		// not. `utils/paymentInitialization.ts` is that arithmetic, and the
		// wiring must not have edited it.
		const util = read(resolve(SRC, "utils/paymentInitialization.ts"));
		expect(util, "the pre-selection must not be wired into the arithmetic").not.toContain(
			"armedTender",
		);
		expect(util).not.toContain("ArmedPayment");
	});
});

/**
 * THE ACCENT, in the spelling `singleAccent.spec.ts` cannot see.
 *
 * That suite walks the whole tree and is the authority on the invariant, but
 * it matches the accent by TOKEN and by raw hex (`var(--pos-primary)`,
 * `#0097a7`) and state colours by their `#157a48`-style hexes, and it reads
 * `color=` attributes off `<v-btn>`. This screen breaks the rule in neither
 * spelling: its fills are `rgb(var(--v-theme-primary))` and
 * `rgb(var(--v-theme-success))` written in CSS on classes, with no `color=`
 * attribute to read. So `Payments.vue`, `PaymentMethods.vue` and
 * `PaymentActionButtons.vue` were all inside that walk and all reported clean
 * while the screen carried a saturated teal bar on EVERY payment row and a
 * green SUBMIT & PRINT beside a band that tints green for "change to give".
 *
 * This closes that gap for the payment surface only. The general fix —
 * teaching `ACCENT_PATTERNS` and `STATE_PATTERNS` the `rgb(var(--v-theme-*))`
 * spelling — belongs in `singleAccent.spec.ts`, which is T3's file and not
 * this task's to edit; it is in the report.
 *
 * The rule: an OPAQUE Vuetify theme colour used as a background is a
 * saturated fill. `rgba(..., 0.12)` is a tint and stays — a wash and a badge
 * are exactly what the invariant reserves state colour for.
 */
const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});

/** Sidecars are untracked, unimported byte-copies — see `singleAccent.spec.ts`. */
const PAYMENT_FILES = [PAYMENTS, ...walk(PAYMENTS_DIR)].filter(
	(f) => f.endsWith(".vue") && !f.endsWith(".vue.css"),
);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const stylesOf = (file: string) =>
	stripComments(
		[...read(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"),
	);

interface Fill {
	file: string;
	selector: string;
	declaration: string;
}

/**
 * `rgb(var(--v-theme-primary))` — no alpha channel, so it paints at full
 * saturation. Only the SATURATED roles: `surface` and `background` are the
 * neutral ground every card is painted with, and `on-surface` is text.
 */
const SATURATED_ROLES = ["primary", "secondary", "success", "warning", "error", "info"];
const OPAQUE_THEME_FILL = new RegExp(
	`\\brgb\\(\\s*var\\(\\s*--v-theme-(?:${SATURATED_ROLES.join("|")})\\s*\\)\\s*\\)`,
	"i",
);

const opaqueThemeFills = (file: string): Fill[] => {
	const out: Fill[] = [];
	for (const rule of stylesOf(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = rule[1].trim();
		for (const declaration of rule[2].split(";").map((d) => d.trim())) {
			if (!/^background(-color)?\s*:/.test(declaration)) continue;
			if (!OPAQUE_THEME_FILL.test(declaration)) continue;
			out.push({ file: key(file), selector, declaration: declaration.replace(/\s+/g, " ") });
		}
	}
	return out;
};

/**
 * The one control allowed to carry it: the screen's primary action. Listed as
 * a predicate rather than a count so the states of the SAME button
 * (`:hover`, `:focus-visible`) are the same accent, not a second one.
 */
const isPrimarySubmit = (selector: string) =>
	/\bpayment-submit-btn\b/.test(selector) && !/submit-print/.test(selector);

describe("the payment screen spends its one accent exactly once", () => {
	it("scans the whole payment surface, not one file somebody remembered", () => {
		// The failure that let this through was a scan that could not see the
		// spelling in use. A scan over two files would be the next version of it.
		expect(PAYMENT_FILES.length).toBeGreaterThan(15);
		expect(PAYMENT_FILES.map(key)).toContain("components/pos/Payments.vue");
		expect(PAYMENT_FILES.map(key)).toContain("components/pos/payments/PaymentMethods.vue");
		expect(PAYMENT_FILES.map(key)).toContain("components/pos/payments/PaymentActionButtons.vue");
	});

	it("fills nothing but the primary with a saturated theme colour", () => {
		const offenders = PAYMENT_FILES.flatMap(opaqueThemeFills).filter(
			(fill) => !isPrimarySubmit(fill.selector),
		);
		expect(
			offenders.map((f) => `${f.file} → ${f.selector} { ${f.declaration} }`),
			"§17.7 invariant 2: exactly ONE saturated accent per screen, on the primary. " +
				"Amber and green are STATE — the band tints green for change due — so a " +
				"button wearing one teaches the cashier the band's colour means nothing. " +
				"Make it the primary, or give it an outline.",
		).toEqual([]);
	});

	it("still fills the primary, so the accent was moved and not deleted", () => {
		// A screen with NO accent is the opposite failure and just as wrong: the
		// cashier loses the one control the eye should land on.
		const primary = PAYMENT_FILES.flatMap(opaqueThemeFills).filter((fill) =>
			isPrimarySubmit(fill.selector),
		);
		expect(primary.length, "the Submit button must still carry the accent").toBeGreaterThan(0);
		for (const fill of primary) {
			expect(fill.declaration, "and the accent is the BRAND colour, never a state").toMatch(
				/--v-theme-primary/,
			);
		}
	});

	it("keeps SUBMIT & PRINT a peer of Submit without a second fill", () => {
		// Named, because this is the one the owner is looking at. The template
		// has declared it `variant="outlined"` since the accent sweep; the
		// stylesheet went on painting it green underneath, so the markup said
		// one thing and the screen showed another.
		const buttons = read(resolve(PAYMENTS_DIR, "PaymentActionButtons.vue"));
		const tag = /<v-btn[^>]*payment-submit-print-btn[^>]*>/s.exec(buttons)?.[0] ?? "";
		expect(tag, "the Submit & Print button must exist").not.toBe("");
		expect(tag).toContain('variant="outlined"');
		expect(tag, "an outlined button must not also carry a colour prop").not.toMatch(/color=/);
		const css = stylesOf(resolve(PAYMENT_FILES.find((f) => f.endsWith("PaymentActionButtons.vue"))!));
		expect(css, "and the stylesheet must agree with it").not.toMatch(
			/\.payment-submit-print-btn[^{]*\{[^}]*background[^;}]*rgb\(\s*var\(\s*--v-theme-success/,
		);
	});

	it("gives each payment row a neutral action, not one accent per tender", () => {
		// A filled button per payment row multiplies the accent by the number of
		// tenders the shop takes; on a three-method register the primary stopped
		// being the loudest thing on the screen. The template said `outlined`
		// here too and the CSS filled it teal anyway.
		const methods = resolve(PAYMENT_FILES.find((f) => f.endsWith("PaymentMethods.vue"))!);
		expect(opaqueThemeFills(methods)).toEqual([]);
	});
});
