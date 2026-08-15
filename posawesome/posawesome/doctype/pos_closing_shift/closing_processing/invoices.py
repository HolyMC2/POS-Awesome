import hashlib
import json

import frappe
from frappe import _, DoesNotExistError
from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import (
    consolidate_pos_invoices,
)


ALLOWED_INVOICE_DOCTYPES = frozenset({"Sales Invoice", "POS Invoice"})
_CLOSING_SUPERVISOR_ROLES = frozenset(
    {
        "POS Awesome Supervisor",
        "POS Manager",
        "Sales Manager",
        "Accounts Manager",
        "System Manager",
    }
)


def is_closing_supervisor(user=None) -> bool:
    """True when ``user`` may close another cashier's shift.

    ONE predicate for the whole delegated-close flow — the builder scope
    gate (`get_scoped_opening_shift`), the printed-draft replay override,
    and `submit_closing_shift`. Audit r2 P0: the builder accepted any role
    in `_CLOSING_SUPERVISOR_ROLES`, but `submit_closing_shift` accepted
    only `POS Awesome Supervisor` (via `_is_pos_supervisor`) — so a POS /
    Sales / Accounts Manager who could START a delegated close could never
    FINISH it, wedging the previous shift open and blocking the next
    selling session. Accept any closing role OR the legacy
    `posa_is_pos_supervisor` user flag, so the same people can start and
    finish.
    """
    from posawesome.posawesome.api.employees import _get_user_doc, _is_pos_supervisor

    user = user or frappe.session.user
    roles = set(frappe.get_roles(user) or [])
    if roles.intersection(_CLOSING_SUPERVISOR_ROLES):
        return True
    return _is_pos_supervisor(_get_user_doc(user))


def get_scoped_opening_shift(pos_opening_shift, doctype=None):
    """Return the DB-owned shift and invoice type after enforcing access."""
    if doctype is not None and doctype not in ALLOWED_INVOICE_DOCTYPES:
        frappe.throw(_("Invalid invoice type."), frappe.ValidationError)

    opening_shift = frappe.db.get_value(
        "POS Opening Shift",
        pos_opening_shift,
        ["name", "pos_profile", "company", "user"],
        as_dict=True,
    )
    if not opening_shift:
        frappe.throw(_("POS Opening Shift not found."), DoesNotExistError)

    from posawesome.posawesome.api._scope import assert_company, assert_profile

    session_user = frappe.session.user
    assert_profile(session_user, opening_shift.get("pos_profile"))
    assert_company(session_user, opening_shift.get("company"))

    if opening_shift.get("user") != session_user and not is_closing_supervisor(
        session_user
    ):
        frappe.throw(_("You are not allowed to access this POS Opening Shift."), frappe.PermissionError)

    use_pos_invoice = frappe.db.get_value(
        "POS Profile",
        opening_shift.get("pos_profile"),
        "create_pos_invoice_instead_of_sales_invoice",
    )
    resolved_doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"
    return opening_shift, resolved_doctype


def _set_closing_entry_invoices(closing_shift_doc):
    """Set `pos_closing_entry` on linked invoices."""
    for d in closing_shift_doc.pos_transactions:
        invoice = d.get("sales_invoice") or d.get("pos_invoice")
        if not invoice:
            continue
        doctype = "Sales Invoice" if d.get("sales_invoice") else "POS Invoice"
        if frappe.db.has_column(doctype, "pos_closing_entry"):
            frappe.db.set_value(doctype, invoice, "pos_closing_entry", closing_shift_doc.name)


def _clear_closing_entry_invoices(closing_shift_doc):
    """Clear closing shift links, cancel merge logs and cancel consolidated sales invoices."""
    consolidated_sales_invoices = set()
    for d in closing_shift_doc.pos_transactions:
        pos_invoice = d.get("pos_invoice")
        sales_invoice = d.get("sales_invoice")
        if pos_invoice:
            if frappe.db.has_column("POS Invoice", "pos_closing_entry"):
                frappe.db.set_value("POS Invoice", pos_invoice, "pos_closing_entry", None)

            merge_logs = frappe.get_all(
                "POS Invoice Merge Log",
                filters={"pos_invoice": pos_invoice},
                pluck="name",
            )
            for log in merge_logs:
                log_doc = frappe.get_doc("POS Invoice Merge Log", log)
                for field in (
                    "consolidated_invoice",
                    "consolidated_credit_note",
                ):
                    si = log_doc.get(field)
                    if si:
                        consolidated_sales_invoices.add(si)
                if log_doc.docstatus == 1:
                    log_doc.cancel()
                frappe.delete_doc("POS Invoice Merge Log", log_doc.name, force=1)

            if frappe.db.has_column("POS Invoice", "consolidated_invoice"):
                frappe.db.set_value("POS Invoice", pos_invoice, "consolidated_invoice", None)

            if frappe.db.has_column("POS Invoice", "status"):
                pos_doc = frappe.get_doc("POS Invoice", pos_invoice)
                pos_doc.set_status(update=True)

        if sales_invoice:
            if frappe.db.has_column("Sales Invoice", "pos_closing_entry"):
                frappe.db.set_value("Sales Invoice", sales_invoice, "pos_closing_entry", None)
            if _is_consolidated_sales_invoice(sales_invoice):
                consolidated_sales_invoices.add(sales_invoice)

    for si in consolidated_sales_invoices:
        if frappe.db.exists("Sales Invoice", si):
            si_doc = frappe.get_doc("Sales Invoice", si)
            if si_doc.docstatus == 1:
                si_doc.cancel()


