import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


class FakeGiftCard:
    def __init__(self, code="GC-0001", balance=0, status="Active"):
        self.doctype = "POS Gift Card"
        self.name = code
        self.gift_card_code = code
        self.company = "Test Company"
        self.currency = "PKR"
        self.current_balance = balance
        self.status = status
        self.transactions = []
        self.flags = types.SimpleNamespace(ignore_permissions=False)
        self.saved = False

    def append(self, fieldname, value):
        target = getattr(self, fieldname)
        row = dict(value)
        target.append(row)
        return row

    def save(self, ignore_permissions=False):
        self.saved = True
        return self


class FakeInvoice:
    def __init__(
        self,
        doctype="Sales Invoice",
        name="ACC-SINV-0001",
        company="Test Company",
        posting_date="2026-04-05",
        pos_profile="Main POS",
        debit_to="1310 - Debtors - TC",
        customer="CUST-0001",
        grand_total=800,
    ):
        self.doctype = doctype
        self.name = name
        self.company = company
        self.posting_date = posting_date
        self.pos_profile = pos_profile
        self.debit_to = debit_to
        self.customer = customer
        self.grand_total = grand_total
        self.rounded_total = grand_total
        self.gift_card_redemptions = []
        self.payments = []
        self.flags = types.SimpleNamespace(ignore_permissions=False)

    def append(self, fieldname, value):
        row = dict(value)
        getattr(self, fieldname).append(row)
        return row

    def save(self, ignore_permissions=False):
        return self


class FakeJournalEntry:
    def __init__(self, payload=None):
        payload = payload or {}
        self.doctype = payload.get("doctype", "Journal Entry")
        self.voucher_type = payload.get("voucher_type", "Journal Entry")
        self.posting_date = payload.get("posting_date")
        self.company = payload.get("company")
        self.user_remark = payload.get("user_remark")
        self.accounts = []
        self.flags = types.SimpleNamespace(ignore_permissions=False)
        self.saved = False
        self.submitted = False

    def append(self, fieldname, value):
        target = getattr(self, fieldname)
        row = dict(value)
        target.append(row)
        return row

    def set_missing_values(self):
        return None

    def save(self, ignore_permissions=False):
        self.saved = True
        return self

    def submit(self):
        self.submitted = True
        return self


