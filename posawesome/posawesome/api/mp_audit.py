# Copyright (c) 2026, doco contributors
# For license information, please see license.txt
"""Server-side audit trail for MercadoPago Point supervisor overrides.

The POS sale-gate (useMpPointSaleGate.ts) blocks finalize until the Point
terminal confirms the charge. A supervisor can override (terminal offline /
already charged on the device). Before this module the only trace was a
stamp appended to the invoice `remarks` — editable after the fact. Here we
persist a Comment on the invoice timeline (server-stamped user + time), so
every override is independently auditable.
"""

from __future__ import annotations

import frappe
from frappe import _

from ._scope import assert_company

_AUDITABLE_DOCTYPES = ("Sales Invoice", "POS Invoice")


@frappe.whitelist(methods=["POST"])
def log_mp_override(invoice_name=None, doctype="Sales Invoice", note=None):
    """Record a supervisor override of the MP Point gate.

    Best-effort by design: the POS calls this fire-and-forget, the sale
    must not block on audit plumbing. Returns {"logged": bool}.

    The Comment insert runs with ignore_permissions, so the target must be
    scope-checked: otherwise any logged-in user could forge "[MP-OVERRIDE]
    Authorized by X" entries onto invoices in companies they can't access,
    poisoning the very audit trail this exists to protect.
    """
    user = frappe.session.user
    if doctype not in _AUDITABLE_DOCTYPES:
        frappe.throw(_("Unsupported doctype for MP override audit."), frappe.PermissionError)
    if invoice_name and frappe.db.exists(doctype, invoice_name):
        assert_company(user, frappe.db.get_value(doctype, invoice_name, "company"))
    detail = _(
        "[MP-OVERRIDE] Point terminal sale finalized WITHOUT terminal "
        "confirmation. Authorized by {0}."
    ).format(user)
    if note:
        detail += " {0}".format(frappe.utils.strip_html(str(note))[:280])

    logged = False
    if invoice_name and frappe.db.exists(doctype, invoice_name):
        comment = frappe.get_doc(
            {
                "doctype": "Comment",
                "comment_type": "Comment",
                "reference_doctype": doctype,
                "reference_name": invoice_name,
                "content": detail,
            }
        )
        comment.flags.ignore_permissions = True
        comment.insert(ignore_permissions=True)
        logged = True

    # Always leave a server-log line too (survives even if the draft is
    # later deleted before submit).
    frappe.logger("mp_point").warning(
        "MP-OVERRIDE user=%s invoice=%s note=%s", user, invoice_name, note
    )
    return {"logged": logged}
