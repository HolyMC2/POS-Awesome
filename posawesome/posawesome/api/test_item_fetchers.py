import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module._dict = lambda value=None: AttrDict(value or {})
    frappe_module.get_all = lambda *args, **kwargs: []
    frappe_module.get_cached_value = lambda *args, **kwargs: None
    frappe_module.get_value = lambda *args, **kwargs: None
    frappe_module.log_error = lambda *args, **kwargs: None
    # _cached_fetch wraps get_value/set_value in try/except — a no-op cache
    # simply re-runs the fetcher every call.
    frappe_module.cache = lambda: types.SimpleNamespace(
        get_value=lambda key: None,
        set_value=lambda *args, **kwargs: None,
        delete_keys=lambda prefix: None,
        delete_value=lambda key: None,
    )

    class _Db:
        def has_column(self, doctype, fieldname):
            if doctype == "Item" and fieldname in {"valuation_rate", "default_bom"}:
                return True
            if doctype == "BOM" and fieldname in {
                "base_total_cost",
                "total_cost",
                "raw_material_cost",
                "operating_cost",
                "quantity",
            }:
                return True
            return False

        def get_value(self, doctype, name, fieldname=None):
            if doctype == "Company" and fieldname == "default_currency":
                return "PKR"
            return None

    frappe_module.db = _Db()
    frappe_qb = types.SimpleNamespace(from_=lambda *args, **kwargs: None)
    frappe_module.qb = frappe_qb
    sys.modules["frappe"] = frappe_module

    frappe_qb_module = types.ModuleType("frappe.query_builder")
    frappe_qb_module.DocType = lambda name: name
    sys.modules["frappe.query_builder"] = frappe_qb_module

    frappe_qb_functions = types.ModuleType("frappe.query_builder.functions")
    frappe_qb_functions.Sum = lambda field: field
    sys.modules["frappe.query_builder.functions"] = frappe_qb_functions

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.cint = int
    frappe_utils.flt = float
    frappe_utils.nowdate = lambda: "2026-04-17"
    sys.modules["frappe.utils"] = frappe_utils

    frappe_cache = types.ModuleType("frappe.utils.caching")
    frappe_cache.redis_cache = lambda ttl=None: (lambda fn: fn)
    sys.modules["frappe.utils.caching"] = frappe_cache

    erpnext_utils = types.ModuleType("erpnext.setup.utils")
    erpnext_utils.get_exchange_rate = lambda *args, **kwargs: 1
    sys.modules["erpnext.setup.utils"] = erpnext_utils


