"""Printable custody evidence: permissions, escaping and plain-language output.

Runs without a site: frappe is stubbed so the renderer's own rules are what
gets asserted, not the framework's.
"""
import importlib.util
import json
import pathlib
import sys
import types
import unittest


class _Permission(Exception):
    pass


class _Validation(Exception):
    pass


def _install_framework_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.PermissionError = _Permission

    def throw(message, exc=_Validation):
        raise exc(message)

    frappe_module.throw = throw
    frappe_module._ = lambda message, *args, **kwargs: message
    frappe_module.get_doc = lambda *args, **kwargs: None
    frappe_module.db = types.SimpleNamespace(get_value=lambda *args, **kwargs: None)
    sys.modules["frappe"] = frappe_module

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.flt = lambda value, precision=None: float(value or 0)
    frappe_utils.fmt_money = lambda amount, precision=None, currency=None, format=None: (
        f"$ {float(amount or 0):,.2f} {currency or ''}".strip()
    )
    frappe_utils.format_datetime = lambda value, fmt=None: "16/09/2026 08:20:31"
    sys.modules["frappe.utils"] = frappe_utils
    return frappe_module


_previous_modules = {key: sys.modules.get(key) for key in ("frappe", "frappe.utils")}
FRAPPE = _install_framework_stubs()


