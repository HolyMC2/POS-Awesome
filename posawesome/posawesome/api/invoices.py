# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

"""Public invoice API facade backed by `invoice_processing` modules."""

import frappe
import time
from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
from posawesome.posawesome.api._scope import (
    assert_company,
    assert_customer_in_profile,
    assert_profile,
)
from posawesome.posawesome.api.invoice_processing.utils import (
    _get_return_validity_settings,
    _build_invoice_remarks,
    _set_return_valid_upto,
    _validate_return_window,
    get_latest_rate,
    get_price_list_currency,
    get_available_currencies,
)
from posawesome.posawesome.api.invoice_processing.stock import (
    _strip_client_freebies_from_payload,
    _validate_stock_on_invoice,
    _apply_item_name_overrides,
    _deduplicate_free_items,
    _merge_duplicate_taxes,
    _auto_set_return_batches,
    _collect_stock_errors,
    _should_block,
)
from posawesome.posawesome.api.invoice_processing.creation import (
    update_invoice,
    submit_invoice,
    submit_in_background_job,
    repair_invoice_submission,
    validate_cart_items,
)
from posawesome.posawesome.api.invoice_processing.returns import (
    search_invoices_for_return,
    validate_return_items,
    get_invoice_for_return,
)
from posawesome.posawesome.api.invoice_processing.payment import _create_change_payment_entries
from posawesome.posawesome.api.invoice_processing.data import get_last_invoice_rates
from posawesome.posawesome.api.utils import log_perf_event


# "POS Awesome Supervisor" is the app's OWN supervisor role (employees.py
# drives the SPA's is_supervisor from it) — omitting it here silently
# downgraded POSAwesome-promoted supervisors to shift-scope: the UI showed
# the supervisor drafts tab while the server returned only their own shift,
# so nobody could find other users' (or stranded) drafts.
_SUPERVISOR_ROLES = (
    "POS Awesome Supervisor",
    "POS Manager",
    "Sales Manager",
    "Accounts Manager",
    "System Manager",
)


