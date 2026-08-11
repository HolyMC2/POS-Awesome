"""Bench integration tests for the POS CFDI surface (api/cfdi*.py).

The PAC is always mocked at ``FacturapiClient.from_settings`` — the one seam
every stamp path goes through — so these run on any mirror without keys and
can assert exactly how many CFDIs a flow would have created (the double-tap
guard is an assertion on ``create_invoice`` call count, not on messages).

Fixtures live in setUp, never setUpClass (Frappe rolls back per module, so
class-level docs leak into whichever test module runs next). Items resolve
through the ``item_code`` FIELD because doco sites name Items by IPN series.
"""

from __future__ import annotations

import unittest
import uuid
from unittest import mock

try:
    import frappe
except ImportError:  # pragma: no cover - standalone stub runner
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from posawesome.posawesome.api import cfdi, cfdi_customer

PROFILE = "Doco Ventas"
FLAG = cfdi.FEATURE_FLAG


def uid(prefix="cfdi"):
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def make_rfc(prefix: str = "GODE561231", homoclave: str | None = None) -> str:
    """A checksum-valid RFC: letters+date prefix, random homoclave, real digit.

    Randomizing the homoclave keeps RFCs unique across tests — Customer has a
    hard duplicate-RFC guard and module-level rollback leaves earlier tests'
    customers visible to later ones.
    """
    import random
    import string

    from erpnext_mexico_compliance.fiscal.validation import rfc

    homoclave = homoclave or "".join(
        random.choices(string.ascii_uppercase + string.digits, k=2)
    )
    base = prefix + homoclave
    digit = rfc.check_digit(base)
    assert digit, f"bad RFC base for tests: {base}"
    return base + digit


def _minimal_pdf() -> bytes:
    """A structurally valid empty PDF — frappe's File upload runs the bytes
    through pypdf (JS scan), so a bare '%PDF' marker is rejected."""
    header = b"%PDF-1.4\n"
    objs = [
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n",
    ]
    offsets, pos = [], len(header)
    for obj in objs:
        offsets.append(pos)
        pos += len(obj)
    xref = b"xref\n0 4\n0000000000 65535 f \n"
    xref += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    trailer = (
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n" + str(pos).encode() + b"\n%%EOF\n"
    )
    return header + b"".join(objs) + xref + trailer


class _FakePac:
    """Deterministic Facturapi stand-in recording every create call."""

    def __init__(self):
        self.create_calls = 0
        self.uuid = "AAAABBBB-1111-2222-3333-444455556666"

    def _invoice(self):
        return {"id": "fapi_test_1", "uuid": self.uuid, "status": "valid"}

    def create_invoice(self, payload, ref=None):
        self.create_calls += 1
        return self._invoice()

    def get_invoice(self, invoice_id):
        return self._invoice()

    def get_invoice_xml(self, invoice_id):
        return b"<?xml version='1.0'?><cfdi:Comprobante xmlns:cfdi='x'/>"

    def get_invoice_pdf(self, invoice_id):
        return _minimal_pdf()

    def send_invoice_email(self, invoice_id, email):
        return {"ok": True}


