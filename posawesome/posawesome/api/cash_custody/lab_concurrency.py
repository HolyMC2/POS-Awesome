"""Two independent database transactions compete for one safe's loose cash."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, local
import frappe
from . import service


def run(profile, user):
    site=frappe.local.site
    if '.lab.' not in site or not profile.startswith('Custody QA '):
        raise RuntimeError('Isolated lab fixtures only')
    safe=service.safe_for(profile)
    available=service.loose_balance(safe)
    amount=round(available*.75,2)
    if amount<=0:raise RuntimeError('Fixture needs loose cash')
    barrier=Barrier(2);original=service.safe_for;seen=local()
    def synchronize(profile,lock=False):
        safe=original(profile,lock)
        if not lock and not getattr(seen,'arrived',False):
            seen.arrived=True;barrier.wait(timeout=15)
        return safe
    service.safe_for=synchronize
    def attempt(index):
        frappe.init(site=site);frappe.connect();frappe.set_user(user)
        try:
            result=service.command('prepare',dict(pos_profile=profile,request_id=uuid.uuid4().hex,
                seal='QA-RACE-'+uuid.uuid4().hex,purpose='Float',count={'source':'manual','amount':amount,'reason':'Concurrent physical bag reservation test'}))
            frappe.db.commit();return {'ok':True,'bag':result['bag']}
        except Exception as e:
            frappe.db.rollback();return {'ok':False,'error':type(e).__name__}
        finally:frappe.destroy()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,[1,2]))
    finally:service.safe_for=original
    frappe.db.rollback()
    if sum(r['ok'] for r in results)!=1 or any(not r['ok'] and r['error']!='ValidationError' for r in results):raise AssertionError(results)
    remaining=service.loose_balance(original(profile))
    if round(remaining,2)!=round(available-amount,2):raise AssertionError((available,remaining,results))
    return {'results':results,'available_before':available,'reserved_once':amount,'remaining':remaining}
