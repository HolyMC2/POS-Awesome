import importlib.util
import json
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.as_json = lambda value: json.dumps(value, default=str)
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.get_doc = lambda *args, **kwargs: None
    frappe_module.get_traceback = lambda *args, **kwargs: "traceback"
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.logger = lambda *args, **kwargs: types.SimpleNamespace(
        info=lambda *a, **k: None
    )
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = lambda v=0: int(v) if str(v).strip() not in ("", "None") else 0
    sys.modules["frappe.utils"] = frappe_utils

    search = types.ModuleType("posawesome.posawesome.api.item_processing.search")
    search.get_items = lambda *args, **kwargs: []
    sys.modules["posawesome.posawesome.api.item_processing.search"] = search


def _load_module():
    module_name = "test_cache_warmer_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "cache_warmer.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class _FakeDoc:
    def __init__(self, data):
        self._data = data

    def as_dict(self):
        return dict(self._data)


class TestCacheWarmer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def test_page_size_defaults_to_1000_when_limit_search_off(self):
        # posa_use_limit_search absent/0 -> 1000 (matches BACKGROUND_SYNC_PAGE_SIZE)
        self.assertEqual(self.module._page_size({}), 1000)
        self.assertEqual(
            self.module._page_size({"posa_use_limit_search": 0, "posa_search_limit": 500}),
            1000,
        )

    def test_page_size_uses_search_limit_when_limit_search_on(self):
        self.assertEqual(
            self.module._page_size({"posa_use_limit_search": 1, "posa_search_limit": 500}),
            500,
        )
        # limit-search on but no positive limit -> fall back to default
        self.assertEqual(
            self.module._page_size({"posa_use_limit_search": 1, "posa_search_limit": 0}),
            1000,
        )

    def test_warm_profile_paginates_by_item_name_cursor_until_short_page(self):
        calls = []

        def fake_get_items(profile_json, **kwargs):
            calls.append(kwargs)
            # two full pages of 1000, then a short page -> stop
            idx = len(calls)
            if idx == 1:
                return [{"item_name": f"A{i}"} for i in range(1000)]
            if idx == 2:
                return [{"item_name": f"B{i}"} for i in range(1000)]
            return [{"item_name": "C0"}]  # short page

        self.module.get_items = fake_get_items

        result = self.module._warm_profile(
            {"name": "Doco Ventas", "selling_price_list": "Standard Selling"}
        )

        self.assertEqual(result["pages"], 3)
        self.assertEqual(result["items"], 2001)
        # cache-on call args mirror the SPA background sync exactly
        self.assertEqual(calls[0]["limit"], 1000)
        self.assertEqual(calls[0]["item_group"], "")
        self.assertIsNone(calls[0]["start_after"])
        self.assertNotIn("customer", calls[0])  # defaults to None server-side
        # keyset cursor advances by the last row's item_name
        self.assertEqual(calls[1]["start_after"], "A999")
        self.assertEqual(calls[2]["start_after"], "B999")

    def test_warm_profile_stops_on_empty_first_page(self):
        self.module.get_items = lambda *a, **k: []
        result = self.module._warm_profile({"name": "Empty"})
        self.assertEqual(result["pages"], 1)
        self.assertEqual(result["items"], 0)

    def test_prewarm_isolates_per_profile_failures(self):
        self.module.frappe.get_all = lambda *a, **k: ["Good", "Bad"]

        def fake_get_doc(doctype, name):
            if name == "Bad":
                raise RuntimeError("boom")
            return _FakeDoc({"name": name, "selling_price_list": "Standard Selling"})

        self.module.frappe.get_doc = fake_get_doc
        self.module.get_items = lambda *a, **k: []  # one empty page each

        summary = self.module.prewarm_pos_item_cache()
        # Bad profile swallowed; Good profile still warmed
        self.assertEqual(len(summary), 1)
        self.assertEqual(summary[0]["profile"], "Good")


if __name__ == "__main__":
    unittest.main()
