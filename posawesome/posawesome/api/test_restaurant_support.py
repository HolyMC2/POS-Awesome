"""Shared bench fixtures for the restaurant table-service tests.

Not a test module itself — it carries no TestCase. Every restaurant test
builds its own floor/tables/items in setUp (never setUpClass: Frappe rolls
back per module, not per test, so class-level fixtures leak into whichever
test runs next) and tears them down in dependency order, because the delete
guards refuse a floor that still has tables and a table that still has orders.

Doco sites name Items by an IPN series, so an item's DOCNAME is not its
item_code — always resolve through the item_code FIELD.
"""

from __future__ import annotations

import unittest
import uuid

try:
    import frappe
except ImportError:  # pragma: no cover - standalone stub runner
    raise unittest.SkipTest("bench-only integration test - requires frappe")

from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime, nowdate

PROFILE = "Doco Ventas"
TEST_ITEM = "POSA-TEST-RT-FOOD"
TEST_ITEM_DRINK = "POSA-TEST-RT-DRINK"


def uid(prefix="rt"):
    """A per-test unique id — uids double as docnames, so collisions across
    tests would look like idempotent replays rather than test pollution."""
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def ensure_item(item_code, item_group=None):
    """Find-or-create a sales item and return its DOCNAME."""
    name = frappe.db.get_value("Item", {"item_code": item_code}, "name")
    if name:
        return name
    group = item_group or frappe.db.get_value("Item Group", {"is_group": 0}, "name")
    doc = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": item_code,
            "item_name": item_code.replace("-", " ").title(),
            "item_group": group,
            "stock_uom": "Nos",
            "is_stock_item": 0,
            "is_sales_item": 1,
        }
    ).insert(ignore_permissions=True)
    return doc.name


TABLES_CAPABILITY_PROFILE = "POSA-TEST-TABLES-CAP"


def ensure_tables_capability(pos_profile):
    """Link a capability preset carrying the `tables` token to the profile so
    the table-service endpoints (now server-gated on that token) accept the
    fixtures. Returns the profile's PREVIOUS capability link for restoration.
    A properly-provisioned restaurant profile always carries this token; the
    shared Doco Ventas test profile does not, so we grant it per test."""
    if not frappe.db.exists("POS Capability Profile", TABLES_CAPABILITY_PROFILE):
        frappe.get_doc(
            {
                "doctype": "POS Capability Profile",
                "profile_name": TABLES_CAPABILITY_PROFILE,
                "capabilities": "tables",
                "dock_tabs": "browse, cart, pay, floor",
                "invoice_mode": "Record Only",
            }
        ).insert(ignore_permissions=True)
    previous = frappe.db.get_value("POS Profile", pos_profile, "posa_capability_profile")
    frappe.db.set_value(
        "POS Profile", pos_profile, "posa_capability_profile", TABLES_CAPABILITY_PROFILE
    )
    frappe.clear_cache(doctype="POS Profile")
    frappe.clear_cache(doctype="POS Capability Profile")
    return previous


def ensure_item_group(group_name):
    if frappe.db.exists("Item Group", group_name):
        return group_name
    parent = frappe.db.get_value("Item Group", {"is_group": 1}, "name") or "All Item Groups"
    return frappe.get_doc(
        {
            "doctype": "Item Group",
            "item_group_name": group_name,
            "parent_item_group": parent,
            "is_group": 0,
        }
    ).insert(ignore_permissions=True).name


def make_shift(pos_profile, company, user):
    """A fresh OPEN shift, inside the staleness window.

    The lab's real open shifts all predate the 3-day bound, so a test that
    leans on them would silently exercise the empty-shift-set branch.
    """
    mode_of_payment = frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name") or "Cash"
    doc = frappe.get_doc(
        {
            "doctype": "POS Opening Shift",
            "period_start_date": now_datetime(),
            "posting_date": nowdate(),
            "company": company,
            "pos_profile": pos_profile,
            "user": user,
            "balance_details": [{"mode_of_payment": mode_of_payment, "amount": 0}],
        }
    )
    doc.insert(ignore_permissions=True)
    doc.submit()
    return doc.name


