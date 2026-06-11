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
   - `frappe.get_cached_value` blocked → show user id directly.
   - fmt_money / formatdate / format_time / flt / get_all are
     whitelisted in safe_exec. #}
{% set cur = frappe.utils.fmt_money %}
{% set flt = frappe.utils.flt %}
{% set tickets = (doc.pos_transactions|length) if doc.pos_transactions else 0 %}
{% set returns = doc.pos_transactions | selectattr("grand_total", "lt", 0) | list if doc.pos_transactions else [] %}
{% set returns_total = returns | map(attribute="grand_total") | map("float") | sum %}
{% set sales_tickets = tickets - (returns|length) %}
{% set taxes_total = (doc.taxes | map(attribute="amount") | map("float") | sum) if doc.taxes else 0 %}
{% set cash_rows = (doc.payment_reconciliation or []) | selectattr("mode_of_payment", "in", ["Cash", "Efectivo"]) | list %}
{% set cash_row = cash_rows[0] if cash_rows else None %}
{% set movements = frappe.get_all("POS Cash Movement",
    filters={"pos_opening_shift": doc.pos_opening_shift, "docstatus": 1},
    fields=["movement_type", "amount", "remarks"], order_by="creation asc") %}
<div class="posa-closing-ticket" style="font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.3; max-width: 76mm; margin: 0 auto;">

    <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: 15px; font-weight: bold; letter-spacing: 0.5px;">CIERRE DE CAJA</div>
        <div style="font-weight: bold;">{{ doc.pos_profile }}</div>
        <div style="font-size: 10px;">{{ doc.name }} &middot; {{ doc.company }}</div>
    </div>

    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Cajero</td><td style="text-align: right;">{{ doc.user }}</td></tr>
        <tr><td>Apertura</td><td style="text-align: right;">{{ frappe.utils.formatdate(doc.period_start_date, 'short') }} {{ frappe.utils.format_time(doc.period_start_date) }}</td></tr>
        <tr><td>Cierre</td><td style="text-align: right;">{{ frappe.utils.formatdate(doc.period_end_date, 'short') }} {{ frappe.utils.format_time(doc.period_end_date) }}</td></tr>
    </table>

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <div style="font-weight: bold; margin-bottom: 4px;">RESUMEN DE VENTAS</div>
    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Tickets de venta</td><td style="text-align: right;">{{ sales_tickets }}</td></tr>
        {% if returns %}
        <tr><td>Devoluciones</td><td style="text-align: right;">{{ returns|length }} ({{ cur(returns_total) }})</td></tr>
        {% endif %}
        <tr><td>Art&iacute;culos vendidos</td><td style="text-align: right;">{{ (doc.total_quantity or 0)|int }}</td></tr>
        {% if sales_tickets > 0 %}
        <tr><td>Ticket promedio</td><td style="text-align: right;">{{ cur(flt(doc.grand_total or 0) / sales_tickets) }}</td></tr>
        {% endif %}
        <tr><td>Subtotal (neto)</td><td style="text-align: right;">{{ cur(doc.net_total or 0) }}</td></tr>
        <tr><td>Impuestos</td><td style="text-align: right;">{{ cur(taxes_total) }}</td></tr>
        <tr style="border-top: 1px solid #000; font-weight: bold; font-size: 12px;">
            <td>TOTAL VENDIDO</td><td style="text-align: right;">{{ cur(doc.grand_total or 0) }}</td>
        </tr>
    </table>

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <div style="font-weight: bold; margin-bottom: 4px;">PAGOS POR M&Eacute;TODO</div>
    <table style="width: 100%; border-collapse: collapse;">
        <thead>
            <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left;">M&eacute;todo</th>
                <th style="text-align: right;">Esperado</th>
                <th style="text-align: right;">Contado</th>
                <th style="text-align: right;">Dif.</th>
            </tr>
        </thead>
        <tbody>
            {% for row in doc.payment_reconciliation or [] %}
            <tr>
                <td>{{ row.mode_of_payment }}</td>
                <td style="text-align: right;">{{ cur(row.expected_amount or 0) }}</td>
                <td style="text-align: right;">{{ cur(row.closing_amount or 0) }}</td>
                <td style="text-align: right; font-weight: {{ 'bold' if flt(row.difference or 0) != 0 else 'normal' }};">{{ cur(row.difference or 0) }}</td>
            </tr>
            {% endfor %}
        </tbody>
    </table>

    {% if cash_row %}
    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>
    <div style="font-weight: bold; margin-bottom: 4px;">ARQUEO DE EFECTIVO</div>
    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Fondo de apertura</td><td style="text-align: right;">{{ cur(cash_row.opening_amount or 0) }}</td></tr>
        <tr><td>Mov. del turno (ventas, cambio, gastos)</td><td style="text-align: right;">{{ cur(flt(cash_row.expected_amount or 0) - flt(cash_row.opening_amount or 0)) }}</td></tr>
        <tr style="border-top: 1px solid #000;"><td>Efectivo esperado</td><td style="text-align: right; font-weight: bold;">{{ cur(cash_row.expected_amount or 0) }}</td></tr>
        <tr><td>Efectivo contado</td><td style="text-align: right; font-weight: bold;">{{ cur(cash_row.closing_amount or 0) }}</td></tr>
    </table>
    {% set cash_diff = flt(cash_row.difference or 0) %}
    <div style="text-align: center; margin-top: 6px; padding: 4px; border: {{ '2px solid #000' if cash_diff != 0 else '1px dashed #000' }}; font-weight: bold; font-size: {{ '13px' if cash_diff != 0 else '11px' }};">
        {% if cash_diff < 0 %}FALTANTE: {{ cur(cash_diff) }}
        {% elif cash_diff > 0 %}SOBRANTE: {{ cur(cash_diff) }}
        {% else %}CAJA CUADRADA{% endif %}
    </div>
    {% endif %}

    {% if movements %}
    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>
    <div style="font-weight: bold; margin-bottom: 4px;">MOVIMIENTOS DE EFECTIVO</div>
    <table style="width: 100%; border-collapse: collapse;">
        {% for m in movements %}
        <tr>
            <td>{{ m.movement_type }}{% if m.remarks %} <span style="font-size: 9px;">({{ m.remarks[:24] }})</span>{% endif %}</td>
            <td style="text-align: right;">{{ cur(m.amount or 0) }}</td>
        </tr>
        {% endfor %}
    </table>
    {% endif %}

    {% if doc.pos_payments %}
    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>
    <div style="font-weight: bold; margin-bottom: 4px;">PAGOS / ANTICIPOS</div>
    <table style="width: 100%; border-collapse: collapse;">
        {% for p in doc.pos_payments %}
        <tr>
            <td>{{ p.payment_entry }}{% if p.mode_of_payment %} <span style="font-size: 9px;">({{ p.mode_of_payment }})</span>{% endif %}</td>
            <td style="text-align: right;">{{ cur(p.paid_amount or 0) }}</td>
        </tr>
        {% endfor %}
    </table>
    {% endif %}

    {% if doc.taxes %}
    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>
    <div style="font-weight: bold; margin-bottom: 4px;">IMPUESTOS</div>
    <table style="width: 100%; border-collapse: collapse;">
        {% for tax in doc.taxes %}
        <tr><td>{{ tax.account_head }}</td><td style="text-align: right;">{{ cur(tax.amount or 0) }}</td></tr>
        {% endfor %}
    </table>
    {% endif %}

    <div style="text-align: center; margin-top: 12px; font-size: 10px;">
        Impreso: {{ frappe.utils.now() }}
    </div>
    <table style="width: 100%; margin-top: 18px;">
        <tr>
            <td style="text-align: center; width: 50%;">
                ______________<br/><span style="font-size: 10px;">Firma cajero</span>
            </td>
            <td style="text-align: center; width: 50%;">
                ______________<br/><span style="font-size: 10px;">Firma supervisor</span>
            </td>
        </tr>
    </table>
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
