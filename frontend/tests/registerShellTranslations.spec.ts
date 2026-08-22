/**
 * Every operator-facing string in the register has Spanish, as a build
 * failure rather than a promise (docs/POS-RIEL-Y-CAJON-BUILD.md §7).
 *
 * These tenants run in Spanish. A missing row in `es.csv` does not throw and
 * does not warn — Frappe's `__()` silently returns the English source, so an
 * untranslated string ships to a Mexican counter looking exactly like a
 * deliberate choice. Nothing catches that except a scan, which is why this
 * exists and why it reads real files rather than mounting anything (the same
 * reasoning as tests/singleAccent.spec.ts and tests/priceCheckReadOnly.spec.ts:
 * the guarantee is about the whole source tree, not about one render).
 *
 * ## Why the scope is a walk and not a list
 *
 * It used to be a hand-kept array of directories. It went stale SIX times —
 * `shortcuts/actions.ts`, then `items/`, then `invoice/`, then the
 * `shift`/`closing`/`offline`/`payments`/`flows` views, then `mobile/`. Every
 * one of those was a surface that moved into a directory the array did not
 * name, and every time this suite stayed GREEN while looking in the wrong
 * place. The strings it missed were disproportionately the ones an operator
 * reads when something has gone wrong: refusals, offline states, stamp
 * failures.
 *
 * So the scope is now the register tree itself — `components/pos` and
 * `composables/pos`, walked. A new directory is in scope the moment it
 * exists. There is nothing left to remember to update.
 *
 * That inverts the old bar. The comment this replaces argued that a suite
 * failing on 400 inherited strings gets skipped within a week, and it was
 * right about the risk — but the count was a guess, and measuring it found
 * well under a hundred. They are now translated, so the bar is the tree.
 *
 * ## Exclusions
 *
 * Every exclusion below carries the reason that path or value is exempt. An
 * exclusion nobody can justify is the same failure in a new shape — it just
 * hides in a different file. There are no PATH exclusions at all: a directory
 * under `components/pos` or `composables/pos` is a register surface, and the
 * moment one of them earns an exemption this suite is back where it started.
 *
 * No jsdom — this reads real files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../..");
const SRC = resolve(__dirname, "../src/posapp");
const ES_CSV = resolve(REPO, "posawesome/translations/es.csv");

/**
 * The register tree, walked whole. Not a list of surfaces — a list of ROOTS,
 * which is the difference that makes this self-maintaining.
 */
const SCAN_ROOTS = ["components/pos", "composables/pos"];

/**
 * `shortcuts/actions.ts` holds ENGLISH source labels on purpose — the module
 * stays import-free of the i18n global so it can be reasoned about in tests
 * and on the server later, and the cheat sheet wraps them in `__()` at render.
 * That indirection is exactly why it needs scanning: nothing in the file looks
 * like a translatable string, and the whole set had in fact never been
 * translated until the Riel y Cajón wave. It sits outside both roots, so it is
 * named here.
 */
const SCANNED_FILES = ["shortcuts/actions.ts"];

/**
 * Keys that carry a translatable value.
 *
 * `label` and `hint` are `actions.ts`'s. Everything ending in `Key` is a
 * registry's way of naming a string without importing `__()` — `labelKey`,
 * `titleKey`, `detailKey`, `noteKey`, `compactLabelKey`. Matching the SUFFIX
 * rather than an enumerated set is the same lesson as the directory walk:
 * `noteKey` shipped two untranslated qualifiers on the service-order ticket
 * ("no charge", "same ticket") purely because the old pattern spelled out
 * `labelKey` and nobody thought to add the seventh name.
 */
const KEYED = /\b(?:[A-Za-z_][A-Za-z0-9_]*Key|label|hint)\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/**
 * `sourceKey` is the one `…Key` property that does NOT name a string anyone
 * reads: it identifies where a rate came from (`bom`, `standard_rate`,
 * `valuation_rate`, `last_invoice_rate`) and `useItemRateInfo` translates a
 * separate `labelKey` beside it. Excluded by NAME, because the value is a
 * wire identifier and translating it would break the lookup it feeds.
 */
const EXCLUDED_KEY_PROPS = new Set(["sourceKey"]);

/**
 * `__("…")` and the injected `t("…")`. DestinationHost.vue takes its
 * translator as a prop rather than reaching for the global, so a scan that
 * only looked for `__(` would have missed every refusal message on it — the
 * strings an operator sees precisely when something has gone wrong.
 */
const CALLED = [
	/__\(\s*"((?:[^"\\]|\\.)*)"/g,
	/__\(\s*'((?:[^'\\]|\\.)*)'/g,
	/(?<![\w.])(?:props\.)?t\(\s*"((?:[^"\\]|\\.)*)"/g,
];

