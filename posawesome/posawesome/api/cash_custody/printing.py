"""Printable custody evidence; no printer daemon is needed to complete transfers.

Two layouts share one permission-checked renderer: ``slip`` is the A4/letter
handover sheet with the full count, ``label`` is the small tag that travels
attached to the sealed bag. Every value reaching the page is escaped and
translated to plain language — internal state names, JSON and raw datetimes
never reach the operator.
"""
import html
import json

import frappe
from frappe import _
from frappe.utils import flt, fmt_money, format_datetime

EVIDENCE_DOCTYPES = {'POS Cash Bag', 'POS Cash Count'}
LAYOUTS = {'slip', 'label'}

STATES = {
    'Unverified': 'Awaiting independent verification',
    'Available': 'Available in the safe',
    'Disputed': 'Held for supervisor review',
    'Issued': 'Issued to a drawer',
    'In Transit': 'In transit to the bank',
    'Deposited': 'Deposited at the bank',
    'Unpacked': 'Returned to loose safe cash',
    'Draft': 'Saved draft count',
    'Final': 'Final count',
    'Exception': 'Difference pending review',
    'Reviewed': 'Difference reviewed',
}
SCOPES = {'Drawer': 'Drawer count', 'Safe': 'Safe count', 'Bag': 'Bag count'}
PURPOSES = {'Float': 'Float', 'Takings': 'Takings'}
REFERENCES = [
    ('bag', 'Cash bag'),
    ('opening_shift', 'Opening shift'),
    ('receiving_shift', 'Receiving shift'),
    ('closing_shift', 'Closing shift'),
    ('cash_movement', 'Drawer deposit movement'),
    ('receipt_movement', 'Drawer receipt movement'),
    ('dispatch_journal', 'Bank transit journal'),
    ('deposit_journal', 'Bank deposit journal'),
    ('journal_entry', 'Correction journal'),
    ('deposit_reference', 'Bank receipt reference'),
]

STYLE = """
:root{color-scheme:light}
body{font:14px/1.45 "Helvetica Neue",Arial,sans-serif;color:#111;margin:0;background:#fff}
.doc{max-width:700px;margin:24px auto;padding:0 20px}
.org{margin:0;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#4a5560}
h1{font-size:23px;margin:2px 0 4px}
.ref{margin:0;font-size:20px;font-weight:700;letter-spacing:.04em}
.state{display:inline-block;margin-top:8px;padding:3px 10px;border:1px solid #9aa4ad;border-radius:999px;font-size:12px}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin:18px 0;padding:12px 0;border-top:2px solid #111;border-bottom:2px solid #111}
.total span{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#4a5560}
.total b{font-size:28px;font-variant-numeric:tabular-nums}
.figures{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 16px}
.figures div{border:1px solid #d3d8dd;border-radius:6px;padding:8px 10px}
.figures dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#4a5560}
.figures dd{margin:2px 0 0;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
dl.meta{display:grid;grid-template-columns:180px 1fr;gap:5px 14px;margin:0 0 16px}
dl.meta dt{color:#4a5560}
dl.meta dd{margin:0}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.07em;color:#4a5560;margin:18px 0 6px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-bottom:1px solid #d3d8dd;text-align:right}
th:first-child,td:first-child{text-align:left}
tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:none}
.note{white-space:pre-wrap;margin:6px 0;padding:8px 10px;background:#f4f6f8;border-radius:6px}
.refs dl{grid-template-columns:200px 1fr;font-size:12px;color:#33404a}
.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:46px}
.sign .line{display:block;border-bottom:1px solid #111;height:34px}
.sign p{margin:4px 0 0;font-size:12px}
.sign .hint{color:#4a5560}
.label-card{width:100mm;box-sizing:border-box;padding:7mm;margin:0;border:1px solid #111}
.label-card .ref{font-size:26px;word-break:break-all}
.label-card .total b{font-size:26px}
.label-card dl.meta{grid-template-columns:32mm 1fr;font-size:12px}
@media print{body{background:#fff}.doc{margin:0;padding:0}@page{margin:12mm}}
"""
LABEL_PAGE = """
.label-card{padding:3mm;font-size:11px;line-height:1.2}
.label-card .org{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.label-card h1{font-size:12px;margin:2px 0}
.label-card .ref{font-size:18px;line-height:1.05;overflow-wrap:anywhere}
.label-card .state{font-size:9px;margin-top:3px;padding:2px 5px}
.label-card .total{margin:6px 0;padding:5px 0;gap:8px}
.label-card .total span{font-size:9px}
.label-card .total b{font-size:21px;white-space:nowrap}
.label-card dl.meta{grid-template-columns:24mm 1fr;gap:2px 6px;font-size:10px;margin:0}
.label-card dl.meta dd{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.label-record{font-size:9px;margin:5px 0 0}
@media print{@page{size:100mm 76mm;margin:3mm}.label-card{border:none;padding:0;width:auto}}
"""


