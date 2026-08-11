# Copyright (c) 2026, HolyMC2 fork
# For license information, please see license.txt

"""Fiscal customer surface for the POS SPA (CFDI companion of customers.py).

RFC-first lookup, fiscal-field completion and billing-CP upsert. All SAT
validation delegates to emc's pure validators; the RFC-uniqueness guard is
emc's ``Customer.validate_duplicate_tax_id`` (hard throw on save) — the
``check_customer_rfc`` endpoint surfaces the collision BEFORE save so the
cashier picks the existing customer instead of hitting the error.
"""

import frappe
from frappe import _

from posawesome.posawesome.api._scope import (
    assert_customer_in_profile,
    assert_profile,
)
from posawesome.posawesome.api.cfdi import _require_emc


def _billing_zip(customer_doc) -> tuple[str, str]:
    """(address_name, pincode) for the customer's best billing address."""
    primary = customer_doc.get("customer_primary_address")
    if primary:
        pincode = frappe.db.get_value("Address", primary, "pincode")
        if pincode:
            return primary, pincode

    rows = frappe.get_all(
        "Dynamic Link",
        filters={
            "link_doctype": "Customer",
            "link_name": customer_doc.name,
            "parenttype": "Address",
        },
        fields=["parent"],
        limit_page_length=0,
    )
    best = ("", "")
    for row in rows:
        addr = frappe.db.get_value(
            "Address", row["parent"], ["address_type", "pincode", "disabled"], as_dict=True
        )
        if not addr or addr.disabled or not addr.pincode:
            continue
        if addr.address_type == "Billing":
            return row["parent"], addr.pincode
        if not best[0]:
            best = (row["parent"], addr.pincode)
    return best


@frappe.whitelist(methods=["GET", "POST"])
def get_customer_fiscal(customer: str) -> dict:
    """Fiscal snapshot of a customer for prefill (read-only)."""
    _require_emc()
    frappe.has_permission("Customer", "read", customer, throw=True)
    doc = frappe.get_doc("Customer", customer)
    address, zip_code = _billing_zip(doc)
    return {
        "customer": doc.name,
        "customer_name": doc.customer_name,
        "tax_id": doc.get("tax_id") or "",
        "mx_tax_regime": doc.get("mx_tax_regime") or "",
        "mx_cfdi_use": doc.get("mx_cfdi_use") or "",
        "mobile_no": doc.get("mobile_no") or "",
        "email_id": doc.get("email_id") or "",
        "billing_address": address,
        "zip_code": zip_code,
    }


@frappe.whitelist(methods=["GET", "POST"])
def check_customer_rfc(tax_id: str, customer: str | None = None) -> dict:
    """Validate an RFC's shape/checksum and detect an existing owner.

    ``customer`` (edit flows) is excluded from the collision check. Generic
    RFCs (XAXX/XEXX) are shared by design and never report a collision.
    """
    _require_emc()
    frappe.has_permission("Customer", "read", throw=True)

    from erpnext_mexico_compliance.fiscal.validation import rfc

    normalized = rfc.normalize(tax_id)
    issues = [
        {"code": code, "level": level, "message": message}
        for code, level, message in rfc.validate(normalized)
    ]

    existing = None
    if normalized and not rfc.is_generic(normalized):
        filters = {"tax_id": normalized}
        if customer:
            filters["name"] = ["!=", customer]
        match = frappe.db.get_value(
            "Customer", filters, ["name", "customer_name"], as_dict=True
        )
        if match:
            existing = {"customer": match.name, "customer_name": match.customer_name}

    return {
        "tax_id": normalized,
        "valid": not any(issue["level"] == "error" for issue in issues),
        "is_generic": rfc.is_generic(normalized),
        "kind": rfc.rfc_kind(normalized) or "",
        "issues": issues,
        "existing": existing,
    }


def _default_customer_group(pos_profile: str) -> str:
    """First profile-scoped customer group, else any leaf group.

    "All Customer Groups" is a GROUP node on doco sites — assigning it to a
    Customer throws, so the fallback must resolve a leaf from the DB.
    """
    row = frappe.get_all(
        "POS Customer Group",
        filters={"parent": pos_profile},
        fields=["customer_group"],
        limit_page_length=1,
    )
    if row:
        return row[0]["customer_group"]
    return (
        frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
        or "All Customer Groups"
    )


@frappe.whitelist(methods=["POST"])
def save_customer_fiscal(
    pos_profile: str,
    customer: str | None = None,
    customer_name: str | None = None,
    tax_id: str | None = None,
    tax_regime: str | None = None,
    mx_cfdi_use: str | None = None,
    zip_code: str | None = None,
    mobile_no: str | None = None,
    email_id: str | None = None,
) -> dict:
    """Create or fiscally-complete a Customer from the POS.

    Scope first: profile membership, and for updates the customer must be
    inside the profile's customer-group scope. Fiscal input is revalidated
    server-side (RFC checksum, régimen, CP) before anything is written.
    Duplicate RFCs hard-throw inside emc's Customer.validate.
    """
    _require_emc()
    assert_profile(frappe.session.user, pos_profile)
    if customer:
        assert_customer_in_profile(frappe.session.user, customer, pos_profile)

    customer_name = (customer_name or "").strip()
    tax_id = (tax_id or "").strip().upper()

    if tax_id:
        from erpnext_mexico_compliance.fiscal.validation import engine

        bad = engine.first_error(
            engine.validate_fiscal_input(
                tax_id=tax_id,
                regime=tax_regime,
                uso=mx_cfdi_use,
                cp=zip_code,
                name=customer_name or None,
                deep=True,
            )
        )
        if bad:
            frappe.throw(bad.message)

    if customer:
        doc = frappe.get_doc("Customer", customer)
    else:
        if not customer_name:
            frappe.throw(_("Customer name is required"))
        doc = frappe.new_doc("Customer")
        doc.customer_group = _default_customer_group(pos_profile)
        doc.territory = "All Territories"
        doc.customer_type = "Company" if len(tax_id) == 12 else "Individual"

    if customer_name:
        doc.customer_name = customer_name
    if tax_id:
        doc.tax_id = tax_id
    if tax_regime:
        doc.mx_tax_regime = tax_regime
    if mx_cfdi_use:
        doc.mx_cfdi_use = mx_cfdi_use
    if mobile_no is not None:
        doc.mobile_no = mobile_no
    if email_id is not None:
        doc.email_id = email_id
    doc.save()

    if zip_code:
        from erpnext_mexico_compliance.overrides.sales_invoice import _get_or_create_address

        address = _get_or_create_address(doc.name, doc.customer_name, zip_code)
        if not doc.get("customer_primary_address"):
            doc.db_set("customer_primary_address", address, update_modified=False)

    # Keep the primary Contact in sync so desk surfaces show the same phone
    # and email the POS captured (mirrors customers.set_customer_info).
    from posawesome.posawesome.api.customers import set_customer_info

    if mobile_no:
        set_customer_info(doc.name, "mobile_no", mobile_no)
    if email_id:
        set_customer_info(doc.name, "email_id", email_id)

    return get_customer_fiscal(doc.name)
