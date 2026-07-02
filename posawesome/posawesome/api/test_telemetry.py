"""Unit tests for posawesome.posawesome.api.telemetry._sanitise_event.

Same stub-frappe pattern as test_scope.py / test_purchase_orders.py — runs
without bench so the suite stays green in CI containers that don't have the
Frappe SDK.

Focus: the web-vital sanity cap (WEBVITAL_MS_EVENTS / MAX_WEBVITAL_MS) added
after prod telemetry showed background-throttle artifacts (rum:inp 82 min,
rum:lcp 59 min) wrecking max/p99. Also locks the pre-existing ResizeObserver
crash filter so a refactor can't silently drop it.
"""

from __future__ import annotations

import datetime
import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _build_frappe_module() -> types.ModuleType:
    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text
    frappe_module.throw = lambda message, exc=Exception: (_ for _ in ()).throw(
        Exception(message)
    )
    frappe_module.whitelist = lambda *a, **kw: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cashier@doco")
    frappe_module.generate_hash = lambda length=10: "0" * length

    def _get_datetime(value):
        # Mirror frappe.utils.get_datetime enough for the cap tests: the
        # cap runs before timestamp parsing, so a naive "now" is fine.
        if isinstance(value, datetime.datetime):
            return value
        return datetime.datetime(2026, 6, 14, 12, 0, 0)

    utils = types.ModuleType("frappe.utils")
    utils.cint = lambda v: int(v or 0)
    utils.flt = lambda v=0, precision=None: float(v or 0)
    utils.getdate = lambda *a, **kw: datetime.date(2026, 6, 14)
    utils.now_datetime = lambda: datetime.datetime(2026, 6, 14, 12, 0, 0)
    utils.get_datetime = _get_datetime
    frappe_module.utils = utils
    frappe_module.flt = utils.flt

    rate_limiter = types.ModuleType("frappe.rate_limiter")
    rate_limiter.rate_limit = lambda *a, **kw: (lambda fn: fn)
    frappe_module.rate_limiter = rate_limiter

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = utils
    sys.modules["frappe.rate_limiter"] = rate_limiter
    return frappe_module


