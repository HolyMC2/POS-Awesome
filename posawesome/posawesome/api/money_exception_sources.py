"""Optional app adapters for the read-only POS money-exception feed."""
import frappe
from frappe.utils import cint

from .money_exceptions import INVOICE_TYPES, row


def _installed(app, doctype, fields):
    return (app in frappe.get_installed_apps() and frappe.db.exists("DocType", doctype)
            and all(frappe.db.has_column(doctype, field) for field in fields))


def charge_callbacks(scope):
    from .charge_requests import _feature_enabled
    doctype = "POS Charge Request"
    if not _installed("doco", doctype, ("callback_status", "invoice_doctype", "invoice", "currency")):
        return None
    if not _feature_enabled(scope.profile):
        return None
    invoice_matches = " OR ".join(
        f"(c.invoice_doctype='{kind}' AND EXISTS (SELECT 1 FROM `tab{kind}` i"
        f" WHERE i.name=c.invoice AND i.docstatus=1 AND {scope.invoice_predicate()}))"
        for kind in INVOICE_TYPES)
    # Source-only settlements have no invoice/shift evidence; only a
    # supervisor's profile-wide view can include an explicitly pinned source.
    if not scope.opening:
        invoice_matches += " OR (c.settle_mode='Source' AND c.pos_profile=%(profile)s AND IFNULL(c.invoice,'')='')"
    records = frappe.db.sql(f"""SELECT c.name,c.modified,c.callback_status,c.invoice_doctype,c.invoice,
        c.customer,c.amount_total,c.currency FROM `tab{doctype}` c
        WHERE c.company=%(company)s AND c.status='Charged' AND c.callback_status IN ('Pending','Failed','Needs Review')
          AND (IFNULL(c.pos_profile,'')='' OR c.pos_profile=%(profile)s)
          AND ({invoice_matches}) ORDER BY c.modified DESC,c.name DESC LIMIT %(cap)s""", scope.params, as_dict=True)
    out = []
    for record in records[:scope.limit]:
        if not scope.customer(record.customer) or not scope.visible(doctype, record.name):
            continue
        invoice = None
        if record.invoice:
            if not scope.invoice(record.invoice_doctype, record.invoice):
                continue
            invoice = dict(doctype=record.invoice_doctype, name=record.invoice)
        document = dict(doctype=doctype, name=record.name)
        message = ("Payment recorded; the source document update failed." if record.callback_status in ("Failed", "Needs Review")
                   else "Payment recorded; the source document update is pending.")
        entry = row("charge_callback", record, record.callback_status, message, "open_document",
            document=document, invoice=invoice, amount=record.amount_total, currency=record.currency)
        entry["actions"] = [dict(type="open_document", **document)]
        out.append(entry)
    return out, len(records) > scope.limit


def fiscal(scope):
    if (not cint(scope.profile_doc.get("posa_cfdi_enable_stamping"))
            or not _installed("erpnext_mexico_compliance", "Sales Invoice", ("mx_stamp_error", "mx_stamped_xml"))):
        return None
    records = frappe.db.sql(f"""SELECT i.name,i.modified FROM `tabSales Invoice` i
        WHERE {scope.invoice_predicate()} AND i.docstatus=1
          AND IFNULL(i.mx_stamp_error,'')!='' AND IFNULL(i.mx_stamped_xml,'')=''
        ORDER BY i.modified DESC,i.name DESC LIMIT %(cap)s""", scope.params, as_dict=True)
    out = []
    for record in records[:scope.limit]:
        invoice = scope.invoice("Sales Invoice", record.name)
        if not invoice:
            continue
        document = dict(doctype="Sales Invoice", name=record.name)
        out.append(row("fiscal", record, "error", "Invoice recorded; fiscal stamping needs review.",
            "open_fiscal", document=document, invoice=document, amount=invoice.grand_total, currency=invoice.currency))
    return out, len(records) > scope.limit


