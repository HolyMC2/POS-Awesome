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

# `customer_story` reuses `order_story`'s `event`, `assemble_story` and
# `payment_events` — a package import, which is exactly what the isolated
# loader is avoiding. So the sibling is loaded in isolation FIRST and handed
# in under its package name, and both come back with the same `event` object.
_order_story = _isolated.load_api_module("posawesome_order_story_for_customer", "order_story.py")
story = _isolated.load_api_module(
    "posawesome_customer_story",
    "customer_story.py",
    extra={"posawesome.posawesome.api.order_story": _order_story},
)


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
