"""Rollback-only native controller composition and ordinary opening regressions."""

import unittest
import uuid
from unittest.mock import patch

import frappe


class TestPOSInvoiceComposition(unittest.TestCase):
    def setUp(self):
        if "doco" not in frappe.get_installed_apps():
            self.skipTest("The rollback-only charge fixture requires Doco")
        from doco.docoutils.test_charge_delivery import TestChargeDelivery
        from posawesome.posawesome.api.shifts import create_opening_voucher

        self.fixture = TestChargeDelivery()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        # Native ERP mode is part of this fixture, never a committed tenant change.
        frappe.db.set_single_value("POS Settings", "invoice_type", "POS Invoice")
        self.profile = self.fixture.profile
        self.user = frappe.get_doc(dict(doctype="User", email="pos-mixin-" + uuid.uuid4().hex + "@example.invalid",
            first_name="POS composition cashier", enabled=1, send_welcome_email=0,
            roles=[{"role": role} for role in ("Sales User", "Accounts User", "Stock User")])).insert(ignore_permissions=True)
        self.profile.create_pos_invoice_instead_of_sales_invoice = 1
        self.profile.append("applicable_for_users", {"user": self.user.name, "default": 1})
        self.profile.save(ignore_permissions=True)
        frappe.set_user(self.user.name)
        self.proof = self.fixture.proof
        opening = create_opening_voucher(self.profile.name, self.profile.company,
            frappe.as_json([{"mode_of_payment": row.mode_of_payment, "opening_amount": 0}
                for row in self.profile.payments]), self.proof["terminal_id"], self.proof["terminal_token"])
        self.shift = opening["pos_opening_shift"]["name"]
        self.assertFalse(frappe.db.exists("POS Opening Entry", {"pos_profile": self.profile.name}))

    def prepare(self, **overrides):
        from posawesome.posawesome.api.charge_requests import prepare_charge_request_invoice
        return prepare_charge_request_invoice(self.fixture.request.name, self.profile.name,
            self.shift, **{**self.proof, **overrides})

    def test_installed_controller_keeps_fiscal_methods_and_submits_with_posawesome_opening(self):
        from erpnext.accounts.doctype.pos_invoice.pos_invoice import POSInvoice as NativePOSInvoice
        from posawesome.posawesome.overrides.pos_invoice import POSOpeningShiftMixin

        draft = self.prepare()
        invoice = frappe.get_doc("POS Invoice", draft["name"])
        controller = type(invoice)
        self.assertEqual(controller.__mro__.count(POSOpeningShiftMixin), 1)
        self.assertTrue(issubclass(controller, NativePOSInvoice))
        if "erpnext_mexico_compliance" in frappe.get_installed_apps():
            from erpnext_mexico_compliance.overrides.pos_invoice import POSInvoice as FiscalPOSInvoice
            self.assertIn(FiscalPOSInvoice, controller.__mro__)
            self.assertIs(controller.on_submit, FiscalPOSInvoice.on_submit)
            self.assertIs(controller.is_cfdi_ready, FiscalPOSInvoice.is_cfdi_ready)
        total = invoice.rounded_total or invoice.grand_total
        invoice.payments[0].amount = total
        # Real fiscal/native methods execute; external provider requests are forbidden.
        with patch("requests.sessions.Session.request", side_effect=AssertionError("No provider request permitted")):
            invoice.save()
            invoice.submit()
        self.assertEqual(invoice.docstatus, 1)
        self.assertEqual(invoice.paid_amount, total)
        self.assertEqual(invoice.outstanding_amount, 0)
        self.assertFalse(frappe.db.exists("POS Opening Entry", {"pos_profile": self.profile.name}))
        self.fixture.request.reload()
        self.assertEqual((self.fixture.request.status, self.fixture.request.invoice), ("Charged", invoice.name))
        print("PASS actual POS Invoice MRO", [f"{cls.__module__}.{cls.__name__}" for cls in controller.__mro__[:5]], flush=True)

    def test_wrong_terminal_and_closed_shift_reject_before_invoice_creation(self):
        with self.assertRaises(frappe.PermissionError):
            self.prepare(terminal_token="wrong" * 12)
        frappe.db.set_value("POS Opening Shift", self.shift, "status", "Closed")
        with self.assertRaises(frappe.ValidationError):
            self.prepare()
        self.fixture.request.reload()
        self.assertFalse(self.fixture.request.invoice)

    def test_wrong_profile_or_company_shift_is_rejected_by_composed_controller(self):
        invoice = frappe.get_doc("POS Invoice", self.prepare()["name"])
        for field, value in (("pos_profile", "Different profile"), ("company", "Different company")):
            original = invoice.get(field)
            invoice.set(field, value)
            with self.assertRaises(frappe.ValidationError):
                invoice.validate_pos_opening_entry()
            invoice.set(field, original)

    def test_missing_posawesome_shift_keeps_native_opening_validation(self):
        invoice = frappe.get_doc("POS Invoice", self.prepare()["name"])
        invoice.posa_pos_opening_shift = None
        with self.assertRaises(frappe.ValidationError):
            invoice.validate_pos_opening_entry()
        frappe.set_user("Administrator")
        frappe.get_doc(dict(doctype="POS Opening Entry", pos_profile=self.profile.name,
            company=self.profile.company, user=self.user.name, period_start_date=frappe.utils.now(),
            balance_details=[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0}
                for row in self.profile.payments])).insert(ignore_permissions=True).submit()
        frappe.set_user(self.user.name)
        invoice.validate_pos_opening_entry()

    def test_resolver_composes_native_base_without_a_fiscal_override(self):
        from frappe.model.base_document import import_controller
        from erpnext.accounts.doctype.pos_invoice.pos_invoice import POSInvoice as NativePOSInvoice
        from posawesome.posawesome.overrides.pos_invoice import POSOpeningShiftMixin

        original = frappe.get_hooks
        def without_invoice_override(name, *args, **kwargs):
            result = original(name, *args, **kwargs)
            return {key: value for key, value in result.items() if key != "POS Invoice"} if name == "override_doctype_class" else result
        with patch.object(frappe, "get_hooks", side_effect=without_invoice_override):
            controller = import_controller("POS Invoice")
        self.assertEqual(controller.__bases__, (POSOpeningShiftMixin, NativePOSInvoice))
        controller(self.prepare()).validate_pos_opening_entry()
