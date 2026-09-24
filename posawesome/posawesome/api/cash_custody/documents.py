"""Server-controlled custody records; generic Desk/REST writes cannot forge events."""
import frappe
from frappe import _
from frappe.model.document import Document
from .model import minor


class CustodyRecord(Document):
    def validate(self):
        if not getattr(frappe.local, 'cash_custody_write', False):
            frappe.throw(_('Use the cash custody actions to change this record.'), frappe.PermissionError)

    def on_trash(self):
        frappe.throw(_('Cash custody history cannot be deleted. Record a correction instead.'))


def validate_custody_routing(profile, company, drawer):
    if not profile.get('posa_enable_cash_movement') or not profile.get('posa_allow_cash_deposit'):
        frappe.throw(_('Enable cash movements and cash deposits on the POS Profile before enabling cash custody.'))
    if float(profile.get('posa_cash_movement_max_amount') or 0) != 0:
        frappe.throw(_('Set the POS Profile cash movement maximum to zero before enabling cash custody; closing must transfer the complete drawer count.'))
    cash_account = frappe.db.get_value('Mode of Payment Account',
        {'parent': profile.get('posa_cash_mode_of_payment') or 'Cash', 'company': company}, 'default_account')
    if not cash_account or cash_account != drawer:
        frappe.throw(_('The drawer account must match the cash Mode of Payment account for this company.'))


def _managed_cash_accounts(company, safe_name):
    """Ledgers already inside POS custody or a POS payment route.

    Moving a whole bag into one of these would make cash reappear in another
    register without its receipt, count and closing trail.
    """
    managed = set()
    for row in frappe.get_all('POS Cash Safe', filters={'name': ['!=', safe_name]},
            fields=['safe_account', 'transit_account', 'bank_account', 'variance_account']):
        managed.update(row.values())
    for row in frappe.get_all('POS Profile', filters={'company': company},
            fields=['posa_back_office_cash_account', 'posa_default_source_account']):
        managed.update(row.values())
    managed.update(frappe.get_all('POS Allowed Source Account', filters={'parenttype': 'POS Profile'}, pluck='account'))
    managed.update(frappe.get_all('Mode of Payment Account', filters={'company': company}, pluck='default_account'))
    if frappe.db.table_exists('POS Register'):
        managed.update(frappe.get_all('POS Register', filters={'company': company}, pluck='drawer_account'))
    managed.discard(None)
    managed.discard('')
    return managed


def offsite_problem(safe, account, drawer=None):
    """Why `account` cannot receive whole bags from `safe`, or None when it can."""
    if not account:
        return _('Configure an off-site cash account on this safe before transferring whole bags.')
    if drawer is None:
        from posawesome.posawesome.api.cash_movement.validation import resolve_source_cash_account
        drawer = resolve_source_cash_account({}, frappe.get_doc('POS Profile', safe.pos_profile))
    row = frappe.db.get_value('Account', account,
        ['company', 'is_group', 'disabled', 'account_currency', 'account_type'], as_dict=True)
    if (not row or row.company != safe.company or row.is_group or row.disabled
            or row.account_currency != safe.currency or row.account_type != 'Cash'):
        return _('The off-site cash account must be an active Cash ledger account of this company in its currency.')
    if account in {safe.safe_account, safe.transit_account, safe.bank_account, safe.variance_account, drawer}:
        return _("The off-site cash account must differ from this register's drawer, safe, transit, bank and variance accounts.")
    if account in _managed_cash_accounts(safe.company, safe.name):
        return _('The off-site cash account already belongs to a register, safe or payment method. Choose a separate cash ledger.')
    return None


