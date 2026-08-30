import importlib.util
import json
import pathlib
import sys
import types
import unittest
from datetime import datetime

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda value: value
    frappe_module.as_json = lambda value: json.dumps(value, default=str)
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    # search.py (rate-band preview, e9993c613) asks `frappe.db.has_column`
    # before it merges `posa_px_skip_rate_band` into each row. The stub
    # answers False — the code's own "site mid-rollout ships no flag" branch —
    # so this file keeps testing serialization and thumbnail wiring, not the
    # band. Backend CI had been red on every push since that commit: the
    # harness lacked `db` altogether (AttributeError, 3 errors / 670).
    frappe_module.db = types.SimpleNamespace(has_column=lambda *args, **kwargs: False)
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = int
    frappe_utils.cstr = str
    frappe_utils.get_datetime = lambda value: value
    sys.modules["frappe.utils"] = frappe_utils

    frappe_cache = types.ModuleType("frappe.utils.caching")
    frappe_cache.redis_cache = lambda ttl=None: (lambda fn: fn)
    sys.modules["frappe.utils.caching"] = frappe_cache

    fetchers = types.ModuleType("posawesome.posawesome.api.item_fetchers")
    fetchers.ItemDetailAggregator = object
    fetchers._session_may_see_item_cost = lambda *args, **kwargs: True
    sys.modules["posawesome.posawesome.api.item_fetchers"] = fetchers

    utils = types.ModuleType("posawesome.posawesome.api.utils")
    utils.HAS_VARIANTS_EXCLUSION = []
    utils.expand_item_groups = lambda *args, **kwargs: []
    utils.get_active_pos_profile = lambda *args, **kwargs: {}
    utils.get_item_groups = lambda *args, **kwargs: []
    utils._ensure_pos_profile = lambda value: value
    utils.log_perf_event = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api.utils"] = utils

    barcode = types.ModuleType("posawesome.posawesome.api.item_processing.barcode")
    barcode.search_serial_or_batch_or_barcode_number = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api.item_processing.barcode"] = barcode

    details = types.ModuleType("posawesome.posawesome.api.item_processing.details")
    details.get_items_details = lambda *args, **kwargs: []
    sys.modules["posawesome.posawesome.api.item_processing.details"] = details

    thumbnails = types.ModuleType("posawesome.posawesome.api.item_processing.thumbnails")
    thumbnails.attach_item_thumbnails = lambda rows: rows
    sys.modules["posawesome.posawesome.api.item_processing.thumbnails"] = thumbnails


def _load_module():
    module_name = "test_item_search_serialization_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "search.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestItemSearchSerialization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def test_run_item_query_serializes_datetime_rows_for_details(self):
        serialized_payloads = []

        def fake_get_all(*args, **kwargs):
            if fake_get_all.calls == 0:
                fake_get_all.calls += 1
                return [
                    {
                        "item_code": "ITEM-001",
                        "item_name": "Item 001",
                        "modified": datetime(2026, 4, 23, 10, 30, 0),
                    }
                ]
            return []

        fake_get_all.calls = 0

        def fake_get_items_details(pos_profile_json, items_json, **kwargs):
            serialized_payloads.append(items_json)
            return [{"item_code": "ITEM-001"}]

        self.module.frappe.get_all = fake_get_all
        self.module.get_items_details = fake_get_items_details
        self.module._build_attribute_maps = lambda *args, **kwargs: ({}, {})
        self.module._shape_item_row = lambda item, detail, plan, **kwargs: item
        self.module._matches_search_words = lambda *args, **kwargs: True

        plan = self.module.SearchPlan(
            filters={},
            or_filters=[],
            fields=["item_code", "item_name", "modified"],
            limit_page_length=1,
            limit_start=0,
            order_by="item_name asc",
            page_size=1,
            fetch_page_size=1,
            initial_page_start=0,
            item_code_for_search=None,
            search_words=[],
            normalized_search_value="",
            word_filter_active=False,
            include_description=False,
            include_image=False,
            posa_display_items_in_stock=False,
            posa_show_template_items=False,
        )

        result = self.module._run_item_query({}, None, None, plan)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["item_code"], "ITEM-001")
        self.assertEqual(len(serialized_payloads), 1)
        self.assertIn("2026-04-23 10:30:00", serialized_payloads[0])


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestItemSearchThumbnailWiring(unittest.TestCase):
    """The thumbnail lookup must see the page the caller actually gets back —
    after the limit cap, so trimmed rows never cost a File lookup."""

    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def _run(self, plan, rows):
        seen = []

        def fake_get_all(*args, **kwargs):
            if fake_get_all.calls == 0:
                fake_get_all.calls += 1
                return rows
            return []

        fake_get_all.calls = 0

        def spy(batch):
            seen.append(list(batch))
            return batch

        self.module.frappe.get_all = fake_get_all
        self.module.get_items_details = lambda *args, **kwargs: []
        self.module._build_attribute_maps = lambda *args, **kwargs: ({}, {})
        self.module._shape_item_row = lambda item, detail, plan, **kwargs: item
        self.module._matches_search_words = lambda *args, **kwargs: True
        self.module.attach_item_thumbnails = spy

        result = self.module._run_item_query({}, None, None, plan)
        return result, seen

    def _plan(self, **overrides):
        args = dict(
            filters={},
            or_filters=[],
            fields=["item_code", "image"],
            limit_page_length=1,
            limit_start=0,
            order_by="item_name asc",
            page_size=1,
            fetch_page_size=2,
            initial_page_start=0,
            item_code_for_search=None,
            search_words=[],
            normalized_search_value="",
            word_filter_active=False,
            include_description=False,
            include_image=True,
            posa_display_items_in_stock=False,
            posa_show_template_items=False,
        )
        args.update(overrides)
        return self.module.SearchPlan(**args)

    def test_receives_the_capped_page_only(self):
        rows = [
            {"item_code": "ITEM-001", "image": "/files/a.jpg"},
            {"item_code": "ITEM-002", "image": "/files/b.jpg"},
        ]

        result, seen = self._run(self._plan(), rows)

        self.assertEqual(len(seen), 1)
        self.assertEqual([row["item_code"] for row in seen[0]], ["ITEM-001"])
        self.assertEqual([row["item_code"] for row in result], ["ITEM-001"])

    def test_lean_rows_reach_the_attacher_without_an_image_field(self):
        rows = [{"item_code": "ITEM-001"}]

        _result, seen = self._run(
            self._plan(include_image=False, fields=["item_code"], limit_page_length=None),
            rows,
        )

        self.assertEqual(seen, [[{"item_code": "ITEM-001"}]])


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestGetItemsCacheKeyParity(unittest.TestCase):
    """The prewarm job (in-process ints) and the SPA (form-POST strings) must
    hash to the same cache key or the warmer warms a key nobody reads."""

    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def _key(self, limit, offset):
        return self.module._build_get_items_cache_key(
            "Doco Ventas",
            "Store - D",
            "Standard Selling",
            None,
            "",
            limit,
            offset,
            None,
            None,
            "",
            False,
            False,
            tuple(),
        )

    def test_string_and_int_limit_offset_share_one_key(self):
        self.assertEqual(self._key("1000", "0"), self._key(1000, 0))

    def test_none_and_absent_offset_share_one_key(self):
        # warmer omits offset (None); SPA may send "" — both normalize to None
        self.assertEqual(self._key(1000, None), self._key("1000", ""))

    def test_different_limits_still_get_distinct_keys(self):
        self.assertNotEqual(self._key(500, 0), self._key(1000, 0))


if __name__ == "__main__":
    unittest.main()
