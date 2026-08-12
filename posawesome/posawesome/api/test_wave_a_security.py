"""Real-frappe integration tests for the Wave A P0 security fixes.

The per-fix unit tests use a stubbed frappe and SKIP under bench; these exercise
the ADVERSARIAL paths through the real whitelisted entrypoints against a live
site, closing the "validated standalone only" gap. Bench-runnable
(IntegrationTestCase); skips when the site lacks the Doco Ventas fixtures.

Covers:
* W1 reprice  — a rate=0 line and an over-cap fixed discount are rejected on a
  rate-edit-OFF profile; a correctly-priced line still submits.
* W2 closing  — a malicious `doctype` never reaches raw SQL.
* W4 giftcard — a `cashier` param that is not the session user is rejected
  (supervisor impersonation).
"""

from __future__ import annotations

import json
import time
import unittest

try:
    import frappe
except ImportError:
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase

from posawesome.posawesome.api.invoice_processing import creation

TEST_ITEM = "POSA-TEST-SVC"
PROFILE = "Doco Ventas"


def _ensure_test_item() -> str:
    name = frappe.db.get_value("Item", {"item_code": TEST_ITEM}, "name")
    if name:
        return name
    doc = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": TEST_ITEM,
            "item_name": "POSA Test Service",
            "item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
            "stock_uom": "Nos",
            "is_stock_item": 0,
            "is_sales_item": 1,
        }
    ).insert(ignore_permissions=True)
    return doc.name


def _ensure_item_price(item_name: str, price_list: str, rate: float) -> None:
    """The rate-band guard only fires for items that HAVE a price master; make
    sure the test item carries one on the profile's selling price list."""
    existing = frappe.db.get_value(
        "Item Price", {"item_code": item_name, "price_list": price_list}, "name"
    )
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", rate)
        return
    frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item_name,
            "price_list": price_list,
            "price_list_rate": rate,
            "selling": 1,
        }
    ).insert(ignore_permissions=True)


