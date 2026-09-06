"""Read-only, bounded POS exception feed. Recovery remains in existing workflows."""
import math

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from ._scope import assert_company, assert_customer_in_profile, assert_profile

INVOICE_TYPES = ("Sales Invoice", "POS Invoice")
LEDGER = "POS Invoice Submission Ledger"
MAX_LIMIT = 50


def _text(value, required=False):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 140:
        frappe.throw(_("A valid POS profile and opening shift are required."))
    return value.strip()


class Scope:
    def __init__(self, profile, opening, limit):
        self.profile = _text(profile, True)
        self.opening = _text(opening)
        assert_profile(frappe.session.user, self.profile)
        profile_doc = frappe.get_cached_doc("POS Profile", self.profile)
        self.company = profile_doc.company
        self.profile_doc = profile_doc
        assert_company(frappe.session.user, self.company)
        if cint(profile_doc.get("disabled")):
            frappe.throw(_("This POS profile is disabled."), frappe.PermissionError)
        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import is_closing_supervisor
        manager = is_closing_supervisor(frappe.session.user)
        if not self.opening and not manager:
            frappe.throw(_("An active opening shift is required to review money exceptions."), frappe.PermissionError)
        if self.opening:
            shift = frappe.db.get_value("POS Opening Shift", self.opening,
                ["pos_profile", "company", "user", "docstatus", "status"], as_dict=True)
            if (not shift or shift.pos_profile != self.profile or shift.company != self.company
                    or cint(shift.docstatus) != 1 or (shift.user != frappe.session.user and not manager)
                    or (shift.status != "Open" and not manager)):
                frappe.throw(_("Not permitted to review money exceptions for this opening shift."), frappe.PermissionError)
        try:
            self.limit = max(1, min(MAX_LIMIT, int(limit)))
        except (TypeError, ValueError, OverflowError):
            frappe.throw(_("Exception list limit must be a whole number."))
        self.params = dict(company=self.company, profile=self.profile, opening=self.opening, cap=self.limit + 1)
        self._permissions = {}
        self._customers = {}
        self._invoices = {}

    def visible(self, doctype, name):
        key = (doctype, name)
        if key not in self._permissions:
            self._permissions[key] = bool(name and frappe.has_permission(doctype, "read", name))
        return self._permissions[key]

    def customer(self, name):
        if not name:
            return False
        if name not in self._customers:
            try:
                assert_customer_in_profile(frappe.session.user, name, self.profile)
                self._customers[name] = self.visible("Customer", name)
            except frappe.PermissionError:
                self._customers[name] = False
        return self._customers[name]

    def invoice(self, doctype, name):
        if doctype not in INVOICE_TYPES or not name:
            return None
        key = (doctype, name)
        if key not in self._invoices:
            row = frappe.db.get_value(doctype, name, ["name", "company", "pos_profile", "posa_pos_opening_shift",
                "customer", "docstatus", "grand_total", "currency"], as_dict=True)
            valid = (row and row.company == self.company and row.pos_profile == self.profile
                and (not self.opening or row.posa_pos_opening_shift == self.opening)
                and cint(row.docstatus) != 2 and self.visible(doctype, name) and self.customer(row.customer))
            self._invoices[key] = row if valid else None
        return self._invoices[key]

    def invoice_predicate(self, alias="i"):
        return (f"{alias}.company=%(company)s AND {alias}.pos_profile=%(profile)s"
                + (f" AND {alias}.posa_pos_opening_shift=%(opening)s" if self.opening else ""))


def row(kind, record, status, message, action, *, document=None, invoice=None, amount=None, currency=None,
        request_id=None):
    try:
        amount = float(amount) if amount is not None else None
        if amount is not None and not math.isfinite(amount):
            amount = None
    except (ValueError, TypeError, OverflowError):
        amount = None
    return dict(id=kind + ":" + record.name, kind=kind, status=status,
        severity="warning" if status in ("Failed", "FAILED", "Manual Review", "error") else "info",
        modified=str(record.modified), message_key=message, next_action_key=action,
        document=document, invoice=invoice, client_request_id=request_id,
        amount=amount, currency=currency if amount is not None else None,
        actions=[dict(type=action)] + ([dict(type="open_document", **document)] if document else []))