/**
 * Block and HTML comments come out before anything is extracted.
 *
 * A doc block that QUOTES a key is documentation, not shipped text —
 * `mobileSaleAction.ts` explains at length why it did NOT add a
 * `"CHARGE {0}"` row, and a scan that reads the explanation as a requirement
 * would demand a translation for a string the module deliberately does not
 * use. Line comments are left alone: `//` inside a string literal is common
 * enough (`https://`) that stripping them would lose real strings, and no
 * `__()` call has ever hidden behind one here.
 */
const stripComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/<!--[\s\S]*?-->/g, " ");

/**
 * A value with no letter in any script is the same string in every language —
 * the phone keypad's `7`, `00` and `.` are labels, and they are also not
 * translatable text. `keypadEntry.ts` says so itself with a `translate: false`
 * flag beside each digit; this rule agrees with it without having to import
 * it. Detected rather than listed, so adding a key to the keypad costs
 * nothing here.
 */
const isLanguageNeutral = (value: string) => !/\p{L}/u.test(value);

/**
 * Turn a source LITERAL into the string `__()` is actually handed.
 *
 * The regexes capture what is between the quotes, escapes and all, but the
 * runtime argument has been unescaped by the JS engine long before Frappe
 * looks it up. `usePaymentSubmission.ts`'s refund refusal is written with
 * `customer\'s` inside single quotes, so a row keyed on the captured form
 * would carry a backslash that the lookup never sees — a row that exists,
 * looks translated, and never matches.
 */
const unescapeLiteral = (raw: string): string =>
	raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_match, escape: string) => {
		switch (escape[0]) {
			case "n":
				return "\n";
			case "t":
				return "\t";
			case "r":
				return "\r";
			case "u":
			case "x":
				return String.fromCharCode(parseInt(escape.slice(1), 16));
			default:
				// \" \' \\ \` — the quote character escaping itself.
				return escape;
		}
	});

/**
 * SOURCE defects: strings this suite cannot ask `es.csv` to fix.
 *
 * §7 says an agent that needs a change outside its paths REPORTS it, and none
 * of these files belong to whoever maintains the translations. So they are
 * reported and parked here — each with the fix, which makes this list a work
 * item rather than a bucket. Adding a row for any of them would be worse than
 * leaving them: it would make the next reader believe the string was handled.
 *
 * Four kinds, and they are not the same problem.
 *
 * **1. Spanish prose that leaked into the source.** The contract is English in
 * the source, Spanish in `es.csv`; a Spanish→Spanish row papers over that
 * permanently. `useMpPointSaleGate.ts` is the whole module.
 *
 * **2. SAT terms of art.** `Razón Social`, `Régimen Fiscal`, `Uso CFDI` and
 * friends are the literal field names on the SAT's own forms and in the CFDI
 * XML. They belong in `es.csv` with an English source beside them — an
 * accountant reads Spanish, but `Razón Social` in a `.vue` is unreadable to
 * everyone upstream — and until that source change lands, inventing an English
 * key here would only be a guess at what it will be.
 *
 * **3. Concatenated inside `__()`.** `__("Exchange rate date " + date + …)`
 * hands the lookup a sentence built at runtime. No row can ever match it, and
 * the fragment the scan can see is not the string that is looked up.
 *
 * **4. A newline in the key.** `es.csv` is one row per line by the convention
 * every reader of it holds, this suite included. A key containing `\n` cannot
 * be written as one, and writing it as a quoted multi-line field would make
 * the file unreadable to keep one message translated.
 *
 * The suite asserts every entry is still present in the tree, so a fixed
 * defect cannot leave a stale line behind, and asserts none of them has
 * acquired an `es.csv` row behind its back.
 */
