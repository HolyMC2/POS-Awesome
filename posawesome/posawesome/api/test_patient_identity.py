"""Family payer regression: an explicit appointment Patient is authoritative."""

import unittest
from unittest.mock import patch

import frappe
from posawesome.posawesome.api.invoice import set_patient


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
        with patch("posawesome.posawesome.api.invoice.get_company_domain", return_value="Healthcare"), \
                patch.object(frappe, "get_all", return_value=[frappe._dict(name="CHILD-1"), frappe._dict(name="CHILD-2")]) as query:
            set_patient(invoice)
        self.assertIsNone(invoice.patient)
        self.assertEqual(query.call_args.kwargs["page_length"], 2)

    def test_single_patient_customer_retains_legacy_autofill(self):
        invoice = frappe._dict(patient=None, customer="SOLO", company="CLINIC")
        with patch("posawesome.posawesome.api.invoice.get_company_domain", return_value="Healthcare"), \
                patch.object(frappe, "get_all", return_value=[frappe._dict(name="ONLY-PATIENT")]):
            set_patient(invoice)
        self.assertEqual(invoice.patient, "ONLY-PATIENT")