def _saldo(scope):
    if (not cint(scope.profile_doc.get("saldo_enabled"))
            or not _installed("saldo", "Saldo Transaction", ("sales_invoice", "pos_invoice", "status"))):
        return None
    # Same explicit role gate as saldo.api.transactions._gate_pos_user, but
    # this adapter reads only safe state and does not invoke provider code.
    if not set(frappe.get_roles()) & {"System Manager", "Sales User", "Sales Manager", "Accounts User"}:
        return None
    out, more = [], False
    for doctype, field in (("Sales Invoice", "sales_invoice"), ("POS Invoice", "pos_invoice")):
        records = frappe.db.sql(f"""SELECT t.name,t.modified,t.status,i.name AS invoice
            FROM `tabSaldo Transaction` t INNER JOIN `tab{doctype}` i ON i.name=t.{field}
            WHERE {scope.invoice_predicate()} AND i.docstatus IN (0,1)
              AND t.status IN ('Pending','InProgress','Failed','Manual Review')
            ORDER BY t.modified DESC,t.name DESC LIMIT %(cap)s""", scope.params, as_dict=True)
        more |= len(records) > scope.limit
        for record in records[:scope.limit]:
            if not scope.invoice(doctype, record.invoice):
                continue
            document = dict(doctype=doctype, name=record.invoice)
            message = {"Pending": "Provider transaction is pending; review its existing status before retrying.",
                "InProgress": "Provider transaction is in progress; review its existing status before retrying.",
                "Failed": "Provider transaction failed; review the existing transaction.",
                "Manual Review": "Provider transaction needs manual review; do not create a replacement payment."}[record.status]
            out.append(row("processor", record, record.status, message, "open_recargas",
                           document=document, invoice=document))
    return out, more


# Only schema-declared statuses and explicit invoice links are inspected.
# Provider refresh/reconciliation endpoints may perform external I/O, so they
# are deliberately not called by this snapshot reader.
_PROVIDERS = (
    dict(app="mercadopago_connector", doctype="MercadoPago Payment", status="status",
         links=(("Sales Invoice", "sales_invoice", None), ("POS Invoice", "pos_invoice", None)),
         states=("Pending", "Processing", "Rejected", "Manual Review", "Charged Back"), company=True),
    dict(app="mercadopago_connector", doctype="MercadoPago Order", status="order_status",
         links=(("Sales Invoice", "pos_invoice", "invoice_doctype"), ("POS Invoice", "pos_invoice", "invoice_doctype")),
         states=("Local Draft", "created", "at_terminal", "processing", "expired", "canceled", "error")),
    dict(app="conekta_connector", doctype="Conekta Order", status="payment_status",
         links=(("Sales Invoice", "reference_name", "reference_doctype"), ("POS Invoice", "reference_name", "reference_doctype")),
         states=("creating", "pending_payment", "expired", "canceled")),
)


def _provider(scope, config):
    doctype, status = config["doctype"], config["status"]
    fields = [status] + [field for _, field, _ in config["links"]]
    fields += [kind for _, _, kind in config["links"] if kind]
    if not _installed(config["app"], doctype, fields) or not frappe.has_permission(doctype, "read"):
        return None
    out, more = [], False
    for invoice_type, link, type_field in config["links"]:
        extra = " AND t.company=%(company)s" if config.get("company") else ""
        if type_field:
            extra += f" AND t.{type_field}=%(invoice_type)s"
        records = frappe.db.sql(f"""SELECT t.name,t.modified,t.{status} AS status,i.name AS invoice
            FROM `tab{doctype}` t INNER JOIN `tab{invoice_type}` i ON i.name=t.{link}
            WHERE {scope.invoice_predicate()} AND i.docstatus IN (0,1) AND t.{status} IN %(states)s
            {extra} ORDER BY t.modified DESC,t.name DESC LIMIT %(cap)s""",
            dict(scope.params, states=config["states"], invoice_type=invoice_type), as_dict=True)
        more |= len(records) > scope.limit
        for record in records[:scope.limit]:
            if not scope.invoice(invoice_type, record.invoice) or not scope.visible(doctype, record.name):
                continue
            document = dict(doctype=doctype, name=record.name)
            entry = row("processor", record, record.status,
                "Review the existing provider transaction before collecting again.", "open_document",
                document=document, invoice=dict(doctype=invoice_type, name=record.invoice))
            entry["id"] = "processor:" + doctype + ":" + record.name
            entry["actions"] = [dict(type="open_document", **document)]
            if record.status in ("Rejected", "Manual Review", "Charged Back", "expired", "canceled", "error"):
                entry["severity"] = "warning"
            out.append(entry)
    return out, more


def processor(scope):
    results = [_saldo(scope)] + [_provider(scope, config) for config in _PROVIDERS]
    supported = [result for result in results if result is not None]
    if not supported:
        return None
    return [entry for entries, _ in supported for entry in entries], any(more for _, more in supported)
