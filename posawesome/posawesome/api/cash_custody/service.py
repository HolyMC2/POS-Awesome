"""Cash custody commands. One request, one transaction, scoped reads, exact counts."""
import json
import re
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import nowdate

from posawesome.posawesome.api._scope import assert_company, assert_profile
from posawesome.posawesome.api.cash_movement.posting import create_journal_entry
from posawesome.posawesome.api.cash_movement.service import _create_cash_movement
from posawesome.posawesome.api.shift_terminal import assert_terminal_access
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import is_closing_supervisor
from posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer import get_safe_gl_balance
from .model import count, fingerprint, minor


def is_enabled(profile):
    return bool(frappe.db.table_exists('POS Cash Safe') and frappe.db.exists('POS Cash Safe',{'pos_profile':profile,'enabled':1}))


@contextmanager
def writing():
    old = getattr(frappe.local, 'cash_custody_write', False)
    frappe.local.cash_custody_write = True
    try:
        yield
    finally:
        frappe.local.cash_custody_write = old


def save(doc):
    with writing():
        doc.save(ignore_permissions=True)
    return doc


def manager():
    if not is_closing_supervisor(frappe.session.user):
        frappe.throw(_('A POS supervisor must perform this action.'), frappe.PermissionError)


def safe_for(profile, lock=False):
    assert_profile(frappe.session.user, profile)
    name = frappe.db.get_value('POS Cash Safe', {'pos_profile': profile, 'enabled': 1}, 'name') if is_enabled(profile) else None
    if not name:
        frappe.throw(_('Cash custody is not configured for this register. Ask a manager to configure its safe.'))
    safe = frappe.get_doc('POS Cash Safe', name, for_update=lock)
    assert_company(frappe.session.user, safe.company)
    if not safe.enabled or safe.pos_profile != profile:
        frappe.throw(_('The safe configuration changed. Reload and retry.'))
    safe.flags.custody_locked = lock
    return safe


def balance(safe, account):
    # A waited row lock does not refresh MariaDB's earlier consistent snapshot.
    # Mutation decisions need current reads as well as the safe's serial lock.
    if safe.flags.custody_locked:
        return float(frappe.db.sql('SELECT COALESCE(SUM(debit-credit),0) FROM `tabGL Entry` WHERE account=%s AND company=%s AND is_cancelled=0 FOR UPDATE',(account,safe.company))[0][0])
    return get_safe_gl_balance(account, safe.company)


def base(safe):
    return dict(safe=safe.name, company=safe.company, pos_profile=safe.pos_profile, currency=safe.currency)


def record(doctype, name, safe):
    doc = frappe.get_doc(doctype, name, for_update=True)
    if doc.safe != safe.name or doc.company != safe.company or doc.pos_profile != safe.pos_profile:
        frappe.throw(_('This record belongs to another safe or register.'), frappe.PermissionError)
    return doc


def parsed_count(value):
    try:
        return count(value)
    except (ValueError, AttributeError) as exc:
        frappe.throw(_(str(exc)))


def note(data):
    value = str(data.get('note') or '').strip()
    if not 8 <= len(value) <= 1000:
        frappe.throw(_('Describe the reason in 8 to 1000 characters.'))
    return value


def new_count(safe, data, scope, expected=None, state='Final', bag=None):
    counted = parsed_count(data.get('count'))
    amount = counted['total_minor'] / 100
    doc = frappe.get_doc(dict(doctype='POS Cash Count', **base(safe), scope=scope,
        counted_by=frappe.session.user, opening_shift=data.get('opening_shift'), bag=bag,
        state=state, count_json=json.dumps(counted), amount=amount,
        expected_amount=expected, difference=round(amount - expected, 2) if expected is not None else 0,
        note=str(data.get('note') or '').strip()))
    if expected is not None and minor(amount) != minor(expected):
        doc.state = 'Exception'
        doc.note = note(data)
    return save(doc)


