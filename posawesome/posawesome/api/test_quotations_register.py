"""The Cotizaciones lane and the nota de crédito, end to end
(DOCUMENTOS_GOLDEN_FLOW §4).

Bench-runnable (`IntegrationTestCase`); skips when the site lacks fixtures.
Two halves, matching the two documents:

* **Quotation** — the estado buckets, the profile/shift/walk-in gates, the
  quoted-vs-today pricing on load, and the double-convert refusal. The bucket
  arithmetic is exercised through `quotation_read_model` directly (it is pure
  and needs no documents) and again through `get_quotations` on real rows, so a
  bucket that is right in isolation and wrong on the wire cannot pass.
* **Credit note** — minting for exactly the returned lines, the walk-in
  refusal, and the invariant the whole feature rests on: a credit note is a
  submitted return with NO payments, which is what makes it spendable through
  `get_available_credit`.

The conversion linkage is tested at the SEAM the register actually uses:
`load_quotation_for_sale` mints the draft with `posa_quotation` on it, and
submitting THAT draft is what flips the quotation — nothing here writes the
link by hand, because a test that does would pass while the register's own path
was broken.
"""

from __future__ import annotations

import json
import unittest

# Bench-only integration test: needs a real frappe + site. Skip the module when
# discovered by the standalone stub-suite runner, where frappe is absent.
try:
	import frappe
except ImportError:
	raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, nowdate

from posawesome.posawesome.api import quotation_conversion, quotations
from posawesome.posawesome.api.invoice_processing import credit_note
from posawesome.posawesome.api.quotation_read_model import (
	bucket_counts,
	days_until,
	is_honoured,
	line_provenance,
	quotation_bucket,
	shape_row,
)

PROFILE = "Doco Ventas"
TEST_ITEM = "POSA-TEST-SVC"


def _ensure_test_item() -> str:
	"""Find-or-create the test service item and return its DOCNAME.

	Doco sites name Items by a series (IPN…), NOT by item_code, so a row that
	references the CODE fails Link validation silently. Resolve through the
	field, exactly as `test_document_flows` does.
	"""
	name = frappe.db.get_value("Item", {"item_code": TEST_ITEM}, "name")
	if name:
		return name
	return frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": TEST_ITEM,
			"item_name": "POSA Test Service",
			"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"is_sales_item": 1,
		}
	).insert(ignore_permissions=True).name


# ---------------------------------------------------------------------------
# The bucket rules, as arithmetic
# ---------------------------------------------------------------------------