class RestaurantTestCase(IntegrationTestCase):
    """One floor, two tables, two items, one fresh shift.

    Subclasses add their own docs through ``track()`` so tearDown removes
    them before the fixtures they depend on.
    """

    def setUp(self):
        if not frappe.db.exists("POS Profile", PROFILE):
            self.skipTest(f"no {PROFILE} profile on this site")
        if not frappe.db.exists("DocType", "POS Table Order"):
            self.skipTest("restaurant doctypes not migrated yet")

        self.profile = PROFILE
        # Table-service endpoints are server-gated on the `tables` capability;
        # a provisioned restaurant profile carries it. Grant it UNCOMMITTED for
        # this test — same-connection reads see it and the per-test rollback
        # undoes it, so nothing leaks. (The one cross-connection concurrency
        # test mocks the gate instead.)
        ensure_tables_capability(PROFILE)
        self.company = frappe.db.get_value("POS Profile", PROFILE, "company")
        self.customer = frappe.db.get_value("POS Profile", PROFILE, "customer") or frappe.db.get_value(
            "Customer", {"disabled": 0}, "name"
        )
        if not self.customer:
            self.skipTest("no customer on site")

        self.item = ensure_item(TEST_ITEM)
        self.item_drink = ensure_item(TEST_ITEM_DRINK)
        self._tracked: list[tuple[str, str]] = []

        self.floor = self.make_floor("Salón")
        self.table_a = self.make_table(self.floor, "A1")
        self.table_b = self.make_table(self.floor, "A2")
        self.shift = make_shift(self.profile, self.company, "Administrator")
        self._tracked.append(("POS Opening Shift", self.shift))

    def tearDown(self):
        # Reverse insertion order: orders release tables, tables release
        # floors. Any other order trips the guards under test.
        for doctype, name in reversed(self._tracked):
            try:
                if doctype == "POS Opening Shift":
                    doc = frappe.get_doc(doctype, name)
                    if doc.docstatus == 1:
                        doc.flags.ignore_permissions = True
                        doc.cancel()
                if doctype == "POS Table Order":
                    frappe.db.set_value(
                        doctype,
                        name,
                        {"status": "Cancelled", "settled_doctype": None, "settled_invoice": None},
                    )
                frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
            except Exception:
                pass

    def track(self, doctype, name):
        self._tracked.append((doctype, name))
        return name

    # -- fixture builders --------------------------------------------------

    def make_floor(self, label="Salón", pos_profile=None, sequence=1):
        doc = frappe.get_doc(
            {
                "doctype": "POS Floor",
                "floor_uid": uid("floor"),
                "floor_name": f"{label} {uid('n')[-6:]}",
                "company": self.company,
                "pos_profile": pos_profile if pos_profile is not None else self.profile,
                "sequence": sequence,
                "is_active": 1,
            }
        ).insert(ignore_permissions=True)
        return self.track("POS Floor", doc.name)

    def make_table(self, floor, label, seats=4):
        doc = frappe.get_doc(
            {
                "doctype": "POS Table",
                "table_uid": uid("tbl"),
                "table_label": f"{label}-{uid('n')[-6:]}",
                "floor": floor,
                "seats": seats,
                "is_active": 1,
            }
        ).insert(ignore_permissions=True)
        return self.track("POS Table", doc.name)

    def make_order(self, table=None, lines=None, shift=None, **kwargs):
        """Insert an order directly — for tests about reading, not opening."""
        doc = frappe.get_doc(
            {
                "doctype": "POS Table Order",
                "order_uid": uid("ord"),
                "table": table,
                "pos_profile": self.profile,
                "company": self.company,
                "pos_opening_shift": shift if shift is not None else self.shift,
                "status": "Open",
                "opened_by": frappe.session.user,
                "waiter": frappe.session.user,
                "items": lines or [],
                **kwargs,
            }
        ).insert(ignore_permissions=True)
        return self.track("POS Table Order", doc.name)

    def line(self, item=None, qty=1, rate=25, course_idx=1, line_uid=None, notes=None):
        return {
            "line_uid": line_uid or uid("ln"),
            "item_code": item or self.item,
            "qty": qty,
            "rate": rate,
            "course_idx": course_idx,
            "notes": notes,
        }
