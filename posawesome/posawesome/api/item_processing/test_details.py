import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get
    __setattr__ = dict.__setitem__


def _install_framework_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.nowdate = lambda: "2026-03-21"
    frappe_utils.cint = lambda value: int(value or 0)

    class _FrappeDict(AttrDict):
        pass

    frappe_module._dict = _FrappeDict
    frappe_module._ = lambda text: text
    frappe_module.as_json = json.dumps
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.db = types.SimpleNamespace(
        get_value=lambda *args, **kwargs: None,
    )

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils
    return frappe_module


def _install_dependency_stubs():
    item_fetchers_module = types.ModuleType("posawesome.posawesome.api.item_fetchers")
    item_fetchers_module.ItemDetailAggregator = object
    item_fetchers_module.get_batches = lambda *args, **kwargs: []
    # Venta fraccionada's eligibility fact. Empty here, which is the answer for
    # a site where no UOM is whole-number — every UOM then reports 0.
    item_fetchers_module.get_whole_number_uoms = lambda *args, **kwargs: frozenset()
    # No sub-unit pairings resolved: every UOM reports `None`, which is what a
    # site whose UOM Conversion Factor rows are missing looks like.
    item_fetchers_module.get_sub_unit_factors = lambda *args, **kwargs: {}
    sys.modules["posawesome.posawesome.api.item_fetchers"] = item_fetchers_module

    stock_module = types.ModuleType("posawesome.posawesome.api.item_processing.stock")
    stock_module.get_stock_availability = lambda *args, **kwargs: 0
    sys.modules["posawesome.posawesome.api.item_processing.stock"] = stock_module

    utils_module = types.ModuleType("posawesome.posawesome.api.utils")
    utils_module._ensure_pos_profile = lambda pos_profile: (pos_profile, pos_profile)
    utils_module.log_perf_event = lambda *args, **kwargs: None
    sys.modules["posawesome.posawesome.api.utils"] = utils_module

    erpnext_stock_module = types.ModuleType("erpnext.stock.get_item_details")
    erpnext_stock_module.get_item_details = lambda *args, **kwargs: {}
    sys.modules["erpnext.stock.get_item_details"] = erpnext_stock_module


def _install_package_stubs():
    package_paths = {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
        "posawesome.posawesome.api.item_processing": (
            REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing"
        ),
    }
    for name, path in package_paths.items():
        module = types.ModuleType(name)
        module.__path__ = [str(path)]
        sys.modules[name] = module