def _esc(value):
    return html.escape('' if value is None else str(value))


def _money(value, currency):
    return fmt_money(flt(value), currency=currency)


def _person(user):
    if not user:
        return ''
    return frappe.db.get_value('User', user, 'full_name') or user


def _phrase(mapping, value):
    return _(mapping[value]) if value in mapping else (value or '')


def _rows(count):
    """Denomination lines with per-line amounts and a checked total."""
    lines, total = [], 0
    rows = count.get('denominations')
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        try:
            face, quantity = flt(row.get('value')), int(row.get('quantity') or 0)
        except (TypeError, ValueError):
            continue
        amount = round(face * quantity, 2)
        total += amount
        lines.append((face, quantity, amount))
    return lines, round(total, 2)


def _meta(pairs):
    return ''.join('<dt>' + _esc(_(label)) + '</dt><dd>' + _esc(value) + '</dd>'
                   for label, value in pairs if value not in (None, '', 0))


def _references(doc):
    pairs = [(label, doc.get(field)) for field, label in REFERENCES if doc.get(field)]
    if not pairs:
        return ''
    return ('<section class="refs"><h2>' + _esc(_('Linked records')) + '</h2><dl class="meta">'
            + _meta(pairs) + '</dl></section>')


def _signatures(left, left_hint, right, right_hint=''):
    return ('<footer class="signatures">'
            + '<div class="sign"><span class="line"></span><p>' + _esc(_(left)) + '</p>'
            + '<p class="hint">' + _esc(left_hint) + '</p></div>'
            + '<div class="sign"><span class="line"></span><p>' + _esc(_(right)) + '</p>'
            + '<p class="hint">' + _esc(right_hint) + '</p></div></footer>')


def _count_block(count, currency):
    lines, derived = _rows(count)
    body = ''
    if lines:
        body += ('<h2>' + _esc(_('Count evidence')) + '</h2><table><thead><tr><th>'
                 + _esc(_('Denomination')) + '</th><th>' + _esc(_('Quantity')) + '</th><th>'
                 + _esc(_('Amount')) + '</th></tr></thead><tbody>'
                 + ''.join('<tr><td>' + _esc(_money(face, currency)) + '</td><td>' + _esc(quantity)
                           + '</td><td>' + _esc(_money(amount, currency)) + '</td></tr>'
                           for face, quantity, amount in lines)
                 + '</tbody><tfoot><tr><td>' + _esc(_('Counted notes and coins')) + '</td><td>'
                 + _esc(sum(line[1] for line in lines)) + '</td><td>' + _esc(_money(derived, currency))
                 + '</td></tr></tfoot></table>')
    if count.get('source') == 'manual':
        body += ('<h2>' + _esc(_('Manual count')) + '</h2><p class="note">'
                 + _esc(count.get('reason') or _('No reason was recorded.')) + '</p>')
        if lines:
            body += ('<p class="note">' + _esc(_('Listed notes and coins add up to {0}; the declared total was entered manually.')
                                               .format(_money(derived, currency))) + '</p>')
    elif not lines:
        body += '<p class="note">' + _esc(_('No denomination detail was recorded for this count.')) + '</p>'
    return body


