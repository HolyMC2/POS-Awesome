"""The cotización's two ends: born from a cart, spent into a sale.

DOCUMENTOS_GOLDEN_FLOW §1. `quotations.py` reads the lane; this module writes
it. Split because the read is a query and these are money paths with their own
gates, and because both files stay under the 500-line rule.

THE LINKAGE, in one paragraph, because it is the part that is easy to get
wrong. ERPNext maps Quotation → Sales Invoice and then forgets: `Sales Invoice
Item` has no quotation column and `Quotation.status` is derived from Sales
ORDERS, so "Ordered" is unreachable through an invoice and a hand-written one
is undone by the next `validate()`. The fork's own `commercial_flow` seam does
carry `flow_context.source_links.quotation` — to the BROWSER, where it dies;
nothing ever posts it back. So the link is made server-side at the only moment
both documents exist: `load_quotation_for_sale` INSERTS the draft invoice
itself (the same pull-model `prepare_charge_request_invoice` uses), stamping
`posa_quotation` on it. Every later `update_invoice` is a partial update of
that named draft — `_get_mutable_invoice_doc` does `invoice_doc.update(data)`
on the existing row — so the stamp survives whatever the cart sends, including
a cart that has never heard of the field. `mark_quotation_converted`, called
from `api.invoice.before_submit`, then claims the quotation inside the sale's
own transaction: if the submit rolls back, so does the claim.
"""

from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, nowdate

from posawesome.posawesome.api.quotation_read_model import (
    is_honoured,
    line_provenance,
    shape_row,
)
from posawesome.posawesome.api.quotations import (
    _assert_quotation_flow_allowed,
    _available_posa_fields,
    assert_not_walk_in,
    profile_company,
    require_open_shift,
)

#: Fallback when the register carries no `posa_quotation_validity_days`. A week
#: is what the mueblería writes on the paper and the patch's own default. Never
#: 0 — a quote that expires as it prints cannot be honoured for the walk to the
#: car, which is the one thing a quote is for.
DEFAULT_VALIDITY_DAYS = 7

#: Ceiling on the validity box. Guardrail §3 bounds price honouring by
#: validity; an unbounded box is an unbounded price lock written by whoever is
#: standing at the register.
MAX_VALIDITY_DAYS = 180


def _load_payload(payload):
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            frappe.throw(_("Invalid cart payload."))
    if isinstance(payload, dict):
        return payload
    frappe.throw(_("Invalid cart payload."))


def resolve_validity_days(pos_profile, requested=None):
    """Days the quote is good for: what the cashier typed, else the register's.

    Clamped rather than refused. A cashier who types 400 meant "a long time",
    and refusing the save loses the cart they just built; capping it and
    printing the real date on the paper tells them what they got.
    """
    if requested in (None, ""):
        configured = cint(
            frappe.db.get_value("POS Profile", pos_profile, "posa_quotation_validity_days")
            or 0
        )
        requested = configured or DEFAULT_VALIDITY_DAYS
    days = cint(requested)
    if days < 1:
        days = 1
    if days > MAX_VALIDITY_DAYS:
        days = MAX_VALIDITY_DAYS
    return days


