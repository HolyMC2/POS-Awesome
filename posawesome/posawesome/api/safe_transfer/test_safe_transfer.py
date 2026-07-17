import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

try:
    from posawesome.posawesome.api.cash_movement import posting
    from posawesome.posawesome.api.safe_transfer import service
    from posawesome.posawesome.doctype.pos_safe_transfer import pos_safe_transfer
except ImportError:
    raise unittest.SkipTest("bench-only test module - requires frappe") from None


def _profile(**overrides):
    base = {
        "name": "POS-PROFILE-1",
        "company": "My Co",
        "posa_back_office_cash_account": "Safe - MC",
        "posa_bank_deposit_account": "Bank - MC",
        "posa_enable_safe_transfer": 1,
        "posa_safe_transfer_max_amount": 0,
    }
    base.update(overrides)
    d = dict(base)

    class P(dict):
        def __getattr__(self, k):
            return self.get(k)

    return P(d)


class TestSafeTransferService(unittest.TestCase):
    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=False)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_requires_manager(self, mock_frappe, _is_mgr):
        mock_frappe.throw.side_effect = Exception("perm")
        with self.assertRaises(Exception):
            service.create_safe_transfer({"pos_profile": "POS-PROFILE-1", "amount": 10})
        mock_frappe.throw.assert_called()

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_feature_gate_off_throws(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.return_value = _profile(posa_enable_safe_transfer=0)
        mock_frappe.throw.side_effect = Exception("gated")
        with self.assertRaises(Exception):
            service.create_safe_transfer({"pos_profile": "POS-PROFILE-1", "amount": 10})

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_missing_bank_account_throws(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.return_value = _profile(posa_bank_deposit_account=None)
        mock_frappe.throw.side_effect = Exception("no bank")
        with self.assertRaises(Exception):
            service.create_safe_transfer({"pos_profile": "POS-PROFILE-1", "amount": 10})

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_amount_zero_throws(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.return_value = _profile()
        mock_frappe.throw.side_effect = Exception("amount")
        with self.assertRaises(Exception):
            service.create_safe_transfer({"pos_profile": "POS-PROFILE-1", "amount": 0})

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_max_amount_guard(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.return_value = _profile(posa_safe_transfer_max_amount=100)
        mock_frappe.throw.side_effect = Exception("max")
        with self.assertRaises(Exception):
            service.create_safe_transfer({"pos_profile": "POS-PROFILE-1", "amount": 500})

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_idempotent_on_client_request_id(self, mock_frappe, _is_mgr):
        existing = SimpleNamespace(as_dict=lambda: {"name": "POS-ST-.26.-00001"})
        # First db.get_value returns the profile, second the existing dup.
        mock_frappe.db.get_value.side_effect = [_profile(), "POS-ST-.26.-00001"]
        mock_frappe.get_doc.return_value = existing
        out = service.create_safe_transfer(
            {"pos_profile": "POS-PROFILE-1", "amount": 10, "client_request_id": "req-1"}
        )
        self.assertEqual(out["name"], "POS-ST-.26.-00001")
        mock_frappe.get_doc.assert_called_once_with("POS Safe Transfer", "POS-ST-.26.-00001")

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_create_locks_inserts_submits_and_releases(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.side_effect = [_profile(), None]
        mock_frappe.db.sql.side_effect = [((1,),), ((1,),)]  # GET_LOCK ok, RELEASE
        doc = MagicMock()
        doc.as_dict.return_value = {"name": "POS-ST-.26.-00002"}
        mock_frappe.get_doc.return_value = doc
        mock_frappe.session.user = "manager@example.com"

        out = service.create_safe_transfer(
            {"pos_profile": "POS-PROFILE-1", "amount": 10, "client_request_id": "req-2"}
        )

        self.assertEqual(out["name"], "POS-ST-.26.-00002")
        doc.insert.assert_called_once()
        doc.submit.assert_called_once()
        mock_frappe.db.commit.assert_called_once()
        release_calls = [c for c in mock_frappe.db.sql.call_args_list if "RELEASE_LOCK" in str(c)]
        self.assertTrue(release_calls, "RELEASE_LOCK must always run")

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_lock_busy_throws(self, mock_frappe, _is_mgr):
        mock_frappe.db.get_value.side_effect = [_profile(), None]
        mock_frappe.db.sql.return_value = ((0,),)  # lock held elsewhere
        mock_frappe.throw.side_effect = Exception("busy")
        with self.assertRaises(Exception):
            service.create_safe_transfer(
                {"pos_profile": "POS-PROFILE-1", "amount": 10, "client_request_id": "req-3"}
            )

    @patch("posawesome.posawesome.api.safe_transfer.service.is_manager", return_value=True)
    @patch("posawesome.posawesome.api.safe_transfer.service.frappe")
    def test_set_deposit_reference_no_gl(self, mock_frappe, _is_mgr):
        doc = MagicMock()
        doc.docstatus = 1
        doc.name = "POS-ST-.26.-00004"
        doc.deposit_reference = "F-123"
        doc.deposited_on = None
        mock_frappe.get_doc.return_value = doc
        out = service.set_deposit_reference("POS-ST-.26.-00004", "F-123")
        doc.db_set.assert_any_call("deposit_reference", "F-123")
        doc.submit.assert_not_called()
        doc.cancel.assert_not_called()
        self.assertEqual(out["name"], "POS-ST-.26.-00004")


class TestSafeTransferController(unittest.TestCase):
    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.get_safe_gl_balance", return_value=50)
    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.frappe")
    def test_anti_overdraw(self, mock_frappe, _bal):
        mock_frappe.throw.side_effect = Exception("overdraw")
        doc = pos_safe_transfer.POSSafeTransfer.__new__(pos_safe_transfer.POSSafeTransfer)
        doc.amount = 100
        doc.docstatus = 0
        doc.source_account = "Safe - MC"
        doc.company = "My Co"
        with self.assertRaises(Exception):
            doc._validate_amount()
        mock_frappe.throw.assert_called()

    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.get_safe_gl_balance", return_value=500)
    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.frappe")
    def test_amount_within_balance_passes(self, mock_frappe, _bal):
        doc = pos_safe_transfer.POSSafeTransfer.__new__(pos_safe_transfer.POSSafeTransfer)
        doc.amount = 100
        doc.docstatus = 0
        doc.source_account = "Safe - MC"
        doc.company = "My Co"
        doc._validate_amount()
        mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.frappe")
    def test_account_type_validation(self, mock_frappe):
        doc = pos_safe_transfer.POSSafeTransfer.__new__(pos_safe_transfer.POSSafeTransfer)
        doc.source_account = "Safe - MC"
        doc.target_account = "NotABank - MC"
        doc.company = "My Co"
        doc.pos_profile = "POS-PROFILE-1"

        def get_value(doctype, name, fields, as_dict=1):
            if doctype == "POS Profile":
                return SimpleNamespace(
                    company="My Co", posa_back_office_cash_account="Safe - MC"
                )
            if name == "Safe - MC":
                return SimpleNamespace(company="My Co", account_type="Cash", is_group=0)
            return SimpleNamespace(company="My Co", account_type="Receivable", is_group=0)

        mock_frappe.db.get_value.side_effect = get_value
        mock_frappe.throw.side_effect = Exception("type")
        with self.assertRaises(Exception):
            doc._validate_accounts()

    @patch("posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer.frappe")
    def test_source_must_match_profile_safe(self, mock_frappe):
        doc = pos_safe_transfer.POSSafeTransfer.__new__(pos_safe_transfer.POSSafeTransfer)
        doc.source_account = "OtherCash - MC"
        doc.target_account = "Bank - MC"
        doc.company = "My Co"
        doc.pos_profile = "POS-PROFILE-1"
        mock_frappe.db.get_value.return_value = SimpleNamespace(
            company="My Co", posa_back_office_cash_account="Safe - MC"
        )
        mock_frappe.throw.side_effect = Exception("wrong source")
        with self.assertRaises(Exception):
            doc._validate_accounts()


class TestPostingAcceptsTransfer(unittest.TestCase):
    @patch("posawesome.posawesome.api.cash_movement.posting.frappe")
    def test_transfer_movement_type_accepted(self, mock_frappe):
        je = MagicMock()
        je.name = "JE-0001"
        mock_frappe.new_doc.return_value = je
        mock_frappe.get_cached_value.return_value = "Main - MC"
        out = posting.create_journal_entry(
            company="My Co",
            posting_date="2026-07-17",
            movement_type="Transfer",
            amount=100,
            source_account="Safe - MC",
            target_account="Bank - MC",
        )
        self.assertEqual(out, "JE-0001")
        je.submit.assert_called_once()

    @patch("posawesome.posawesome.api.cash_movement.posting.frappe")
    def test_unknown_movement_type_rejected(self, mock_frappe):
        mock_frappe.throw.side_effect = Exception("invalid")
        with self.assertRaises(Exception):
            posting.create_journal_entry(
                company="My Co",
                posting_date="2026-07-17",
                movement_type="Robbery",
                amount=100,
                source_account="A",
                target_account="B",
            )


class TestClosingMathIsolation(unittest.TestCase):
    def test_closing_creation_never_reads_safe_transfers(self):
        """Regression guard: expected-cash math must stay blind to POS Safe
        Transfer — a safe→bank movement outside a shift must not disturb any
        shift's reconciliation."""
        import inspect

        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import (
            creation,
            overview,
        )

        for mod in (creation, overview):
            src = inspect.getsource(mod)
            self.assertNotIn("POS Safe Transfer", src)
