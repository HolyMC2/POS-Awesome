"""Customer-aware pricing in the combos read model.

The combo surfaces advertise a SAVING — a number the shopkeeper says out loud.
It is only true if it is computed from the same Item Price rows the CART would
land on for the same customer, so every test here is written against the
cart's own resolution as the oracle rather than against a rule invented for
combos:

* **Which price list** — ``frontend/src/posapp/components/pos/invoice_utils/
  customer.ts:64-66`` resolves ``customer_price_list ||
  customer_group_price_list || pos_profile.selling_price_list`` and repulls
  every line against it, over the two fields ``customers.py:230`` and
  ``customers.py:243-245`` put on the wire.
* **Which Item Price row inside it** — ``item_fetchers._fetch_item_prices``
  (``item_fetchers.py:160``) orders by
  ``IFNULL(customer, '') ASC, valid_from ASC, valid_upto DESC``, and the
  catalogue's ``_prepare_lookup`` (``item_fetchers.py:837-839``) then assigns
  unconditionally into ``price_map[item_code][uom]``. Last row wins, and ``''``
  sorts before any customer name, so the customer-specific row is the one the
  cart uses.
* **Which UOM** — ``item_fetchers._select_price`` (``item_fetchers.py:563-583``):
  the line's UOM, then the item's stock UOM, then a UOM-less price, then
  whatever is left.

The fetcher's own SQL is NOT re-implemented here — it has its own suite. Rows
are handed to the subject in the order that ORDER BY produces, and the tests
assert what the subject then picks, plus that the arguments the SQL needs to
do its filtering (the customer, the resolved list, its currency) reach it
verbatim.
"""

from __future__ import annotations

import contextlib
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock

# Loaded through `test_support/isolated_module`, which stubs the subject's
# module-level imports and RESTORES `sys.modules` afterwards. Read its header
# before changing this.
_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)

# `combos` imports `_ensure_pos_profile` at module level. The real one resolves
# a profile name against a live site; here the profile is simply given.
_utils_stub = types.ModuleType("posawesome.posawesome.api.utils")
_utils_stub.__file__ = "<stub>"
_utils_stub._ensure_pos_profile = lambda profile: (profile or {}, "{}")

# The entry-attribute resolver reads another app's `Storefront Profile`. It has
# its own suite (`test_entry_attribute`); here it is a dial, so a combos test
# can say "this shop runs a storefront" in one line instead of building one.
_entry_stub = types.ModuleType("posawesome.posawesome.api.entry_attribute")
_entry_stub.__file__ = "<stub>"
_entry_stub.entry_attribute = lambda company=None: None

combos = _isolated.load_api_module(
    "posawesome_combos",
    "combos.py",
    extra={
        "posawesome.posawesome.api.utils": _utils_stub,
        "posawesome.posawesome.api.entry_attribute": _entry_stub,
    },
)

PROFILE = {
    "name": "Demo Register",
    "selling_price_list": "Standard Selling",
    "currency": "MXN",
    "warehouse": "Tienda - D",
}


class _Db:
    """`frappe.db` for the three lookups the price-list resolution makes."""

    def __init__(self, customers=None, groups=None, price_lists=None, doctypes=()):
        self.customers = customers or {}
        self.groups = groups or {}
        self.price_lists = price_lists or {}
        self.doctypes = set(doctypes)
        self.calls = []

    def exists(self, doctype, name=None):
        # No `POS Combo` doctype by default → no overlay → every enabled bundle
        # is offered, which is the shape the pricing tests care about. The
        # targeting tests hand in the doctypes they need.
        return doctype == "DocType" and name in self.doctypes

    def get_value(self, doctype, name, fieldname=None, as_dict=False, **kwargs):
        self.calls.append((doctype, name, fieldname))
        if doctype == "Customer":
            row = self.customers.get(name)
            if row is None:
                return None
            return dict(row) if as_dict else row.get(fieldname)
        if doctype == "Customer Group":
            return self.groups.get(name)
        if doctype == "Price List":
            return self.price_lists.get(name)
        return None


def _fake_frappe(db, rows=None):
    module = types.SimpleNamespace()
    module.db = db
    table = {**_ROWS, **(rows or {})}

    def get_all(doctype, filters=None, fields=None, order_by=None, **kwargs):
        return table.get(doctype, [])

    module.get_all = get_all
    module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    return module


