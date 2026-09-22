"""Rollback-only real Frappe/ERPNext custody drill. Never run outside *.lab.*."""
import json
import uuid

import frappe
from frappe.utils import nowdate
from . import service as s


def run(persist=False, drawer_shortage=0):
    if '.lab.' not in frappe.local.site:
        raise RuntimeError('Lab-only drill')
    from posawesome.posawesome.api.shifts import create_opening_voucher
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import make_closing_shift_from_opening, submit_closing_shift
    from posawesome.posawesome.api.cash_movement.service import create_pos_expense
    suffix=uuid.uuid4().hex[:7]
    frappe.set_user('Administrator')
    company=frappe.db.get_value('POS Profile','Doco Ventas','company')
    currency=frappe.db.get_value('Company',company,'default_currency')
    def account(label,root,kind=None):
        parent=frappe.db.get_value('Account',{'company':company,'root_type':root,'is_group':1},'name')
        return frappe.get_doc(dict(doctype='Account',account_name='Custody QA '+suffix+' '+label,
            company=company,parent_account=parent,account_currency=currency,is_group=0,account_type=kind)).insert().name
    safe_account=account('Safe','Asset','Cash');drawer=account('Drawer','Asset','Cash')
    transit=account('Transit','Asset');bank=account('Bank','Asset','Bank');variance=account('Variance','Expense')
    equity=account('Funding','Equity');income=account('Sales','Income')
    users=[]
    for role,tag in [('POS User','cashier'),('POS User','next'),('System Manager','reviewer')]:
        user=f'custody-{tag}-{suffix}@lab.invalid'
        doc=frappe.get_doc(dict(doctype='User',email=user,first_name='Cash QA '+tag,send_welcome_email=0,enabled=1,user_type='System User'))
        doc.append('roles',{'role':role})
        if role=='POS User':doc.append('roles',{'role':'Sales User'})
        doc.insert(ignore_permissions=True);users.append(user)
    cash_mode=frappe.get_doc(dict(doctype='Mode of Payment',mode_of_payment='Custody Cash '+suffix,type='Cash',
        accounts=[dict(company=company,default_account=drawer)])).insert().name
    profile=frappe.copy_doc(frappe.get_doc('POS Profile','Doco Ventas'))
    profile.name='Custody QA '+suffix;profile.posa_default_source_account=drawer
    profile.posa_back_office_cash_account=safe_account;profile.posa_bank_deposit_account=bank
    profile.posa_enable_cash_movement=1;profile.posa_allow_cash_deposit=1;profile.posa_allow_pos_expense=1
    profile.posa_cash_movement_max_amount=100000;profile.posa_default_expense_account=variance
    profile.posa_require_cash_movement_remarks=0;profile.posa_cash_mode_of_payment=cash_mode
    profile.set('payments',[dict(mode_of_payment=cash_mode,default=1,allow_in_returns=1)])
    profile.posa_allowed_expense_accounts='';profile.posa_allowed_source_accounts=''
    profile.posa_allow_return=1;profile.posa_allow_source_account_override=0;profile.posa_closing_shift_print_format=None
    profile.set('applicable_for_users',[{'user':u} for u in users])
    profile.insert(ignore_permissions=True)
    # Profile-specific drawer wins over the tenant's generic Cash account.
    safe=frappe.get_doc(dict(doctype='POS Cash Safe',title='QA Safe '+suffix,enabled=1,pos_profile=profile.name,
        company=company,currency=currency,safe_account=safe_account,transit_account=transit,
        bank_account=bank,variance_account=variance,float_target=1000,drawer_limit=5000)).insert()
    s.post(safe,3000,equity,safe_account,'Lab-only initial safe funding')
    checks=[]
    def denied(label, callback):
        frappe.db.savepoint('custody_denied')
        try: callback()
        except (frappe.ValidationError, frappe.PermissionError):
            frappe.db.rollback(save_point='custody_denied');checks.append(label)
        else: raise AssertionError(label+' was accepted')
    def check(label,condition):
        if not condition:raise AssertionError(label)
        checks.append(label)
    def actor(user):
        frappe.set_user(user);frappe.local._posa_scope_cache={}
    def manual(value):return {'source':'manual','amount':value,'reason':'Physical cash counted in rollback-only lab drill'}
    def command(action,**kw):
        return s.command(action,dict(pos_profile=profile.name,request_id=uuid.uuid4().hex,**kw))
    bag=command('prepare',seal='QA-'+suffix+'-START',purpose='Float',count=manual(1000))
    try:command('verify',bag=bag['bag'],count=manual(1000))
    except frappe.ValidationError:checks.append('self verification denied')
    else:raise AssertionError('self verification allowed')
    actor(users[0]);terminal=dict(terminal_id='cashier-device-'+suffix,terminal_token='a'*64)
    opened=create_opening_voucher(profile.name,company,json.dumps([{'mode_of_payment':cash_mode,'amount':0}]),**terminal)
    shift=opened['pos_opening_shift']['name'];terminal['terminal_generation']=1
    denied('cashier cannot prepare safe cash',lambda:command('prepare',seal='FORBIDDEN-'+suffix,count=manual(100)))
    payload=dict(pos_profile=profile.name,request_id=uuid.uuid4().hex,opening_shift=shift,bag=bag['bag'],count=manual(1000),**terminal)
    received=s.command('receive',payload);replayed=s.command('receive',payload)
    check('receipt retry returns same movement',received==replayed)
    check('safe reduced exactly once',s.get_safe_gl_balance(safe_account,company)==2000)
    check('drawer funded exactly once',s.get_safe_gl_balance(drawer,company)==1000)
    try:s.command('receive',dict(payload,count=manual(900)))
    except frappe.ValidationError:checks.append('changed replay denied')
    else:raise AssertionError('changed replay accepted')
    # Real non-stock service sale, with normal ERPNext posting and the verified shift grant.
    item=frappe.get_doc(dict(doctype='Item',item_code='CASH-QA-'+suffix,item_name='Cash custody QA service',
        item_group='All Item Groups',stock_uom='Nos',is_stock_item=0)).insert(ignore_permissions=True)
    from posawesome.posawesome.api.invoice_processing.creation import update_invoice, submit_invoice
    payload_sale=dict(doctype='Sales Invoice',company=company,customer=profile.customer,
        is_pos=1,pos_profile=profile.name,posa_pos_opening_shift=shift,
        selling_price_list=profile.selling_price_list,currency=currency,update_stock=1,
        items=[dict(item_code=item.name,qty=5,rate=100,price_list_rate=100,income_account=income,cost_center=profile.cost_center)],
        payments=[dict(mode_of_payment=cash_mode,amount=500,base_amount=500,type='Cash')],
        posa_client_request_id=uuid.uuid4().hex,**terminal)
    prepared=update_invoice(frappe.as_json(payload_sale))
    payload_sale['name']=prepared['name']
    submitted=submit_invoice(frappe.as_json(payload_sale),frappe.as_json(dict(terminal,total_change=0,paid_change=0,credit_change=0,redeemed_customer_credit=0,customer_credit_dict=[],gift_card_redemptions=[],is_cashback=1)),submit_in_background=0)
    check('real sale submitted',submitted.get('docstatus')==1)
    for is_return,qty,paid in [(1,-1,-100),(0,1,100)]:
        sale=json.loads(json.dumps(payload_sale));sale.pop('name',None)
        sale.update(is_return=is_return,return_against=submitted['name'] if is_return else None,posa_client_request_id=uuid.uuid4().hex)
        sale['items'][0]['qty']=qty;sale['payments'][0].update(amount=paid,base_amount=paid)
        prepared=update_invoice(frappe.as_json(sale));sale['name']=prepared['name']
        result=submit_invoice(frappe.as_json(sale),frappe.as_json(dict(terminal,total_change=0,paid_change=0,credit_change=0,redeemed_customer_credit=0,customer_credit_dict=[],gift_card_redemptions=[],is_cashback=1)),submit_in_background=0)
        check('cash refund submitted' if is_return else 'replacement sale submitted',result.get('docstatus')==1)
    check('refund and replacement reconcile drawer',s.get_safe_gl_balance(drawer,company)==1500)
    drop=command('drop',opening_shift=shift,seal='QA-'+suffix+'-DROP',purpose='Takings',count=manual(200),**terminal)
    create_pos_expense(dict(pos_opening_shift=shift,pos_profile=profile.name,amount=50,expense_account=variance,
        remarks='Lab-only drawer expense',client_request_id=uuid.uuid4().hex,**terminal))
    denied('legacy deposit cannot bypass bag custody',lambda:__import__('posawesome.posawesome.api.cash_movement.service',fromlist=['create_cash_deposit']).create_cash_deposit(dict(pos_opening_shift=shift,pos_profile=profile.name,amount=1,client_request_id=uuid.uuid4().hex,**terminal)))
    draft=command('save_drawer',opening_shift=shift,count=manual(1250-drawer_shortage),**terminal)
    denied('stale drawer edits rejected',lambda:command('save_drawer',opening_shift=shift,cash_count=draft['cash_count'],modified='stale',count=manual(1),**terminal))
    closing=make_closing_shift_from_opening(frappe.as_json(frappe.get_doc('POS Opening Shift',shift).as_dict()))['closing_shift'].as_dict()
    closing['cash_custody']=dict(note='Physical drawer recount confirmed closing amount',cash_count=draft['cash_count'],modified=draft['modified'],bags=[
        dict(seal='QA-'+suffix+'-NEXT',purpose='Float',count=manual(1000)),
        dict(seal='QA-'+suffix+'-TAKINGS',purpose='Takings',count=manual(250-drawer_shortage))])
    closed=submit_closing_shift(json.dumps(closing,default=str),**terminal)
    check('closed shift links durable count',frappe.db.get_value('POS Cash Count',draft['cash_count'],'closing_shift')==closed)
    check('pre-drop count preserves variance',frappe.db.get_value('POS Cash Count',draft['cash_count'],'difference')==-drawer_shortage)
    if drawer_shortage:
        check('unreviewed shortage remains visible in ledger',s.get_safe_gl_balance(drawer,company)==drawer_shortage)
        actor('Administrator')
        command('review',cash_count=draft['cash_count'],note='Independent review confirms drawer shortage')
        check('review preserves submitted closing count',frappe.db.get_value('POS Cash Count',draft['cash_count'],'amount')==1250-drawer_shortage)
        actor(users[0])
    check('drawer ends at zero after reconciliation',abs(s.get_safe_gl_balance(drawer,company))<0.001)
    check('retry receipt still resolves after closing',s.command('receive',payload)==received)
    actor('Administrator')
    next_bag=frappe.db.get_value('POS Cash Bag',{'seal':'QA-'+suffix+'-NEXT'},'name')
    takings=frappe.db.get_value('POS Cash Bag',{'seal':'QA-'+suffix+'-TAKINGS'},'name')
    command('verify',bag=takings,count=manual(250-drawer_shortage))
    command('dispatch',bag=takings,note='Lab courier has received sealed bank bag')
    check('bank cash stays in transit',s.get_safe_gl_balance(transit,company)==250-drawer_shortage and s.get_safe_gl_balance(bank,company)==0)
    command('return_bank',bag=takings,note='Bank unavailable; sealed bag returned to safe')
    check('return reverses transit',s.get_safe_gl_balance(transit,company)==0)
    command('verify',bag=takings,count=manual(250-drawer_shortage))
    command('dispatch',bag=takings,note='Second trip to bank with sealed bag')
    command('confirm_bank',bag=takings,reference='QA-RECEIPT-'+suffix)
    journal=frappe.db.get_value('POS Cash Bag',takings,'deposit_journal')
    denied('custody bank journal cannot be cancelled',lambda:frappe.get_doc('Journal Entry',journal).cancel())
    from .printing import evidence
    check('printable bag evidence includes its seal',('QA-'+suffix+'-TAKINGS') in evidence('POS Cash Bag',takings))
    check('bank receipt clears transit',s.get_safe_gl_balance(transit,company)==0 and s.get_safe_gl_balance(bank,company)==250-drawer_shortage)
    actor(users[1]);terminal2=dict(terminal_id='next-device-'+suffix,terminal_token='b'*64)
    opened2=create_opening_voucher(profile.name,company,json.dumps([{'mode_of_payment':cash_mode,'amount':0}]),**terminal2)
    terminal2['terminal_generation']=1
    command('receive',opening_shift=opened2['pos_opening_shift']['name'],bag=next_bag,count=manual(1000),**terminal2)
    check('next shift receives the prepared float',s.get_safe_gl_balance(drawer,company)==1000)
    actor('Administrator');result=command('count_safe',count=manual(2200))
    check('physical safe count reconciles',result['state']=='Final')
    # Independent discrepancy review preserves the first count and changes GL once.
    disputed_bag=command('prepare',seal='QA-'+suffix+'-SHORT',purpose='Float',count=manual(100))
    actor(users[2])
    mismatch=command('verify',bag=disputed_bag['bag'],count=manual(90),note='Physical count is ten pesos short')
    check('mismatch quarantines bag',mismatch['state']=='Disputed')
    denied('counter cannot approve own discrepancy',lambda:command('review',cash_count=mismatch['cash_count'],note='Review of physical cash shortage'))
    actor('Administrator')
    review_payload=dict(pos_profile=profile.name,request_id=uuid.uuid4().hex,cash_count=mismatch['cash_count'],note='Independent recount confirmed missing ten pesos')
    reviewed=s.command('review',review_payload)
    check('review records shortage once',s.get_safe_gl_balance(safe_account,company)==2190)
    check('review retry does not duplicate shortage',s.command('review',review_payload)==reviewed and s.get_safe_gl_balance(safe_account,company)==2190)
    check('original discrepancy count is retained',frappe.db.get_value('POS Cash Count',mismatch['cash_count'],'amount')==90)
    denied('safe reservations cannot exceed loose cash',lambda:command('prepare',seal='QA-'+suffix+'-OVER',count=manual(5000)))
    # The deposit evidence remains linked after the next shift receives the bag.
    received_bag=frappe.get_doc('POS Cash Bag',next_bag)
    check('both handover movement links survive receipt',bool(received_bag.cash_movement and received_bag.receipt_movement and received_bag.opening_shift!=received_bag.receiving_shift))
    actor(users[0])
    denied('another register remains out of scope',lambda:s.context('Doco Ventas'))
    actor('Administrator')
    doc=frappe.get_doc('POS Cash Bag',takings);doc.amount=999
    try:doc.save(ignore_permissions=True)
    except frappe.PermissionError:checks.append('generic document tampering denied')
    else:raise AssertionError('generic tampering accepted')
    if persist:
        import secrets
        from frappe.utils.password import update_password
        password=secrets.token_urlsafe(30)
        for user in users:update_password(user,password,logout_all_sessions=False)
        frappe.db.commit()
        return dict(profile=profile.name,safe=safe.name,users=users,password=password,
            opening=opened2['pos_opening_shift']['name'],terminal=terminal2,
            available_bag=disputed_bag['bag'],suffix=suffix,checks=checks)
    print(json.dumps({'checks':checks,'passed':len(checks),'site':frappe.local.site,'rolled_back':True}))
    frappe.db.rollback()
    return checks