class CfdiTestCase(IntegrationTestCase):
    """Shared fixtures: flagged profile, CFDI-able customer + item + invoice."""

    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest(f"no {PROFILE} profile on this site")
        if "erpnext_mexico_compliance" not in frappe.get_installed_apps():
            self.skipTest("emc not installed on this site")
        if not frappe.db.has_column("POS Profile", FLAG):
            self.skipTest(f"{FLAG} custom field not migrated yet")

        self.profile = PROFILE
        self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
        self._tracked: list[tuple[str, str]] = []
        self._restores: list[tuple[str, str, str, object]] = []

        self._set_and_restore("POS Profile", PROFILE, FLAG, 1)
        self._ensure_company_address()
        self.item = self._ensure_cfdi_item()
        self.customer = self._make_fiscal_customer()

    def tearDown(self):
        frappe.set_user("Administrator")
        for doctype, name in reversed(self._tracked):
            try:
                doc = frappe.get_doc(doctype, name)
                if doc.docstatus == 1:
                    doc.flags.ignore_permissions = True
                    doc.flags.ignore_links = True
                    doc.cancel()
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
            except Exception:
                pass
        for doctype, name, field, value in reversed(self._restores):
            try:
                frappe.db.set_value(doctype, name, field, value, update_modified=False)
            except Exception:
                pass

    def track(self, doctype, name):
        self._tracked.append((doctype, name))
        return name

    def _set_and_restore(self, doctype, name, field, value):
        self._restores.append((doctype, name, field, frappe.db.get_value(doctype, name, field)))
        frappe.db.set_value(doctype, name, field, value, update_modified=False)

    # -- fixture builders --------------------------------------------------

    def _ensure_company_address(self):
        from erpnext.setup.doctype.company.company import get_default_company_address

        address = get_default_company_address(self.company)
        if address:
            if not frappe.db.get_value("Address", address, "pincode"):
                self._set_and_restore("Address", address, "pincode", "06000")
            return
        doc = frappe.get_doc(
            {
                "doctype": "Address",
                "address_title": f"{self.company} {uid('addr')}",
                "address_type": "Billing",
                "address_line1": "-",
                "city": "-",
                "country": "Mexico",
                "pincode": "06000",
                "is_your_company_address": 1,
                "links": [{"link_doctype": "Company", "link_name": self.company}],
            }
        ).insert(ignore_permissions=True)
        self.track("Address", doc.name)

    def _ensure_cfdi_item(self) -> str:
        code = "POSA-TEST-CFDI-SVC"
        sat_key = frappe.db.get_value("SAT Product or Service Key", {}, "name")
        if not sat_key:
            self.skipTest("SAT catalogs not seeded on this site")
        name = frappe.db.get_value("Item", {"item_code": code}, "name")
        if not name:
            group = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
            doc = frappe.get_doc(
                {
                    "doctype": "Item",
                    "item_code": code,
                    "item_name": "CFDI Test Service",
                    "item_group": group,
                    "stock_uom": "Nos",
                    "is_stock_item": 0,
                    "is_sales_item": 1,
                    "mx_product_service_key": sat_key,
                }
            ).insert(ignore_permissions=True)
            name = doc.name
        if not frappe.db.get_value("Item", name, "mx_product_service_key"):
            frappe.db.set_value("Item", name, "mx_product_service_key", sat_key)
        uom = frappe.db.get_value("Item", name, "stock_uom") or "Nos"
        if not frappe.db.get_value("UOM", uom, "mx_uom_key"):
            uom_key = frappe.db.get_value("SAT UOM Key", {}, "name")
            if uom_key:
                self._set_and_restore("UOM", uom, "mx_uom_key", uom_key)
        return name

    def _make_fiscal_customer(self, rfc_base="GODE561231", regime="601") -> str:
        doc = frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": f"Cliente CFDI {uid('c')}",
                "customer_group": frappe.db.get_value(
                    "Customer Group", {"is_group": 0}, "name"
                ),
                "territory": "All Territories",
                "tax_id": make_rfc(rfc_base),
                "mx_tax_regime": regime,
            }
        )
        doc.insert(ignore_permissions=True)
        self.track("Customer", doc.name)
        addr = frappe.get_doc(
            {
                "doctype": "Address",
                "address_title": doc.customer_name,
                "address_type": "Billing",
                "address_line1": "-",
                "city": "-",
                "country": "Mexico",
                "pincode": "06600",
                "links": [{"link_doctype": "Customer", "link_name": doc.name}],
            }
        ).insert(ignore_permissions=True)
        self.track("Address", addr.name)
        frappe.db.set_value(
            "Customer", doc.name, "customer_primary_address", addr.name, update_modified=False
        )
        return doc.name

    def _make_invoice(self, customer=None, docstatus=1) -> str:
        si = frappe.get_doc(
            {
                "doctype": "Sales Invoice",
                "customer": customer or self.customer,
                "set_posting_time": 1,
                "posting_date": str(add_to_date(now_datetime(), days=-1).date()),
                "due_date": str(add_to_date(now_datetime(), days=30).date()),
                "company": self.company,
                "currency": "MXN",
                "items": [{"item_code": self.item, "qty": 1, "rate": 100}],
                "update_stock": 0,
            }
        )
        si.insert(ignore_permissions=True)
        if docstatus == 1:
            si.submit()
        self.track("Sales Invoice", si.name)
        return si.name

    def _make_user(self, member_of_profile: bool) -> str:
        email = f"{uid('user')}@example.com"
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": "CFDI",
                "last_name": "Tester",
                "send_welcome_email": 0,
                "enabled": 1,
                "roles": [
                    {"role": "Sales Manager"},
                    {"role": "Accounts Manager"},
                ],
            }
        )
        user.insert(ignore_permissions=True)
        self.track("User", email)
        if member_of_profile:
            profile = frappe.get_doc("POS Profile", self.profile)
            profile.append("applicable_for_users", {"user": email})
            profile.flags.ignore_permissions = True
            profile.save()
            self._member_added = email
        return email

    def _remove_profile_member(self, email: str):
        frappe.db.delete(
            "POS Profile User", {"parent": self.profile, "user": email}
        )

    def _stamp_kwargs(self, invoice_name, **overrides):
        kwargs = {
            "invoice_name": invoice_name,
            "pos_profile": self.profile,
            "customer": self.customer,
            "mx_cfdi_use": "G03",
            "mx_payment_option": "PUE",
            "mx_payment_mode": "01",
        }
        kwargs.update(overrides)
        return kwargs