@frappe.whitelist(methods=["GET", "POST"])
def get_draft_invoices(
    pos_opening_shift=None,
    doctype="Sales Invoice",
    limit_page_length=0,
    company=None,
    pos_profile=None,
    cashier=None,
    is_supervisor=0,
):
    started_at = time.perf_counter()
    try:
        limit_page_length = int(limit_page_length or 0)
    except (TypeError, ValueError):
        limit_page_length = 0
    if limit_page_length < 0:
        limit_page_length = 0

    # Supervisor branch is NOT a client-supplied flag — that was the
    # original tampering window. Cashier sends `is_supervisor=1` →
    # sees every draft in the company (REVIEW2/03 §2.1 row
    # invoices.py:45-104). Compute server-side from roles instead.
    requested_supervisor = int(is_supervisor or 0)
    actual_roles = set(frappe.get_roles(frappe.session.user))
    is_supervisor_session = bool(actual_roles.intersection(_SUPERVISOR_ROLES))
    supervisor_scope = 1 if (requested_supervisor and is_supervisor_session) else 0

    filters = {
        "docstatus": 0,
    }
    # Profile of the caller's OWN opening shift, used to also surface drafts
    # that carry no shift at all (see the second query below). Server-derived
    # from the shift row, never a client claim.
    unassigned_profile = None
    if supervisor_scope and company:
        # Confirm the supervisor's session can act on the requested
        # company + profile before broadening scope.
        assert_company(frappe.session.user, company)
        if pos_profile:
            assert_profile(frappe.session.user, pos_profile)
        filters["company"] = company
        if pos_profile:
            filters["pos_profile"] = pos_profile
        if cashier:
            filters["owner"] = cashier
    else:
        filters["posa_pos_opening_shift"] = pos_opening_shift
        # An external vertical (taller repairs, etc.) drafts an invoice long
        # before anyone is at the till, so it can only pin the durable
        # pos_profile — a shift is one cashier's drawer for one day, and
        # guessing one strands the sale in somebody else's corte. Shift scope
        # alone therefore hid those drafts from every cashier. Widen it to
        # "my shift, or unclaimed on my register" — the register comes from
        # the caller's own shift row and only widens on a membership match.
        if pos_opening_shift and frappe.db.has_column(doctype, "pos_profile"):
            unassigned_profile = frappe.db.get_value(
                "POS Opening Shift", pos_opening_shift, "pos_profile"
            )
            if unassigned_profile:
                try:
                    assert_profile(frappe.session.user, unassigned_profile)
                except frappe.PermissionError:
                    # Not my register: drop the widening instead of raising.
                    # This branch is purely additive — a caller that could
                    # list its own shift before must not start getting a 403.
                    unassigned_profile = None
    if frappe.db.has_column(doctype, "posa_is_printed"):
        filters["posa_is_printed"] = 0

    fields = [
        "name",
        "customer",
        "customer_name",
        "posting_date",
        "posting_time",
        "grand_total",
        "currency",
        "pos_profile",
        "owner",
        "modified_by",
        # Needed to re-order the merged shift-scoped + unclaimed result sets.
        "modified",
    ]
    # Held-ticket "name on the cup" label (cafetería vertical). Guarded so a
    # tenant that has not yet run the add_tab_name_field patch does not 500.
    if frappe.db.has_column(doctype, "posa_rt_tab_name"):
        fields.append("posa_rt_tab_name")
    if frappe.db.has_column(doctype, "posa_rt_guest_count"):
        fields.append("posa_rt_guest_count")
    if frappe.db.has_column(doctype, "posa_rt_service_type"):
        fields.append("posa_rt_service_type")

    invoices_list = frappe.get_list(
        doctype,
        filters=filters,
        fields=fields,
        limit_page_length=limit_page_length,
        order_by="modified desc",
    )
    if unassigned_profile:
        # Separate query rather than or_filters: the second branch is a
        # conjunction (no shift AND this profile) that or_filters cannot
        # express, and folding it in would OR the profile against the
        # shift-scoped rows too.
        unassigned_filters = dict(filters)
        unassigned_filters["posa_pos_opening_shift"] = ["is", "not set"]
        unassigned_filters["pos_profile"] = unassigned_profile
        seen = {row["name"] for row in invoices_list}
        for row in frappe.get_list(
            doctype,
            filters=unassigned_filters,
            fields=fields,
            limit_page_length=limit_page_length,
            order_by="modified desc",
        ):
            if row["name"] not in seen:
                invoices_list.append(row)
        # str() so a row missing `modified` sorts last instead of raising on a
        # datetime-vs-str comparison; ISO datetimes order lexicographically.
        invoices_list.sort(key=lambda row: str(row.get("modified") or ""), reverse=True)
        if limit_page_length:
            invoices_list = invoices_list[:limit_page_length]
    for invoice in invoices_list:
        invoice["doctype"] = doctype
    log_perf_event(
        "get_draft_invoices",
        started_at,
        doctype=doctype,
        rows=len(invoices_list),
    )
    return invoices_list


@frappe.whitelist(methods=["GET", "POST"])
def get_draft_invoice_doc(invoice_name, doctype="Sales Invoice"):
    started_at = time.perf_counter()
    doc = frappe.get_cached_doc(doctype, invoice_name)
    # Scope: any logged-in user could pass an arbitrary invoice name
    # and read full doc (line items, customer, totals) without this
    # gate. REVIEW2/03 §2.1 row invoices.py:107-118.
    assert_company(frappe.session.user, getattr(doc, "company", None))
    log_perf_event(
        "get_draft_invoice_doc",
        started_at,
        doctype=doctype,
        invoice=invoice_name,
        items=len(getattr(doc, "items", []) or []),
    )
    return doc


