"""Batch assignment for packed (Product Bundle) rows on the submit path.

`api/utilities.py::set_batch_nos_for_bundels` is called from
`invoice_processing/creation.py` with `throw=True` on every POS submit, but it
referenced four names the module never imported (`get_batch_no`,
`get_batch_qty`, `flt`, `_`). Only an invoice carrying packed items whose
component Item `has_batch_no` reaches the loop body, so the sale died with a
NameError exactly on the rarest path. `git log -S set_batch_nos_for_bundels`
places the loss in `742e831dc` (Api refactor #469, 2025-06-26), which copied the
function from `api/posapp.py` into `api/utilities.py` and left its
`from erpnext.stock.doctype.batch.batch import get_batch_no, get_batch_qty`
behind; `5dc4a4819` then deleted `posapp.py`, taking the only working copy.

The repaired path cannot simply import `get_batch_no` back: ERPNext's Serial
and Batch Bundle rewrite changed it to `get_batch_no(bundle_id)` returning a
{batch: qty} map (installed erpnext 16.32.0, batch.py:459), so the old
(item_code, warehouse, qty) call would be a TypeError. `pick_batch_for_packed_item`
uses `get_batch_qty(item_code=..., warehouse=...)` instead, the same v15+ pick
`invoice_processing/stock.py::_auto_set_return_batches` already relies on.

Standalone stub harness — fakes `frappe` and `erpnext` in sys.modules, so it is
skipped under `bench run-tests` and run directly with python3
(scripts/run_backend_tests.py gives every api test file its own interpreter).
The end-to-end proof on a real bench lives in test_bundle_batch_native.py.
"""

import builtins
import dis
import importlib.util
import json
import logging
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
UTILITIES_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "utilities.py"

TODAY = "2026-09-12"


class ThrownError(Exception):
    """Stand-in for frappe.ValidationError raised by frappe.throw."""


class FakeRow:
    """The parts of a Packed Item row this code touches."""

    def __init__(self, item_code="BUNDLE-COMP", warehouse="Tienda - DM", qty=2, idx=1, batch_no=None):
        self.item_code = item_code
        self.warehouse = warehouse
        self.qty = qty
        self.idx = idx
        self.batch_no = batch_no
        self.serial_no = None
        self.use_serial_batch_fields = 0

    def get(self, key, default=None):
        return getattr(self, key, default)

    def precision(self, _fieldname):
        return 3


class FakeInvoice:
    def __init__(self, packed_items):
        self.packed_items = packed_items


class FakeLogger:
    """Records what `_posa_warn` emits, at the level Frappe hands out (ERROR)."""

    def __init__(self):
        self.warnings = []
        self.level = logging.ERROR

    def setLevel(self, level):  # noqa: N802 - logging.Logger's own spelling
        self.level = level

    def warning(self, message, *args):
        self.warnings.append(message % args if args else message)