def _is_consolidated_sales_invoice(sales_invoice):
    """Return True if the Sales Invoice was generated by consolidating POS Invoices."""

    if not sales_invoice:
        return False

    if frappe.db.exists("POS Invoice Merge Log", {"consolidated_invoice": sales_invoice}):
        return True

    return bool(frappe.db.exists("POS Invoice Merge Log", {"consolidated_credit_note": sales_invoice}))


def get_pending_draft_invoices(pos_opening_shift, doctype):
    """Unprinted draft invoices still attached to the shift.

    These were historically invisible at close: never submitted, never in
    totals, and either force-deleted (posa_allow_delete) or silently stranded
    on the closed shift. Surfaced so the closer sees exactly what blocks or
    will be deleted — name, owner and amount.
    """

    return frappe.get_all(
        doctype,
        filters={
            "posa_pos_opening_shift": pos_opening_shift,
            "docstatus": 0,
            "posa_is_printed": 0,
        },
        fields=["name", "owner", "grand_total"],
        order_by="creation asc",
    )


def delete_draft_invoices(pos_opening_shift, pos_profile):
    if frappe.get_value("POS Profile", pos_profile, "posa_allow_delete"):
        doctype = (
            "POS Invoice"
            if frappe.db.get_value(
                "POS Profile",
                pos_profile,
                "create_pos_invoice_instead_of_sales_invoice",
            )
            else "Sales Invoice"
        )
        data = frappe.db.sql(
            f"""
        select
            name
        from
            `tab{doctype}`
        where
            docstatus = 0 and posa_is_printed = 0 and posa_pos_opening_shift = %s
        """,
            (pos_opening_shift),
            as_dict=1,
        )

        for invoice in data:
            frappe.delete_doc(doctype, invoice.name, force=1)


def _get_cancelled_return_against(invoice_doc, doctype):
    if not invoice_doc.get("is_return"):
        return None

    return_against = invoice_doc.get("return_against")
    if not return_against:
        return None

    if frappe.db.get_value(doctype, return_against, "docstatus") == 2:
        return return_against

    return None


def _held_unconfirmed_saldo(invoice_doc, doctype):
    """True when this printed draft is a Saldo hold-until-confirm sale whose
    recarga(s) have not all reached Success.

    Submitting such a draft trips the `saldo` app's `before_submit` guard
    (recarga sin confirmar) and aborts the ENTIRE close — one stranded recarga
    blocks every shift, indefinitely. Skip + surface it instead: the draft stays
    editable in the Saldo panel where the cashier deletes it or retries the
    number.

    Soft-coupled to `saldo`: gated on the child table's `saldo_transaction`
    column, so benches without the app installed no-op. No import of saldo — the
    Saldo Transaction status is read by string doctype name.
    """
    child_dt = doctype + " Item"
    if not frappe.db.has_column(child_dt, "saldo_transaction"):
        return False
    for line in invoice_doc.get("items") or []:
        sldo = line.get("saldo_transaction")
        if not sldo:
            continue
        if frappe.db.get_value("Saldo Transaction", sldo, "status") != "Success":
            return True
    return False


def _get_submission_data(invoice_doc, doctype):
    rows = frappe.get_all(
        "POS Invoice Submission Ledger",
        filters={"invoice_name": invoice_doc.name, "document_type": doctype},
        fields=["request_data"],
        order_by="modified desc",
        limit=1,
        ignore_permissions=True,
    )
    if not rows or not rows[0].get("request_data"):
        return {}
    try:
        return json.loads(rows[0].get("request_data"))
    except (TypeError, ValueError):
        return {}