class CashSafe(Document):
    def validate(self):
        from posawesome.posawesome.api.cash_movement.validation import resolve_source_cash_account
        profile = frappe.get_doc('POS Profile', self.pos_profile)
        if profile.company != self.company:
            frappe.throw(_('The safe and register must belong to the same company.'))
        currency = frappe.get_cached_value('Company', self.company, 'default_currency')
        if self.currency != currency:
            frappe.throw(_('Cash custody currently uses the company currency.'))
        if profile.get('posa_back_office_cash_account') != self.safe_account:
            frappe.throw(_('Choose the Back Office Cash Account configured on this POS Profile.'))
        accounts = [self.safe_account, self.transit_account, self.bank_account, self.variance_account,
                    resolve_source_cash_account({}, profile)]
        if self.enabled:
            validate_custody_routing(profile, self.company, accounts[-1])
        if len(set(accounts)) != len(accounts):
            frappe.throw(_('Drawer, safe, transit, bank and variance accounts must be distinct.'))
        for name in accounts:
            account = frappe.get_doc('Account', name)
            if account.company != self.company or account.is_group or account.disabled or account.account_currency != currency:
                frappe.throw(_('Cash accounts must be active ledger accounts in the company currency.'))
        if frappe.db.get_value('Account', self.safe_account, 'account_type') != 'Cash':
            frappe.throw(_('The safe account must be a cash account.'))
        if frappe.db.get_value('Account', self.bank_account, 'account_type') != 'Bank':
            frappe.throw(_('The bank account must be a bank account.'))
        if frappe.db.get_value('Account', self.variance_account, 'root_type') != 'Expense':
            frappe.throw(_('The variance account must be an expense account.'))
        for field in ['float_target', 'drawer_limit']:
            minor(self.get(field) or 0)
        # Optional; may change for future transfers. Each moved bag keeps its own account and journal.
        if self.get('offsite_cash_account'):
            problem = offsite_problem(self, self.offsite_cash_account, accounts[-1])
            if problem:
                frappe.throw(problem)
        if frappe.db.exists('POS Cash Safe', {'name': ['!=', self.name], 'offsite_cash_account': ['in', accounts]}):
            frappe.throw(_("Another safe sends whole bags to one of these accounts. Custody accounts cannot also be an off-site destination."))
        previous = self.get_doc_before_save()
        if self.enabled and (not previous or not previous.enabled):
            if frappe.db.exists('POS Opening Shift', {'pos_profile': self.pos_profile, 'status': 'Open', 'docstatus': 1}):
                frappe.throw(_('Close the existing shift before enabling cash custody.'))
            from posawesome.posawesome.doctype.pos_safe_transfer.pos_safe_transfer import get_safe_gl_balance
            if abs(get_safe_gl_balance(accounts[-1], self.company)) >= 0.005:
                frappe.throw(_('Reconcile and empty the drawer account before enabling cash custody.'))
        if previous and frappe.db.exists('POS Cash Custody Event', {'safe': self.name}):
            for field in ['company', 'currency', 'pos_profile', 'safe_account', 'transit_account', 'bank_account', 'variance_account']:
                if previous.get(field) != self.get(field):
                    frappe.throw(_('Accounts and scope cannot change after cash custody activity.'))
            if previous.enabled and not self.enabled:
                frappe.throw(_('Close and reconcile custody activity before disabling this safe.'))


def permitted(doc, user=None, permission_type=None):
    from posawesome.posawesome.api._scope import assert_company, assert_profile
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import is_closing_supervisor
    if doc.doctype == 'POS Cash Safe' and permission_type in {'write','create','delete'} and 'System Manager' not in frappe.get_roles(user or frappe.session.user):
        return False
    if doc.doctype != 'POS Cash Safe' and permission_type in {'write', 'create', 'delete', 'submit', 'cancel', 'amend'}:
        return False
    if doc.doctype == 'POS Cash Count' and not is_closing_supervisor(user or frappe.session.user) and doc.counted_by != (user or frappe.session.user):
        return False
    try:
        assert_profile(user or frappe.session.user, doc.pos_profile)
        assert_company(user or frappe.session.user, doc.company)
        return True
    except frappe.PermissionError:
        return False


def query(doctype, user=None):
    from posawesome.posawesome.api._scope import _is_super, get_allowed_pos_profiles
    user = user or frappe.session.user
    if _is_super(user):
        return ''
    profiles = get_allowed_pos_profiles(user)
    if not profiles:
        return '1=0'
    return f'`tab{doctype}`.pos_profile in ({",".join(frappe.db.escape(p) for p in sorted(profiles))})'


def bag_query(user=None):
    return query('POS Cash Bag', user)


def count_query(user=None):
    from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import is_closing_supervisor
    condition = query('POS Cash Count', user)
    if not is_closing_supervisor(user or frappe.session.user):
        own = '`tabPOS Cash Count`.counted_by = ' + frappe.db.escape(user or frappe.session.user)
        return f'({condition}) AND {own}' if condition else own
    return condition


def event_query(user=None):
    return query('POS Cash Custody Event', user)


def safe_query(user=None):
    return query('POS Cash Safe', user)


def protect_journal(doc, method=None):
    """Custody corrections must be new linked postings, never delete ledger history."""
    if not frappe.db.table_exists('POS Cash Custody Event'):
        return
    linked = frappe.db.sql("""select name from `tabPOS Cash Custody Event`
        where JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.journal_entry'))=%s limit 1""", (doc.name,))
    movement = frappe.db.sql("""select m.name from `tabPOS Cash Movement` m
        join `tabPOS Cash Safe` s on s.pos_profile=m.pos_profile and s.enabled=1
        where m.journal_entry=%s limit 1""", (doc.name,))
    if linked or movement:
        frappe.throw(_('This journal belongs to cash custody. Use a counted correction or discrepancy review instead of cancelling it.'))


def protect_profile(doc, method=None):
    from .service import is_enabled
    previous = doc.get_doc_before_save()
    if not previous or not is_enabled(doc.name):
        return
    fields = ['company', 'posa_default_source_account', 'posa_back_office_cash_account',
              'posa_cash_mode_of_payment', 'posa_allowed_source_accounts',
              'posa_allow_source_account_override', 'posa_enable_cash_movement', 'posa_allow_cash_deposit',
              'posa_cash_movement_max_amount']
    if any(previous.get(field) != doc.get(field) for field in fields):
        frappe.throw(_('This register has active cash custody. Reconcile its cash before changing drawer or safe routing.'))
