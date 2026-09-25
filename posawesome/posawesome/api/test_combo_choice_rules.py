"""The paquete voucher's rules (``combo_choice_rules``), with no site.

A paquete's picked lines sell at $0 or at their extra charge — exactly what
the price guards refuse — so these rules are the only thing standing between
a register and a $0 line nobody paid for. Every test states the ticket a
cafetería would ring and what the voucher must say about it.

The subject imports nothing but ``typing``; it is loaded by path so the
package ``__init__`` (which imports frappe) never runs under the standalone
``unittest discover`` suite.
"""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

_PATH = pathlib.Path(__file__).with_name("combo_choice_rules.py")
_spec = importlib.util.spec_from_file_location("posawesome_combo_choice_rules", _PATH)
assert _spec and _spec.loader
rules = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rules)


DESAYUNO = {
    "name": "CAFE-PAQ-DESAYUNO",
    "combo_item": "CAFE-PAQ-DESAYUNO",
    "groups": [
        {
            "name": "Bebida",
            "min": 1,
            "max": 1,
            "item_group": None,
            "options": [
                {"item_code": "CAFE-AMERICANO", "qty": 1.0, "extra_price": 0.0},
                {"item_code": "CAFE-LATTE", "qty": 1.0, "extra_price": 10.0},
            ],
        },
        {
            "name": "Pan",
            "min": 1,
            "max": 2,
            "item_group": "Panaderia",
            "options": [{"item_code": "CAFE-CONCHA", "qty": 1.0, "extra_price": 0.0}],
        },
        {
            "name": "Extras",
            "min": 0,
            "max": 1,
            "item_group": None,
            "options": [{"item_code": "CAFE-TOCINO", "qty": 2.0, "extra_price": 15.0}],
        },
    ],
}
DEFINITIONS = {"CAFE-PAQ-DESAYUNO": DESAYUNO}
MEMBERS = {"Panaderia": {"CAFE-CONCHA", "CAFE-CUERNO"}}


def header(qty=1, row="H1", idx=1):
    return {"idx": idx, "item_code": "CAFE-PAQ-DESAYUNO", "item_name": "Combo Desayuno",
            "qty": qty, "rate": 129.0, "posa_row_id": row}


def pick(item, group, qty=1.0, rate=0.0, parent="H1", idx=2, **extra):
    line = {"idx": idx, "item_code": item, "item_name": item, "qty": qty, "rate": rate,
            "posa_row_id": f"{parent}-{item}-{idx}", "posa_combo_parent": parent,
            "posa_combo_group": group}
    line.update(extra)
    return line


def evaluate(lines, **kwargs):
    kwargs.setdefault("item_group_members", MEMBERS)
    return rules.evaluate_combo_lines(lines, DEFINITIONS, **kwargs)