class TestCfdiBootstrapAndSearch(CfdiTestCase):
    def test_bootstrap_enabled_with_catalogs(self):
        out = cfdi.get_cfdi_bootstrap(self.profile)
        self.assertTrue(out["enabled"])
        self.assertEqual(out["company"], self.company)
        regime_keys = {r["key"] for r in out["catalogs"]["tax_regimes"]}
        self.assertIn("601", regime_keys)
        uses = {u["key"]: u for u in out["catalogs"]["cfdi_uses"]}
        self.assertIn("G03", uses)
        self.assertIsInstance(uses["G03"]["tax_regimes"], list)

    def test_bootstrap_disabled_when_flag_off(self):
        frappe.db.set_value("POS Profile", self.profile, FLAG, 0, update_modified=False)
        out = cfdi.get_cfdi_bootstrap(self.profile)
        self.assertFalse(out["enabled"])
        self.assertEqual(out["reason"], "profile_flag_off")

    def test_search_scope_denied_for_non_member(self):
        outsider = self._make_user(member_of_profile=False)
        frappe.set_user(outsider)
        try:
            with self.assertRaises(frappe.PermissionError):
                cfdi.search_cfdi_invoices(self.profile)
        finally:
            frappe.set_user("Administrator")

    def test_search_status_filters(self):
        plain = self._make_invoice()
        stamped = self._make_invoice()
        frappe.db.set_value(
            "Sales Invoice", stamped, "mx_stamped_xml", "<cfdi/>", update_modified=False
        )

        names = lambda rows: {r["name"] for r in rows}  # noqa: E731
        unstamped = names(cfdi.search_cfdi_invoices(self.profile, status="unstamped", limit=50))
        self.assertIn(plain, unstamped)
        self.assertNotIn(stamped, unstamped)

        stamped_rows = cfdi.search_cfdi_invoices(self.profile, status="stamped", limit=50)
        self.assertIn(stamped, names(stamped_rows))
        row = next(r for r in stamped_rows if r["name"] == stamped)
        self.assertEqual(row["stamp_status"], "stamped")

        # mx_stamp_error is patch-delivered; the error leg only exists where
        # the column does.
        if frappe.db.has_column("Sales Invoice", "mx_stamp_error"):
            errored = self._make_invoice()
            frappe.db.set_value(
                "Sales Invoice", errored, "mx_stamp_error", "PAC says no",
                update_modified=False,
            )
            error_rows = cfdi.search_cfdi_invoices(self.profile, status="error", limit=50)
            self.assertIn(errored, names(error_rows))
            self.assertNotIn(stamped, names(error_rows))
            row = next(r for r in error_rows if r["name"] == errored)
            self.assertEqual(row["stamp_error"], "PAC says no")
        else:
            self.assertEqual(
                cfdi.search_cfdi_invoices(self.profile, status="error", limit=50), []
            )

    def test_search_matches_folio_and_customer_name(self):
        invoice = self._make_invoice()
        rows = cfdi.search_cfdi_invoices(self.profile, search=invoice, limit=50)
        self.assertIn(invoice, {r["name"] for r in rows})


