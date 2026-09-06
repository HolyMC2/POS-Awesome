"""Reject fabricated/partial endurance summaries even when envelope says green."""
import copy
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from endurance_evidence import verify_journal
from test_release_certification import identity


class JournalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path = pathlib.Path(self.temp.name) / 'journal.jsonl'
        self.identity = identity()
        self.rows = []
        self.append('started', identity=self.identity, smoke=False)
        self.fixture = dict(company='Demo', customer='Private customer', profile='Private profile', item='Private item',
            mode_of_payment='Private cash', cash_account='Cash', currency='MXN',
            expected_financial=dict(receivable_account='Debtors', income_account='Sales', tax_account='IVA', net_amount=8.62, tax_amount=1.38))
        self.append('fixture_scope', fixture=self.fixture)
        self.sample = dict(queue_pending=0, write_queue_pending=0, outbox_pending=0, heap_bytes=10000000, listeners=50, realtime_scripts=1)
        self.append('baseline', metrics=self.sample)
        faults = ['reload','offline','reconnect','session_expiry']
        self.financial = []
        counts = {}
        for index in range(500):
            plan=dict(index=index, financial=index % 25 == 0, fault='ack_loss' if index % 50 == 0 else faults[index % 4])
            self.append('cycle_started',plan=plan)
            data=dict(plan=plan, build_version=self.identity['build']['version'], active_ms=57600,
                faults=[plan['fault']], page_errors=0, metrics=self.sample)
            counts[plan['fault']]=counts.get(plan['fault'],0)+1
            if plan['financial']:
                data['accounting']=dict(invoice='INV-'+str(index),request_id='REQ-'+str(index),docstatus=1,
                    paid_amount=10,outstanding_amount=0,gl_rows=5,gl_debit=20,gl_credit=20,verified=True)
                data['accounting'].update(self.raw_accounting(data['accounting']))
                self.financial.append(data['accounting']['invoice'])
                if plan['fault']=='ack_loss':
                    data['ack_recovery']=dict(verified=True,kind='direct_docstatus',submit_attempts=1,
                        invoice=data['accounting']['invoice'],request_id=data['accounting']['request_id'])
            self.append('cycle_completed',**data)
        self.append('completed',final_audit=dict(verified=True,submitted=20,duplicate_financial_documents=0,
            invoices=[copy.deepcopy(r['accounting']) for r in self.rows if r['type']=='cycle_completed' and r['plan']['financial']]),
            cleanup=dict(verified=True,net_party_gl=0,cancelled_invoices=self.financial))
        self.metrics=dict(iterations=500,financial_cycles=20,duration_seconds=28800,fault_counts=counts)
        self.write()

    def raw_accounting(self, proof):
        doc = dict(name=proof['invoice'], posa_client_request_id=proof['request_id'], docstatus=1,
            company='Demo', customer='Private customer', pos_profile='Private profile', currency='MXN', conversion_rate=1,
            is_pos=1, debit_to='Debtors', grand_total=10, rounded_total=10, base_grand_total=10, paid_amount=10,
            base_paid_amount=10, outstanding_amount=0, discount_amount=0, write_off_amount=0, change_amount=0,
            items=[dict(item_code='Private item',qty=1,rate=10,amount=10,net_amount=8.62,income_account='Sales')],
            payments=[dict(mode_of_payment='Private cash',account='Cash',type='Cash',amount=10,base_amount=10)],
            taxes=[dict(account_head='IVA',tax_amount=1.38,base_tax_amount=1.38)])
        ledger = [dict(account=account,debit=debit,credit=credit,party=party or '',party_type='Customer' if party else '',
            account_currency='MXN',debit_in_account_currency=debit,credit_in_account_currency=credit)
            for account,debit,credit,party in [('Cash',10,0,None),('Debtors',10,0,'Private customer'),
                ('Debtors',0,10,'Private customer'),('Sales',0,8.62,None),('IVA',0,1.38,None)]]
        ledger.sort(key=lambda r:(r['account'],r['party_type'],r['party'],r['debit'],r['credit']))
        return dict(expected_total=10,currency='MXN',cash_account='Cash',cash_debit=10,income_account='Sales',
            income_credit=8.62,tax_account='IVA',tax_credit=1.38,exact_accounts_verified=True,
            invoice_snapshot=doc,gl_entries=ledger)

    def append(self, kind, **data):
        self.rows.append(dict(sequence=len(self.rows),at='2026-09-06T00:00:00Z',type=kind,**data))

    def write(self):
        previous='';lines=[]
        for row in self.rows:
            body={**row,'previous':previous}
            raw=json.dumps(body,separators=(',',':'))
            previous=hashlib.sha256(raw.encode()).hexdigest()
            lines.append(raw[:-1]+',"hash":'+json.dumps(previous)+'}')
        self.path.write_text('\n'.join(lines)+'\n')

    def valid(self):return verify_journal(self.path,self.identity,self.metrics)

    def test_complete_raw_journal_proves_counts_native_money_and_cleanup(self):
        self.assertTrue(self.valid())

    def test_hash_tampering_fails(self):
        self.path.write_text(self.path.read_text().replace('"paid_amount":10','"paid_amount":200',1))
        self.assertFalse(self.valid())

    def test_interrupted_cycle_and_missing_terminal_record_fail(self):
        self.rows.pop();self.write();self.assertFalse(self.valid())

    def test_green_summary_cannot_hide_duplicate_invoice_or_missing_gl(self):
        cycles=[r for r in self.rows if r['type']=='cycle_completed' and r['plan']['financial']]
        cycles[1]['accounting']['invoice']=cycles[0]['accounting']['invoice'];self.write()
        self.assertFalse(self.valid())
        cycles[1]['accounting']['invoice']='INV-25';cycles[0]['accounting']['gl_rows']=0;self.write()
        self.assertFalse(self.valid())

    def test_requested_duration_does_not_count_as_measured_activity(self):
        for row in self.rows:
            if row['type']=='cycle_completed':row['active_ms']=1
        self.write();self.assertFalse(self.valid())

    def test_summary_cannot_hide_heap_growth_or_unclean_final_money(self):
        cycle=next(r for r in self.rows if r['type']=='cycle_completed')
        cycle['metrics']={**self.sample,'heap_bytes':1000000000};self.write();self.assertFalse(self.valid())
        cycle['metrics']=self.sample;self.rows[-1]['cleanup']['net_party_gl']=20;self.write();self.assertFalse(self.valid())

    def test_smoke_never_counts_even_with_full_counts(self):
        self.rows[0]['smoke']=True;self.write();self.assertFalse(self.valid())

    def test_unmatched_started_cycle_cannot_be_hidden_by_completed_event(self):
        self.rows[-1:-1]=[dict(sequence=len(self.rows)-1,type='cycle_started',plan=dict(index=500))]
        for index,row in enumerate(self.rows):row['sequence']=index
        self.write();self.assertFalse(self.valid())

    def test_balanced_wrong_cash_income_tax_receivable_or_party_fails(self):
        proof = next(r['accounting'] for r in self.rows if r['type']=='cycle_completed' and r['plan']['financial'])
        original = copy.deepcopy(proof)
        for index in range(5):
            with self.subTest(account_index=index):
                proof.clear();proof.update(copy.deepcopy(original))
                proof['gl_entries'][index]['account']='Unrelated account'
                self.write();self.assertFalse(self.valid())
        proof.clear();proof.update(copy.deepcopy(original))
        proof['gl_entries'][1]['party']='Other customer'
        self.write();self.assertFalse(self.valid())

    def test_exact_markers_do_not_replace_raw_invoice_and_gl_or_fixture(self):
        proof = next(r['accounting'] for r in self.rows if r['type']=='cycle_completed' and r['plan']['financial'])
        original = copy.deepcopy(proof)
        for key in ('gl_entries','invoice_snapshot','expected_total','cash_account','exact_accounts_verified'):
            with self.subTest(key=key):
                proof.clear();proof.update(copy.deepcopy(original));proof.pop(key)
                self.write();self.assertFalse(self.valid())
        proof.clear();proof.update(original)
        self.rows=[r for r in self.rows if r['type']!='fixture_scope']
        for index,row in enumerate(self.rows):row['sequence']=index
        self.write();self.assertFalse(self.valid())

    def test_raw_quantity_rate_tender_currency_and_identity_corruption_fail(self):
        proof = next(r['accounting'] for r in self.rows if r['type']=='cycle_completed' and r['plan']['financial'])
        original = copy.deepcopy(proof)
        changes = (lambda p:p['invoice_snapshot']['items'][0].update(qty=2),
            lambda p:p['invoice_snapshot']['items'][0].update(rate=9),
            lambda p:p['invoice_snapshot']['payments'][0].update(mode_of_payment='Card'),
            lambda p:p['invoice_snapshot'].update(currency='USD'),
            lambda p:p['invoice_snapshot'].update(posa_client_request_id='different'),
            lambda p:p['gl_entries'][0].update(account_currency='USD'),
            lambda p:p.update(expected_total=9))
        for change in changes:
            proof.clear();proof.update(copy.deepcopy(original));change(proof)
            self.write();self.assertFalse(self.valid())

    def test_final_native_recheck_must_match_actual_cycle_documents(self):
        self.rows[-1]['final_audit']['invoices'][0]['gl_entries'][0]['account']='Unrelated bank'
        self.write();self.assertFalse(self.valid())

    def test_ack_recovery_supported_paths_are_bound_to_original_money(self):
        cycle=next(r for r in self.rows if r['type']=='cycle_completed' and 'ack_loss' in r['faults'])
        for kind,attempts in [('direct_docstatus',1),('verified_outbox',1),('same_request_replay',2)]:
            cycle['ack_recovery'].update(kind=kind,submit_attempts=attempts)
            self.write();self.assertTrue(self.valid())

    def test_missing_or_mismatched_ack_proof_cannot_hide_behind_true_summary(self):
        cycle=next(r for r in self.rows if r['type']=='cycle_completed' and 'ack_loss' in r['faults'])
        original=copy.deepcopy(cycle['ack_recovery'])
        for change in [None,{},dict(verified=False),dict(invoice='Other'),dict(request_id='Other'),
            dict(kind='unknown'),dict(submit_attempts=0),dict(submit_attempts=True),
            dict(submit_attempts=1.5),dict(kind='same_request_replay',submit_attempts=1)]:
            cycle['ack_recovery']=None if change is None else ({**original,**change} if change else {})
            self.write();self.assertFalse(self.valid())

    def test_combined_queue_counts_require_both_nonnegative_integer_components(self):
        cycle=next(r for r in self.rows if r['type']=='cycle_completed')
        baseline=next(r for r in self.rows if r['type']=='baseline')
        for row in (baseline,cycle):
            for change in [dict(write_queue_pending=1),dict(outbox_pending=1),dict(write_queue_pending=-1),
                dict(outbox_pending=True),dict(outbox_pending=0.0),dict(queue_pending=1),dict(queue_pending=False)]:
                row['metrics']={**self.sample,**change};self.write();self.assertFalse(self.valid())
            row['metrics']={**self.sample};row['metrics'].pop('outbox_pending')
            self.write();self.assertFalse(self.valid())
            row['metrics']=self.sample



if __name__=='__main__':unittest.main()
