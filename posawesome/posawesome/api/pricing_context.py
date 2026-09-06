"""Read authoritative ERPNext prices in the invoice's unit and currency."""

import math

import frappe
from frappe import _
from frappe.utils import flt, getdate, today


def _value(row, field):
    return row.get(field) if isinstance(row, dict) else getattr(row, field, None)


def invoice_exchange_rates(invoice, price_list=None):
    """Derive ERPNext's two company-currency conversion factors on the server."""
    from erpnext.setup.utils import get_exchange_rate

    company = _value(invoice, "company")
    company_currency = frappe.get_cached_value("Company", company, "default_currency")
    currency = _value(invoice, "currency") or company_currency
    price_currency = frappe.get_cached_value("Price List", price_list, "currency") if price_list else currency
    if not company_currency or not currency or not price_currency:
        frappe.throw(_("Company and price-list currencies are required to verify exchange rates."))
    date = getdate(_value(invoice, "posting_date") or today())
    original = None
    if _value(invoice, "is_return") and _value(invoice, "return_against"):
        doctype = _value(invoice, "doctype")
        if doctype not in ("Sales Invoice", "POS Invoice"):
            frappe.throw(_("The return's original invoice does not match its currency or party."))
        original = frappe.get_doc(doctype, _value(invoice, "return_against"))
        if (
            original.docstatus != 1
            or original.company != company
            or original.currency != currency
            or original.customer != _value(invoice, "customer")
        ):
            frappe.throw(_("The return's original invoice does not match its currency or party."))

    def positive(rate):
        rate = flt(rate)
        if not math.isfinite(rate) or rate <= 0:
            frappe.throw(_("A valid selling exchange rate is required to verify this item's price."))
        return rate

    conversion = positive(
        original.conversion_rate
        if original
        else get_exchange_rate(currency, company_currency, date, "for_selling")
    )
    plc_conversion = positive(
        original.plc_conversion_rate
        if original
        and original.selling_price_list == price_list
        and original.price_list_currency == price_currency
        else get_exchange_rate(price_currency, company_currency, date, "for_selling")
    )
    return dict(
        currency=currency,
        price_list_currency=price_currency,
        conversion_rate=conversion,
        plc_conversion_rate=plc_conversion,
    )


def apply_invoice_exchange_rates(invoice, profile=None):
    from posawesome.posawesome.api._reprice import _pricing_price_list

    price_list = _pricing_price_list(invoice, profile)
    rates = invoice_exchange_rates(invoice, price_list)
    if price_list:
        invoice.selling_price_list = price_list
    invoice.update(rates)
    return rates


def reference_rate_lookup(invoice, price_list):
    """Return a transaction-local memoized resolver; never cache on client docs.

    ERPNext owns validity dates, party/batch prices, packing quantities,
    variant fallback and UOM conversion. Client conversion factors and
    price-list currencies are deliberately excluded from this context.
    """
    from erpnext.stock.get_item_details import get_conversion_factor, get_price_list_rate_for

    prices, items, factors = {}, {}, {}
    date = getdate(_value(invoice, "posting_date") or today())
    customer = _value(invoice, "customer")
    currency_factor = None
    list_doc = None

    def lookup(line):
        nonlocal currency_factor, list_doc
        item_code = _value(line, "item_code")
        if not item_code or not price_list:
            return None
        if item_code not in items:
            items[item_code] = frappe.get_cached_value(
                "Item", item_code, ["stock_uom", "variant_of"], as_dict=True
            )
        item = items[item_code]
        uom = _value(line, "uom") or item.stock_uom
        qty = abs(flt(_value(line, "qty")))
        batch = _value(line, "batch_no") or None
        key = (item_code, uom, qty, batch)
        if key in prices:
            return prices[key]
        if list_doc is None:
            list_doc = frappe.get_cached_value(
                "Price List", price_list, ["currency", "price_not_uom_dependent"], as_dict=True
            )
        if (item_code, uom) not in factors:
            factors[item_code, uom] = get_conversion_factor(item_code, uom)["conversion_factor"]
        ctx = frappe._dict(
            price_list=price_list,
            customer=customer,
            transaction_date=date,
            uom=uom,
            stock_uom=item.stock_uom,
            qty=qty,
            batch_no=batch,
            conversion_factor=factors[item_code, uom],
            price_list_uom_dependant=not list_doc.price_not_uom_dependent,
        )
        rate = get_price_list_rate_for(ctx, item_code)
        if rate is None and item.variant_of:
            rate = get_price_list_rate_for(ctx, item.variant_of)
        if rate is not None:
            if currency_factor is None:
                currency = _value(invoice, "currency") or list_doc.currency
                if currency == list_doc.currency:
                    currency_factor = 1.0
                else:
                    rates = invoice_exchange_rates(invoice, price_list)
                    currency_factor = rates["plc_conversion_rate"] / rates["conversion_rate"]
            rate = flt(rate) * currency_factor
        prices[key] = rate
        return rate

    return lookup
