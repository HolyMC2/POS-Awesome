"""Standalone tests for the submission-ledger stuck-row sweep.

Runs without a bench: every framework module the sweep touches is stubbed
before the module is loaded, matching the pattern of the sibling
``test_creation.py`` suites (which skip under bench via ``_UNDER_BENCH``;
this file has no bench twin, so no guard is needed).
"""

import importlib.util
import json
import pathlib
import sys
import types
import unittest
from datetime import datetime, timedelta

MODULE_PATH = pathlib.Path(__file__).resolve().parent / "ledger_sweep.py"
MODULE_NAME = "posawesome.posawesome.api.invoice_processing.ledger_sweep"

FIXED_NOW = datetime(2026, 8, 15, 12, 0, 0)


class AttrDict(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__


class FakePermissionError(Exception):
    pass


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.PermissionError = FakePermissionError
    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)

    def _throw(message, exc=Exception):
        raise exc(message)

    frappe_module.throw = _throw

    log_calls = []

    def _log_error(title=None, message=None):
        log_calls.append({"title": title, "message": message})

    frappe_module.log_error = _log_error
    frappe_module._test_log_calls = log_calls

    sql_calls = []
    sql_result = []

    def _sql(query, values=None, as_dict=False):
        sql_calls.append({"query": query, "values": values})
        return list(sql_result)

    frappe_module.db = types.SimpleNamespace(sql=_sql)
    frappe_module._test_sql_calls = sql_calls
    frappe_module._test_sql_result = sql_result

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.now_datetime = lambda: FIXED_NOW
    frappe_utils.add_to_date = lambda base, hours=0: base + timedelta(hours=hours)
    frappe_module.utils = frappe_utils

    creation_stub = types.ModuleType(
        "posawesome.posawesome.api.invoice_processing.creation"
    )
    creation_stub.LEDGER_DOCTYPE = "POS Invoice Submission Ledger"
    creation_stub.STATE_RECEIVED = "RECEIVED"
    creation_stub.STATE_DRAFT_CREATED = "DRAFT_CREATED"
    creation_stub.STATE_SUBMITTED = "SUBMITTED"
    creation_stub.STATE_FAILED = "FAILED"

    gauge_calls = []
    metrics_stub = types.ModuleType("posawesome.posawesome.api.metrics")
    metrics_stub.ledger_stuck = lambda state, count: gauge_calls.append(
        (state, count)
    )
    metrics_stub._test_gauge_calls = gauge_calls

    closing_stub = types.ModuleType(
        "posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices"
    )
    closing_stub._test_is_supervisor = {"value": True}
    closing_stub.is_closing_supervisor = (
        lambda user=None: closing_stub._test_is_supervisor["value"]
    )

    stubs = {
        "frappe": frappe_module,
        "frappe.utils": frappe_utils,
        "posawesome.posawesome.api.invoice_processing.creation": creation_stub,
        "posawesome.posawesome.api.metrics": metrics_stub,
        "posawesome.posawesome.doctype.pos_closing_shift"
        ".closing_processing.invoices": closing_stub,
    }
    for name, module in stubs.items():
        sys.modules[name] = module
    return frappe_module, metrics_stub, closing_stub


