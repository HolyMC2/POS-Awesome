# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import json
import frappe
from frappe.utils import cint, nowdate
from frappe import _
from .utilities import get_version
from ._scope import assert_company, assert_profile


@frappe.whitelist(methods=["GET", "POST"])
def get_opening_dialog_data():
    data = {}

    # Get only POS Profiles where current user is defined in POS Profile User table
    pos_profiles_data = frappe.db.sql(
        """
        SELECT DISTINCT p.name, p.company, p.currency 
        FROM `tabPOS Profile` p
        INNER JOIN `tabPOS Profile User` u ON u.parent = p.name
        WHERE p.disabled = 0 AND u.user = %s
        ORDER BY p.name
    """,
        frappe.session.user,
        as_dict=1,
    )

    data["pos_profiles_data"] = pos_profiles_data

    # Derive companies from accessible POS Profiles
    company_names = []
    for profile in pos_profiles_data:
        if profile.company and profile.company not in company_names:
            company_names.append(profile.company)
    data["companies"] = [{"name": c} for c in company_names]

    pos_profiles_list = []
    for i in data["pos_profiles_data"]:
        pos_profiles_list.append(i.name)

    payment_method_table = "POS Payment Method" if get_version() == 13 else "Sales Invoice Payment"
    data["payments_method"] = frappe.get_list(
        payment_method_table,
        filters={"parent": ["in", pos_profiles_list]},
        fields=["*"],
        limit_page_length=0,
        order_by="parent",
        ignore_permissions=True,
    )
    # set currency from pos profile
    for mode in data["payments_method"]:
        mode["currency"] = frappe.get_cached_value("POS Profile", mode["parent"], "currency")

    return data


@frappe.whitelist(methods=["POST"])
def create_opening_voucher(pos_profile, company, balance_details):
    # Tenant boundary: profile/company come straight from the client and the
    # insert below runs with ignore_permissions. get_opening_dialog_data only
    # OFFERS assigned profiles — nothing stopped a crafted call from opening
    # a shift on an unassigned profile/company.
    assert_profile(frappe.session.user, pos_profile)
    assert_company(frappe.session.user, company)

    balance_details = json.loads(balance_details)

    # One open shift per user. Multiple concurrent open shifts (same or
    # different POS Profiles) silently break cash reconciliation:
    # check_opening_shift() only ever returns the newest one, so sales can
    # land on a shift no closing ever accounts for. Force the operator to
    # close the existing shift first.
    existing_open = frappe.db.get_all(
        "POS Opening Shift",
        filters={
            "user": frappe.session.user,
            "pos_closing_shift": ["is", "not set"],
            "docstatus": 1,
            "status": "Open",
        },
        fields=["name", "pos_profile"],
        order_by="period_start_date desc",
        limit=1,
    )
    if existing_open:
        frappe.throw(
            _(
                "You already have an open shift ({0}) on POS Profile {1}. "
                "Close it before opening a new one."
            ).format(existing_open[0].name, existing_open[0].pos_profile)
        )

    new_pos_opening = frappe.get_doc(
        {
            "doctype": "POS Opening Shift",
            "period_start_date": frappe.utils.get_datetime(),
            "posting_date": frappe.utils.getdate(),
            "user": frappe.session.user,
            "pos_profile": pos_profile,
            "company": company,
            "docstatus": 1,
        }
    )
    new_pos_opening.set("balance_details", balance_details)
    new_pos_opening.insert(ignore_permissions=True)

    data = {}
    data["pos_opening_shift"] = new_pos_opening.as_dict()
    update_opening_shift_data(data, new_pos_opening.pos_profile)
    return data


def is_demo_pos_site() -> bool:
    """True on a Muelle demo tenant (site_config ``muelle_demo: 1``).

    A demo is a marketing fixture: its integrity story is the nightly golden
    restore, never cash reconciliation. Selling must therefore never hard-block
    there — the golden snapshot can legitimately carry an old open shift, and
    the stale-shift wall would then deadlock every visitor (sale blocked by the
    stale shift, close blocked by the visitor's own unsynced offline sale,
    sync blocked by the stale shift — bit demo.muelle.mx 2026-07-31)."""
    return bool(cint(frappe.conf.get("muelle_demo") or 0))


def is_shift_stale(opening_shift) -> bool:
    """An open shift whose period started on a previous day is stale."""

    period_start = opening_shift.get("period_start_date")
    if not period_start:
        return False
    return frappe.utils.getdate(period_start) < frappe.utils.getdate(nowdate())