# One bundle: COMBO-DESAYUNO = 1 × CAFE (Nos) + 2 × PAN (Nos).
_ROWS = {
    "Product Bundle": [
        {"name": "PB-001", "new_item_code": "COMBO-DESAYUNO", "description": ""},
    ],
    "Product Bundle Item": [
        {"parent": "PB-001", "item_code": "CAFE", "qty": 1, "uom": "Nos", "idx": 1},
        {"parent": "PB-001", "item_code": "PAN", "qty": 2, "uom": "Nos", "idx": 2},
    ],
    "Item": [
        {"name": "COMBO-DESAYUNO", "item_name": "Desayuno", "is_stock_item": 1,
         "stock_uom": "Nos", "image": None},
        {"name": "CAFE", "item_name": "Café", "is_stock_item": 1,
         "stock_uom": "Nos", "image": None},
        {"name": "PAN", "item_name": "Pan", "is_stock_item": 1,
         "stock_uom": "Nos", "image": None},
    ],
}


@contextlib.contextmanager
def _world(price_rows, db=None, rows=None, entry_attribute=None):
    """Run `get_combos` against fixed Item Price rows, recording the fetch.

    `price_rows` are handed over in the order `_fetch_item_prices`' ORDER BY
    produces them — generic first, the requested customer's last.

    `entry_attribute` is what the shop's Storefront Profile resolves to; `None`
    (the default) is a tenant that runs no storefront, which is the state every
    pricing test above assumes and the state most tenants are in.
    """
    db = db if db is not None else _Db()
    fetches = []

    fetchers = types.ModuleType("posawesome.posawesome.api.item_fetchers")

    def get_item_prices(price_list, currency, item_codes, customer, today=None, ttl=None):
        fetches.append(
            {
                "price_list": price_list,
                "currency": currency,
                "item_codes": item_codes,
                "customer": customer,
                "today": today,
            }
        )
        return list(price_rows)

    fetchers.get_item_prices = get_item_prices

    stock = types.ModuleType("posawesome.posawesome.api.item_processing.stock")
    stock.get_bulk_stock_availability = lambda requested: {}

    # The parent packages are stubbed too: a real `posawesome.posawesome.api`
    # import would run `api/__init__.py`, which needs an initialised site.
    package_stubs = {
        "posawesome": types.ModuleType("posawesome"),
        "posawesome.posawesome": types.ModuleType("posawesome.posawesome"),
        "posawesome.posawesome.api": types.ModuleType("posawesome.posawesome.api"),
        "posawesome.posawesome.api.item_fetchers": fetchers,
        "posawesome.posawesome.api.item_processing": types.ModuleType(
            "posawesome.posawesome.api.item_processing"
        ),
        "posawesome.posawesome.api.item_processing.stock": stock,
    }

    with mock.patch.dict(sys.modules, package_stubs), mock.patch.object(
        combos, "frappe", _fake_frappe(db, rows)
    ), mock.patch.object(combos, "entry_attribute", lambda company=None: entry_attribute):
        yield fetches, db


def _by_code(combo):
    return {c["item_code"]: c for c in combo["components"]}


GENERIC = [
    {"item_code": "CAFE", "price_list_rate": 30, "currency": "MXN", "uom": "Nos", "customer": None},
    {"item_code": "PAN", "price_list_rate": 20, "currency": "MXN", "uom": "Nos", "customer": None},
]


