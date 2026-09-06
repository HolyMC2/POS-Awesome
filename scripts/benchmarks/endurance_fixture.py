"""Private LAB endurance fixture; run inside bench, JSON request on stdin.

Creates ordinary cashier/nonstock fixtures only. Audit is read-only. Cleanup
cancels only the explicitly scoped fixture's invoices through native hooks.
"""
import json
import re
import secrets
import sys

import frappe
from endurance_accounting import validate_cash_invoice


def financial_expectations(profile, cash_account):
    company = frappe.get_doc("Company", profile.company)
    taxes = frappe.get_doc("Sales Taxes and Charges Template", profile.taxes_and_charges).taxes
    if (company.default_currency != "MXN" or len(taxes) != 1 or taxes[0].charge_type != "On Net Total"
        or taxes[0].rate != 16 or taxes[0].included_in_print_rate != 1):
        raise ValueError("Endurance requires the known MXN inclusive IVA16 cash fixture")
    expected = {"receivable_account": company.default_receivable_account,
        "income_account": profile.income_account or company.default_income_account,
        "tax_account": taxes[0].account_head, "net_amount": 8.62, "tax_amount": 1.38}
    if len({cash_account, expected["receivable_account"], expected["income_account"], expected["tax_account"]}) != 4:
        raise ValueError("Fixture accounts must be distinct")
    return expected


def create(data):
    run_id = data["run_id"]
    if not re.fullmatch(r"[a-f0-9]{16}", run_id):
        raise ValueError("Invalid endurance run id")
    tag = "Endurance " + run_id
    user_name = "endurance-" + run_id + "@example.invalid"
    base = frappe.get_doc("POS Profile", data["base_profile"])
    if base.disabled:
        raise ValueError("Base profile is disabled")
    company = base.company
    currency = frappe.get_cached_value("Company", company, "default_currency")
    account = frappe.get_all("Account", filters={"company": company, "account_type": "Cash",
        "disabled": 0, "is_group": 0, "account_currency": currency}, pluck="name", limit=1)[0]
    expected_financial = financial_expectations(base, account)
    roles = [role for role in ["Sales User", "Accounts User", "Stock User", "POS User"] if frappe.db.exists("Role", role)]
    password = secrets.token_urlsafe(32)
    user = frappe.get_doc({"doctype": "User", "email": user_name, "first_name": tag,
        "enabled": 1, "send_welcome_email": 0, "new_password": password,
        "roles": [{"role": role} for role in roles]}).insert(ignore_permissions=True)
    customer = frappe.get_doc({"doctype": "Customer", "customer_name": tag,
        "customer_type": "Individual", "customer_group": frappe.get_all("Customer Group",
            filters={"is_group": 0}, pluck="name", limit=1)[0], "territory": "All Territories"}).insert(ignore_permissions=True)
    group = frappe.get_doc({"doctype": "Item Group", "item_group_name": tag,
        "parent_item_group": "All Item Groups", "is_group": 0}).insert(ignore_permissions=True)
    item = frappe.get_doc({"doctype": "Item", "item_code": tag, "item_name": tag,
        "item_group": group.name, "stock_uom": "Nos", "is_stock_item": 0,
        "is_sales_item": 1}).insert(ignore_permissions=True)
    mode = frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": tag,
        "type": "Cash", "accounts": [{"company": company, "default_account": account}]}).insert(ignore_permissions=True)
    profile = frappe.copy_doc(base)
    profile.name = tag
    profile.customer = customer.name
    profile.create_pos_invoice_instead_of_sales_invoice = 0
    profile.set("applicable_for_users", [{"user": user.name, "default": 1}])
    profile.set("customer_groups", [])
    profile.set("item_groups", [{"item_group": group.name}])
    profile.set("payments", [{"mode_of_payment": mode.name, "default": 1}])
    for key, value in {"posa_auto_print": 0, "posa_allow_background_submission": 0,
        "posa_allow_delete": 1, "posa_allow_delete_invoice": 1, "posa_hide_non_stock_items": 0}.items():
        if profile.meta.has_field(key):
            profile.set(key, value)
    profile.insert(ignore_permissions=True)
    price = frappe.get_doc({"doctype": "Item Price", "item_code": item.name,
        "price_list": profile.selling_price_list, "currency": currency, "price_list_rate": 10}).insert(ignore_permissions=True)
    proof = {"terminal_id": "endurance-" + run_id, "terminal_token": secrets.token_hex(32), "terminal_generation": 1}
    shift = frappe.get_doc({"doctype": "POS Opening Shift", "company": company,
        "pos_profile": profile.name, "user": user.name, "period_start_date": frappe.utils.now(),
        "balance_details": [{"mode_of_payment": mode.name, "opening_amount": 0}]})
    from posawesome.posawesome.api.shift_terminal import bind_new_shift
    bind_new_shift(shift, proof["terminal_id"], proof["terminal_token"])
    shift.insert(ignore_permissions=True).submit()
    return {"run_id": run_id, "tag": tag, "site": frappe.local.site, "company": company,
        "user": user.name, "password": password, "profile": profile.name, "customer": customer.name,
        "item": item.name, "item_group": group.name, "mode_of_payment": mode.name,
        "cash_account": account, "item_price": price.name, "shift": shift.name,
        "currency": currency, "expected_financial": expected_financial, "max_financial_cycles": 20, **proof}