@frappe.whitelist(methods=["GET", "POST"])
def check_opening_shift(user):
    open_vouchers = frappe.db.get_all(
        "POS Opening Shift",
        filters={
            "user": user,
            "pos_closing_shift": ["is", "not set"],
            "docstatus": 1,
            "status": "Open",
        },
        fields=["name", "pos_profile"],
        order_by="period_start_date desc",
    )
    data = ""
    if len(open_vouchers) > 0:
        data = {}
        data["pos_opening_shift"] = frappe.get_doc("POS Opening Shift", open_vouchers[0]["name"])
        update_opening_shift_data(data, open_vouchers[0]["pos_profile"])
        # Single source of truth for Desk AND the /posapp web route: the SPA
        # routes a stale shift straight into the closing flow, and
        # assert_shift_not_stale is the server-side backstop at submit time.
        # Demo tenants report never-stale so the SPA shows no wall/toast at all.
        if is_demo_pos_site():
            data["stale_shift"] = False
            data["force_close_stale_shift"] = False
        else:
            data["stale_shift"] = is_shift_stale(data["pos_opening_shift"])
            data["force_close_stale_shift"] = bool(
                cint(_profile_force_close_stale_shift(data["pos_profile"].name))
            )
    return data


def _profile_force_close_stale_shift(pos_profile):
    """The profile's stale-shift gate, tolerating a missing column.

    posa_force_close_stale_shift is PATCH-only schema: a tenant created after
    the patch was written has it marked executed without ever running
    (set_all_patches_as_completed), so the column can be absent outright — a
    raw SELECT then 500s every submit_invoice (bit the demo fleet 2026-07-29).
    Absent column falls back to the schema default (ON): a fresh tenant keeps
    the cash-reconciliation protection instead of silently losing it. The
    fixture now ships the field too, so the fallback only covers sites that
    have not migrated since.
    """
    if not frappe.db.has_column("POS Profile", "posa_force_close_stale_shift"):
        return 1
    return cint(
        frappe.db.get_value("POS Profile", pos_profile, "posa_force_close_stale_shift") or 0
    )


def assert_shift_not_stale(pos_opening_shift):
    """Backstop for the stale-shift gate at invoice-submit time.

    The SPA routes stale shifts into the closing flow at boot; this stops
    anything that bypasses the UI (stale cached tab, direct API call) from
    selling into yesterday's shift when the profile enforces closure.

    A non-demo shift is bound to the authenticated cashier: a sale may only
    post into the seller's own opening shift, so cash lands in that cashier's
    corte, not another's. Demo tenants skip the whole gate (ownership +
    stale/closed-state): there a dead-lettered sale is worse than a corte
    mismatch the nightly golden restore wipes anyway (see is_demo_pos_site).
    """

    if not pos_opening_shift:
        return
    row = frappe.db.get_value(
        "POS Opening Shift",
        pos_opening_shift,
        ["period_start_date", "pos_profile", "status", "docstatus", "user"],
        as_dict=True,
    )
    if not row:
        return
    # Demos never hard-block a sale (shared login + nightly golden restore make
    # a corte mismatch harmless), so they skip the ownership bind too — a seeded
    # demo shift owned by a different user must not reject the shared seller.
    if is_demo_pos_site():
        return
    if row.user != frappe.session.user:
        frappe.throw(
            _("POS Opening Shift {0} belongs to another user.").format(pos_opening_shift),
            frappe.PermissionError,
        )
    if cint(row.docstatus) != 1:
        return
    if row.status == "Closed":
        # A late-arriving offline sale trying to post into an already-closed
        # shift would land outside that shift's corte (drawer mismatch). Reject
        # it so it surfaces (dead-letter / operator handling) instead of
        # silently corrupting reconciled totals.
        frappe.throw(
            _(
                "POS shift {0} is already closed; this sale cannot be posted into it. "
                "Open a new shift and re-submit."
            ).format(pos_opening_shift)
        )
    if row.status != "Open":
        return
    if not is_shift_stale(row):
        return
    if not cint(_profile_force_close_stale_shift(row.pos_profile)):
        return
    frappe.throw(
        _(
            "This POS shift was opened on {0} and must be closed before selling today. "
            "Use Close Shift, then open a new shift."
        ).format(frappe.utils.getdate(row.period_start_date).strftime("%d-%m-%Y"))
    )


def update_opening_shift_data(data, pos_profile):
    data["pos_profile"] = frappe.get_doc("POS Profile", pos_profile)
    # Resolved capability preset rides as a SIBLING key of the opening
    # payload (plan C7) — the whole payload is snapshotted offline, so this
    # survives cold boot with no field on the profile doc. None → the SPA
    # uses its retail-phones default.
    from posawesome.posawesome.api.vertical import opening_capability_payload

    data["capability_profile"] = opening_capability_payload(pos_profile)
    if data["pos_profile"].get("posa_language"):
        frappe.local.lang = data["pos_profile"].posa_language
    data["company"] = frappe.get_doc("Company", data["pos_profile"].company)
    allow_negative_stock = cint(frappe.db.get_single_value("Stock Settings", "allow_negative_stock") or 0)
    data["stock_settings"] = {}
    data["stock_settings"].update({"allow_negative_stock": bool(allow_negative_stock)})