def _import_telemetry():
    _build_frappe_module()
    sys.modules.pop("posawesome.posawesome.api.telemetry", None)
    spec = importlib.util.spec_from_file_location(
        "posawesome_telemetry_under_test",
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "telemetry.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: this file fakes `frappe` in sys.modules, which
# would poison a real bench process for every test imported after it. Must be
# evaluated BEFORE _import_telemetry() swaps in the stub, and the import must
# be skipped entirely under bench — a module-level stub install at discovery
# time broke `bench run-tests --app posawesome` for the whole app.
# Run directly: python3 <this file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

telemetry = None if _UNDER_BENCH else _import_telemetry()


def _event(name: str, value):
    return {"event_name": name, "value": value}

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class WebVitalCapTests(unittest.TestCase):
    def test_normal_inp_kept(self):
        row = telemetry._sanitise_event(_event("rum:inp", 200))
        self.assertIsNotNone(row)
        self.assertEqual(row["value"], 200.0)

    def test_oversized_inp_dropped(self):
        # The actual prod outlier.
        self.assertIsNone(telemetry._sanitise_event(_event("rum:inp", 4_971_552)))

    def test_negative_vital_dropped(self):
        self.assertIsNone(telemetry._sanitise_event(_event("rum:longtask", -5)))

    def test_lcp_boundary(self):
        self.assertIsNotNone(telemetry._sanitise_event(_event("rum:lcp", 60000)))
        self.assertIsNone(telemetry._sanitise_event(_event("rum:lcp", 60000.1)))

    def test_all_ms_vitals_capped(self):
        for name in ("rum:lcp", "rum:fcp", "rum:inp", "rum:longtask"):
            self.assertIsNone(
                telemetry._sanitise_event(_event(name, 3_568_076)),
                f"{name} over cap should drop",
            )

    def test_perf_api_timing_not_capped(self):
        # A real 120 s get_items is signal we want to keep, not an artifact.
        row = telemetry._sanitise_event(
            _event("perf:api.items.get_items.ok", 120000)
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["value"], 120000.0)

    def test_cls_exempt(self):
        # CLS is a unitless score, not ms — the cap must not touch it even
        # at a numerically large value.
        row = telemetry._sanitise_event(_event("rum:cls", 70000))
        self.assertIsNotNone(row)

    def test_heap_mb_exempt(self):
        row = telemetry._sanitise_event(_event("rum:heap_used_mb", 70000))
        self.assertIsNotNone(row)


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class CrashFilterRegressionTests(unittest.TestCase):
    def test_resizeobserver_crash_dropped(self):
        ev = {
            "event_name": "crash:error",
            "value": 1,
            "metadata": {"message": "ResizeObserver loop completed with undelivered notifications."},
        }
        self.assertIsNone(telemetry._sanitise_event(ev))

    def test_real_crash_kept(self):
        ev = {
            "event_name": "crash:error",
            "value": 1,
            "metadata": {"message": "TypeError: x is undefined"},
        }
        self.assertIsNotNone(telemetry._sanitise_event(ev))

    def test_unknown_prefix_dropped(self):
        self.assertIsNone(telemetry._sanitise_event(_event("garbage:foo", 1)))


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TelemetrySummaryOrderTests(unittest.TestCase):
    """get_pos_telemetry_summary: the newest/order opt-in + truncated flag
    added after the 50k-ASC cap silently summarised the OLDEST rows on a
    busy tenant (recent activity looked truncated, last_seen stalled)."""

    def setUp(self):
        telemetry.frappe.get_roles = lambda user=None: ["System Manager"]
        self._captured = {}
        # Intentionally unsorted, two event_names, mixed timestamps.
        self._rows = [
            {"event_name": "rum:inp", "value": 10, "event_timestamp": "2026-06-20 10:00:00.000000"},
            {"event_name": "rum:inp", "value": 30, "event_timestamp": "2026-06-20 12:00:00.000000"},
            {"event_name": "rum:inp", "value": 20, "event_timestamp": "2026-06-20 11:00:00.000000"},
            {"event_name": "crash:error", "value": 1, "event_timestamp": "2026-06-20 09:00:00.000000"},
        ]

        def fake_get_all(doctype, filters=None, fields=None, order_by=None,
                         limit_page_length=None, **kw):
            self._captured["order_by"] = order_by
            self._captured["limit"] = limit_page_length
            return list(self._rows)

        telemetry.frappe.get_all = fake_get_all

    def test_default_order_is_asc(self):
        res = telemetry.get_pos_telemetry_summary()
        self.assertEqual(self._captured["order_by"], "event_timestamp asc")
        self.assertEqual(res["window"]["order"], "asc")

    def test_newest_flips_to_desc(self):
        res = telemetry.get_pos_telemetry_summary(newest="1")
        self.assertEqual(self._captured["order_by"], "event_timestamp desc")
        self.assertEqual(res["window"]["order"], "desc")

    def test_newest_truthy_and_falsy_variants(self):
        for v in (True, "1", "true", "True", "yes", "on"):
            telemetry.get_pos_telemetry_summary(newest=v)
            self.assertEqual(self._captured["order_by"], "event_timestamp desc", v)
        for v in (False, "0", "false", "", None, "no", "off"):
            telemetry.get_pos_telemetry_summary(newest=v)
            self.assertEqual(self._captured["order_by"], "event_timestamp asc", v)

    def test_last_seen_is_max_timestamp_regardless_of_fetch_order(self):
        res = telemetry.get_pos_telemetry_summary()
        self.assertEqual(
            res["events"]["rum:inp"]["last_seen"], "2026-06-20 12:00:00.000000"
        )
        # Reverse the rows (simulating a DESC fetch) → last_seen unchanged.
        self._rows = list(reversed(self._rows))
        res2 = telemetry.get_pos_telemetry_summary(newest="1")
        self.assertEqual(
            res2["events"]["rum:inp"]["last_seen"], "2026-06-20 12:00:00.000000"
        )

    def test_aggregation_is_order_independent(self):
        asc = telemetry.get_pos_telemetry_summary()["events"]["rum:inp"]
        self._rows = list(reversed(self._rows))
        desc = telemetry.get_pos_telemetry_summary(newest="1")["events"]["rum:inp"]
        for k in ("count", "p50", "p95", "p99", "max"):
            self.assertEqual(asc[k], desc[k], k)
        self.assertEqual(asc["count"], 3)
        self.assertEqual(asc["max"], 30.0)

    def test_crashes_counted(self):
        res = telemetry.get_pos_telemetry_summary()
        self.assertEqual(res["crashes"], 1)

    def test_truncated_true_when_page_full(self):
        def full_page(doctype, filters=None, fields=None, order_by=None,
                      limit_page_length=None, **kw):
            return [
                {"event_name": "rum:inp", "value": 1,
                 "event_timestamp": "2026-06-20 10:00:00.000000"}
                for _ in range(limit_page_length)
            ]

        telemetry.frappe.get_all = full_page
        res = telemetry.get_pos_telemetry_summary(limit=1000)
        self.assertTrue(res["window"]["truncated"])
        self.assertEqual(res["window"]["row_count"], 1000)
        self.assertEqual(res["window"]["limit"], 1000)

    def test_not_truncated_when_page_partial(self):
        res = telemetry.get_pos_telemetry_summary()  # 4 rows << 1000 floor
        self.assertFalse(res["window"]["truncated"])

    def test_permission_gate_rejects_non_manager(self):
        telemetry.frappe.get_roles = lambda user=None: ["POS Cashier"]
        with self.assertRaises(Exception):
            telemetry.get_pos_telemetry_summary()


if __name__ == "__main__":
    unittest.main()
