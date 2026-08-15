import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

# Importing the real api package pulls frappe transitively (api/__init__).
# Skip the module when discovered by the standalone stub-suite runner
# (python3 -m unittest discover), where frappe is not importable; under
# bench the import succeeds and the tests run with mock.patch as usual.
try:
    from posawesome.posawesome.api.cash_movement import flow, queries, service, validation
except ImportError:
    raise unittest.SkipTest("bench-only test module - requires frappe") from None


class TestCashMovementValidation(unittest.TestCase):
    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_duplicate_client_request_returns_existing_doc(self, mock_frappe):
        existing_doc = SimpleNamespace(name="POS-CM-.26.-00001")
        mock_frappe.db.get_value.return_value = existing_doc.name
        mock_frappe.get_doc.return_value = existing_doc

        result = validation.ensure_no_duplicate_client_request("dup-1")

        self.assertEqual(result, existing_doc)
        mock_frappe.db.get_value.assert_called_once_with(
            "POS Cash Movement",
            {"client_request_id": "dup-1"},
            "name",
        )
        mock_frappe.get_doc.assert_called_once_with("POS Cash Movement", existing_doc.name)

    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_validate_account_company_rejects_missing_account(self, mock_frappe):
        mock_frappe.db.exists.return_value = False
        mock_frappe.throw.side_effect = Exception("invalid")

        with self.assertRaises(Exception):
            validation.validate_account_company("UNKNOWN", "My Co", "Target account")

        mock_frappe.throw.assert_called_once()

    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_validate_account_company_rejects_mismatched_company(self, mock_frappe):
        mock_frappe.db.exists.return_value = True
        mock_frappe.db.get_value.return_value = "Other Co"
        mock_frappe.throw.side_effect = Exception("mismatch")

        with self.assertRaises(Exception):
            validation.validate_account_company("ACC-1", "My Co", "Target account")

        mock_frappe.throw.assert_called_once()


