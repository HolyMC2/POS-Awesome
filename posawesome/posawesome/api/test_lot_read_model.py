"""The SERIES Y LOTES read model, asserted without a site.

`lot_read_model` imports no frappe, so these run under the same
`python -m unittest discover -s posawesome/posawesome/api` the backend CI
uses, with nothing stubbed.  What they pin is the counter's reading of the
ledger: which movement is the latest, what «sold» means, which unit this
register may put on a ticket, and how a batch lands in a tab.
"""

import importlib.util
import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _load():
    file_path = REPO_ROOT / "posawesome" / "posawesome" / "api" / "lot_read_model.py"
    spec = importlib.util.spec_from_file_location("test_lot_read_model_target", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


model = _load()

TODAY = "2026-09-05"


class QueryNormalisation(unittest.TestCase):
    def test_a_dictated_imei_loses_its_spaces_and_dashes(self):
        # «35 3150 4004-43913» is how an IMEI gets read out over the counter.
        self.assertEqual(model.normalize_query(" 35 3150 4004-43913\n"), "353150400443913")

    def test_words_keep_their_spaces_but_collapse_runs(self):
        self.assertEqual(model.normalize_query("  Samsung   A17 "), "Samsung A17")

    def test_empty_is_empty(self):
        self.assertEqual(model.normalize_query(None), "")
        self.assertEqual(model.normalize_query("   "), "")

    def test_an_unknown_status_reads_the_whole_set(self):
        self.assertEqual(model.normalize_bucket("Delivered"), "Delivered")
        self.assertEqual(model.normalize_bucket("sold"), "all")
        self.assertEqual(model.normalize_bucket(None), "all")

    def test_the_page_is_bounded(self):
        self.assertEqual(model.clamp_page(None, None), (model.DEFAULT_PAGE, 0))
        self.assertEqual(model.clamp_page(10_000, -4), (model.MAX_PAGE, 0))
        self.assertEqual(model.clamp_page("25", "50"), (25, 50))
        self.assertEqual(model.clamp_page("x", "y"), (model.DEFAULT_PAGE, 0))


class LatestMovement(unittest.TestCase):
    def test_the_newest_live_entry_wins_per_serial(self):
        entries = [
            {"serial_no": "A", "voucher_type": "Purchase Invoice", "voucher_no": "PINV-1",
             "posting_datetime": "2026-07-30 19:27:26", "creation": "2026-07-30 19:27:27", "is_outward": 0},
            {"serial_no": "A", "voucher_type": "Sales Invoice", "voucher_no": "SINV-9",
             "posting_datetime": "2026-08-04 14:09:36", "creation": "2026-08-04 14:09:37", "is_outward": 1,
             "warehouse": "Tienda"},
            {"serial_no": "B", "voucher_type": "Purchase Receipt", "voucher_no": "PREC-2",
             "posting_datetime": "2026-08-01 08:00:00", "creation": "2026-08-01 08:00:01", "is_outward": 0},
        ]
        latest = model.latest_movement_by_serial(entries)
        self.assertEqual(latest["A"]["voucher_no"], "SINV-9")
        self.assertTrue(latest["A"]["outward"])
        self.assertEqual(latest["A"]["warehouse"], "Tienda")
        self.assertEqual(latest["B"]["voucher_no"], "PREC-2")
        self.assertNotIn("_key", latest["A"])

    def test_a_backdated_document_ties_on_posting_and_loses_on_creation(self):
        entries = [
            {"serial_no": "A", "voucher_no": "LATE", "posting_datetime": "2026-08-04 14:09:36",
             "creation": "2026-09-01 10:00:00"},
            {"serial_no": "A", "voucher_no": "FIRST", "posting_datetime": "2026-08-04 14:09:36",
             "creation": "2026-08-04 14:09:37"},
        ]
        self.assertEqual(model.latest_movement_by_serial(entries)["A"]["voucher_no"], "LATE")

    def test_rows_without_a_serial_are_ignored(self):
        self.assertEqual(model.latest_movement_by_serial([{"serial_no": "", "voucher_no": "X"}]), {})


class RowShape(unittest.TestCase):
    def test_a_delivered_serial_names_the_ticket_that_took_it(self):
        row = model.shape_row(
            {"name": "353150400443913", "item_code": "IPN004625", "item_name": "Samsung A17",
             "status": "Delivered", "warehouse": None, "customer": "ALEJANDRO VAZQUEZ",
             "posting_date": "2026-07-30"},
            {"voucher_type": "Sales Invoice", "voucher_no": "ACC-SINV-2026-02707",
             "posting_datetime": "2026-08-04T14:09:36.004213", "outward": True},
        )
        self.assertEqual(row["serial_no"], "353150400443913")
        self.assertEqual(row["status"], "Delivered")
        self.assertEqual(row["last_voucher_no"], "ACC-SINV-2026-02707")
        self.assertEqual(row["last_moved_at"], "2026-08-04 14:09:36")
        self.assertTrue(row["last_outward"])
        self.assertIsNone(row["warehouse"])

    def test_a_blank_status_reads_unknown_and_no_movement_reads_none(self):
        row = model.shape_row({"name": "245356566555", "item_code": "X", "status": ""})
        self.assertEqual(row["status"], "Unknown")
        self.assertIsNone(row["last_voucher_no"])
        self.assertIsNone(row["last_outward"])
        self.assertEqual(row["item_name"], "X")

    def test_only_an_active_unit_in_this_registers_warehouse_is_sellable(self):
        here = {"status": "Active", "warehouse": "Tienda - D"}
        self.assertTrue(model.sellable_here(here, "Tienda - D"))
        self.assertFalse(model.sellable_here(here, "Bodega - D"))
        self.assertFalse(model.sellable_here({"status": "Delivered", "warehouse": None}, "Tienda - D"))
        self.assertFalse(model.sellable_here(here, None))


class Story(unittest.TestCase):
    def _movements(self):
        return [
            model.shape_movement(
                {"voucher_type": "Purchase Invoice", "voucher_no": "PINV-1", "posting_datetime": "2026-07-30 19:27:26",
                 "is_outward": 0, "qty": 1, "docstatus": 1, "is_cancelled": 0, "warehouse": "Tienda"},
                {"supplier_name": "XMovil", "posting_date": "2026-07-30", "docstatus": 1},
            ),
            model.shape_movement(
                {"voucher_type": "Sales Invoice", "voucher_no": "SINV-CANCELLED", "posting_datetime": "2026-08-02 10:00:00",
                 "is_outward": 1, "qty": -1, "docstatus": 2, "is_cancelled": 1, "warehouse": "Tienda"},
                {"customer_name": "Alguien", "docstatus": 2},
            ),
            model.shape_movement(
                {"voucher_type": "Stock Entry", "voucher_no": "MAT-STE-7", "posting_datetime": "2026-08-03 09:00:00",
                 "is_outward": 1, "qty": -1, "docstatus": 1, "is_cancelled": 0, "warehouse": "Tienda"},
                {"stock_entry_type": "Material Issue", "docstatus": 1},
            ),
            model.shape_movement(
                {"voucher_type": "Sales Invoice", "voucher_no": "SINV-9", "posting_datetime": "2026-08-04 14:09:36",
                 "is_outward": 1, "qty": -1, "docstatus": 1, "is_cancelled": 0, "warehouse": "Tienda"},
                {"customer_name": "ALEJANDRO VAZQUEZ", "grand_total": 4299.0, "owner": "caja@doco", "docstatus": 1},
            ),
        ]

    def test_movements_read_newest_first(self):
        ordered = model.order_movements(self._movements())
        self.assertEqual([m["voucher_no"] for m in ordered], ["SINV-9", "MAT-STE-7", "SINV-CANCELLED", "PINV-1"])

    def test_the_party_comes_from_whichever_voucher_it_was(self):
        by_no = {m["voucher_no"]: m for m in self._movements()}
        self.assertEqual(by_no["PINV-1"]["party"], "XMovil")
        self.assertEqual(by_no["SINV-9"]["party"], "ALEJANDRO VAZQUEZ")
        self.assertEqual(by_no["MAT-STE-7"]["party"], "Material Issue")
        self.assertEqual(by_no["SINV-9"]["grand_total"], 4299.0)
        self.assertTrue(by_no["SINV-CANCELLED"]["cancelled"])
        self.assertFalse(by_no["SINV-9"]["cancelled"])

    def test_sold_on_is_the_live_sale_never_the_cancelled_one_nor_an_issue(self):
        sold = model.sold_on(self._movements())
        self.assertEqual(sold["voucher_no"], "SINV-9")
        # Drop the live sale: the cancelled ticket must NOT become the answer,
        # and the Stock Entry is a consumption, not a sale.
        without = [m for m in self._movements() if m["voucher_no"] != "SINV-9"]
        self.assertIsNone(model.sold_on(without))

    def test_voucher_party_fields_fall_back_for_an_unknown_doctype(self):
        self.assertIn("customer_name", model.voucher_party_fields("Sales Invoice"))
        self.assertEqual(model.voucher_party_fields("Asset Movement"), ("posting_date", "owner", "docstatus"))


class Batches(unittest.TestCase):
    def _rows(self):
        stock = model.stock_by_batch(
            [
                {"batch_no": "LOTE-A", "warehouse": "Tienda", "qty": 4},
                {"batch_no": "LOTE-A", "warehouse": "Bodega", "qty": 6},
                {"batch_no": "LOTE-VIEJO", "warehouse": "Tienda", "qty": 2},
                {"batch_no": "LOTE-VACIO", "warehouse": "Tienda", "qty": 0},
                {"batch_no": "LOTE-NEG", "warehouse": "Tienda", "qty": -1},
            ]
        )
        heads = [
            {"name": "LOTE-A", "item": "PARA", "item_name": "Paracetamol", "expiry_date": "2026-09-20"},
            {"name": "LOTE-VIEJO", "item": "PARA", "item_name": "Paracetamol", "expiry_date": "2026-08-01"},
            {"name": "LOTE-VACIO", "item": "PARA", "item_name": "Paracetamol", "expiry_date": None},
            {"name": "LOTE-SINFECHA", "item": "PARA", "item_name": "Paracetamol", "expiry_date": None},
        ]
        stock["LOTE-SINFECHA"] = [{"warehouse": "Tienda", "qty": 1}]
        return [model.shape_batch_row(h, stock.get(h["name"]), "Tienda", TODAY) for h in heads]

    def test_stock_is_split_by_warehouse_and_zero_rows_are_dropped(self):
        stock = model.stock_by_batch(
            [
                {"batch_no": "L", "warehouse": "Tienda", "qty": 1},
                {"batch_no": "L", "warehouse": "Bodega", "qty": 3},
                {"batch_no": "L", "warehouse": "Merma", "qty": 0},
            ]
        )
        self.assertEqual([r["warehouse"] for r in stock["L"]], ["Bodega", "Tienda"])

    def test_a_row_knows_how_much_is_here_and_how_much_anywhere(self):
        row = next(r for r in self._rows() if r["batch_no"] == "LOTE-A")
        self.assertEqual(row["total_qty"], 10)
        self.assertEqual(row["qty_here"], 4)
        self.assertEqual(row["days_to_expiry"], 15)
        self.assertEqual(row["tone"], "soon")

    def test_every_batch_lands_in_exactly_one_tab(self):
        rows = self._rows()
        self.assertEqual(model.batch_counts(rows), {"available": 2, "all": 4, "expired": 1, "empty": 1})
        self.assertEqual([r["batch_no"] for r in model.bucket_batches(rows, "expired")], ["LOTE-VIEJO"])
        self.assertEqual([r["batch_no"] for r in model.bucket_batches(rows, "empty")], ["LOTE-VACIO"])

    def test_fefo_puts_the_dated_batch_before_the_undated_one(self):
        self.assertEqual(
            [r["batch_no"] for r in model.bucket_batches(self._rows(), "available")],
            ["LOTE-A", "LOTE-SINFECHA"],
        )
        self.assertEqual(
            [r["batch_no"] for r in model.bucket_batches(self._rows(), "all")],
            ["LOTE-VIEJO", "LOTE-A", "LOTE-SINFECHA", "LOTE-VACIO"],
        )

    def test_only_a_live_batch_with_units_here_is_sellable(self):
        rows = {r["batch_no"]: r for r in self._rows()}
        self.assertTrue(model.batch_sellable_here(rows["LOTE-A"], "Tienda"))
        self.assertFalse(model.batch_sellable_here(rows["LOTE-VIEJO"], "Tienda"))
        self.assertFalse(model.batch_sellable_here(rows["LOTE-VACIO"], "Tienda"))
        # Bodega holds six of LOTE-A, so a register on Bodega may sell it; one
        # on Merma, where no unit sits, may not.
        self.assertTrue(model.batch_sellable_here(rows["LOTE-A"], "Bodega"))
        self.assertFalse(model.batch_sellable_here(rows["LOTE-A"], "Merma"))
        disabled = dict(rows["LOTE-A"], disabled=True)
        self.assertFalse(model.batch_sellable_here(disabled, "Tienda"))

    def test_expiry_tone_reads_the_calendar(self):
        self.assertEqual(model.expiry_tone(None), "none")
        self.assertEqual(model.expiry_tone(-1), "expired")
        self.assertEqual(model.expiry_tone(0), "soon")
        self.assertEqual(model.expiry_tone(30), "soon")
        self.assertEqual(model.expiry_tone(31), "ok")
        self.assertEqual(model.days_until("2026-09-20", TODAY), 15)
        self.assertIsNone(model.days_until("not a date", TODAY))


if __name__ == "__main__":
    unittest.main()
