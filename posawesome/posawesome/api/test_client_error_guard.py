"""Guards for the POS client-error funnel (LOGGING_MAP G8).

`log_client_error` used to insert one `tabError Log` row per browser error per
tab, with a 10 s client-side dedupe as the only bound
(frontend/src/posapp/utils/errorReporting.ts). These tests pin the three server
side bounds that replaced that: signature dedupe, a per-site insert budget and
a storm latch that writes exactly one summary row per window.

Standalone stub harness — fakes `frappe` in sys.modules, so it is skipped under
`bench run-tests` and run directly with python3 (scripts/run_backend_tests.py
gives every api test file its own interpreter).
"""

import importlib.util
import json
import logging
import os
import pathlib
import shutil
import sys
import tempfile
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
UTILITIES_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "utilities.py"


class FakeClock:
    """Deterministic `time.time()`; the guard's windows are all time based."""

    def __init__(self, start=1757000000.0):
        self.now = start

    def time(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeCache:
    """The parts of frappe.cache() the guard uses, plus a failure switch."""

    def __init__(self, clock):
        self.clock = clock
        self.store = {}
        self.raise_on_get = False
        self.raise_on_set = False

    def get_value(self, key, use_local_cache=True):
        if self.raise_on_get:
            raise RuntimeError("redis down")
        entry = self.store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at is not None and expires_at <= self.clock.time():
            self.store.pop(key, None)
            return None
        return value

    def set_value(self, key, val, expires_in_sec=None):
        if self.raise_on_set:
            raise RuntimeError("redis down")
        expires_at = None if expires_in_sec is None else self.clock.time() + expires_in_sec
        self.store[key] = (expires_at, val)


class FakeErrorLogRow:
    def __init__(self, name):
        self.name = name


class FakeLogger:
    def __init__(self):
        self.warnings = []

    def warning(self, message, *args):
        self.warnings.append(message % args if args else message)


def _install_stubs(clock):
    """Fake framework + package chain so utilities.py imports standalone."""
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *a, **k: (lambda fn: fn)
    frappe_module.session = types.SimpleNamespace(user="cajero@example.com")
    frappe_module.local = types.SimpleNamespace(
        site="doco-mirror.lab.xoloitzcuintles.com",
        lang="en",
        request_id="req-abc123",
    )
    frappe_module.get_all = lambda *a, **k: []
    frappe_module.get_installed_apps = lambda *a, **k: []
    frappe_module.get_traceback = lambda *a, **k: "Traceback (most recent call last): ..."
    frappe_module._ = lambda value, *a, **k: value
    frappe_module._dict = dict

    error_log_rows = []
    error_log_updates = []

    def _log_error(message=None, title=None, **_kwargs):
        row = FakeErrorLogRow(f"ERRLOG-{len(error_log_rows) + 1:04d}")
        error_log_rows.append({"name": row.name, "title": title, "message": message})
        return row

    frappe_module.log_error = _log_error
    frappe_module._error_log_rows = error_log_rows
    frappe_module._error_log_updates = error_log_updates

    def _set_value(doctype, name, updates, update_modified=True):
        error_log_updates.append(
            {"doctype": doctype, "name": name, "updates": dict(updates)}
        )
        for row in error_log_rows:
            if row["name"] == name:
                row.update(
                    {
                        "message": updates.get("error", row["message"]),
                        "title": updates.get("method", row["title"]),
                    }
                )

    frappe_module.db = types.SimpleNamespace(
        sql=lambda *a, **k: [],
        has_column=lambda doctype, column: column == "method",
        set_value=_set_value,
        table_exists=lambda *a, **k: False,
    )

    cache = FakeCache(clock)
    frappe_module.cache = lambda: cache
    frappe_module._fake_cache = cache

    logger = FakeLogger()
    frappe_module.logger = lambda *a, **k: logger
    frappe_module._fake_logger = logger

    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cstr = lambda v="": "" if v is None else str(v)
    frappe_utils.add_to_date = lambda *a, **k: None
    frappe_utils.get_datetime = lambda *a, **k: None
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    frappe_utils.flt = lambda v=0, *a, **k: float(v or 0)
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
class ClientErrorGuardCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clock = FakeClock()
        cls.frappe = _install_stubs(cls.clock)
        cls.utilities = _load_utilities()
        cls._real_time = cls.utilities.time

    def setUp(self):
        self.clock.now = 1757000000.0
        self.utilities.time = self.clock
        self.utilities._CLIENT_ERROR_LOCAL_STATE.clear()
        self.utilities._ERROR_LOG_TITLE_FIELD = None
        self.cache = self.frappe._fake_cache
        self.cache.store.clear()
        self.cache.raise_on_get = False
        self.cache.raise_on_set = False
        self.rows = self.frappe._error_log_rows
        self.rows.clear()
        self.updates = self.frappe._error_log_updates
        self.updates.clear()
        self.frappe._fake_logger.warnings.clear()
        self.frappe.local.site = "doco-mirror.lab.xoloitzcuintles.com"
        self.frappe.local.request_id = "req-abc123"

    def tearDown(self):
        self.utilities.time = self._real_time

    # -- helpers ---------------------------------------------------------
    def _payload(self, **overrides):
        payload = {
            "kind": "window_error",
            "message": "Cannot read properties of undefined (reading 'qty')",
            "stack": "at CartItemRow.vue:41",
            "filename": "/assets/posawesome/dist/js/web-entry-D0sMvJdf.js",
            "lineno": 1200,
            "colno": 18,
            "route": "/posapp",
            "userAgent": "Mozilla/5.0",
            "url": "https://ventas.example.com/posapp",
            "timestamp": "2026-09-12T18:00:00.000Z",
        }
        payload.update(overrides)
        return payload

    def _fire(self, **overrides):
        import json as _json

        return self.utilities.log_client_error(_json.dumps(self._payload(**overrides)))


class TestSignatureDedupe(ClientErrorGuardCase):
    def test_first_error_inserts_one_row_with_site_and_request_id(self):
        result = self._fire()

        self.assertTrue(result["ok"])
        self.assertTrue(result["logged"])
        self.assertEqual(len(self.rows), 1)
        self.assertEqual(self.rows[0]["title"], "POS Client Error [window_error]")
        self.assertIn('"site": "doco-mirror.lab.xoloitzcuintles.com"', self.rows[0]["message"])
        self.assertIn('"request_id": "req-abc123"', self.rows[0]["message"])
        self.assertIn('"rid": "req-abc123"', self.rows[0]["message"])

    def test_repeats_inside_the_window_never_insert_a_second_row(self):
        for _ in range(200):
            self.clock.advance(0.05)
            result = self._fire()

        self.assertEqual(len(self.rows), 1)
        self.assertEqual(result["dropped"], "duplicate")
        self.assertEqual(result["count"], 200)

    def test_repeat_rolls_the_count_into_the_existing_row(self):
        self._fire()
        # Under the rollup throttle the row is not rewritten per event…
        self._fire()
        self.assertEqual(self.updates, [])

        # …and once the throttle window passes, the row carries [xN].
        self.clock.advance(self.utilities.CLIENT_ERROR_ROLLUP_SEC + 1)
        self._fire()

        self.assertEqual(len(self.updates), 1)
        self.assertEqual(self.updates[0]["doctype"], "Error Log")
        self.assertEqual(self.updates[0]["name"], "ERRLOG-0001")
        self.assertEqual(self.updates[0]["updates"]["method"], "POS Client Error [window_error] [x3]")
        self.assertIn('"count": 3', self.rows[0]["message"])
        self.assertEqual(len(self.rows), 1)

    def test_ids_row_numbers_and_bundle_hashes_share_one_signature(self):
        self._fire(message="Cannot settle ACC-SINV-2026-03224 at row 412")
        self._fire(
            message="Cannot settle ACC-SINV-2026-09001 at row 7",
            filename="/assets/posawesome/dist/js/web-entry-A1b2C3d4.js",
        )

        self.assertEqual(len(self.rows), 1)

    def test_a_different_signature_still_gets_through(self):
        self._fire()
        result = self._fire(message="QZ Tray websocket refused the signed envelope")

        self.assertTrue(result["logged"])
        self.assertEqual(len(self.rows), 2)

    def test_window_closes_and_the_next_event_opens_a_fresh_row(self):
        self._fire()
        self.clock.advance(self.utilities.CLIENT_ERROR_DEDUPE_SEC + 1)
        result = self._fire()

        self.assertTrue(result["logged"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(len(self.rows), 2)

    def test_repeats_do_not_renew_their_own_window(self):
        self._fire()
        for _ in range(50):
            self.clock.advance(10)
            self._fire()
        # 500 s of repeats: still inside the original 600 s window, one row.
        self.assertEqual(len(self.rows), 1)
        self.clock.advance(120)
        self.assertTrue(self._fire()["logged"])
        self.assertEqual(len(self.rows), 2)

    def test_budget_is_per_site(self):
        self._fire()
        self.frappe.local.site = "mumu-mirror.lab.xoloitzcuintles.com"
        result = self._fire()

        self.assertTrue(result["logged"], "another tenant's identical error is not this tenant's repeat")
        self.assertEqual(len(self.rows), 2)
        self.assertIn("mumu-mirror.lab.xoloitzcuintles.com", self.rows[1]["message"])

    def test_guard_state_keys_carry_the_site(self):
        self._fire()

        self.assertTrue(self.cache.store, "the guard must keep its counters in frappe.cache()")
        for key in self.cache.store:
            self.assertIn("doco-mirror.lab.xoloitzcuintles.com", key)
            self.assertTrue(key.startswith("posa_client_error:"))


class TestInsertBudgetAndStormLatch(ClientErrorGuardCase):
    def _fire_distinct(self, index):
        return self._fire(message=f"distinct failure kind {chr(65 + index % 26)}{'!' * (index // 26)}")

    def test_per_site_cap_bounds_inserts_per_minute(self):
        limit = self.utilities.CLIENT_ERROR_RATE_LIMIT_PER_MIN
        results = [self._fire_distinct(i) for i in range(limit + 5)]

        logged = [r for r in results if r.get("logged")]
        self.assertEqual(len(logged), limit)
        # limit rows + exactly one storm row
        self.assertEqual(len(self.rows), limit + 1)
        self.assertEqual(results[limit]["dropped"], "storm")

    def test_storm_row_is_one_row_carrying_the_running_drop_count(self):
        limit = self.utilities.CLIENT_ERROR_RATE_LIMIT_PER_MIN
        for i in range(limit + 1):
            self._fire_distinct(i)

        storm_row = self.rows[-1]
        self.assertEqual(storm_row["title"], "POS Client Error Storm [dropped x1]")
        self.assertIn("client error storm: dropped 1 in the last hour", storm_row["message"])

        # 500 further distinct errors while latched: no new rows at all.
        for i in range(500):
            self.clock.advance(0.1)
            result = self._fire_distinct(100 + i)
            self.assertEqual(result["dropped"], "storm")
        self.assertEqual(len(self.rows), limit + 1)

        # and the single storm row has been rolled up in place
        self.assertIn("client error storm: dropped", self.rows[-1]["message"])
        self.assertIn("dropped x", self.rows[-1]["title"])
        storm_updates = [u for u in self.updates if u["name"] == storm_row["name"]]
        self.assertTrue(storm_updates)
        self.assertLessEqual(
            len(storm_updates), 3, "the storm row must not be rewritten once per event"
        )

    def test_latch_releases_after_its_window_and_does_not_renew_itself(self):
        limit = self.utilities.CLIENT_ERROR_RATE_LIMIT_PER_MIN
        for i in range(limit + 1):
            self._fire_distinct(i)
        rows_at_latch = len(self.rows)

        # sustained traffic across the whole latch window
        for _ in range(120):
            self.clock.advance(30)
            self._fire_distinct(999)
        self.assertGreater(len(self.rows), rows_at_latch)  # released, inserting again

        self.clock.advance(self.utilities.CLIENT_ERROR_STORM_LATCH_SEC + 1)
        self.assertTrue(self._fire_distinct(1234)["logged"])

    def test_deduped_repeats_do_not_spend_the_insert_budget(self):
        for _ in range(500):
            self.clock.advance(0.05)
            self._fire()

        self.assertEqual(len(self.rows), 1, "one signature, one row, latch never tripped")
        self.assertTrue(self._fire(message="a genuinely different failure")["logged"])


class TestPayloadCap(ClientErrorGuardCase):
    def test_oversized_body_is_dropped_before_json_parsing(self):
        oversized = "x" * (self.utilities.CLIENT_ERROR_MAX_BODY_BYTES + 1024)

        result = self.utilities.log_client_error(oversized)

        self.assertTrue(result["ok"])
        self.assertTrue(result["logged"])
        self.assertEqual(len(self.rows), 1)
        self.assertEqual(self.rows[0]["title"], "POS Client Error [oversized_payload]")
        self.assertIn("client error payload dropped", self.rows[0]["message"])
        self.assertLess(len(self.rows[0]["message"]), self.utilities.CLIENT_ERROR_MAX_BODY_BYTES)

    def test_stored_row_stays_under_the_cap(self):
        import json as _json

        # under the raw body cap, but every field far over what a row should hold
        payload = self._payload(stack="s" * 20000, message="m" * 20000, info="i" * 10000)
        body = _json.dumps(payload)
        self.assertLess(len(body), self.utilities.CLIENT_ERROR_MAX_BODY_BYTES)

        self.utilities.log_client_error(body)

        self.assertEqual(len(self.rows), 1)
        message = self.rows[0]["message"]
        self.assertLessEqual(len(message), self.utilities.CLIENT_ERROR_MAX_BODY_BYTES)
        # _sanitize_client_error_payload's per-field clips do the real bounding
        self.assertIn("...", message)

    def test_assembled_message_over_the_cap_loses_the_stack_not_the_row(self):
        capped = self.utilities._dumps_capped(
            {
                "scope": "pos_client_error",
                "payload": {"message": "boom", "stack": "S" * (self.utilities.CLIENT_ERROR_MAX_BODY_BYTES * 2)},
            }
        )

        self.assertLessEqual(len(capped), self.utilities.CLIENT_ERROR_MAX_BODY_BYTES)
        self.assertIn("stack_clipped", capped)
        self.assertIn('"message": "boom"', capped)

    def test_unparseable_body_still_produces_one_bounded_row(self):
        result = self.utilities.log_client_error("<html>504 Gateway Time-out</html>")

        self.assertTrue(result["ok"])
        self.assertEqual(len(self.rows), 1)
        self.assertIn("504 Gateway Time-out", self.rows[0]["message"])


class TestGuardNeverRaises(ClientErrorGuardCase):
    def test_internal_failure_returns_not_ok_and_latches_its_own_row(self):
        original = self.utilities._sanitize_client_error_payload
        self.utilities._sanitize_client_error_payload = lambda payload: (_ for _ in ()).throw(
            RuntimeError("sanitizer exploded")
        )
        try:
            first = self._fire()
            second = self._fire()
            third = self._fire()
        finally:
            self.utilities._sanitize_client_error_payload = original

        for result in (first, second, third):
            self.assertEqual(result, {"ok": False})
        # the pre-guard code wrote a second unbounded row per failure; now the
        # guard's own failures are latched to one row per site per hour
        self.assertEqual(len(self.rows), 1)
        self.assertEqual(self.rows[0]["title"], "POS Client Error Logging Failure")
        self.assertIn("RuntimeError", self.rows[0]["message"])
        self.assertEqual(len(self.frappe._fake_logger.warnings), 3)

    def test_guard_failure_row_reopens_after_the_latch_window(self):
        original = self.utilities._sanitize_client_error_payload
        self.utilities._sanitize_client_error_payload = lambda payload: (_ for _ in ()).throw(
            RuntimeError("sanitizer exploded")
        )
        try:
            self._fire()
            self.clock.advance(self.utilities.CLIENT_ERROR_GUARD_FAIL_LATCH_SEC + 1)
            self._fire()
        finally:
            self.utilities._sanitize_client_error_payload = original

        self.assertEqual(len(self.rows), 2)

    def test_a_failing_error_log_insert_does_not_reach_the_browser(self):
        def _boom(**_kwargs):
            raise RuntimeError("Error Log table is gone")

        original = self.frappe.log_error
        self.frappe.log_error = _boom
        try:
            result = self._fire()
        finally:
            self.frappe.log_error = original

        self.assertEqual(result, {"ok": False})
        self.assertTrue(
            any("client_error_guard.failure" in line for line in self.frappe._fake_logger.warnings)
        )

    def test_redis_outage_falls_back_to_a_process_local_bound(self):
        self.cache.raise_on_get = True
        self.cache.raise_on_set = True

        for _ in range(100):
            self.clock.advance(0.05)
            self._fire()

        self.assertEqual(len(self.rows), 1, "the local fallback must still dedupe")
        self.assertTrue(
            any("client_error_guard.cache" in line for line in self.frappe._fake_logger.warnings)
        )

    def test_rollup_update_failure_is_logged_and_not_raised(self):
        def _boom(*_args, **_kwargs):
            raise RuntimeError("row vanished")

        self._fire()
        self.clock.advance(self.utilities.CLIENT_ERROR_ROLLUP_SEC + 1)
        original = self.frappe.db.set_value
        self.frappe.db.set_value = _boom
        try:
            result = self._fire()
        finally:
            self.frappe.db.set_value = original

        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 2)
        self.assertTrue(
            any("client_error_guard.row_refresh" in line for line in self.frappe._fake_logger.warnings)
        )


class TestSwallowerWarnings(ClientErrorGuardCase):
    """The G9 half: the paths that used to `except: pass` now name themselves."""

    def test_usage_cache_failure_is_reported_and_the_value_still_computed(self):
        self.cache.raise_on_get = True
        self.cache.raise_on_set = True

        value = self.utilities._get_cached_usage("posa_test_key", lambda: {"db_size": 7}, 60)

        self.assertEqual(value, {"db_size": 7})
        warnings = self.frappe._fake_logger.warnings
        self.assertTrue(any("usage_cache.read" in line for line in warnings))
        self.assertTrue(any("usage_cache.write" in line for line in warnings))
        self.assertTrue(any("RuntimeError" in line for line in warnings))

    def test_session_language_failures_are_reported_not_swallowed(self):
        class Hostile:
            def __setitem__(self, key, value):
                raise TypeError("read-only session")

        original_session = self.frappe.session
        self.frappe.local.session = Hostile()
        self.frappe.session = types.SimpleNamespace(data=None)
        try:
            self.utilities._set_active_session_language("es")
        finally:
            self.frappe.session = original_session
            self.frappe.local.session = None

        warnings = self.frappe._fake_logger.warnings
        self.assertTrue(any("set_language.session" in line for line in warnings))
        self.assertTrue(any('"site": "doco-mirror.lab.xoloitzcuintles.com"' in line for line in warnings))

    def test_warning_lines_are_json_with_scope_site_and_error_class(self):
        import json as _json

        self.utilities._posa_warn("test.scope", "something missed", ValueError("bad"), extra="ctx")

        line = self.frappe._fake_logger.warnings[-1]
        entry = _json.loads(line)
        self.assertEqual(entry["app"], "posawesome")
        self.assertEqual(entry["scope"], "test.scope")
        self.assertEqual(entry["site"], "doco-mirror.lab.xoloitzcuintles.com")
        self.assertEqual(entry["rid"], "req-abc123")
        self.assertEqual(entry["err"], "ValueError")
        self.assertEqual(entry["extra"], "ctx")


class TestBreadcrumbsReachTheLogFile(ClientErrorGuardCase):
    """The breadcrumbs must actually be written, not just formatted.

    Frappe hands out module loggers at level ERROR off a dev server
    (`frappe/utils/logger.py`: `default_log_level = logging.WARNING if
    frappe._dev_server else logging.ERROR`), and `DEV_SERVER` is unset on the
    lab AND on cell-0 with no `log_level` in common_site_config.json. Measured
    on the lab backend 2026-09-12: a `.warning()` on a freshly resolved
    `posawesome` logger wrote 0 bytes to both `logs/posawesome.log` and
    `sites/<site>/logs/posawesome.log`; the same line wrote 75 bytes once the
    level was raised. These tests use a REAL `logging.Logger` handed out at
    ERROR, exactly as Frappe would, and assert the line lands on disk.
    """

    def setUp(self):
        super().setUp()
        self.tmpdir = tempfile.mkdtemp(prefix="posa-logfile-")
        self.loggers = {}
        self.paths = {}
        self.factory_calls = []
        self._saved_factory = self.frappe.logger

        def _factory(name, *_args, **_kwargs):
            site = self.frappe.local.site
            key = f"{name}-{site}"
            self.factory_calls.append(key)
            logger = self.loggers.get(key)
            if logger is None:
                path = os.path.join(self.tmpdir, f"{key}.log")
                logger = logging.getLogger(f"posa-test-{len(self.loggers)}-{key}")
                logger.handlers = []
                logger.propagate = False
                handler = logging.FileHandler(path)
                handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
                logger.addHandler(handler)
                logger.setLevel(logging.ERROR)  # what Frappe hands us on the lab and cell-0
                self.loggers[key] = logger
                self.paths[key] = path
            return logger

        self.frappe.logger = _factory

    def tearDown(self):
        self.frappe.logger = self._saved_factory
        for logger in self.loggers.values():
            for handler in list(logger.handlers):
                handler.close()
                logger.removeHandler(handler)
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        super().tearDown()

    def _lines(self, key):
        with open(self.paths[key], encoding="utf-8") as handle:
            return [line for line in handle.read().splitlines() if line.strip()]

    def test_warning_reaches_the_site_log_file_despite_the_error_default(self):
        self.utilities._posa_warn("test.write", "breadcrumb must land", ValueError("bad"))

        key = "posawesome-doco-mirror.lab.xoloitzcuintles.com"
        lines = self._lines(key)
        self.assertEqual(len(lines), 1, "a WARNING at the ERROR default writes nothing")
        self.assertTrue(lines[0].startswith("WARNING "))
        entry = json.loads(lines[0][len("WARNING ") :])
        self.assertEqual(entry["scope"], "test.write")
        self.assertEqual(entry["site"], "doco-mirror.lab.xoloitzcuintles.com")
        self.assertEqual(entry["err"], "ValueError")
        self.assertEqual(self.loggers[key].level, logging.INFO)

    def test_guard_swallower_breadcrumbs_reach_the_file(self):
        self.cache.raise_on_get = True
        self.cache.raise_on_set = True

        self.utilities._get_cached_usage("posa_test_key", lambda: {"db_size": 1}, 60)

        lines = self._lines("posawesome-doco-mirror.lab.xoloitzcuintles.com")
        scopes = [json.loads(line[len("WARNING ") :])["scope"] for line in lines]
        self.assertIn("usage_cache.read", scopes)
        self.assertIn("usage_cache.write", scopes)

    def test_logger_is_resolved_per_call_so_one_tenant_cannot_capture_the_file(self):
        self.utilities._posa_warn("test.tenant", "first tenant")
        self.frappe.local.site = "mumu-mirror.lab.xoloitzcuintles.com"
        self.utilities._posa_warn("test.tenant", "second tenant")

        doco = "posawesome-doco-mirror.lab.xoloitzcuintles.com"
        mumu = "posawesome-mumu-mirror.lab.xoloitzcuintles.com"
        self.assertEqual(self.factory_calls, [doco, mumu])
        self.assertEqual(len(self._lines(doco)), 1)
        self.assertEqual(len(self._lines(mumu)), 1)
        self.assertEqual(
            json.loads(self._lines(mumu)[0][len("WARNING ") :])["site"],
            "mumu-mirror.lab.xoloitzcuintles.com",
        )

    def test_an_already_permissive_logger_is_left_alone(self):
        self.utilities._posa_warn("test.level", "first")
        key = "posawesome-doco-mirror.lab.xoloitzcuintles.com"
        self.loggers[key].setLevel(logging.DEBUG)

        self.utilities._posa_warn("test.level", "second")

        self.assertEqual(self.loggers[key].level, logging.DEBUG)
        self.assertEqual(len(self._lines(key)), 2)

    def test_a_logger_frappe_refuses_to_hand_out_is_not_fatal(self):
        def _boom(*_args, **_kwargs):
            raise RuntimeError("no site context")

        self.frappe.logger = _boom
        self.utilities._posa_warn("test.nologger", "nothing to write with")
        self.assertIsNone(self.utilities._posa_site_logger())


if __name__ == "__main__":
    unittest.main()