const SOURCE_DEFECTS = new Map<string, string>([
	// 1 — composables/pos/payments/useMpPointSaleGate.ts. The Mercado Pago
	// Point terminal gate; every operator string in the module is Spanish.
	["No se completó el cobro", 'English source: "The charge did not complete"'],
	["✅ Pago aprobado", 'English source: "Payment approved"'],
	["Tiempo agotado — verifica la terminal", 'English source: "Timed out — check the terminal"'],
	["Procesando…", 'English source: "Processing…"'],
	[
		"Esperando que el cliente pague en la terminal…",
		'English source: "Waiting for the customer to pay on the terminal…"',
	],
	["La terminal no aprobó el pago", 'English source: "The terminal did not approve the payment"'],
	["Enviando a la terminal…", 'English source: "Sending to the terminal…"'],
	["No se pudo enviar a la terminal", 'English source: "Could not send it to the terminal"'],
	["Error de conexión", 'English source: "Connection problem"'],
	["Elige la terminal para cobrar", 'English source: "Choose the terminal to charge on"'],
	[
		"Guarda la venta antes de cobrar en la terminal",
		'English source: "Save the sale before charging on the terminal"',
	],
	[
		"[MP-OVERRIDE] Terminal sin confirmar — autorizado por {0}",
		'English source: "[MP-OVERRIDE] Terminal unconfirmed — authorised by {0}"',
	],
	// 1 — composables/pos/payments/usePaymentSubmission.ts. Three Spanish
	// strings in an otherwise English module, which is how they went unnoticed.
	["Sin conexión — cuenta en cola", 'English source: "No connection — the account is queued"'],
	[
		"Se cobrará automáticamente al reconectar. No se imprime recibo todavía.",
		'English source: "It will be charged automatically on reconnect. No receipt is printed yet."',
	],
	[
		"Venta en espera de confirmación TAECEL",
		'English source: "Sale waiting on TAECEL confirmation"',
	],
	// 1 — components/pos/cfdi/CfdiStampForm.vue. Note that `Stamp CFDI` is
	// ALREADY in es.csv, translated as `Timbrar CFDI`: this source string is a
	// duplicate of a key that was translated long before this wave.
	["CFDI timbrado", 'English source: "CFDI stamped"'],
	["CFDI timbrado correctamente", 'English source: "CFDI stamped successfully"'],
	["Timbrar CFDI", 'English source: "Stamp CFDI" — es.csv already translates it'],
	// 1 — components/pos/cfdi/FacturacionDialog.vue. Dialog title and the
	// status filter chips.
	["Facturación", 'English source: "Invoicing"'],
	["Sin timbrar", 'English source: "Not stamped"'],
	["Timbradas", 'English source: "Stamped"'],
	["Timbrada", 'English source: "Stamped" (singular chip on a row)'],
	["Con error", 'English source: "With an error"'],
	// 1 — components/pos/dialogs/customer/UpdateCustomer.vue.
	["Datos fiscales (CFDI)", 'English source: "Fiscal details (CFDI)"'],
	// 2 — components/pos/cfdi/CfdiStampForm.vue and CustomerFiscalFields.vue.
	// SAT field names, spelled the way the SAT spells them.
	["Folio fiscal", "SAT field name; needs an English key before it can be a row"],
	["Método de pago (PUE/PPD)", "SAT field name; needs an English key before it can be a row"],
	["Forma de pago (SAT)", "SAT field name; needs an English key before it can be a row"],
	["Razón Social", "SAT field name; needs an English key before it can be a row"],
	["Régimen Fiscal", "SAT field name; needs an English key before it can be a row"],
	["Uso CFDI", "SAT field name; needs an English key before it can be a row"],
	["Código Postal (SAT)", "SAT field name; needs an English key before it can be a row"],
	["Persona moral", "SAT taxpayer type; needs an English key before it can be a row"],
	["Persona física", "SAT taxpayer type; needs an English key before it can be a row"],
	// 3 — components/pos/Invoice.vue and components/pos/invoice_utils/server.ts
	// both build the sentence with `+` INSIDE the `__()` call.
	[
		"Exchange rate date ",
		'concatenated inside __(); make it __("Exchange rate date {0} differs from posting date {1}", [a, b])',
	],
	// 4 — composables/pos/payments/usePaymentSubmission.ts and
	// components/pos/invoice_utils/server.ts. The list belongs in a second
	// element, not inside the key.
	[
		"Insufficient stock:\n{0}",
		'newline in the key; make it __("Insufficient stock:") with the lines rendered separately',
	],
	[
		"Stock is lower than requested:\n{0}",
		'newline in the key; make it __("Stock is lower than requested:") with the lines rendered separately',
	],
]);

function walk(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((entry) => {
		const full = resolve(dir, entry);
		return statSync(full).isDirectory() ? walk(full) : [full];
	});
}

function sourceFiles(): string[] {
	const fromRoots = SCAN_ROOTS.flatMap((d) => walk(resolve(SRC, d)));
	const fromFiles = SCANNED_FILES.map((f) => resolve(SRC, f)).filter(existsSync);
	return [...fromRoots, ...fromFiles].filter((f) => /\.(vue|ts)$/.test(f));
}

