"""The MercadoPago Point override audit line actually reaches a file.

`api/mp_audit.py::log_mp_override` used to report every supervisor override of
the Point sale gate through `frappe.logger("mp_point").warning(...)`. That wrote
nothing anywhere on this estate: Frappe creates a module logger at
`logging.WARNING if frappe._dev_server else logging.ERROR` and `DEV_SERVER` is
unset with no `log_level` in common_site_config.json on the lab and on cell-0,
so a `.warning()` on a freshly handed-out logger is dropped. `mp_point` was also
its own logger name, so the wave-1 `_posa_site_logger` INFO raise on the shared
`posawesome` logger never reached it (LOGGING_MAP section 7, w5 residual R5c).

These tests hand the code a REAL `logging.Logger` at level ERROR writing to a
temp file - what Frappe hands out here - and assert the JSON record is on disk
afterwards, which a level assertion alone would not prove.

Standalone stub harness - fakes `frappe` in sys.modules, so it is skipped under
`bench run-tests` and run directly with python3.
"""

import importlib.util
import json
import logging
import pathlib
import shutil
import sys
import tempfile
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
API_DIR = REPO_ROOT / "posawesome" / "posawesome" / "api"
UTILITIES_PATH = API_DIR / "utilities.py"
MP_AUDIT_PATH = API_DIR / "mp_audit.py"


class ThrownError(Exception):
    """Stand-in for frappe.PermissionError raised by frappe.throw."""