def new_bag(safe, data, counted, state, movement=None):
    seal = str(data.get('seal') or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{3,80}', seal):
        frappe.throw(_('Enter a unique bag seal using 3–80 letters, digits or hyphens.'))
    if frappe.db.exists('POS Cash Bag', {'seal': seal}):
        frappe.throw(_('This bag seal is already used on this site. Choose a new seal.'))
    if counted['total_minor'] <= 0:
        frappe.throw(_('A cash bag must contain a positive amount.'))
    purpose = data.get('purpose', 'Float')
    if purpose not in {'Float', 'Takings'}:
        frappe.throw(_('Choose Float or Takings.'))
    bag = save(frappe.get_doc(dict(doctype='POS Cash Bag', **base(safe), seal=seal,
        purpose=purpose, state=state, amount=counted['total_minor']/100,
        count_json=json.dumps(counted), prepared_by=frappe.session.user,
        opening_shift=data.get('opening_shift'), cash_movement=movement,
        note=str(data.get('note') or '').strip())))
    new_count(safe, dict(data, count=counted), 'Bag', float(bag.amount), bag=bag.name)
    return bag


def loose_balance(safe):
    total = balance(safe, safe.safe_account)
    reserved = frappe.db.sql('''select coalesce(sum(amount), 0) from `tabPOS Cash Bag`
        where safe=%s and state in ('Available','Unverified','Disputed')''' + (' FOR UPDATE' if safe.flags.custody_locked else ''), (safe.name,))[0][0]
    return round(total - float(reserved), 2)


def post(safe, amount, source, target, remarks):
    if amount <= 0:
        return None
    return create_journal_entry(company=safe.company, posting_date=nowdate(), movement_type='Transfer',
        amount=amount, source_account=source, target_account=target, remarks=remarks,
        cost_center=frappe.db.get_value('POS Profile', safe.pos_profile, 'cost_center'))


def movement(safe, data, amount, kind, suffix=''):
    payload = {k: data.get(k) for k in ['terminal_id', 'terminal_generation', 'terminal_token']}
    payload.update(pos_opening_shift=data['opening_shift'], pos_profile=safe.pos_profile,
        amount=amount, remarks=data.get('note') or 'Cash custody bag transfer',
        client_request_id='custody:' + data['request_id'] + suffix)
    previous = getattr(frappe.local,'cash_custody_posting',False)
    frappe.local.cash_custody_posting = True
    try:
        return _create_cash_movement(payload, kind)['name']
    finally:
        frappe.local.cash_custody_posting = previous


def _execute(action, data, safe):
    if action == 'prepare':
        manager()
        counted = parsed_count(data.get('count'))
        if counted['total_minor'] > round(loose_balance(safe)*100):
            frappe.throw(_('The safe does not have enough unallocated cash. Verify a deposit or unpack an available bag.'))
        bag = new_bag(safe, data, counted, 'Unverified')
        return {'bag': bag.name, 'amount': bag.amount}

    if action in {'verify', 'receive', 'unpack', 'dispatch', 'confirm_bank', 'return_bank'}:
        bag = record('POS Cash Bag', data.get('bag'), safe)
        if action == 'verify':
            manager()
            if bag.state not in {'Unverified', 'Disputed'}:
                frappe.throw(_('This bag is not awaiting verification.'))
            if bag.prepared_by == frappe.session.user:
                frappe.throw(_('Another person must verify the bag. You cannot verify your own count.'))
            counted = new_count(safe, data, 'Bag', float(bag.amount), bag=bag.name)
            bag.state = 'Disputed' if counted.state == 'Exception' else 'Available'
            bag.verified_by = frappe.session.user if bag.state == 'Available' else None
            save(bag)
            return {'bag': bag.name, 'cash_count': counted.name, 'amount': counted.amount, 'state': bag.state}
        if action == 'receive':
            # Receipt is a second person's physical count; it may also verify a prepared float.
            if bag.state not in {'Available', 'Unverified'}:
                frappe.throw(_('Only an available or unverified bag can be received.'))
            if bag.prepared_by == frappe.session.user and bag.state != 'Available':
                frappe.throw(_('Ask another person to verify this bag before receiving it.'))
            counted = new_count(safe, data, 'Bag', float(bag.amount), bag=bag.name)
            if counted.state == 'Exception':
                bag.state = 'Disputed'; save(bag)
                return {'bag': bag.name, 'cash_count': counted.name, 'state': 'Disputed', 'amount': counted.amount}
            mov = movement(safe, data, float(bag.amount), 'Cash In')
            bag.state = 'Issued'; bag.received_by = frappe.session.user
            bag.receiving_shift = data['opening_shift']; bag.receipt_movement = mov
            save(bag)
            return {'bag': bag.name, 'cash_count': counted.name, 'movement': mov, 'amount': bag.amount}
        if action == 'unpack':
            manager()
            if bag.state != 'Available':
                frappe.throw(_('Verify this bag before returning its contents to loose safe cash.'))
            bag.state = 'Unpacked'; bag.note = note(data); save(bag)
            return {'bag': bag.name, 'amount': bag.amount}
        manager()
        if action == 'dispatch':
            if bag.state != 'Available':
                frappe.throw(_('Only verified available bags can leave for the bank.'))
            bag.dispatch_journal = post(safe, float(bag.amount), safe.safe_account, safe.transit_account, note(data))
            bag.state = 'In Transit'; save(bag)
        elif action == 'confirm_bank':
            if bag.state != 'In Transit':
                frappe.throw(_('This bag is not in transit.'))
            reference = str(data.get('reference') or '').strip()
            if not reference or len(reference) > 140:
                frappe.throw(_('Enter the bank deposit receipt reference.'))
            bag.deposit_journal = post(safe, float(bag.amount), safe.transit_account, safe.bank_account, reference)
            bag.deposit_reference = reference; bag.state = 'Deposited'; save(bag)
        else:
            if bag.state != 'In Transit':
                frappe.throw(_('Only a bag in transit can be returned.'))
            journal = post(safe, float(bag.amount), safe.transit_account, safe.safe_account, note(data))
            bag.state = 'Unverified'; bag.verified_by = None; bag.note = note(data); save(bag)
            return {'bag': bag.name, 'journal_entry': journal, 'amount': bag.amount}
        return {'bag': bag.name, 'amount': bag.amount, 'state': bag.state,
            'journal_entry': bag.dispatch_journal if action == 'dispatch' else bag.deposit_journal}

    if action == 'drop':
        counted = parsed_count(data.get('count'))
        mov = movement(safe, data, counted['total_minor']/100, 'Deposit')
        bag = new_bag(safe, data, counted, 'Unverified', mov)
        return {'bag': bag.name, 'movement': mov, 'amount': bag.amount}

    if action == 'save_drawer':
        counted = parsed_count(data.get('count'))
        existing = data.get('cash_count')
        if existing:
            doc = record('POS Cash Count', existing, safe)
            if doc.state != 'Draft' or doc.counted_by != frappe.session.user or doc.opening_shift != data['opening_shift']:
                frappe.throw(_('Only your draft count for this shift can be edited.'))
            if str(doc.modified) != data.get('modified'):
                frappe.throw(_('This count changed in another window. Reload before editing.'))
            doc.count_json = json.dumps(counted); doc.amount = counted['total_minor']/100
            doc.note = str(data.get('note') or '').strip(); save(doc)
        else:
            doc = new_count(safe, data, 'Drawer', state='Draft')
        return {'cash_count': doc.name, 'modified': str(doc.modified), 'amount': doc.amount}

    if action == 'count_safe':
        manager()
        # Count all physical cash in the safe, including sealed bags; not cash at the bank.
        expected = balance(safe, safe.safe_account)
        doc = new_count(safe, data, 'Safe', expected)
        return {'cash_count': doc.name, 'state': doc.state, 'amount': doc.amount}

    if action == 'review':
        manager()
        doc = record('POS Cash Count', data.get('cash_count'), safe)
        if doc.state != 'Exception':
            frappe.throw(_('This count is not awaiting discrepancy review.'))
        if doc.counted_by == frappe.session.user:
            frappe.throw(_('Another supervisor must review your own discrepancy.'))
        reason = note(data)
        # For bags, the variance changes safe cash and the bag's physical amount together.
        if doc.scope == 'Bag':
            bag = record('POS Cash Bag', doc.bag, safe)
            latest = frappe.get_all('POS Cash Count', filters={'bag': bag.name}, fields=['name'], order_by='creation desc', limit_page_length=1)
            if not latest or latest[0].name != doc.name:
                frappe.throw(_('A newer bag count exists. Review the latest count instead.'))
            if bag.state != 'Disputed':
                frappe.throw(_('The disputed bag changed. Recount it before reviewing.'))
            delta = round(float(doc.amount) - float(bag.amount), 2)
            bag.amount = doc.amount; bag.count_json = doc.count_json
            bag.state = 'Available'; bag.verified_by = frappe.session.user; save(bag)
            source = safe.variance_account if delta > 0 else safe.safe_account
            target = safe.safe_account if delta > 0 else safe.variance_account
        elif doc.scope == 'Safe':
            latest = frappe.get_all('POS Cash Count', filters={'safe':safe.name,'scope':'Safe'}, fields=['name'], order_by='creation desc', limit_page_length=1)
            if not latest or latest[0].name != doc.name:
                frappe.throw(_('A newer safe count exists. Review the latest count instead.'))
            # Safe counts go stale as soon as cash moves; require a fresh reconciliation.
            current = balance(safe, safe.safe_account)
            if round(current, 2) != round(float(doc.expected_amount), 2):
                frappe.throw(_('Safe balance changed after this count. Count the safe again.'))
            delta = float(doc.difference)
            source = safe.variance_account if delta > 0 else safe.safe_account
            target = safe.safe_account if delta > 0 else safe.variance_account
            if float(doc.amount) < balance(safe, safe.safe_account) - loose_balance(safe):
                frappe.throw(_('Resolve bag discrepancies before adjusting the safe below its bag total.'))
        else:
            from posawesome.posawesome.api.cash_movement.validation import resolve_source_cash_account
            account = resolve_source_cash_account({}, frappe.get_doc('POS Profile', safe.pos_profile))
            delta = float(doc.difference)
            source = safe.variance_account if delta > 0 else account
            target = account if delta > 0 else safe.variance_account
        doc.journal_entry = post(safe, abs(delta), source, target, reason)
        doc.state='Reviewed'; doc.reviewed_by=frappe.session.user; doc.review_note=reason; save(doc)
        return {'cash_count':doc.name,'journal_entry':doc.journal_entry,'amount':doc.amount}
    frappe.throw(_('Unknown cash custody action.'))


@frappe.whitelist(methods=['POST'])
def command(action, payload):
    from posawesome.posawesome.api.payment_processing.integrity import retry_before_financial_writes
    return retry_before_financial_writes(_command, action, payload)


def _command(action, payload):
    try:
        data = json.loads(payload) if isinstance(payload, str) else payload
    except (ValueError, TypeError):
        frappe.throw(_('Invalid cash custody request.'))
    if not isinstance(data, dict):
        frappe.throw(_('Invalid cash custody request.'))
    request_id = str(data.get('request_id') or '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', request_id):
        frappe.throw(_('A stable request ID is required. Reload the action and try again.'))
    # Scope before duplicate lookup: knowing a request ID never grants access.
    safe = safe_for(data.get('pos_profile'))
    digest = fingerprint({'action':action,'user':frappe.session.user,
        'data':{k:v for k,v in data.items() if k not in {'terminal_token','terminal_generation','terminal_id'}}})
    prior = frappe.db.get_value('POS Cash Custody Event',{'request_id':request_id},['fingerprint','safe','result_json'],as_dict=True)
    if prior:
        if prior.fingerprint != digest or prior.safe != safe.name:
            frappe.throw(_('This request ID was already used for different cash instructions.'))
        return json.loads(prior.result_json)
    # Shift first, then safe. This matches closing's lock order.
    if action in {'receive','drop','save_drawer'}:
        assert_terminal_access(data.get('opening_shift'), data.get('terminal_id'), data.get('terminal_generation'), data.get('terminal_token'))
        if frappe.db.get_value('POS Opening Shift',data['opening_shift'],'pos_profile') != safe.pos_profile:
            frappe.throw(_('The drawer belongs to another register.'),frappe.PermissionError)
    safe = safe_for(safe.pos_profile, lock=True)
    existing = frappe.db.get_value('POS Cash Custody Event',{'request_id':request_id},['name','fingerprint','safe','result_json'],as_dict=True,for_update=True)
    if existing:
        if existing.fingerprint != digest or existing.safe != safe.name:
            frappe.throw(_('This request ID was already used for different cash instructions.'))
        return json.loads(existing.result_json)
    result = _execute(action, data, safe)
    save(frappe.get_doc(dict(doctype='POS Cash Custody Event',**base(safe),request_id=request_id,
        fingerprint=digest,action=action,actor=frappe.session.user,bag=result.get('bag'),
        cash_count=result.get('cash_count'),amount=result.get('amount'),result_json=json.dumps(result,default=str))))
    return result


# Read model. A flat "most recent N rows" window hid work nobody had finished:
# a busy register buries an older disputed bag or an unreviewed difference under
# newer completed evidence. Unresolved records are therefore read in full, with
# no page length at all, and only completed history is bounded. States outside
# the completed sets below count as unresolved, so a state added later is shown
# rather than silently dropped.
BAG_FIELDS = ['name','seal','purpose','state','amount','prepared_by','verified_by','received_by','opening_shift','receiving_shift','deposit_reference','modified']
COUNT_FIELDS = ['name','scope','state','opening_shift','bag','amount','expected_amount','difference','counted_by','note','modified','count_json','closing_shift']
# Issued bags are consumed by the drawer, Deposited reached the bank, Unpacked
# returned to loose safe cash. Unverified/Available/Disputed/In Transit still
# hold custody of physical money and remain someone's next action.
COMPLETED_BAG_STATES = ['Issued','Deposited','Unpacked']
# Draft counts are unfinished work; Exception counts await independent review.
COMPLETED_COUNT_STATES = ['Final','Reviewed']
HISTORY_PAGE_LENGTH = 100
MAX_HISTORY_PAGE_LENGTH = 200
# name is unique, so this is a total order: the bounded history page cannot
# reshuffle between reads when several rows share a modified timestamp.
_ORDER = 'modified desc, name desc'


def _history_page_length(value):
    if value in (None, ''):
        return HISTORY_PAGE_LENGTH
    try:
        return max(0, min(int(value), MAX_HISTORY_PAGE_LENGTH))
    except (TypeError, ValueError):
        frappe.throw(_('Enter a whole number of history rows.'))


def _every(doctype, filters, fields):
    """No page length, so frappe.get_all emits no LIMIT and reads every row.

    Unresolved custody work is never truncated. This queue is scoped to one
    safe on one register, so its open set is small by construction; a large
    one is a real backlog the operator must see, not a paging problem.
    """
    return frappe.get_all(doctype, filters=filters, fields=fields, order_by=_ORDER)


def _recent(doctype, filters, fields, limit):
    """A bounded page plus one probe row, so has_more costs no extra query."""
    if limit <= 0:
        return [], bool(frappe.get_all(doctype, filters=filters, fields=['name'], limit_page_length=1))
    rows = frappe.get_all(doctype, filters=filters, fields=fields, order_by=_ORDER, limit_page_length=limit + 1)
    return rows[:limit], len(rows) > limit


def _queue(doctype, scope, fields, completed, limit):
    """Every unresolved record, then a bounded page of recent completed ones."""
    unresolved = _every(doctype, dict(scope, state=['not in', completed]), fields)
    history, more = _recent(doctype, dict(scope, state=['in', completed]), fields, limit)
    rows = sorted(unresolved + history, key=lambda row: (str(row.get('modified') or ''), str(row.get('name') or '')), reverse=True)
    return rows, {'unresolved': len(unresolved), 'completed_states': list(completed),
        'history': len(history), 'history_limit': limit, 'history_has_more': more,
        'history_oldest': str(history[-1]['modified']) if history else None,
        # Complete history stays one Desk list away; it applies the same
        # permission query conditions this endpoint does.
        'desk': {'doctype': doctype, 'filters': dict(scope)}}


@frappe.whitelist()
def context(pos_profile, history_limit=None):
    safe = safe_for(pos_profile)
    supervisor = bool(is_closing_supervisor(frappe.session.user))
    limit = _history_page_length(history_limit)
    bags, bags_meta = _queue('POS Cash Bag', {'safe': safe.name}, BAG_FIELDS, COMPLETED_BAG_STATES, limit)
    # A cashier only ever sees their own counts; a supervisor reviews the register's.
    count_scope = {'safe': safe.name} if supervisor else {'safe': safe.name, 'counted_by': frappe.session.user}
    counts, counts_meta = _queue('POS Cash Count', count_scope, COUNT_FIELDS, COMPLETED_COUNT_STATES, limit)
    return {'safe':safe.name,'currency':safe.currency,'float_target':safe.float_target,'drawer_limit':safe.drawer_limit,
        'can_manage':supervisor,
        'balance':get_safe_gl_balance(safe.safe_account,safe.company),'loose_balance':loose_balance(safe),
        'in_transit':get_safe_gl_balance(safe.transit_account,safe.company),'bags':bags,'counts':counts,
        'queues':{'bags':bags_meta,'counts':counts_meta}}


def finalize_drawer(closing, terminal_context):
    """Within closing's transaction: count evidence, drop bags, then close the empty drawer.

    Called after the opening shift/terminal lock, before expected totals are rebuilt.
    No commit here: a failed closing rolls back bags, counts and journals together.
    """
    profile = closing.get('pos_profile')
    if not is_enabled(profile):
        return
    safe = safe_for(profile, lock=True)
    payload = closing.pop('cash_custody', None)
    if not isinstance(payload, dict):
        frappe.throw(_('Count the drawer and allocate its bags in Cash custody before closing.'))
    doc = record('POS Cash Count', payload.get('cash_count'), safe)
    if doc.scope != 'Drawer' or doc.state != 'Draft' or doc.opening_shift != closing.get('pos_opening_shift'):
        frappe.throw(_('Choose the saved draft drawer count for this shift.'))
    if doc.counted_by != frappe.session.user or str(doc.modified) != payload.get('modified'):
        frappe.throw(_('The drawer count changed or belongs to another cashier. Reload it before closing.'))
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import compute_closing_tables
    opening = frappe.get_doc('POS Opening Shift',doc.opening_shift)
    cash_mode = frappe.db.get_value('POS Profile',profile,'posa_cash_mode_of_payment') or 'Cash'
    tables = compute_closing_tables(opening.as_dict(),for_update=True)
    cash_row = next((r for r in tables['payment_reconciliation'] if r['mode_of_payment']==cash_mode),None)
    if not cash_row:
        frappe.throw(_('No cash payment method is configured for this drawer.'))
    doc.expected_amount = float(cash_row['expected_amount'])
    doc.difference = round(float(doc.amount)-doc.expected_amount,2)
    doc.state = 'Exception' if doc.difference else 'Final'
    if doc.difference:
        doc.note = note(payload)
    save(doc)
    allocations = payload.get('bags',[])
    if not isinstance(allocations,list) or len(allocations)>20:
        frappe.throw(_('Allocate at most 20 bags.'))
    parsed = [parsed_count(row.get('count')) for row in allocations]
    if sum(row['total_minor'] for row in parsed) != minor(doc.amount):
        frappe.throw(_('Bag totals must equal the saved drawer count. The drawer must end at zero.'))
    for index, (row, counted) in enumerate(zip(allocations, parsed)):
        # Closing document lock makes this transaction single-use. The named
        # bag and linked movement remain the audit evidence after commit.
        data = dict(row,opening_shift=doc.opening_shift,request_id='close-'+doc.name,
                    note='Closing drawer count '+doc.name,**terminal_context)
        mov = movement(safe,data,counted['total_minor']/100,'Deposit','-'+str(index))
        new_bag(safe,data,counted,'Unverified',mov)
    for row in closing.get('payment_reconciliation',[]):
        if row.get('mode_of_payment')==cash_mode:
            row['closing_amount']=0
    closing['cash_count']=doc.name


def link_closed_count(closing):
    if closing.get('cash_count'):
        doc=frappe.get_doc('POS Cash Count',closing.cash_count,for_update=True)
        doc.closing_shift=closing.name
        save(doc)


@frappe.whitelist()
def availability(pos_profile):
    assert_profile(frappe.session.user,pos_profile)
    return {'enabled':is_enabled(pos_profile)}


# Drawer-limit guidance ----------------------------------------------------
# Read-only and deliberately small. `drawer_limit` is store policy, not a
# sales block (docs/POS-CASH-CUSTODY.md, "Shop setup and daily operation"), so
# this never refuses anything: it answers one question — does the ledger say
# this open drawer now holds more cash than the shop wants sitting in it.
def _hidden(reason):
    """No amounts at all. A hidden figure must not leak through a partial payload."""
    return {'show': False, 'reason': reason}


def _expected_drawer_cash(safe, opening_shift):
    """The canonical closing expectation for this drawer's cash method.

    Same computation `finalize_drawer` closes against — opening float, cash
    sales, refunds and cash movements for THIS shift — so guidance and the
    corte can never disagree. A profile-agnostic GL balance would answer a
    different question, and the browser's cart answers none.
    """
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import compute_closing_tables
    opening = frappe.get_doc('POS Opening Shift', opening_shift)
    cash_mode = frappe.db.get_value('POS Profile', safe.pos_profile, 'posa_cash_mode_of_payment') or 'Cash'
    tables = compute_closing_tables(opening.as_dict())
    row = next((r for r in tables['payment_reconciliation'] if r['mode_of_payment'] == cash_mode), None)
    return float(row['expected_amount']) if row else None


@frappe.whitelist()
def drawer_guidance(pos_profile, opening_shift=None):
    """Nonblocking drawer-limit guidance for the cashier standing at the drawer.

    Hidden — with no amounts in the payload — when the register is not opted
    into custody, there is no submitted open shift, no positive drawer limit is
    configured, or the profile hides system-expected cash. The amount returned
    is what the LEDGER expects; it is never a physical count, and nothing here
    moves or pre-fills money.
    """
    assert_profile(frappe.session.user, pos_profile)
    if not is_enabled(pos_profile):
        return _hidden('not_configured')
    if not opening_shift:
        return _hidden('no_open_shift')
    shift = frappe.db.get_value('POS Opening Shift', opening_shift,
                                ['user', 'pos_profile', 'status', 'docstatus'], as_dict=True)
    if not shift or shift.status != 'Open' or int(shift.docstatus or 0) != 1:
        return _hidden('no_open_shift')
    if shift.pos_profile != pos_profile:
        frappe.throw(_('The drawer belongs to another register.'), frappe.PermissionError)
    # Same ownership rule cash movements apply to this shift's money.
    if shift.user != frappe.session.user and not is_closing_supervisor(frappe.session.user):
        frappe.throw(_('You are not allowed to access this shift.'), frappe.PermissionError)
    safe = safe_for(pos_profile)
    # A blind-count register withholds the system figure on purpose. An alert
    # derived from it would hand back exactly what the tenant chose to withhold.
    if frappe.db.get_value('POS Profile', pos_profile, 'hide_expected_amount'):
        return _hidden('expected_cash_hidden')
    limit = float(safe.drawer_limit or 0)
    if limit <= 0:
        return _hidden('no_limit')
    expected = _expected_drawer_cash(safe, opening_shift)
    if expected is None:
        return _hidden('no_cash_method')
    target = float(safe.float_target or 0)
    # Keep the working float when one is configured; otherwise come back to the
    # limit itself. Either way this is a SUGGESTION the cashier recounts.
    keep = target if 0 < target < limit else limit
    # Cents, not floats. `model.minor` refuses a negative amount, and a shift
    # that dropped more than it took in legitimately expects less than zero.
    over = round(expected * 100) > round(limit * 100)
    return {'show': True, 'reason': 'ok', 'currency': safe.currency,
            'safe_title': safe.title or safe.name,
            'expected_amount': round(expected, 2), 'drawer_limit': round(limit, 2),
            'float_target': round(target, 2), 'keep_amount': round(keep, 2),
            'suggested_return': round(expected - keep, 2) if over else 0,
            'over_limit': over, 'as_of': _now()}


def _now():
    from frappe.utils import now_datetime
    return str(now_datetime())


def enforce_opening(profile, balances):
    if not is_enabled(profile):
        return
    safe_for(profile,lock=True)
    if frappe.db.sql("SELECT name FROM `tabPOS Opening Shift` WHERE pos_profile=%s AND status='Open' AND docstatus=1 FOR UPDATE", (profile,)):
        frappe.throw(_('This drawer already has an open shift. Complete its handover before opening another.'))
    cash_mode = frappe.db.get_value('POS Profile',profile,'posa_cash_mode_of_payment') or 'Cash'
    if any(row.get('mode_of_payment')==cash_mode and minor(row.get('amount') or 0) for row in balances):
        frappe.throw(_('Open the empty drawer with zero cash, then receive its float bag from Cash custody. The receipt records the opening funds once.'))