def _install_stubs():
    """Fake framework + erpnext + package chain so utilities.py imports standalone."""
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cajero@example.com")
    frappe_module.local = types.SimpleNamespace(site="doco-mirror.lab.xoloitzcuintles.com")
    frappe_module.get_all = lambda *a, **k: []
    frappe_module.get_installed_apps = lambda *a, **k: []
    frappe_module.get_traceback = lambda *a, **k: ""
    frappe_module._ = lambda value, *a, **k: value
    frappe_module._dict = dict
    frappe_module.log_error = lambda *a, **k: types.SimpleNamespace(name="ERRLOG-0001")
    frappe_module.cache = lambda: types.SimpleNamespace(
        get_value=lambda *a, **k: None, set_value=lambda *a, **k: None
    )
    logger = FakeLogger()
    frappe_module.logger = lambda *a, **k: logger
    frappe_module._fake_logger = logger

    thrown = []

    def _throw(message, exc=None, **_kwargs):
        thrown.append(message)
        raise ThrownError(message)

    frappe_module.throw = _throw
    frappe_module._thrown = thrown

    # Item.has_batch_no and Batch.expiry_date come through db.get_value.
    item_flags = {}
    batch_expiry = {}

    def _get_value(doctype, name, fieldname=None, *a, **k):
        if doctype == "Item" and fieldname == "has_batch_no":
            return item_flags.get(name, 1)
        if doctype == "Batch" and fieldname == "expiry_date":
            return batch_expiry.get(name)
        return None

    frappe_module.db = types.SimpleNamespace(
        get_value=_get_value,
        sql=lambda *a, **k: [],
        has_column=lambda *a, **k: False,
        set_value=lambda *a, **k: None,
        table_exists=lambda *a, **k: False,
    )
    frappe_module._item_flags = item_flags
    frappe_module._batch_expiry = batch_expiry
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cstr = lambda v="": "" if v is None else str(v)
    frappe_utils.add_to_date = lambda *a, **k: None
    frappe_utils.get_datetime = lambda *a, **k: None
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    frappe_utils.flt = lambda v=0, *a, **k: float(v or 0)
    frappe_utils.nowdate = lambda: TODAY
    frappe_utils.getdate = lambda v=None: v or TODAY
    sys.modules["frappe.utils"] = frappe_utils
    frappe_module.utils = frappe_utils

    def _pkg(name):
        module = types.ModuleType(name)
        module.__path__ = []
        sys.modules[name] = module
        return module

    # erpnext.stock.doctype.batch.batch.get_batch_qty — the recorder the tests
    # drive. Real signature on the installed bench:
    #   get_batch_qty(batch_no=None, warehouse=None, item_code=None, ...)
    # returning a float when batch_no AND warehouse are given, else the
    # warehouse's batches in Stock Settings' pick order.
    erpnext = _pkg("erpnext")
    stock = _pkg("erpnext.stock")
    erpnext.stock = stock
    doctype_pkg = _pkg("erpnext.stock.doctype")
    stock.doctype = doctype_pkg
    batch_pkg = _pkg("erpnext.stock.doctype.batch")
    doctype_pkg.batch = batch_pkg
    batch_module = types.ModuleType("erpnext.stock.doctype.batch.batch")

    state = types.SimpleNamespace(batches=[], batch_qty={}, calls=[])

    def _get_batch_qty(batch_no=None, warehouse=None, item_code=None, **kwargs):
        state.calls.append({"batch_no": batch_no, "warehouse": warehouse, "item_code": item_code})
        if batch_no and warehouse:
            return state.batch_qty.get(batch_no, 0)
        return list(state.batches)

    batch_module.get_batch_qty = _get_batch_qty
    batch_module._state = state
    sys.modules["erpnext.stock.doctype.batch.batch"] = batch_module
    batch_pkg.batch = batch_module
    frappe_module._batch_state = state

    root = _pkg("posawesome")
    root.__version__ = "0.0.0-test"
    root_utils = types.ModuleType("posawesome.utils")
    root_utils.get_build_version = lambda *a, **k: "test"
    sys.modules["posawesome.utils"] = root_utils
    root.utils = root_utils

    inner = _pkg("posawesome.posawesome")
    root.posawesome = inner
    api = _pkg("posawesome.posawesome.api")
    inner.api = api
    api_utils = types.ModuleType("posawesome.posawesome.api.utils")
    api_utils.get_item_groups = lambda *a, **k: []
    api_utils.fetch_sales_person_names = lambda *a, **k: {}
    sys.modules["posawesome.posawesome.api.utils"] = api_utils
    api.utils = api_utils

    return frappe_module


