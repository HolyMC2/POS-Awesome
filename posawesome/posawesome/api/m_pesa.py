# Copyright (c) 2021, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe, requests
from frappe import _
from frappe.utils import cint
from requests.auth import HTTPBasicAuth
import json


def get_token(app_key, app_secret, base_url):
    authenticate_uri = "/oauth/v1/generate?grant_type=client_credentials"
    authenticate_url = "{0}{1}".format(base_url, authenticate_uri)

    r = requests.get(authenticate_url, auth=HTTPBasicAuth(app_key, app_secret))

    return r.json()["access_token"]


def _assert_mpesa_enabled() -> None:
    """Reject the request unless the site explicitly opts into M-Pesa.

    Without this gate the `confirmation` + `validation` endpoints
    accept guest POSTs and insert an `Mpesa Payment Register` doc with
    `ignore_permissions=True` — a webhook-spam / data-injection vector
    for any site that does NOT use Safaricom M-Pesa.

    To opt in (typical Safaricom integration):
        bench --site <site> set-config -p posa_mpesa_enabled 1

    Full HMAC + IP-allowlist hardening lands in PR-SEC4
    (`REVIEW2/03 §1.2`); this kill-switch is the P0 minimum.
    """
    if not frappe.conf.get("posa_mpesa_enabled"):
        frappe.throw(
            _("M-Pesa is not enabled on this site"),
            frappe.PermissionError,
        )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def confirmation(**kwargs):
    _assert_mpesa_enabled()
    try:
        args = frappe._dict(kwargs)
        doc = frappe.new_doc("Mpesa Payment Register")
        doc.transactiontype = args.get("TransactionType")
        doc.transid = args.get("TransID")
        doc.transtime = args.get("TransTime")
        doc.transamount = args.get("TransAmount")
        doc.businessshortcode = args.get("BusinessShortCode")
        doc.billrefnumber = args.get("BillRefNumber")
        doc.invoicenumber = args.get("InvoiceNumber")
        doc.orgaccountbalance = args.get("OrgAccountBalance")
        doc.thirdpartytransid = args.get("ThirdPartyTransID")
        doc.msisdn = args.get("MSISDN")
        doc.firstname = args.get("FirstName")
        doc.middlename = args.get("MiddleName")
        doc.lastname = args.get("LastName")
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        context = {"ResultCode": 0, "ResultDesc": "Accepted"}
        return dict(context)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), str(e)[:140])
        context = {"ResultCode": 1, "ResultDesc": "Rejected"}
        return dict(context)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def validation(**kwargs):
    _assert_mpesa_enabled()
    context = {"ResultCode": 0, "ResultDesc": "Accepted"}
    return dict(context)


@frappe.whitelist(methods=["GET", "POST"])
def get_mpesa_mode_of_payment(company):
    # Silent empty on sites that never opted into M-Pesa: the SPA calls
    # this on every payment-screen load and swallows errors, so a throw
    # would only produce server-side 403 spam — but the data must not
    # leak either. Company scope binds the read on opted-in sites.
    if not frappe.conf.get("posa_mpesa_enabled"):
        return []
    from posawesome.posawesome.api._scope import assert_company

    assert_company(frappe.session.user, company)
    modes = frappe.get_all(
        "Mpesa C2B Register URL",
        filters={"company": company, "register_status": "Success"},
        fields=["mode_of_payment"],
    )
    modes_of_payment = []
    for mode in modes:
        if mode.mode_of_payment not in modes_of_payment:
            modes_of_payment.append(mode.mode_of_payment)
    return modes_of_payment


@frappe.whitelist(methods=["GET", "POST"])
def get_mpesa_draft_payments(
    company,
    mode_of_payment=None,
    mobile_no=None,
    full_name=None,
    payment_methods_list=None,
):
    # Audit r2 P0: `company` was passed straight to get_all — any
    # authenticated user could enumerate another company's draft M-Pesa
    # receipts (names, amounts, MSISDNs). Same silent-empty kill-switch
    # as get_mpesa_mode_of_payment; company scope binds opted-in reads.
    if not frappe.conf.get("posa_mpesa_enabled"):
        return []
    from posawesome.posawesome.api._scope import assert_company

    assert_company(frappe.session.user, company)

    filters = {"company": company, "docstatus": 0}
    if mode_of_payment:
        filters["mode_of_payment"] = mode_of_payment
    if mobile_no:
        filters["msisdn"] = ["like", f"%{mobile_no}%"]
    if full_name:
        filters["full_name"] = ["like", f"%{full_name}%"]
    if payment_methods_list:
        filters["mode_of_payment"] = ["in", json.loads(payment_methods_list)]

    payments = frappe.get_all(
        "Mpesa Payment Register",
        filters=filters,
        fields=[
            "name",
            "transid",
            "msisdn as mobile_no",
            "full_name",
            "posting_date",
            "transamount as amount",
            "currency",
            "mode_of_payment",
            "company",
        ],
        order_by="posting_date desc",
    )
    return payments


@frappe.whitelist(methods=["POST"])
def submit_mpesa_payment(mpesa_payment, customer, expected_company=None):
    """Bind a draft M-Pesa receipt to a customer and mint its Payment Entry.

    Audit r2 P0: this used to load ANY named register row, overwrite its
    customer with a caller-chosen value and submit — cross-company deposit
    capture. Mutations refuse loudly (no silent-empty here): the register
    must be a draft in a company the session user is scoped to, and the
    customer must exist. ``expected_company`` lets the POS payment
    processor additionally pin the row to the active profile's company; a
    client-supplied value can only narrow, never widen, the check.
    ``doc.submit()`` still enforces the doctype's own write/submit
    permissions — this guard runs before any mutation.
    """
    _assert_mpesa_enabled()
    from posawesome.posawesome.api._scope import assert_company

    doc = frappe.get_doc("Mpesa Payment Register", mpesa_payment)
    if cint(doc.docstatus) != 0:
        frappe.throw(
            _("M-Pesa payment {0} is not a draft.").format(mpesa_payment),
            frappe.ValidationError,
        )
    assert_company(frappe.session.user, doc.company)
    if expected_company and doc.company != expected_company:
        frappe.throw(
            _("M-Pesa payment {0} does not belong to company {1}.").format(
                mpesa_payment, expected_company
            ),
            frappe.PermissionError,
        )
    if not customer or not frappe.db.exists("Customer", customer):
        frappe.throw(_("Customer {0} not found.").format(customer))
    doc.customer = customer
    doc.submit_payment = 1
    doc.submit()
    doc.reload()
    return frappe.get_doc("Payment Entry", doc.payment_entry)
