import frappe
from posawesome.posawesome.api.payment_processing.integrity import authorize_payment_access
from frappe import _
from frappe.utils import nowdate, getdate, flt, cint
from erpnext.accounts.party import get_party_account
from erpnext.controllers.accounts_controller import get_advance_payment_entries_for_regional
from erpnext.setup.utils import get_exchange_rate

MAX_OUTSTANDING_PAGE_LENGTH = 500


def _resolve_party_inputs(customer=None, party=None, party_type=None):
    resolved_party = party if party is not None else customer
    return resolved_party, (party_type or "Customer")


def _get_open_sales_invoices(
    customer,
    company,
    currency=None,
    pos_profile=None,
    include_all_currencies=False,
):
    filters = {
        "customer": customer,
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
    }
    if currency and not include_all_currencies:
        filters["currency"] = currency
    if pos_profile:
        filters["pos_profile"] = pos_profile

    return frappe.get_list(
        "Sales Invoice",
        filters=filters,
        fields=[
            "name",
            "posting_date",
            "due_date",
            "outstanding_amount",
            "rounded_total",
            "base_rounded_total",
            "grand_total",
            "base_grand_total",
            "currency",
            "pos_profile",
            "customer_name",
            "conversion_rate",
            "party_account_currency",
            "is_return",
        ],
        order_by="posting_date desc, name desc",
    )


def _get_open_purchase_invoices(
    supplier,
    company,
    currency=None,
    include_all_currencies=False,
):
    filters = {
        "supplier": supplier,
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
    }
    if currency and not include_all_currencies:
        filters["currency"] = currency

    return frappe.get_list(
        "Purchase Invoice",
        filters=filters,
        fields=[
            "name",
            "posting_date",
            "due_date",
            "outstanding_amount",
            "rounded_total",
            "base_rounded_total",
            "grand_total",
            "base_grand_total",
            "currency",
            "supplier_name",
            "conversion_rate",
            "party_account_currency",
            "is_return",
        ],
        order_by="posting_date desc, name desc",
    )


def _coerce_text_filter(value, field_label):
    if value is None:
        return None
    if isinstance(value, (list, tuple, dict, set)):
        frappe.throw(_("Invalid {0} filter").format(field_label))

    coerced = str(value).strip()
    if not coerced:
        return None
    return coerced


def _coerce_non_negative_int(value, default=0):
    try:
        parsed = cint(value)
    except Exception:
        return default
    return max(parsed, 0)


def _coerce_bool(value, default=False):
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    if isinstance(value, (int, float)):
        return bool(value)

    if isinstance(value, str):
        lowered = value.strip().lower()
        if not lowered:
            return default
        if lowered in {"1", "true", "yes", "y", "on", "t"}:
            return True
        if lowered in {"0", "false", "no", "n", "off", "f"}:
            return False
        try:
            return bool(int(lowered))
        except Exception:
            return default

    return default


