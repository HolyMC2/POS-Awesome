"""Rollback-only native ledger drill for whole sealed bag transfers; lab sites only."""
import json
import uuid

import frappe

from . import service as s


def run():
    if '.lab.' not in frappe.local.site:
        raise RuntimeError('Lab-only drill')
    previous = frappe.session.user
    try:
        return _run()
    finally:
        frappe.db.rollback()
        frappe.set_user(previous)


def _run():
    frappe.set_user('Administrator')
    suffix = uuid.uuid4().hex[:7]
    profile = frappe.copy_doc(frappe.get_doc('POS Profile', 'Doco Ventas'))
    company = profile.company
    currency = frappe.db.get_value('Company', company, 'default_currency')
    checks = []

    def check(label, condition):
        if not condition:
            raise AssertionError(label)
        checks.append(label)

    def denied(label, callback):
        frappe.db.savepoint('whole_bag_denied')
        try:
            callback()
        except (frappe.ValidationError, frappe.PermissionError):
            frappe.db.rollback(save_point='whole_bag_denied')
            frappe.clear_messages()
            checks.append(label)
        else:
            raise AssertionError(label + ' was accepted')

    def account(label, root, kind=None):
        parent = frappe.db.get_value('Account', {'company': company, 'root_type': root, 'is_group': 1}, 'name')
        return frappe.get_doc(dict(doctype='Account', account_name=f'Bag QA {suffix} {label}',
            company=company, parent_account=parent, account_currency=currency, is_group=0,
            account_type=kind)).insert().name

    origin, home, drawer = [account(label, 'Asset', 'Cash') for label in ['Safe', 'Home', 'Drawer']]
    bank, transit = account('Bank', 'Asset', 'Bank'), account('Transit', 'Asset')
    variance, funding = account('Variance', 'Expense'), account('Funding', 'Equity')
    mode = frappe.get_doc(dict(doctype='Mode of Payment', mode_of_payment='Bag QA ' + suffix, type='Cash',
        accounts=[dict(company=company, default_account=drawer)])).insert().name
    cashier = frappe.get_doc(dict(doctype='User', email=f'bag-qa-{suffix}@lab.invalid',
        first_name='Bag QA', send_welcome_email=0, enabled=1, user_type='System User',
        roles=[dict(role='POS User'), dict(role='Sales User')])).insert(ignore_permissions=True).name
    profile.name = 'Bag QA ' + suffix
    profile.disabled = 0
    profile.posa_default_source_account = drawer
    profile.posa_back_office_cash_account = origin
    profile.posa_bank_deposit_account = bank
    profile.posa_cash_mode_of_payment = mode
    profile.posa_enable_cash_movement = profile.posa_allow_cash_deposit = 1
    profile.posa_cash_movement_max_amount = 0
    profile.posa_allowed_source_accounts = ''
    profile.posa_allow_source_account_override = 0
    profile.set('payments', [dict(mode_of_payment=mode, default=1, allow_in_returns=1)])
    profile.set('applicable_for_users', [dict(user=cashier)])
    profile.insert(ignore_permissions=True)
    safe = frappe.get_doc(dict(doctype='POS Cash Safe', title='Bag QA ' + suffix, enabled=1,
        pos_profile=profile.name, company=company, currency=currency, safe_account=origin,
        transit_account=transit, bank_account=bank, variance_account=variance,
        offsite_cash_account=home, float_target=1000, drawer_limit=3000)).insert()
    s.post(safe, 3000, funding, origin, 'Rollback-only whole bag drill funding')

    def command(action, **values):
        return s.command(action, dict(pos_profile=profile.name, request_id=uuid.uuid4().hex, **values))

    def bag(value, state='Unverified'):
        result = command('prepare', seal='BAG-QA-' + uuid.uuid4().hex[:16], purpose='Takings',
            count=dict(source='manual', amount=value, reason='Rollback-only counted QA cash'))
        doc = frappe.get_doc('POS Cash Bag', result['bag'])
        if state != 'Unverified':
            doc.state = state
            s.save(doc)
        return doc

    from .documents import offsite_problem
    check('home cash destination allowed', not offsite_problem(safe, home))
    for label, destination in [('bank', bank), ('origin', origin), ('drawer', drawer), ('expense', variance)]:
        check(label + ' destination rejected', bool(offsite_problem(safe, destination)))
    first = bag(2211)
    before = first.as_dict()
    count_before = frappe.db.count('POS Cash Count', {'safe': safe.name})
    loose_before = s.loose_balance(safe)
    payload = dict(pos_profile=profile.name, bag=first.name, request_id=uuid.uuid4().hex,
        note='Whole sealed bag physically moved to the QA home safe')
    frappe.set_user(cashier)
    frappe.local._posa_scope_cache = {}
    choices = s.safes()
    check('cash workspace picker is scoped', bool(choices) and all(row.pos_profile == profile.name for row in choices))
    denied('cashier cannot transfer', lambda: s.command('transfer_safe', payload))
    frappe.set_user('Administrator')
    frappe.local._posa_scope_cache = {}
    denied('caller amount refused', lambda: s.command('transfer_safe', dict(payload, amount=1)))
    result = s.command('transfer_safe', payload)
    moved = frappe.get_doc('POS Cash Bag', first.name)
    check('bag transferred whole', result['amount'] == 2211 and moved.state == 'Transferred')
    check('seal and preparation preserved', all(moved.get(k) == before.get(k)
        for k in ['seal', 'prepared_by', 'verified_by', 'count_json', 'amount']))
    check('no verification invented', not moved.verified_by)
    check('source decreased once', s.get_safe_gl_balance(origin, company) == 789)
    check('home increased once', s.get_safe_gl_balance(home, company) == 2211)
    check('loose cash unchanged', s.loose_balance(safe) == loose_before)
    check('no new count', frappe.db.count('POS Cash Count', {'safe': safe.name}) == count_before)
    journal = frappe.get_doc('Journal Entry', result['journal_entry'])
    check('real submitted transfer journal', journal.docstatus == 1 and len(journal.accounts) == 2)
    check('journal and destination linked', moved.transfer_journal == journal.name and moved.transfer_account == home)
    check('retry returns original journal', s.command('transfer_safe', payload) == result)
    check('one custody event for request', frappe.db.count('POS Cash Custody Event', {'request_id': payload['request_id']}) == 1)
    denied('changed retry refused', lambda: s.command('transfer_safe', dict(payload, note='Different instructions for this same bag')))
    denied('second move refused', lambda: command('transfer_safe', bag=first.name, note=payload['note']))
    denied('journal cancellation refused', journal.cancel)
    ctx = s.context(profile.name)
    check('context exposes destination', ctx['can_transfer'] and ctx['offsite_cash_account'] == home)
    check('completed history retains bag', any(b['name'] == first.name and b['state'] == 'Transferred' for b in ctx['bags']))
    for state in ['Disputed', 'In Transit', 'Issued']:
        blocked = bag(10, state)
        denied(state + ' cannot leave whole', lambda: command('transfer_safe', bag=blocked.name, note=payload['note']))
    available = bag(20, 'Available')
    check('verified state can transfer', command('transfer_safe', bag=available.name, note=payload['note'])['state'] == 'Transferred')
    frappe.db.set_value('POS Cash Safe', safe.name, 'offsite_cash_account', None)
    check('blank destination disables action', not s.context(profile.name)['can_transfer'])
    pending = bag(10)
    denied('blank destination refuses transfer', lambda: command('transfer_safe', bag=pending.name, note=payload['note']))
    result = dict(passed=len(checks), checks=checks, site=frappe.local.site, rolled_back=True)
    print(json.dumps(result))
    return result