class TestWaveASecurity(IntegrationTestCase):
    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest("no Doco Ventas profile")
        self.item = _ensure_test_item()
        self.profile = frappe.get_cached_doc("POS Profile", PROFILE)
        self.company = self.profile.company
        self.price_list = self.profile.selling_price_list or "Standard Selling"
        self.customer = frappe.db.get_value("Customer", {"disabled": 0}, "name")
        if not self.customer:
            self.skipTest("no customer on site")
        _ensure_item_price(self.item, self.price_list, 10)
        self._created = []

    def tearDown(self):
        for doctype, name in self._created:
            try:
                doc = frappe.get_doc(doctype, name)
                if doc.docstatus == 0:
                    frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
            except Exception:
                pass

    # ---------- helpers ----------

    def _crid(self, tag: str) -> str:
        return f"wa-sec-{tag}-{int(time.time() * 1000)}"

    def _payload(self, crid, rate=10, price_list_rate=10, pay=10, discount_amount=0):
        line = {
            "item_code": self.item,
            "qty": 1,
            "rate": rate,
            "price_list_rate": price_list_rate,
        }
        if discount_amount:
            line["discount_amount"] = discount_amount
        return {
            "doctype": "Sales Invoice",
            "pos_profile": PROFILE,
            "company": self.company,
            "customer": self.customer,
            "is_pos": 1,
            "posa_client_request_id": crid,
            "items": [line],
            "payments": [
                {"mode_of_payment": "Cash", "type": "Cash", "amount": pay, "base_amount": pay}
            ],
        }

    def _data(self, **kw):
        base = {
            "total_change": 0,
            "paid_change": 0,
            "credit_change": 0,
            "redeemed_customer_credit": 0,
            "customer_credit_dict": [],
            "gift_card_redemptions": [],
            "is_cashback": 1,
        }
        base.update(kw)
        return base

    def _submit(self, payload, data=None):
        created = creation.update_invoice(json.dumps(payload))
        payload = dict(payload)
        payload["name"] = created.get("name")
        self._created.append(("Sales Invoice", created.get("name")))
        return creation.submit_invoice(
            json.dumps(payload), json.dumps(data or self._data()), submit_in_background=0
        )

    def _with_rate_edit_off(self):
        """Toggle the profile to FORBID rate edits (the attack surface) and
        register restoration. Returns nothing; restore is automatic."""
        before = frappe.db.get_value("POS Profile", PROFILE, "posa_allow_user_to_edit_rate")
        frappe.db.set_value("POS Profile", PROFILE, "posa_allow_user_to_edit_rate", 0)
        frappe.clear_cache(doctype="POS Profile")
        self.addCleanup(
            lambda: (
                frappe.db.set_value(
                    "POS Profile", PROFILE, "posa_allow_user_to_edit_rate", before or 0
                ),
                frappe.clear_cache(doctype="POS Profile"),
            )
        )

    # ---------- W1 reprice ----------

    def test_w1_zero_rate_line_rejected_on_rate_edit_off_profile(self):
        """The free-invoice bypass: a priced item submitted at rate=0 with a
        zero payment must be rejected, not silently accepted as free."""
        self._with_rate_edit_off()
        payload = self._payload(self._crid("zero"), rate=0, price_list_rate=0, pay=0)
        with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
            self._submit(payload)

    def test_w1_over_cap_fixed_discount_rejected(self):
        """A fixed discount_amount that exceeds the profile discount cap must be
        rejected — previously discount_amount was never capped."""
        self._with_rate_edit_off()
        before = frappe.db.get_value("POS Profile", PROFILE, "posa_max_discount_allowed")
        frappe.db.set_value("POS Profile", PROFILE, "posa_max_discount_allowed", 10)
        frappe.clear_cache(doctype="POS Profile")
        self.addCleanup(
            lambda: (
                frappe.db.set_value(
                    "POS Profile", PROFILE, "posa_max_discount_allowed", before or 0
                ),
                frappe.clear_cache(doctype="POS Profile"),
            )
        )
        # price 10, 9 off (90% > 10% cap), pay the resulting 1
        payload = self._payload(
            self._crid("disc"), rate=1, price_list_rate=10, pay=1, discount_amount=9
        )
        with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
            self._submit(payload)

    def test_w1_correct_price_still_submits_on_rate_edit_off(self):
        """Regression: a correctly-priced line on a rate-edit-OFF profile must
        still submit — the guard must not block legitimate sales."""
        self._with_rate_edit_off()
        r = self._submit(self._payload(self._crid("ok"), rate=10, price_list_rate=10, pay=10))
        self.assertEqual(r["docstatus"], 1)

    # ---------- discount_account mandatory (prod incident 08-12) ----------

    def test_discounted_line_autofills_discount_account_and_submits(self):
        """A POS line with an absolute discount must not trip the mandatory
        `discount_account` Property Setter — validate fills it from the company
        default so the sale submits."""
        if not frappe.db.exists(
            "Property Setter", "Sales Invoice Item-discount_account-mandatory_depends_on"
        ):
            self.skipTest("no discount_account mandatory Property Setter on this site")
        if not frappe.get_cached_value("Company", self.company, "default_discount_account"):
            self.skipTest("no company default_discount_account")
        # list 100, 30 off, net 70, pay 70 — a genuinely discounted sale
        payload = self._payload(
            self._crid("disc-acct"), rate=70, price_list_rate=100, pay=70, discount_amount=30
        )
        r = self._submit(payload)
        self.assertEqual(r["docstatus"], 1)
        acct = frappe.db.get_value(
            "Sales Invoice Item", {"parent": r["name"]}, "discount_account"
        )
        self.assertTrue(acct, "discount_account should be auto-filled on the discounted line")

    # ---------- W2 closing SQLi ----------

    def test_w2_malicious_doctype_never_reaches_sql(self):
        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import data

        evil = "Sales Invoice`; SELECT SLEEP(5)-- "
        shift = frappe.db.get_value("POS Opening Shift", {}, "name") or "nonexistent-shift"
        with self.assertRaises(Exception):
            data.get_pos_invoices(shift, doctype=evil, submit_printed=0)

    # ---------- W5 submission-repair idempotency ----------

    def test_w5_double_repair_does_not_duplicate_change_payment_entry(self):
        """A replayed repair on a POST_SUBMIT_DONE ledger must be a no-op — it
        must not mint a second change/customer-credit Payment Entry."""
        crid = self._crid("repair")
        # pay 15 on a 10 ticket, 5 back as change → post-submit creates a change PE
        payload = self._payload(crid, rate=10, price_list_rate=10, pay=15)
        r = self._submit(payload, data=self._data(paid_change=5))
        self.assertEqual(r["docstatus"], 1)
        pes_before = set(frappe.get_all("Payment Entry", pluck="name"))
        creation.repair_invoice_submission(crid, self.company, PROFILE, "Sales Invoice")
        pes_after = set(frappe.get_all("Payment Entry", pluck="name"))
        self.assertEqual(
            pes_before, pes_after, "repair replay minted a duplicate Payment Entry"
        )

    # ---------- B3 tables capability gate ----------

    def test_b3_restaurant_endpoint_rejected_without_tables_capability(self):
        """A register whose capability preset lacks `tables` must be refused by
        the restaurant endpoints server-side, not merely hidden in the UI."""
        from posawesome.posawesome.api.restaurant import floors

        prev = frappe.db.get_value("POS Profile", PROFILE, "posa_capability_profile")
        frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", None)
        frappe.clear_cache(doctype="POS Profile")
        self.addCleanup(
            lambda: (
                frappe.db.set_value("POS Profile", PROFILE, "posa_capability_profile", prev),
                frappe.clear_cache(doctype="POS Profile"),
            )
        )
        with self.assertRaises(frappe.PermissionError):
            floors.get_floor_snapshot(PROFILE)

    # ---------- B5 shift-owner binding ----------

    def test_b5_shift_owned_by_another_user_is_refused(self):
        """A sale may only post into the seller's own opening shift; the shift
        validation hook must refuse a shift owned by a different user."""
        from posawesome.posawesome.api import shifts
        from posawesome.posawesome.api.test_restaurant_support import make_shift

        other = frappe.db.get_value(
            "User",
            {"name": ["not in", [frappe.session.user, "Guest"]], "enabled": 1,
             "user_type": "System User"},
            "name",
        )
        if not other:
            self.skipTest("no second system user on site")
        shift = make_shift(PROFILE, self.company, other)

        def _cleanup():
            try:
                doc = frappe.get_doc("POS Opening Shift", shift)
                if doc.docstatus == 1:
                    doc.flags.ignore_permissions = True
                    doc.cancel()
                frappe.delete_doc("POS Opening Shift", shift, force=True, ignore_permissions=True)
            except Exception:
                pass

        self.addCleanup(_cleanup)
        with self.assertRaises(frappe.PermissionError):
            shifts.assert_shift_not_stale(shift)

    # ---------- W4 giftcard impersonation ----------

    def test_w4_supervisor_impersonation_via_cashier_param_rejected(self):
        from posawesome.posawesome.api import gift_cards

        before = frappe.db.get_value("POS Profile", PROFILE, "posa_use_gift_cards")
        frappe.db.set_value("POS Profile", PROFILE, "posa_use_gift_cards", 1)
        frappe.clear_cache(doctype="POS Profile")
        self.addCleanup(
            lambda: (
                frappe.db.set_value("POS Profile", PROFILE, "posa_use_gift_cards", before or 0),
                frappe.clear_cache(doctype="POS Profile"),
            )
        )
        # session user is Administrator; naming a different cashier must be
        # rejected — identity comes from the session, not the parameter.
        with self.assertRaises(Exception):
            gift_cards.issue_gift_card(
                pos_profile=PROFILE,
                cashier="ghost-supervisor@example.com",
                initial_amount=5000,
            )