@frappe.whitelist(methods=["GET", "POST"])
def get_outstanding_invoices(
    customer=None,
    company=None,
    currency=None,
    pos_profile=None,
    include_all_currencies=False,
    page_start=0,
    page_length=None,
    party=None,
    party_type="Customer",
):
    """
    Fetch outstanding invoices with optional multi-currency support.

    Args:
        include_all_currencies (bool): If True, returns invoices in ALL currencies instead of filtering
    """
    try:
        customer = _coerce_text_filter(customer, _("Customer"))
        party = _coerce_text_filter(party, _("Party"))
        customer, party_type = _resolve_party_inputs(customer=customer, party=party, party_type=party_type)
        company = _coerce_text_filter(company, _("Company"))
        currency = _coerce_text_filter(currency, _("Currency"))
        pos_profile = _coerce_text_filter(pos_profile, _("POS Profile"))
        include_all_currencies = _coerce_bool(include_all_currencies, default=False)

        if not customer or not company:
            return []
        authorize_payment_access(company, party_type, customer, pos_profile)

        page_start = _coerce_non_negative_int(page_start, default=0)
        page_length = _coerce_non_negative_int(page_length, default=0)
        if page_length:
            page_length = min(page_length, MAX_OUTSTANDING_PAGE_LENGTH)

        label_doctype = "Supplier" if party_type == "Supplier" else "Customer"
        label_field = "supplier_name" if party_type == "Supplier" else "customer_name"
        customer_name = frappe.get_cached_value(label_doctype, customer, label_field)

        invoice_rows = (
            _get_open_purchase_invoices(
                supplier=customer,
                company=company,
                currency=currency,
                include_all_currencies=include_all_currencies,
            )
            if party_type == "Supplier"
            else _get_open_sales_invoices(
                customer=customer,
                company=company,
                currency=currency,
                pos_profile=pos_profile,
                include_all_currencies=include_all_currencies,
            )
        )

        normalized_rows = []
        for invoice in invoice_rows:
            invoice_outstanding = flt(invoice.get("outstanding_amount"))
            conversion_rate = flt(invoice.get("conversion_rate")) or 1

            outstanding_amount = invoice_outstanding

            if outstanding_amount == 0:
                continue

            row_currency = invoice.get("currency") or currency

            # Convert outstanding from party account currency to invoice currency
            # Examples:
            # - Party YER (company), Invoice USD: 60,003 YER ÷ 531 (YER/USD) = 113 USD
            # - Party USD (invoice), Invoice USD: 100 USD → 100 USD (no conversion)
            party_account_currency = invoice.get("party_account_currency") or currency
            company_currency = frappe.get_cached_value("Company", company, "default_currency")
            if party_account_currency == row_currency:
                outstanding_in_invoice_currency = outstanding_amount
            elif party_account_currency == company_currency:
                precision = frappe.get_precision("Sales Invoice", "outstanding_amount") or 2
                if conversion_rate > 0:
                    outstanding_in_invoice_currency = flt(outstanding_amount / conversion_rate, precision)
                else:
                    outstanding_in_invoice_currency = outstanding_amount
            else:
                # Third currency: convert from party account currency to invoice currency
                precision = frappe.get_precision("Sales Invoice", "outstanding_amount") or 2
                party_to_inv = get_exchange_rate(party_account_currency, row_currency, invoice.get("posting_date"))
                if party_to_inv:
                    outstanding_in_invoice_currency = flt(outstanding_amount / party_to_inv, precision)
                else:
                    outstanding_in_invoice_currency = flt(outstanding_amount / conversion_rate, precision) if conversion_rate > 0 else outstanding_amount
            invoice_total = flt(
                invoice.get("rounded_total")
                or invoice.get("grand_total")
                or outstanding_in_invoice_currency
            )

            normalized_rows.append(
                frappe._dict(
                    {
                        "voucher_no": invoice.get("name"),
                        "voucher_type": "Purchase Invoice" if party_type == "Supplier" else "Sales Invoice",
                        "outstanding_amount": outstanding_amount,
                        "outstanding_amount_in_invoice_currency": outstanding_in_invoice_currency,
                        "invoice_amount": invoice_total,
                        "due_date": invoice.get("due_date") or invoice.get("posting_date"),
                        "posting_date": invoice.get("posting_date"),
                        "currency": row_currency,
                        "pos_profile": invoice.get("pos_profile") if party_type == "Customer" else None,
                        "customer": customer,
                        "customer_name": (
                            invoice.get("supplier_name")
                            if party_type == "Supplier"
                            else invoice.get("customer_name")
                        )
                        or customer_name,
                        "party": customer,
                        "party_name": (
                            invoice.get("supplier_name")
                            if party_type == "Supplier"
                            else invoice.get("customer_name")
                        )
                        or customer_name,
                        "party_type": party_type,
                        "is_return": cint(invoice.get("is_return")),
                        "conversion_rate": conversion_rate,
                    }
                )
            )

        normalized_rows = sorted(
            normalized_rows,
            key=lambda inv: (
                getdate(inv.get("posting_date")) if inv.get("posting_date") else getdate(nowdate()),
                inv.get("voucher_no"),
            ),
            reverse=True,
        )

        if page_length:
            return normalized_rows[page_start : page_start + page_length]

        return normalized_rows
    except frappe.PermissionError:
        raise
    except Exception as e:
        frappe.logger().error(f"Error in get_outstanding_invoices: {str(e)}")
        return []


