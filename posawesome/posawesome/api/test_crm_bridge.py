"""The CRM seam, against fixtures — never against a live CRM.

Every fact these assert is a REFUSAL, because the three ways this integration
could go wrong are all things it must decline to do:

  * write on the submit path (it enqueues, after commit, and returns),
  * create a CRM record automatically (only a person pressing «Seguimiento»
    may do that),
  * act on an ambiguous match (a note on the wrong deal is a fact somebody
    will act on).

`frappe` is replaced on the module rather than in `sys.modules`: the sibling
stub suites poison the real module for everything that runs after them, and
this one has to be safe under `unittest discover` and under bench alike.
"""

from __future__ import annotations

import importlib.util
import pathlib
import types
import unittest
from unittest import mock

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

bridge = _isolated.load_api_module("posawesome_crm_bridge", "crm_bridge.py")


class _Doc(dict):
    """A `frappe.get_doc` result that remembers it was inserted."""

    def __init__(self, payload):
        super().__init__(payload)
        self.name = f"NEW-{payload.get('doctype', 'DOC')}"
        self.inserted = False

    def insert(self, **_kwargs):
        self.inserted = True
        return self


class _FakeFrappe:
    """Only the surface `crm_bridge` actually touches."""

    def __init__(self, *, apps=("crm",), doctypes=("CRM Deal", "FCRM Note", "CRM Task")):
        self.apps = list(apps)
        self.doctypes = set(doctypes)
        self.enqueued = []
        self.inserted = []
        self.errors = []
        self.rows = {}
        self.values = {}
        self.session = types.SimpleNamespace(user="jenni@doco.mx")
        self.utils = types.SimpleNamespace(fmt_money=lambda value, currency=None: f"${value}")
        self.db = types.SimpleNamespace(
            exists=self._exists,
            get_value=self._get_value,
            has_column=lambda doctype, column: False,
            set_value=self._set_value,
        )

    # -- probes ------------------------------------------------------------
    def get_installed_apps(self):
        return list(self.apps)

    def _exists(self, doctype, filters=None):
        if doctype == "DocType":
            return filters in self.doctypes
        return self.values.get(("exists", doctype), None)

    # -- reads -------------------------------------------------------------
    def get_all(self, doctype, **kwargs):
        return list(self.rows.get(doctype, []))

    def _get_value(self, doctype, name, fields=None, as_dict=False):
        if not isinstance(name, str):
            # A filter dict — the existing-task lookup. Keyed separately so a
            # fixture for it cannot shadow the Customer read beside it.
            return self.values.get((doctype, "filters"))
        return self.values.get((doctype, name))

    def _set_value(self, doctype, name, field, value):
        self.values[("set", doctype, name, field)] = value

    # -- writes ------------------------------------------------------------
    def get_doc(self, payload):
        doc = _Doc(payload)
        self.inserted.append(doc)
        return doc

    def enqueue(self, method, **kwargs):
        self.enqueued.append({"method": method, **kwargs})

    # -- noise -------------------------------------------------------------
    def log_error(self, *args, **kwargs):
        self.errors.append(args)

    def get_traceback(self):
        return "traceback"

    def throw(self, message, exc_type=Exception):
        raise exc_type(message)


class _Invoice:
    def __init__(self, **kwargs):
        self.doctype = "Sales Invoice"
        self.name = "ACC-SINV-2026-00214"
        self.customer = "CUST-0001"
        self.is_return = 0
        self.__dict__.update(kwargs)


class InstalledProbeTests(unittest.TestCase):
    def test_a_tenant_without_the_app_is_simply_not_installed(self):
        fake = _FakeFrappe(apps=("erpnext",))
        with mock.patch.object(bridge, "frappe", fake):
            self.assertFalse(bridge.crm_installed())

    def test_the_app_without_its_doctype_is_not_installed_either(self):
        # A migration mid-flight has the app in `installed_apps` and no table.
        fake = _FakeFrappe(apps=("crm",), doctypes=())
        with mock.patch.object(bridge, "frappe", fake):
            self.assertFalse(bridge.crm_installed())

    def test_the_probe_never_raises(self):
        broken = _FakeFrappe()
        broken.get_installed_apps = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
        with mock.patch.object(bridge, "frappe", broken):
            self.assertFalse(bridge.crm_installed())

    def test_the_context_answers_not_installed_instead_of_refusing(self):
        # The SPA gates on this. A probe that throws teaches the frontend to
        # retry, which is the floors/tables lesson repeated.
        fake = _FakeFrappe(apps=("erpnext",))
        with mock.patch.object(bridge, "frappe", fake):
            self.assertEqual(bridge.crm_context("CUST-1", "Profile A"), {"installed": False})

    def test_a_context_with_no_customer_asks_the_server_nothing(self):
        fake = _FakeFrappe()
        with mock.patch.object(bridge, "frappe", fake):
            answer = bridge.crm_context("", "Profile A")
        self.assertEqual(answer, {"installed": True, "deals": [], "lead": None})