@frappe.whitelist(methods=["POST"])
def create_quotation_from_cart(pos_profile, payload, validity_days=None, note=None):
    """«Guardar cotización» — the cart, as a real Quotation, submitted.

    The cart's RATES are the point: whatever the cashier negotiated at the
    counter is what the customer is promised, so every line is written with the
    cart's `rate` and re-asserted after `set_missing_values()` (which would
    otherwise re-derive it from today's price list and quietly change the
    promise). Taxes come from the template, never from the client's arithmetic.
    """
    _assert_quotation_flow_allowed(pos_profile)
    company = profile_company(pos_profile)
    require_open_shift(pos_profile)

    data = _load_payload(payload)
    customer = data.get("customer") or data.get("party_name")
    assert_not_walk_in(pos_profile, customer)

    from posawesome.posawesome.api._scope import assert_customer_in_profile

    assert_customer_in_profile(frappe.session.user, customer, pos_profile)

    lines = [line for line in (data.get("items") or []) if line.get("item_code")]
    if not lines:
        frappe.throw(_("Add at least one item before saving a quotation."))

    days = resolve_validity_days(pos_profile, validity_days)
    today = nowdate()

    doc = frappe.new_doc("Quotation")
    doc.quotation_to = "Customer"
    doc.party_name = customer
    doc.customer = customer
    doc.company = company
    doc.transaction_date = today
    doc.valid_till = add_days(today, days)
    if data.get("currency"):
        doc.currency = data.get("currency")
    if data.get("selling_price_list"):
        doc.selling_price_list = data.get("selling_price_list")
    taxes_template = data.get("taxes_and_charges") or frappe.db.get_value(
        "POS Profile", pos_profile, "taxes_and_charges"
    )
    if taxes_template:
        doc.taxes_and_charges = taxes_template

    for line in lines:
        doc.append(
            "items",
            {
                "item_code": line.get("item_code"),
                "item_name": line.get("item_name"),
                "description": line.get("description"),
                "qty": flt(line.get("qty") or 0),
                "uom": line.get("uom"),
                "conversion_factor": flt(line.get("conversion_factor") or 1) or 1,
                "rate": flt(line.get("rate") or 0),
                "price_list_rate": flt(line.get("price_list_rate") or line.get("rate") or 0),
                "warehouse": line.get("warehouse"),
                # A quote is priced by hand at the counter; letting the pricing
                # engine re-run on the server would overwrite the negotiation
                # the cashier just had with the customer.
                "delivery_date": doc.valid_till,
            },
        )

    if _has_field("Quotation", "posa_pos_profile"):
        doc.posa_pos_profile = pos_profile
    if _has_field("Quotation", "posa_note"):
        doc.posa_note = (note or "").strip() or None

    doc.ignore_pricing_rule = 1
    doc.delivery_date = doc.valid_till
    doc.flags.ignore_permissions = True

    from posawesome.posawesome.api._perms import account_perm_bypass

    with account_perm_bypass():
        doc.run_method("set_missing_values")
        _restore_cart_rates(doc, lines)
        doc.run_method("calculate_taxes_and_totals")
        doc.insert(ignore_permissions=True)
        doc.submit()

    return {
        "name": doc.name,
        "doctype": "Quotation",
        "customer": doc.party_name,
        "customer_name": doc.customer_name,
        "valid_till": str(doc.valid_till),
        "validity_days": days,
        "grand_total": flt(doc.grand_total),
        "currency": doc.currency,
    }


def _has_field(doctype, fieldname):
    return frappe.db.has_column(doctype, fieldname)


def _restore_cart_rates(doc, lines):
    """Put the counter's price back after ERPNext re-derived it.

    `set_missing_values` fetches `price_list_rate` and recomputes `rate` from
    it. That is right for a document authored in Desk and wrong for one
    authored at a register, where the rate on screen is the number the customer
    heard. Matched positionally: `doc.items` is appended from `lines` in order
    and nothing in between reorders it.
    """
    for index, row in enumerate(doc.items):
        if index >= len(lines):
            break
        cart_rate = flt(lines[index].get("rate") or 0)
        if not cart_rate:
            continue
        row.rate = cart_rate
        row.discount_percentage = 0
        row.discount_amount = 0
        row.margin_type = None
        row.margin_rate_or_amount = 0
        if not flt(row.price_list_rate):
            row.price_list_rate = cart_rate


