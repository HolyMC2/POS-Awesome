"""Promotion consent on customer quick-create, without importing its owner app.

`marketing_opt_in` (and optionally `marketing_opt_in_source`) are Customer
fields another app adds. POS Awesome writes them only when the doctype has
them, requires both channels the consent covers, and leaves stored consent
alone when a caller does not send the flag.

Run standalone: python3 posawesome/posawesome/api/test_customer_marketing_opt_in.py
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import types
import unittest
from unittest import mock

_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)


def _module(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    return module


_api_package = _module("posawesome.posawesome.api")
_api_package.__path__ = [str(_isolated.API_DIR)]

customers = _isolated.load_api_module(
    "posawesome.posawesome.api.customers",
    "customers.py",
    extra={
        "posawesome.posawesome.api": _api_package,
        "posawesome.posawesome.api.utils": _module(
            "posawesome.posawesome.api.utils",
            assert_pos_profile_write_allowed=lambda *args, **kwargs: None,
            fetch_sales_person_names=lambda **kwargs: [],
        ),
        "posawesome.posawesome.api.stored_value": _module(
            "posawesome.posawesome.api.stored_value",
            get_stored_value_summary=lambda **kwargs: {"available_amount": 0, "source_count": 0},
        ),
        "erpnext.accounts.doctype.loyalty_program.loyalty_program": _module(
            "erpnext.accounts.doctype.loyalty_program.loyalty_program",
            get_loyalty_program_details_with_points=lambda *args, **kwargs: {},
        ),
        "frappe.utils.caching": _module(
            "frappe.utils.caching", redis_cache=lambda *args, **kwargs: (lambda fn: fn)
        ),
    },
)

PROFILE = json.dumps({"name": "Doco Ventas", "company": "Grupo Doco"})
COUNTER = "Mostrador"


class _Customer(dict):
    """A Customer document: attribute writes land in the dict `.get` reads."""

    __getattr__ = dict.get

    def __setattr__(self, key, value):
        self[key] = value

    def save(self):
        self["saved"] = True


class _Frappe(types.SimpleNamespace):
    def __init__(self, fields=("marketing_opt_in", "marketing_opt_in_source"), existing=None):
        self_ = self

        def get_doc(doctype, name=None):
            if isinstance(doctype, dict):
                self_.created = _Customer(doctype, name=doctype["customer_name"])
                return self_.created
            return existing

        super().__init__(
            get_meta=lambda doctype: types.SimpleNamespace(has_field=lambda field: field in fields),
            get_doc=get_doc,
            db=types.SimpleNamespace(exists=lambda *args, **kwargs: False,
                                     get_value=lambda *args, **kwargs: None),
            throw=lambda message: (_ for _ in ()).throw(ValueError(message)),
            log_error=lambda *args, **kwargs: None,
            created=None,
        )


def _create(fake, **kwargs):
    args = {"customer_name": "Ana Pérez", "company": "Grupo Doco", "pos_profile_doc": PROFILE,
            "mobile_no": "6691234567", "email_id": "ana@example.com"}
    args.update(kwargs)
    with mock.patch.object(customers, "frappe", fake):
        customers.create_customer(**args)
    return fake.created


def _update(fake, **kwargs):
    args = {"customer_name": "Ana Pérez", "company": "Grupo Doco", "pos_profile_doc": PROFILE,
            "customer_id": "Ana Pérez", "method": "update"}
    args.update(kwargs)
    with mock.patch.object(customers, "frappe", fake), \
            mock.patch.object(customers, "set_customer_info", lambda *a, **k: None):
        customers.create_customer(**args)
    return fake.get_doc("Customer", "Ana Pérez")


class CreateTests(unittest.TestCase):
    def test_consent_records_the_counter_as_its_source(self):
        customer = _create(_Frappe(), marketing_opt_in=1)
        self.assertTrue(customer["saved"])
        self.assertEqual(customer["marketing_opt_in"], 1)
        self.assertEqual(customer["marketing_opt_in_source"], COUNTER)

    def test_without_a_source_field_only_the_flag_is_written(self):
        customer = _create(_Frappe(fields=("marketing_opt_in",)), marketing_opt_in=1)
        self.assertEqual(customer["marketing_opt_in"], 1)
        self.assertNotIn("marketing_opt_in_source", customer)

    def test_a_site_without_the_field_ignores_the_flag(self):
        customer = _create(_Frappe(fields=()), marketing_opt_in=1, email_id="")
        self.assertTrue(customer["saved"])
        self.assertNotIn("marketing_opt_in", customer)
        self.assertNotIn("marketing_opt_in_source", customer)

    def test_consent_requires_mobile_and_email(self):
        for missing in ({"email_id": ""}, {"mobile_no": None}, {"mobile_no": "  "}):
            fake = _Frappe()
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                _create(fake, marketing_opt_in=1, **missing)
            self.assertNotIn("saved", fake.created)

    def test_unticked_consent_needs_neither_channel(self):
        customer = _create(_Frappe(), marketing_opt_in=0, email_id="", mobile_no="")
        self.assertEqual(customer["marketing_opt_in"], 0)
        self.assertNotIn("marketing_opt_in_source", customer)

    def test_an_omitted_flag_writes_nothing(self):
        customer = _create(_Frappe())
        self.assertNotIn("marketing_opt_in", customer)

    def test_form_encoded_values(self):
        for value, expected in (("1", 1), ("true", 1), ("0", 0), ("false", 0), (True, 1)):
            with self.subTest(value=value):
                self.assertEqual(_create(_Frappe(), marketing_opt_in=value)["marketing_opt_in"], expected)


class UpdateTests(unittest.TestCase):
    def existing(self, **values):
        return _Customer({"name": "Ana Pérez", "customer_name": "Ana Pérez", **values})

    def test_update_can_record_consent(self):
        customer = _update(_Frappe(existing=self.existing()), marketing_opt_in=1,
                           mobile_no="6691234567", email_id="ana@example.com")
        self.assertEqual(customer["marketing_opt_in"], 1)
        self.assertEqual(customer["marketing_opt_in_source"], COUNTER)

    def test_existing_consent_keeps_its_original_source(self):
        existing = self.existing(marketing_opt_in=1, marketing_opt_in_source="WhatsApp")
        customer = _update(_Frappe(existing=existing), marketing_opt_in=1,
                           mobile_no="6691234567", email_id="ana@example.com")
        self.assertEqual(customer["marketing_opt_in_source"], "WhatsApp")

    def test_an_update_without_the_flag_keeps_consent(self):
        existing = self.existing(marketing_opt_in=1, marketing_opt_in_source="WhatsApp")
        customer = _update(_Frappe(existing=existing))
        self.assertEqual(customer["marketing_opt_in"], 1)
        self.assertTrue(customer["saved"])

    def test_an_explicit_zero_withdraws_consent(self):
        existing = self.existing(marketing_opt_in=1, marketing_opt_in_source="WhatsApp")
        customer = _update(_Frappe(existing=existing), marketing_opt_in="0")
        self.assertEqual(customer["marketing_opt_in"], 0)


class CustomerInfoTests(unittest.TestCase):
    def info(self, fake):
        fake.get_value = lambda *args, **kwargs: None
        fake.db.sql = lambda *args, **kwargs: []
        with mock.patch.object(customers, "frappe", fake):
            return customers.get_customer_info("Ana Pérez")

    def test_info_reports_consent_when_the_field_exists(self):
        existing = _Customer({"name": "Ana Pérez", "customer_name": "Ana Pérez", "marketing_opt_in": 1})
        self.assertEqual(self.info(_Frappe(existing=existing))["marketing_opt_in"], 1)

    def test_info_omits_consent_when_the_field_does_not_exist(self):
        existing = _Customer({"name": "Ana Pérez", "customer_name": "Ana Pérez"})
        self.assertNotIn("marketing_opt_in", self.info(_Frappe(fields=(), existing=existing)))


class ConsentWordingTests(unittest.TestCase):
    """The opening payload carries the owning app's consent wording."""

    def consent(self, field=None, error=False):
        def get_meta(doctype):
            if error:
                raise RuntimeError("meta unavailable")
            return types.SimpleNamespace(get_field=lambda name: field if name == "marketing_opt_in" else None)

        with mock.patch.object(customers, "frappe", types.SimpleNamespace(get_meta=get_meta)):
            return customers.customer_marketing_consent()

    def test_the_field_description_is_the_consent_text(self):
        field = types.SimpleNamespace(description="  Consentimiento explícito para recibir promociones.  ")
        self.assertEqual(
            self.consent(field),
            {"available": True, "description": "Consentimiento explícito para recibir promociones."},
        )

    def test_a_field_without_description_leaves_the_wording_to_the_register(self):
        self.assertEqual(self.consent(types.SimpleNamespace(description=None)), {"available": True, "description": ""})

    def test_no_field_offers_no_consent(self):
        self.assertEqual(self.consent(None), {"available": False, "description": ""})

    def test_unreadable_meta_offers_no_consent(self):
        self.assertEqual(self.consent(error=True), {"available": False, "description": ""})


if __name__ == "__main__":
    unittest.main()
