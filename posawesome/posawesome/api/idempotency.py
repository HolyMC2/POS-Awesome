import hashlib

import frappe


def normalize_client_request_id(value):
    normalized = (value or "").strip()
    return normalized or None


def extract_invoice_client_request_id(invoice=None, data=None):
    invoice = invoice or {}
    data = data or {}
    return normalize_client_request_id(
        invoice.get("posa_client_request_id") or data.get("idempotency_key") or data.get("client_request_id")
    )


def strip_invoice_client_request_id(payload):
    if isinstance(payload, dict):
        payload.pop("posa_client_request_id", None)
    return payload


def doctype_supports_client_request_id(doctype):
    has_column = getattr(getattr(frappe, "db", None), "has_column", None)
    if not callable(has_column):
        return True
    try:
        return bool(has_column(doctype, "posa_client_request_id"))
    except Exception:
        return False


def set_invoice_client_request_id(invoice_doc, client_request_id):
    if client_request_id and doctype_supports_client_request_id(getattr(invoice_doc, "doctype", None)):
        invoice_doc.posa_client_request_id = client_request_id
    return invoice_doc


def find_invoice_by_client_request_id(client_request_id, preferred_doctype=None):
    if not client_request_id:
        return None

    doctypes = []
    if preferred_doctype:
        doctypes.append(preferred_doctype)
    doctypes.extend(doctype for doctype in ("Sales Invoice", "POS Invoice") if doctype not in doctypes)

    for doctype in doctypes:
        if not doctype_supports_client_request_id(doctype):
            continue
        existing_name = frappe.db.get_value(
            doctype,
            {"posa_client_request_id": client_request_id},
            "name",
        )
        if existing_name:
            return frappe.get_doc(doctype, existing_name)

    return None


def payment_request_prefix(client_request_id):
    digest = hashlib.sha256(client_request_id.encode("utf-8")).hexdigest()
    return "pos-payment:" + digest + ":"


def payment_method_request_id(client_request_id, index):
    # Preserve the historical first entry while giving split tenders their own
    # unique keys. The common hashed prefix makes every sibling discoverable.
    if not client_request_id or index == 0:
        return client_request_id
    return payment_request_prefix(client_request_id) + str(index)


def find_payment_entries_by_client_request_id(client_request_id, *, for_update=False):
    if not client_request_id or not doctype_supports_client_request_id("Payment Entry"):
        return []

    # A retry waiting on the party lock must see the previous commit even if
    # earlier permission reads established a repeatable-read snapshot.
    reader = frappe.db.get_values if for_update else frappe.get_list
    options = {"for_update": True, "as_dict": True} if for_update else {}
    query = dict(
        **{("fieldname" if for_update else "fields"): [
            "name",
            "paid_amount",
            "received_amount",
            "posting_date",
            "mode_of_payment",
            "party",
            "party_type",
            "payment_type",
            "docstatus",
            "posa_client_request_id",
        ]},
        order_by="creation asc",
        **options,
    )
    rows = reader("Payment Entry", filters={"posa_client_request_id": client_request_id}, **query)
    rows = list(rows or []) + list(reader(
        "Payment Entry",
        filters={"posa_client_request_id": ["like", payment_request_prefix(client_request_id) + "%"]},
        **query,
    ) or [])
    return list({row.get("name"): row for row in rows}.values())
