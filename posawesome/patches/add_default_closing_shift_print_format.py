"""Ship a thermal-friendly default Print Format for POS Closing Shift.

Pairs with `add_closing_shift_print_format_field` — operators set the
new POS Profile selector to this format and get a paper ticket on
shift-close without any per-tenant template authoring.

Layout: 80mm-friendly (single column, monospaced sums, no logo).
Sections: header (shift + cashier + opening/closing timestamps),
opening + closing balances per payment method, taxes, grand totals.

Idempotent: skip insert if a Print Format with this name already
exists. Operators can subsequently customize the doc via Desk and
the patch will leave their edits alone on re-run.
"""

import frappe

FORMAT_NAME = "POSA Cierre de Caja"
DOCTYPE = "POS Closing Shift"

# Print-format HTML uses Frappe Jinja. doc fields available come from
# the POS Closing Shift schema: pos_profile, period_start_date,
# period_end_date, user, payment_reconciliation (child table with
# mode_of_payment / opening_amount / expected_amount / closing_amount
# / difference), grand_total, net_total, total_quantity, taxes,
# pos_transactions (per-invoice rows).
HTML_TEMPLATE = """\
{# Jinja sandbox notes (see memory: reference_jinja_sandbox.md):
   - `.format()` blocked → use frappe.utils.fmt_money for currency
     and plain int casts for counts.
   - `frappe.get_cached_value` blocked → show user id directly
     instead of looking up full_name.
   - frappe.utils.fmt_money / formatdate / format_time / flt are
     all whitelisted in safe_exec.
   `currency` resolves from doc.company → Company.default_currency
   when posting_date is set; passing `currency=None` lets fmt_money
   fall back to the company default which is what we want on POS. #}
{% set cur = frappe.utils.fmt_money %}
{% set tickets = (doc.pos_transactions|length) if doc.pos_transactions else 0 %}
<div class="posa-closing-ticket" style="font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.25; max-width: 76mm; margin: 0 auto;">
    <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: 14px; font-weight: bold; letter-spacing: 0.5px;">CIERRE DE CAJA</div>
        <div>{{ doc.pos_profile }}</div>
        <div style="font-size: 10px;">{{ doc.name }}</div>
    </div>

    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Cajero</td><td style="text-align: right;">{{ doc.user }}</td></tr>
        <tr><td>Apertura</td><td style="text-align: right;">{{ frappe.utils.formatdate(doc.period_start_date, 'short') }} {{ frappe.utils.format_time(doc.period_start_date) }}</td></tr>
        <tr><td>Cierre</td><td style="text-align: right;">{{ frappe.utils.formatdate(doc.period_end_date, 'short') }} {{ frappe.utils.format_time(doc.period_end_date) }}</td></tr>
        <tr><td>Compa&ntilde;&iacute;a</td><td style="text-align: right;">{{ doc.company }}</td></tr>
    </table>

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <div style="font-weight: bold; margin-bottom: 4px;">PAGOS</div>
    <table style="width: 100%; border-collapse: collapse;">
        <thead>
            <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left;">M&eacute;todo</th>
                <th style="text-align: right;">Apertura</th>
                <th style="text-align: right;">Esperado</th>
                <th style="text-align: right;">Cerrado</th>
                <th style="text-align: right;">Dif.</th>
            </tr>
        </thead>
        <tbody>
            {% for row in doc.payment_reconciliation or [] %}
            <tr>
                <td>{{ row.mode_of_payment }}</td>
                <td style="text-align: right;">{{ cur(row.opening_amount or 0) }}</td>
                <td style="text-align: right;">{{ cur(row.expected_amount or 0) }}</td>
                <td style="text-align: right;">{{ cur(row.closing_amount or 0) }}</td>
                <td style="text-align: right; font-weight: {{ 'bold' if (row.difference or 0) != 0 else 'normal' }};">{{ cur(row.difference or 0) }}</td>
            </tr>
            {% endfor %}
        </tbody>
    </table>

    {% if doc.taxes %}
    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>
    <div style="font-weight: bold; margin-bottom: 4px;">IMPUESTOS</div>
    <table style="width: 100%; border-collapse: collapse;">
        {% for tax in doc.taxes %}
        <tr><td>{{ tax.account_head }}</td><td style="text-align: right;">{{ cur(tax.amount or 0) }}</td></tr>
        {% endfor %}
    </table>
    {% endif %}

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Cantidad de tickets</td><td style="text-align: right;">{{ tickets }}</td></tr>
        <tr><td>Cantidad de art&iacute;culos</td><td style="text-align: right;">{{ (doc.total_quantity or 0)|int }}</td></tr>
        <tr><td>Subtotal</td><td style="text-align: right;">{{ cur(doc.net_total or 0) }}</td></tr>
        <tr style="border-top: 1px solid #000; font-weight: bold;"><td>TOTAL</td><td style="text-align: right;">{{ cur(doc.grand_total or 0) }}</td></tr>
    </table>

    <div style="text-align: center; margin-top: 12px; font-size: 10px;">
        Impreso: {{ frappe.utils.now() }}
    </div>
    <div style="text-align: center; margin-top: 4px;">
        ______________________
    </div>
    <div style="text-align: center; font-size: 10px;">Firma del cajero</div>
</div>
"""


def execute():
    if frappe.db.exists("Print Format", FORMAT_NAME):
        # Don't overwrite operator customizations.
        return

    pf = frappe.new_doc("Print Format")
    pf.update({
        "name": FORMAT_NAME,
        "doc_type": DOCTYPE,
        "module": "Posawesome",
        "print_format_type": "Jinja",
        "standard": "No",
        "disabled": 0,
        "custom_format": 1,
        "html": HTML_TEMPLATE,
        "font_size": 11,
        # 80mm thermal paper. `default_print_language` left blank →
        # honors site default.
        "page_number": "Hide",
        "raw_printing": 0,
    })
    pf.flags.ignore_permissions = True
    pf.insert()
    frappe.db.commit()
