"""Nota de crédito — the credit-note branch of a return (DOCUMENTOS_GOLDEN_FLOW §2).

A sibling of `returns.py` rather than a section inside it: that file was 401
lines before this arrived and the repo's rule is 500. Same lane, same surface,
same `validate_return_items` gate — only the file boundary moved.
"""

import frappe
from frappe import _
from frappe.utils import flt

from posawesome.posawesome.api.invoice_processing.returns import validate_return_items

# ---------------------------------------------------------------------------
# Refund method: efectivo or nota de crédito (DOCUMENTOS_GOLDEN_FLOW §2)
# ---------------------------------------------------------------------------
#
# CASH is unchanged and does not pass through here: the surface still emits
# `load_return_invoice`, the negative document lands in the cart, and the
# cashier tenders it in Cobro exactly as before. This endpoint is the OTHER
# branch, and it is a different SHAPE rather than a different tender — a credit
# note is a submitted return with NO payments, which is what leaves the
# customer's `outstanding_amount` negative and therefore spendable. Routing it
# through the tender screen would ask a cashier to "pay" a refund with nothing,
# which is not a thing the payment lane can express.
#
# `get_available_credit` (payments.py) reads exactly that: submitted Sales
# Invoices with `outstanding_amount < 0`, minus any Payment Entry that already
# paid them out in cash. `stored_value._credit_note_movements` lists them in
# the contact view. Both were already there; this is the missing creation side.


REFUND_METHODS = ("cash", "credit_note")


@frappe.whitelist(methods=["POST"])
def create_credit_note_return(pos_profile, invoice_name, items, doctype="Sales Invoice"):
    """Mint a nota de crédito for exactly the returned lines.

    `items` is the picked selection — `[{item_code, qty, ...}]` — at the
    quantities the cashier ticked, so a partial return produces a partial
    credit. Every money field comes off the ORIGINAL document via ERPNext's own
    `make_sales_return`; nothing here computes a price.
    """
    import json as _json

    from posawesome.posawesome.api._scope import assert_company, assert_profile

    user = frappe.session.user
    assert_profile(user, pos_profile)

    if isinstance(items, str):
        try:
            items = _json.loads(items)
        except _json.JSONDecodeError:
            frappe.throw(_("Invalid return selection."))
    chosen = {
        row.get("item_code"): abs(flt(row.get("qty") or 0))
        for row in (items or [])
        if row.get("item_code") and flt(row.get("qty") or 0)
    }
    if not chosen:
        frappe.throw(_("Choose at least one item to return."))

    original = frappe.get_doc(doctype, invoice_name)
    assert_company(user, original.company)
    profile_company = frappe.db.get_value("POS Profile", pos_profile, "company")
    if profile_company != original.company:
        frappe.throw(
            _("Invoice {0} belongs to another company.").format(invoice_name),
            frappe.PermissionError,
        )

    _assert_credit_note_customer(pos_profile, original.customer)

    validation = validate_return_items(
        invoice_name,
        [{"item_code": code, "qty": qty} for code, qty in chosen.items()],
        doctype=doctype,
    )
    if not validation.get("valid"):
        frappe.throw(validation.get("message"))

    shift = _require_open_shift_for_refund(pos_profile)

    from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return

    credit_note = make_sales_return(invoice_name)
    _trim_to_selection(credit_note, chosen)

    credit_note.pos_profile = pos_profile
    credit_note.posa_pos_opening_shift = shift
    # NOT a POS document: `is_pos` demands payments that sum to the total, and
    # the whole point of a credit note is that no money moves today. Clearing
    # it is what leaves `outstanding_amount` negative — i.e. spendable.
    credit_note.is_pos = 0
    credit_note.payments = []
    # `update_stock` is NOT forced. `make_sales_return` copies the original's
    # value, and that is the only correct one: forcing 1 onto a return of a
    # sale that never moved stock trips ERPNext's own "'Update Stock' can not
    # be checked because items are not delivered via {0}" — which is the
    # server saying, correctly, that there is nothing to put back.
    credit_note.flags.ignore_permissions = True

    from posawesome.posawesome.api._perms import account_perm_bypass

    with account_perm_bypass():
        credit_note.run_method("calculate_taxes_and_totals")
        credit_note.insert(ignore_permissions=True)
        credit_note.submit()

    amount = abs(flt(credit_note.grand_total))
    return {
        "name": credit_note.name,
        "doctype": credit_note.doctype,
        "customer": credit_note.customer,
        "customer_name": credit_note.customer_name,
        "amount": amount,
        "currency": credit_note.currency,
        "return_against": invoice_name,
        "print_format": "POSA Nota de Crédito",
    }


def _assert_credit_note_customer(pos_profile, customer):
    """Credit needs an owner.

    A balance held by «Público en General» is a balance the next customer to
    say that name could spend — so the return to the counter customer keeps the
    cash branch and is refused this one, with the reason on screen rather than
    a silent absence.
    """
    if not customer:
        frappe.throw(_("This sale has no customer, so it cannot leave a credit note."))
    walk_in = frappe.db.get_value("POS Profile", pos_profile, "customer")
    if walk_in and customer == walk_in:
        frappe.throw(
            _(
                "«{0}» is the counter customer. A credit note needs an owner — "
                "refund this return in cash, or set a real customer on the sale."
            ).format(customer)
        )


def _require_open_shift_for_refund(pos_profile):
    """Money leaving the register belongs to a shift — the same rule the
    deposit path states, reused verbatim so the corte sees both."""
    from posawesome.posawesome.api.quotations import require_open_shift

    return require_open_shift(pos_profile)


def _trim_to_selection(credit_note, chosen):
    """Keep only the ticked lines, at the ticked quantities.

    `make_sales_return` returns EVERY remaining returnable line at full
    quantity; the artboard's picker is what narrows it. Quantities stay
    negative because that is what a return row is, and the sign is re-asserted
    rather than assumed in case a caller sent a positive number.
    """
    kept = []
    for row in credit_note.items:
        wanted = chosen.get(row.item_code)
        if not wanted:
            continue
        available = abs(flt(row.qty))
        qty = min(wanted, available) if available else wanted
        row.qty = -abs(qty)
        row.stock_qty = -abs(flt(row.conversion_factor or 1) * qty)
        kept.append(row)
    if not kept:
        frappe.throw(_("None of the chosen items are still returnable on this sale."))
    credit_note.items = kept
    for index, row in enumerate(credit_note.items, start=1):
        row.idx = index