class TestSaleRules(unittest.TestCase):
    def test_ticket_without_picks_is_untouched(self):
        self.assertEqual(evaluate([header()]), ([], []))

    def test_complete_paquete_vouches_every_pick_by_identity(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3)]
        vouched, errors = evaluate(lines)
        self.assertEqual(errors, [])
        # The guards compare by id(): the voucher must hand back the SAME objects.
        self.assertEqual([id(line) for line in vouched], [id(lines[1]), id(lines[2])])

    def test_upcharge_rides_the_picked_line(self):
        lines = [header(), pick("CAFE-LATTE", "Bebida", rate=10.0), pick("CAFE-CONCHA", "Pan", idx=3)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_upcharged_option_at_zero_is_refused(self):
        lines = [header(), pick("CAFE-LATTE", "Bebida", rate=0.0), pick("CAFE-CONCHA", "Pan", idx=3)]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("extra charge", errors[0])

    def test_discount_on_a_pick_is_refused(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida", discount_percentage=10),
                 pick("CAFE-CONCHA", "Pan", idx=3)]
        self.assertEqual(evaluate(lines)[0], [])

    def test_missing_required_group_refuses_the_whole_paquete(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida")]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("Pan", errors[0])

    def test_too_many_picks_is_refused(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-LATTE", "Bebida", rate=10.0, idx=3),
                 pick("CAFE-CONCHA", "Pan", idx=4)]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("Bebida", errors[0])

    def test_repeat_pick_counts_twice_up_to_max(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", qty=2, idx=3)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_item_group_member_is_an_option_at_no_charge(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CUERNO", "Pan", idx=3)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_item_outside_the_group_is_refused(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-DONA", "Pan", idx=3)]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("not an option", errors[0])

    def test_option_in_the_wrong_group_is_refused(self):
        lines = [header(), pick("CAFE-CONCHA", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3)]
        self.assertEqual(evaluate(lines)[0], [])

    def test_optional_group_with_multi_unit_option(self):
        # «Tocino» is two strips per pick at $15 the pick: $7.50 a strip.
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3),
                 pick("CAFE-TOCINO", "Extras", qty=2, rate=7.5, idx=4)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_partial_pick_quantity_is_refused(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3),
                 pick("CAFE-TOCINO", "Extras", qty=1, rate=7.5, idx=4)]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("whole picks", errors[0])

    def test_picks_scale_with_the_paquete_quantity(self):
        lines = [header(qty=2), pick("CAFE-AMERICANO", "Bebida", qty=2), pick("CAFE-CONCHA", "Pan", qty=2, idx=3)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_stock_qty_wins_over_qty_times_factor(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida", qty=0.5, conversion_factor=2, stock_qty=1),
                 pick("CAFE-CONCHA", "Pan", idx=3)]
        self.assertEqual(evaluate(lines)[1], [])

    def test_orphan_pick_is_refused(self):
        lines = [pick("CAFE-AMERICANO", "Bebida", parent="GONE")]
        vouched, errors = evaluate(lines)
        self.assertEqual(vouched, [])
        self.assertIn("not on this ticket", errors[0])

    def test_pick_cannot_name_another_pick_as_its_paquete(self):
        first = pick("CAFE-AMERICANO", "Bebida")
        second = pick("CAFE-CONCHA", "Pan", parent=first["posa_row_id"], idx=3)
        self.assertEqual(evaluate([header(), first, second])[0], [])

    def test_retired_paquete_is_refused(self):
        lines = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3)]
        vouched, errors = rules.evaluate_combo_lines(lines, {}, item_group_members=MEMBERS)
        self.assertEqual(vouched, [])
        self.assertIn("no longer a paquete", errors[0])

    def test_one_bad_paquete_does_not_refuse_a_good_one(self):
        good = [header(), pick("CAFE-AMERICANO", "Bebida"), pick("CAFE-CONCHA", "Pan", idx=3)]
        bad = [header(row="H2", idx=4), pick("CAFE-AMERICANO", "Bebida", parent="H2", idx=5)]
        vouched, errors = evaluate(good + bad)
        self.assertEqual(len(vouched), 2)
        self.assertEqual(len(errors), 1)

    def test_extra_charge_converts_to_invoice_currency(self):
        # Extra charges are company currency; a USD ticket at 20 MXN/USD
        # charges the $10 latte upcharge as 0.50.
        lines = [header(), pick("CAFE-LATTE", "Bebida", rate=0.5), pick("CAFE-CONCHA", "Pan", idx=3)]
        self.assertEqual(evaluate(lines, conversion_rate=20)[1], [])

    def test_translate_is_applied_to_reasons(self):
        lines = [pick("CAFE-AMERICANO", "Bebida", parent="GONE")]
        _vouched, errors = evaluate(lines, translate=lambda text: "ES:" + text)
        self.assertTrue(errors[0].startswith("ES:"))


class TestReturnRules(unittest.TestCase):
    SOLD = {
        ("H1", "CAFE-LATTE", "Bebida"): {"rate": 10.0, "units": 1.0},
        ("H1", "CAFE-CONCHA", "Pan"): {"rate": 0.0, "units": 2.0},
    }

    def test_partial_return_of_one_pick_is_vouched(self):
        lines = [pick("CAFE-CONCHA", "Pan", qty=-1)]
        vouched, errors = evaluate(lines, original_components=self.SOLD)
        self.assertEqual(errors, [])
        self.assertEqual(len(vouched), 1)

    def test_return_must_keep_the_sale_price(self):
        lines = [pick("CAFE-LATTE", "Bebida", qty=-1, rate=0.0)]
        self.assertEqual(evaluate(lines, original_components=self.SOLD)[0], [])

    def test_return_cannot_exceed_what_was_sold(self):
        lines = [pick("CAFE-CONCHA", "Pan", qty=-3)]
        vouched, errors = evaluate(lines, original_components=self.SOLD)
        self.assertEqual(vouched, [])
        self.assertIn("more than", errors[0])

    def test_return_of_an_unsold_pick_is_refused(self):
        lines = [pick("CAFE-AMERICANO", "Bebida", qty=-1)]
        self.assertEqual(evaluate(lines, original_components=self.SOLD)[0], [])


class TestFindOption(unittest.TestCase):
    def test_explicit_row_wins_over_item_group(self):
        group = {"options": [{"item_code": "CAFE-CONCHA", "qty": 1.0, "extra_price": 5.0}],
                 "item_group": "Panaderia"}
        self.assertEqual(rules.find_option(group, "CAFE-CONCHA", MEMBERS)["extra_price"], 5.0)

    def test_item_group_member_is_free_and_single(self):
        group = {"options": [], "item_group": "Panaderia"}
        option = rules.find_option(group, "CAFE-CUERNO", MEMBERS)
        self.assertEqual((option["qty"], option["extra_price"]), (1.0, 0.0))


if __name__ == "__main__":
    unittest.main()