def scope(fixture):
    run_id = fixture["run_id"]
    if not re.fullmatch(r"[a-f0-9]{16}", run_id) or fixture["site"] != frappe.local.site:
        raise ValueError("Wrong fixture scope")
    tag = "Endurance " + run_id
    if fixture["tag"] != tag or fixture["profile"] != tag or fixture["item"] != tag:
        raise ValueError("Fixture names do not match run")
    if fixture["user"] != "endurance-" + run_id + "@example.invalid":
        raise ValueError("Fixture user does not match run")
    profile = frappe.get_doc("POS Profile", fixture["profile"])
    shift = frappe.get_doc("POS Opening Shift", fixture["shift"])
    if profile.customer != fixture["customer"] or profile.company != fixture["company"]:
        raise ValueError("Profile scope changed")
    if shift.user != fixture["user"] or shift.pos_profile != profile.name:
        raise ValueError("Shift scope changed")
    if shift.posa_terminal_id != fixture["terminal_id"] or shift.posa_terminal_generation != 1:
        raise ValueError("Terminal scope changed")
    return profile, shift


def audit(fixture, request_id=None):
    profile, _ = scope(fixture)
    expected = financial_expectations(profile, fixture["cash_account"])
    if fixture.get("expected_financial") is not None and fixture["expected_financial"] != expected:
        raise ValueError("Fixture financial configuration changed")
    # Older private smoke manifests predate this proof field. Derive it from
    # the already verified profile/company, never from the invoice being tested.
    fixture = {**fixture, "expected_financial": expected}
    rows = frappe.get_all("Sales Invoice", filters={"pos_profile": profile.name}, fields=[
        "name", "customer", "docstatus", "posa_client_request_id", "grand_total", "rounded_total",
        "paid_amount", "outstanding_amount", "is_return"], order_by="creation asc", limit_page_length=1000)
    submitted = [row for row in rows if row.docstatus == 1]
    if len(submitted) > 20 or any(row.customer != fixture["customer"] or row.is_return for row in rows):
        raise ValueError("Unexpected financial documents in private profile")
    ids = [row.posa_client_request_id for row in submitted]
    duplicate_count = len(ids) - len(set(ids))
    if duplicate_count:
        raise ValueError("Duplicate financial request ids")
    verified = []
    for row in submitted:
        doc = frappe.get_doc("Sales Invoice", row.name)
        if len(doc.items) != 1 or doc.items[0].item_code != fixture["item"] or doc.items[0].qty != 1:
            raise ValueError("Unexpected invoice lines")
        total = row.rounded_total or row.grand_total
        if abs(row.paid_amount - total) > 0.001 or abs(row.outstanding_amount) > 0.001:
            raise ValueError("Invoice is not fully cash paid")
        ledger = frappe.get_all("GL Entry", filters={"voucher_type": "Sales Invoice", "voucher_no": row.name,
            "is_cancelled": 0}, fields=["account", "party_type", "party", "debit", "credit", "account_currency",
                "debit_in_account_currency", "credit_in_account_currency"])
        exact = validate_cash_invoice(fixture, doc.as_dict(), ledger)
        verified.append({"invoice": row.name, "request_id": row.posa_client_request_id,
            "docstatus": 1, "paid_amount": row.paid_amount, "outstanding_amount": row.outstanding_amount,
            "gl_rows": len(ledger), "gl_debit": sum(entry.debit for entry in ledger),
            "gl_credit": sum(entry.credit for entry in ledger), "verified": True, **exact})
    if request_id is not None:
        all_matches = frappe.get_all("Sales Invoice", filters={"posa_client_request_id": request_id}, pluck="name")
        matches = [row for row in verified if row["request_id"] == request_id]
        if len(all_matches) != 1 or len(matches) != 1:
            raise ValueError("Request does not identify exactly one submitted fixture invoice")
        return matches[0]
    return {"submitted": len(submitted), "drafts": len([row for row in rows if row.docstatus == 0]),
        "duplicate_financial_documents": duplicate_count, "invoices": verified, "verified": True}