/** Every literal the scan can see, unescaped, before any exclusion applies. */
function extractAll(raw: string): string[] {
	const text = stripComments(raw);
	const out: string[] = [];
	KEYED.lastIndex = 0;
	let keyed: RegExpExecArray | null;
	while ((keyed = KEYED.exec(text)) !== null) {
		const property = keyed[0].slice(0, keyed[0].indexOf(":")).trim();
		if (EXCLUDED_KEY_PROPS.has(property)) continue;
		if (keyed[1] && keyed[1].trim()) out.push(unescapeLiteral(keyed[1]));
	}
	for (const pattern of CALLED) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			const value = match[1];
			if (value && value.trim()) out.push(unescapeLiteral(value));
		}
	}
	return out;
}

/** What `es.csv` is answerable for: everything left after the exclusions. */
const extract = (raw: string): string[] =>
	extractAll(raw).filter((value) => !isLanguageNeutral(value) && !SOURCE_DEFECTS.has(value));

/**
 * Minimal CSV read: two columns, values may be quoted when they contain a
 * comma. Deliberately not a dependency — this suite must keep working if the
 * translation pipeline changes shape around it.
 */
function translatedSources(): Set<string> {
	const rows = readFileSync(ES_CSV, "utf8").split(/\r?\n/);
	const sources = new Set<string>();
	for (const row of rows) {
		if (!row.trim()) continue;
		let source: string;
		if (row.startsWith('"')) {
			const end = row.indexOf('",');
			if (end === -1) continue;
			source = row.slice(1, end).replace(/""/g, '"');
		} else {
			const comma = row.indexOf(",");
			if (comma === -1) continue;
			source = row.slice(0, comma);
		}
		sources.add(source);
	}
	return sources;
}

describe("register shell translations", () => {
	const files = sourceFiles();
	const translated = translatedSources();

	it("scans the surfaces it claims to", () => {
		// A scan that silently found nothing would pass every other assertion
		// here forever. Pin the shape so a moved root fails loudly.
		expect(files.length).toBeGreaterThanOrEqual(200);
		for (const root of SCAN_ROOTS) {
			expect(existsSync(resolve(SRC, root)), `${root} is gone`).toBe(true);
			expect(files.some((f) => f.includes(`/${root}/`)), `${root} yielded no files`).toBe(true);
		}
		expect(files.some((f) => f.endsWith("actions.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("bandState.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("DestinationHost.vue"))).toBe(true);
	});

	it("every operator-facing string has a Spanish row", () => {
		const missing = new Map<string, string[]>();
		for (const file of files) {
			for (const value of extract(readFileSync(file, "utf8"))) {
				if (translated.has(value)) continue;
				const short = file.slice(file.indexOf("posapp/") + 7);
				missing.set(value, [...(missing.get(value) ?? []), short]);
			}
		}
		const report = [...missing.entries()]
			.map(([value, where]) => `  "${value}"  ← ${[...new Set(where)].join(", ")}`)
			.join("\n");
		expect(missing.size, `untranslated strings:\n${report}`).toBe(0);
	});

	it("the source-defect list is a work item, not a bucket", () => {
		// An entry that no longer appears in the tree means the source was
		// fixed and this line should have gone with it. Without this the list
		// silently becomes the hand-kept scope all over again, one file down.
		const present = new Set<string>();
		for (const file of files) {
			for (const value of extractAll(readFileSync(file, "utf8"))) present.add(value);
		}
		const stale = [...SOURCE_DEFECTS.keys()].filter((s) => !present.has(s));
		expect(
			stale,
			`fixed in source — drop from SOURCE_DEFECTS:\n  ${stale.join("\n  ")}`,
		).toEqual([]);
	});

	it("a parked defect never acquires an es.csv row behind its back", () => {
		// The other half of the same rule. A Spanish→Spanish row is the
		// shortcut that would make the list stop mattering; for the other
		// three kinds the row would simply never be looked up.
		const wrong = [...SOURCE_DEFECTS.keys()].filter((s) => translated.has(s));
		expect(wrong, `rows that cannot help:\n  ${wrong.join("\n  ")}`).toEqual([]);
	});

	it("placeholders survive translation", () => {
		// A Spanish sentence reorders its clauses, and a translator dropping
		// `{0}` produces a band that reads "Total a cobrar ·" with no number.
		const rows = readFileSync(ES_CSV, "utf8").split(/\r?\n/);
		const broken: string[] = [];
		for (const file of files) {
			for (const value of extract(readFileSync(file, "utf8"))) {
				const wanted = value.match(/\{\d\}/g);
				if (!wanted) continue;
				const row = rows.find((r) => r.startsWith(value + ",") || r.startsWith(`"${value}"`));
				if (!row) continue;
				for (const token of new Set(wanted)) {
					if (!row.slice(value.length).includes(token)) broken.push(`${value} → missing ${token}`);
				}
			}
		}
		expect(broken, broken.join("\n")).toEqual([]);
	});
});
