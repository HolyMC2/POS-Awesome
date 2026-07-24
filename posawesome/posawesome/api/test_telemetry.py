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
import json
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

    def _add_to_date(value, days=0, hours=0, **kw):
        # Enough of frappe.utils.add_to_date for get_qz_fleet (days + hours).
        base = (
            value
            if isinstance(value, datetime.datetime)
            else datetime.datetime(2026, 6, 14, 12, 0, 0)
        )
        return base + datetime.timedelta(days=days, hours=hours)

    utils.add_to_date = _add_to_date
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


# Timestamps for the QZ fleet tests. now_datetime() is stubbed to 2026-06-14
# 12:00:00, so RECENT/EARLIER sit within the 48h stale cutoff and OLD (4 days
# back) sits beyond it.
_QZ_RECENT = datetime.datetime(2026, 6, 14, 11, 0, 0)
_QZ_EARLIER = datetime.datetime(2026, 6, 14, 9, 0, 0)
_QZ_OLD = datetime.datetime(2026, 6, 10, 12, 0, 0)


def _qz_connect_row(terminal, printer_count, ts, *, qz_version="2.2.0",
                    printers=None, default_printer="", selected_printer="",
                    cert="trusted", metadata="__DEFAULT__"):
    """Build a pos:qz_connect row shaped like frappe.get_all output (metadata
    is a JSON string, event_timestamp a datetime)."""
    if metadata == "__DEFAULT__":
        metadata = json.dumps({
            "qz_version": qz_version,
            "printers": list(printers) if printers is not None else [],
            "default_printer": default_printer,
            "selected_printer": selected_printer,
            "cert": cert,
        })
    return {
        "terminal": terminal,
        "value": printer_count,
        "event_timestamp": ts,
        "metadata": metadata,
    }


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class QzFleetTests(unittest.TestCase):
    """get_qz_fleet: newest-per-terminal dedupe, defensive metadata parse,
    server-computed flags, and the flagged-first / last_seen sort."""

    def setUp(self):
        telemetry.frappe.get_roles = lambda user=None: ["System Manager"]
        self._connect_rows = []
        self._failure_rows = []
        self._captured = {}

        def fake_get_all(doctype, filters=None, fields=None, order_by=None,
                         limit_page_length=None, **kw):
            self._captured["order_by"] = order_by
            self._captured["limit"] = limit_page_length
            self._captured["filters"] = filters
            return list(self._connect_rows)

        def fake_sql(query, values=None, as_dict=False, **kw):
            self._captured["sql"] = query
            self._captured["sql_values"] = values
            return list(self._failure_rows)

        telemetry.frappe.get_all = fake_get_all
        telemetry.frappe.db = types.SimpleNamespace(sql=fake_sql)

    def _by_terminal(self, res):
        return {t["terminal"]: t for t in res["terminals"]}

    def test_query_is_newest_first_and_bounded(self):
        telemetry.get_qz_fleet()
        self.assertEqual(self._captured["order_by"], "event_timestamp desc")
        self.assertEqual(self._captured["limit"], telemetry.QZ_FLEET_MAX_ROWS)

    def test_dedupe_keeps_newest_row_per_terminal(self):
        # Newest-first (as the real query returns): the second T1 row is older
        # and must be discarded.
        self._connect_rows = [
            _qz_connect_row("T1", 2, _QZ_RECENT, printers=["HP-1", "HP-2"]),
            _qz_connect_row("T1", 5, _QZ_OLD, printers=["OLD"]),
        ]
        res = telemetry.get_qz_fleet()
        self.assertEqual(len(res["terminals"]), 1)
        t = res["terminals"][0]
        self.assertEqual(t["terminal"], "T1")
        self.assertEqual(t["printer_count"], 2)
        self.assertEqual(t["printers"], ["HP-1", "HP-2"])
        self.assertEqual(t["last_seen"], _QZ_RECENT.isoformat())

    def test_flag_no_printers(self):
        self._connect_rows = [_qz_connect_row("T1", 0, _QZ_RECENT, printers=[])]
        t = telemetry.get_qz_fleet()["terminals"][0]
        self.assertIn("no_printers", t["flags"])
        self.assertEqual(t["printer_count"], 0)

    def test_flag_selected_missing(self):
        self._connect_rows = [
            _qz_connect_row("MISS", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="EPSON-X"),
            _qz_connect_row("OK", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1"),
        ]
        by = self._by_terminal(telemetry.get_qz_fleet())
        self.assertIn("selected_missing", by["MISS"]["flags"])
        self.assertNotIn("selected_missing", by["OK"]["flags"])

    def test_flag_cert_untrusted(self):
        self._connect_rows = [
            _qz_connect_row("U", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="untrusted"),
            _qz_connect_row("K", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="unknown"),
            _qz_connect_row("T", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="trusted"),
        ]
        by = self._by_terminal(telemetry.get_qz_fleet())
        self.assertIn("cert_untrusted", by["U"]["flags"])
        self.assertIn("cert_untrusted", by["K"]["flags"])
        self.assertNotIn("cert_untrusted", by["T"]["flags"])

    def test_failures_from_aggregate_query(self):
        self._connect_rows = [
            _qz_connect_row("F", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1"),
            _qz_connect_row("G", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1"),
        ]
        self._failure_rows = [{"terminal": "F", "failures": 3}]
        by = self._by_terminal(telemetry.get_qz_fleet())
        self.assertEqual(by["F"]["failures"], 3)
        self.assertIn("failures", by["F"]["flags"])
        self.assertEqual(by["G"]["failures"], 0)
        self.assertNotIn("failures", by["G"]["flags"])
        # Aggregate query is parameterised, not string-interpolated.
        self.assertIsInstance(self._captured["sql_values"], dict)
        self.assertEqual(
            self._captured["sql_values"]["event"], telemetry.QZ_FAILURE_EVENT
        )

    def test_malformed_metadata_does_not_raise(self):
        self._connect_rows = [
            _qz_connect_row("BAD", 1, _QZ_RECENT, metadata="{not valid json"),
            _qz_connect_row("NONE", 1, _QZ_RECENT, metadata=None),
            _qz_connect_row("LIST", 1, _QZ_RECENT, metadata=json.dumps([1, 2])),
        ]
        res = telemetry.get_qz_fleet()  # must not raise
        by = self._by_terminal(res)
        self.assertEqual(by["BAD"]["qz_version"], "")
        self.assertEqual(by["BAD"]["printers"], [])
        self.assertEqual(by["NONE"]["cert"], "")
        self.assertEqual(by["LIST"]["default_printer"], "")

    def test_days_clamped_to_1_30(self):
        self.assertEqual(telemetry.get_qz_fleet(days=100)["window"]["days"], 30)
        self.assertEqual(telemetry.get_qz_fleet(days="15")["window"]["days"], 15)
        self.assertEqual(telemetry.get_qz_fleet(days=0)["window"]["days"], 7)
        self.assertEqual(telemetry.get_qz_fleet(days=1)["window"]["days"], 1)

    def test_window_since_is_now_minus_days(self):
        res = telemetry.get_qz_fleet(days=7)
        self.assertEqual(res["window"]["days"], 7)
        self.assertEqual(res["window"]["since"], "2026-06-07T12:00:00")

    def test_stale_only_flagged_in_wide_window(self):
        self._connect_rows = [
            _qz_connect_row("S", 1, _QZ_OLD, printers=["HP-1"],
                            selected_printer="HP-1"),
        ]
        self.assertIn("stale", telemetry.get_qz_fleet(days=7)["terminals"][0]["flags"])
        # A 1-day window can't meaningfully hold a 48h-old row → not computed.
        self.assertNotIn(
            "stale", telemetry.get_qz_fleet(days=1)["terminals"][0]["flags"]
        )
        # A recent row is never stale, even in a wide window.
        self._connect_rows = [
            _qz_connect_row("R", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1"),
        ]
        self.assertNotIn(
            "stale", telemetry.get_qz_fleet(days=7)["terminals"][0]["flags"]
        )

    def test_sort_most_flags_first_then_last_seen(self):
        self._connect_rows = [
            # 0 flags
            _qz_connect_row("CLEAN", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="trusted"),
            # 1 flag (cert)
            _qz_connect_row("ONE", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="untrusted"),
            # 2 flags (no_printers + cert)
            _qz_connect_row("TWO", 0, _QZ_RECENT, printers=[], cert="untrusted"),
        ]
        order = [t["terminal"] for t in telemetry.get_qz_fleet()["terminals"]]
        self.assertEqual(order, ["TWO", "ONE", "CLEAN"])

    def test_sort_tiebreak_by_last_seen_desc(self):
        # Same flag count (1: cert) — newer last_seen wins. Input order is the
        # reverse of the expected output, proving the sort does the work.
        self._connect_rows = [
            _qz_connect_row("B", 1, _QZ_EARLIER, printers=["HP-1"],
                            selected_printer="HP-1", cert="untrusted"),
            _qz_connect_row("A", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="untrusted"),
        ]
        order = [t["terminal"] for t in telemetry.get_qz_fleet()["terminals"]]
        self.assertEqual(order, ["A", "B"])

    def test_flag_totals_aggregated(self):
        self._connect_rows = [
            _qz_connect_row("X", 0, _QZ_RECENT, printers=[], cert="untrusted"),
            _qz_connect_row("Y", 1, _QZ_RECENT, printers=["HP-1"],
                            selected_printer="HP-1", cert="untrusted"),
        ]
        totals = telemetry.get_qz_fleet()["flag_totals"]
        self.assertEqual(totals.get("cert_untrusted"), 2)
        self.assertEqual(totals.get("no_printers"), 1)

    def test_pos_manager_allowed(self):
        telemetry.frappe.get_roles = lambda user=None: ["POS Manager"]
        res = telemetry.get_qz_fleet()
        self.assertIn("terminals", res)

    def test_permission_gate_rejects_non_manager(self):
        telemetry.frappe.get_roles = lambda user=None: ["POS Cashier"]
        with self.assertRaises(Exception):
            telemetry.get_qz_fleet()


if __name__ == "__main__":
    unittest.main()
