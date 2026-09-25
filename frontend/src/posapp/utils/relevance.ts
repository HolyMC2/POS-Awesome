// Relevance ranking for the register's item search.
//
// A copy of the ranker in taller/frontend/src/utils/search.ts (rank(), same
// algorithm as the server's posawesome/posawesome/api/item_processing/
// relevance.py and doco/docoutils/search.py). KEEP IN SYNC: all copies carry
// the same test cases (tests/relevance.spec.ts here). This copy memoizes
// words(), because the register re-ranks its catalogue on every keystroke.
//
// Every query term must start a word (a number must not run into more
// digits: «13» ≠ «130»); item codes and barcodes match by prefix or by a 4+
// character digit-bearing fragment; exact words, typed order and short names
// rank higher, so «ip 13» lists iPhone 13 items first and never an iPhone 11
// screen whose code (MOD00135) contains 13. Mid-word and number-prefix matches
// count only when nothing matches strictly.

const STOP = new Set([
	"para",
	"de",
	"del",
	"la",
	"el",
	"los",
	"las",
	"y",
	"con",
	"a",
	"en",
	"un",
	"una",
	"por",
	"sin",
]);

/** Lowercase + strip diacritics so "batería" ≈ "bateria". */
export function normalize(s: string | null | undefined): string {
	return (s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const WORD = /[a-z0-9]+/g;
// «iphone13» → iphone|13, «13pro» → 13|pro; one- and two-letter model codes
// stay whole (a13, g13, s23, xt2343, 5g, 128gb).
const GLUE = /(?<=[a-z]{3})(?=[0-9])|(?<=[0-9])(?=[a-z]{3})/;
// Model suffixes written together («promax»); a word splits only when it is
// made entirely of these parts.
const SUFFIX_PARTS = ["pro", "max", "plus", "mini", "lite", "ultra"];
// Brand codes that are not a prefix of the brand (doco DEVICE_BRAND_ALIASES).
const BRAND_ALIASES: Record<string, string> = {
	sm: "samsung",
	sams: "samsung",
	sammy: "samsung",
};

const EXACT = 1;
const PREFIX = 0.8;
const LOOSE = 0.35;
const OTHER_FIELD_WEIGHT = 0.6;
const PHRASE_BONUS = 15;
const ORDER_BONUS = 5;
const COVERAGE_BONUS = 10;
const LEAD_BONUS = 3;

const isAlpha = (s: string) => /^[a-z]+$/.test(s);
const isDigits = (s: string) => /^[0-9]+$/.test(s);
const isDigit = (c: string | undefined) =>
	c !== undefined && c >= "0" && c <= "9";
const unique = <T>(values: T[]) => [...new Set(values)];

function splitSuffixes(word: string): string[] {
	const parts: string[] = [];
	let rest = word;
	while (rest) {
		const part = SUFFIX_PARTS.find((p) => rest.startsWith(p));
		if (!part) return [word];
		parts.push(part);
		rest = rest.slice(part.length);
	}
	return parts;
}

function computeWords(text: string): string[] {
	const out: string[] = [];
	for (const word of normalize(text).match(WORD) || []) {
		for (const piece of word.split(GLUE)) {
			out.push(...(isAlpha(piece) ? splitSuffixes(piece) : [piece]));
		}
	}
	return out;
}

// Ranking re-reads the same item names on every keystroke; the cache is
// cleared whenever it grows past the bound (catalogues are a few thousand).
const WORDS_CACHE_LIMIT = 50000;
const wordsCache = new Map<string, string[]>();

/** Text → normalized search words, split on punctuation and glued model
 *  numbers: «iPhone13ProMax» → [iphone, 13, pro, max]. Callers must not
 *  mutate the returned array (it is shared through the cache). */
export function words(text: string | null | undefined): string[] {
	const key = text || "";
	let cached = wordsCache.get(key);
	if (!cached) {
		if (wordsCache.size >= WORDS_CACHE_LIMIT) wordsCache.clear();
		cached = computeWords(key);
		wordsCache.set(key, cached);
	}
	return cached;
}

/** Spanish plural tolerance: «fundas» → «funda», «celulares» → «celular». */
export function stem(token: string): string {
	if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
	if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
	return token;
}

/** Query → terms; each term lists its alternatives (word, plural stem, brand
 *  alias). A lone letter before a number joins it: «a 13» → a13. */
export function queryTerms(
	query: string | null | undefined,
	maxTerms = 8,
): string[][] {
	const merged: string[] = [];
	for (const word of words(query)) {
		const last = merged[merged.length - 1];
		if (
			last !== undefined &&
			last.length === 1 &&
			isAlpha(last) &&
			isDigits(word)
		) {
			merged[merged.length - 1] = last + word;
		} else {
			merged.push(word);
		}
	}
	const kept = merged.filter((w) => !STOP.has(w));
	return unique(kept.length ? kept : merged)
		.map((word) => unique([word, stem(word), BRAND_ALIASES[word] ?? word]))
		.slice(0, maxTerms);
}

function wordQuality(alternative: string, word: string): [number, boolean] {
	if (word === alternative) return [EXACT, true];
	if (word.startsWith(alternative)) {
		if (
			isDigit(alternative[alternative.length - 1]) &&
			isDigit(word[alternative.length])
		)
			return [LOOSE, false];
		return [PREFIX, true];
	}
	if (
		alternative.length >= 3 &&
		!isDigits(alternative) &&
		word.includes(alternative)
	)
		return [LOOSE, false];
	return [0, false];
}

function codeQuality(term: string, code: string): number {
	if (code === term) return EXACT;
	if (term.length >= 3 && code.startsWith(term)) return PREFIX;
	if (term.length >= 4 && /[0-9]/.test(term) && code.includes(term))
		return 0.6;
	return 0;
}

type Text = string | null | undefined;

/** [score, strict] for one record, or null when a term matches nothing.
 *  strict is false when some term matched only mid-word or as a number prefix. */
export function score(
	terms: string[][],
	name: Text,
	others: Text[] = [],
	codes: Text[] = [],
): [number, boolean] | null {
	if (!terms.length) return [0, true];
	const nameWords = words(name);
	const fields: [string[], number][] = [
		[nameWords, 1],
		...others
			.filter(Boolean)
			.map((o): [string[], number] => [words(o), OTHER_FIELD_WEIGHT]),
	];
	const codeKeys = codes.filter(Boolean).map((c) => words(c).join(""));
	let total = 0;
	let strict = true;
	const positions: (number | null)[] = [];
	for (const alternatives of terms) {
		let best = 0;
		let bestStrict = false;
		let position: number | null = null;
		fields.forEach(([fieldWords, weight], fieldIndex) => {
			fieldWords.forEach((word, wordIndex) => {
				for (const alternative of alternatives) {
					const [raw, isStrict] = wordQuality(alternative, word);
					const quality = raw * weight;
					if (
						quality > best ||
						(quality === best && isStrict && !bestStrict)
					) {
						best = quality;
						bestStrict = isStrict;
						position = fieldIndex === 0 ? wordIndex : null;
					}
				}
			});
		});
		for (const code of codeKeys) {
			const quality = codeQuality(alternatives[0] ?? "", code);
			if (quality > best) {
				best = quality;
				bestStrict = true;
				position = null;
			}
		}
		if (best <= 0) return null;
		total += best;
		strict = strict && bestStrict;
		positions.push(position);
	}
	let result = (100 * total) / terms.length;
	const matched = positions.filter((p): p is number => p !== null);
	if (terms.length > 1 && matched.length === terms.length) {
		const pairs = matched
			.slice(1)
			.map((b, i) => [matched[i] as number, b] as const);
		if (pairs.every(([a, b]) => b === a + 1)) result += PHRASE_BONUS;
		else if (pairs.every(([a, b]) => b > a)) result += ORDER_BONUS;
	}
	if (nameWords.length && matched.length) {
		result += (COVERAGE_BONUS * new Set(matched).size) / nameWords.length;
		if (positions[0] === 0) result += LEAD_BONUS;
	}
	return [result, strict];
}

export interface RankFields {
	/** Primary label, e.g. item_name. */
	name: Text;
	/** Secondary text weighted lower: group, brand, aliases, location. */
	others?: Text[];
	/** Identifiers matched by prefix or long fragment: item code, barcode. */
	codes?: Text[];
}

/** Rows that match `query`, best first. The sort is stable, so the input
 *  order breaks ties. Empty query → rows unchanged. */
export function rank<T>(
	rows: readonly T[],
	query: string,
	fields: (_row: T) => RankFields,
	limit?: number,
): T[] {
	const terms = queryTerms(query);
	if (!terms.length) return limit ? rows.slice(0, limit) : [...rows];
	let scored: { score: number; strict: boolean; index: number; row: T }[] =
		[];
	rows.forEach((row, index) => {
		const f = fields(row);
		const result = score(terms, f.name, f.others, f.codes);
		if (result)
			scored.push({ score: result[0], strict: result[1], index, row });
	});
	if (scored.some((s) => s.strict)) scored = scored.filter((s) => s.strict);
	scored.sort((a, b) => b.score - a.score || a.index - b.index);
	const ranked = scored.map((s) => s.row);
	return limit ? ranked.slice(0, limit) : ranked;
}