class TestCashMovementService(unittest.TestCase):
    @patch("posawesome.posawesome.api.cash_movement.service.parse_payload")
    @patch("posawesome.posawesome.api.cash_movement.service.get_opening_shift")
    @patch("posawesome.posawesome.api.cash_movement.service.get_pos_profile")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_company_consistency")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_feature_enabled")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_movement_allowed")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_amount")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_remarks")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_no_duplicate_client_request")
    @patch("posawesome.posawesome.api.cash_movement.service.resolve_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.service.resolve_target_account")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_account_company")
    @patch("posawesome.posawesome.api.cash_movement.service.frappe")
    def test_create_cash_movement_returns_existing_when_client_request_replayed(
        self,
        mock_frappe,
        mock_validate_account_company,
        mock_resolve_target_account,
        mock_resolve_source_cash_account,
        mock_ensure_no_duplicate_client_request,
        mock_validate_remarks,
        mock_validate_amount,
        mock_ensure_movement_allowed,
        mock_ensure_feature_enabled,
        mock_validate_company_consistency,
        mock_get_pos_profile,
        mock_get_opening_shift,
        mock_parse_payload,
    ):
        opening_shift = SimpleNamespace(name="POS-OPEN-1", pos_profile="POS-PROFILE-1")
        profile_doc = SimpleNamespace(name="POS-PROFILE-1", company="My Co", get=lambda _k: None)
        existing = SimpleNamespace(as_dict=lambda: {"name": "POS-CM-.26.-00002"})

        mock_parse_payload.return_value = {"pos_opening_shift": "POS-OPEN-1", "client_request_id": "req-1"}
        mock_get_opening_shift.return_value = opening_shift
        mock_get_pos_profile.return_value = profile_doc
        mock_validate_amount.return_value = 100
        mock_ensure_no_duplicate_client_request.return_value = existing
        mock_frappe.session.user = "cashier@example.com"

        result = service._create_cash_movement({"x": 1}, "Expense")

        self.assertEqual(result, {"name": "POS-CM-.26.-00002"})
        # JE creation now lives in POSCashMovement.on_submit; the replay path
        # returns the existing movement before any doc is constructed, so the
        # account-resolution helpers below are the not-called signal.
        mock_resolve_source_cash_account.assert_not_called()
        mock_resolve_target_account.assert_not_called()
        mock_validate_account_company.assert_not_called()

    @patch("posawesome.posawesome.api.cash_movement.service.parse_payload")
    @patch("posawesome.posawesome.api.cash_movement.service.get_opening_shift")
    @patch("posawesome.posawesome.api.cash_movement.service.get_pos_profile")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_company_consistency")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_feature_enabled")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_movement_allowed")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_amount")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_remarks")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_no_duplicate_client_request")
    @patch("posawesome.posawesome.api.cash_movement.service.resolve_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.service.resolve_back_office_account")
    @patch("posawesome.posawesome.api.cash_movement.service.resolve_target_account")
    @patch("posawesome.posawesome.api.cash_movement.service.validate_account_company")
    @patch("posawesome.posawesome.api.cash_movement.service.frappe")
    def test_create_cash_in_stores_back_office_to_drawer_flow(
        self,
        mock_frappe,
        mock_validate_account_company,
        mock_resolve_target_account,
        mock_resolve_back_office_account,
        mock_resolve_source_cash_account,
        mock_ensure_no_duplicate_client_request,
        mock_validate_remarks,
        mock_validate_amount,
        mock_ensure_movement_allowed,
        mock_ensure_feature_enabled,
        mock_validate_company_consistency,
        mock_get_pos_profile,
        mock_get_opening_shift,
        mock_parse_payload,
    ):
        opening_shift = SimpleNamespace(name="POS-OPEN-1", pos_profile="POS-PROFILE-1")
        profile_doc = SimpleNamespace(name="POS-PROFILE-1", company="My Co", get=lambda _k: None)

        mock_parse_payload.return_value = {"pos_opening_shift": "POS-OPEN-1"}
        mock_get_opening_shift.return_value = opening_shift
        mock_get_pos_profile.return_value = profile_doc
        mock_validate_amount.return_value = 900
        mock_ensure_no_duplicate_client_request.return_value = None
        mock_resolve_source_cash_account.return_value = "POS Cash - MC"
        mock_resolve_back_office_account.return_value = "Caja Fuerte - MC"
        mock_frappe.session.user = "cashier@example.com"
        movement_doc = MagicMock()
        movement_doc.as_dict.return_value = {"name": "POS-CM-.26.-00042"}
        mock_frappe.get_doc.return_value = movement_doc

        result = service._create_cash_movement({"x": 1}, "Cash In")

        self.assertEqual(result, {"name": "POS-CM-.26.-00042"})
        # Document stores flow direction: back-office (source) -> drawer (target).
        (created_dict,), _ = mock_frappe.get_doc.call_args
        self.assertEqual(created_dict["movement_type"], "Cash In")
        self.assertEqual(created_dict["source_account"], "Caja Fuerte - MC")
        self.assertEqual(created_dict["target_account"], "POS Cash - MC")
        self.assertIsNone(created_dict["expense_account"])
        # Deposit/Expense resolver must not run for Cash In.
        mock_resolve_target_account.assert_not_called()
        mock_validate_account_company.assert_any_call("Caja Fuerte - MC", "My Co", "Source account")
        mock_validate_account_company.assert_any_call("POS Cash - MC", "My Co", "Target account")

    @patch("posawesome.posawesome.api.cash_movement.service._create_cash_movement")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_owner_or_manager")
    @patch("posawesome.posawesome.api.cash_movement.service.frappe")
    def test_duplicate_cash_in_maps_flow_back_to_role_payload(
        self,
        mock_frappe,
        mock_ensure_owner_or_manager,
        mock_create_cash_movement,
    ):
        source_doc = SimpleNamespace(
            docstatus=1,
            pos_profile="POS-PROFILE-1",
            pos_opening_shift="POS-OPEN-1",
            amount=900,
            against_name="cambio",
            source_account="Caja Fuerte - MC",
            remarks="cambio para ventas",
            movement_type="Cash In",
            expense_account=None,
            target_account="POS Cash - MC",
        )
        source_doc.get = lambda key, default=None: getattr(source_doc, key, default)
        mock_frappe.get_doc.return_value = source_doc
        mock_create_cash_movement.return_value = {"name": "POS-CM-.26.-00043"}

        result = service.duplicate_cash_movement("POS-CM-.26.-00042")

        self.assertEqual(result, {"name": "POS-CM-.26.-00043"})
        (payload, movement_type), _ = mock_create_cash_movement.call_args
        self.assertEqual(movement_type, "Cash In")
        # Role-based payload: source_account key = drawer, target_account key = back office.
        self.assertEqual(payload["source_account"], "POS Cash - MC")
        self.assertEqual(payload["target_account"], "Caja Fuerte - MC")
        self.assertNotIn("expense_account", payload)

    @patch("posawesome.posawesome.api.cash_movement.service._create_cash_movement")
    @patch("posawesome.posawesome.api.cash_movement.service.ensure_owner_or_manager")
    @patch("posawesome.posawesome.api.cash_movement.service.frappe")
    def test_duplicate_cash_movement_supports_posting_date(
        self,
        mock_frappe,
        mock_ensure_owner_or_manager,
        mock_create_cash_movement,
    ):
        source_doc = SimpleNamespace(
            docstatus=2,
            pos_profile="POS-PROFILE-1",
            pos_opening_shift="POS-OPEN-1",
            amount=250,
            against_name="Walk-in Customer",
            source_account="POS Cash - MC",
            remarks="Re-enter cancelled move",
            movement_type="Expense",
            expense_account="Expenses - MC",
            target_account="Expenses - MC",
        )
        source_doc.get = lambda key, default=None: getattr(source_doc, key, default)
        mock_frappe.get_doc.return_value = source_doc
        mock_create_cash_movement.return_value = {"name": "POS-CM-.26.-00009"}

        result = service.duplicate_cash_movement("POS-CM-.26.-00001", posting_date="2026-02-17")

        self.assertEqual(result, {"name": "POS-CM-.26.-00009"})
        mock_ensure_owner_or_manager.assert_called_once_with(source_doc)
        mock_create_cash_movement.assert_called_once_with(
            {
                "pos_profile": "POS-PROFILE-1",
                "pos_opening_shift": "POS-OPEN-1",
                "amount": 250,
                "against_name": "Walk-in Customer",
                "source_account": "POS Cash - MC",
                "remarks": "Re-enter cancelled move",
                "expense_account": "Expenses - MC",
                "posting_date": "2026-02-17",
            },
            "Expense",
        )


