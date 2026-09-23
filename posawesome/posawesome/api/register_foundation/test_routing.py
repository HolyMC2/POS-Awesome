"""Drawer routing hooks against a stub Frappe (native proof: native_drill.py)."""
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent


class Doc(dict):
    __getattr__ = dict.get

    def __setattr__(self, key, value):
        self[key] = value


def load(snapshot):
    frappe = types.ModuleType("frappe")
    frappe.local = types.SimpleNamespace()
    frappe.ValidationError = type("ValidationError", (Exception,), {})
    frappe.PermissionError = type("PermissionError", (Exception,), {})
    frappe._ = lambda text: text

    def throw(message, exc=None, title=None):
        raise (exc or frappe.ValidationError)(message)

    frappe.throw = throw
    frappe.local.response = {}
    frappe.db = types.SimpleNamespace(has_column=lambda *a: True,
                                      get_value=lambda dt, name, field: json.dumps(snapshot) if snapshot and name == "SHIFT" else None)
    utils = types.ModuleType("frappe.utils")
    utils.flt = lambda value, precision=None: float(value or 0)
    frappe.utils = utils
    package = types.ModuleType("posawesome.posawesome.api.register_foundation")
    package.__path__ = [str(HERE)]
    modules = {"frappe": frappe, "frappe.utils": utils, package.__name__: package}
    patcher = patch.dict(sys.modules, modules)
    patcher.start()
    for name in ("model", "errors", "routing"):
        spec = importlib.util.spec_from_file_location(f"{package.__name__}.{name}", HERE / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return sys.modules[f"{package.__name__}.routing"], frappe, patcher


CASH = {"mode": "Cash", "company": "C", "drawer_account": "Caja 1 - C", "cash_modes": ["Cash"], "currency": "MXN"}


class InvoiceRoute(unittest.TestCase):
    def tearDown(self):
        self.patcher.stop()

    def test_cash_rows_and_change_account_follow_the_stamped_drawer(self):
        routing, _frappe, self.patcher = load(CASH)
        doc = Doc(posa_pos_opening_shift="SHIFT", company="C", change_amount=5, account_for_change_amount="Shared - C",
                  payments=[Doc(mode_of_payment="Cash", amount=105, account="Shared - C"),
                            Doc(mode_of_payment="Saldo proveedores", amount=3, account="Saldo - C"),
                            Doc(mode_of_payment="Credit Card", amount=10, account="Bank - C")])
        routing.apply_invoice_route(doc)
        self.assertEqual([p.account for p in doc.payments], ["Caja 1 - C", "Saldo - C", "Bank - C"])
        self.assertEqual(doc.account_for_change_amount, "Caja 1 - C")

    def test_legacy_shift_is_untouched(self):
        routing, _frappe, self.patcher = load(None)
        doc = Doc(posa_pos_opening_shift="SHIFT", company="C", payments=[Doc(mode_of_payment="Cash", amount=1, account="Shared - C")])
        routing.apply_invoice_route(doc)
        self.assertEqual(doc.payments[0].account, "Shared - C")

    def test_company_mismatch_is_scope_denied(self):
        routing, frappe, self.patcher = load(CASH)
        with self.assertRaises(frappe.PermissionError):
            routing.apply_invoice_route(Doc(posa_pos_opening_shift="SHIFT", company="Other", payments=[]))
        self.assertEqual(frappe.local.response["posa_error"]["code"], "scope_denied")

    def test_cashless_refuses_cash_rows_and_change(self):
        routing, frappe, self.patcher = load(dict(CASH, mode="Cashless", drawer_account=None))
        with self.assertRaises(frappe.ValidationError):
            routing.apply_invoice_route(Doc(posa_pos_opening_shift="SHIFT", company="C",
                                            payments=[Doc(mode_of_payment="Cash", amount=1)]))
        with self.assertRaises(frappe.ValidationError):
            routing.apply_invoice_route(Doc(posa_pos_opening_shift="SHIFT", company="C", change_amount=2, payments=[]))
        doc = Doc(posa_pos_opening_shift="SHIFT", company="C", payments=[Doc(mode_of_payment="Cash", amount=0)])
        routing.apply_invoice_route(doc)  # zero-cash placeholder rows are harmless


class PaymentEntryAndMovementRoute(unittest.TestCase):
    def tearDown(self):
        self.patcher.stop()

    def test_receive_and_pay_use_the_drawer_side(self):
        routing, _frappe, self.patcher = load(CASH)
        receive = Doc(reference_no="SHIFT", company="C", mode_of_payment="Cash", payment_type="Receive",
                      paid_to="Shared - C", paid_amount=30)
        routing.apply_payment_entry_route(receive)
        self.assertEqual(receive.paid_to, "Caja 1 - C")
        pay = Doc(reference_no="SHIFT", company="C", mode_of_payment="Cash", payment_type="Pay",
                  paid_from="Shared - C", paid_amount=30)
        routing.apply_payment_entry_route(pay)
        self.assertEqual(pay.paid_from, "Caja 1 - C")
        card = Doc(reference_no="SHIFT", company="C", mode_of_payment="Credit Card", payment_type="Receive", paid_to="Bank - C")
        routing.apply_payment_entry_route(card)
        self.assertEqual(card.paid_to, "Bank - C")

    def test_movements_cannot_override_the_drawer(self):
        routing, frappe, self.patcher = load(CASH)
        self.assertEqual(routing.movement_drawer({"pos_opening_shift": "SHIFT"}), "Caja 1 - C")
        self.assertEqual(routing.movement_drawer({"pos_opening_shift": "SHIFT", "source_account": "Caja 1 - C"}), "Caja 1 - C")
        with self.assertRaises(frappe.ValidationError):
            routing.movement_drawer({"pos_opening_shift": "SHIFT", "source_account": "Shared - C"})
        self.assertIsNone(routing.movement_drawer({"pos_opening_shift": "LEGACY"}))


if __name__ == "__main__":
    unittest.main()
