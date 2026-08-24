"""The Cobranza read model, as arithmetic (COBRANZA_GOLDEN_FLOW §2).

Every function under test is pure — dicts in, dicts out — so these run without
a site, an invoice or a POS Profile. That is the point: the rules this asserts
are the ones nobody can see by reading the artboard, and they are the ones that
decide whether a red badge appears on a cashier's rail.

The three that would be invisible otherwise:

* **The tab and the chip answer different questions.** An invoice 24 days
  overdue that somebody already put money down on is in the Vencidas TAB and
  wears the «Apartado» CHIP. Collapsing them would either hide the apartado or
  hide the debt.
* **Counts come from the whole set, rows from the filter.** A tab reading
  «Vencidas 6» above two rows is the header contradicting the list.
* **Two currencies are never subtracted.** `grand_total` is in the invoice's
  currency and `outstanding_amount` in the party account's; where they differ
  `paid` is `None`, not a number.

The gates (`assert_profile`, company scoping) are NOT exercised here — the
`_scope` stub makes them no-ops, and a test against a stub that throws would
only prove the stub throws. `test_scope.py` and the bench suites own that half.
"""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

# Loaded through `test_support/isolated_module`, which stubs the subject's
# module-level imports and RESTORES `sys.modules` afterwards. Read its header
# before changing this.
_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)

receivables = _isolated.load_api_module("posawesome_receivables", "receivables.py")

TODAY = "2026-08-24"


def invoice(**overrides):
    """A submitted, still-owed Sales Invoice as `frappe.get_all` returns it."""
    source = {
        "name": "ACC-SINV-2026-04711",
        "customer": "CUST-0007",
        "customer_name": "Taller Los Pinos",
        "posting_date": "2026-07-20",
        "due_date": "2026-07-31",
        "grand_total": 4980,
        "rounded_total": 4980,
        "outstanding_amount": 2490,
        "currency": "MXN",
        "party_account_currency": "MXN",
        "pos_profile": "Doco Ventas",
    }
    source.update(overrides)
    return source


def shaped(**overrides):
    return receivables.shape_row(invoice(**overrides), TODAY)


class AgingTests(unittest.TestCase):
    def test_a_past_due_date_is_overdue(self):
        row = shaped(due_date="2026-07-31")

        self.assertEqual(row["aging"], "overdue")
        self.assertEqual(row["days_until_due"], -24)

    def test_due_today_is_not_late_yet(self):
        # An invoice is not late until the day AFTER the day it was due; a
        # register that reddens it at 09:00 on the due date is wrong all day.
        row = shaped(due_date=TODAY)

        self.assertEqual(row["aging"], "due_soon")
        self.assertEqual(row["days_until_due"], 0)

    def test_the_seventh_day_is_still_por_vencer(self):
        row = shaped(due_date="2026-08-31")

        self.assertEqual(row["days_until_due"], 7)
        self.assertEqual(row["aging"], "due_soon")

    def test_the_eighth_day_falls_out_of_por_vencer(self):
        row = shaped(due_date="2026-09-01")

        self.assertEqual(row["aging"], "upcoming")

    def test_a_missing_due_date_ages_off_the_posting_date(self):
        # The fallback the golden flow names. Treating "no due date" as "no
        # opinion" would file the oldest debt in the shop under «Todas», which
        # is the tab nobody opens.
        row = shaped(due_date=None, posting_date="2026-06-01")

        self.assertEqual(row["due"], "2026-06-01")
        self.assertEqual(row["aging"], "overdue")

    def test_an_undatable_invoice_is_never_claimed_to_be_overdue(self):
        row = shaped(due_date=None, posting_date=None)

        self.assertEqual(row["aging"], "upcoming")
        self.assertIsNone(row["days_until_due"])


class EstadoTests(unittest.TestCase):
    def test_a_part_paid_invoice_reads_as_an_apartado(self):
        row = shaped(grand_total=4980, rounded_total=4980, outstanding_amount=2490)

        self.assertEqual(row["paid"], 2490)
        self.assertEqual(row["estado"], "apartado")

    def test_the_apartado_chip_does_not_move_it_out_of_vencidas(self):
        # The artboard's first row: «Apartado» chip, Vencidas tab. The chip
        # says what happened to the money, the tab says what happened to the
        # calendar, and a cashier needs both.
        row = shaped(due_date="2026-07-31", outstanding_amount=2490)

        self.assertEqual(row["estado"], "apartado")
        self.assertEqual(row["aging"], "overdue")

    def test_an_untouched_invoice_wears_its_aging(self):
        row = shaped(outstanding_amount=4980, due_date="2026-07-31")

        self.assertEqual(row["paid"], 0)
        self.assertEqual(row["estado"], "overdue")

    def test_a_mixed_currency_invoice_reports_no_paid_figure_at_all(self):
        # `grand_total` is in the invoice's currency, `outstanding_amount` in
        # the party account's. Subtracting them would be arithmetic across two
        # units; absence is the honest answer and the panel omits the line.
        row = shaped(currency="USD", party_account_currency="MXN")

        self.assertIsNone(row["paid"])
        self.assertEqual(row["estado"], "overdue")
        self.assertEqual(row["currency"], "USD")
        self.assertEqual(row["outstanding_currency"], "MXN")

    def test_the_total_prefers_the_rounded_one_the_customer_was_charged(self):
        row = shaped(grand_total=4980.4, rounded_total=4980)

        self.assertEqual(row["total"], 4980)