class TestDrawerDelta(unittest.TestCase):
    def test_expense_and_deposit_remove_drawer_cash(self):
        self.assertEqual(flow.drawer_delta("Expense", 35), -35)
        self.assertEqual(flow.drawer_delta("Deposit", 15), -15)

    def test_cash_in_adds_drawer_cash(self):
        self.assertEqual(flow.drawer_delta("Cash In", 900), 900)

    def test_sign_of_stored_amount_is_ignored(self):
        self.assertEqual(flow.drawer_delta("Expense", -35), -35)
        self.assertEqual(flow.drawer_delta("Cash In", -900), 900)


class TestCashMovementQueries(unittest.TestCase):
    @patch("posawesome.posawesome.api.cash_movement.queries.frappe.get_all")
    def test_get_shift_movements_maps_status_to_docstatus(self, mock_get_all):
        mock_get_all.return_value = []

        queries.get_shift_movements("POS-OPEN-1", status="cancelled")

        _, kwargs = mock_get_all.call_args
        self.assertEqual(kwargs["filters"]["docstatus"], 2)
        self.assertEqual(kwargs["filters"]["pos_opening_shift"], "POS-OPEN-1")

    @patch("posawesome.posawesome.api.cash_movement.queries.frappe.get_all")
    def test_get_shift_movements_without_status_returns_all_docstatuses(self, mock_get_all):
        mock_get_all.return_value = []

        queries.get_shift_movements("POS-OPEN-1", status="")

        _, kwargs = mock_get_all.call_args
        self.assertNotIn("docstatus", kwargs["filters"])
        self.assertIn("against_name", kwargs["fields"])

    @patch("posawesome.posawesome.api.cash_movement.queries.frappe.get_all")
    def test_get_shift_movements_applies_text_search_or_filters(self, mock_get_all):
        mock_get_all.return_value = []

        queries.get_shift_movements("POS-OPEN-1", search_text="walk")

        _, kwargs = mock_get_all.call_args
        self.assertIn("or_filters", kwargs)
        self.assertTrue(kwargs["or_filters"])
        self.assertFalse(any("posting_date" in row for row in kwargs["or_filters"]))


