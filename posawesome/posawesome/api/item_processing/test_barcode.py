import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    original_modules = {
        "frappe": sys.modules.get("frappe"),
        "frappe.utils": sys.modules.get("frappe.utils"),
        "posawesome.posawesome.api.entry_attribute": sys.modules.get(
            "posawesome.posawesome.api.entry_attribute"
        ),
    }
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.DoesNotExistError = Exception
    frappe_module.log_error = lambda *args, **kwargs: None
    frappe_module.get_cached_doc = lambda *args, **kwargs: None
    frappe_module.get_all = lambda *args, **kwargs: []
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = int
    frappe_utils.cstr = str
    frappe_utils.flt = float
    sys.modules["frappe.utils"] = frappe_utils

    # Which phone a scanned item is for. Another module's business (it has its
    # own suite, `api/test_entry_attribute`), stubbed here as a dial: `ENTRY`
    # holds what it answers, so a test can say "this shop runs a storefront"
    # without building a Storefront Profile out of `frappe.db` fakes.
    entry_attribute_module = types.ModuleType("posawesome.posawesome.api.entry_attribute")
    entry_attribute_module.ENTRY_ATTRIBUTE_VALUE_FIELD = "entry_attribute_value"
    entry_attribute_module.entry_attribute_value_map = lambda codes, company=None: (
        ENTRY.get("attribute"),
        {code: ENTRY["values"][code] for code in codes if code in ENTRY["values"]},
    )
    sys.modules["posawesome.posawesome.api.entry_attribute"] = entry_attribute_module
    return original_modules


#: What the entry-attribute stub answers. Reset per test by `setUp`; the
#: default is a tenant with no storefront, which is most of them.
ENTRY = {"attribute": None, "values": {}}


def _restore_modules(original_modules):
    for module_name, original in original_modules.items():
        if original is None:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original


def _load_module():
    module_name = "test_barcode_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_processing" / "barcode.py"
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
class TestBarcodeProcessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_modules = _install_stubs()
        cls.module = _load_module()

    @classmethod
    def tearDownClass(cls):
        _restore_modules(cls.original_modules)

    def setUp(self):
        ENTRY["attribute"] = None
        ENTRY["values"] = {}

    def test_get_items_from_barcode_uses_standard_uom_even_when_posa_uom_exists(self):
        calls = []

        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                calls.append((doctype, filters, fields, as_dict))
                if doctype == "Item Barcode":
                    return AttrDict(
                        {
                            "item_code": "ITEM-001",
                            "uom": "Box",
                            "posa_uom": "Nos",
                        }
                    )
                if doctype == "Item Price":
                    return 120
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Item 001", "stock_uom": "Nos"}
        )
        self.module._parse_scale_barcode_data = lambda barcode: None

        result = self.module.get_items_from_barcode(
            "Standard Selling",
            "USD",
            "BOX-001",
        )

        self.assertEqual(result["uom"], "Box")
        self.assertIn("uom", calls[0][2])

    def test_get_items_from_barcode_carries_fraction_eligibility(self):
        """A scanned line must arrive knowing whether it may hold a decimal.

        Without it the cart would offer the weighing pad on a browsed row and
        withhold it on the scanned row for the very same item.
        """

        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                if doctype == "Item Barcode":
                    return AttrDict({"item_code": "ITEM-KG", "uom": "Kg"})
                if doctype == "Item Price":
                    return 160
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Jamon", "stock_uom": "Kg"}
        )
        self.module.frappe.get_cached_value = lambda doctype, name, field: (
            1 if name == "Nos" else 0
        )
        self.module._parse_scale_barcode_data = lambda barcode: None

        result = self.module.get_items_from_barcode("Standard Selling", "MXN", "KG-001")

        self.assertEqual(result["must_be_whole_number"], 0)

    def test_a_scanned_line_carries_the_device_it_is_for(self):
        """The up-sell strip must not depend on HOW the line reached the cart.

        A case added from the grid and the same case scanned at the counter
        have to arrive knowing the same phone, or the compatible combo would be
        offered on one and withheld on the other for one item.
        """

        ENTRY["attribute"] = "Modelos Celulares"
        ENTRY["values"] = {"IPN000130": "Samsung A01"}

        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                if doctype == "Item Barcode":
                    return AttrDict({"item_code": "IPN000130", "uom": "Nos"})
                if doctype == "Item Price":
                    return 180
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Case Colors Samsung A01 Rojo", "stock_uom": "Nos"}
        )
        self.module.frappe.get_cached_value = lambda doctype, name, field: 0
        self.module._parse_scale_barcode_data = lambda barcode: None

        result = self.module.get_items_from_barcode("Standard Selling", "MXN", "750001")

        self.assertEqual(result["entry_attribute_value"], "Samsung A01")

    def test_an_unconfigured_shop_scans_a_line_with_no_device(self):
        # `None`, not absent and not a blank string: the client reads "we do
        # not know" as no match, and a blank would sit in the cart as a fact.
        class Db:
            def get_value(self, doctype, filters, fields=None, as_dict=False):
                if doctype == "Item Barcode":
                    return AttrDict({"item_code": "ITEM-001", "uom": "Nos"})
                return None

        self.module.frappe.db = Db()
        self.module.frappe.get_cached_doc = lambda doctype, name: AttrDict(
            {"name": name, "item_name": "Item 001", "stock_uom": "Nos"}
        )
        self.module.frappe.get_cached_value = lambda doctype, name, field: 0
        self.module._parse_scale_barcode_data = lambda barcode: None

        result = self.module.get_items_from_barcode("Standard Selling", "MXN", "BC-001")

        self.assertIn("entry_attribute_value", result)
        self.assertIsNone(result["entry_attribute_value"])

    def test_fraction_eligibility_falls_back_to_zero_when_unknown(self):
        # A lookup that throws must hide the affordance, never promise one the
        # server would refuse at save.
        def boom(*args, **kwargs):
            raise RuntimeError("no UOM table here")

        self.module.frappe.get_cached_value = boom

        self.assertEqual(self.module._uom_must_be_whole_number("Kg"), 0)
        self.assertEqual(self.module._uom_must_be_whole_number(None), 0)
        self.assertEqual(self.module._uom_must_be_whole_number(""), 0)


if __name__ == "__main__":
    unittest.main()