class FakeComment:
    """The Comment doc log_mp_override inserts on the invoice timeline."""

    def __init__(self, payload, recorder):
        self.payload = payload
        self.recorder = recorder
        self.flags = types.SimpleNamespace(ignore_permissions=False)

    def insert(self, ignore_permissions=False):
        self.recorder.append(self.payload)


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="supervisor@example.com")
    frappe_module.local = types.SimpleNamespace(
        site="doco-mirror.lab.xoloitzcuintles.com", request_id="req-mp-001"
    )
    frappe_module.get_all = lambda *a, **k: []
    frappe_module.get_installed_apps = lambda *a, **k: []
    frappe_module.get_traceback = lambda *a, **k: ""
    frappe_module._ = lambda value, *a, **k: value
    frappe_module._dict = dict
    frappe_module.PermissionError = ThrownError
    frappe_module.log_error = lambda *a, **k: types.SimpleNamespace(name="ERRLOG-0001")
    frappe_module.cache = lambda: types.SimpleNamespace(
        get_value=lambda *a, **k: None, set_value=lambda *a, **k: None
    )

    def _throw(message, exc=None, **_kwargs):
        raise (exc or ThrownError)(message)

    frappe_module.throw = _throw

    comments = []
    frappe_module._comments = comments
    frappe_module.get_doc = lambda payload: FakeComment(payload, comments)

    existing = {("Sales Invoice", "ACC-SINV-2026-09999")}
    frappe_module._existing = existing
    frappe_module.db = types.SimpleNamespace(
        exists=lambda doctype, name: (doctype, name) in existing,
        get_value=lambda *a, **k: "Doco Mexico",
        sql=lambda *a, **k: [],
        has_column=lambda *a, **k: False,
        set_value=lambda *a, **k: None,
        table_exists=lambda *a, **k: False,
    )

    # The logger is the subject: a real one, at the level Frappe hands out.
    loggers = {}

    def _logger(name="frappe", *a, **k):
        site = getattr(frappe_module.local, "site", "unknown")
        key = f"{name}-{site}"
        if key not in loggers:
            logger = logging.getLogger(f"test-{key}")
            logger.handlers = []
            logger.propagate = False
            logger.setLevel(logging.ERROR)
            handler = logging.FileHandler(frappe_module._log_dir / f"{key}.log", encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
            loggers[key] = logger
        return loggers[key]

    frappe_module.logger = _logger
    frappe_module._loggers = loggers
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cstr = lambda v="": "" if v is None else str(v)
    frappe_utils.add_to_date = lambda *a, **k: None
    frappe_utils.get_datetime = lambda *a, **k: None
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    frappe_utils.flt = lambda v=0, *a, **k: float(v or 0)
    frappe_utils.strip_html = lambda v="": str(v)
    sys.modules["frappe.utils"] = frappe_utils
    frappe_module.utils = frappe_utils

    def _pkg(name):
        module = types.ModuleType(name)
        module.__path__ = []
        sys.modules[name] = module
        return module

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

    scope = types.ModuleType("posawesome.posawesome.api._scope")
    scope.assert_company = lambda *a, **k: None
    sys.modules["posawesome.posawesome.api._scope"] = scope
    api._scope = scope

    return frappe_module


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
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
class MpOverrideAuditLoggingCase(unittest.TestCase):
    INVOICE = "ACC-SINV-2026-09999"

    @classmethod
    def setUpClass(cls):
        cls.log_dir = pathlib.Path(tempfile.mkdtemp(prefix="posa-mp-audit-"))
        cls.frappe = _install_stubs()
        cls.frappe._log_dir = cls.log_dir
        # utilities must be registered under its real dotted name: mp_audit
        # reaches _posa_warn through `from .utilities import _posa_warn`.
        cls.utilities = _load("posawesome.posawesome.api.utilities", UTILITIES_PATH)
        sys.modules["posawesome.posawesome.api"].utilities = cls.utilities
        cls.mp_audit = _load("posawesome.posawesome.api.mp_audit", MP_AUDIT_PATH)

    @classmethod
    def tearDownClass(cls):
        for logger in cls.frappe._loggers.values():
            for handler in list(logger.handlers):
                handler.close()
                logger.removeHandler(handler)
        shutil.rmtree(cls.log_dir, ignore_errors=True)

    def setUp(self):
        self.frappe._comments.clear()
        self.frappe.local.site = "doco-mirror.lab.xoloitzcuintles.com"
        for logger in self.frappe._loggers.values():
            logger.setLevel(logging.ERROR)
        for path in self.log_dir.glob("*.log"):
            path.write_text("", encoding="utf-8")

    def _lines(self, site=None):
        site = site or self.frappe.local.site
        path = self.log_dir / f"posawesome-{site}.log"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    # ------------------------------------------------------------ the fix

    def test_override_line_lands_on_disk(self):
        """The regression: at level ERROR the old .warning() wrote zero bytes."""
        result = self.mp_audit.log_mp_override(invoice_name=self.INVOICE)

        self.assertEqual(result, {"logged": True})
        lines = self._lines()
        self.assertEqual(len(lines), 1, f"expected one audit line, got {lines}")

    def test_the_line_is_a_json_record_with_the_audit_fields(self):
        self.mp_audit.log_mp_override(invoice_name=self.INVOICE, note="terminal offline")

        entry = self._lines()[0]
        self.assertEqual(entry["app"], "posawesome")
        self.assertEqual(entry["scope"], "mp_override")
        self.assertEqual(entry["site"], "doco-mirror.lab.xoloitzcuintles.com")
        self.assertEqual(entry["user"], "supervisor@example.com")
        self.assertEqual(entry["invoice"], self.INVOICE)
        self.assertEqual(entry["target_doctype"], "Sales Invoice")
        self.assertEqual(entry["note"], "terminal offline")
        self.assertEqual(entry["comment"], "written")
        self.assertIn("MP-OVERRIDE", entry["msg"])

    def test_the_line_carries_the_request_id(self):
        """LOGGING_MAP G3/D6: the override must be joinable to its request."""
        self.mp_audit.log_mp_override(invoice_name=self.INVOICE)

        self.assertEqual(self._lines()[0]["rid"], "req-mp-001")

    def test_the_level_is_raised_to_info_once(self):
        logger = self.frappe.logger("posawesome")
        self.assertEqual(logger.level, logging.ERROR)

        self.mp_audit.log_mp_override(invoice_name=self.INVOICE)

        self.assertEqual(logger.level, logging.INFO)

    def test_each_site_gets_its_own_logger_and_file(self):
        """Per-call resolution: one tenant's overrides never land in another's file."""
        self.mp_audit.log_mp_override(invoice_name=self.INVOICE)

        self.frappe.local.site = "ventas.mumulenceria.com"
        self.frappe._existing.add(("Sales Invoice", "MUMU-SINV-0001"))
        self.mp_audit.log_mp_override(invoice_name="MUMU-SINV-0001")

        mirror = self._lines("doco-mirror.lab.xoloitzcuintles.com")
        mumu = self._lines("ventas.mumulenceria.com")
        self.assertEqual([e["invoice"] for e in mirror], [self.INVOICE])
        self.assertEqual([e["invoice"] for e in mumu], ["MUMU-SINV-0001"])

    # ---------------------------------------------- the audit line is durable

    def test_the_line_lands_even_when_no_comment_could_be_written(self):
        """The point of the server log: the draft may be deleted before submit."""
        result = self.mp_audit.log_mp_override(invoice_name="ACC-SINV-DOES-NOT-EXIST")

        self.assertEqual(result, {"logged": False})
        self.assertEqual(self.frappe._comments, [])
        entry = self._lines()[0]
        self.assertEqual(entry["comment"], "skipped")

    def test_an_absent_note_is_omitted_rather_than_logged_empty(self):
        self.mp_audit.log_mp_override(invoice_name=self.INVOICE)

        self.assertNotIn("note", self._lines()[0])

    def test_reporting_never_breaks_the_override(self):
        """Audit plumbing must not fail a sale the supervisor already authorized."""
        original = self.frappe.logger
        self.frappe.logger = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no log dir"))
        try:
            result = self.mp_audit.log_mp_override(invoice_name=self.INVOICE)
        finally:
            self.frappe.logger = original

        self.assertEqual(result, {"logged": True})
        self.assertEqual(len(self.frappe._comments), 1)

    def test_the_comment_is_still_written(self):
        """The pre-existing trail is untouched by the logging change."""
        self.mp_audit.log_mp_override(invoice_name=self.INVOICE, note="ya cobrado")

        self.assertEqual(len(self.frappe._comments), 1)
        comment = self.frappe._comments[0]
        self.assertEqual(comment["reference_name"], self.INVOICE)
        self.assertIn("MP-OVERRIDE", comment["content"])
        self.assertIn("ya cobrado", comment["content"])

    def test_an_unsupported_doctype_is_still_refused(self):
        with self.assertRaises(ThrownError):
            self.mp_audit.log_mp_override(invoice_name=self.INVOICE, doctype="Journal Entry")

        self.assertEqual(self._lines(), [])


if __name__ == "__main__":
    unittest.main()