def _make_profile(allow_override=False, allowed_sources=None):
    fields = {
        "posa_allow_source_account_override": 1 if allow_override else 0,
        "posa_allowed_source_accounts": allowed_sources or [],
    }
    profile = MagicMock()
    profile.get.side_effect = lambda key, default=None: fields.get(key, default)
    return profile


class TestResolveSourceCashAccount(unittest.TestCase):
    """Guard against the regression where the frontend echoes the prefilled
    default source account back and the backend wrongly treats it as an override."""

    @patch("posawesome.posawesome.api.cash_movement.validation._resolve_default_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_echoed_default_source_not_treated_as_override(self, mock_frappe, mock_default):
        mock_default.return_value = "Caja Chica - GD"
        mock_frappe.db.get_value.return_value = "Cash"  # account_type check
        mock_frappe.throw.side_effect = Exception("should not throw")
        profile = _make_profile(allow_override=False)

        # Payload carries the unchanged default (what the form always sends).
        result = validation.resolve_source_cash_account(
            {"source_account": "Caja Chica - GD"}, profile
        )

        self.assertEqual(result, "Caja Chica - GD")
        mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.api.cash_movement.validation._resolve_default_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_divergent_source_rejected_when_override_disabled(self, mock_frappe, mock_default):
        mock_default.return_value = "Caja Chica - GD"
        mock_frappe.db.get_value.return_value = "Cash"
        mock_frappe.throw.side_effect = Exception("override disabled")
        profile = _make_profile(allow_override=False)

        with self.assertRaises(Exception):
            validation.resolve_source_cash_account(
                {"source_account": "Other Cash - GD"}, profile
            )

        mock_frappe.throw.assert_called_once()

    @patch("posawesome.posawesome.api.cash_movement.validation._resolve_default_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_divergent_source_allowed_when_override_enabled(self, mock_frappe, mock_default):
        mock_default.return_value = "Caja Chica - GD"
        mock_frappe.db.get_value.return_value = "Cash"
        mock_frappe.throw.side_effect = Exception("should not throw")
        profile = _make_profile(
            allow_override=True, allowed_sources=[{"account": "Other Cash - GD"}]
        )

        result = validation.resolve_source_cash_account(
            {"source_account": "Other Cash - GD"}, profile
        )

        self.assertEqual(result, "Other Cash - GD")
        mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.api.cash_movement.validation._resolve_default_source_cash_account")
    @patch("posawesome.posawesome.api.cash_movement.validation.frappe")
    def test_empty_selection_falls_back_to_default(self, mock_frappe, mock_default):
        mock_default.return_value = "Caja Chica - GD"
        mock_frappe.db.get_value.return_value = "Cash"
        mock_frappe.throw.side_effect = Exception("should not throw")
        profile = _make_profile(allow_override=False)

        result = validation.resolve_source_cash_account({}, profile)

        self.assertEqual(result, "Caja Chica - GD")
        mock_frappe.throw.assert_not_called()


if __name__ == "__main__":
    unittest.main()