# ---------------------------------------------------------------------------
# Loading a quotation back into the sale
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def load_quotation_for_sale(pos_profile, quotation):
    """«CARGAR A LA VENTA» — the quotation as a draft invoice, in this shift.

    Three answers, and only one of them hands back a cart:

    * **converted** — `allowed: False` with the invoice named. A refusal that
      still returned the lines would not be a refusal; the client shows the
      warning and a link to the sale that already happened.
    * **expired** — the lines come back at TODAY's rates, with both totals, so
      the warning can name the two numbers instead of saying "prices may have
      changed".
    * **honoured** — the quoted rates, with a per-line provenance marker
      wherever today's list price disagrees.
    """
    _assert_quotation_flow_allowed(pos_profile)
    company = profile_company(pos_profile)
    shift = require_open_shift(pos_profile)

    doc = frappe.get_doc("Quotation", quotation)
    if doc.company != company:
        frappe.throw(
            _("Quotation {0} belongs to another company.").format(doc.name),
            frappe.PermissionError,
        )
    if cint(doc.docstatus) != 1:
        frappe.throw(_("Quotation {0} has not been submitted yet.").format(doc.name))

    today = nowdate()
    row = shape_row(_row_source(doc), today)

    if row["converted_invoice"]:
        return {
            "allowed": False,
            "reason": "converted",
            "quotation": row,
            "invoice": row["converted_invoice"],
            "invoice_doctype": row["converted_invoice_doctype"],
        }

    assert_not_walk_in(pos_profile, doc.party_name)

    honoured = is_honoured(row, today)
    today_rates = _today_rates(doc)

    lines = []
    for item in doc.items:
        quoted_rate = flt(item.rate)
        today_rate = today_rates.get(item.item_code)
        effective = quoted_rate if honoured else flt(today_rate or quoted_rate)
        lines.append(
            {
                "item_code": item.item_code,
                "item_name": item.item_name,
                "qty": flt(item.qty),
                "uom": item.uom,
                "quoted_rate": quoted_rate,
                "today_rate": flt(today_rate) if today_rate is not None else None,
                "rate": effective,
                "provenance": line_provenance(quoted_rate, today_rate) if honoured else None,
            }
        )

    quoted_total = flt(doc.grand_total)
    today_total = sum(flt(line["qty"]) * flt(line["today_rate"] or line["quoted_rate"]) for line in lines)

    invoice_doc = _mint_draft_invoice(pos_profile, shift, doc, lines)

    return {
        "allowed": True,
        "reason": "expired" if not honoured else "honoured",
        "expired": not honoured,
        "quotation": row,
        "lines": lines,
        "quoted_total": quoted_total,
        # Net of tax and only meaningful as a "prices moved by roughly this
        # much" figure — it is the repriced LINES, not a recomputed document.
        # The draft invoice the cart adopts carries the authoritative total.
        "today_total": flt(today_total),
        "invoice_doc": invoice_doc,
    }


def _row_source(doc):
    source = {
        "name": doc.name,
        "party_name": doc.party_name,
        "customer_name": doc.customer_name,
        "transaction_date": doc.transaction_date,
        "valid_till": doc.valid_till,
        "grand_total": doc.grand_total,
        "currency": doc.currency,
        "owner": doc.owner,
        "items_count": len(doc.items or []),
    }
    for field in _available_posa_fields():
        source[field] = doc.get(field)
    return source


def _today_rates(doc):
    """This register's price list, as it stands right now.

    Used for the provenance line («precio cotizado · lista hoy $15,400») and
    for repricing an expired quote. `get_item_prices` is the same reader the
    catalogue uses, so the number beside the quoted one is the number the
    cashier would see if they added the item fresh.
    """
    from posawesome.posawesome.api.item_fetchers import get_item_prices

    price_list = doc.selling_price_list
    if not price_list:
        return {}
    item_codes = [item.item_code for item in doc.items if item.item_code]
    if not item_codes:
        return {}
    rows = get_item_prices(
        price_list,
        doc.currency,
        item_codes,
        doc.party_name,
        nowdate(),
    )
    rates = {}
    for row in rows or []:
        # The query orders customer-specific rows last-wins on purpose; keep
        # the FIRST generic hit per item and let a customer row overwrite it.
        code = row.get("item_code")
        if code not in rates or row.get("customer"):
            rates[code] = flt(row.get("price_list_rate"))
    return rates