class SubmitHookTests(unittest.TestCase):
    def test_it_enqueues_and_writes_nothing(self):
        fake = _FakeFrappe()
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice())

        self.assertEqual(len(fake.enqueued), 1)
        self.assertEqual(fake.inserted, [])
        self.assertEqual(
            fake.enqueued[0]["method"], "posawesome.posawesome.api.crm_bridge.log_sale_to_crm"
        )

    def test_it_defers_the_job_until_after_commit(self):
        # Without this the worker can pop the job before the transaction
        # commits — and a submit that rolls back would still get a note about
        # a sale that never happened.
        fake = _FakeFrappe()
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice())

        self.assertTrue(fake.enqueued[0]["enqueue_after_commit"])
        self.assertEqual(fake.enqueued[0]["queue"], "short")

    def test_a_return_is_not_a_sale_to_log(self):
        fake = _FakeFrappe()
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice(is_return=1))
        self.assertEqual(fake.enqueued, [])

    def test_a_walk_in_with_no_customer_is_nobody_to_log_against(self):
        fake = _FakeFrappe()
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice(customer=None))
        self.assertEqual(fake.enqueued, [])

    def test_a_tenant_without_the_crm_queues_nothing(self):
        fake = _FakeFrappe(apps=("erpnext",))
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice())
        self.assertEqual(fake.enqueued, [])

    def test_it_never_fails_the_sale(self):
        # A note in another app is never worth a customer's money.
        fake = _FakeFrappe()
        fake.enqueue = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("redis down"))
        with mock.patch.object(bridge, "frappe", fake):
            bridge.on_sales_invoice_submit(_Invoice())
        self.assertEqual(len(fake.errors), 1)


class AutoLogTests(unittest.TestCase):
    def _fake_with_invoice(self, **overrides):
        fake = _FakeFrappe()
        fake.values[("Sales Invoice", "ACC-SINV-2026-00214")] = {
            "customer": "CUST-0001",
            "grand_total": 1310,
            "posting_date": "2026-08-22",
            "currency": "MXN",
            "docstatus": 1,
            **overrides,
        }
        fake.values[("Customer", "CUST-0001")] = {
            "customer_name": "Alejandra Ríos",
            "mobile_no": "9991234567",
            "email_id": "ale@example.mx",
            "customer_primary_contact": None,
        }
        return fake

    def test_it_creates_nothing_for_a_customer_the_crm_has_never_heard_of(self):
        # A customer with no deal and no lead is one the back office has not
        # decided to track. An automatic job does not get to decide for them.
        fake = self._fake_with_invoice()
        with mock.patch.object(bridge, "frappe", fake):
            bridge.log_sale_to_crm("Sales Invoice", "ACC-SINV-2026-00214")
        self.assertEqual(fake.inserted, [])

    def test_it_notes_the_sale_on_a_single_unambiguous_deal(self):
        fake = self._fake_with_invoice()
        with mock.patch.object(bridge, "frappe", fake), mock.patch.object(
            bridge, "find_deals", return_value=[{"name": "CRM-DEAL-2026-00042"}]
        ):
            bridge.log_sale_to_crm("Sales Invoice", "ACC-SINV-2026-00214")

        self.assertEqual(len(fake.inserted), 1)
        note = fake.inserted[0]
        self.assertEqual(note["doctype"], "FCRM Note")
        self.assertEqual(note["reference_doctype"], "CRM Deal")
        self.assertEqual(note["reference_docname"], "CRM-DEAL-2026-00042")
        self.assertIn("ACC-SINV-2026-00214", note["content"])

    def test_it_stays_silent_when_two_deals_match(self):
        # A note on the WRONG deal is worse than no note: it is a fact somebody
        # will act on. The strip still shows both so a person can decide.
        fake = self._fake_with_invoice()
        with mock.patch.object(bridge, "frappe", fake), mock.patch.object(
            bridge, "find_deals", return_value=[{"name": "DEAL-A"}, {"name": "DEAL-B"}]
        ):
            bridge.log_sale_to_crm("Sales Invoice", "ACC-SINV-2026-00214")
        self.assertEqual(fake.inserted, [])

    def test_it_ignores_an_invoice_that_is_not_submitted(self):
        fake = self._fake_with_invoice(docstatus=0)
        with mock.patch.object(bridge, "frappe", fake), mock.patch.object(
            bridge, "find_deals", return_value=[{"name": "DEAL-A"}]
        ):
            bridge.log_sale_to_crm("Sales Invoice", "ACC-SINV-2026-00214")
        self.assertEqual(fake.inserted, [])

    def test_a_tenant_without_the_crm_does_no_work_at_all(self):
        fake = _FakeFrappe(apps=("erpnext",))
        with mock.patch.object(bridge, "frappe", fake):
            bridge.log_sale_to_crm("Sales Invoice", "ACC-SINV-2026-00214")
        self.assertEqual(fake.inserted, [])


