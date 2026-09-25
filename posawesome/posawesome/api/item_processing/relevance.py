# Copyright (c) 2026, Marco and contributors
# For license information, please see license.txt

"""Relevance ranking for the register's item search.

A copy of doco.docoutils.search's ranking section (rank, score, words,
query_terms, term_patterns). POS Awesome runs without doco, so it carries its
own copy; KEEP IN SYNC with doco/docoutils/search.py and with the SPA port in
frontend/src/posapp/utils/relevance.ts (all three share the same test cases).

Every query term must start a word (a number must not run into more digits:
«13» ≠ «130»); item codes and barcodes match by prefix or by a 4+ character
digit-bearing fragment; exact words, typed order and short names rank
higher, so «ip 13» lists iPhone 13 items first and never an iPhone 11 screen
whose code (MOD00135) contains 13. Mid-word and number-prefix matches count
only when nothing matches strictly, which keeps as-you-type results useful.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from itertools import pairwise

_STOP = {
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
}


def stem(token: str) -> str:
    """Spanish plural tolerance for substring LIKE: 'fundas'→'funda', 'celulares'→
    'celular'. Matching on the stem hits singular AND plural names (the plural still
    contains the stem). Numbers/short tokens untouched; a naive over-stem ('lentes'→
    'lent') only WIDENS the match — always the safe direction for search."""
    if len(token) > 4 and token.endswith("es"):
        return token[:-2]
    if len(token) > 3 and token.endswith("s"):
        return token[:-1]
    return token


DEVICE_BRAND_ALIASES = {
    "sm": "samsung",  # Samsung's SM-Axxx model-code prefix
    "sams": "samsung",
    "sammy": "samsung",
}


_WORD = re.compile(r"[a-z0-9]+")
# «iphone13» → iphone|13, «13pro» → 13|pro; one- and two-letter model codes stay whole
# (a13, g13, s23, xt2343, 5g, 128gb).
_GLUE = re.compile(r"(?<=[a-z]{3})(?=[0-9])|(?<=[0-9])(?=[a-z]{3})")
# Model suffixes written together («promax»). A word splits only when it is
# made entirely of these parts.
_SUFFIX_PARTS = ("pro", "max", "plus", "mini", "lite", "ultra")

_EXACT, _PREFIX, _LOOSE = 1.0, 0.8, 0.35
_OTHER_FIELD_WEIGHT = 0.6
_PHRASE_BONUS, _ORDER_BONUS, _COVERAGE_BONUS, _LEAD_BONUS = 15.0, 5.0, 10.0, 3.0


def normalize(text: str | None) -> str:
    """Lowercase and strip diacritics: «Batería» → «bateria»."""
    decomposed = unicodedata.normalize("NFD", (text or "").lower())
    return "".join(c for c in decomposed if not unicodedata.category(c).startswith("M"))


def _split_suffixes(word: str) -> list[str]:
    parts, rest = [], word
    while rest:
        part = next((p for p in _SUFFIX_PARTS if rest.startswith(p)), None)
        if not part:
            return [word]
        parts.append(part)
        rest = rest[len(part) :]
    return parts


def words(text: str | None) -> list[str]:
    """Text → normalized search words, split on punctuation and glued model
    numbers: «iPhone13ProMax» → [iphone, 13, pro, max]."""
    return list(_cached_words(text or ""))


@lru_cache(maxsize=32768)
def _cached_words(text: str) -> tuple[str, ...]:
    # Ranking re-reads the same names and groups on every page request.
    out: list[str] = []
    for word in _WORD.findall(normalize(text)):
        for piece in _GLUE.split(word):
            out.extend(_split_suffixes(piece) if piece.isalpha() else [piece])
    return tuple(out)


def query_terms(query: str | None, max_terms: int = 8) -> list[tuple[str, ...]]:
    """Query → terms; each term is a tuple of alternatives (word, plural stem,
    brand alias). A lone letter before a number joins it: «a 13» → a13."""
    merged: list[str] = []
    for word in words(query):
        if merged and len(merged[-1]) == 1 and merged[-1].isalpha() and word.isdigit():
            merged[-1] += word
        else:
            merged.append(word)
    kept = [w for w in merged if w not in _STOP] or merged
    terms: list[tuple[str, ...]] = []
    for word in dict.fromkeys(kept):
        alternatives = [word, stem(word), DEVICE_BRAND_ALIASES.get(word, word)]
        terms.append(tuple(dict.fromkeys(alternatives)))
    return terms[:max_terms]


def _word_quality(alternative: str, word: str) -> tuple[float, bool]:
    if word == alternative:
        return _EXACT, True
    if word.startswith(alternative):
        if alternative[-1].isdigit() and word[len(alternative)].isdigit():
            return _LOOSE, False
        return _PREFIX, True
    if len(alternative) >= 3 and not alternative.isdigit() and alternative in word:
        return _LOOSE, False
    return 0.0, False


def _code_quality(term: str, code: str) -> float:
    if code == term:
        return _EXACT
    if len(term) >= 3 and code.startswith(term):
        return _PREFIX
    if len(term) >= 4 and any(c.isdigit() for c in term) and term in code:
        return 0.6
    return 0.0


def score(
    terms: list[tuple[str, ...]],
    name: str | None,
    others: tuple | list = (),
    codes: tuple | list = (),
) -> tuple[float, bool] | None:
    """(score, strict) for one record, or None when a term matches nothing.

    `name` is the primary label; `others` are secondary text fields (group,
    brand, aliases) weighted lower; `codes` are identifiers (item code,
    barcode). strict is False when some term matched only mid-word or as a
    number prefix."""
    if not terms:
        return (0.0, True)
    name_words = _cached_words(name or "")
    fields = [(name_words, 1.0)] + [(_cached_words(o), _OTHER_FIELD_WEIGHT) for o in others if o]
    code_keys = ["".join(_cached_words(c)) for c in codes if c]
    total, strict, positions = 0.0, True, []
    for alternatives in terms:
        best, best_strict, position = 0.0, False, None
        for field_index, (field_words, weight) in enumerate(fields):
            for word_index, word in enumerate(field_words):
                for alternative in alternatives:
                    quality, is_strict = _word_quality(alternative, word)
                    quality *= weight
                    if quality > best or (quality == best and is_strict and not best_strict):
                        best, best_strict = quality, is_strict
                        position = word_index if field_index == 0 else None
        for code in code_keys:
            quality = _code_quality(alternatives[0], code)
            if quality > best:
                best, best_strict, position = quality, True, None
        if best <= 0:
            return None
        total += best
        strict = strict and best_strict
        positions.append(position)
    result = 100 * total / len(terms)
    matched = [p for p in positions if p is not None]
    if len(terms) > 1 and len(matched) == len(terms):
        pairs = list(pairwise(matched))
        if all(b == a + 1 for a, b in pairs):
            result += _PHRASE_BONUS
        elif all(b > a for a, b in pairs):
            result += _ORDER_BONUS
    if name_words and matched:
        result += _COVERAGE_BONUS * len(set(matched)) / len(name_words)
        if positions[0] == 0:
            result += _LEAD_BONUS
    return (result, strict)


def rank(rows, query: str | None, fields, limit: int | None = None) -> list:
    """Rows that match `query`, best first. `fields(row)` returns
    (name, others, codes). The sort is stable, so the caller's order breaks
    ties (for example stock first, then name). Empty query → rows unchanged."""
    terms = query_terms(query)
    rows = list(rows)
    if not terms:
        return rows[:limit] if limit else rows
    scored = []
    for index, row in enumerate(rows):
        name, others, codes = fields(row)
        result = score(terms, name, others, codes)
        if result:
            scored.append((result[0], result[1], index, row))
    if any(strict for _, strict, _, _ in scored):
        scored = [entry for entry in scored if entry[1]]
    scored.sort(key=lambda entry: (-entry[0], entry[2]))
    ranked = [entry[3] for entry in scored]
    return ranked[:limit] if limit else ranked


def term_patterns(query: str | None) -> list[tuple[list[str], str | None]]:
    """LIKE patterns per query term: (text patterns, code pattern). A record is
    a candidate when, for every term, a text column matches one text pattern or
    a code column matches the code pattern (None: term too short for codes).
    Terms are [a-z0-9] only, so the patterns need no escaping."""
    patterns: list[tuple[list[str], str | None]] = []
    for alternatives in query_terms(query):
        term = alternatives[0]
        code = None
        if len(term) >= 3:
            code = f"%{term}%" if len(term) >= 4 and any(c.isdigit() for c in term) else f"{term}%"
        patterns.append(([f"%{alternative}%" for alternative in alternatives], code))
    return patterns


def candidate_clause(
    query: str | None,
    text_columns: list[str],
    code_columns: list[str] | tuple = (),
    prefix: str = "rk",
) -> tuple[str, dict]:
    """SQL prefilter for rank(), built from term_patterns(). It returns a
    superset of rank()'s matches (MariaDB's _ci collations fold case and
    accents), so fetch these rows and pass them through rank().
    Empty query → ("1=1", {})."""
    patterns = term_patterns(query)
    if not patterns or not (text_columns or code_columns):
        return ("1=1", {})
    clauses: list[str] = []
    params: dict[str, str] = {}
    for i, (text_patterns, code_pattern) in enumerate(patterns):
        options: list[str] = []
        for j, pattern in enumerate(text_patterns):
            key = f"{prefix}{i}_{j}"
            params[key] = pattern
            options.extend(f"{column} LIKE %({key})s" for column in text_columns)
        if code_columns and code_pattern:
            key = f"{prefix}{i}_code"
            params[key] = code_pattern
            options.extend(f"{column} LIKE %({key})s" for column in code_columns)
        clauses.append("(" + " OR ".join(options) + ")")
    return (" AND ".join(clauses), params)


def candidate_order(query: str | None, column: str, prefix: str = "ro") -> tuple[str, dict]:
    """Coarse SQL relevance for ORDER BY … DESC before a candidate LIMIT: how
    many terms start a word of `column` (space-separated only). Keeps the best
    rows inside the cap when a broad query has thousands of candidates."""
    terms = query_terms(query)
    if not terms:
        return ("0", {})
    parts: list[str] = []
    params: dict[str, str] = {}
    for i, alternatives in enumerate(terms):
        start, inner = f"{prefix}{i}_s", f"{prefix}{i}_w"
        params[start], params[inner] = f"{alternatives[0]}%", f"% {alternatives[0]}%"
        parts.append(f"({column} LIKE %({start})s OR {column} LIKE %({inner})s)")
    return ("(" + " + ".join(parts) + ")", params)