def _load_module():
    module_name = "posawesome.posawesome.api.item_processing.details"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "details.py"
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
class TestGetItemDetailNormalization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frappe = _install_framework_stubs()
        _install_dependency_stubs()
        _install_package_stubs()
        cls.details = _load_module()

    def test_normalizes_dict_item_and_json_doc_before_attribute_access(self):
        captured = {}

        def fake_get_item_details(item, doc, overwrite_warehouse=False):
            captured["item"] = item
            captured["doc"] = doc
            return {}

        with (
            patch.object(self.details, "get_stock_availability", return_value=0),
            patch.object(self.details, "get_batches", return_value=[]),
            patch.object(self.details.frappe, "get_all", return_value=[]),
            patch.object(
                self.details.frappe.db,
                "get_value",
                side_effect=lambda doctype, name, field, as_dict=False: (
                    {"max_discount": 0, "allow_negative_stock": 0, "stock_uom": "Nos"}
                    if doctype == "Item" and as_dict
                    else "USD"
                ),
            ),
            patch.dict(
                sys.modules,
                {
                    "erpnext.stock.get_item_details": types.SimpleNamespace(
                        get_item_details=fake_get_item_details
                    )
                },
            ),
        ):
            result = self.details.get_item_detail(
                {"item_code": "ITEM-001", "is_stock_item": 0},
                doc=json.dumps({"customer": "Test Customer"}),
                price_list="Standard Selling",
                company="Test Company",
            )

        # `must_be_whole_number` rides every UOM row (venta fraccionada): the
        # cart asks per LINE whether it may carry a decimal, so the answer has
        # to travel with each option rather than with the item.
        self.assertEqual(
            result["item_uoms"],
            [
                {
                    "uom": "Nos",
                    "conversion_factor": 1.0,
                    "must_be_whole_number": 0,
                    "sub_unit": None,
                }
            ],
        )
        self.assertEqual(result["must_be_whole_number"], 0)
        self.assertIsInstance(captured["item"], self.frappe._dict)
        self.assertIsInstance(captured["doc"], self.frappe._dict)
        self.assertEqual(captured["item"]["item_code"], "ITEM-001")
        self.assertEqual(captured["doc"].price_list_currency, "USD")
        self.assertEqual(captured["doc"].conversion_rate, 1)

    def test_accepts_existing_frappe_dict_without_redecoding(self):
        captured = {}
        item = self.frappe._dict({"item_code": "ITEM-002", "is_stock_item": 0})

        def fake_get_item_details(item_arg, doc_arg, overwrite_warehouse=False):
            captured["item"] = item_arg
            captured["doc"] = doc_arg
            return {}

        with (
            patch.object(self.details, "get_stock_availability", return_value=0),
            patch.object(self.details, "get_batches", return_value=[]),
            patch.object(self.details.frappe, "get_all", return_value=[]),
            patch.object(
                self.details.frappe.db,
                "get_value",
                side_effect=lambda doctype, name, field, as_dict=False: (
                    {"max_discount": 0, "allow_negative_stock": 0, "stock_uom": "Nos"}
                    if doctype == "Item" and as_dict
                    else "USD"
                ),
            ),
            patch.dict(
                sys.modules,
                {
                    "erpnext.stock.get_item_details": types.SimpleNamespace(
                        get_item_details=fake_get_item_details
                    )
                },
            ),
        ):
            self.details.get_item_detail(
                item,
                doc=self.frappe._dict({"customer": "Test Customer"}),
                company="Test Company",
            )

        self.assertIs(captured["item"], item)
        self.assertIsInstance(captured["doc"], self.frappe._dict)

    def test_payload_always_carries_is_stock_item_from_db(self):
        """erpnext get_item_details omits is_stock_item; the SPA overwrites
        its cart row with this payload, so a missing key clobbered the flag
        to undefined and non-stock rows inherited the stock qty clamp
        (removed from cart on any edit). The payload must echo DB truth."""

        def run(db_is_stock_item, client_flag):
            with (
                patch.object(self.details, "get_stock_availability", return_value=7),
                patch.object(self.details, "get_batches", return_value=[]),
                patch.object(self.details.frappe, "get_all", return_value=[]),
                patch.object(
                    self.details.frappe.db,
                    "get_value",
                    side_effect=lambda doctype, name, field, as_dict=False: (
                        {
                            "max_discount": 0,
                            "allow_negative_stock": 0,
                            "stock_uom": "Nos",
                            "is_stock_item": db_is_stock_item,
                        }
                        if doctype == "Item" and as_dict
                        else "USD"
                    ),
                ),
                patch.dict(
                    sys.modules,
                    {
                        "erpnext.stock.get_item_details": types.SimpleNamespace(
                            get_item_details=lambda *a, **k: {}
                        )
                    },
                ),
            ):
                item = {"item_code": "ITEM-003"}
                if client_flag is not None:
                    item["is_stock_item"] = client_flag
                return self.details.get_item_detail(
                    item,
                    doc=self.frappe._dict({"customer": "Test Customer"}),
                    warehouse="WH-001",
                    company="Test Company",
                )

        # Non-stock in DB: flag present as 0, no actual_qty computed —
        # even when the client omits the flag entirely.
        res = run(db_is_stock_item=0, client_flag=None)
        self.assertEqual(res["is_stock_item"], 0)
        self.assertNotIn("actual_qty", res)

        # Stock item in DB: flag 1 + actual_qty computed, even when a stale
        # client claims non-stock (DB wins over the client-supplied flag).
        res = run(db_is_stock_item=1, client_flag=0)
        self.assertEqual(res["is_stock_item"], 1)
        self.assertEqual(res["actual_qty"], 7)


if __name__ == "__main__":
    unittest.main()