@frappe.whitelist(methods=["GET", "POST"])
def get_unallocated_payments(
    customer,
    company,
    currency=None,
    mode_of_payment=None,
    include_all_currencies=False,
    party=None,
    party_type="Customer",
):
    customer = _coerce_text_filter(customer, _("Customer"))
    party = _coerce_text_filter(party, _("Party"))
    customer, party_type = _resolve_party_inputs(customer=customer, party=party, party_type=party_type)
    company = _coerce_text_filter(company, _("Company"))
    currency = _coerce_text_filter(currency, _("Currency"))
    mode_of_payment = _coerce_text_filter(mode_of_payment, _("Mode of Payment"))
    include_all_currencies = _coerce_bool(include_all_currencies, default=False)

    if not customer or not company:
        return []
    authorize_payment_access(company, party_type, customer)

    label_doctype = "Supplier" if party_type == "Supplier" else "Customer"
    label_field = "supplier_name" if party_type == "Supplier" else "customer_name"
    customer_name = frappe.get_cached_value(label_doctype, customer, label_field)
    party_account = get_party_account(party_type, customer, company)

    filters = {
        "party": customer,
        "company": company,
        "docstatus": 1,
        "party_type": party_type,
        "payment_type": "Pay" if party_type == "Supplier" else "Receive",
        "unallocated_amount": [">", 0],
    }
    if currency and not include_all_currencies:
        filters["paid_to_account_currency" if party_type == "Supplier" else "paid_from_account_currency"] = (
            currency
        )
    if mode_of_payment:
        filters.update({"mode_of_payment": mode_of_payment})
    unallocated_payment = frappe.get_list(
        "Payment Entry",
        filters=filters,
        fields=[
            "name",
            "paid_amount",
            "party_name as customer_name",
            "received_amount",
            "posting_date",
            "unallocated_amount",
            "mode_of_payment",
            "source_exchange_rate",
            (
                "paid_to_account_currency as currency"
                if party_type == "Supplier"
                else "paid_from_account_currency as currency"
            ),
            ("paid_to as account" if party_type == "Supplier" else "paid_from as account"),
        ],
        order_by="posting_date asc",
    )

    # If strict currency filtering produces no rows, fall back to all
    # currencies for visibility.
    if not include_all_currencies and currency and not unallocated_payment:
        fallback_filters = dict(filters)
        fallback_filters.pop(
            "paid_to_account_currency" if party_type == "Supplier" else "paid_from_account_currency",
            None,
        )
        unallocated_payment = frappe.get_list(
            "Payment Entry",
            filters=fallback_filters,
            fields=[
                "name",
                "paid_amount",
                "party_name as customer_name",
                "received_amount",
                "posting_date",
                "unallocated_amount",
                "mode_of_payment",
                "source_exchange_rate",
                (
                    "paid_to_account_currency as currency"
                    if party_type == "Supplier"
                    else "paid_from_account_currency as currency"
                ),
                ("paid_to as account" if party_type == "Supplier" else "paid_from as account"),
            ],
            order_by="posting_date asc",
        )
    for payment in unallocated_payment:
        payment["voucher_type"] = "Payment Entry"
        payment["is_credit_note"] = 0
        payment["party_type"] = party_type
        payment["party_name"] = payment.get("customer_name")

    if party_type == "Supplier":
        unallocated_payment.extend(_credit_note_rows(customer, company, party_type, currency, unallocated_payment))
        return sorted(unallocated_payment, key=lambda row: (str(row.get("posting_date") or ""), row.get("name")))

    # Reconciliation fetch that also includes advances linked to Sales Order,
    # not only Payment Entries with unallocated_amount > 0.
    condition = frappe._dict(
        {
            "company": company,
            "get_payments": True,
        }
    )
    regional_entries = get_advance_payment_entries_for_regional(
        "Customer",
        customer,
        [party_account],
        "Sales Order",
        against_all_orders=True,
        condition=condition,
    )

    existing_keys = {(row.get("voucher_type"), row.get("name")) for row in unallocated_payment}
    for row in regional_entries or []:
        reference_type = row.get("reference_type")
        reference_name = row.get("reference_name")
        amount = flt(row.get("amount"))

        # POS supports receipt advances and invoice credit notes. Journal
        # adjustments remain available through ERPNext Desk reconciliation.
        if reference_type not in ("Payment Entry", "Sales Invoice") or not reference_name or amount <= 0:
            continue

        key = (reference_type, reference_name)
        if key in existing_keys:
            continue

        mode_of_payment_label = row.get("mode_of_payment")
        if reference_type == "Sales Invoice":
            mode_of_payment_label = _("Credit Note")

        unallocated_payment.append(
            {
                "name": reference_name,
                "paid_amount": amount,
                "received_amount": amount,
                "customer_name": customer_name,
                "party_name": customer_name,
                "posting_date": row.get("posting_date"),
                "unallocated_amount": amount,
                "mode_of_payment": mode_of_payment_label,
                "currency": row.get("currency") or currency,
                "voucher_type": reference_type,
                "is_credit_note": 1 if reference_type == "Sales Invoice" else 0,
                "reference_row": row.get("reference_row"),
                "account": row.get("account") or party_account,
                "remarks": row.get("remarks"),
                "cost_center": row.get("cost_center"),
                "exchange_rate": flt(row.get("exchange_rate")) or 1,
                "is_advance": row.get("is_advance"),
            }
        )
        existing_keys.add(key)

    unallocated_payment.extend(_credit_note_rows(customer, company, party_type, currency, unallocated_payment))

    unallocated_payment = sorted(
        unallocated_payment,
        key=lambda pay: (
            getdate(pay.get("posting_date")) if pay.get("posting_date") else getdate(nowdate()),
            pay.get("name"),
        ),
    )

    return unallocated_payment