class RowSelectionTests(unittest.TestCase):
    """Which Item Price row wins, given the fetcher's ordering."""

    def test_generic_only_pricing_is_unchanged(self):
        with _world(GENERIC):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        components = _by_code(combo)
        self.assertEqual(components["CAFE"]["rate"], 30.0)
        self.assertEqual(components["PAN"]["rate"], 20.0)

    def test_a_customer_specific_row_beats_the_generic_one(self):
        # The customer's row arrives LAST because `IFNULL(customer,'') ASC`
        # sorts '' before any name (item_fetchers.py:160). The catalogue keeps
        # the last (item_fetchers.py:838-839); so must this.
        rows = GENERIC + [
            {"item_code": "CAFE", "price_list_rate": 24, "currency": "MXN",
             "uom": "Nos", "customer": "Mayorista SA"},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")[0]

        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 24.0)

    def test_another_customer_still_gets_the_generic_row(self):
        # `IFNULL(customer,'') IN ('', %(customer)s)` (item_fetchers.py:157)
        # is what keeps one customer's price off another's screen, so the
        # thing to prove here is that the customer reaches the fetcher at all
        # — the old code asked with it and then discarded the answer.
        with _world(GENERIC) as (fetches, _db):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Público General")[0]

        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 30.0)
        self.assertEqual(fetches[0]["customer"], "Público General")

    def test_the_latest_valid_from_wins_inside_the_customer_bucket(self):
        # `valid_from ASC` puts the newest last; two live rows for the same
        # customer must resolve the way the catalogue resolves them.
        rows = [
            {"item_code": "CAFE", "price_list_rate": 26, "currency": "MXN",
             "uom": "Nos", "customer": "Mayorista SA"},
            {"item_code": "CAFE", "price_list_rate": 22, "currency": "MXN",
             "uom": "Nos", "customer": "Mayorista SA"},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")[0]

        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 22.0)

    def test_the_bundle_parent_takes_the_customer_row_too(self):
        # A saving is `list_sum - rate`. If the parent kept the generic rate
        # while the parts moved, the strip would invent a discount nobody gave.
        rows = GENERIC + [
            {"item_code": "COMBO-DESAYUNO", "price_list_rate": 55, "currency": "MXN",
             "uom": "Nos", "customer": None},
            {"item_code": "COMBO-DESAYUNO", "price_list_rate": 45, "currency": "MXN",
             "uom": "Nos", "customer": "Mayorista SA"},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")[0]

        self.assertEqual(combo["rate"], 45.0)

    def test_a_component_without_a_price_still_degrades_to_zero(self):
        with _world([GENERIC[0]]):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        self.assertEqual(_by_code(combo)["PAN"]["rate"], 0.0)


class UomSelectionTests(unittest.TestCase):
    """Which UOM's price, mirroring `_select_price` (item_fetchers.py:563-583)."""

    def test_the_component_line_uom_is_preferred(self):
        rows = [
            {"item_code": "CAFE", "price_list_rate": 300, "currency": "MXN",
             "uom": "Box", "customer": None},
            {"item_code": "CAFE", "price_list_rate": 30, "currency": "MXN",
             "uom": "Nos", "customer": None},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        # The bundle line is in Nos; a Box price must not become the Nos rate
        # just because it was fetched first or last.
        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 30.0)

    def test_a_uom_less_item_price_is_used_when_nothing_matches(self):
        rows = [
            {"item_code": "CAFE", "price_list_rate": 28, "currency": "MXN",
             "uom": None, "customer": None},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 28.0)

    def test_the_parent_falls_back_to_its_stock_uom(self):
        rows = [
            {"item_code": "COMBO-DESAYUNO", "price_list_rate": 55, "currency": "MXN",
             "uom": "Nos", "customer": None},
        ]

        with _world(rows):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        self.assertEqual(combo["rate"], 55.0)


class PriceListResolutionTests(unittest.TestCase):
    """Which price list, mirroring `invoice_utils/customer.ts:64-66`."""

    def test_no_customer_uses_the_registers_own_list_and_currency(self):
        with _world(GENERIC) as (fetches, db):
            combos.get_combos(pos_profile=PROFILE)

        self.assertEqual(fetches[0]["price_list"], "Standard Selling")
        self.assertEqual(fetches[0]["currency"], "MXN")
        # No customer, no Customer read at all.
        self.assertEqual(db.calls, [])

    def test_a_customer_without_a_list_of_their_own_keeps_the_registers(self):
        db = _Db(customers={"Público General": {"default_price_list": None, "customer_group": "All"}})

        with _world(GENERIC, db=db) as (fetches, _db):
            combos.get_combos(pos_profile=PROFILE, customer="Público General")

        self.assertEqual(fetches[0]["price_list"], "Standard Selling")
        self.assertEqual(fetches[0]["currency"], "MXN")

    def test_the_customers_default_price_list_wins_over_the_profiles(self):
        db = _Db(
            customers={"Mayorista SA": {"default_price_list": "Mayoreo", "customer_group": "Comercial"}},
            groups={"Comercial": "Grupo Comercial"},
            price_lists={"Mayoreo": "MXN"},
        )

        with _world(GENERIC, db=db) as (fetches, _db):
            combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")

        self.assertEqual(fetches[0]["price_list"], "Mayoreo")

    def test_the_customer_group_list_is_the_second_choice(self):
        # customer.ts:65 — the group's list applies when the customer has none
        # of their own, and it too displaces the register's.
        db = _Db(
            customers={"Tienda Chica": {"default_price_list": None, "customer_group": "Comercial"}},
            groups={"Comercial": "Grupo Comercial"},
            price_lists={"Grupo Comercial": "MXN"},
        )

        with _world(GENERIC, db=db) as (fetches, _db):
            combos.get_combos(pos_profile=PROFILE, customer="Tienda Chica")

        self.assertEqual(fetches[0]["price_list"], "Grupo Comercial")

    def test_the_customers_list_carries_its_own_currency(self):
        # `customers.py:247-251` reads the currency off the EFFECTIVE list and
        # `customer.ts:74-81` uses it. Sending the profile currency instead
        # would fail `currency = %(currency)s` and zero every rate.
        db = _Db(
            customers={"Border Co": {"default_price_list": "USD Selling", "customer_group": None}},
            price_lists={"USD Selling": "USD"},
        )

        with _world(GENERIC, db=db) as (fetches, _db):
            combos.get_combos(pos_profile=PROFILE, customer="Border Co")

        self.assertEqual(fetches[0]["price_list"], "USD Selling")
        self.assertEqual(fetches[0]["currency"], "USD")

    def test_a_list_without_a_currency_falls_back_to_the_profiles(self):
        db = _Db(
            customers={"Mayorista SA": {"default_price_list": "Mayoreo", "customer_group": None}},
            price_lists={},
        )

        with _world(GENERIC, db=db) as (fetches, _db):
            combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")

        self.assertEqual(fetches[0]["currency"], "MXN")

    def test_an_unknown_customer_does_not_break_the_answer(self):
        with _world(GENERIC, db=_Db()) as (fetches, _db):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Ghost")[0]

        self.assertEqual(fetches[0]["price_list"], "Standard Selling")
        self.assertEqual(_by_code(combo)["CAFE"]["rate"], 30.0)

    def test_the_same_list_as_the_profile_needs_no_currency_lookup(self):
        # Reading `Price List` here could only replace the profile currency
        # with itself, and a wrong Price List row would silently zero the
        # generic path.
        db = _Db(
            customers={"Casa": {"default_price_list": "Standard Selling", "customer_group": None}},
        )

        with _world(GENERIC, db=db) as (fetches, seen):
            combos.get_combos(pos_profile=PROFILE, customer="Casa")

        self.assertEqual(fetches[0]["currency"], "MXN")
        self.assertNotIn("Price List", [call[0] for call in seen.calls])

    def test_parent_and_components_are_priced_from_one_list(self):
        # A single fetch is the guarantee: two fetches would be two lists.
        db = _Db(
            customers={"Mayorista SA": {"default_price_list": "Mayoreo", "customer_group": None}},
            price_lists={"Mayoreo": "MXN"},
        )
        rows = [
            {"item_code": "COMBO-DESAYUNO", "price_list_rate": 45, "currency": "MXN",
             "uom": "Nos", "customer": None},
            {"item_code": "CAFE", "price_list_rate": 24, "currency": "MXN",
             "uom": "Nos", "customer": None},
            {"item_code": "PAN", "price_list_rate": 16, "currency": "MXN",
             "uom": "Nos", "customer": None},
        ]

        with _world(rows, db=db) as (fetches, _db):
            combo = combos.get_combos(pos_profile=PROFILE, customer="Mayorista SA")[0]

        self.assertEqual(len(fetches), 1)
        self.assertEqual(fetches[0]["price_list"], "Mayoreo")
        components = _by_code(combo)
        list_sum = sum(c["rate"] * c["qty"] for c in combo["components"])
        self.assertEqual(components["CAFE"]["rate"], 24.0)
        self.assertEqual(list_sum - combo["rate"], 11.0)


class ComponentEndpointTests(unittest.TestCase):
    def test_get_combo_components_prices_through_the_same_path(self):
        # The cart's narrow question must not answer differently from the
        # strip's wide one — it is a wrapper precisely so it cannot.
        db = _Db(
            customers={"Mayorista SA": {"default_price_list": "Mayoreo", "customer_group": None}},
            price_lists={"Mayoreo": "MXN"},
        )
        rows = GENERIC + [
            {"item_code": "CAFE", "price_list_rate": 24, "currency": "MXN",
             "uom": "Nos", "customer": "Mayorista SA"},
        ]

        with _world(rows, db=db) as (fetches, _db):
            answer = combos.get_combo_components(
                bundles=["COMBO-DESAYUNO"], pos_profile=PROFILE, customer="Mayorista SA"
            )

        self.assertEqual(fetches[0]["price_list"], "Mayoreo")
        rates = {c["item_code"]: c["rate"] for c in answer["COMBO-DESAYUNO"]}
        self.assertEqual(rates["CAFE"], 24.0)


class ShapeTests(unittest.TestCase):
    """The payload the client normaliser is pinned to."""

    def test_the_keys_are_the_ones_the_client_reads(self):
        with _world(GENERIC):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        self.assertEqual(
            sorted(combo),
            [
                "components",
                "image",
                "item_code",
                "item_name",
                "priority",
                "rate",
                "target_attribute",
                "target_attribute_values",
                "targets",
            ],
        )
        self.assertEqual(
            sorted(combo["components"][0]),
            ["actual_qty", "is_stock_item", "item_code", "item_name", "qty", "rate", "uom"],
        )

    def test_every_rate_is_a_float(self):
        # `flt` used to do this at the call site; `_rate_for` must keep it, or
        # a Decimal from the DB would reach the wire and JSON-serialise oddly.
        with _world(GENERIC):
            combo = combos.get_combos(pos_profile=PROFILE)[0]

        self.assertIsInstance(combo["rate"], float)
        for component in combo["components"]:
            self.assertIsInstance(component["rate"], float)


# The `POS Combo` overlay, as a site that has actually configured one returns
# it. `POS Combo` autonames to its bundle, so the overlay row's name and its
# `product_bundle` are both the Product Bundle's name.
_OVERLAY_ROWS = {
    "POS Combo": [{"name": "PB-001", "product_bundle": "PB-001", "priority": 10}],
    "POS Combo Target": [{"parent": "PB-001", "item_code": "Samsung Galaxy A15"}],
    "POS Combo Attribute Target": [
        {"parent": "PB-001", "attribute_value": "Samsung A01"},
        {"parent": "PB-001", "attribute_value": "  Samsung A10  "},
        # Blank rows exist on hand-edited docs; they must not reach the client,
        # where an empty string would sit in the target set as a value that
        # matches nothing while still making the combo look targeted.
        {"parent": "PB-001", "attribute_value": "   "},
        {"parent": "PB-001", "attribute_value": None},
    ],
}

_CONFIGURED = ("POS Combo", "POS Combo Attribute Target")


class AttributeTargetingTests(unittest.TestCase):
    """`target_attribute` / `target_attribute_values` — the device leg."""

    def _combo(self, doctypes=_CONFIGURED, entry_attribute="Modelos Celulares", rows=_OVERLAY_ROWS):
        with _world(GENERIC, db=_Db(doctypes=doctypes), rows=rows, entry_attribute=entry_attribute):
            return combos.get_combos(pos_profile=PROFILE)[0]

    def test_the_shops_attribute_and_the_combos_models_both_ride(self):
        combo = self._combo()
        self.assertEqual(combo["target_attribute"], "Modelos Celulares")
        self.assertEqual(combo["target_attribute_values"], ["Samsung A01", "Samsung A10"])

    def test_item_targets_are_untouched_beside_them(self):
        self.assertEqual(self._combo()["targets"], ["Samsung Galaxy A15"])

    def test_blank_rows_never_reach_the_client(self):
        self.assertNotIn("", self._combo()["target_attribute_values"])

    def test_a_shop_with_no_storefront_gets_a_null_attribute(self):
        combo = self._combo(entry_attribute=None)
        self.assertIsNone(combo["target_attribute"])

    def test_but_its_declared_models_still_ride(self):
        # If the values were dropped with the attribute, a device-specific
        # combo would arrive at the client with no targeting of any kind — and
        # `eligibilityFor` would read that as UNIVERSAL and offer it on every
        # ticket in the shop. Silence is recoverable; that is not.
        combo = self._combo(entry_attribute=None)
        self.assertEqual(combo["target_attribute_values"], ["Samsung A01", "Samsung A10"])

    def test_a_site_without_the_child_doctype_answers_with_item_targets(self):
        # Mid-migration, or a posawesome older than this table. Asking for it
        # would be a SQL error on the register's first call.
        combo = self._combo(doctypes=("POS Combo",))
        self.assertEqual(combo["target_attribute_values"], [])
        self.assertEqual(combo["targets"], ["Samsung Galaxy A15"])

    def test_no_overlay_at_all_leaves_both_legs_empty(self):
        # The degradation the module promises: a tenant who never opened the
        # combo settings still gets every enabled bundle, targeted at nothing.
        combo = self._combo(doctypes=(), rows={})
        self.assertEqual(combo["targets"], [])
        self.assertEqual(combo["target_attribute_values"], [])
        self.assertEqual(combo["target_attribute"], "Modelos Celulares")

    def test_the_narrow_component_endpoint_still_answers_components_only(self):
        with _world(GENERIC, db=_Db(doctypes=_CONFIGURED), rows=_OVERLAY_ROWS,
                    entry_attribute="Modelos Celulares"):
            answer = combos.get_combo_components(
                bundles='["COMBO-DESAYUNO"]', pos_profile=PROFILE
            )
        self.assertEqual(sorted(answer), ["COMBO-DESAYUNO"])
        self.assertEqual(
            sorted(answer["COMBO-DESAYUNO"][0]),
            ["actual_qty", "is_stock_item", "item_code", "item_name", "qty", "rate", "uom"],
        )


if __name__ == "__main__":
    unittest.main()
