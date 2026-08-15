"""Standalone tests for the benchmark manifest/gate logic.

Run without bench:
    python3 scripts/benchmarks/test_manifest_lib.py
"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from manifest_lib import (
    evaluate,
    evidence_class,
    extract_interactions,
    load_json,
    validate_manifest,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST_DIR = REPO_ROOT / "docs" / "benchmarks" / "manifests"


def _manifest(**overrides):
    base = {
        "manifest_id": "t",
        "manifest_version": 1,
        "roadmap_profile": "T",
        "device": {"pinned": False},
        "network": {"shaped": False},
        "dataset": {},
        "gate": {"min_samples": 5, "regression_tolerance_pct": 20},
        "interactions": [
            {
                "key": "search",
                "events": ["perf:api.items.get_items.ok"],
                "unit": "ms",
                "target_p95": 250,
                "ceiling_p99": 600,
            },
            {"key": "hole", "events": [], "unit": "ms", "gap": "not instrumented"},
        ],
    }
    base.update(overrides)
    return base


def _events(p95, p99, count=50):
    return {"perf:api.items.get_items.ok": {"count": count, "p50": p95 / 2, "p95": p95, "p99": p99}}


class TestShippedManifests(unittest.TestCase):
    def test_all_shipped_manifests_are_valid(self):
        paths = sorted(MANIFEST_DIR.glob("*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            manifest = load_json(path)
            self.assertEqual(validate_manifest(manifest), [], path.name)
            # reference hardware is not pinned yet — captures must say so
            self.assertEqual(evidence_class(manifest), "observation", path.name)

    def test_shipped_manifest_ids_match_filenames(self):
        for path in sorted(MANIFEST_DIR.glob("*.json")):
            self.assertEqual(load_json(path)["manifest_id"], path.stem)


class TestValidate(unittest.TestCase):
    def test_missing_gate_and_dup_keys_flagged(self):
        bad = _manifest()
        bad["gate"] = {}
        bad["interactions"].append(dict(bad["interactions"][0]))
        problems = validate_manifest(bad)
        self.assertTrue(any("min_samples" in p for p in problems))
        self.assertTrue(any("duplicate" in p for p in problems))

    def test_eventless_interaction_needs_gap_marker(self):
        bad = _manifest()
        bad["interactions"][1] = {"key": "hole", "events": [], "unit": "ms"}
        self.assertTrue(any("not marked as gap" in p for p in validate_manifest(bad)))


class TestExtract(unittest.TestCase):
    def test_thin_samples_never_produce_percentiles(self):
        out = extract_interactions(_manifest(), _events(300, 500, count=3))
        self.assertIsNone(out["search"]["worst_p95"])
        self.assertEqual(out["search"]["total_count"], 3)

    def test_gate_p99_false_suppresses_p99(self):
        m = _manifest()
        m["interactions"][0]["gate_p99"] = False
        out = extract_interactions(m, _events(300, 5000))
        self.assertEqual(out["search"]["worst_p95"], 300)
        self.assertIsNone(out["search"]["worst_p99"])


class TestEvaluate(unittest.TestCase):
    def test_regression_vs_baseline_fails(self):
        res = evaluate(_manifest(), {"events": _events(300, 400)}, {"events": _events(200, 300)})
        self.assertTrue(res["failed"])
        self.assertIn("REGRESSION", [f[1] for f in res["findings"]])

    def test_within_tolerance_passes(self):
        res = evaluate(_manifest(), {"events": _events(230, 400)}, {"events": _events(200, 300)})
        self.assertTrue(all(f[1] != "REGRESSION" for f in res["findings"]))
        self.assertFalse(res["failed"])

    def test_ceiling_breach_warns_by_default_and_fails_strict(self):
        capture = {"events": _events(200, 700)}
        soft = evaluate(_manifest(), capture)
        self.assertIn("CEILING-BREACH", [f[1] for f in soft["findings"]])
        self.assertFalse(soft["failed"])
        strict = evaluate(_manifest(), capture, strict_ceilings=True)
        self.assertTrue(strict["failed"])

    def test_over_target_is_warning_only(self):
        res = evaluate(_manifest(), {"events": _events(300, 500)})
        self.assertIn("OVER-TARGET", [f[1] for f in res["findings"]])
        self.assertFalse(res["failed"])

    def test_gap_and_no_data_reported(self):
        res = evaluate(_manifest(), {"events": {}})
        levels = {f[0]: f[1] for f in res["findings"]}
        self.assertEqual(levels["hole"], "GAP")
        self.assertEqual(levels["search"], "NO-DATA")
        self.assertFalse(res["failed"])


if __name__ == "__main__":
    unittest.main()