class TestQuotationBuckets(unittest.TestCase):
	"""No documents, no site — these are date comparisons and nothing else."""

	TODAY = "2026-08-23"

	def _row(self, **overrides):
		row = {
			"name": "SAL-QTN-1",
			"valid_till": "2026-08-28",
			"converted_invoice": None,
		}
		row.update(overrides)
		return row

	def test_a_quote_inside_its_window_is_vigente(self):
		self.assertEqual(quotation_bucket(self._row(), self.TODAY), "active")

	def test_the_last_48_hours_are_por_vencer(self):
		self.assertEqual(
			quotation_bucket(self._row(valid_till="2026-08-25"), self.TODAY), "expiring"
		)

	def test_the_last_day_is_still_honoured(self):
		# 0 days left reads «expires today» and stays Por vencer: a quote is
		# good for the WHOLE of its last day, including the walk to the car.
		row = self._row(valid_till=self.TODAY)
		self.assertEqual(quotation_bucket(row, self.TODAY), "expiring")
		self.assertTrue(is_honoured(row, self.TODAY))

	def test_yesterday_is_vencida(self):
		row = self._row(valid_till="2026-08-22")
		self.assertEqual(quotation_bucket(row, self.TODAY), "expired")
		self.assertFalse(is_honoured(row, self.TODAY))

	def test_a_quote_with_no_validity_never_expires(self):
		self.assertEqual(quotation_bucket(self._row(valid_till=None), self.TODAY), "active")

	def test_converted_outranks_expired(self):
		# An old WON quote is Convertida, not Vencida: what happened to it is
		# the sale, not the calendar — and the cashier is looking for the link.
		row = self._row(valid_till="2026-01-01", converted_invoice="ACC-SINV-1")
		self.assertEqual(quotation_bucket(row, self.TODAY), "converted")

	def test_days_until_survives_a_junk_date(self):
		self.assertIsNone(days_until("not-a-date", self.TODAY))
		self.assertIsNone(days_until(None, self.TODAY))

	def test_every_bucket_is_counted_even_at_zero(self):
		counts = bucket_counts([{"estado": "active"}, {"estado": "active"}])
		self.assertEqual(counts, {"active": 2, "expiring": 0, "expired": 0, "converted": 0})

	def test_provenance_is_silent_when_the_price_did_not_move(self):
		self.assertIsNone(line_provenance(149, 149))
		self.assertIsNone(line_provenance(149, None))
		self.assertEqual(line_provenance(149, 169), {"quoted_rate": 149.0, "today_rate": 169.0})

	def test_shape_row_clears_a_half_written_conversion_link(self):
		row = shape_row(
			{
				"name": "SAL-QTN-1",
				"party_name": "CUST-1",
				"transaction_date": "2026-08-21",
				"valid_till": "2026-08-28",
				"grand_total": 100,
				"posa_converted_invoice": None,
				"posa_converted_invoice_doctype": "Sales Invoice",
			},
			self.TODAY,
		)
		self.assertIsNone(row["converted_invoice"])
		self.assertIsNone(row["converted_invoice_doctype"])


# ---------------------------------------------------------------------------
# The register's endpoints, on real documents
# ---------------------------------------------------------------------------