def _credit_note_rows(party, company, party_type, currency, existing):
    invoice_type = "Purchase Invoice" if party_type == "Supplier" else "Sales Invoice"
    party_field = "supplier" if party_type == "Supplier" else "customer"
    label_field = party_field + "_name"
    existing_keys = {(row.get("voucher_type"), row.get("name")) for row in existing}
    notes = frappe.get_list(invoice_type,
        filters={party_field: party, "company": company, "docstatus": 1,
                 "is_return": 1, "outstanding_amount": ("<", 0)},
        fields=["name", "posting_date", label_field, "return_against", "outstanding_amount",
                "currency", "party_account_currency", "conversion_rate", "remarks"],
        order_by="posting_date asc")
    result = []
    for note in notes:
        if (invoice_type, note.name) in existing_keys:
            continue
        amount = abs(flt(note.outstanding_amount))
        if not amount:
            continue
        result.append(dict(name=note.name, paid_amount=amount, received_amount=amount,
            customer_name=note.get(label_field), party_name=note.get(label_field), party_type=party_type,
            posting_date=note.posting_date, unallocated_amount=amount,
            mode_of_payment=_("Debit Note") if party_type == "Supplier" else _("Credit Note"),
            currency=note.get("party_account_currency") or note.currency or currency,
            invoice_currency=note.currency, voucher_type=invoice_type, is_credit_note=1,
            return_against=note.return_against, reference_invoice=note.return_against,
            conversion_rate=note.conversion_rate, remarks=note.remarks))
    return result


@frappe.whitelist(methods=["GET", "POST"])
def get_available_pos_profiles(company, currency):
    pos_profiles_list = frappe.get_list(
        "POS Profile",
        filters={"disabled": 0, "company": company, "currency": currency},
        page_length=1000,
        pluck="name",
    )
    return pos_profiles_list


@frappe.whitelist(methods=["GET", "POST"])
def get_unreconciled_entries(
    customer,
    company,
    currency=None,
    pos_profile=None,
    mode_of_payment=None,
    include_all_currencies=False,
):
    return {
        "invoices": get_outstanding_invoices(
            customer=customer,
            company=company,
            currency=currency,
            pos_profile=pos_profile,
            include_all_currencies=include_all_currencies,
        ),
        "payments": get_unallocated_payments(
            customer=customer,
            company=company,
            currency=currency,
            mode_of_payment=mode_of_payment,
            include_all_currencies=include_all_currencies,
        ),
    }