def _bag(doc, count, layout):
    currency = doc.currency
    header = ('<p class="org">' + _esc(doc.company) + '</p><h1>' + _esc(_('Cash bag handover'))
              + '</h1><p class="ref">' + _esc(doc.seal) + '</p><p class="state">'
              + _esc(_phrase(STATES, doc.state)) + '</p>')
    total = ('<p class="total"><span>' + _esc(_('Declared amount')) + '</span><b>'
             + _esc(_money(doc.amount, currency)) + '</b></p>')
    meta = _meta([
        ('Purpose', _phrase(PURPOSES, doc.purpose)),
        ('Register', doc.pos_profile),
        ('Safe', frappe.db.get_value('POS Cash Safe', doc.safe, 'title') or doc.safe),
        ('Prepared by', _person(doc.prepared_by)),
        ('Verified by', _person(doc.get('verified_by'))),
        ('Received by', _person(doc.get('received_by'))),
        ('Prepared on', format_datetime(doc.creation)),
    ])
    if layout == 'label':
        # A physical bag tag, not a miniature handover sheet. Signatures and
        # detailed counts belong on the full slip so this fits one 100x76mm label.
        label_meta = _meta([
            ('Purpose', _phrase(PURPOSES, doc.purpose)),
            ('Safe', frappe.db.get_value('POS Cash Safe', doc.safe, 'title') or doc.safe),
            ('Prepared by', _person(doc.prepared_by)),
            ('Prepared on', format_datetime(doc.creation)),
        ])
        return ('<article class="doc label-card">' + header + total
                + '<dl class="meta">' + label_meta + '</dl>'
                + '<p class="label-record">' + _esc(doc.name) + '</p></article>')
    body = ('<article class="doc">' + header + total + '<dl class="meta">' + meta + '</dl>'
            + _count_block(count, currency))
    if doc.get('note'):
        body += '<h2>' + _esc(_('Handover note')) + '</h2><p class="note">' + _esc(doc.note) + '</p>'
    return (body + _references(doc)
            + _signatures('Delivered by', _person(doc.prepared_by), 'Received by') + '</article>')


def _count(doc, count):
    currency = doc.currency
    header = ('<p class="org">' + _esc(doc.company) + '</p><h1>' + _esc(_('Cash count evidence'))
              + '</h1><p class="ref">' + _esc(doc.name) + '</p><p class="state">'
              + _esc(_phrase(STATES, doc.state)) + '</p>')
    total = ('<p class="total"><span>' + _esc(_phrase(SCOPES, doc.scope)) + '</span><b>'
             + _esc(_money(doc.amount, currency)) + '</b></p>')
    figures = ''
    if doc.get('expected_amount') is not None:
        difference = flt(doc.get('difference'))
        wording = _('No difference') if not difference else (
            _('Over') if difference > 0 else _('Short'))
        figures = ('<dl class="figures"><div><dt>' + _esc(_('Counted amount')) + '</dt><dd>'
                   + _esc(_money(doc.amount, currency)) + '</dd></div><div><dt>' + _esc(_('Expected'))
                   + '</dt><dd>' + _esc(_money(doc.expected_amount, currency)) + '</dd></div><div><dt>'
                   + _esc(wording) + '</dt><dd>' + _esc(_money(abs(difference), currency))
                   + '</dd></div></dl>')
    meta = _meta([
        ('Register', doc.pos_profile),
        ('Safe', frappe.db.get_value('POS Cash Safe', doc.safe, 'title') or doc.safe),
        ('Counted by', _person(doc.counted_by)),
        ('Counted on', format_datetime(doc.creation)),
        ('Reviewed by', _person(doc.get('reviewed_by'))),
    ])
    body = ('<article class="doc">' + header + total + figures + '<dl class="meta">' + meta + '</dl>'
            + _count_block(count, currency))
    if doc.get('note'):
        body += '<h2>' + _esc(_('Difference note')) + '</h2><p class="note">' + _esc(doc.note) + '</p>'
    if doc.get('review_note'):
        body += '<h2>' + _esc(_('Review')) + '</h2><p class="note">' + _esc(doc.review_note) + '</p>'
    return (body + _references(doc)
            + _signatures('Counted by', _person(doc.counted_by), 'Verified by', _person(doc.get('reviewed_by')))
            + '</article>')


@frappe.whitelist()
def evidence(doctype, name, layout='slip'):
    if doctype not in EVIDENCE_DOCTYPES:
        frappe.throw(_('Choose a cash bag or count.'))
    if layout not in LAYOUTS:
        frappe.throw(_('Choose a handover slip or a bag label.'))
    if layout == 'label' and doctype != 'POS Cash Bag':
        frappe.throw(_('A bag label is only available for a cash bag.'))
    doc = frappe.get_doc(doctype, name)
    # Reading the record and printing it are separate grants; custody evidence needs both.
    doc.check_permission('read')
    doc.check_permission('print')
    try:
        count = json.loads(doc.count_json or '{}')
    except (ValueError, TypeError):
        count = {}
    if not isinstance(count, dict):
        count = {}
    title = _esc(doc.get('seal') or doc.name)
    body = _bag(doc, count, layout) if doctype == 'POS Cash Bag' else _count(doc, count)
    style = STYLE + (LABEL_PAGE if layout == 'label' else '')
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>' + title + '</title><style>' + style + '</style></head><body>' + body + '</body></html>')