def _load_module():
    name = "_custody_printing_under_test"
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name("printing.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


try:
    printing = _load_module()
finally:
    # Native Frappe test discovery must retain the real framework modules.
    for key, previous in _previous_modules.items():
        if previous is None:
            sys.modules.pop(key, None)
        else:
            sys.modules[key] = previous


class _Doc(dict):
    """Minimal stand-in for a custody document."""

    def __init__(self, **values):
        super().__init__(values)
        self.checked = []
        self.denied = set()

    def __getattr__(self, key):
        return self.get(key)

    def check_permission(self, permission_type):
        self.checked.append(permission_type)
        if permission_type in self.denied:
            FRAPPE.throw("No permission", FRAPPE.PermissionError)


def _bag(**overrides):
    values = dict(
        doctype="POS Cash Bag", name="CASH-BAG-00014", company="Grupo Doco",
        pos_profile="Custody QA", safe="CASH-SAFE-00002", currency="MXN", seal="QA-SEAL-001",
        purpose="Float", state="In Transit", amount=900, prepared_by="ana@example.com",
        creation="2026-09-16 08:20:31.425530",
        count_json=json.dumps({"denominations": [{"value": 100, "quantity": 9}], "source": "denominations"}),
    )
    values.update(overrides)
    return _Doc(**values)


def _count(**overrides):
    values = dict(
        doctype="POS Cash Count", name="CASH-COUNT-00031", company="Grupo Doco",
        pos_profile="Custody QA", safe="CASH-SAFE-00002", currency="MXN", scope="Drawer",
        state="Exception", amount=900, expected_amount=910, difference=-10,
        counted_by="ana@example.com", creation="2026-09-16 08:20:31.425530",
        count_json=json.dumps({"denominations": [{"value": 100, "quantity": 9}], "source": "denominations"}),
    )
    values.update(overrides)
    return _Doc(**values)


class _Site:
    """Routes frappe.get_doc / frappe.db.get_value at one prepared document."""

    def __init__(self, doc, safe_title="Safe QA"):
        self.doc = doc
        self.safe_title = safe_title

    def __enter__(self):
        FRAPPE.get_doc = lambda doctype, name, **kwargs: self.doc
        FRAPPE.db.get_value = self._get_value
        return self

    def __exit__(self, *args):
        FRAPPE.get_doc = lambda *a, **k: None
        FRAPPE.db.get_value = lambda *a, **k: None

    def _get_value(self, doctype, name, field, **kwargs):
        if doctype == "User":
            return {"ana@example.com": "Ana Torres"}.get(name)
        if doctype == "POS Cash Safe":
            return self.safe_title
        return None


class TestEvidenceGuards(unittest.TestCase):
    def test_rejects_unknown_doctype_and_layout(self):
        with self.assertRaises(_Validation):
            printing.evidence("Journal Entry", "JV-0001")
        with self.assertRaises(_Validation):
            printing.evidence("POS Cash Bag", "CASH-BAG-00014", layout="raw")
        with self.assertRaises(_Validation):
            printing.evidence("POS Cash Count", "CASH-COUNT-00031", layout="label")

    def test_requires_read_and_print_permission(self):
        doc = _bag()
        with _Site(doc):
            printing.evidence("POS Cash Bag", doc.name)
        self.assertEqual(doc.checked, ["read", "print"])

    def test_missing_print_permission_stops_rendering(self):
        doc = _bag()
        doc.denied.add("print")
        with _Site(doc), self.assertRaises(_Permission):
            printing.evidence("POS Cash Bag", doc.name)


class TestEvidenceContent(unittest.TestCase):
    def render(self, doc, **kwargs):
        with _Site(doc):
            return printing.evidence(doc.doctype, doc.name, **kwargs)

    def test_escapes_operator_supplied_text(self):
        doc = _bag(seal="<script>alert(1)</script>", note='Handed over by "Ana" & <b>Beto</b>')
        page = self.render(doc)
        self.assertNotIn("<script>", page)
        self.assertNotIn("<b>Beto</b>", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("&quot;Ana&quot; &amp; &lt;b&gt;", page)

    def test_escapes_manual_count_reason(self):
        doc = _bag(count_json=json.dumps(
            {"denominations": [], "source": "manual", "reason": "<img src=x onerror=alert(1)>"}))
        page = self.render(doc)
        self.assertNotIn("<img", page)
        self.assertIn("&lt;img", page)

    def test_no_raw_json_or_internal_state_names(self):
        page = self.render(_bag())
        self.assertNotIn("count_json", page)
        self.assertNotIn('"denominations"', page)
        self.assertNotIn(">In Transit<", page)
        self.assertIn("In transit to the bank", page)

    def test_money_and_dates_are_formatted(self):
        page = self.render(_bag())
        self.assertIn("$ 900.00 MXN", page)
        self.assertIn("16/09/2026 08:20:31", page)
        self.assertNotIn("2026-09-16 08:20:31.425530", page)

    def test_counted_rows_carry_amounts_and_a_total(self):
        page = self.render(_bag())
        self.assertIn("Counted notes and coins", page)
        self.assertIn("$ 100.00 MXN", page)

    def test_manual_count_has_no_empty_denomination_table(self):
        doc = _bag(count_json=json.dumps(
            {"denominations": [], "source": "manual", "reason": "Counted coins separately"}))
        page = self.render(doc)
        self.assertNotIn("<tbody></tbody>", page)
        self.assertNotIn("Count evidence", page)
        self.assertIn("Counted coins separately", page)

    def test_corrupt_count_json_still_prints_the_handover(self):
        page = self.render(_bag(count_json="{not json"))
        self.assertIn("QA-SEAL-001", page)
        self.assertIn("No denomination detail was recorded for this count.", page)

    def test_full_names_and_linked_records(self):
        doc = _bag(state="Deposited", deposit_journal="ACC-JV-00021", deposit_reference="LAB-BANK-99")
        page = self.render(doc)
        self.assertIn("Ana Torres", page)
        self.assertNotIn("ana@example.com", page)
        self.assertIn("Bank deposit journal", page)
        self.assertIn("LAB-BANK-99", page)

    def test_label_layout_is_a_bag_tag(self):
        page = self.render(_bag(), layout="label")
        self.assertIn("label-card", page)
        self.assertIn("QA-SEAL-001", page)
        self.assertIn("size:100mm 76mm", page)
        self.assertNotIn("Count evidence", page)
        self.assertNotIn('<footer class="signatures">', page)
        self.assertIn("Received by", self.render(_bag()))

    def test_count_slip_shows_counted_expected_and_shortage(self):
        page = self.render(_count())
        self.assertIn("Counted amount", page)
        self.assertIn("Expected", page)
        self.assertIn("Short", page)
        self.assertIn("$ 10.00 MXN", page)
        self.assertNotIn("Over", page)

    def test_count_slip_names_the_overage(self):
        page = self.render(_count(amount=920, difference=10))
        self.assertIn("Over", page)
        self.assertNotIn("Short", page)


class TestBatchEvidence(unittest.TestCase):
    def test_batch_checks_every_permission_before_rendering(self):
        from unittest.mock import patch
        a, b = _bag(name="A"), _bag(name="B")
        b.denied.add("print")
        with patch.object(FRAPPE,"get_doc",side_effect=lambda dt,n: {"A":a,"B":b}[n]):
            with self.assertRaises(_Permission):
                printing.bag_labels('["A","B"]')
        self.assertEqual(a.checked,["read","print"])
        self.assertEqual(b.checked,["read","print"])

    def test_batch_rejects_malformed_or_unbounded_selections(self):
        for value in ['broken',{},[],["A"]*51,[42]]:
            with self.subTest(value=value), self.assertRaises(_Validation):
                printing.bag_labels(value)

    def test_duplicate_selection_prints_only_once_with_denominations(self):
        with _Site(_bag()):
            page=printing.bag_labels('["A","A"]',layout="ticket")
        self.assertEqual(page.count('<article'),1)
        self.assertIn('width:72mm',page)
        self.assertIn('Counted notes and coins',page)

    def test_closing_selects_only_its_final_allocation_and_checks_scope(self):
        from unittest.mock import patch
        closing=_Doc(name="CLOSE-1",docstatus=1,cash_count="COUNT-1",pos_opening_shift="OPEN-1",company="Grupo Doco",pos_profile="Custody QA")
        count=_count(name="COUNT-1",closing_shift="CLOSE-1",opening_shift="OPEN-1")
        bag=_bag(name="BAG-1",opening_shift="OPEN-1")
        docs={"CLOSE-1":closing,"COUNT-1":count,"BAG-1":bag}
        def rows(dt,**kwargs):
            filters=kwargs['filters']
            if dt=='POS Cash Movement':
                self.assertEqual(filters['pos_opening_shift'],'OPEN-1')
                self.assertEqual(filters['docstatus'],1)
                ids=filters['client_request_id'][1]
                self.assertEqual(ids,[f'custody:close-COUNT-1-{i}' for i in range(20)])
                return ['FINAL-MOVE']
            self.assertEqual(filters['cash_movement'],['in',['FINAL-MOVE']])
            return ['BAG-1']
        with patch.object(FRAPPE,'get_doc',side_effect=lambda dt,n:docs[n]), patch.object(FRAPPE,'get_all',rows,create=True):
            page=printing.closing_labels('CLOSE-1')
            self.assertIn('CLOSE-1',page)
            self.assertEqual(closing.checked,['read','print'])
            self.assertEqual(bag.checked,['read','print'])
            bag.safe='OTHER-SAFE'
            with self.assertRaises(_Validation): printing.closing_labels('CLOSE-1')
            bag.safe=count.safe
            closing.docstatus=0
            with self.assertRaises(_Validation): printing.closing_labels('CLOSE-1')


if __name__ == "__main__":
    unittest.main()