def _load_module():
    spec = importlib.util.spec_from_file_location(MODULE_NAME, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


def _restore_modules(snapshot):
    for name in [k for k in sys.modules if k not in snapshot]:
        del sys.modules[name]
    for name, module in snapshot.items():
        if sys.modules.get(name) is not module:
            sys.modules[name] = module


# `unittest discover` IMPORTS every test module before RUNNING any test, so
# stubs left in sys.modules here poison the module-level imports of every
# sibling discovered after this file (their real frappe.utils import resolves
# to our thin fake → _FailedTest). Install the stubs only long enough to load
# the module under test, restore immediately, and re-install them just for
# this module's run window via setUpModule/tearDownModule.
_PRE_STUB_MODULES = sys.modules.copy()
FRAPPE, METRICS, CLOSING = _install_stubs()
SWEEP = _load_module()
_STUB_DELTA = {
    name: sys.modules[name]
    for name in sys.modules
    if sys.modules.get(name) is not _PRE_STUB_MODULES.get(name)
}
_restore_modules(_PRE_STUB_MODULES)
_RUN_SNAPSHOT = None


def setUpModule():
    global _RUN_SNAPSHOT
    _RUN_SNAPSHOT = sys.modules.copy()
    sys.modules.update(_STUB_DELTA)


def tearDownModule():
    _restore_modules(_RUN_SNAPSHOT)


class LedgerSweepTestCase(unittest.TestCase):
    def setUp(self):
        FRAPPE._test_sql_calls.clear()
        FRAPPE._test_sql_result.clear()
        FRAPPE._test_log_calls.clear()
        METRICS._test_gauge_calls.clear()
        CLOSING._test_is_supervisor["value"] = True


class TestFindStuckLedgerRows(LedgerSweepTestCase):
    def test_query_pairs_each_state_with_its_own_grace_cutoff(self):
        SWEEP.find_stuck_ledger_rows(now=FIXED_NOW)

        self.assertEqual(len(FRAPPE._test_sql_calls), 1)
        values = FRAPPE._test_sql_calls[0]["values"]
        cutoffs = dict(zip(values[0::2], values[1::2]))

        self.assertEqual(set(cutoffs), set(SWEEP.STUCK_GRACE_HOURS))
        for state, grace_hours in SWEEP.STUCK_GRACE_HOURS.items():
            self.assertEqual(
                cutoffs[state],
                FIXED_NOW - timedelta(hours=grace_hours),
                f"{state} cutoff must be its own grace window, "
                "not a shared one",
            )

    def test_submitted_has_the_short_fuse(self):
        # SUBMITTED = invoice live but Payment Entries missing; if this ever
        # drifts to a day the money hole stays invisible for a day.
        self.assertEqual(SWEEP.STUCK_GRACE_HOURS["SUBMITTED"], 1)
        self.assertTrue(
            all(
                SWEEP.STUCK_GRACE_HOURS["SUBMITTED"] <= hours
                for hours in SWEEP.STUCK_GRACE_HOURS.values()
            )
        )


class TestSweep(LedgerSweepTestCase):
    def test_zero_rows_sets_every_gauge_to_zero_and_stays_quiet(self):
        result = SWEEP.sweep_stuck_submission_ledger()

        self.assertEqual(result["total"], 0)
        self.assertEqual(
            dict(METRICS._test_gauge_calls),
            {state: 0 for state in SWEEP.STUCK_GRACE_HOURS},
        )
        self.assertEqual(FRAPPE._test_log_calls, [])

    def test_stuck_rows_gauge_counts_and_one_grouped_error_log(self):
        FRAPPE._test_sql_result.extend(
            [
                AttrDict(
                    name="L1",
                    client_request_id="req-1",
                    state="SUBMITTED",
                    company="Co",
                    pos_profile="P1",
                    document_type="Sales Invoice",
                    invoice_name="INV-1",
                    modified=FIXED_NOW - timedelta(hours=2),
                ),
                AttrDict(
                    name="L2",
                    client_request_id="req-2",
                    state="SUBMITTED",
                    company="Co",
                    pos_profile="P1",
                    document_type="Sales Invoice",
                    invoice_name="INV-2",
                    modified=FIXED_NOW - timedelta(hours=3),
                ),
                AttrDict(
                    name="L3",
                    client_request_id="req-3",
                    state="FAILED",
                    company="Co",
                    pos_profile="P1",
                    document_type="Sales Invoice",
                    invoice_name=None,
                    modified=FIXED_NOW - timedelta(days=2),
                ),
            ]
        )

        result = SWEEP.sweep_stuck_submission_ledger()

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["stuck"]["SUBMITTED"], 2)
        self.assertEqual(result["stuck"]["FAILED"], 1)
        gauges = dict(METRICS._test_gauge_calls)
        self.assertEqual(gauges["SUBMITTED"], 2)
        self.assertEqual(gauges["FAILED"], 1)
        # States with nothing stuck still get an explicit zero — a stale
        # non-zero gauge would alarm forever after the queue drained.
        self.assertEqual(gauges["RECEIVED"], 0)
        self.assertEqual(gauges["DRAFT_CREATED"], 0)

        self.assertEqual(len(FRAPPE._test_log_calls), 1)
        payload = json.loads(FRAPPE._test_log_calls[0]["message"])
        self.assertEqual(payload["counts"], {"SUBMITTED": 2, "FAILED": 1})
        self.assertEqual(
            [row["client_request_id"] for row in payload["rows"]],
            ["req-1", "req-2", "req-3"],
        )
        self.assertIn("repair_invoice_submission", payload["recovery"])


class TestSupervisorSummary(LedgerSweepTestCase):
    def test_non_supervisor_is_refused(self):
        CLOSING._test_is_supervisor["value"] = False
        with self.assertRaises(FakePermissionError):
            SWEEP.get_stuck_submission_ledger_summary()

    def test_supervisor_gets_rows_and_grace_windows(self):
        FRAPPE._test_sql_result.append(
            AttrDict(
                name="L1",
                client_request_id="req-1",
                state="SUBMITTED",
                company="Co",
                pos_profile="P1",
                document_type="Sales Invoice",
                invoice_name="INV-1",
                modified=FIXED_NOW - timedelta(hours=2),
            )
        )

        summary = SWEEP.get_stuck_submission_ledger_summary()

        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["rows"][0]["client_request_id"], "req-1")
        self.assertEqual(summary["grace_hours"], SWEEP.STUCK_GRACE_HOURS)


if __name__ == "__main__":
    unittest.main()
