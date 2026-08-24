"""The Orden de servicio read model, as arithmetic.

Every function under test is pure — dicts in, dicts out — so these run without
a site, a Repair Order or a POS Charge Request. That is the point: the merge
rule these assert (a customer-supplied part is INVISIBLE in `items_json` and
has to be brought back from the workshop's own parts table) is the one thing
about this surface that cannot be seen by reading either source alone, and it
would be untestable if it only existed inside a whitelisted endpoint.
"""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

# `flt`/`cint` come from frappe.utils; without a frappe there is nothing to
# test. Skipped rather than failed when the standalone stub runner finds this.
try:
    import frappe  # noqa: F401
except ImportError:
    raise unittest.SkipTest("needs frappe - skipped under the standalone stub runner")

# Loaded BY PATH, not as `posawesome.posawesome.api.charge_request_read_model`.
# That package's `__init__` imports the whole API surface — customers, items,
# invoices — which needs an initialised site, so a package import turns this
# pure-function suite into an integration test that fails at collection time in
# `unittest discover`. The module itself depends on nothing but frappe.utils.
_MODULE_PATH = pathlib.Path(__file__).with_name("charge_request_read_model.py")
_spec = importlib.util.spec_from_file_location("posawesome_charge_request_read_model", _MODULE_PATH)
assert _spec and _spec.loader
read_model = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(read_model)


class ServiceOrderTitleTests(unittest.TestCase):
    def test_device_and_fault_read_as_one_line(self):
        title = read_model.order_title(
            {"source_label": "RO-00048 — Samsung A54"},
            {"device_model": "Samsung A54", "falla_reportada": "pantalla rota"},
        )

        self.assertEqual(title, "Samsung A54 · pantalla rota")

    def test_repair_type_stands_in_for_a_missing_fault(self):
        title = read_model.order_title(
            {}, {"device_model": "iPhone 12", "repair_to_be_done": "Centro de carga"}
        )

        self.assertEqual(title, "iPhone 12 · Centro de carga")

    def test_without_taller_the_request_label_is_the_title(self):
        title = read_model.order_title({"source_label": "Cita 88 — limpieza"}, None)

        self.assertEqual(title, "Cita 88 — limpieza")


class ServiceOrderCardTests(unittest.TestCase):
    def test_folio_is_the_repair_order_the_customer_holds(self):
        card = read_model.describe_order_card(
            {"name": "PCR-2026-00031", "reference_name": "RO-00048", "amount_total": 1910},
            {"name": "RO-00048", "status": "Listo para Entregar"},
        )

        self.assertEqual(card["folio"], "RO-00048")
        # The write endpoints all take the REQUEST, so it must survive too.
        self.assertEqual(card["name"], "PCR-2026-00031")

    def test_a_charged_request_says_so_and_names_its_invoice(self):
        card = read_model.describe_order_card(
            {"name": "PCR-1", "status": "Charged", "invoice": "ACC-SINV-2026-00214"}, None
        )

        self.assertTrue(card["invoiced"])
        self.assertEqual(card["invoice"], "ACC-SINV-2026-00214")

    def test_an_open_request_carries_no_invoice_reference(self):
        card = read_model.describe_order_card(
            {"name": "PCR-1", "status": "Open", "invoice": "leftover"}, None
        )

        self.assertFalse(card["invoiced"])
        self.assertIsNone(card["invoice"])

    def test_warranty_and_no_charge_come_from_the_repair_order(self):
        card = read_model.describe_order_card(
            {"name": "PCR-1", "amount_total": 0},
            {
                "name": "RO-2039",
                "is_warranty_claim": 1,
                "no_charge": 1,
                "warranty_period_days": 90,
                "advance_amount": 0,
            },
        )

        self.assertTrue(card["warranty"])
        self.assertTrue(card["no_charge"])
        self.assertEqual(card["warranty_days"], 90)

    def test_the_search_handles_ride_on_the_card(self):
        """The artboard's box says "Folio, IMEI o teléfono". All three have to
        be ON the card, or the surface cannot search without a round trip."""
        card = read_model.describe_order_card(
            {"name": "PCR-1", "customer_phone": "9991234567"},
            {"name": "RO-00048"},
            ["351234567894821"],
        )

        self.assertEqual(card["folio"], "RO-00048")
        self.assertEqual(card["serials"], ["351234567894821"])
        self.assertEqual(card["customer_phone"], "9991234567")

    def test_a_card_with_no_serials_carries_an_empty_list(self):
        card = read_model.describe_order_card({"name": "PCR-1"}, None)

        self.assertEqual(card["serials"], [])
        self.assertIsNone(card["customer_phone"])

    def test_without_taller_the_flags_are_false_not_missing(self):
        card = read_model.describe_order_card({"name": "PCR-1"}, None)

        self.assertFalse(card["warranty"])
        self.assertFalse(card["no_charge"])
        self.assertIsNone(card["warranty_days"])
        self.assertEqual(card["advance"], 0.0)


