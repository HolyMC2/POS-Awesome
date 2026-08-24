"""Resolving the shop's entry attribute, and reading items' values for it.

The resolution mirrors ``doco``'s ``storefront/_profile.py`` and is therefore
mostly a question of what happens when it CANNOT resolve — no storefront app,
a disabled profile, a profile naming no attribute, an older doco whose table
lacks the column. Every one of those is an ordinary answer (``None``), not an
error, because the tenants running a storefront are a minority and the ones
that are not must keep selling exactly as they did.

The one thing this suite is strict about is the opposite direction: a resolver
that guessed — borrowed another company's attribute, or fell back to "any
profile" when a company was named — would offer one tenant's accessories
against another tenant's device list, on the register, in front of a customer.
"""

from __future__ import annotations

import importlib.util
import pathlib
import types
import unittest
from unittest import mock

_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)

entry_attribute = _isolated.load_api_module("posawesome_entry_attribute", "entry_attribute.py")


class _Db:
    """`frappe.db` for the three questions the resolution asks of it."""

    def __init__(self, doctypes=("Storefront Profile",), columns=None):
        self.doctypes = set(doctypes)
        self.columns = set(columns) if columns is not None else {"enabled", "company", "entry_attribute"}

    def exists(self, doctype, name=None):
        return name in self.doctypes if doctype == "DocType" else False

    def has_column(self, doctype, column):
        return column in self.columns


def _fake_frappe(profiles=None, variant_rows=None, attribute_values=None, db=None):
    """A `frappe` that answers `get_all` for the three doctypes in play.

    Filters are APPLIED rather than ignored: the whole point of several tests
    is which rows the filters exclude, and a fake that returned everything
    would pass them all.
    """
    module = types.SimpleNamespace()
    module.db = db if db is not None else _Db()
    module.local = types.SimpleNamespace()
    calls = []

    def get_all(doctype, filters=None, fields=None, order_by=None, limit=None, pluck=None, **kw):
        calls.append({"doctype": doctype, "filters": dict(filters or {}), "limit": limit})
        filters = filters or {}

        if doctype == "Storefront Profile":
            rows = list(profiles or [])
            if filters.get("enabled") is not None:
                rows = [r for r in rows if r.get("enabled") == filters["enabled"]]
            if "company" in filters:
                rows = [r for r in rows if r.get("company") == filters["company"]]
            if "entry_attribute" in filters:
                # `["is", "set"]`
                rows = [r for r in rows if r.get("entry_attribute")]
            rows = sorted(rows, key=lambda r: r.get("creation") or "")
            if limit:
                rows = rows[:limit]
            return [{"entry_attribute": r.get("entry_attribute")} for r in rows]

        if doctype == "Item Variant Attribute":
            wanted = set((filters.get("parent") or ["in", []])[1])
            attribute = filters.get("attribute")
            return [
                dict(r) for r in (variant_rows or []) if r["parent"] in wanted and r["attribute"] == attribute
            ]

        if doctype == "Item Attribute Value":
            return list((attribute_values or {}).get(filters.get("parent"), []))

        return []

    module.get_all = get_all
    module.calls = calls
    return module


DOCOMEXICO = {
    "name": "docomexico",
    "enabled": 1,
    "company": "Grupo Doco",
    "entry_attribute": "Modelos Celulares",
    "creation": "2026-01-01",
}
RELAY = {
    "name": "test-relay-sf",
    "enabled": 1,
    "company": "Grupo Doco",
    "entry_attribute": None,
    "creation": "2026-02-01",
}


class ResolutionTests(unittest.TestCase):
    def _resolve(self, company="Grupo Doco", **kwargs):
        fake = _fake_frappe(**kwargs)
        with mock.patch.object(entry_attribute, "frappe", fake):
            return entry_attribute.entry_attribute(company), fake

    def test_the_companys_profile_names_the_attribute(self):
        value, _ = self._resolve(profiles=[DOCOMEXICO, RELAY])
        self.assertEqual(value, "Modelos Celulares")

    def test_a_sibling_profile_naming_none_does_not_shadow_it(self):
        # Both rows are enabled and belong to the same company; the one with
        # no attribute must not be picked just because it sorts later.
        value, _ = self._resolve(profiles=[RELAY, DOCOMEXICO])
        self.assertEqual(value, "Modelos Celulares")

    def test_no_storefront_app_means_no_attribute(self):
        value, _ = self._resolve(profiles=[DOCOMEXICO], db=_Db(doctypes=()))
        self.assertIsNone(value)

    def test_an_older_doco_without_the_column_means_no_attribute(self):
        # Asking for a column that is not there is a SQL error on the item
        # catalogue's hot path; the feature simply reads as unconfigured.
        value, _ = self._resolve(profiles=[DOCOMEXICO], db=_Db(columns={"enabled", "company"}))
        self.assertIsNone(value)

    def test_a_disabled_profile_is_not_read(self):
        disabled = {**DOCOMEXICO, "enabled": 0}
        value, _ = self._resolve(profiles=[disabled])
        self.assertIsNone(value)

    def test_another_companys_attribute_is_never_borrowed(self):
        other = {**DOCOMEXICO, "name": "otra", "company": "Otra SA"}
        value, _ = self._resolve(company="Grupo Doco", profiles=[other])
        self.assertIsNone(value)

    def test_no_company_resolves_across_the_site(self):
        # The barcode endpoint has no company to pass. On a single-company
        # tenant — every tenant running a storefront today — this is the same
        # answer, and the filter is simply not applied.
        value, fake = self._resolve(company=None, profiles=[DOCOMEXICO])
        self.assertEqual(value, "Modelos Celulares")
        self.assertNotIn("company", fake.calls[0]["filters"])

    def test_two_profiles_for_one_company_resolve_to_the_oldest(self):
        second = {
            **DOCOMEXICO,
            "name": "segunda",
            "entry_attribute": "Talla",
            "creation": "2026-06-01",
        }
        value, _ = self._resolve(profiles=[second, DOCOMEXICO])
        self.assertEqual(value, "Modelos Celulares")

    def test_the_answer_is_memoised_per_request(self):
        fake = _fake_frappe(profiles=[DOCOMEXICO])
        with mock.patch.object(entry_attribute, "frappe", fake):
            entry_attribute.entry_attribute("Grupo Doco")
            entry_attribute.entry_attribute("Grupo Doco")
        profile_calls = [c for c in fake.calls if c["doctype"] == "Storefront Profile"]
        self.assertEqual(len(profile_calls), 1)

    def test_the_memo_is_per_company(self):
        other = {**DOCOMEXICO, "name": "otra", "company": "Otra SA", "entry_attribute": "Talla"}
        fake = _fake_frappe(profiles=[DOCOMEXICO, other])
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(entry_attribute.entry_attribute("Grupo Doco"), "Modelos Celulares")
            self.assertEqual(entry_attribute.entry_attribute("Otra SA"), "Talla")