def invoice_submissions(scope):
    out, more = [], False
    for doctype in INVOICE_TYPES:
        records = frappe.db.sql(f"""SELECT l.name,l.state,l.modified,l.client_request_id,l.invoice_name
            FROM `tab{LEDGER}` l INNER JOIN `tab{doctype}` i ON i.name=l.invoice_name
            WHERE l.company=%(company)s AND l.pos_profile=%(profile)s AND l.document_type=%(doctype)s
              AND l.state IN ('RECEIVED','DRAFT_CREATED','SUBMITTED','FAILED') AND i.docstatus IN (0,1)
              AND {scope.invoice_predicate()} ORDER BY l.modified DESC,l.name DESC LIMIT %(cap)s""",
            dict(scope.params, doctype=doctype), as_dict=True)
        more |= len(records) > scope.limit
        for record in records[:scope.limit]:
            invoice = scope.invoice(doctype, record.invoice_name)
            if not invoice:
                continue
            document = dict(doctype=doctype, name=invoice.name)
            message = ("Invoice submitted; payment follow-up needs review." if invoice.docstatus == 1
                       else "Saved invoice submission needs review before retrying.")
            out.append(row("invoice_submission", record, record.state, message, "open_offline_status",
                document=document, invoice=document, amount=invoice.grand_total, currency=invoice.currency,
                request_id=record.client_request_id))
    return out, more


def financial_requests(scope):
    # JSON is internal persisted intent. Extract only identity needed to scope
    # a receipt, never request payloads, terminal credentials, or raw errors.
    safe = "CASE WHEN JSON_VALID(l.request_data) THEN l.request_data ELSE '{}' END"
    field = lambda path: f"JSON_UNQUOTE(JSON_EXTRACT({safe}, '$.intent.{path}'))"
    opening = f"COALESCE({field('shift')},{field('pos_opening_shift')})"
    customer = f"COALESCE({field('party')},{field('customer')})"
    party_type = f"COALESCE({field('party_type')},'Customer')"
    extra = f" AND {opening}=%(opening)s" if scope.opening else ""
    records = frappe.db.sql(f"""SELECT l.name,l.state,l.modified,l.client_request_id,
        {customer} AS party,{party_type} AS party_type FROM `tab{LEDGER}` l
        WHERE l.company=%(company)s AND l.pos_profile=%(profile)s
        AND l.document_type='POS Payment Request' AND l.state IN ('RECEIVED','SUBMITTED','FAILED')
        {extra} ORDER BY l.modified DESC,l.name DESC LIMIT %(cap)s""", scope.params, as_dict=True)
    out = []
    for record in records[:scope.limit]:
        if record.party_type not in ("Customer", "Supplier") or not scope.visible(record.party_type, record.party):
            continue
        if record.party_type == "Customer" and not scope.customer(record.party):
            continue
        out.append(row("financial_request", record, record.state,
            "Payment request needs review; some steps may already be recorded.", "open_offline_status",
            request_id=record.client_request_id))
    return out, len(records) > scope.limit


@frappe.whitelist(methods=["GET", "POST"])
def get_money_exceptions(pos_profile, opening_shift=None, limit=30):
    """Navigation data only; never retries, acknowledges, enqueues, or writes money."""
    scope = Scope(pos_profile, opening_shift, limit)
    from .money_exception_sources import charge_callbacks, fiscal, processor
    adapters = dict(invoice_submissions=invoice_submissions, financial_receipts=financial_requests,
                    charge_callbacks=charge_callbacks, processor=processor, fiscal=fiscal)
    rows, sources = [], {}
    for name, adapter in adapters.items():
        try:
            result = adapter(scope)
            if result is None:
                sources[name] = dict(status="unavailable", count=0, has_more=False)
                continue
            entries, more = result
            rows.extend(entries)
            sources[name] = dict(status="supported", count=len(entries), has_more=bool(more))
        except Exception:
            # A failing adapter must remain visible without disclosing SQL,
            # tracebacks, provider responses, or claiming there are no issues.
            sources[name] = dict(status="error", count=0, has_more=False)
    rows.sort(key=lambda record: (record["modified"], record["id"]), reverse=True)
    has_more = len(rows) > scope.limit or any(source["has_more"] for source in sources.values())
    return dict(version=1, company=scope.company, pos_profile=scope.profile, opening_shift=scope.opening,
                as_of=str(now_datetime()), rows=rows[:scope.limit], count=min(len(rows), scope.limit),
                has_more=has_more, sources=sources)
