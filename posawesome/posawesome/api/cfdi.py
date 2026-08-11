# Copyright (c) 2026, HolyMC2 fork
# For license information, please see license.txt

"""CFDI (Mexican e-invoicing) surface for the POS SPA.

Thin POS-scoped facade over erpnext_mexico_compliance (emc). All fiscal
machinery — customer/address upsert, payload build, PAC call, idempotent
resume, metering — stays in emc's ``stamp_with_review`` / ``stamp_cfdi``
path; this module only adds the POSAwesome security contract on top:

* every WRITE asserts profile membership + the ``posa_cfdi_enable_stamping``
  profile flag + company scope off FETCHED values before any DB write;
* read endpoints gate through ``frappe.has_permission(..., throw=True)``;
* client-supplied fiscal data is revalidated server-side through emc's
  validation engine before it can reach the PAC.

emc is optional at the bench level, so every entry point feature-detects it
and the bootstrap tells the SPA to hide the surface when it is absent.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

from posawesome.posawesome.api._scope import (
    assert_company,
    assert_profile,
    assert_profile_feature,
)

FEATURE_FLAG = "posa_cfdi_enable_stamping"
EMC_APP = "erpnext_mexico_compliance"

SEARCH_LIMIT_CAP = 50


# ---------------------------------------------------------------------------
# emc detection / shared guards
# ---------------------------------------------------------------------------


def _emc_installed() -> bool:
    return EMC_APP in frappe.get_installed_apps()


def _require_emc() -> None:
    if not _emc_installed():
        frappe.throw(
            _("CFDI stamping is not available on this site "
              "(erpnext_mexico_compliance is not installed).")
        )


def _fetch_invoice_row(invoice_name: str) -> frappe._dict:
    """Server-side snapshot of the scope-relevant invoice fields.

    Scope assertions must run against FETCHED values, never client input —
    the row is the authority on which company this invoice belongs to.
    """
    row = frappe.db.get_value(
        "Sales Invoice",
        invoice_name,
        ["name", "company", "docstatus", "customer", "mx_stamped_xml", "mx_uuid"],
        as_dict=True,
    )
    if not row:
        frappe.throw(_("Sales Invoice {0} does not exist").format(invoice_name))
    return row


def _assert_stamp_scope(pos_profile: str, invoice_company: str) -> None:
    """Membership + feature flag + company triangle for stamp-path writes.

    ``assert_profile_feature`` checks the caller belongs to the profile AND
    the profile has stamping enabled AND the profile may write for the
    invoice's company; ``assert_company`` closes the triangle from the user
    side (profile-derived companies must include the invoice's).
    """
    assert_profile_feature(frappe.session.user, pos_profile, FEATURE_FLAG, invoice_company)
    assert_company(frappe.session.user, invoice_company)


# ---------------------------------------------------------------------------
# bootstrap + catalogs (read-only)
# ---------------------------------------------------------------------------


def _catalog_rows(doctype: str) -> list[dict]:
    rows = frappe.get_all(
        doctype,
        filters={"enabled": 1},
        fields=["name", "description"],
        order_by="name asc",
        limit_page_length=0,
    )
    return [{"key": r["name"], "description": r["description"] or ""} for r in rows]


def _cfdi_use_rows() -> list[dict]:
    """SAT CFDI Use rows with their compatible régimen keys, one query each."""
    uses = _catalog_rows("SAT CFDI Use")
    links = frappe.get_all(
        "SAT CFDI Use Tax Regime",
        filters={"parenttype": "SAT CFDI Use"},
        fields=["parent", "tax_regime"],
        limit_page_length=0,
    )
    by_use: dict[str, list[str]] = {}
    for link in links:
        by_use.setdefault(link["parent"], []).append(link["tax_regime"])
    for use in uses:
        use["tax_regimes"] = sorted(by_use.get(use["key"], []))
    return uses


@frappe.whitelist(methods=["GET", "POST"])
def get_cfdi_bootstrap(pos_profile: str) -> dict:
    """Feature gate + SAT catalogs for the Facturación surface.

    Read-only. ``enabled`` is False when emc is missing or the profile flag
    is off — the SPA hides the surface instead of erroring on first use.
    """
    assert_profile(frappe.session.user, pos_profile)
    if not _emc_installed():
        return {"enabled": False, "reason": "emc_not_installed"}

    frappe.has_permission("Sales Invoice", "read", throw=True)
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    if not cint(frappe.db.get_value("POS Profile", pos_profile, FEATURE_FLAG)):
        return {"enabled": False, "reason": "profile_flag_off"}

    return {
        "enabled": True,
        "company": company,
        "catalogs": {
            "tax_regimes": _catalog_rows("SAT Tax Regime"),
            "cfdi_uses": _cfdi_use_rows(),
            "payment_options": _catalog_rows("SAT Payment Option"),
            "payment_methods": _catalog_rows("SAT Payment Method"),
        },
    }


# ---------------------------------------------------------------------------
# invoice search + detail (read-only)
# ---------------------------------------------------------------------------


def _stamp_status(row: dict) -> str:
    if row.get("mx_stamped_xml"):
        return "stamped"
    if row.get("mx_stamp_error"):
        return "error"
    return "unstamped"


@frappe.whitelist(methods=["GET", "POST"])
def search_cfdi_invoices(
    pos_profile: str,
    search: str | None = None,
    status: str = "all",
    limit: int = 20,
    start: int = 0,
) -> list[dict]:
    """Submitted Sales Invoices of the profile's company, newest first.

    ``status`` filters on the stamp state: all | unstamped | stamped | error.
    Company comes from the FETCHED profile — never from the client.
    """
    _require_emc()
    frappe.has_permission("Sales Invoice", "read", throw=True)
    assert_profile(frappe.session.user, pos_profile)
    company = frappe.db.get_value("POS Profile", pos_profile, "company")
    if not company:
        frappe.throw(_("POS Profile {0} has no company").format(pos_profile))

    try:
        limit = int(limit or 20)
        start = int(start or 0)
    except (TypeError, ValueError):
        limit, start = 20, 0
    limit = max(1, min(limit, SEARCH_LIMIT_CAP))
    start = max(0, start)

    # mx_stamp_error is a patch-delivered emc field — tenants at older patch
    # levels don't have the column yet, so every touch is has_column-guarded.
    has_stamp_error = frappe.db.has_column("Sales Invoice", "mx_stamp_error")

    filters: list = [
        ["Sales Invoice", "docstatus", "=", 1],
        ["Sales Invoice", "company", "=", company],
    ]
    # ["is", "set"] / ["is", "not set"] — a NOT-IN over ("", None) matches
    # nothing in MariaDB, so stamp-state filters must use IS checks.
    if status == "unstamped":
        filters.append(["Sales Invoice", "mx_stamped_xml", "is", "not set"])
    elif status == "stamped":
        filters.append(["Sales Invoice", "mx_stamped_xml", "is", "set"])
    elif status == "error":
        if not has_stamp_error:
            return []
        filters.append(["Sales Invoice", "mx_stamped_xml", "is", "not set"])
        filters.append(["Sales Invoice", "mx_stamp_error", "is", "set"])

    or_filters: list = []
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        or_filters = [
            ["Sales Invoice", "name", "like", like],
            ["Sales Invoice", "customer_name", "like", like],
            ["Sales Invoice", "tax_id", "like", like],
        ]

    fields = [
        "name", "posting_date", "grand_total", "currency", "customer",
        "customer_name", "is_return", "mx_uuid", "mx_stamped_xml",
        "mx_sat_status",
    ]
    if has_stamp_error:
        fields.append("mx_stamp_error")
    rows = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        or_filters=or_filters,
        fields=fields,
        order_by="posting_date desc, creation desc",
        limit_start=start,
        limit_page_length=limit,
    )
    out = []
    for row in rows:
        out.append({
            "name": row["name"],
            "posting_date": str(row["posting_date"] or ""),
            "grand_total": flt(row["grand_total"]),
            "currency": row["currency"],
            "customer": row["customer"],
            "customer_name": row["customer_name"],
            "is_return": cint(row["is_return"]),
            "mx_uuid": row.get("mx_uuid") or "",
            "sat_status": row.get("mx_sat_status") or "",
            "stamp_error": row.get("mx_stamp_error") or "",
            "stamp_status": _stamp_status(row),
        })
    return out


def _cfdi_file_names(invoice_name: str) -> dict:
    """Attached CFDI file names keyed by kind (pdf/xml), if present."""
    out = {}
    for kind in ("pdf", "xml"):
        file_name = f"{invoice_name}_CFDI.{kind}"
        if frappe.db.exists(
            "File",
            {
                "attached_to_doctype": "Sales Invoice",
                "attached_to_name": invoice_name,
                "file_name": file_name,
            },
        ):
            out[kind] = file_name
    return out


@frappe.whitelist(methods=["GET", "POST"])
def get_invoice_cfdi(invoice_name: str) -> dict:
    """Fiscal detail + customer prefill + emc preflight for the stamp form."""
    _require_emc()
    row = _fetch_invoice_row(invoice_name)
    frappe.has_permission("Sales Invoice", "read", invoice_name, throw=True)
    assert_company(frappe.session.user, row.company)

    doc = frappe.get_doc("Sales Invoice", invoice_name)

    customer_fiscal = {}
    if doc.customer:
        from posawesome.posawesome.api.cfdi_customer import get_customer_fiscal

        customer_fiscal = get_customer_fiscal(doc.customer)

    mode_of_payment = ""
    for payment in doc.get("payments", []) or []:
        if payment.mode_of_payment:
            mode_of_payment = payment.mode_of_payment
            break

    suggested_payment_mode = ""
    if mode_of_payment:
        from erpnext_mexico_compliance.overrides.sales_invoice import _resolve_payment_mode

        suggested_payment_mode = _resolve_payment_mode(mode_of_payment) or ""

    from erpnext_mexico_compliance.fiscal.validation import engine
    from erpnext_mexico_compliance.fiscal.validation.result import ERROR, status_from

    checks = engine.invoice_results(doc, deep=True)

    return {
        "invoice": {
            "name": doc.name,
            "posting_date": str(doc.posting_date or ""),
            "grand_total": flt(doc.grand_total),
            "currency": doc.currency,
            "docstatus": doc.docstatus,
            "is_return": cint(doc.get("is_return")),
            "customer": doc.customer,
            "customer_name": doc.customer_name,
            "customer_address": doc.get("customer_address") or "",
            "mx_cfdi_use": doc.get("mx_cfdi_use") or "",
            "mx_payment_option": doc.get("mx_payment_option") or "PUE",
            "mx_payment_mode": doc.get("mx_payment_mode") or suggested_payment_mode,
            "mode_of_payment": mode_of_payment,
            "mx_uuid": doc.get("mx_uuid") or "",
            "sat_status": doc.get("mx_sat_status") or "",
            "stamp_error": doc.get("mx_stamp_error") or "",
            "is_stamped": bool(doc.get("mx_stamped_xml")),
        },
        "customer_fiscal": customer_fiscal,
        "preflight": {
            "status": status_from(checks),
            "blocking": any(c.level == ERROR and not c.ok for c in checks),
            "checks": [c.as_dict() for c in checks],
        },
        "files": _cfdi_file_names(invoice_name),
    }


# ---------------------------------------------------------------------------
# stamping (write)
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["POST"])
def stamp_invoice(
    invoice_name: str,
    pos_profile: str,
    customer: str | None = None,
    customer_name: str | None = None,
    customer_address: str | None = None,
    zip_code: str | None = None,
    tax_id: str | None = None,
    tax_regime: str | None = None,
    mx_cfdi_use: str | None = None,
    mx_payment_option: str | None = None,
    mx_payment_mode: str | None = None,
    mode_of_payment: str | None = None,
) -> dict:
    """Stamp a submitted Sales Invoice through emc's review path.

    Scope (fetched values) → server-side fiscal revalidation → delegate to
    ``stamp_with_review``. Double-taps are friendly: an already-stamped
    invoice returns its stamped identity instead of an error; a true
    concurrent race still hard-throws inside emc (row lock + is_stamped
    guard), so a second CFDI can never be created.
    """
    _require_emc()
    row = _fetch_invoice_row(invoice_name)
    _assert_stamp_scope(pos_profile, row.company)

    if row.docstatus != 1:
        frappe.throw(_("Invoice {0} must be submitted before stamping").format(invoice_name))

    if row.mx_stamped_xml:
        return {
            "ok": True,
            "already_stamped": True,
            "invoice": invoice_name,
            "uuid": row.mx_uuid or "",
            "files": _cfdi_file_names(invoice_name),
        }

    # Never trust client fiscal data: emc revalidates everything at payload
    # build, but rejecting bad input HERE returns the operator a field-level
    # message instead of an opaque failure mid-stamp.
    if tax_id:
        from erpnext_mexico_compliance.fiscal.validation import engine

        bad = engine.first_error(
            engine.validate_fiscal_input(
                tax_id=tax_id,
                regime=tax_regime,
                uso=mx_cfdi_use,
                cp=zip_code,
                name=customer_name,
                deep=True,
            )
        )
        if bad:
            frappe.throw(bad.message)

    from erpnext_mexico_compliance.overrides.sales_invoice import stamp_with_review

    stamp_with_review(
        invoice_name=invoice_name,
        customer=customer,
        customer_name=customer_name,
        customer_address=customer_address,
        zip_code=zip_code,
        tax_id=(tax_id or "").upper() or None,
        tax_regime=tax_regime,
        mx_payment_option=mx_payment_option,
        mx_cfdi_use=mx_cfdi_use,
        mode_of_payment=mode_of_payment,
        mx_payment_mode=mx_payment_mode,
        mutate_existing=True,
    )

    stamped = frappe.db.get_value(
        "Sales Invoice", invoice_name, ["mx_uuid", "mx_sat_status"], as_dict=True
    )
    return {
        "ok": True,
        "already_stamped": False,
        "invoice": invoice_name,
        "uuid": (stamped and stamped.mx_uuid) or "",
        "sat_status": (stamped and stamped.mx_sat_status) or "",
        "files": _cfdi_file_names(invoice_name),
    }


@frappe.whitelist(methods=["POST"])
def attach_cfdi_files(invoice_name: str, pos_profile: str) -> dict:
    """(Re)attach the CFDI PDF/XML for a stamped invoice.

    Covers the crash window between a successful stamp and the file
    attachment — the stamp is durable (mx_facturapi_id committed first) but
    the files may be missing.
    """
    _require_emc()
    row = _fetch_invoice_row(invoice_name)
    _assert_stamp_scope(pos_profile, row.company)
    if not row.mx_stamped_xml:
        frappe.throw(_("Invoice {0} is not stamped").format(invoice_name))

    doc = frappe.get_doc("Sales Invoice", invoice_name)
    files = _cfdi_file_names(invoice_name)
    if "pdf" not in files:
        doc.attach_pdf()
    if "xml" not in files:
        doc.attach_xml()
    return {"ok": True, "files": _cfdi_file_names(invoice_name)}


# ---------------------------------------------------------------------------
# stamped-file delivery (read-only) + email
# ---------------------------------------------------------------------------


@frappe.whitelist(methods=["GET"])
def download_cfdi_file(invoice_name: str, kind: str = "pdf"):
    """Stream the attached CFDI PDF/XML to the browser."""
    _require_emc()
    kind = (kind or "pdf").lower()
    if kind not in ("pdf", "xml"):
        frappe.throw(_("Invalid download kind"))

    row = _fetch_invoice_row(invoice_name)
    frappe.has_permission("Sales Invoice", "read", invoice_name, throw=True)
    assert_company(frappe.session.user, row.company)

    file_name = f"{invoice_name}_CFDI.{kind}"
    file_doc_name = frappe.db.get_value(
        "File",
        {
            "attached_to_doctype": "Sales Invoice",
            "attached_to_name": invoice_name,
            "file_name": file_name,
        },
    )
    if not file_doc_name:
        frappe.throw(_("CFDI file is not available yet for {0}").format(invoice_name))

    content = frappe.get_doc("File", file_doc_name).get_content()
    if isinstance(content, str):
        content = content.encode("utf-8")
    frappe.local.response.filename = file_name
    frappe.local.response.filecontent = content
    frappe.local.response.type = "download"


@frappe.whitelist(methods=["POST"])
def email_cfdi(invoice_name: str, email: str, pos_profile: str) -> dict:
    """Send the stamped CFDI (PDF + XML) to ``email`` via the PAC."""
    _require_emc()
    if not (email or "").strip():
        frappe.throw(_("Email is required"))
    row = _fetch_invoice_row(invoice_name)
    _assert_stamp_scope(pos_profile, row.company)
    if not row.mx_stamped_xml:
        frappe.throw(_("Invoice {0} is not stamped").format(invoice_name))

    doc = frappe.get_doc("Sales Invoice", invoice_name)
    doc.send_cfdi_email(email.strip())
    return {"ok": True}