def _mint_draft_invoice(pos_profile, pos_opening_shift, quotation, lines):
    """The draft the cart adopts, born in the calling cashier's own shift.

    Modelled on `prepare_charge_request_invoice`: the invoice is created where
    it will be paid, so it behaves like any other draft — visible, closable,
    purgeable — and re-loading the same quotation returns the SAME draft rather
    than stacking a second one.
    """
    use_pos_invoice = cint(
        frappe.db.get_value(
            "POS Profile", pos_profile, "create_pos_invoice_instead_of_sales_invoice"
        )
        or 0
    )
    doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"

    if _has_field(doctype, "posa_quotation"):
        existing = frappe.db.get_value(
            doctype,
            {"docstatus": 0, "posa_quotation": quotation.name},
            ["name", "posa_pos_opening_shift"],
            as_dict=True,
        )
        if existing and existing.posa_pos_opening_shift == pos_opening_shift:
            return frappe.get_doc(doctype, existing.name).as_dict()

    doc = frappe.new_doc(doctype)
    doc.customer = quotation.party_name
    doc.company = quotation.company
    doc.pos_profile = pos_profile
    doc.posa_pos_opening_shift = pos_opening_shift
    if quotation.selling_price_list:
        doc.selling_price_list = quotation.selling_price_list
    if quotation.currency:
        doc.currency = quotation.currency
    if quotation.taxes_and_charges:
        doc.taxes_and_charges = quotation.taxes_and_charges
    if use_pos_invoice:
        doc.is_pos = 1
        doc.update_stock = 1
    if _has_field(doctype, "posa_quotation"):
        doc.posa_quotation = quotation.name

    for line in lines:
        doc.append(
            "items",
            {
                "item_code": line["item_code"],
                "item_name": line.get("item_name"),
                "qty": flt(line["qty"]),
                "uom": line.get("uom"),
                "rate": flt(line["rate"]),
                "price_list_rate": flt(line["rate"]),
            },
        )

    doc.ignore_pricing_rule = 1
    doc.flags.ignore_permissions = True

    from posawesome.posawesome.api._perms import account_perm_bypass

    with account_perm_bypass():
        doc.insert(ignore_permissions=True)
    return doc.as_dict()


# ---------------------------------------------------------------------------
# Conversion, claimed inside the sale's own transaction
# ---------------------------------------------------------------------------


def mark_quotation_converted(doc, method=None):
    """Claim the quotation this invoice honours. Called from `before_submit`.

    Exactly once, and enforced rather than hoped for: a quotation already
    pointing at a DIFFERENT submitted invoice refuses the second submit
    outright. Pointing at THIS invoice is idempotent (a resubmit after an
    amend), and pointing at a cancelled invoice is released by `on_cancel`
    below rather than blocking the register forever.
    """
    quotation = doc.get("posa_quotation")
    if not quotation or cint(doc.get("is_return")):
        return
    if not frappe.db.exists("Quotation", quotation):
        return
    if not _has_field("Quotation", "posa_converted_invoice"):
        return

    claimed = frappe.db.get_value(
        "Quotation",
        quotation,
        ["posa_converted_invoice", "posa_converted_invoice_doctype"],
        as_dict=True,
    )
    existing = (claimed or {}).get("posa_converted_invoice")
    if existing and existing != doc.name:
        existing_doctype = (claimed or {}).get("posa_converted_invoice_doctype") or "Sales Invoice"
        if cint(frappe.db.get_value(existing_doctype, existing, "docstatus") or 0) == 1:
            frappe.throw(
                _(
                    "Quotation {0} was already converted into {1}. Load that sale "
                    "instead of billing the same quotation twice."
                ).format(quotation, existing)
            )

    frappe.db.set_value(
        "Quotation",
        quotation,
        {
            "posa_converted_invoice": doc.name,
            "posa_converted_invoice_doctype": doc.doctype,
        },
        update_modified=False,
    )


def clear_quotation_conversion(doc, method=None):
    """Release the quotation when its sale is cancelled. Called from `on_cancel`.

    Without this a cancelled sale would leave the quote Convertida forever,
    pointing at a document that no longer exists as a sale — and the cashier
    would have no way to bill the customer who is still standing there.
    """
    quotation = doc.get("posa_quotation")
    if not quotation or not frappe.db.exists("Quotation", quotation):
        return
    if not _has_field("Quotation", "posa_converted_invoice"):
        return
    if frappe.db.get_value("Quotation", quotation, "posa_converted_invoice") != doc.name:
        return
    frappe.db.set_value(
        "Quotation",
        quotation,
        {"posa_converted_invoice": None, "posa_converted_invoice_doctype": None},
        update_modified=False,
    )