class TestCfdiInvoiceDetail(CfdiTestCase):
    def test_detail_prefills_and_preflight_ok(self):
        invoice = self._make_invoice()
        out = cfdi.get_invoice_cfdi(invoice)
        self.assertFalse(out["invoice"]["is_stamped"])
        self.assertEqual(out["customer_fiscal"]["customer"], self.customer)
        self.assertEqual(out["customer_fiscal"]["zip_code"], "06600")
        self.assertFalse(
            out["preflight"]["blocking"],
            msg=f"unexpected blocking checks: {out['preflight']['checks']}",
        )

    def test_detail_preflight_blocks_without_rfc(self):
        bare = frappe.get_doc(
            {
                "doctype": "Customer",
                "customer_name": f"Sin RFC {uid('c')}",
                "customer_group": frappe.db.get_value(
                    "Customer Group", {"is_group": 0}, "name"
                ),
                "territory": "All Territories",
            }
        ).insert(ignore_permissions=True)
        self.track("Customer", bare.name)
        invoice = self._make_invoice(customer=bare.name)
        out = cfdi.get_invoice_cfdi(invoice)
        self.assertTrue(out["preflight"]["blocking"])
        codes = {c["code"] for c in out["preflight"]["checks"] if not c["ok"]}
        self.assertIn("FIS-010", codes)


class TestCfdiStamping(CfdiTestCase):
    def _patched_pac(self):
        fake = _FakePac()
        patcher = mock.patch(
            "erpnext_mexico_compliance.ws_client.FacturapiClient.from_settings",
            return_value=fake,
        )
        self.addCleanup(patcher.stop)
        patcher.start()
        return fake

    def test_stamp_denied_without_membership(self):
        invoice = self._make_invoice()
        outsider = self._make_user(member_of_profile=False)
        frappe.set_user(outsider)
        try:
            with self.assertRaises(frappe.PermissionError):
                cfdi.stamp_invoice(**self._stamp_kwargs(invoice))
        finally:
            frappe.set_user("Administrator")
        self.assertFalse(frappe.db.get_value("Sales Invoice", invoice, "mx_stamped_xml"))

    def test_stamp_denied_when_flag_off(self):
        invoice = self._make_invoice()
        frappe.db.set_value("POS Profile", self.profile, FLAG, 0, update_modified=False)
        frappe.clear_cache(doctype="POS Profile")
        with self.assertRaises(frappe.ValidationError):
            cfdi.stamp_invoice(**self._stamp_kwargs(invoice))

    def test_stamp_rejects_bad_rfc_before_pac(self):
        invoice = self._make_invoice()
        fake = self._patched_pac()
        with self.assertRaises(frappe.ValidationError):
            cfdi.stamp_invoice(
                **self._stamp_kwargs(
                    invoice, customer=None, customer_name="X", tax_id="NOT-AN-RFC",
                    tax_regime="601", zip_code="06600",
                )
            )
        self.assertEqual(fake.create_calls, 0)
        self.assertFalse(frappe.db.get_value("Sales Invoice", invoice, "mx_stamped_xml"))

    def test_stamp_rejects_draft_invoice(self):
        invoice = self._make_invoice(docstatus=0)
        with self.assertRaises(frappe.ValidationError):
            cfdi.stamp_invoice(**self._stamp_kwargs(invoice))

    def test_stamp_happy_path_and_double_tap(self):
        invoice = self._make_invoice()
        fake = self._patched_pac()

        out = cfdi.stamp_invoice(**self._stamp_kwargs(invoice))
        self.assertTrue(out["ok"])
        self.assertFalse(out["already_stamped"])
        self.assertEqual(out["uuid"], fake.uuid)
        self.assertEqual(fake.create_calls, 1)
        self.assertTrue(frappe.db.get_value("Sales Invoice", invoice, "mx_stamped_xml"))
        self.assertEqual(out["files"].get("pdf"), f"{invoice}_CFDI.pdf")
        self.assertEqual(out["files"].get("xml"), f"{invoice}_CFDI.xml")

        again = cfdi.stamp_invoice(**self._stamp_kwargs(invoice))
        self.assertTrue(again["already_stamped"])
        self.assertEqual(again["uuid"], fake.uuid)
        # The dedupe contract: a double-tap must never create a second CFDI.
        self.assertEqual(fake.create_calls, 1)