class EntryAttributesTests(unittest.TestCase):
    """The plural form — every storefront's attribute, for `POS Combo`."""

    def test_distinct_in_profile_order(self):
        second = {
            **DOCOMEXICO,
            "name": "moda",
            "company": "Otra SA",
            "entry_attribute": "Talla",
            "creation": "2026-06-01",
        }
        third = {**DOCOMEXICO, "name": "tres", "creation": "2026-07-01"}
        fake = _fake_frappe(profiles=[third, second, DOCOMEXICO])
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(entry_attribute.entry_attributes(), ["Modelos Celulares", "Talla"])

    def test_empty_without_the_doctype(self):
        fake = _fake_frappe(profiles=[DOCOMEXICO], db=_Db(doctypes=()))
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(entry_attribute.entry_attributes(), [])


VARIANTS = [
    # A template declares WHICH attribute its variants vary by, with no value.
    {"parent": "IPN000071", "attribute": "Modelos Celulares", "attribute_value": None},
    {"parent": "IPN000102", "attribute": "Modelos Celulares", "attribute_value": "Samsung A01"},
    {"parent": "IPN000130", "attribute": "Modelos Celulares", "attribute_value": "Samsung A01"},
    {"parent": "IPN000137", "attribute": "Modelos Celulares", "attribute_value": "Samsung A10"},
    {"parent": "IPN000130", "attribute": "Color", "attribute_value": "Rojo"},
]


class ValueMapTests(unittest.TestCase):
    def _values(self, codes, attribute="Modelos Celulares"):
        fake = _fake_frappe(variant_rows=VARIANTS)
        with mock.patch.object(entry_attribute, "frappe", fake):
            return entry_attribute.entry_attribute_values(codes, attribute)

    def test_reads_the_value_each_variant_carries(self):
        self.assertEqual(
            self._values(["IPN000102", "IPN000130", "IPN000137"]),
            {
                "IPN000102": "Samsung A01",
                "IPN000130": "Samsung A01",
                "IPN000137": "Samsung A10",
            },
        )

    def test_a_template_is_absent_rather_than_blank(self):
        # A blank value would sit in the map as a fact, and an empty string is
        # not a device.
        self.assertEqual(self._values(["IPN000071"]), {})

    def test_another_attributes_value_is_not_returned(self):
        self.assertEqual(self._values(["IPN000130"], "Color"), {"IPN000130": "Rojo"})

    def test_no_codes_and_no_attribute_both_short_circuit(self):
        fake = _fake_frappe(variant_rows=VARIANTS)
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(entry_attribute.entry_attribute_values([], "Modelos Celulares"), {})
            self.assertEqual(entry_attribute.entry_attribute_values(["IPN000130"], None), {})
        self.assertEqual(fake.calls, [])


class ValueMapEndToEndTests(unittest.TestCase):
    """`entry_attribute_value_map` — what the three item wire paths call."""

    def test_resolves_then_reads(self):
        fake = _fake_frappe(profiles=[DOCOMEXICO], variant_rows=VARIANTS)
        with mock.patch.object(entry_attribute, "frappe", fake):
            attribute, values = entry_attribute.entry_attribute_value_map(["IPN000130"], "Grupo Doco")
        self.assertEqual(attribute, "Modelos Celulares")
        self.assertEqual(values, {"IPN000130": "Samsung A01"})

    def test_an_unconfigured_shop_costs_no_item_query_at_all(self):
        fake = _fake_frappe(profiles=[], variant_rows=VARIANTS)
        with mock.patch.object(entry_attribute, "frappe", fake):
            attribute, values = entry_attribute.entry_attribute_value_map(["IPN000130"], "Grupo Doco")
        self.assertIsNone(attribute)
        self.assertEqual(values, {})
        self.assertEqual([c["doctype"] for c in fake.calls if c["doctype"] == "Item Variant Attribute"], [])


class AttributeValuesTests(unittest.TestCase):
    def test_lists_the_attributes_own_values(self):
        fake = _fake_frappe(attribute_values={"Modelos Celulares": ["Samsung A01", "Samsung A10"]})
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(
                entry_attribute.attribute_values("Modelos Celulares"),
                ["Samsung A01", "Samsung A10"],
            )

    def test_no_attribute_asks_nothing(self):
        fake = _fake_frappe()
        with mock.patch.object(entry_attribute, "frappe", fake):
            self.assertEqual(entry_attribute.attribute_values(None), [])
        self.assertEqual(fake.calls, [])


if __name__ == "__main__":
    unittest.main()