@frappe.whitelist(methods=["GET", "POST"])
def get_last_pos_invoice(pos_opening_shift=None, doctype="Sales Invoice"):
    """Name of the caller's most recent SUBMITTED POS invoice.

    Backs the "Print Last Invoice" reprint button when the client-side
    ``lastInvoiceId`` cache is empty — fresh tab, cleared storage, or a
    service-worker reload. Scoped to the calling user so a cashier only
    ever reprints their own ticket; narrowed to the active opening shift
    when the client can supply it. Returns ``None`` when nothing matches.
    """
    from frappe import _

    if doctype not in ("Sales Invoice", "POS Invoice"):
        frappe.throw(_("Invalid doctype {0}").format(doctype))

    filters = {"docstatus": 1, "owner": frappe.session.user}
    if pos_opening_shift and frappe.db.has_column(doctype, "posa_pos_opening_shift"):
        filters["posa_pos_opening_shift"] = pos_opening_shift

    name = frappe.db.get_value(doctype, filters, "name", order_by="creation desc")
    if not name:
        return None

    # Defense-in-depth: confirm the caller may read this company's docs
    # before handing back a printable name (mirrors get_draft_invoice_doc).
    assert_company(frappe.session.user, frappe.db.get_value(doctype, name, "company"))
    return name


@frappe.whitelist(methods=["POST"])
def delete_invoice(invoice):
    from frappe import _
    from posawesome.posawesome.api.invoice import delete_invoice_submission_ledger_entries_for_invoice

    doctype = "Sales Invoice"
    if frappe.db.exists("POS Invoice", invoice):
        doctype = "POS Invoice"
    elif not frappe.db.exists("Sales Invoice", invoice):
        frappe.throw(_("Invoice {0} does not exist").format(invoice))

    # Scope: caller must own the company + profile this draft belongs to.
    # Without this gate, any logged-in user could pass an arbitrary invoice
    # name and nuke a draft from another tenant (REVIEW2/03 §2.1 row
    # invoices.py:121).
    has_profile = frappe.db.has_column(doctype, "pos_profile")
    fields = ["company", "pos_profile"] if has_profile else ["company"]
    row = frappe.db.get_value(doctype, invoice, fields, as_dict=True) or {}
    assert_company(frappe.session.user, row.get("company"))
    if has_profile and row.get("pos_profile"):
        assert_profile(frappe.session.user, row.get("pos_profile"))

    if frappe.db.has_column(doctype, "posa_is_printed") and frappe.get_value(
        doctype, invoice, "posa_is_printed"
    ):
        frappe.throw(_("This invoice {0} cannot be deleted").format(invoice))

    # Server backstop for posa_allow_delete (POS-PROFILE-SPEC P0-4): the
    # closing-shift purge honored the flag but this endpoint never did —
    # any scoped user could delete unprinted drafts regardless of profile
    # policy. Profile-less drafts stay governed by the scope asserts above.
    from frappe.utils import cint as _cint

    if row.get("pos_profile") and not _cint(
        frappe.get_cached_value("POS Profile", row["pos_profile"], "posa_allow_delete")
    ):
        frappe.throw(_("Deleting invoices is not enabled in POS Profile"))

    # ignore_permissions: the gates above (company, profile, posa_is_printed,
    # posa_allow_delete) ARE the authorization surface — a minimal-role cashier
    # holds no Sales Invoice delete perm and would 403 here after the cart was
    # already cleared client-side, orphaning the server draft. frappe's
    # submitted-record guard is unconditional and still applies; the ledger
    # cleanup on the next line already runs with ignore_permissions.
    frappe.delete_doc(doctype, invoice, force=1, ignore_permissions=True)
    delete_invoice_submission_ledger_entries_for_invoice(doctype, invoice)
    return _("Invoice {0} Deleted").format(invoice)