class _RegisterCase(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("POS Profile", PROFILE):
			self.skipTest("no Doco Ventas profile")
		if not frappe.db.has_column("Quotation", "posa_converted_invoice"):
			self.skipTest("add_quotation_conversion_fields has not run on this site")
		self.item = _ensure_test_item()
		self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
		self.walk_in = frappe.db.get_value("POS Profile", PROFILE, "customer")
		self.customer = frappe.db.get_value(
			"Customer", {"disabled": 0, "name": ["!=", self.walk_in or ""]}, "name"
		)
		if not self.customer:
			self.skipTest("no customer on site")
		self._flag_before = frappe.db.get_value(
			"POS Profile", PROFILE, "custom_allow_create_quotation"
		)
		frappe.db.set_value("POS Profile", PROFILE, "custom_allow_create_quotation", 1)
		frappe.clear_cache(doctype="POS Profile")
		self._shift = self._ensure_open_shift()

	def tearDown(self):
		frappe.db.set_value(
			"POS Profile", PROFILE, "custom_allow_create_quotation", self._flag_before or 0
		)
		frappe.clear_cache(doctype="POS Profile")

	def _ensure_open_shift(self):
		"""The acting user's own open shift, or skip.

		Not created here: an opening shift carries balance details and a
		company's accounts, and a synthetic one would test the fixture rather
		than the gate. Every endpoint under test asserts one, so a site without
		one has nothing to say about them.
		"""
		rows = frappe.get_all(
			"POS Opening Shift",
			filters={
				"user": frappe.session.user,
				"pos_closing_shift": ["is", "not set"],
				"docstatus": 1,
				"status": "Open",
				"pos_profile": PROFILE,
			},
			fields=["name"],
			limit_page_length=1,
		)
		if not rows:
			self.skipTest("no open shift for the acting user on this register")
		return rows[0]["name"]

	def _cart(self, rate=149.0, qty=1, customer=None):
		return {
			"customer": customer or self.customer,
			"currency": frappe.db.get_value("POS Profile", PROFILE, "currency"),
			"selling_price_list": frappe.db.get_value(
				"POS Profile", PROFILE, "selling_price_list"
			),
			"items": [
				{
					"item_code": self.item,
					"qty": qty,
					"uom": "Nos",
					"rate": rate,
					"price_list_rate": rate,
				}
			],
		}

	def _quote(self, rate=149.0, days=7, note=None):
		created = quotation_conversion.create_quotation_from_cart(
			PROFILE, json.dumps(self._cart(rate=rate)), days, note
		)
		self.addCleanup(self._drop_quotation, created["name"])
		return created

	def _drop_quotation(self, name):
		try:
			doc = frappe.get_doc("Quotation", name)
			if doc.docstatus == 1:
				doc.cancel()
			frappe.delete_doc("Quotation", name, force=True, ignore_permissions=True)
		except Exception:
			pass


class TestQuotationGates(_RegisterCase):
	def test_the_cart_becomes_a_real_submitted_quotation(self):
		created = self._quote(rate=149.0)
		doc = frappe.get_doc("Quotation", created["name"])
		self.assertEqual(doc.docstatus, 1)
		self.assertEqual(doc.party_name, self.customer)
		self.assertEqual(flt(doc.items[0].rate), 149.0)
		self.assertEqual(str(doc.valid_till), add_days(nowdate(), 7))

	def test_the_carts_rate_wins_over_the_price_list(self):
		# The counter negotiated 111; ERPNext's own `set_missing_values` would
		# re-derive the rate from the price list, which would quietly change the
		# promise between the cashier saying it and the paper printing it.
		created = self._quote(rate=111.0)
		doc = frappe.get_doc("Quotation", created["name"])
		self.assertEqual(flt(doc.items[0].rate), 111.0)

	def test_the_walk_in_customer_is_refused_with_a_sentence(self):
		if not self.walk_in:
			self.skipTest("this register has no default counter customer")
		with self.assertRaises(Exception) as ctx:
			quotation_conversion.create_quotation_from_cart(
				PROFILE, json.dumps(self._cart(customer=self.walk_in)), 7, None
			)
		self.assertIn("counter customer", str(ctx.exception))

	def test_an_empty_cart_is_refused(self):
		payload = self._cart()
		payload["items"] = []
		with self.assertRaises(Exception):
			quotation_conversion.create_quotation_from_cart(PROFILE, json.dumps(payload), 7, None)

	def test_the_profile_flag_gates_the_whole_lane(self):
		frappe.db.set_value("POS Profile", PROFILE, "custom_allow_create_quotation", 0)
		frappe.clear_cache(doctype="POS Profile")
		with self.assertRaises(Exception):
			quotations.get_quotations(PROFILE)
		with self.assertRaises(Exception):
			quotation_conversion.create_quotation_from_cart(
				PROFILE, json.dumps(self._cart()), 7, None
			)

	def test_validity_is_clamped_rather_than_refused(self):
		self.assertEqual(quotation_conversion.resolve_validity_days(PROFILE, 400), 180)
		self.assertEqual(quotation_conversion.resolve_validity_days(PROFILE, 0), 1)
		self.assertEqual(quotation_conversion.resolve_validity_days(PROFILE, -3), 1)

	def test_the_register_default_fills_an_empty_validity_box(self):
		frappe.db.set_value("POS Profile", PROFILE, "posa_quotation_validity_days", 12)
		frappe.clear_cache(doctype="POS Profile")
		try:
			self.assertEqual(quotation_conversion.resolve_validity_days(PROFILE, None), 12)
		finally:
			frappe.db.set_value("POS Profile", PROFILE, "posa_quotation_validity_days", 7)
			frappe.clear_cache(doctype="POS Profile")


class TestQuotationList(_RegisterCase):
	def test_the_new_quote_lists_as_vigente_and_is_counted(self):
		created = self._quote()
		payload = quotations.get_quotations(PROFILE)
		row = next(r for r in payload["rows"] if r["name"] == created["name"])
		self.assertEqual(row["estado"], "active")
		self.assertEqual(row["days_left"], 7)
		self.assertEqual(row["pos_profile"], PROFILE)
		self.assertGreaterEqual(payload["counts"]["active"], 1)
		self.assertEqual(set(payload["counts"]), {"active", "expiring", "expired", "converted"})

	def test_the_note_survives_to_the_list(self):
		created = self._quote(note="apartan con el 30 %")
		payload = quotations.get_quotations(PROFILE)
		row = next(r for r in payload["rows"] if r["name"] == created["name"])
		self.assertEqual(row["note"], "apartan con el 30 %")

	def test_counting_happens_before_filtering(self):
		# A tab reading «Vencidas 9» over a list of two matches is the header
		# contradicting the list, so the counts must span the whole set.
		self._quote()
		filtered = quotations.get_quotations(PROFILE, status_bucket="converted")
		self.assertGreaterEqual(filtered["counts"]["active"], 1)
		self.assertTrue(all(row["estado"] == "converted" for row in filtered["rows"]))

	def test_search_matches_the_folio(self):
		created = self._quote()
		payload = quotations.get_quotations(PROFILE, search=created["name"])
		self.assertIn(created["name"], [row["name"] for row in payload["rows"]])

	def test_the_line_count_comes_back_without_an_aggregate_field(self):
		# `get_all(fields=["count(name) as n"])` is rejected over HTTP (417)
		# while working fine in the console — the counts here are tallied in
		# Python for exactly that reason.
		created = self._quote()
		payload = quotations.get_quotations(PROFILE)
		row = next(r for r in payload["rows"] if r["name"] == created["name"])
		self.assertEqual(row["items_count"], 1)


class TestQuotationConversion(_RegisterCase):
	def _load(self, name):
		result = quotation_conversion.load_quotation_for_sale(PROFILE, name)
		if result.get("allowed") and result.get("invoice_doc"):
			self.addCleanup(self._drop_invoice, result["invoice_doc"])
		return result

	def _drop_invoice(self, invoice_doc):
		try:
			doc = frappe.get_doc(invoice_doc["doctype"], invoice_doc["name"])
			if doc.docstatus == 0:
				frappe.delete_doc(doc.doctype, doc.name, force=True, ignore_permissions=True)
		except Exception:
			pass

	def test_loading_mints_a_draft_stamped_with_the_quotation(self):
		created = self._quote(rate=149.0)
		result = self._load(created["name"])
		self.assertTrue(result["allowed"])
		self.assertEqual(result["reason"], "honoured")
		draft = result["invoice_doc"]
		self.assertEqual(draft["posa_quotation"], created["name"])
		self.assertEqual(int(draft["docstatus"]), 0)
		self.assertEqual(flt(draft["items"][0]["rate"]), 149.0)

	def test_loading_twice_re_adopts_the_same_draft(self):
		created = self._quote()
		first = self._load(created["name"])
		second = self._load(created["name"])
		self.assertEqual(first["invoice_doc"]["name"], second["invoice_doc"]["name"])

	def test_submitting_the_draft_flips_the_quotation_to_convertida(self):
		created = self._quote()
		draft = self._load(created["name"])["invoice_doc"]
		invoice = frappe.get_doc(draft["doctype"], draft["name"])
		invoice.flags.ignore_permissions = True
		invoice.submit()
		self.addCleanup(self._cancel_invoice, invoice.doctype, invoice.name)

		linked = frappe.db.get_value(
			"Quotation",
			created["name"],
			["posa_converted_invoice", "posa_converted_invoice_doctype"],
			as_dict=True,
		)
		self.assertEqual(linked.posa_converted_invoice, invoice.name)
		self.assertEqual(linked.posa_converted_invoice_doctype, invoice.doctype)

	def test_a_converted_quotation_refuses_a_second_load_and_names_the_sale(self):
		created = self._quote()
		draft = self._load(created["name"])["invoice_doc"]
		invoice = frappe.get_doc(draft["doctype"], draft["name"])
		invoice.flags.ignore_permissions = True
		invoice.submit()
		self.addCleanup(self._cancel_invoice, invoice.doctype, invoice.name)

		again = quotation_conversion.load_quotation_for_sale(PROFILE, created["name"])
		self.assertFalse(again["allowed"])
		self.assertEqual(again["reason"], "converted")
		self.assertEqual(again["invoice"], invoice.name)
		# A refusal that still handed back the lines would not be a refusal.
		self.assertNotIn("lines", again)
		self.assertNotIn("invoice_doc", again)

	def test_the_estado_follows_the_conversion_on_the_wire(self):
		created = self._quote()
		draft = self._load(created["name"])["invoice_doc"]
		invoice = frappe.get_doc(draft["doctype"], draft["name"])
		invoice.flags.ignore_permissions = True
		invoice.submit()
		self.addCleanup(self._cancel_invoice, invoice.doctype, invoice.name)

		payload = quotations.get_quotations(PROFILE, status_bucket="converted")
		row = next(r for r in payload["rows"] if r["name"] == created["name"])
		self.assertEqual(row["estado"], "converted")
		self.assertEqual(row["converted_invoice"], invoice.name)

	def test_cancelling_the_sale_releases_the_quotation(self):
		created = self._quote()
		draft = self._load(created["name"])["invoice_doc"]
		invoice = frappe.get_doc(draft["doctype"], draft["name"])
		invoice.flags.ignore_permissions = True
		invoice.submit()
		invoice.cancel()
		self.assertIsNone(
			frappe.db.get_value("Quotation", created["name"], "posa_converted_invoice")
		)

	def test_an_expired_quote_reprices_and_reports_both_totals(self):
		created = self._quote(rate=149.0, days=7)
		frappe.db.set_value(
			"Quotation", created["name"], "valid_till", add_days(nowdate(), -1),
			update_modified=False,
		)
		result = self._load(created["name"])
		self.assertTrue(result["allowed"])
		self.assertTrue(result["expired"])
		self.assertEqual(result["reason"], "expired")
		self.assertEqual(flt(result["quoted_total"]), 149.0)
		# The provenance marker belongs to the honoured path only: on an expired
		# quote the cart IS today's price, so there is no second price to name.
		self.assertTrue(all(line["provenance"] is None for line in result["lines"]))

	def test_a_quotation_from_another_company_is_refused(self):
		created = self._quote()
		frappe.db.set_value(
			"Quotation", created["name"], "company", "__not-this-company__",
			update_modified=False,
		)
		with self.assertRaises(Exception):
			quotation_conversion.load_quotation_for_sale(PROFILE, created["name"])

	def _cancel_invoice(self, doctype, name):
		try:
			doc = frappe.get_doc(doctype, name)
			if doc.docstatus == 1:
				doc.cancel()
		except Exception:
			pass


# ---------------------------------------------------------------------------
# Nota de crédito
# ---------------------------------------------------------------------------


class TestCreditNoteReturn(_RegisterCase):
	def _sale(self, customer=None, rate=100.0, qty=2, paid=True):
		"""A submitted sale to return against.

		`paid` matters more than it looks. A credit note against an UNPAID
		invoice nets off against that invoice — the customer owed 100, returned
		an item, now owes 0 — and leaves no spendable balance behind. Only a
		PAID sale turns a return into monedero credit, which is the case the
		golden flow is about, so it is the default here and the other case gets
		a test of its own below.
		"""
		doc = frappe.new_doc("Sales Invoice")
		doc.customer = customer or self.customer
		doc.company = self.company
		doc.pos_profile = PROFILE
		doc.posa_pos_opening_shift = self._shift
		doc.append(
			"items", {"item_code": self.item, "qty": qty, "rate": rate, "price_list_rate": rate}
		)
		if paid:
			doc.is_pos = 1
		doc.flags.ignore_permissions = True
		doc.run_method("set_missing_values")
		if paid:
			# The profile's payment rows arrive at zero; one of them has to carry
			# the whole ticket or ERPNext refuses the POS submit.
			doc.run_method("calculate_taxes_and_totals")
			total = flt(doc.grand_total) or flt(rate) * qty
			for index, row in enumerate(doc.payments):
				row.amount = total if index == 0 else 0
			if not doc.payments:
				self.skipTest("register has no mode of payment configured")
		doc.insert(ignore_permissions=True)
		doc.submit()
		self.addCleanup(self._cancel, "Sales Invoice", doc.name)
		return doc

	def _cancel(self, doctype, name):
		try:
			d = frappe.get_doc(doctype, name)
			if d.docstatus == 1:
				d.cancel()
		except Exception:
			pass

	def test_a_credit_note_is_minted_for_exactly_the_returned_lines(self):
		sale = self._sale(rate=100.0, qty=2)
		result = credit_note.create_credit_note_return(
			PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 1}])
		)
		self.addCleanup(self._cancel, result["doctype"], result["name"])
		self.assertEqual(flt(result["amount"]), 100.0)
		self.assertEqual(result["return_against"], sale.name)
		self.assertEqual(result["print_format"], "POSA Nota de Crédito")

	def test_it_carries_no_payments_which_is_what_makes_it_spendable(self):
		sale = self._sale(rate=100.0, qty=1)
		result = credit_note.create_credit_note_return(
			PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 1}])
		)
		self.addCleanup(self._cancel, result["doctype"], result["name"])
		note = frappe.get_doc("Sales Invoice", result["name"])
		self.assertEqual(note.docstatus, 1)
		self.assertEqual(note.is_return, 1)
		self.assertEqual(list(note.payments), [])
		self.assertLess(flt(note.outstanding_amount), 0)

	def test_the_monedero_sees_it(self):
		from posawesome.posawesome.api.payments import get_available_credit

		sale = self._sale(rate=100.0, qty=1)
		result = credit_note.create_credit_note_return(
			PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 1}])
		)
		self.addCleanup(self._cancel, result["doctype"], result["name"])
		credit = get_available_credit(sale.customer, self.company)
		origins = [row["credit_origin"] for row in credit]
		self.assertIn(result["name"], origins)

	def test_against_an_unpaid_sale_it_nets_off_instead_of_minting_credit(self):
		# Not a bug and worth pinning: the customer owed for the item, gave it
		# back, and now owes nothing. Inventing a spendable balance on top would
		# be paying them twice.
		sale = self._sale(rate=100.0, qty=1, paid=False)
		result = credit_note.create_credit_note_return(
			PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 1}])
		)
		self.addCleanup(self._cancel, result["doctype"], result["name"])
		self.assertEqual(
			flt(frappe.db.get_value("Sales Invoice", sale.name, "outstanding_amount")), 0.0
		)

	def test_the_walk_in_customer_cannot_hold_credit(self):
		if not self.walk_in:
			self.skipTest("this register has no default counter customer")
		sale = self._sale(customer=self.walk_in, rate=100.0, qty=1)
		with self.assertRaises(Exception) as ctx:
			credit_note.create_credit_note_return(
				PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 1}])
			)
		self.assertIn("counter customer", str(ctx.exception))

	def test_an_empty_selection_is_refused(self):
		sale = self._sale()
		with self.assertRaises(Exception):
			credit_note.create_credit_note_return(PROFILE, sale.name, json.dumps([]))

	def test_returning_more_than_was_sold_is_refused(self):
		sale = self._sale(rate=100.0, qty=1)
		with self.assertRaises(Exception):
			credit_note.create_credit_note_return(
				PROFILE, sale.name, json.dumps([{"item_code": self.item, "qty": 5}])
			)