def _load_utilities():
    name = "posawesome.posawesome.api.utilities"
    spec = importlib.util.spec_from_file_location(name, UTILITIES_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

_SAVED_MODULES = None


def setUpModule():
    global _SAVED_MODULES
    _SAVED_MODULES = sys.modules.copy()


def tearDownModule():
    for name in [key for key in sys.modules if key not in _SAVED_MODULES]:
        del sys.modules[name]
    for name, module in _SAVED_MODULES.items():
        if sys.modules.get(name) is not module:
            sys.modules[name] = module


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class BundleBatchAssignmentCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe = _install_stubs()
        cls.utilities = _load_utilities()

    def setUp(self):
        state = self.frappe._batch_state
        state.batches = []
        state.batch_qty = {}
        state.calls = []
        self.frappe._thrown.clear()
        self.frappe._item_flags.clear()
        self.frappe._batch_expiry.clear()
        self.frappe._fake_logger.warnings.clear()

    def _batches(self, *pairs):
        """Batches in the order get_batch_qty hands them back (FIFO/expiry)."""
        self.frappe._batch_state.batches = [{"batch_no": name, "qty": qty} for name, qty in pairs]

    # ---------------------------------------------------------------- the fix

    def test_fills_batch_no_for_a_batch_tracked_packed_item(self):
        """The regression itself: this call used to raise NameError."""
        self._batches(("BATCH-A", 10.0))
        row = FakeRow(qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.batch_no, "BATCH-A")
        self.assertEqual(self.frappe._thrown, [])

    def test_picks_the_first_batch_that_covers_the_quantity(self):
        """Order is the caller's (Stock Settings pick order); short batches skip."""
        self._batches(("BATCH-SHORT", 1.0), ("BATCH-OK", 5.0), ("BATCH-LATER", 50.0))
        row = FakeRow(qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.batch_no, "BATCH-OK")

    def test_skips_an_expired_batch(self):
        self._batches(("BATCH-EXPIRED", 10.0), ("BATCH-FRESH", 10.0))
        self.frappe._batch_expiry["BATCH-EXPIRED"] = "2026-09-11"
        row = FakeRow(qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.batch_no, "BATCH-FRESH")

    def test_a_batch_expiring_today_is_still_usable(self):
        self._batches(("BATCH-TODAY", 10.0))
        self.frappe._batch_expiry["BATCH-TODAY"] = TODAY
        row = FakeRow(qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.batch_no, "BATCH-TODAY")

    def test_sets_use_serial_batch_fields_when_it_fills_the_row(self):
        """v15+ ignores a hand-set batch_no on the row without this flag."""
        self._batches(("BATCH-A", 10.0))
        row = FakeRow(qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.use_serial_batch_fields, 1)

    def test_queries_by_item_and_warehouse_not_by_bundle(self):
        """Pins the v15+ call shape; the pre-rewrite call was positional."""
        self._batches(("BATCH-A", 10.0))
        row = FakeRow(item_code="COMP-1", warehouse="Tienda - DM", qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(
            self.frappe._batch_state.calls,
            [{"batch_no": None, "warehouse": "Tienda - DM", "item_code": "COMP-1"}],
        )

    # ------------------------------------------------------- nothing available

    def test_never_blocks_the_sale_when_no_single_batch_covers_the_row(self):
        """ERPNext allocates (and can split) on submit; refusing here loses a sale.

        Measured on the lab: with this pick disabled the Serial and Batch Bundle
        allocation was identical, so a throw would only cost sales ERPNext
        completes. `throw=True` is what the submit path passes.
        """
        self._batches(("BATCH-SHORT", 1.0))
        row = FakeRow(qty=9)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertIsNone(row.batch_no)
        self.assertEqual(self.frappe._thrown, [])

    def test_an_unfillable_row_leaves_a_breadcrumb(self):
        """G9: the branch that gives up must say so, on the app logger."""
        self._batches(("BATCH-SHORT", 1.0))
        row = FakeRow(item_code="COMP-9", qty=9)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        entries = [json.loads(line) for line in self.frappe._fake_logger.warnings]
        self.assertEqual([e["scope"] for e in entries], ["bundle_batch.no_single_batch"])
        self.assertEqual(entries[0]["item_code"], "COMP-9")
        self.assertEqual(entries[0]["warehouse"], "Tienda - DM")

    def test_no_batches_at_all_is_also_left_to_erpnext(self):
        self._batches()
        row = FakeRow(qty=1)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertIsNone(row.batch_no)
        self.assertEqual(self.frappe._thrown, [])

    def test_the_row_is_still_flagged_for_serial_batch_fields(self):
        """Even unfilled: the flag is what `make_packing_list` would set anyway."""
        self._batches()
        row = FakeRow(qty=1)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.use_serial_batch_fields, 1)

    # ------------------------------------------------- a batch already chosen

    def test_keeps_a_preset_batch_that_has_enough_stock(self):
        self.frappe._batch_state.batch_qty["BATCH-CLIENT"] = 7.0
        row = FakeRow(qty=2, batch_no="BATCH-CLIENT")

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertEqual(row.batch_no, "BATCH-CLIENT")
        self.assertEqual(self.frappe._thrown, [])
        self.assertEqual(
            self.frappe._batch_state.calls,
            [{"batch_no": "BATCH-CLIENT", "warehouse": "Tienda - DM", "item_code": None}],
        )

    def test_throws_when_a_preset_batch_is_short(self):
        """`flt` was one of the four missing names, so this branch also died."""
        self.frappe._batch_state.batch_qty["BATCH-CLIENT"] = 1.0
        row = FakeRow(qty=4, batch_no="BATCH-CLIENT")

        with self.assertRaises(ThrownError):
            self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertIn("BATCH-CLIENT", self.frappe._thrown[0])

    # ------------------------------------------------------------ rows skipped

    def test_ignores_rows_whose_item_is_not_batch_tracked(self):
        self.frappe._item_flags["PLAIN"] = 0
        self._batches(("BATCH-A", 10.0))
        row = FakeRow(item_code="PLAIN", qty=2)

        self.utilities.set_batch_nos_for_bundels(FakeInvoice([row]), "warehouse", throw=True)

        self.assertIsNone(row.batch_no)
        self.assertEqual(self.frappe._batch_state.calls, [])

    def test_ignores_rows_without_a_warehouse_or_quantity(self):
        self._batches(("BATCH-A", 10.0))
        no_warehouse = FakeRow(warehouse=None, qty=2)
        no_qty = FakeRow(qty=0)

        self.utilities.set_batch_nos_for_bundels(
            FakeInvoice([no_warehouse, no_qty]), "warehouse", throw=True
        )

        self.assertIsNone(no_warehouse.batch_no)
        self.assertIsNone(no_qty.batch_no)
        self.assertEqual(self.frappe._batch_state.calls, [])

    def test_walks_every_packed_row(self):
        self._batches(("BATCH-A", 10.0))
        rows = [FakeRow(item_code="C1", qty=1, idx=1), FakeRow(item_code="C2", qty=1, idx=2)]

        self.utilities.set_batch_nos_for_bundels(FakeInvoice(rows), "warehouse", throw=True)

        self.assertEqual([r.batch_no for r in rows], ["BATCH-A", "BATCH-A"])


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class UtilitiesGlobalResolutionCase(unittest.TestCase):
    """Every global a function in utilities.py reads must exist after import.

    This is the bug class, not just the one bug: the CI ruff gate is
    `--select E9,F63,F7`, which does not include F821 (undefined name), so a
    refactor can drop an import and leave a function that raises NameError the
    first time its branch is reached. `set_batch_nos_for_bundels` carried four
    such names and `get_language_info` called a `_validate_language_code` that
    was never written at all. LOAD_GLOBAL is the exact opcode for these reads,
    and function-local imports do not use it, so this stays quiet about the
    lazy `erpnext` / `frappe.utils` imports the repaired path relies on.
    """

    @classmethod
    def setUpClass(cls):
        cls.frappe = _install_stubs()
        cls.utilities = _load_utilities()

    def test_no_function_reads_a_global_that_does_not_exist(self):
        module_names = set(vars(self.utilities)) | set(dir(builtins))
        missing = []

        for name, value in sorted(vars(self.utilities).items()):
            for func in self._functions_of(value):
                for instruction in dis.get_instructions(func):
                    if instruction.opname != "LOAD_GLOBAL":
                        continue
                    loaded = instruction.argval
                    if loaded not in module_names:
                        missing.append(f"{name} -> {loaded}")

        self.assertEqual(missing, [], f"undefined global names in utilities.py: {missing}")

    def _functions_of(self, value):
        """The function objects reachable from a module attribute."""
        code = getattr(value, "__code__", None)
        if code is not None:
            yield value
        wrapped = getattr(value, "__wrapped__", None)
        if wrapped is not None and getattr(wrapped, "__code__", None) is not None:
            yield wrapped


if __name__ == "__main__":
    unittest.main()
