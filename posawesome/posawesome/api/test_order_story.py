"""The order story's assembly rules.

The gatherers are queries and are exercised by using them; what is worth
pinning down is the shape they all pour into, because every one of the three
legs — repair, sales order, customer — depends on it behaving the same way.

Three rules, and all three are refusals:

1. An event with no timestamp is DROPPED, never dated "now". A fact placed on
   a timeline at a time it did not happen is worse than a fact left off it.
2. A capped story SAYS it was capped. Silently stopping at the cap tells a
   cashier the account began there, and the oldest row is usually what they
   are looking for on a long-running customer.
3. No event carries a sentence — only keys, an amount and an actor. The SPA
   holds `es.csv`; the server does not get to choose the operator's words.
"""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

# Loaded through `test_support/isolated_module`, which stubs the subject's
# module-level imports and RESTORES `sys.modules` afterwards. Read its header
# before changing this: two earlier shapes — importing through the package, and
# repairing the real `frappe` in place — each broke a different part of the
# suite, and it records which and why.
_HELPER = pathlib.Path(__file__).with_name("test_support") / "isolated_module.py"
_spec = importlib.util.spec_from_file_location("posawesome_isolated_module", _HELPER)
assert _spec and _spec.loader
_isolated = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_isolated)

story = _isolated.load_api_module("posawesome_order_story", "order_story.py")


class EventShapeTests(unittest.TestCase):
    def test_an_event_is_keys_and_figures_only(self):
        row = story.event(
            "2026-08-19 14:22:00",
            "payment",
            "advance",
            amount=600,
            actor="jenni@doco.mx",
            detail="Efectivo",
            doctype="Payment Entry",
            name="ACC-PAY-2026-00031",
        )

        self.assertEqual(
            set(row),
            {"ts", "kind", "topic", "amount", "actor", "detail", "doctype", "name"},
        )
        self.assertEqual(row["kind"], "payment")
        self.assertEqual(row["topic"], "advance")
        self.assertEqual(row["amount"], 600.0)

    def test_an_absent_amount_stays_absent_rather_than_becoming_zero(self):
        # A status change has no amount. Zero would render as «$0.00» beside a
        # row that is not about money at all.
        row = story.event("2026-08-21 09:00:00", "movement", "work_started")
        self.assertIsNone(row["amount"])

    def test_blank_actors_and_details_come_back_as_none(self):
        row = story.event("2026-08-21 09:00:00", "movement", actor="", detail="")
        self.assertIsNone(row["actor"])
        self.assertIsNone(row["detail"])

    def test_a_missing_timestamp_is_none_not_now(self):
        self.assertIsNone(story.event(None, "movement")["ts"])
        self.assertIsNone(story.event("", "movement")["ts"])


class AssemblyTests(unittest.TestCase):
    def _events(self):
        return [
            story.event("2026-08-19 14:22:00", "payment", "advance", amount=600),
            story.event("2026-08-22 11:05:00", "billing", "invoiced", amount=1310),
            story.event("2026-08-20 09:41:00", "consumption", "stock"),
        ]

    def test_newest_first_because_that_is_what_is_asked_at_a_counter(self):
        assembled = story.assemble_story(self._events())
        self.assertEqual(
            [row["ts"] for row in assembled["events"]],
            ["2026-08-22 11:05:00", "2026-08-20 09:41:00", "2026-08-19 14:22:00"],
        )

    def test_undated_events_are_dropped_and_counted(self):
        events = self._events() + [story.event(None, "consumption", "customer_supplied")]
        assembled = story.assemble_story(events)

        self.assertEqual(len(assembled["events"]), 3)
        self.assertEqual(assembled["dropped_undated"], 1)

    def test_a_capped_story_says_so(self):
        events = [story.event(f"2026-08-{day:02d} 10:00:00", "movement") for day in range(1, 11)]

        assembled = story.assemble_story(events, cap=4)

        self.assertEqual(len(assembled["events"]), 4)
        self.assertTrue(assembled["truncated"])
        self.assertEqual(assembled["cap"], 4)

    def test_a_story_inside_the_cap_does_not_claim_to_be_cut(self):
        assembled = story.assemble_story(self._events(), cap=10)
        self.assertFalse(assembled["truncated"])

    def test_an_empty_document_is_an_empty_story_not_an_error(self):
        assembled = story.assemble_story([])
        self.assertEqual(assembled["events"], [])
        self.assertFalse(assembled["truncated"])

    def test_a_bare_date_sorts_against_a_full_timestamp_on_the_same_day(self):
        # A posting_date with no time is "that day, time unknown" — it must
        # not silently outrank a stamped event from the same afternoon.
        events = [
            story.event("2026-08-22", "billing", "invoiced"),
            story.event("2026-08-22 11:05:00", "payment", "payment"),
        ]
        assembled = story.assemble_story(events)
        self.assertEqual(assembled["events"][0]["kind"], "payment")


class VocabularyTests(unittest.TestCase):
    def test_only_documents_with_a_hand_written_leg_have_a_story(self):
        # "The events of a document" is not a generic question: a Sales Order's
        # story is its deliveries and invoices, a Repair Order's is its bench
        # log. An open-ended doctype argument would be a read of anything.
        self.assertEqual(set(story.STORY_DOCTYPES), {"Repair Order", "Sales Order"})

    def test_the_kinds_are_a_closed_set(self):
        self.assertEqual(
            set(story.EVENT_KINDS),
            {"created", "payment", "consumption", "movement", "billing", "delivery"},
        )


if __name__ == "__main__":
    unittest.main()
