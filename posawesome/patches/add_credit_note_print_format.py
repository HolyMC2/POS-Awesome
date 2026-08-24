"""Ship an 80mm Print Format for the nota de crédito (DOCUMENTOS_GOLDEN_FLOW §2).

A credit note IS a submitted return Sales Invoice with no payments, so it would
otherwise print through the ordinary sale ticket — a receipt whose totals are
all negative and which says nothing about where the money now lives. The paper
the customer walks out with has one job: name the folio, name the amount, and
say that it is spendable («se abona al monedero de {cliente}»).

Same family and same mechanics as `add_default_closing_shift_print_format`:
one Jinja Print Format, inserted once, never overwritten so operator edits in
Desk survive a re-run.

No QR. The artboard asks for «folio + importe + cliente + QR/código»; Frappe's
Jinja sandbox has no whitelisted QR helper, and an <img> pointing at a route
that does not exist prints a broken-image box on thermal paper. The folio is
set in large monospace instead — readable and typeable at the counter — and the
QR stays an open item rather than a fake one.
"""

import frappe

FORMAT_NAME = "POSA Nota de Crédito"
DOCTYPE = "Sales Invoice"

HTML_TEMPLATE = """\
{# Jinja sandbox: `.format()` and `frappe.get_cached_value` are blocked;
   fmt_money / formatdate / format_time / flt / get_all are whitelisted. #}
{% set cur = frappe.utils.fmt_money %}
{% set flt = frappe.utils.flt %}
{% set credit = flt(doc.grand_total) | abs %}
{% set spendable = flt(doc.outstanding_amount) | abs %}
<div class="posa-credit-note" style="font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.35; max-width: 76mm; margin: 0 auto;">

    <div style="text-align: center; margin-bottom: 8px;">
        <div style="font-size: 15px; font-weight: bold; letter-spacing: 0.5px;">NOTA DE CR&Eacute;DITO</div>
        <div style="font-weight: bold;">{{ doc.company }}</div>
        {% if doc.pos_profile %}<div style="font-size: 10px;">{{ doc.pos_profile }}</div>{% endif %}
    </div>

    <div style="text-align: center; border: 2px solid #000; border-radius: 4px; padding: 6px 4px; margin-bottom: 8px;">
        <div style="font-size: 9px; letter-spacing: 1px;">FOLIO</div>
        <div style="font-size: 17px; font-weight: bold; letter-spacing: 1px;">{{ doc.name }}</div>
    </div>

    <table style="width: 100%; border-collapse: collapse;">
        <tr><td>Cliente</td><td style="text-align: right;">{{ doc.customer_name or doc.customer }}</td></tr>
        <tr><td>Fecha</td><td style="text-align: right;">{{ frappe.utils.formatdate(doc.posting_date, 'short') }} {{ frappe.utils.format_time(doc.posting_time) }}</td></tr>
        {% if doc.return_against %}
        <tr><td>Venta original</td><td style="text-align: right;">{{ doc.return_against }}</td></tr>
        {% endif %}
        <tr><td>Atendi&oacute;</td><td style="text-align: right;">{{ doc.owner }}</td></tr>
    </table>

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <div style="font-weight: bold; margin-bottom: 4px;">ART&Iacute;CULOS DEVUELTOS</div>
    <table style="width: 100%; border-collapse: collapse;">
        {% for row in doc.items or [] %}
        <tr>
            <td>{{ (flt(row.qty) | abs) }}&times; {{ row.item_name or row.item_code }}</td>
            <td style="text-align: right;">{{ cur(flt(row.amount) | abs) }}</td>
        </tr>
        {% endfor %}
    </table>

    <hr style="border: none; border-top: 1px dashed #000; margin: 8px 0;"/>

    <table style="width: 100%; border-collapse: collapse;">
        <tr style="font-weight: bold; font-size: 15px;">
            <td>SALDO A FAVOR</td><td style="text-align: right;">{{ cur(credit) }}</td>
        </tr>
        {% if spendable and spendable != credit %}
        <tr><td>Disponible hoy</td><td style="text-align: right;">{{ cur(spendable) }}</td></tr>
        {% endif %}
    </table>

    <div style="margin-top: 10px; padding: 7px 8px; border: 1px solid #000;">
        Se abona al monedero de {{ doc.customer_name or doc.customer }}.
        Se usa en cualquier compra, presentando este folio.
    </div>

    <div style="text-align: center; margin-top: 10px; font-size: 10px;">
        Impreso: {{ frappe.utils.now() }}
    </div>
    <div style="text-align: center; margin-top: 16px; font-size: 10px;">
        ______________________<br/>Firma de quien recibe
    </div>
</div>
"""


def execute():
    if frappe.db.exists("Print Format", FORMAT_NAME):
        # Don't overwrite operator customizations.
        return

    pf = frappe.new_doc("Print Format")
    pf.update(
        {
            "name": FORMAT_NAME,
            "doc_type": DOCTYPE,
            "module": "Posawesome",
            "print_format_type": "Jinja",
            "standard": "No",
            "disabled": 0,
            "custom_format": 1,
            "html": HTML_TEMPLATE,
            "font_size": 11,
            # es-MX: the template is written in Spanish, so pin the language
            # rather than inheriting a site default that would translate the
            # surrounding chrome into something else.
            "default_print_language": "es",
            "page_number": "Hide",
            "raw_printing": 0,
        }
    )
    pf.flags.ignore_permissions = True
    pf.insert()
    frappe.db.commit()