class BucketTests(unittest.TestCase):
    def rows(self):
        return [
            receivables.shape_row(source, TODAY)
            for source in (
                invoice(name="F-1", due_date="2026-07-31"),           # overdue
                invoice(name="F-2", due_date="2026-08-13"),           # overdue
                invoice(name="F-3", due_date="2026-08-27"),           # due_soon
                invoice(name="F-4", due_date="2026-09-30"),           # upcoming
            )
        ]

    def test_todas_counts_everything_and_the_others_partition_it(self):
        counts = receivables.bucket_counts(self.rows())

        self.assertEqual(counts, {"overdue": 2, "due_soon": 1, "all": 4})

    def test_every_bucket_is_present_at_zero(self):
        # A tab that vanishes when it empties moves the row of tabs under the
        # cashier's finger between one search and the next.
        counts = receivables.bucket_counts([])

        self.assertEqual(sorted(counts), sorted(receivables.RECEIVABLE_BUCKETS))
        self.assertEqual(set(counts.values()), {0})

    def test_todas_takes_every_row(self):
        rows = self.rows()

        self.assertTrue(all(receivables.in_bucket(row, "all") for row in rows))
        self.assertTrue(all(receivables.in_bucket(row, None) for row in rows))

    def test_a_bucket_filter_keeps_only_its_own_aging(self):
        rows = self.rows()

        overdue = [row["name"] for row in rows if receivables.in_bucket(row, "overdue")]
        self.assertEqual(overdue, ["F-1", "F-2"])


class TotalsTests(unittest.TestCase):
    def test_the_stats_row_separates_owed_from_late(self):
        rows = [
            receivables.shape_row(source, TODAY)
            for source in (
                invoice(name="F-1", due_date="2026-07-31", outstanding_amount=2490),
                invoice(name="F-2", due_date="2026-08-13", outstanding_amount=1730),
                invoice(name="F-3", due_date="2026-09-30", outstanding_amount=2190),
            )
        ]

        totals = receivables.bucket_totals(rows)

        self.assertEqual(totals["outstanding"], 6410)
        self.assertEqual(totals["outstanding_count"], 3)
        self.assertEqual(totals["overdue"], 4220)
        self.assertEqual(totals["overdue_count"], 2)

    def test_the_oldest_overdue_is_the_sentence_that_gets_a_phone_picked_up(self):
        rows = [
            receivables.shape_row(source, TODAY)
            for source in (
                invoice(name="F-1", due_date="2026-07-31"),
                invoice(name="F-2", due_date="2026-08-13"),
            )
        ]

        self.assertEqual(receivables.bucket_totals(rows)["oldest_overdue_days"], 24)

    def test_nothing_overdue_reports_absence_rather_than_zero_days(self):
        # `0` is a real state — due today — so reporting it for "nothing is
        # late" would put «la más vieja 0 días» on a clean register.
        rows = [receivables.shape_row(invoice(due_date="2026-09-30"), TODAY)]

        self.assertIsNone(receivables.bucket_totals(rows)["oldest_overdue_days"])

    def test_an_empty_register_totals_to_nothing(self):
        totals = receivables.bucket_totals([])

        self.assertEqual(totals["outstanding"], 0)
        self.assertEqual(totals["overdue_count"], 0)
        self.assertIsNone(totals["oldest_overdue_days"])


class SearchTests(unittest.TestCase):
    def test_a_folio_narrows_the_list(self):
        row = shaped(name="ACC-SINV-2026-04711")

        self.assertTrue(receivables.matches_search(row, "04711"))
        self.assertFalse(receivables.matches_search(row, "04712"))

    def test_a_customer_name_narrows_it_too_and_ignores_case(self):
        row = shaped(customer_name="Taller Los Pinos")

        self.assertTrue(receivables.matches_search(row, "pinos"))
        self.assertTrue(receivables.matches_search(row, "TALLER"))

    def test_the_customer_id_matches_as_well_as_its_name(self):
        row = shaped(customer="CUST-0007", customer_name="Taller Los Pinos")

        self.assertTrue(receivables.matches_search(row, "cust-0007"))

    def test_an_empty_box_refines_nothing(self):
        # Search is a REFINEMENT of the visible bucket, never the entry
        # gesture: an empty box shows the whole bucket, not an empty list
        # waiting to be fed.
        row = shaped()

        self.assertTrue(receivables.matches_search(row, ""))
        self.assertTrue(receivables.matches_search(row, "   "))
        self.assertTrue(receivables.matches_search(row, None))


class DaysUntilTests(unittest.TestCase):
    def test_unusable_dates_answer_none_rather_than_guessing(self):
        self.assertIsNone(receivables.days_until(None, TODAY))
        self.assertIsNone(receivables.days_until(TODAY, None))
        self.assertIsNone(receivables.days_until("not a date", TODAY))

    def test_a_datetime_string_is_read_as_its_date(self):
        # `posting_date` comes back as a date, but a fallback that met a
        # datetime string would otherwise raise and age the row as undatable.
        self.assertEqual(receivables.days_until("2026-08-25 14:03:00", TODAY), 1)


if __name__ == "__main__":
    unittest.main()