def _load_module():
    module_name = "test_item_fetchers_target"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "item_fetchers.py"
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
class TestItemFetchers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def test_get_bom_costs_prefers_item_default_bom(self):
        meta_rows = [
            AttrDict({"name": "ITEM-001", "default_bom": "BOM-DEFAULT"}),
            AttrDict({"name": "ITEM-002", "default_bom": None}),
        ]

        default_rows = [
            AttrDict(
                {
                    "name": "BOM-DEFAULT",
                    "item": "ITEM-001",
                    "is_active": 1,
                    "docstatus": 1,
                    "is_default": 0,
                    "quantity": 2,
                    "base_total_cost": 50,
                }
            )
        ]
        fallback_rows = [
            AttrDict(
                {
                    "name": "BOM-FALLBACK",
                    "item": "ITEM-002",
                    "is_active": 1,
                    "docstatus": 1,
                    "is_default": 1,
                    "quantity": 5,
                    "base_total_cost": 200,
                }
            )
        ]

        self.module.frappe.get_all = lambda doctype, filters=None, **kwargs: (
            default_rows if filters and filters.get("name") else fallback_rows
        )

        result = self.module.get_bom_costs(meta_rows)

        self.assertEqual(result["ITEM-001"]["bom"], "BOM-DEFAULT")
        self.assertEqual(result["ITEM-001"]["rate"], 25.0)
        self.assertEqual(result["ITEM-002"]["bom"], "BOM-FALLBACK")
        self.assertEqual(result["ITEM-002"]["rate"], 40.0)

    def test_merge_item_row_exposes_bom_cost_metadata(self):
        lookup = self.module.ItemLookupData(
            price_map={},
            stock_map={},
            meta_map={"ITEM-001": AttrDict({"name": "ITEM-001", "stock_uom": "Nos"})},
            uom_map={},
            barcode_map={},
            batch_map={},
            serial_map={},
            bom_map={"ITEM-001": {"rate": 33, "bom": "BOM-ITEM-001", "source": "bom"}},
        )

        row = self.module.merge_item_row(
            {"item_code": "ITEM-001"},
            lookup,
            "PKR",
            1,
        )

        self.assertEqual(row["manufacturing_cost"], 33)
        self.assertEqual(row["manufacturing_cost_source"], "bom")
        self.assertEqual(row["manufacturing_bom"], "BOM-ITEM-001")

    def test_fetch_barcodes_includes_standard_uom_field(self):
        calls = []

        def fake_get_all(doctype, **kwargs):
            calls.append((doctype, kwargs))
            return [AttrDict({"parent": "ITEM-001", "barcode": "BOX-001", "uom": "Box"})]

        self.module.frappe.get_all = fake_get_all

        rows = self.module._fetch_barcodes(("ITEM-001",))

        self.assertEqual(rows[0].uom, "Box")
        self.assertEqual(calls[0][0], "Item Barcode")
        self.assertIn("uom", calls[0][1]["fields"])
        self.assertNotIn("posa_uom", calls[0][1]["fields"])


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestFractionEligibilityFacts(unittest.TestCase):
    """`must_be_whole_number` on the way to the SPA (venta fraccionada).

    Before this, the fact existed nowhere on the client — the whole app had no
    reference to it — so the cart could not tell a kilo from a piece without
    asking the server per line.
    """

    @classmethod
    def setUpClass(cls):
        _install_stubs()
        cls.module = _load_module()

    def test_get_whole_number_uoms_asks_for_the_checked_ones(self):
        calls = []

        def fake_get_all(doctype, filters=None, **kwargs):
            calls.append((doctype, filters, kwargs))
            return ["Nos", "Box"]

        self.module.frappe.get_all = fake_get_all

        result = self.module.get_whole_number_uoms()

        self.assertEqual(result, frozenset({"Nos", "Box"}))
        self.assertEqual(calls[0][0], "UOM")
        self.assertEqual(calls[0][1], {"must_be_whole_number": 1})

    def test_ensure_stock_uom_flags_every_row(self):
        rows = self.module._ensure_stock_uom(
            [{"uom": "Kg", "conversion_factor": 1.0}, {"uom": "Box", "conversion_factor": 12.0}],
            "Kg",
            frozenset({"Box"}),
            {"Kg": {"uom": "Gram", "per_unit": 1000.0}},
        )

        self.assertEqual(
            rows,
            [
                {
                    "uom": "Kg",
                    "conversion_factor": 1.0,
                    "must_be_whole_number": 0,
                    "sub_unit": {"uom": "Gram", "per_unit": 1000.0},
                },
                {
                    "uom": "Box",
                    "conversion_factor": 12.0,
                    "must_be_whole_number": 1,
                    "sub_unit": None,
                },
            ],
        )

    def test_ensure_stock_uom_flags_the_appended_stock_uom(self):
        rows = self.module._ensure_stock_uom([], "Nos", frozenset({"Nos"}))

        self.assertEqual(
            rows,
            [
                {
                    "uom": "Nos",
                    "conversion_factor": 1.0,
                    "must_be_whole_number": 1,
                    "sub_unit": None,
                }
            ],
        )

    def test_ensure_stock_uom_does_not_write_into_the_cached_rows(self):
        # The source list comes out of the redis fetch cache. Annotating in
        # place would stamp the flag onto every later reader of the same
        # object, including one resolved against a different UOM set.
        cached = [{"uom": "Kg", "conversion_factor": 1.0}]

        self.module._ensure_stock_uom(cached, "Kg", frozenset({"Kg"}))

        self.assertEqual(cached, [{"uom": "Kg", "conversion_factor": 1.0}])

    def test_ensure_stock_uom_defaults_to_no_whole_number_uoms(self):
        rows = self.module._ensure_stock_uom([{"uom": "Kg", "conversion_factor": 1.0}], "Kg")

        self.assertEqual(rows[0]["must_be_whole_number"], 0)

    def test_merge_item_row_answers_for_the_LINE_uom_not_the_stock_uom(self):
        # A kilo item sold by the box is a whole-number LINE while that UOM is
        # selected — the cart asks per line, so the row-level answer must
        # follow `uom`, not `stock_uom`.
        lookup = self.module.ItemLookupData(
            price_map={},
            stock_map={},
            meta_map={"ITEM-KG": AttrDict({"name": "ITEM-KG", "stock_uom": "Kg"})},
            uom_map={"ITEM-KG": [{"uom": "Kg", "conversion_factor": 1.0}]},
            barcode_map={},
            batch_map={},
            serial_map={},
            bom_map={},
            whole_number_uoms=frozenset({"Box"}),
        )

        by_kg = self.module.merge_item_row({"item_code": "ITEM-KG"}, lookup, "MXN", 1)
        by_box = self.module.merge_item_row(
            {"item_code": "ITEM-KG", "uom": "Box"}, lookup, "MXN", 1
        )

        self.assertEqual(by_kg["must_be_whole_number"], 0)
        self.assertEqual(by_box["must_be_whole_number"], 1)

    def test_merge_item_row_flags_every_uom_option(self):
        lookup = self.module.ItemLookupData(
            price_map={},
            stock_map={},
            meta_map={"ITEM-KG": AttrDict({"name": "ITEM-KG", "stock_uom": "Kg"})},
            uom_map={
                "ITEM-KG": [
                    {"uom": "Kg", "conversion_factor": 1.0},
                    {"uom": "Box", "conversion_factor": 10.0},
                ]
            },
            barcode_map={},
            batch_map={},
            serial_map={},
            bom_map={},
            whole_number_uoms=frozenset({"Box"}),
        )

        row = self.module.merge_item_row({"item_code": "ITEM-KG"}, lookup, "MXN", 1)

        self.assertEqual(
            {u["uom"]: u["must_be_whole_number"] for u in row["item_uoms"]},
            {"Kg": 0, "Box": 1},
        )

    def test_sub_unit_factors_come_from_the_conversion_table(self):
        # The PAIRING is a product decision in code; the FACTOR is never one.
        queried = []

        def fake_get_value(doctype, filters, fieldname=None, **kwargs):
            queried.append((doctype, filters, fieldname))
            return {"Kg": 1000.0, "Litre": 1000.0, "Meter": 100.0}.get(filters.get("from_uom"))

        self.module.frappe.db.get_value = fake_get_value

        factors = self.module.get_sub_unit_factors()

        self.assertEqual(factors["Kg"], {"uom": "Gram", "per_unit": 1000.0})
        self.assertEqual(factors["Litre"], {"uom": "Millilitre", "per_unit": 1000.0})
        self.assertEqual(factors["Meter"], {"uom": "Centimeter", "per_unit": 100.0})
        self.assertEqual(queried[0][0], "UOM Conversion Factor")
        self.assertEqual(queried[0][1], {"from_uom": "Kg", "to_uom": "Gram"})

    def test_a_missing_conversion_row_drops_the_pairing_entirely(self):
        # No row, no chip: the register keeps the single-unit field it has
        # rather than being handed a factor nobody read out of the data.
        self.module.frappe.db.get_value = lambda *args, **kwargs: None

        self.assertEqual(self.module.get_sub_unit_factors(), {})

    def test_a_factor_that_is_not_smaller_is_refused(self):
        # 1 is the same unit and below 1 is a LARGER one; either would make the
        # entry chip multiply where it has to divide.
        self.module.frappe.db.get_value = lambda doctype, filters, fieldname=None, **kwargs: (
            1.0 if filters.get("from_uom") == "Kg" else 0.001
        )

        self.assertEqual(self.module.get_sub_unit_factors(), {})

    def test_ensure_stock_uom_attaches_the_sub_unit_per_row(self):
        rows = self.module._ensure_stock_uom(
            [{"uom": "Kg", "conversion_factor": 1.0}],
            "Kg",
            frozenset(),
            {"Kg": {"uom": "Gram", "per_unit": 1000.0}},
        )

        self.assertEqual(rows[0]["sub_unit"], {"uom": "Gram", "per_unit": 1000.0})

    def test_merge_item_row_answers_the_sub_unit_for_the_LINE_uom(self):
        lookup = self.module.ItemLookupData(
            price_map={},
            stock_map={},
            meta_map={"ITEM-KG": AttrDict({"name": "ITEM-KG", "stock_uom": "Kg"})},
            uom_map={"ITEM-KG": [{"uom": "Kg", "conversion_factor": 1.0}]},
            barcode_map={},
            batch_map={},
            serial_map={},
            bom_map={},
            sub_units={"Kg": {"uom": "Gram", "per_unit": 1000.0}},
        )

        by_kg = self.module.merge_item_row({"item_code": "ITEM-KG"}, lookup, "MXN", 1)
        by_box = self.module.merge_item_row(
            {"item_code": "ITEM-KG", "uom": "Box"}, lookup, "MXN", 1
        )

        self.assertEqual(by_kg["sub_unit"], {"uom": "Gram", "per_unit": 1000.0})
        self.assertIsNone(by_box["sub_unit"])

    def test_lookup_data_without_the_field_reads_as_no_sub_units(self):
        lookup = self.module.ItemLookupData({}, {}, {}, {}, {}, {}, {}, {})

        self.assertEqual(lookup.sub_units, {})

    def test_lookup_data_without_the_field_reads_as_nothing_whole(self):
        # The eight-positional constructor predates the field; an old caller
        # must keep working and must not accidentally mark everything whole.
        lookup = self.module.ItemLookupData({}, {}, {}, {}, {}, {}, {}, {})

        self.assertEqual(lookup.whole_number_uoms, frozenset())


if __name__ == "__main__":
    unittest.main()