@frappe.whitelist(methods=["GET", "POST"])
def fetch_exchange_rate_pair(from_currency, to_currency):
    """Return exchange rate payload expected by POS multi-currency UI."""

    if not from_currency or not to_currency:
        frappe.throw("from_currency and to_currency are required")

    if from_currency == to_currency:
        from frappe.utils import nowdate

        return {
            "exchange_rate": 1,
            "date": nowdate(),
        }

    exchange_rate, rate_date = get_latest_rate(from_currency, to_currency)
    return {
        "exchange_rate": exchange_rate,
        "date": rate_date,
    }


@frappe.whitelist(methods=["POST"])
def create_sales_invoice_from_order(sales_order, pos_profile=None):
    """Backward-compatible facade for legacy frontend method path."""

    if not sales_order:
        frappe.throw("sales_order is required")

    if not frappe.db.exists("Sales Order", sales_order):
        frappe.throw(f"Sales Order {sales_order} does not exist")

    # Scope: the SO must belong to a company the caller can act on. Without
    # this, a cashier could pass any SO name and the make_sales_invoice
    # call would gleefully build an invoice draft from another tenant
    # (REVIEW2/03 §2.1 row invoices.py:164).
    so_company = frappe.db.get_value("Sales Order", sales_order, "company")
    assert_company(frappe.session.user, so_company)
    # Feature (POS-PROFILE-SPEC P2): selecting an SO into an invoice is
    # gated by `custom_allow_select_sales_order` in the UI only.
    from posawesome.posawesome.api._scope import assert_profile_feature

    assert_profile_feature(
        frappe.session.user, pos_profile, "custom_allow_select_sales_order", so_company
    )

    invoice_doc = make_sales_invoice(sales_order)
    invoice_doc.flags.ignore_permissions = True
    invoice_doc.run_method("set_missing_values")
    invoice_doc.run_method("calculate_taxes_and_totals")
    return invoice_doc


@frappe.whitelist(methods=["POST"])
def delete_sales_invoice(sales_invoice):
    """Backward-compatible facade for legacy frontend method path."""

    if not sales_invoice:
        frappe.throw("sales_invoice is required")

    if frappe.db.exists("Sales Invoice", sales_invoice):
        # Scope before destroy. delete_doc(force=1) is irreversible
        # (REVIEW2/03 §2.1 row invoices.py:181).
        si_company = frappe.db.get_value("Sales Invoice", sales_invoice, "company")
        assert_company(frappe.session.user, si_company)
        frappe.delete_doc("Sales Invoice", sales_invoice, force=1)
    return True


@frappe.whitelist(methods=["POST"])
def update_invoice_from_order(data):
    """Backward-compatible facade used by order-to-invoice flow."""

    return update_invoice(data)


# ----------------------------------------------------------------------
# Backward-compat path aliases. Some POSAwesome frontend chunks call
# `posawesome.posawesome.api.<old_module>.<func>` whose impl moved into
# subpackages. Direct `from ... import` aliases fail Frappe's whitelist
# check because the function's `__module__` no longer matches the URL
# path → 404. Local wrappers below carry their own @whitelist and
# delegate, filtering Frappe-injected kwargs (e.g. `cmd`) so impls
# without **kwargs don't TypeError.
# ----------------------------------------------------------------------


@frappe.whitelist(methods=["GET", "POST"])
def get_available_currencies(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.utils.get_available_currencies.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.utils import get_available_currencies as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_price_list_currency(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.utils.get_price_list_currency.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.utils import get_price_list_currency as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_invoice_for_return(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.returns.get_invoice_for_return.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.returns import get_invoice_for_return as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def search_invoices_for_return(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.returns.search_invoices_for_return.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.returns import search_invoices_for_return as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def get_last_invoice_rates(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.data.get_last_invoice_rates.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.data import get_last_invoice_rates as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def submit_invoice(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.creation.submit_invoice.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.creation import submit_invoice as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def update_invoice(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.creation.update_invoice.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.creation import update_invoice as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)


@frappe.whitelist(methods=["GET", "POST"])
def validate_cart_items(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.invoice_processing.creation.validate_cart_items.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.invoice_processing.creation import validate_cart_items as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)
