"""Relevance ranking for the register's item search (item_processing/relevance.py).

Pure python, no site: runs in the standalone unit suite and under bench. The
cases are the ones doco/docoutils/test_search.py and the SPA spec
(frontend/tests/relevance.spec.ts) carry; change all of them together.
"""

import importlib.util
import unittest
from pathlib import Path

_PATH = Path(__file__).resolve().parent / "item_processing" / "relevance.py"
_SPEC = importlib.util.spec_from_file_location("posa_item_search_relevance", _PATH)
relevance = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(relevance)


# Real catalogue names from the doco mirror. The SPA copies of rank() carry the
# same cases in utils/relevance.spec.ts; change both together.
ITEMS = [
    ("MOD00131", "Pantalla iPhone XS INCELL", "Pantallas y Displays"),
    ("MOD00135", "Pantalla iPhone 11 INCELL", "Pantallas y Displays"),
    ("MOD00139", "Pantalla iPhone 12 INCELL", "Pantallas y Displays"),
    ("MOD00154", "Pantalla iPhone 13 PRO MAX INCELL", "Pantallas y Displays"),
    ("MOD00148", "Pantalla iPhone 13 INCELL", "Pantallas y Displays"),
    ("IPN003214", "Bateria para iPhone 13", "Baterías"),
    ("IPN003216", "Bateria para iPhone 13 Pro Max", "Baterías"),
    ("IPN003215", "Bateria para iPhone 13 Pro", "Baterías"),
    ("IPN000180", "Anillo Case Samsung A13 5G Azul", "Fundas y Carcasas"),
    ("IPN002697", "Anillo Case Redmi 13C Gris", "Fundas y Carcasas"),
    ("IPN004713", "Camara Trasera para IPhone XS MAX", "Refacciones"),
    ("IPN000017", "Cable C a C IP 1m OEM", "Cargadores y Cables"),
    ("IPN001339", "Adaptador para cargador Europeo", "Cargadores y Cables"),
    ("IPN004720", "Flex de Carga para Equipo 13", "Refacciones"),
]


def _ranked(query):
    rows = relevance.rank(ITEMS, query, lambda r: (r[1], (r[2],), (r[0],)))
    return [r[1] for r in rows]


class TestWords(unittest.TestCase):
    def test_splits_glued_model_numbers_and_suffixes(self):
        self.assertEqual(relevance.words("iPhone13ProMax"), ["iphone", "13", "pro", "max"])
        self.assertEqual(relevance.words("Redmi Note 13Pro+"), ["redmi", "note", "13", "pro"])

    def test_short_model_codes_stay_whole(self):
        self.assertEqual(relevance.words("Samsung A13 5G / G13"), ["samsung", "a13", "5g", "g13"])

    def test_accents_fold(self):
        self.assertEqual(relevance.words("Batería Cámara"), ["bateria", "camara"])


class TestQueryTerms(unittest.TestCase):
    def test_letter_joins_following_number(self):
        self.assertEqual(relevance.query_terms("sam a 13"), [("sam",), ("a13",)])

    def test_stems_and_aliases_are_alternatives(self):
        self.assertEqual(relevance.query_terms("fundas sm"), [("fundas", "funda"), ("sm", "samsung")])


class TestRank(unittest.TestCase):
    def test_model_number_never_matches_inside_codes_or_words(self):
        # The technician's report: «ip 13» listed XS/11/12 screens through
        # MOD0013x codes, «Samsung A13» and «Redmi 13C» through substrings.
        self.assertEqual(
            _ranked("ip 13"),
            [
                "Pantalla iPhone 13 INCELL",
                "Bateria para iPhone 13",
                "Bateria para iPhone 13 Pro",
                # Equal scores keep the caller's order.
                "Pantalla iPhone 13 PRO MAX INCELL",
                "Bateria para iPhone 13 Pro Max",
            ],
        )

    def test_exact_model_ranks_before_longer_variants(self):
        self.assertEqual(
            _ranked("bateria iphone 13"),
            ["Bateria para iPhone 13", "Bateria para iPhone 13 Pro", "Bateria para iPhone 13 Pro Max"],
        )

    def test_group_field_matches_generic_word(self):
        self.assertEqual(_ranked("funda a13"), ["Anillo Case Samsung A13 5G Azul"])

    def test_code_fragment_finds_item(self):
        self.assertEqual(_ranked("4713"), ["Camara Trasera para IPhone XS MAX"])
        self.assertEqual(_ranked("MOD00148"), ["Pantalla iPhone 13 INCELL"])

    def test_short_word_needs_word_start(self):
        # «ip» must not match «equipo» or the IPN code prefix.
        self.assertNotIn("Flex de Carga para Equipo 13", _ranked("ip 13"))
        self.assertNotIn("Adaptador para cargador Europeo", _ranked("ip"))

    def test_loose_matches_only_when_nothing_is_strict(self):
        # «iphone 1» is still being typed: number prefixes fill the list.
        self.assertIn("Pantalla iPhone 11 INCELL", _ranked("iphone 1"))
        # «cable 1» has a strict hit («1m» starts with 1), so no loose noise.
        self.assertEqual(_ranked("cable 1"), ["Cable C a C IP 1m OEM"])

    def test_caller_order_breaks_ties(self):
        rows = [("B", "Case iPhone 13 Azul", ""), ("A", "Case iPhone 13 Rojo", "")]
        ranked = relevance.rank(rows, "iphone 13", lambda r: (r[1], (r[2],), (r[0],)))
        self.assertEqual([r[0] for r in ranked], ["B", "A"])

    def test_empty_query_keeps_rows(self):
        self.assertEqual(relevance.rank(ITEMS, "  ", lambda r: (r[1], (), ())), ITEMS)


class TestCandidateClause(unittest.TestCase):
    def test_codes_only_by_prefix_or_long_fragment(self):
        sql, params = relevance.candidate_clause("ip 13 4713", ["i.item_name"], ["i.item_code"])
        self.assertEqual(sql.count(" AND "), 2)
        self.assertNotIn("rk0_code", params)  # «ip» too short for codes
        self.assertNotIn("rk1_code", params)  # «13» too short for codes
        self.assertEqual(params["rk2_code"], "%4713%")

    def test_empty_is_neutral(self):
        self.assertEqual(relevance.candidate_clause(" ", ["i.item_name"]), ("1=1", {}))