class ServiceOrderLineTests(unittest.TestCase):
    ITEMS = [
        {"item_code": "SERV-PANT", "qty": 1, "rate": 1450, "description": "Mano de obra — Pantalla"},
        {"item_code": "IPN002218", "qty": 1, "rate": 980},
    ]
    PARTS = [
        {"item": "IPN002218", "item_name": "Pantalla OLED Samsung A54", "qty": 1, "source": "Stock"},
        {
            "item": "IPN009001",
            "item_name": "Cristal trasero del cliente",
            "qty": 1,
            "source": "Customer-Supplied",
        },
    ]

    def test_the_labor_item_is_named_by_settings_not_by_its_description(self):
        lines = read_model.describe_order_lines(self.ITEMS, self.PARTS, "SERV-PANT")

        self.assertEqual(lines[0]["kind"], "labor")
        self.assertEqual(lines[0]["provenance"], "labor")
        self.assertEqual(lines[1]["kind"], "part")

    def test_a_billed_part_borrows_its_provenance_from_the_workshop(self):
        lines = read_model.describe_order_lines(self.ITEMS, self.PARTS, "SERV-PANT")

        stock_line = next(line for line in lines if line["item_code"] == "IPN002218")
        self.assertEqual(stock_line["provenance"], "stock")
        self.assertEqual(stock_line["item_name"], "Pantalla OLED Samsung A54")
        self.assertEqual(stock_line["amount"], 980.0)

    def test_a_customer_supplied_part_is_restored_at_zero(self):
        """The merge rule. `items_json` cannot contain this row — taller's
        `_billable_parts` filters it out — so it exists only here."""
        lines = read_model.describe_order_lines(self.ITEMS, self.PARTS, "SERV-PANT")

        own = next(line for line in lines if line["item_code"] == "IPN009001")
        self.assertEqual(own["provenance"], "customer_supplied")
        self.assertFalse(own["billable"])
        self.assertEqual(own["rate"], 0.0)
        self.assertEqual(own["amount"], 0.0)

    def test_an_unbilled_stock_part_is_not_invented_into_the_ticket(self):
        parts = [{"item": "IPN777", "item_name": "Tornillo", "qty": 2, "source": "Stock"}]

        lines = read_model.describe_order_lines([], parts, None)

        self.assertEqual(lines, [])

    def test_without_taller_every_billed_line_still_renders(self):
        lines = read_model.describe_order_lines(self.ITEMS, [], None)

        self.assertEqual(len(lines), 2)
        self.assertTrue(all(line["billable"] for line in lines))
        self.assertTrue(all(line["provenance"] == "stock" for line in lines))

    def test_two_rows_of_one_item_consume_two_parts(self):
        items = [
            {"item_code": "IPN002218", "qty": 1, "rate": 980},
            {"item_code": "IPN002218", "qty": 1, "rate": 980},
        ]
        parts = [
            {"item": "IPN002218", "source": "Stock", "serial_no": "A"},
            {"item": "IPN002218", "source": "Ordered", "serial_no": "B"},
        ]

        lines = read_model.describe_order_lines(items, parts, None)

        self.assertEqual([line["provenance"] for line in lines], ["stock", "ordered"])
        self.assertEqual([line["serial_no"] for line in lines], ["A", "B"])


class WorkedMinutesTests(unittest.TestCase):
    def test_a_finished_order_reports_its_bench_time(self):
        minutes = read_model.worked_minutes("2026-08-22 10:12:00", "2026-08-22 18:40:00")

        self.assertEqual(minutes, 8 * 60 + 28)

    def test_an_unfinished_order_reports_nothing_rather_than_zero(self):
        self.assertIsNone(read_model.worked_minutes("2026-08-22 10:12:00", None))
        self.assertIsNone(read_model.worked_minutes(None, None))

    def test_a_reversed_pair_is_refused_rather_than_shown_negative(self):
        self.assertIsNone(read_model.worked_minutes("2026-08-22 18:40:00", "2026-08-22 10:12:00"))


if __name__ == "__main__":
    unittest.main()