def cleanup(fixture):
    profile, shift = scope(fixture)
    audit(fixture)
    for dt, field in [("Payment Entry", "party"), ("Journal Entry Account", "party")]:
        if frappe.db.count(dt, {field: fixture["customer"], "docstatus": 1}):
            raise ValueError("Unexpected receipt/journal needs explicit reconciliation before cleanup")
    docs = frappe.get_all("Sales Invoice", filters={"pos_profile": profile.name, "customer": fixture["customer"]},
        fields=["name", "docstatus"], order_by="creation desc", limit_page_length=1000)
    cancelled = []
    for row in docs:
        if row.docstatus == 1:
            doc = frappe.get_doc("Sales Invoice", row.name)
            doc.cancel()
            cancelled.append(row.name)
        elif row.docstatus == 0:
            frappe.delete_doc("Sales Invoice", row.name)
    if shift.docstatus == 1:
        shift.cancel()
    for dt, name in [("POS Profile", fixture["profile"]), ("Customer", fixture["customer"]), ("Item", fixture["item"])]:
        doc = frappe.get_doc(dt, name)
        doc.disabled = 1
        doc.save(ignore_permissions=True)
    user = frappe.get_doc("User", fixture["user"])
    user.enabled = 0
    user.save(ignore_permissions=True)
    mode = frappe.get_doc("Mode of Payment", fixture["mode_of_payment"])
    mode.enabled = 0
    mode.save(ignore_permissions=True)
    net = frappe.db.sql("select coalesce(sum(debit-credit),0) from `tabGL Entry` where party=%s", fixture["customer"])[0][0]
    if abs(net) > 0.001:
        raise ValueError("Cleanup left a party GL balance")
    return {"cancelled_invoices": cancelled, "net_party_gl": net, "verified": True}


def main():
    request = json.load(sys.stdin)
    site = request["site"]
    if site not in {"demo-abarrotes.lab.xoloitzcuintles.com", "doco-mirror.lab.xoloitzcuintles.com"}:
        raise ValueError("Endurance fixtures are LAB-only")
    frappe.init(site=site, sites_path=".")
    frappe.connect()
    frappe.set_user("Administrator")
    try:
        action = request["action"]
        if action == "create":
            result = create(request)
        elif action == "audit":
            result = audit(request["fixture"], request.get("request_id"))
        elif action == "cleanup":
            result = cleanup(request["fixture"])
        else:
            raise ValueError("Unknown fixture operation")
        if action == "audit":
            frappe.db.rollback()
        else:
            frappe.db.commit()
        print("ENDURANCE_RESULT " + json.dumps(result, default=str))
    except Exception:
        frappe.db.rollback()
        raise
    finally:
        frappe.destroy()


if __name__ == "__main__":
    main()