def _submit_printed_invoice(invoice_doc, doctype):
    """Replay a printed draft through the same hardened sale submit path."""
    from posawesome.posawesome.api.invoice_processing.creation import submit_invoice

    payload = invoice_doc.as_dict()
    if not payload.get("posa_client_request_id"):
        stable_key = f"{doctype}:{invoice_doc.name}".encode("utf-8")
        payload["posa_client_request_id"] = "closing-shift:" + hashlib.sha256(stable_key).hexdigest()

    return submit_invoice(
        json.dumps(payload, default=str),
        json.dumps(_get_submission_data(invoice_doc, doctype), default=str),
        submit_in_background=False,
    )


def submit_printed_invoices(pos_opening_shift, doctype):
    _, doctype = get_scoped_opening_shift(pos_opening_shift, doctype)
    skipped_invoices = []
    invoices_list = frappe.get_all(
        doctype,
        filters={
            "posa_pos_opening_shift": pos_opening_shift,
            "docstatus": 0,
            "posa_is_printed": 1,
        },
    )
    # Flushing a shift's own printed drafts INTO the shift being closed is a
    # server-only replay, already authorized above (owner or closing
    # supervisor). Mark THIS shift so the live-selling shift-owner/stale
    # guard in assert_shift_not_stale does not reject a supervisor closing
    # someone else's shift, nor an owner closing their own stale shift.
    prev_replay_shift = frappe.flags.get("posa_closing_replay_shift")
    frappe.flags.posa_closing_replay_shift = pos_opening_shift
    try:
        return _submit_printed_invoices_inner(invoices_list, doctype, skipped_invoices)
    finally:
        frappe.flags.posa_closing_replay_shift = prev_replay_shift


def _submit_printed_invoices_inner(invoices_list, doctype, skipped_invoices):
    for invoice in invoices_list:
        invoice_doc = frappe.get_doc(doctype, invoice.name)
        cancelled_return_against = _get_cancelled_return_against(invoice_doc, doctype)
        if cancelled_return_against:
            skipped_invoices.append(
                frappe._dict(
                    {
                        "invoice": invoice_doc.name,
                        "doctype": doctype,
                        "return_against": cancelled_return_against,
                        "reason": "cancelled_return",
                    }
                )
            )
            frappe.log_error(
                title="POS Closing Shift Skipped Invalid Return Draft",
                message=_(
                    "Skipped printed draft invoice {0} during close shift because Return Against {1} is cancelled."
                ).format(invoice_doc.name, cancelled_return_against),
            )
            continue
        if _held_unconfirmed_saldo(invoice_doc, doctype):
            skipped_invoices.append(
                frappe._dict(
                    {
                        "invoice": invoice_doc.name,
                        "doctype": doctype,
                        "reason": "saldo_unconfirmed",
                    }
                )
            )
            frappe.log_error(
                title="POS Closing Shift Skipped Unconfirmed Saldo Draft",
                message=_(
                    "Skipped printed draft {0} during close shift: a Saldo recarga "
                    "line is not yet confirmed (Success). Draft left editable — the "
                    "cashier deletes it or retries the number from the Saldo panel."
                ).format(invoice_doc.name),
            )
            continue
        result = _submit_printed_invoice(invoice_doc, doctype)
        if result.get("docstatus") == 0:
            skipped_invoices.append(
                frappe._dict(
                    {
                        "invoice": invoice_doc.name,
                        "doctype": doctype,
                        "reason": result.get("hold_reason") or "submission_held",
                    }
                )
            )
    return skipped_invoices


def consolidate_closing_shift_invoices(closing_shift_doc):
    if frappe.db.get_value(
        "POS Profile",
        closing_shift_doc.pos_profile,
        "create_pos_invoice_instead_of_sales_invoice",
    ):
        pos_invoices = []
        for d in closing_shift_doc.pos_transactions:
            invoice_details = frappe._dict(
                frappe.db.get_value(
                    "POS Invoice",
                    d.pos_invoice,
                    [
                        "name as pos_invoice",
                        "customer",
                        "is_return",
                        "return_against",
                        "currency",
                    ],
                    as_dict=True,
                )
            )
            if invoice_details:
                pos_invoices.append(invoice_details)

        if pos_invoices:
            invoices_by_currency = {}
            for invoice in pos_invoices:
                invoices_by_currency.setdefault(invoice.currency, []).append(invoice)

            for invoices in invoices_by_currency.values():
                consolidate_pos_invoices(pos_invoices=invoices)
