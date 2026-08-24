"""`POS Combo`'s device targets — the validation that keeps them reachable.

Lives under `api/` and not beside the doctype ON PURPOSE: CI discovers exactly
one tree (`python -m unittest discover -s posawesome/posawesome/api`), and a
suite parked next to its doctype would be collected by nobody and go green by
never running. The subject is loaded from its real path with stubs, the same
way `test_combos` loads `combos.py`.

What is worth testing here is not the happy path — a row that says «Samsung
A01» either matches a cart line or it does not, and `comboAttributeTargeting.
spec.ts` owns that. It is the two ways a merchant's row can be silently
UNREACHABLE:

  * a typo («Samsung A1»), and
  * a value belonging to a different attribute («Rojo»),

both of which produce a combo that is targeted, matches nothing, and therefore
never appears anywhere, with nothing in any log to say why. A throw at save is
the only moment anyone is looking.
"""

from __future__ import annotations

import contextlib
import importlib.util
import pathlib
import sys
import types
import unittest

_CONTROLLER = pathlib.Path(__file__).resolve().parent.parent / "doctype" / "pos_combo" / "pos_combo.py"


class _ValidationError(Exception):
    pass


class _Row:
    """One `POS Combo Attribute Target` child row."""

    def __init__(self, attribute_value, idx=0):
        self.attribute_value = attribute_value
        self.idx = idx


def _frappe_stub():
    module = types.ModuleType("frappe")
    module.__file__ = "<stub>"
    module._ = lambda text, *args, **kwargs: text
    module.get_all = lambda *args, **kwargs: []

    def throw(message, exc_type=_ValidationError):
        raise exc_type(message)

    module.throw = throw
    module.db = types.SimpleNamespace(get_value=lambda *args, **kwargs: None)
    return module


def _document_stub():
    package = types.ModuleType("frappe.model")
    package.__file__ = "<stub>"
    module = types.ModuleType("frappe.model.document")
    module.__file__ = "<stub>"

    class Document:
        def __init__(self, **fields):
            self.__dict__.update(fields)

    module.Document = Document
    return package, module


_TOUCHED = (
    "frappe",
    "frappe.model",
    "frappe.model.document",
    "posawesome",
    "posawesome.posawesome",
    "posawesome.posawesome.api",
    "posawesome.posawesome.api.entry_attribute",
)


@contextlib.contextmanager
def _controller(attributes=(), values=None):
    """The loaded controller class, with the entry-attribute resolver dialled in.

    `attributes` is what every enabled storefront on the site names; `values`
    maps each to the values it actually carries. Empty `attributes` is a tenant
    with no storefront — the state in which the validation must stand aside.
    """
    saved = {key: sys.modules.get(key) for key in _TOUCHED}
    frappe = _frappe_stub()
    model_pkg, document = _document_stub()

    entry = types.ModuleType("posawesome.posawesome.api.entry_attribute")
    entry.__file__ = "<stub>"
    entry.entry_attributes = lambda: list(attributes)
    entry.attribute_values = lambda attribute: list((values or {}).get(attribute, []))

    try:
        sys.modules["frappe"] = frappe
        sys.modules["frappe.model"] = model_pkg
        sys.modules["frappe.model.document"] = document
        for name in ("posawesome", "posawesome.posawesome", "posawesome.posawesome.api"):
            sys.modules[name] = types.ModuleType(name)
        sys.modules["posawesome.posawesome.api.entry_attribute"] = entry

        spec = importlib.util.spec_from_file_location("posawesome_pos_combo", _CONTROLLER)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        sys.modules["posawesome_pos_combo"] = module
        spec.loader.exec_module(module)
        yield module
    finally:
        sys.modules.pop("posawesome_pos_combo", None)
        for key, value in saved.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value


MODELOS = "Modelos Celulares"
KNOWN = {MODELOS: ["Samsung A01", "Samsung A01 Core", "Samsung A10"]}