class FakeModeOfPayment:
    def __init__(self, name="Gift Card", mode_type="General"):
        self.doctype = "Mode of Payment"
        self.name = name
        self.mode_of_payment = name
        self.type = mode_type
        self.accounts = []
        self.flags = types.SimpleNamespace(ignore_permissions=False)
        self.saved = False

    def append(self, fieldname, value):
        target = getattr(self, fieldname)
        row = dict(value)
        target.append(row)
        return row

    def save(self, ignore_permissions=False):
        self.saved = True
        return self


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils_module = types.ModuleType("frappe.utils")
    employees_module = types.ModuleType("posawesome.posawesome.api.employees")
    utilities_module = types.ModuleType("posawesome.posawesome.api.utilities")

    state = {
        "cards": {},
        "new_docs": [],
        "journal_entries": [],
        "balance_locks": [],
        "mode_of_payments": {},
        "terminal_users": {"Main POS": ["supervisor@example.com", "cashier@example.com"]},
        "user_docs": {
            "supervisor@example.com": types.SimpleNamespace(
                name="supervisor@example.com",
                full_name="Supervisor",
                enabled=1,
                posa_is_pos_supervisor=1,
            ),
            "cashier@example.com": types.SimpleNamespace(
                name="cashier@example.com",
                full_name="Cashier",
                enabled=1,
                posa_is_pos_supervisor=0,
            ),
        },
        "invoices": {"ACC-SINV-0001": FakeInvoice()},
        "pos_profiles": {
            "Main POS": types.SimpleNamespace(
                name="Main POS",
                company="Test Company",
                cost_center="Main - TC",
                posa_use_gift_cards=1,
                posa_default_source_account="1110 - Cash - TC",
                posa_gift_card_liability_account="2190 - Gift Card Liability - TC",
            )
        },
        "companies": {
            "Test Company": types.SimpleNamespace(
                name="Test Company",
                default_cash_account="1110 - Cash - TC",
                cost_center="Main - TC",
            )
        },
    }

    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.generate_hash = lambda: "GCODE12345"
    frappe_module.utils = types.SimpleNamespace(now_datetime=lambda: "2026-04-05 12:00:00")
    frappe_utils_module.nowdate = lambda: "2026-04-05"
    frappe_utils_module.cint = lambda value: int(value or 0)
    # Gift-card default currency falls back to the company currency
    # (P0-3: upstream minted PKR cards on bare calls).
    frappe_module.get_cached_value = (
        lambda doctype, name=None, fieldname=None, *args, **kwargs: (
            "MXN" if doctype == "Company" else None
        )
    )
    frappe_module.session = types.SimpleNamespace(user="administrator@example.com")
    # _scope._is_super consults roles; System Manager bypasses scope asserts
    # so these tests exercise gift-card logic, not scope (test_scope covers that).
    frappe_module.get_roles = lambda user=None: ["System Manager"]

    def _new_doc(doctype):
        if doctype == "POS Gift Card":
            doc = FakeGiftCard(code=f"GC-{len(state['new_docs']) + 1:04d}")
            state["new_docs"].append(doc)
            return doc
        if doctype == "Mode of Payment":
            doc = FakeModeOfPayment()
            state["mode_of_payments"][doc.name] = doc
            state["new_docs"].append(doc)
            return doc
        raise AssertionError(f"Unexpected doctype: {doctype}")

    def _get_doc(doctype, name=None):
        if isinstance(doctype, dict):
            if doctype.get("doctype") == "Journal Entry":
                entry = FakeJournalEntry(doctype)
                state["journal_entries"].append(entry)
                return entry
            raise AssertionError(f"Unexpected dict get_doc doctype: {doctype.get('doctype')}")
        if doctype == "POS Gift Card":
            if name not in state["cards"]:
                raise AssertionError(f"Unknown gift card: {name}")
            return state["cards"][name]
        if doctype == "Mode of Payment":
            if name not in state["mode_of_payments"]:
                raise AssertionError(f"Unknown mode of payment: {name}")
            return state["mode_of_payments"][name]
        if doctype == "User":
            if name not in state["user_docs"]:
                raise AssertionError(f"Unknown user: {name}")
            return state["user_docs"][name]
        if doctype == "Sales Invoice":
            if name not in state["invoices"]:
                raise AssertionError(f"Unknown invoice: {name}")
            return state["invoices"][name]
        raise AssertionError(f"Unexpected get_doc doctype: {doctype}")

    frappe_module.new_doc = _new_doc
    frappe_module.get_doc = _get_doc
    frappe_module.get_cached_doc = lambda doctype, name: (
        state["pos_profiles"][name] if doctype == "POS Profile" else state["companies"][name]
    )
    frappe_module.get_value = lambda doctype, name, fieldname: (
        getattr(state["pos_profiles"][name], fieldname, None)
        if doctype == "POS Profile"
        else getattr(state["companies"][name], fieldname, None)
    )
    frappe_module.flags = types.SimpleNamespace(ignore_account_permission=False)

    def _db_get_value(doctype, name, fieldname, for_update=False):
        if doctype != "POS Gift Card" or fieldname != "current_balance":
            raise AssertionError(f"Unexpected db.get_value: {doctype} {name} {fieldname}")
        if for_update:
            state["balance_locks"].append(name)
        return getattr(state["cards"][name], fieldname)

    frappe_module.db = types.SimpleNamespace(
        exists=lambda doctype, name=None: bool(
            (
                doctype == "POS Gift Card"
                and (
                    (isinstance(name, dict) and name.get("gift_card_code") in state["cards"])
                    or (isinstance(name, str) and name in state["cards"])
                )
            )
            or (doctype == "Mode of Payment" and isinstance(name, str) and name in state["mode_of_payments"])
        ),
        get_value=_db_get_value,
    )

    employees_module._resolve_profile_name = lambda pos_profile=None: str(pos_profile or "").strip()
    employees_module._ensure_terminal_user = lambda profile_name, user: state["terminal_users"].get(
        profile_name, []
    )
    employees_module._get_user_doc = lambda user: state["user_docs"][user]
    employees_module._is_pos_supervisor = lambda user_doc: bool(
        getattr(user_doc, "posa_is_pos_supervisor", 0)
    )
    utilities_module.ensure_child_doctype = lambda *args, **kwargs: None

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils_module
    sys.modules["posawesome.posawesome.api.employees"] = employees_module
    sys.modules["posawesome.posawesome.api.utilities"] = utilities_module
    return state


