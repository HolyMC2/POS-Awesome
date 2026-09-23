"""Standalone security/read-only contracts; native SQL is checked on the mirror."""
import datetime
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch


class RegistersTests(unittest.TestCase):
    def setUp(self):
        self.modules = patch.dict(sys.modules)
        self.modules.start()
        self.frappe = types.ModuleType("frappe")
        self.frappe._ = lambda value: value
        self.frappe.whitelist = lambda: lambda fn: fn
        self.frappe.PermissionError = PermissionError
        self.frappe.throw = lambda message, exc=ValueError: (_ for _ in ()).throw(exc(message))
        self.frappe.session = types.SimpleNamespace(user="cashier")
        self.frappe.local = types.SimpleNamespace(site="tenant.test")
        self.frappe.conf = {"encryption_key": "test-key"}
        self.frappe.db = types.SimpleNamespace(sql=Mock())
        self.frappe.get_cached_doc = Mock(return_value={"hide_expected_amount": 0})
        self.frappe.get_cached_value = Mock(return_value="MXN")
        self.frappe.get_doc = Mock(return_value=types.SimpleNamespace(as_dict=lambda: {"name": "OPEN-1"}))
        self.frappe.get_all = Mock(return_value=[])
        sys.modules["frappe"] = self.frappe
        utils = types.ModuleType("frappe.utils")
        utils.cint = lambda value: int(value or 0)
        utils.getdate = lambda value: datetime.date.fromisoformat(str(value)[:10])
        utils.nowdate = lambda: "2026-09-22"
        utils.now_datetime = lambda: datetime.datetime(2026, 9, 22, 12)
        sys.modules["frappe.utils"] = utils
        scope = types.ModuleType("posawesome.posawesome.api._scope")
        scope._is_super = Mock(return_value=False)
        scope.assert_profile = Mock()
        scope.assert_company = Mock()
        sys.modules[scope.__name__] = scope
        invoices = types.ModuleType("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices")
        invoices.is_closing_supervisor = Mock(return_value=False)
        sys.modules[invoices.__name__] = invoices
        creation = types.ModuleType("posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation")
        self.compute = creation.compute_closing_tables = Mock(return_value={"payment_reconciliation": [
            {"mode_of_payment": "Cash", "opening_amount": 100, "expected_amount": 470, "secret": "never"},
        ]})
        creation.make_closing_shift_from_opening = Mock(side_effect=AssertionError("Must not prepare a close"))
        sys.modules[creation.__name__] = creation
        spec = importlib.util.spec_from_file_location("registers_test_target", pathlib.Path(__file__).with_name("registers.py"))
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.row = dict(name="OPEN-1", user="cashier", pos_profile="P", company="C", status="Open",
                        period_start_date="2026-09-21 08:00:00", recovery_pending=0, cashier_name="Cashier",
                        posa_terminal_token_hash="never expose")

    def tearDown(self):
        self.modules.stop()

    def test_guest_cannot_query_or_probe_shifts(self):
        self.frappe.session.user = "Guest"
        for call in (self.api.list_shifts, lambda: self.api.shift_detail("OPEN-1")):
            with self.assertRaises(PermissionError):
                call()
        self.frappe.db.sql.assert_not_called()

    def test_cashier_scope_is_applied_to_counts_pages_and_direct_detail(self):
        self.frappe.db.sql.side_effect = [[{"open": 1, "attention": 1}], [self.row], [self.row]]
        page = self.api.list_shifts(search="cash%_'")
        self.api.shift_detail("OPEN-1")
        for call in self.frappe.db.sql.call_args_list:
            query, params = call.args
            self.assertIn("s.user = %(user)s", query)
            self.assertIn("pu.user = %(user)s", query)
            self.assertIn("p.company = s.company", query)
            self.assertIn("p.disabled = 0", query)
            self.assertEqual(params["user"], "cashier")
            self.assertNotIn("cash%_'", query)
        self.assertTrue(page["shifts"][0]["older_shift"])
        self.assertNotIn("posa_terminal_token_hash", page["shifts"][0])

    def test_manager_does_not_gain_unassigned_profiles(self):
        self.api.is_closing_supervisor.return_value = True
        self.frappe.db.sql.side_effect = [[{"open": 0, "attention": 0}], []]
        self.api.list_shifts()
        for call in self.frappe.db.sql.call_args_list:
            self.assertIn("pu.user = %(user)s", call.args[0])
            self.assertNotIn("s.user = %(user)s", call.args[0])

    def test_missing_and_out_of_scope_detail_denied_before_money_reads(self):
        self.frappe.db.sql.return_value = []
        with self.assertRaises(PermissionError):
            self.api.shift_detail("FOREIGN")
        self.frappe.get_cached_doc.assert_not_called()
        self.compute.assert_not_called()

    def test_blind_policy_withholds_all_money_even_for_supervisor(self):
        self.api.is_closing_supervisor.return_value = True
        self.frappe.db.sql.return_value = [self.row]
        self.frappe.get_cached_doc.return_value = {"hide_expected_amount": "1"}
        detail = self.api.shift_detail("OPEN-1")
        self.assertTrue(detail["amounts_hidden"])
        self.assertEqual(detail["tenders"], [])
        self.assertEqual(detail["movements"], [])
        self.compute.assert_not_called()
        self.frappe.get_all.assert_not_called()

    def test_detail_uses_canonical_reader_without_lock_or_closing_builder(self):
        self.frappe.db.sql.return_value = [self.row]
        detail = self.api.shift_detail("OPEN-1")
        self.compute.assert_called_once_with({"name": "OPEN-1"}, for_update=False)
        self.assertEqual(detail["tenders"], [{"mode_of_payment": "Cash", "opening_amount": 100, "expected_amount": 470}])
        self.assertEqual(self.frappe.get_all.call_args.kwargs["filters"], {"pos_opening_shift": "OPEN-1", "docstatus": 1})
        self.assertEqual(self.frappe.get_all.call_args.kwargs["page_length"], 20)

    def test_closed_history_is_not_recomputed_as_live_cash(self):
        self.row["status"] = "Closed"
        self.frappe.db.sql.return_value = [self.row]
        self.api.shift_detail("OPEN-1")
        self.compute.assert_not_called()

    def test_signed_cursor_is_bound_to_user_filters_and_expiry(self):
        context = ["cashier", False, "open", ""]
        token = self.api._cursor(self.row, context)
        self.assertEqual(self.api._read_cursor(token, context)["name"], "OPEN-1")
        for invalid, scope in ((token + "x", context), (token, ["other", False, "open", ""]),
                               (token, ["cashier", False, "closed", ""]), ("invalid", context)):
            with self.assertRaises(ValueError):
                self.api._read_cursor(invalid, scope)
        with patch.object(self.api.time, "time", return_value=self.api.time.time() + 3601):
            with self.assertRaises(ValueError):
                self.api._read_cursor(token, context)

    def test_page_limit_keyset_and_stable_tie_breaker(self):
        self.frappe.db.sql.side_effect = [[{"open": 2, "attention": 2}], [self.row, dict(self.row, name="OPEN-0")],
                                        [{"open": 2, "attention": 2}], []]
        first = self.api.list_shifts(page_length=1)
        self.assertEqual(len(first["shifts"]), 1)
        self.api.list_shifts(cursor=first["next_cursor"], page_length=9999)
        query, args = self.frappe.db.sql.call_args.args
        self.assertEqual(args["limit"], 51)
        self.assertEqual(args["after_name"], "OPEN-1")
        self.assertIn("s.name < %(after_name)s", query)
        self.assertIn("s.period_start_date DESC, s.name DESC", query)


if __name__ == "__main__":
    unittest.main()
