"""Family payer identity, exercised both without a bench and with real Frappe.

The standalone lane reuses the invoice cancellation fixture's import stubs;
the actual invoice module and all four identity assertions run in both lanes.
An installed framework's missing dependency remains an import failure.
"""

from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch

try:
    import frappe
except ModuleNotFoundError as error:
    if error.name != "frappe":
        raise
    fixture = runpy.run_path(str(Path(__file__).with_name("test_invoice_cancel_hooks.py")))
    fixture["_install_invoice_api_stubs"]()
    frappe = sys.modules["frappe"]

    class _Dict(dict):
        __getattr__ = dict.get
        __setattr__ = dict.__setitem__

    class _ValidationError(Exception):
        pass

    def _throw(message):
        raise _ValidationError(message)

    frappe._dict = _Dict
    frappe.ValidationError = _ValidationError
    frappe.throw = _throw
    fixture["_load_invoice_api_module"]()

from posawesome.posawesome.api.invoice import set_patient

invoice_api = sys.modules["posawesome.posawesome.api.invoice"]


class TestInvoicePatientIdentity(unittest.TestCase):
    def test_explicit_second_patient_is_preserved_for_shared_customer(self):
        invoice = frappe._dict(patient="CHILD-2", customer="GUARDIAN", company="CLINIC")
        with patch.object(frappe.db, "get_value", return_value="GUARDIAN"), \
                patch.object(frappe, "get_all") as patients:
            set_patient(invoice)
        self.assertEqual(invoice.patient, "CHILD-2")
        patients.assert_not_called()

    def test_wrong_patient_payer_is_rejected(self):
        invoice = frappe._dict(patient="CHILD-2", customer="OTHER", company="CLINIC")
        with patch.object(frappe.db, "get_value", return_value="GUARDIAN"), \
                self.assertRaises(frappe.ValidationError):
            set_patient(invoice)

    def test_shared_customer_does_not_select_first_patient(self):
        invoice = frappe._dict(patient=None, customer="GUARDIAN", company="CLINIC")
        with patch.object(invoice_api, "get_company_domain", return_value="Healthcare"), \
                patch.object(frappe, "get_all", return_value=[frappe._dict(name="CHILD-1"), frappe._dict(name="CHILD-2")]) as query:
            set_patient(invoice)
        self.assertIsNone(invoice.patient)
        self.assertEqual(query.call_args.kwargs["page_length"], 2)

    def test_single_patient_customer_retains_legacy_autofill(self):
        invoice = frappe._dict(patient=None, customer="SOLO", company="CLINIC")
        with patch.object(invoice_api, "get_company_domain", return_value="Healthcare"), \
                patch.object(frappe, "get_all", return_value=[frappe._dict(name="ONLY-PATIENT")]):
            set_patient(invoice)
        self.assertEqual(invoice.patient, "ONLY-PATIENT")


if __name__ == "__main__":
    unittest.main()