class TestCfdiCustomer(CfdiTestCase):
    def test_check_rfc_invalid_and_valid(self):
        bad = cfdi_customer.check_customer_rfc("NOT-AN-RFC")
        self.assertFalse(bad["valid"])
        self.assertTrue(bad["issues"])

        good = cfdi_customer.check_customer_rfc(make_rfc("SAT970701"))
        self.assertTrue(good["valid"])
        self.assertEqual(good["kind"], "PM")

    def test_check_rfc_reports_existing_owner(self):
        rfc = frappe.db.get_value("Customer", self.customer, "tax_id")
        out = cfdi_customer.check_customer_rfc(rfc)
        self.assertIsNotNone(out["existing"])
        self.assertEqual(out["existing"]["customer"], self.customer)
        # The owner itself is excluded in edit flows.
        self_check = cfdi_customer.check_customer_rfc(rfc, customer=self.customer)
        self.assertIsNone(self_check["existing"])

    def test_check_rfc_generic_never_collides(self):
        out = cfdi_customer.check_customer_rfc("XAXX010101000")
        self.assertTrue(out["is_generic"])
        self.assertIsNone(out["existing"])

    def test_save_customer_fiscal_create_update_and_zip(self):
        name = f"Fiscal Nuevo {uid('c')}"
        created = cfdi_customer.save_customer_fiscal(
            pos_profile=self.profile,
            customer_name=name,
            tax_id=make_rfc("SAT970701"),
            tax_regime="601",
            mx_cfdi_use="G03",
            zip_code="06600",
            mobile_no="5511111111",
        )
        self.track("Customer", created["customer"])
        self.assertEqual(created["mx_tax_regime"], "601")
        self.assertEqual(created["zip_code"], "06600")
        self.assertTrue(created["billing_address"])
        self.track("Address", created["billing_address"])

        updated = cfdi_customer.save_customer_fiscal(
            pos_profile=self.profile,
            customer=created["customer"],
            mobile_no="5522222222",
        )
        self.assertEqual(updated["mobile_no"], "5522222222")
        self.assertEqual(updated["tax_id"], created["tax_id"])

    def test_save_customer_fiscal_rejects_bad_rfc(self):
        with self.assertRaises(frappe.ValidationError):
            cfdi_customer.save_customer_fiscal(
                pos_profile=self.profile,
                customer_name=f"Malo {uid('c')}",
                tax_id="NOT-AN-RFC",
                tax_regime="601",
            )

    def test_save_customer_fiscal_duplicate_rfc_throws(self):
        rfc = frappe.db.get_value("Customer", self.customer, "tax_id")
        with self.assertRaises(frappe.ValidationError):
            cfdi_customer.save_customer_fiscal(
                pos_profile=self.profile,
                customer_name=f"Duplicado {uid('c')}",
                tax_id=rfc,
                tax_regime="601",
            )

    def test_save_customer_fiscal_scope_denied(self):
        outsider = self._make_user(member_of_profile=False)
        frappe.set_user(outsider)
        try:
            with self.assertRaises(frappe.PermissionError):
                cfdi_customer.save_customer_fiscal(
                    pos_profile=self.profile, customer_name="X",
                )
        finally:
            frappe.set_user("Administrator")