def _install_package_stubs():
    package_paths = {
        "posawesome": REPO_ROOT / "posawesome",
        "posawesome.posawesome": REPO_ROOT / "posawesome" / "posawesome",
        "posawesome.posawesome.api": REPO_ROOT / "posawesome" / "posawesome" / "api",
    }
    for name, path in package_paths.items():
        module = types.ModuleType(name)
        module.__path__ = [str(path)]
        sys.modules[name] = module


def _load_module():
    module_name = "posawesome.posawesome.api.gift_cards"
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "gift_cards.py"
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: this file fakes `frappe` in sys.modules inside
# setUpClass, which would poison every test that runs after it inside a real
# bench process. Skip under `bench run-tests`; run directly: python3 <file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestGiftCardApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = _install_stubs()
        _install_package_stubs()
        cls.module = _load_module()

    def setUp(self):
        self.state["cards"].clear()
        self.state["new_docs"].clear()
        self.state["journal_entries"].clear()
        self.state["balance_locks"].clear()
        self.state["mode_of_payments"].clear()
        self.module.frappe.session.user = "supervisor@example.com"
        profile_doc = self.state["pos_profiles"]["Main POS"]
        profile_doc.posa_use_gift_cards = 1
        profile_doc.posa_default_source_account = "1110 - Cash - TC"
        profile_doc.posa_gift_card_liability_account = "2190 - Gift Card Liability - TC"
        for invoice_doc in self.state["invoices"].values():
            invoice_doc.gift_card_redemptions = []
            invoice_doc.payments = []

    def test_issue_gift_card_rejects_supervisor_impersonation(self):
        self.module.frappe.session.user = "cashier@example.com"

        with self.assertRaises(Exception) as ctx:
            self.module.issue_gift_card(
                pos_profile="Main POS",
                cashier="supervisor@example.com",
                company="Test Company",
                initial_amount=500,
                gift_card_code="GC-NEW-01",
            )

        self.assertIn("session user", str(ctx.exception))
        self.assertEqual(self.state["new_docs"], [])
        self.assertEqual(self.state["journal_entries"], [])

    def test_top_up_gift_card_rejects_supervisor_impersonation(self):
        existing = FakeGiftCard(code="GC-IMPERSONATE", balance=500, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        self.module.frappe.session.user = "cashier@example.com"

        with self.assertRaises(Exception) as ctx:
            self.module.top_up_gift_card(
                pos_profile="Main POS",
                cashier="supervisor@example.com",
                gift_card_code="GC-IMPERSONATE",
                amount=250,
            )

        self.assertIn("session user", str(ctx.exception))
        self.assertEqual(existing.current_balance, 500)
        self.assertEqual(self.state["journal_entries"], [])

    def test_issue_gift_card_requires_session_user_to_be_supervisor(self):
        self.module.frappe.session.user = "cashier@example.com"

        with self.assertRaises(Exception) as ctx:
            self.module.issue_gift_card(
                pos_profile="Main POS",
                cashier="cashier@example.com",
                company="Test Company",
                initial_amount=500,
                gift_card_code="GC-NEW-02",
            )

        self.assertIn("POS supervisor", str(ctx.exception))

    def test_top_up_updates_balance_and_transaction_history(self):
        existing = FakeGiftCard(code="GC-0001", balance=500, status="Active")
        self.state["cards"][existing.gift_card_code] = existing

        result = self.module.top_up_gift_card(
            pos_profile="Main POS",
            cashier="supervisor@example.com",
            gift_card_code="GC-0001",
            amount=250,
        )

        self.assertEqual(result["gift_card_code"], "GC-0001")
        self.assertEqual(result["current_balance"], 750)
        self.assertEqual(len(existing.transactions), 1)
        self.assertEqual(existing.transactions[0]["transaction_type"], "Top Up")
        self.assertEqual(existing.transactions[0]["amount"], 250)
        self.assertEqual(existing.transactions[0]["balance_after"], 750)
        self.assertEqual(self.state["balance_locks"], ["GC-0001"])
        self.assertEqual(len(self.state["journal_entries"]), 1)
        self.assertTrue(self.state["journal_entries"][0].submitted)
        self.assertEqual(
            self.state["journal_entries"][0].accounts[0]["account"],
            "1110 - Cash - TC",
        )
        self.assertEqual(
            self.state["journal_entries"][0].accounts[1]["account"],
            "2190 - Gift Card Liability - TC",
        )

    def test_apply_invoice_gift_card_redemptions_records_invoice_rows(self):
        existing = FakeGiftCard(code="GC-0002", balance=800, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]

        result = self.module.apply_invoice_gift_card_redemptions(
            invoice_doc,
            [{"gift_card_code": "GC-0002", "amount": 300, "cashier": "cashier@example.com"}],
        )

        self.assertEqual(result, 300)
        self.assertEqual(existing.current_balance, 500)
        # The card's OWN ledger records the redemption. It used to record only
        # issue and top-up, so the panel showed a balance that its own history
        # could not explain (TarjetaRegalo.dc.html, «Movimientos de GC-…»).
        self.assertEqual(len(existing.transactions), 1)
        self.assertEqual(existing.transactions[0]["transaction_type"], "Redeem")
        self.assertEqual(existing.transactions[0]["amount"], -300)
        self.assertEqual(existing.transactions[0]["balance_after"], 500)
        self.assertEqual(existing.transactions[0]["reference_doctype"], "Sales Invoice")
        self.assertEqual(existing.transactions[0]["reference_name"], "ACC-SINV-0001")
        self.assertEqual(existing.transactions[0]["cashier"], "cashier@example.com")
        self.assertEqual(len(self.state["journal_entries"]), 0)
        self.assertEqual(len(invoice_doc.gift_card_redemptions), 1)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["gift_card_code"], "GC-0002")
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["redeemed_amount"], 300)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["balance_before"], 800)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["balance_after"], 500)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["status"], "Applied")
        self.assertEqual(len(invoice_doc.payments), 1)
        self.assertEqual(invoice_doc.payments[0]["account"], "2190 - Gift Card Liability - TC")
        self.assertEqual(invoice_doc.payments[0]["amount"], 300)

    def test_apply_invoice_gift_card_redemptions_skips_validation_when_gift_cards_disabled_and_no_rows(self):
        profile_doc = self.state["pos_profiles"]["Main POS"]
        profile_doc.posa_use_gift_cards = 0
        profile_doc.posa_gift_card_liability_account = ""
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]

        result = self.module.apply_invoice_gift_card_redemptions(invoice_doc, [])

        self.assertEqual(result, 0)
        self.assertEqual(invoice_doc.gift_card_redemptions, [])
        self.assertEqual(invoice_doc.payments, [])

    def test_apply_invoice_gift_card_redemptions_skips_validation_when_enabled_but_no_rows(self):
        profile_doc = self.state["pos_profiles"]["Main POS"]
        profile_doc.posa_use_gift_cards = 1
        profile_doc.posa_gift_card_liability_account = ""
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]

        result = self.module.apply_invoice_gift_card_redemptions(
            invoice_doc,
            [{"gift_card_code": "GC-EMPTY", "amount": 0}],
        )

        self.assertEqual(result, 0)
        self.assertEqual(invoice_doc.gift_card_redemptions, [])
        self.assertEqual(invoice_doc.payments, [])

    def test_apply_invoice_gift_card_redemptions_requires_liability_account_when_redemption_is_attempted(
        self,
    ):
        existing = FakeGiftCard(code="GC-0006", balance=300, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        profile_doc = self.state["pos_profiles"]["Main POS"]
        profile_doc.posa_use_gift_cards = 1
        profile_doc.posa_gift_card_liability_account = ""
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]

        with self.assertRaises(Exception) as ctx:
            self.module.apply_invoice_gift_card_redemptions(
                invoice_doc,
                [{"gift_card_code": "GC-0006", "amount": 100, "cashier": "cashier@example.com"}],
            )

        self.assertIn("gift card liability account", str(ctx.exception))

    def test_restore_invoice_gift_card_redemptions_restores_balance(self):
        existing = FakeGiftCard(code="GC-0002", balance=500, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]
        invoice_doc.gift_card_redemptions = [
            {
                "gift_card_code": "GC-0002",
                "redeemed_amount": 300,
                "balance_before": 800,
                "balance_after": 500,
                "status": "Applied",
            }
        ]

        restored = self.module.restore_invoice_gift_card_redemptions(invoice_doc)

        self.assertEqual(restored, 300)
        self.assertEqual(existing.current_balance, 800)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["status"], "Cancelled")
        # Append-only: the money coming back is a row, not the erasure of the
        # row that took it, so every peso the balance moved still has a line.
        self.assertEqual(len(existing.transactions), 1)
        self.assertEqual(existing.transactions[0]["transaction_type"], "Adjust")
        self.assertEqual(existing.transactions[0]["amount"], 300)
        self.assertEqual(existing.transactions[0]["balance_after"], 800)

    def test_restore_uses_compensating_delta_after_later_redemption(self):
        existing = FakeGiftCard(code="GC-RESTORE", balance=100, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        invoice_a = self.state["invoices"]["ACC-SINV-0001"]
        invoice_b = FakeInvoice(name="ACC-SINV-0002")

        self.module.apply_invoice_gift_card_redemptions(
            invoice_a,
            [{"gift_card_code": "GC-RESTORE", "amount": 30, "cashier": "cashier@example.com"}],
        )
        self.module.apply_invoice_gift_card_redemptions(
            invoice_b,
            [{"gift_card_code": "GC-RESTORE", "amount": 20, "cashier": "cashier@example.com"}],
        )
        self.assertEqual(existing.current_balance, 50)

        restored = self.module.restore_invoice_gift_card_redemptions(invoice_a)

        self.assertEqual(restored, 30)
        self.assertEqual(existing.current_balance, 80)
        self.assertNotEqual(existing.current_balance, 100)
        self.assertEqual(
            self.state["balance_locks"],
            ["GC-RESTORE", "GC-RESTORE", "GC-RESTORE"],
        )

    def test_apply_invoice_gift_card_redemptions_blocks_inactive_card(self):
        existing = FakeGiftCard(code="GC-0003", balance=800, status="Inactive")
        self.state["cards"][existing.gift_card_code] = existing

        with self.assertRaises(Exception) as ctx:
            self.module.apply_invoice_gift_card_redemptions(
                self.state["invoices"]["ACC-SINV-0001"],
                [{"gift_card_code": "GC-0003", "amount": 100, "cashier": "cashier@example.com"}],
            )

        self.assertIn("active gift cards", str(ctx.exception))

    def test_apply_invoice_gift_card_redemptions_creates_mode_of_payment_account_mapping(self):
        existing = FakeGiftCard(code="GC-0004", balance=500, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]

        self.module.apply_invoice_gift_card_redemptions(
            invoice_doc,
            [{"gift_card_code": "GC-0004", "amount": 200, "cashier": "cashier@example.com"}],
        )

        self.assertIn("Gift Card", self.state["mode_of_payments"])
        gift_mode = self.state["mode_of_payments"]["Gift Card"]
        self.assertEqual(gift_mode.type, "Cash")
        self.assertEqual(len(gift_mode.accounts), 1)
        self.assertEqual(gift_mode.accounts[0]["company"], "Test Company")
        self.assertEqual(gift_mode.accounts[0]["default_account"], "2190 - Gift Card Liability - TC")

    def test_apply_invoice_gift_card_redemptions_is_idempotent_for_saved_drafts(self):
        existing = FakeGiftCard(code="GC-0005", balance=500, status="Active")
        self.state["cards"][existing.gift_card_code] = existing
        invoice_doc = self.state["invoices"]["ACC-SINV-0001"]
        rows = [{"gift_card_code": "GC-0005", "amount": 300, "cashier": "cashier@example.com"}]

        first_result = self.module.apply_invoice_gift_card_redemptions(invoice_doc, rows)
        second_result = self.module.apply_invoice_gift_card_redemptions(invoice_doc, rows)

        self.assertEqual(first_result, 300)
        self.assertEqual(second_result, 300)
        self.assertEqual(existing.current_balance, 200)
        self.assertEqual(len(invoice_doc.gift_card_redemptions), 1)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["gift_card_code"], "GC-0005")
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["balance_before"], 500)
        self.assertEqual(invoice_doc.gift_card_redemptions[0]["balance_after"], 200)
        self.assertEqual(len(invoice_doc.payments), 1)
        self.assertEqual(invoice_doc.payments[0]["amount"], 300)

    def test_issue_gift_card_with_initial_amount_creates_liability_entry(self):
        result = self.module.issue_gift_card(
            pos_profile="Main POS",
            cashier="supervisor@example.com",
            company="Test Company",
            initial_amount=500,
            gift_card_code="GC-ISSUE-01",
        )

        self.assertEqual(result["current_balance"], 500)
        self.assertEqual(len(self.state["journal_entries"]), 1)
        self.assertEqual(
            self.state["journal_entries"][0].accounts[0]["account"],
            "1110 - Cash - TC",
        )
        self.assertEqual(
            self.state["journal_entries"][0].accounts[1]["account"],
            "2190 - Gift Card Liability - TC",
        )

    def test_check_gift_card_balance_keeps_its_lean_payload_by_default(self):
        existing = FakeGiftCard(code="GC-LOOKUP", balance=350, status="Active")
        existing.transactions = [
            {"transaction_type": "Issue", "amount": 300, "balance_after": 300},
        ]
        self.state["cards"][existing.gift_card_code] = existing

        card = self.module.check_gift_card_balance(gift_card_code="GC-LOOKUP")

        # Cobro's redemption path only wants a balance; it keeps the payload it
        # has always had.
        self.assertNotIn("transactions", card)
        self.assertEqual(card["current_balance"], 350)

    def test_check_gift_card_balance_returns_the_ledger_newest_first_when_asked(self):
        existing = FakeGiftCard(code="GC-LEDGER", balance=350, status="Active")
        existing.issued_by = "supervisor@example.com"
        existing.transactions = [
            {
                "transaction_type": "Issue",
                "amount": 300,
                "balance_after": 300,
                "cashier": "supervisor@example.com",
                "posting_datetime": "2026-08-12 09:00:00",
            },
            {
                "transaction_type": "Top Up",
                "amount": 200,
                "balance_after": 500,
                "cashier": "supervisor@example.com",
                "posting_datetime": "2026-08-20 11:00:00",
            },
            {
                "transaction_type": "Redeem",
                "amount": -150,
                "balance_after": 350,
                "cashier": "cashier@example.com",
                "posting_datetime": "2026-08-23 10:22:00",
                "reference_doctype": "Sales Invoice",
                "reference_name": "ACC-SINV-2026-00212",
            },
        ]
        self.state["cards"][existing.gift_card_code] = existing

        card = self.module.check_gift_card_balance(
            gift_card_code="GC-LEDGER", include_transactions=1
        )

        rows = card["transactions"]
        self.assertEqual([row["transaction_type"] for row in rows], ["Redeem", "Top Up", "Issue"])
        self.assertEqual(rows[0]["amount"], -150)
        self.assertEqual(rows[0]["balance_after"], 350)
        self.assertEqual(rows[0]["reference_name"], "ACC-SINV-2026-00212")
        self.assertEqual(card["transactions_limit"], self.module.GIFT_CARD_TRANSACTIONS_LIMIT)
        # The panel's identity line — both were on the doctype and neither ever
        # reached a caller.
        self.assertEqual(card["issued_by"], "supervisor@example.com")
        self.assertIn("last_redeemed_on", card)

    def test_the_ledger_is_capped_and_says_so(self):
        existing = FakeGiftCard(code="GC-LONG", balance=0, status="Active")
        existing.transactions = [
            {"transaction_type": "Top Up", "amount": 1, "balance_after": index}
            for index in range(50)
        ]
        self.state["cards"][existing.gift_card_code] = existing

        card = self.module.check_gift_card_balance(
            gift_card_code="GC-LONG", include_transactions=1, transactions_limit=5
        )

        self.assertEqual(len(card["transactions"]), 5)
        self.assertEqual(card["transactions_limit"], 5)
        # The cap takes the RECENT end, not the first five rows ever written.
        self.assertEqual(card["transactions"][0]["balance_after"], 49)


if __name__ == "__main__":
    unittest.main()