def _combo(module, rows):
    doc = module.POSCombo.__new__(module.POSCombo)
    doc.product_bundle = "PB-001"
    doc.targets = []
    doc.attribute_targets = [_Row(value, idx=index) for index, value in enumerate(rows, start=1)]
    return doc


class UnreachableValueTests(unittest.TestCase):
    def test_a_typo_is_refused_rather_than_silently_dead(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Samsung A1"])
            with self.assertRaises(Exception) as caught:
                doc.validate_attribute_targets()
        self.assertIn("Samsung A1", str(caught.exception))
        self.assertIn(MODELOS, str(caught.exception))

    def test_a_value_from_another_attribute_is_refused_too(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Rojo"])
            with self.assertRaises(Exception):
                doc.validate_attribute_targets()

    def test_a_real_value_passes(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Samsung A01", "Samsung A10"])
            doc.validate_attribute_targets()
        self.assertEqual([r.attribute_value for r in doc.attribute_targets], ["Samsung A01", "Samsung A10"])

    def test_a_second_storefronts_value_is_accepted(self):
        # `POS Combo` has no company — it overlays a company-less bundle — so a
        # site running two storefronts cannot say which one a row meant.
        # Refusing the second shop's models would be worse than accepting both.
        with _controller(
            attributes=[MODELOS, "Talla"],
            values={**KNOWN, "Talla": ["S", "M", "L"]},
        ) as module:
            doc = _combo(module, ["M"])
            doc.validate_attribute_targets()


class StandingAsideTests(unittest.TestCase):
    def test_no_storefront_means_no_opinion(self):
        # The rows are dead weight until the tenant configures a storefront —
        # which is a fixable state, unlike a doctype that refuses to save
        # because another app is not set up yet.
        with _controller(attributes=[]) as module:
            doc = _combo(module, ["whatever the merchant typed"])
            doc.validate_attribute_targets()

    def test_an_attribute_with_no_values_yet_is_not_a_verdict(self):
        with _controller(attributes=[MODELOS], values={MODELOS: []}) as module:
            doc = _combo(module, ["Samsung A01"])
            doc.validate_attribute_targets()

    def test_an_empty_table_asks_nothing(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, [])
            doc.validate_attribute_targets()
        self.assertEqual(doc.attribute_targets, [])


class TidyingTests(unittest.TestCase):
    def test_values_are_trimmed(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["  Samsung A01  "])
            doc.validate_attribute_targets()
        self.assertEqual([r.attribute_value for r in doc.attribute_targets], ["Samsung A01"])

    def test_duplicates_collapse_and_the_grid_is_renumbered(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Samsung A01", "Samsung A01", "Samsung A10"])
            doc.validate_attribute_targets()
        self.assertEqual([r.attribute_value for r in doc.attribute_targets], ["Samsung A01", "Samsung A10"])
        self.assertEqual([r.idx for r in doc.attribute_targets], [1, 2])

    def test_blank_rows_are_dropped_not_refused(self):
        # A blank row is an empty grid line the merchant tabbed past, not a
        # claim about a device. Refusing it would block a save over nothing.
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Samsung A01", "   ", ""])
            doc.validate_attribute_targets()
        self.assertEqual([r.attribute_value for r in doc.attribute_targets], ["Samsung A01"])

    def test_a_trimmed_duplicate_of_a_kept_value_also_collapses(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = _combo(module, ["Samsung A01", " Samsung A01 "])
            doc.validate_attribute_targets()
        self.assertEqual(len(doc.attribute_targets), 1)


class ItemTargetsUntouchedTests(unittest.TestCase):
    """The existing leg must not have moved."""

    def test_a_component_is_still_refused_as_an_item_target(self):
        with _controller(attributes=[MODELOS], values=KNOWN) as module:
            doc = module.POSCombo.__new__(module.POSCombo)
            doc.product_bundle = "PB-001"
            doc.targets = [types.SimpleNamespace(item_code="MICA")]
            module.frappe.get_all = lambda *args, **kwargs: ["MICA"]
            with self.assertRaises(Exception) as caught:
                doc.validate_targets_not_components()
        self.assertIn("MICA", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
