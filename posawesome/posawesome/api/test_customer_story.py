"""The customer story's bounds and its shape.

What is worth pinning down here is not the queries — those are exercised by
using them — but the two things a read of a person's commercial history must
never get wrong: how far back it looks, and how much it hands over.

`_bounded` is the whole of that. It is the reason `days=99999` from a client
cannot turn a POS surface into a five-year table scan, and the reason a
nonsense value falls back to the stated default rather than to zero, which
would produce an empty story that looks like a quiet customer.
"""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

try:
    import frappe  # noqa: F401
except ImportError:
    raise unittest.SkipTest("needs frappe - skipped under the standalone stub runner")


def _load(module_name: str, filename: str):
    """Load a sibling by path — the api package's `__init__` needs a site."""
    path = pathlib.Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


story = _load("posawesome_customer_story", "customer_story.py")


class WindowTests(unittest.TestCase):
    def test_the_default_window_and_cap_are_the_ones_the_ui_states(self):
        self.assertEqual(story.CUSTOMER_STORY_DAYS, 90)
        self.assertEqual(story.CUSTOMER_STORY_CAP, 50)

    def test_a_client_cannot_widen_the_window_past_a_year(self):
        self.assertEqual(story._bounded(99999, 90, story.MAX_STORY_DAYS), story.MAX_STORY_DAYS)

    def test_a_client_cannot_ask_for_more_events_than_the_ceiling(self):
        self.assertEqual(story._bounded(5000, 50, story.MAX_STORY_CAP), story.MAX_STORY_CAP)

    def test_nonsense_falls_back_to_the_default_not_to_zero(self):
        # Zero would produce an empty story, which reads as a quiet customer
        # rather than as a bad argument.
        for value in (None, "", "abc", 0, -30, [1]):
            self.assertEqual(story._bounded(value, 90, story.MAX_STORY_DAYS), 90)

    def test_a_sensible_narrowing_is_honoured(self):
        self.assertEqual(story._bounded(30, 90, story.MAX_STORY_DAYS), 30)
        self.assertEqual(story._bounded("30", 90, story.MAX_STORY_DAYS), 30)


class ShapeTests(unittest.TestCase):
    def test_it_pours_into_the_same_shape_as_a_single_document(self):
        # One shape for all four legs is what lets ONE component render the
        # repair order, the sales order and the customer.
        assembled = story.assemble_story(
            [
                story.event("2026-08-22", "billing", "invoiced", amount=1310),
                story.event("2026-08-19", "payment", "payment", amount=600),
            ],
            cap=story.CUSTOMER_STORY_CAP,
        )

        self.assertEqual(set(assembled), {"events", "truncated", "cap", "dropped_undated"})
        self.assertEqual(assembled["events"][0]["ts"], "2026-08-22")

    def test_a_credit_note_is_its_own_topic_not_a_negative_total(self):
        # It is the row a customer is most likely to be asking about, and a
        # negative figure is not read as negative at a counter.
        row = story.event("2026-08-20", "billing", "returned", amount=340)
        self.assertEqual(row["topic"], "returned")


if __name__ == "__main__":
    unittest.main()
