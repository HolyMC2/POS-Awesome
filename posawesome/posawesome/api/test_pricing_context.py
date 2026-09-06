"""Real ERPNext pricing regressions; every fixture is rolled back."""

import unittest
import uuid
from unittest.mock import patch

import frappe


class TestPricingContext(unittest.TestCase):
    def setUp(self):
        self.old_user = frappe.session.user
        frappe.set_user("Administrator")
        frappe.db.savepoint("pos_pricing_context")
        self.tag = "Pricing context " + uuid.uuid4().hex[:10]
        self.company = frappe.db.get_single_value("Global Defaults", "default_company")
        self.currency = frappe.db.get_value("Company", self.company, "default_currency")
        self.price_list = self.insert(
            {
                "doctype": "Price List",
                "price_list_name": self.tag,
                "currency": self.currency,
                "selling": 1,
                "enabled": 1,
                "price_not_uom_dependent": 1,
            }
        )
        if not frappe.db.exists("UOM", "Box"):
            self.insert({"doctype": "UOM", "uom_name": "Box"})
        self.item = self.insert(
            {
                "doctype": "Item",
                "item_code": self.tag,
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "is_stock_item": 0,
                "uoms": [{"uom": "Nos", "conversion_factor": 1}, {"uom": "Box", "conversion_factor": 10}],
            }
        )
        self.profile = frappe._dict(selling_price_list=self.price_list.name, posa_allow_user_to_edit_rate=0)

    def tearDown(self):
        frappe.db.rollback(save_point="pos_pricing_context")
        frappe.set_user(self.old_user)

    @staticmethod
    def insert(data):
        return frappe.get_doc(data).insert(ignore_permissions=True)

    def price(self, rate, **fields):
        return self.insert(
            dict(
                doctype="Item Price",
                item_code=self.item.name,
                price_list=self.price_list.name,
                price_list_rate=rate,
                uom="Nos",
                **dict({"valid_from": frappe.utils.today()}, **fields),
            )
        )

    def invoice(self, rate, uom="Nos", **fields):
        return frappe.get_doc(
            dict(
                doctype="Sales Invoice",
                company=self.company,
                currency=self.currency,
                selling_price_list=self.price_list.name,
                posting_date=frappe.utils.today(),
                items=[
                    dict(
                        item_code=self.item.name,
                        qty=1,
                        uom=uom,
                        conversion_factor=999,
                        price_list_rate=rate,
                        rate=rate,
                    )
                ],
                **fields,
            )
        )

    def assert_guard(self, good, bad, uom="Nos"):
        from posawesome.posawesome.api._reprice import assert_rates_within_band

        assert_rates_within_band(self.invoice(good, uom), self.profile)
        with self.assertRaises(frappe.PermissionError):
            assert_rates_within_band(self.invoice(bad, uom), self.profile)

    def test_stock_price_converts_to_selling_uom_ignoring_client_factor(self):
        self.price(10)
        self.assert_guard(100, 10, "Box")

    def test_future_and_expired_prices_do_not_replace_current_price(self):
        self.price(
            100,
            valid_from=frappe.utils.add_days(frappe.utils.today(), -10),
            valid_upto=frappe.utils.add_days(frappe.utils.today(), 9),
        )
        self.price(50, valid_from=frappe.utils.add_days(frappe.utils.today(), 10))
        self.assert_guard(100, 50)

    def test_currency_uses_server_rate_and_ignores_client_currency_fields(self):
        from posawesome.posawesome.api.pricing_context import reference_rate_lookup

        self.price(100)
        # Two rates to the company currency, just as ERPNext invoice pricing.
        # No remote currency service is used by this fixture.
        doc = self.invoice(5)
        doc.currency = "USD" if self.currency != "USD" else "EUR"
        self.insert(
            {
                "doctype": "Currency Exchange",
                "date": frappe.utils.today(),
                "from_currency": doc.currency,
                "to_currency": self.currency,
                "exchange_rate": 20,
                "for_selling": 1,
                "for_buying": 1,
            }
        )
        doc.price_list_currency = doc.currency
        doc.plc_conversion_rate = doc.conversion_rate = 999
        with patch("requests.get", side_effect=AssertionError("No external exchange lookup")):
            self.assertEqual(reference_rate_lookup(doc, self.price_list.name)(doc.items[0]), 5)

    def test_repeat_lines_reuse_one_authoritative_lookup(self):
        from erpnext.stock.get_item_details import get_price_list_rate_for
        from posawesome.posawesome.api.pricing_context import reference_rate_lookup

        self.price(10)
        doc = self.invoice(100, "Box")
        with patch(
            "erpnext.stock.get_item_details.get_price_list_rate_for", wraps=get_price_list_rate_for
        ) as core:
            lookup = reference_rate_lookup(doc, self.price_list.name)
            for _ in range(100):
                self.assertEqual(lookup(doc.items[0]), 100)
            self.assertEqual(core.call_count, 1)

    def test_unavailable_or_nonpositive_exchange_rates_are_rejected(self):
        from posawesome.posawesome.api.pricing_context import invoice_exchange_rates

        doc = self.invoice(100)
        doc.currency = "USD" if self.currency != "USD" else "EUR"
        for rate in (None, 0, -1, float("nan"), float("inf")):
            with self.subTest(rate=rate), patch("erpnext.setup.utils.get_exchange_rate", return_value=rate):
                with self.assertRaisesRegex(frappe.ValidationError, "valid selling exchange rate"):
                    invoice_exchange_rates(doc, self.price_list.name)

    def test_return_quantity_uses_the_same_positive_unit_price(self):
        from posawesome.posawesome.api._reprice import assert_rates_within_band

        self.price(10)
        doc = self.invoice(100, "Box")
        doc.is_return = 1
        doc.items[0].qty = -1
        assert_rates_within_band(doc, self.profile)

    def test_customer_specific_price_cannot_apply_to_another_customer(self):
        from posawesome.posawesome.api.pricing_context import reference_rate_lookup

        customer = self.insert(
            {
                "doctype": "Customer",
                "customer_name": self.tag,
                "customer_type": "Individual",
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                "territory": "All Territories",
            }
        )
        self.price(100, valid_from=frappe.utils.add_days(frappe.utils.today(), -1))
        self.price(50, customer=customer.name)
        ordinary = self.invoice(100)
        special = self.invoice(50, customer=customer.name)
        self.assertEqual(reference_rate_lookup(ordinary, self.price_list.name)(ordinary.items[0]), 100)
        self.assertEqual(reference_rate_lookup(special, self.price_list.name)(special.items[0]), 50)

    def test_give_product_amount_threshold_uses_current_selling_uom(self):
        from posawesome.posawesome.api._promotion_eligibility import eligible_free_lines

        self.price(10, valid_upto=frappe.utils.add_days(frappe.utils.today(), 9))
        self.price(1, valid_from=frappe.utils.add_days(frappe.utils.today(), 10))
        profile = frappe.get_doc(
            "POS Profile",
            frappe.db.get_value("POS Profile", {"company": self.company, "disabled": 0}, "name"),
        )
        gift = self.insert(
            {
                "doctype": "Item",
                "item_code": self.tag + " gift",
                "item_group": "All Item Groups",
                "stock_uom": "Nos",
                "is_stock_item": 0,
            }
        )
        self.insert(
            {
                "doctype": "Item Price",
                "item_code": gift.name,
                "price_list": self.price_list.name,
                "price_list_rate": 50,
                "uom": "Nos",
            }
        )
        self.insert(
            {
                "doctype": "POS Offer",
                "title": self.tag,
                "description": "Rollback-only amount threshold regression",
                "company": self.company,
                "pos_profile": profile.name,
                "warehouse": profile.warehouse,
                "apply_on": "Item Code",
                "item": self.item.name,
                "offer": "Give Product",
                "apply_type": "Item Code",
                "apply_item_code": gift.name,
                "min_qty": 1,
                "min_amt": 80,
                "given_qty": 1,
            }
        )
        doc = self.invoice(100, "Box")
        free = doc.append(
            "items", {"item_code": gift.name, "qty": 1, "uom": "Nos", "rate": 0, "is_free_item": 1}
        )
        self.assertIn(id(free), eligible_free_lines(doc, profile, self.price_list.name))
        doc.items[0].uom = "Nos"
        doc.items[0].rate = 10
        self.assertNotIn(id(free), eligible_free_lines(doc, profile, self.price_list.name))

    def test_public_submit_cannot_replace_server_foreign_exchange_rate(self):
        from posawesome.posawesome.api.invoice_processing.creation import update_invoice, submit_invoice
        from posawesome.posawesome.api.shift_terminal import bind_new_shift

        foreign = "USD" if self.currency != "USD" else "EUR"
        self.price(2000)
        exchange = self.insert(
            {
                "doctype": "Currency Exchange",
                "date": frappe.utils.today(),
                "from_currency": foreign,
                "to_currency": self.currency,
                "exchange_rate": 20,
                "for_selling": 1,
                "for_buying": 1,
            }
        )
        base = frappe.get_doc(
            "POS Profile",
            frappe.db.get_value("POS Profile", {"company": self.company, "disabled": 0}, "name"),
        )
        receivable = base.get("debit_to") or frappe.get_cached_value(
            "Company", self.company, "default_receivable_account"
        )
        cash = frappe.db.get_value(
            "Account",
            {
                "company": self.company,
                "account_type": "Cash",
                "disabled": 0,
                "is_group": 0,
                "account_currency": self.currency,
            },
            "name",
        )

        def foreign_account(source, label):
            account = frappe.copy_doc(frappe.get_doc("Account", source))
            account.update(
                dict(account_name=self.tag + label, account_number=None, account_currency=foreign, name=None)
            )
            return account.insert(ignore_permissions=True).name

        receivable = foreign_account(receivable, " receivable")
        cash = foreign_account(cash, " cash")
        customer = self.insert(
            {
                "doctype": "Customer",
                "customer_name": self.tag,
                "customer_type": "Individual",
                "default_currency": foreign,
                "customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
                "territory": "All Territories",
                "accounts": [{"company": self.company, "account": receivable}],
            }
        )
        mode = self.insert(
            {
                "doctype": "Mode of Payment",
                "mode_of_payment": self.tag,
                "type": "Cash",
                "accounts": [{"company": self.company, "default_account": cash}],
            }
        )
        profile = frappe.copy_doc(base)
        profile.update(
            dict(
                name=self.tag,
                customer=customer.name,
                debit_to=receivable,
                selling_price_list=self.price_list.name,
                create_pos_invoice_instead_of_sales_invoice=0,
                posa_allow_submissions_in_background_job=0,
                posa_allow_user_to_edit_rate=0,
            )
        )
        profile.set("customer_groups", [])
        profile.set("applicable_for_users", [])
        profile.set("payments", [{"mode_of_payment": mode.name, "default": 1}])
        profile.insert(ignore_permissions=True)
        proof = dict(
            terminal_id="currency-proof-" + uuid.uuid4().hex,
            terminal_token=uuid.uuid4().hex + uuid.uuid4().hex,
            terminal_generation=1,
        )
        shift = frappe.get_doc(
            {
                "doctype": "POS Opening Shift",
                "pos_profile": profile.name,
                "company": self.company,
                "user": "Administrator",
                "period_start_date": frappe.utils.now(),
                "balance_details": [{"mode_of_payment": mode.name, "opening_amount": 0}],
            }
        )
        bind_new_shift(shift, proof["terminal_id"], proof["terminal_token"])
        shift.insert(ignore_permissions=True).submit()
        for tampered in (False, True):
            with self.subTest(tampered=tampered):
                draft = self.insert(
                    {
                        "doctype": "Sales Invoice",
                        "company": self.company,
                        "customer": customer.name,
                        "currency": foreign,
                        "conversion_rate": 20,
                        "debit_to": receivable,
                        "selling_price_list": self.price_list.name,
                        "price_list_currency": self.currency,
                        "plc_conversion_rate": 1,
                        "is_pos": 1,
                        "update_stock": 0,
                        "ignore_pricing_rule": 1,
                        "pos_profile": profile.name,
                        "posa_pos_opening_shift": shift.name,
                        "items": [
                            {
                                "item_code": self.item.name,
                                "qty": 1,
                                "uom": "Nos",
                                "rate": 100,
                                "price_list_rate": 100,
                            }
                        ],
                        "payments": [
                            {"mode_of_payment": mode.name, "account": cash, "type": "Cash", "amount": 0}
                        ],
                    }
                )
                payload = draft.as_dict()
                payload.update(proof)
                payload = update_invoice(frappe.as_json(payload))
                self.assertEqual(payload["conversion_rate"], 20)
                payload["payments"][0]["amount"] = payload["paid_amount"] = 100
                if tampered:
                    payload["conversion_rate"] = 2
                    payload["plc_conversion_rate"] = 0.1
                try:
                    response = submit_invoice(
                        frappe.as_json(payload),
                        frappe.as_json(dict(proof, is_credit_sale=0, paid_change=0, credit_change=0)),
                        False,
                        profile.name,
                    )
                except frappe.ValidationError as exc:
                    if not tampered:
                        raise
                    self.assertRegex(str(exc).lower(), "exchange|conversion")
                    self.assertEqual(frappe.db.get_value("Sales Invoice", draft.name, "docstatus"), 0)
                    continue
                posted = frappe.get_doc("Sales Invoice", response["name"])
                self.assertEqual(posted.docstatus, 1)
                self.assertEqual(posted.conversion_rate, 20)
                self.assertEqual(posted.base_grand_total, 2000)
                self.assertEqual(posted.base_paid_amount, 2000)

        # A later market rate must not revalue the reversal of this submitted sale.
        exchange.exchange_rate = 25
        exchange.save(ignore_permissions=True)
        from erpnext.controllers.sales_and_purchase_return import make_return_doc

        returned = make_return_doc("Sales Invoice", posted.name)
        returned.update_outstanding_for_self = 1
        returned.pos_profile = profile.name
        returned.posa_pos_opening_shift = shift.name
        returned.insert(ignore_permissions=True)
        payload = returned.as_dict()
        payload.update(proof)
        payload["conversion_rate"] = 999
        payload = update_invoice(frappe.as_json(payload))
        self.assertEqual(payload["conversion_rate"], 20)
        payload["payments"] = [
            {"mode_of_payment": mode.name, "account": cash, "type": "Cash", "amount": -100}
        ]
        payload["paid_amount"] = -100
        payload["conversion_rate"] = 999
        response = submit_invoice(
            frappe.as_json(payload),
            frappe.as_json(dict(proof, is_credit_sale=0, paid_change=0, credit_change=0)),
            False,
            profile.name,
        )
        returned = frappe.get_doc("Sales Invoice", response["name"])
        self.assertEqual(returned.docstatus, 1)
        self.assertEqual(returned.conversion_rate, 20)
        self.assertEqual(returned.base_grand_total, -2000)
        self.assertEqual(returned.base_paid_amount, -2000)