class SeguimientoTests(unittest.TestCase):
    def _fake(self):
        fake = _FakeFrappe()
        fake.values[("Customer", "CUST-0001")] = {
            "customer_name": "Alejandra Ríos",
            "mobile_no": "9991234567",
            "email_id": "ale@example.mx",
            "customer_primary_contact": None,
        }
        fake.values[("POS Profile", "Profile A")] = "Doco"
        return fake

    def _patched(self, fake):
        return (
            mock.patch.object(bridge, "frappe", fake),
            mock.patch.object(bridge, "assert_profile", lambda *a: None),
            mock.patch.object(bridge, "assert_company", lambda *a: None),
            mock.patch.object(bridge, "assert_customer_in_profile", lambda *a: None),
        )

    def test_the_idempotency_key_is_the_customer_and_the_day(self):
        # The grain a counter actually works at: a second press the same
        # afternoon is the same request, not a new one.
        self.assertEqual(
            bridge._seguimiento_marker("CUST-0001", "2026-08-23"), "POS:CUST-0001:2026-08-23"
        )
        self.assertNotEqual(
            bridge._seguimiento_marker("CUST-0001", "2026-08-23"),
            bridge._seguimiento_marker("CUST-0001", "2026-08-24"),
        )

    def test_an_existing_deal_gets_a_task_assigned_to_nobody(self):
        fake = self._fake()
        patches = self._patched(fake)
        with patches[0], patches[1], patches[2], patches[3], mock.patch.object(
            bridge, "find_deals", return_value=[{"name": "CRM-DEAL-2026-00042"}]
        ):
            result = bridge.create_seguimiento("CUST-0001", "Profile A", note="Quiere cotización")

        self.assertEqual(result["action"], "created")
        self.assertEqual(result["doctype"], "CRM Task")
        task = fake.inserted[0]
        self.assertEqual(task["reference_docname"], "CRM-DEAL-2026-00042")
        self.assertEqual(task["status"], "Backlog")
        # Triage is the back office's call; a cashier's guess puts it in a
        # queue nobody reads.
        self.assertNotIn("assigned_to", task)
        self.assertIn("Quiere cotización", task["description"])

    def test_a_second_press_the_same_day_updates_instead_of_duplicating(self):
        fake = self._fake()
        fake.values[("CRM Task", "filters")] = "CRM-TASK-2026-00007"
        patches = self._patched(fake)
        with patches[0], patches[1], patches[2], patches[3], mock.patch.object(
            bridge, "find_deals", return_value=[{"name": "CRM-DEAL-2026-00042"}]
        ):
            result = bridge.create_seguimiento("CUST-0001", "Profile A")

        self.assertEqual(result["action"], "updated")
        self.assertEqual(fake.inserted, [])

    def test_with_no_crm_record_at_all_a_lead_is_created_because_a_person_asked(self):
        fake = self._fake()
        patches = self._patched(fake)
        with patches[0], patches[1], patches[2], patches[3], mock.patch.object(
            bridge, "find_deals", return_value=[]
        ), mock.patch.object(bridge, "find_lead", return_value=None):
            result = bridge.create_seguimiento("CUST-0001", "Profile A")

        self.assertEqual(result["doctype"], "CRM Lead")
        lead = fake.inserted[0]
        self.assertEqual(lead["doctype"], "CRM Lead")
        self.assertEqual(lead["mobile_no"], "9991234567")
        self.assertIsNone(lead["lead_owner"])

    def test_it_refuses_on_a_tenant_without_the_crm(self):
        fake = _FakeFrappe(apps=("erpnext",))
        with mock.patch.object(bridge, "frappe", fake):
            with self.assertRaises(Exception):
                bridge.create_seguimiento("CUST-0001", "Profile A")

    def test_it_refuses_an_unknown_reference_doctype(self):
        # Input validated at the boundary: `reference_doctype` reaches a
        # Dynamic Link, and an unchecked one is a link to anything.
        fake = self._fake()
        patches = self._patched(fake)
        with patches[0], patches[1], patches[2], patches[3]:
            with self.assertRaises(Exception):
                bridge.create_seguimiento(
                    "CUST-0001", "Profile A", reference_doctype="Not A Doctype", reference_name="x"
                )


class MatchingTests(unittest.TestCase):
    def test_the_open_status_types_are_read_from_the_status_doctype(self):
        # These tenants carry thirty statuses, half in Spanish. A hard-coded
        # list of NAMES goes stale the first time somebody adds one.
        self.assertEqual(set(bridge.OPEN_STATUS_TYPES), {"Open", "Ongoing", "On Hold"})

    def test_the_broad_phone_matcher_is_bounded(self):
        # A suffix LIKE cannot use an index and these tenants carry ~10k deals.
        self.assertLessEqual(bridge.PHONE_MATCH_LIMIT, 25)
        self.assertLessEqual(bridge.CONTEXT_DEAL_LIMIT, 5)


if __name__ == "__main__":
    unittest.main()
