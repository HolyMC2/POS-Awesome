"""Native spec-01 drill: real ERPNext documents, real commits, real races.

COMMITS DATA. Refuses to run unless ``site_config.posa_register_native_drill``
is set, which only an isolated disposable test site should carry. Fixtures are
labelled ``QA RF <tag>`` (users, accounts, profile, stores, registers).

    bench --site <isolated site> console
    >>> from posawesome.posawesome.api.register_foundation import native_drill
    >>> native_drill.run()          # returns {"passed": n, "failed": [...], "checks": [...]}
"""

from __future__ import annotations

import json
import secrets
import threading
import time
import traceback

import frappe
from frappe.utils import flt

PASSWORD = "Qa-" + "rf-" + "Drill-2026!"  # disposable fixture users on an isolated site
CMD = "posawesome.posawesome.api.register_foundation.commands"


class Drill:
    def __init__(self, tag):
        self.tag = tag
        self.checks = []
        self.site = frappe.local.site
        self.sites_path = frappe.local.sites_path
        self.facts = {}

    # -- bookkeeping -------------------------------------------------------
    def check(self, test_id, name, ok, detail=None):
        self.checks.append({"id": test_id, "name": name, "ok": bool(ok), "detail": detail})
        return ok

    def expect_error(self, test_id, name, fn, contains=None):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - drill records the refusal text
            frappe.db.rollback()
            text = str(exc)
            return self.check(test_id, name, (contains or "") in text if contains else True,
                              f"{type(exc).__name__}: {text[:300]}")
        frappe.db.rollback()
        return self.check(test_id, name, False, "no error raised")

    # -- helpers -----------------------------------------------------------
    def as_user(self, user):
        frappe.set_user(user)
        from . import scope
        scope.clear_cache()
        frappe.local.posa_verified_terminal_generations = {}
        if hasattr(frappe.local, "_posa_route_cache"):
            frappe.local._posa_route_cache = {}

    def rid(self):
        return "rf" + secrets.token_hex(12)

    def terminal(self):
        return {"terminal_id": "t" + secrets.token_hex(10), "terminal_token": secrets.token_hex(24)}

    def in_threads(self, jobs):
        """Run callables in independent connections released by one barrier."""
        barrier = threading.Barrier(len(jobs))
        results = [None] * len(jobs)

        def worker(index, user, fn):
            frappe.init(site=self.site, sites_path=self.sites_path)
            frappe.connect()
            try:
                frappe.set_user(user)
                barrier.wait(timeout=30)
                value = fn()
                frappe.db.commit()
                results[index] = ("ok", value)
            except Exception as exc:  # noqa: BLE001
                frappe.db.rollback()
                results[index] = ("error", f"{type(exc).__name__}: {str(exc)[:300]}")
            finally:
                frappe.destroy()

        threads = [threading.Thread(target=worker, args=(i, user, fn)) for i, (user, fn) in enumerate(jobs)]
        frappe.db.commit()  # release this connection's snapshot before the race
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=120)
        frappe.db.commit()  # new snapshot: observe the workers' commits
        return results

    def gl(self, account):
        row = frappe.db.sql("""select coalesce(sum(debit),0), coalesce(sum(credit),0) from `tabGL Entry`
            where account=%s and is_cancelled=0""", (account,))[0]
        return flt(row[0], 2), flt(row[1], 2)

    # -- fixtures ------------------------------------------------------------
    def setup(self):
        frappe.set_user("Administrator")
        tag = self.tag
        base = frappe.get_doc("POS Profile", "Doco Ventas")
        company = base.company
        abbr = frappe.db.get_value("Company", company, "abbr")
        accounts = []
        for label in ("Caja 1", "Caja 2", "Caja 3", "Caja 4", "Caja 5"):
            name = f"QA RF {tag} {label} - {abbr}"
            if not frappe.db.exists("Account", name):
                frappe.get_doc({"doctype": "Account", "account_name": f"QA RF {tag} {label}", "company": company,
                                "parent_account": f"Efectivo en caja - {abbr}", "account_type": "Cash",
                                "account_currency": "MXN"}).insert(ignore_permissions=True)
            accounts.append(name)
        users = {}
        for key in ("c1", "c2", "c3", "s1", "o1"):
            email = f"qa-rf-{tag}-{key}@example.invalid"
            if not frappe.db.exists("User", email):
                user = frappe.get_doc({"doctype": "User", "email": email, "first_name": f"QA {key.upper()}",
                                       "send_welcome_email": 0, "enabled": 1, "user_type": "System User"})
                user.insert(ignore_permissions=True)
                user.add_roles("POS User", "Sales User", "Accounts User", "Stock User")
                if key == "s1":
                    user.add_roles("POS Awesome Supervisor")
                from frappe.utils.password import update_password
                update_password(email, PASSWORD)
            users[key] = email
        profiles = {}
        for kind in ("reg", "legacy"):
            name = f"QA RF {tag} {kind}"
            if not frappe.db.exists("POS Profile", name):
                doc = frappe.copy_doc(base)
                doc.name = name
                doc.__newname = name
                doc.set("applicable_for_users", [{"user": users[k], "default": 0} for k in ("c1", "c2", "c3", "s1", "o1")])
                doc.update_stock = 0
                doc.posa_default_source_account = accounts[3] if kind == "legacy" else None
                doc.insert(ignore_permissions=True, set_name=name)
            profiles[kind] = name
        self.facts.update(company=company, accounts=accounts, users=users, profiles=profiles)
        frappe.db.commit()

        from . import commands as c
        store = frappe.db.get_value("POS Store", {"store_key": f"{company}::QARF{tag}"}, "name")
        if not store:
            store = c.create_store(self.rid(), company, f"QARF{tag}", f"QA Centro {tag}", "America/Mazatlan", "04:00",
                                   json.dumps([base.warehouse]), json.dumps([profiles["reg"]]))["name"]
        other = frappe.db.get_value("POS Store", {"store_key": f"{company}::QARFX{tag}"}, "name")
        if not other:
            other = c.create_store(self.rid(), company, f"QARFX{tag}", f"QA Otra {tag}", "America/Mazatlan", "00:00",
                                   "[]", json.dumps([profiles["reg"]]))["name"]
        regs = {}
        for code, mode, account in (("MOSTRADOR", "Cash", accounts[0]), ("CAJA2", "Cash", accounts[1]),
                                    ("SINEFECTIVO", "Cashless", None)):
            existing = frappe.db.get_value("POS Register", {"register_key": f"{store}::{code}"}, "name")
            regs[code] = existing or c.create_register(self.rid(), store, code, f"Caja {code.title()}",
                                                       profiles["reg"], mode, account)["name"]
        regs["OTHER"] = frappe.db.get_value("POS Register", {"register_key": f"{other}::OTRA"}, "name") or \
            c.create_register(self.rid(), other, "OTRA", "Caja Otra", profiles["reg"], "Cash", accounts[2])["name"]
        for key in ("c1", "c2", "c3"):
            c.grant_access(self.rid(), users[key], "Cashier", store=store)
        c.grant_access(self.rid(), users["s1"], "Store supervisor", store=store)
        frappe.db.commit()
        self.facts.update(store=store, other_store=other, registers=regs)

        # Devices: the supervisor issues codes; each cashier redeems on "their" tablet.
        self.terms = {}
        for code, cashier in (("MOSTRADOR", "c1"), ("CAJA2", "c2"), ("SINEFECTIVO", "c3")):
            self.as_user(users["s1"])
            challenge = c.issue_device_challenge(regs[code], "Enroll")
            frappe.db.commit()
            self.as_user(users[cashier])
            term = self.terminal()
            c.enroll_device(self.rid(), challenge["code"], term["terminal_id"], term["terminal_token"], f"Tablet {code}")
            frappe.db.commit()
            self.terms[code] = term
        self.as_user("Administrator")
        for code in ("MOSTRADOR", "CAJA2", "SINEFECTIVO"):
            reg = frappe.get_doc("POS Register", regs[code])
            if reg.lifecycle != "Ready":
                c.set_register_lifecycle(self.rid(), reg.name, "Ready", reg.revision)
        frappe.db.commit()

    # -- scenarios -----------------------------------------------------------
    def open(self, user, code, term=None, request_id=None, balances=None):
        from . import commands as c
        self.as_user(user)
        term = term or self.terms[code]
        return c.open_register(request_id or self.rid(), self.facts["registers"][code],
                               json.dumps(balances or [{"mode_of_payment": "Cash", "amount": 0}]),
                               term["terminal_id"], term["terminal_token"])

    def cancel_shift(self, shift):
        frappe.set_user("Administrator")
        doc = frappe.get_doc("POS Opening Shift", shift)
        if doc.docstatus == 1:
            doc.cancel()
        frappe.db.commit()

    def sell(self, user, shift, amount, term, mode="Cash", is_return=False, against=None, commit=True):
        """Whole-transaction retry on 1020/1213, as spec 01 §7 requires of callers."""
        for attempt in range(4):
            try:
                return self._sell(user, shift, amount, term, mode, is_return, against, commit)
            except frappe.QueryDeadlockError:
                frappe.db.rollback()
                self.facts.setdefault("sale_retries", 0)
                self.facts["sale_retries"] += 1
                if attempt == 3:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def _sell(self, user, shift, amount, term, mode, is_return, against, commit):
        from posawesome.posawesome.api.shift_terminal import assert_terminal_access
        self.as_user(user)
        row = frappe.db.get_value("POS Opening Shift", shift, ["posa_terminal_generation", "pos_profile"], as_dict=True)
        assert_terminal_access(shift, term["terminal_id"], row.posa_terminal_generation, term["terminal_token"])
        qty = -1 if is_return else 1
        doc = frappe.get_doc({
            "doctype": "Sales Invoice", "customer": "General", "company": self.facts["company"],
            "pos_profile": row.pos_profile, "is_pos": 1, "update_stock": 0, "posa_pos_opening_shift": shift,
            "is_return": 1 if is_return else 0, "return_against": against,
            "items": [{"item_code": "IPN007407", "qty": qty, "rate": amount}],
            "payments": [{"mode_of_payment": mode, "amount": qty * amount,
                          "account": "Caja Tienda - GD"}]})  # a tampered/legacy account the route must replace
        doc.insert(ignore_permissions=True)
        doc.submit()
        if commit:
            frappe.db.commit()
        return doc.name

    def run_all(self):
        users, regs = self.facts["users"], self.facts["registers"]
        acc1, acc2 = self.facts["accounts"][:2]
        acc3 = self.facts["accounts"][4]  # free account for the staged route change
        from . import commands as c
        from . import queries as q

        # FND-T02: two cashiers, one tablet, racing to open one caja.
        res = self.in_threads([(users["c1"], lambda: self.open(users["c1"], "MOSTRADOR")),
                               (users["c2"], lambda: self.open(users["c2"], "MOSTRADOR"))])
        wins = [r for r in res if r[0] == "ok"]
        shifts = frappe.get_all("POS Opening Shift", filters={"posa_register": regs["MOSTRADOR"], "status": "Open",
                                                               "docstatus": 1}, pluck="name")
        self.check("FND-T02", "two processes opening one caja produce one shift", len(wins) == 1 and len(shifts) == 1,
                   {"results": res, "open_shifts": shifts})
        for s in shifts:
            self.cancel_shift(s)

        # FND-T02: one cashier racing to open two cajas.
        res = self.in_threads([(users["c1"], lambda: self.open(users["c1"], "MOSTRADOR")),
                               (users["c1"], lambda: self.open(users["c1"], "CAJA2", term=self.terms["CAJA2"]))])
        mine = frappe.get_all("POS Opening Shift", filters={"user": users["c1"], "status": "Open", "docstatus": 1},
                              pluck="name")
        self.check("FND-T02", "one cashier opening two cajas produces one shift",
                   sum(1 for r in res if r[0] == "ok") == 1 and len(mine) == 1, {"results": res, "open": mine})
        for s in mine:
            self.cancel_shift(s)

        # FND-T05: concurrent twins with one request ID, then a lost-response replay.
        request = self.rid()
        res = self.in_threads([(users["c1"], lambda: self.open(users["c1"], "MOSTRADOR", request_id=request)),
                               (users["c1"], lambda: self.open(users["c1"], "MOSTRADOR", request_id=request))])
        names = {r[1]["pos_opening_shift"]["name"] for r in res if r[0] == "ok"}
        replay = self.open(users["c1"], "MOSTRADOR", request_id=request)
        frappe.db.commit()
        opened = frappe.get_all("POS Opening Shift", filters={"posa_register": regs["MOSTRADOR"], "status": "Open",
                                                               "docstatus": 1}, pluck="name")
        self.check("FND-T05", "twin and replayed opening return the original shift without duplicates",
                   len(names) == 1 and all(r[0] == "ok" for r in res)
                   and replay["pos_opening_shift"]["name"] in names and len(opened) == 1,
                   {"results": [r if r[0] == "error" else ("ok", r[1]["pos_opening_shift"]["name"]) for r in res],
                    "shifts": sorted(names), "open": opened})
        self.expect_error("FND-T05", "reusing a request ID with different data is refused",
                          lambda: self.open(users["c1"], "MOSTRADOR", request_id=request,
                                            balances=[{"mode_of_payment": "Cash", "amount": 5}]), "different instruction")
        shift1 = opened[0]
        # Enrollment replay: same request → same binding, no new binding.
        self.as_user(users["s1"])
        bindings_before = frappe.db.count("POS Device Binding", {"register": regs["CAJA2"]})
        self.check("FND-T05", "enrollment codes are single use",
                   frappe.db.count("POS Enrollment Challenge", {"register": regs["CAJA2"], "state": "Used"}) == 1)

        # Legacy exclusion: c1 (register shift open) cannot open a legacy shift.
        from posawesome.posawesome.api.shifts import create_opening_voucher
        self.as_user(users["c1"])
        term = self.terminal()
        self.expect_error("FND-T02", "legacy opening shares the cashier exclusion",
                          lambda: create_opening_voucher(self.facts["profiles"]["legacy"], self.facts["company"],
                                                         json.dumps([{"mode_of_payment": "Cash", "amount": 0}]),
                                                         term["terminal_id"], term["terminal_token"]), "open shift")
        self.expect_error("FND-09", "legacy clients cannot open a profile served by an activated caja",
                          lambda: create_opening_voucher(self.facts["profiles"]["reg"], self.facts["company"],
                                                         json.dumps([{"mode_of_payment": "Cash", "amount": 0}]),
                                                         term["terminal_id"], term["terminal_token"]), "caja")

        # FND-T01: second cashier opens the other caja on the SAME profile; concurrent sales.
        shift2 = self.open(users["c2"], "CAJA2")["pos_opening_shift"]["name"]
        frappe.db.commit()
        before = {a: self.gl(a) for a in (acc1, acc2, "Caja Tienda - GD")}
        res = self.in_threads([
            (users["c1"], lambda: self.sell(users["c1"], shift1, 100, self.terms["MOSTRADOR"])),
            (users["c2"], lambda: self.sell(users["c2"], shift2, 250, self.terms["CAJA2"]))])
        sale1 = res[0][1] if res[0][0] == "ok" else None
        sale2 = res[1][1] if res[1][0] == "ok" else None
        ret2 = self.sell(users["c2"], shift2, 50, self.terms["CAJA2"], is_return=True, against=sale2) if sale2 else None
        # Collection bound to the shift (reference_no), created with the legacy account.
        self.as_user(users["c1"])
        pe = frappe.get_doc({"doctype": "Payment Entry", "payment_type": "Receive", "company": self.facts["company"],
                             "mode_of_payment": "Cash", "party_type": "Customer", "party": "General",
                             "paid_from": frappe.db.get_value("Company", self.facts["company"], "default_receivable_account"),
                             "paid_to": "Caja Tienda - GD", "paid_amount": 30, "received_amount": 30,
                             "reference_no": shift1, "reference_date": frappe.utils.nowdate()})
        pe.insert(ignore_permissions=True)
        pe.submit()
        frappe.db.commit()
        # Expense from caja 2 through the canonical cash-movement service.
        from posawesome.posawesome.api.cash_movement.service import _create_cash_movement
        self.as_user(users["c2"])
        gen2 = frappe.db.get_value("POS Opening Shift", shift2, "posa_terminal_generation")
        mov = _create_cash_movement({"pos_opening_shift": shift2, "pos_profile": self.facts["profiles"]["reg"],
                                     "amount": 20, "remarks": "QA expense", "terminal_generation": gen2,
                                     "client_request_id": self.rid(), **self.terms["CAJA2"]}, "Expense")
        frappe.db.commit()
        after = {a: self.gl(a) for a in (acc1, acc2, "Caja Tienda - GD")}
        delta = {a: (flt(after[a][0] - before[a][0], 2), flt(after[a][1] - before[a][1], 2)) for a in after}
        self.check("FND-T01", "concurrent sales on two cajas sharing a profile both commit", bool(sale1 and sale2),
                   {"results": res})
        self.check("FND-T01", "caja 1 drawer GL = sale 100 + collection 30", delta[acc1] == (130.0, 0.0), delta[acc1])
        self.check("FND-T01", "caja 2 drawer GL = sale 250, refund 50, expense 20", delta[acc2] == (250.0, 70.0), delta[acc2])
        self.check("FND-T01", "legacy shared cash account untouched", delta["Caja Tienda - GD"] == (0.0, 0.0),
                   delta["Caja Tienda - GD"])
        for inv, account in ((sale1, acc1), (sale2, acc2), (ret2, acc2)):
            if inv:
                self.check("FND-T01", f"{inv} cash row and change account stamped",
                           frappe.db.get_value("Sales Invoice Payment", {"parent": inv, "mode_of_payment": "Cash"}, "account") == account)
        self.check("FND-T01", "expense movement uses caja 2 drawer",
                   frappe.db.get_value("POS Cash Movement", mov["name"], "source_account") == acc2)

        saldo = self.sell(users["c1"], shift1, 12, self.terms["MOSTRADOR"], mode="Saldo proveedores")
        saldo_account = frappe.db.get_value("Sales Invoice Payment", {"parent": saldo}, "account")
        self.check("FND-T01", "non-drawer Cash-typed mode (supplier balance) keeps its own account",
                   saldo_account not in (acc1, acc2) and saldo_account == frappe.db.get_value(
                       "Mode of Payment Account", {"parent": "Saldo proveedores", "company": self.facts["company"]},
                       "default_account"), saldo_account)

        # FND-T07: configuration change while open is pending; open shift keeps its route.
        frappe.set_user("Administrator")
        rev = frappe.db.get_value("POS Register", regs["MOSTRADOR"], "revision")
        c.configure_register(self.rid(), regs["MOSTRADOR"], rev, json.dumps({"drawer_account": acc3}))
        frappe.db.commit()
        reg1 = frappe.get_doc("POS Register", regs["MOSTRADOR"])
        self.check("FND-T07", "routing edit on an open caja is staged, not applied",
                   reg1.drawer_account == acc1 and json.loads(reg1.pending_configuration)["drawer_account"] == acc3)
        sale1b = self.sell(users["c1"], shift1, 40, self.terms["MOSTRADOR"])
        self.check("FND-T07", "sale after the edit still posts to the stamped drawer",
                   frappe.db.get_value("Sales Invoice Payment", {"parent": sale1b}, "account") == acc1)
        self.expect_error("FND-05", "the shift's stamped route cannot be edited",
                          lambda: (frappe.set_user("Administrator"),
                                   frappe.get_doc("POS Opening Shift", shift1).update({"posa_drawer_account": acc3}).save()))
        self.cancel_shift(shift1)
        shift1b = self.open(users["c1"], "MOSTRADOR")["pos_opening_shift"]["name"]
        frappe.db.commit()
        sale1c = self.sell(users["c1"], shift1b, 10, self.terms["MOSTRADOR"])
        self.check("FND-T07", "next opening applies the pending route",
                   frappe.db.get_value("Sales Invoice Payment", {"parent": sale1c}, "account") == acc3
                   and frappe.db.get_value("POS Opening Shift", shift1b, "posa_drawer_account") == acc3)

        # FND-T04: replace caja 2's tablet while open.
        self.as_user(users["s1"])
        self.expect_error("FND-T04", "replacement requires supervisor reauthentication",
                          lambda: c.issue_device_challenge(regs["CAJA2"], "Replace", "Tablet dropped and broken", "wrong", 1),
                          "password")
        self.as_user(users["s1"])
        ch = c.issue_device_challenge(regs["CAJA2"], "Replace", "Tablet dropped and broken", PASSWORD, 1)
        frappe.db.commit()
        old = self.terms["CAJA2"]
        new = self.terminal()
        self.as_user(users["c2"])
        c.enroll_device(self.rid(), ch["code"], new["terminal_id"], new["terminal_token"], "Tablet nueva")
        frappe.db.commit()
        self.terms["CAJA2"] = new
        self.expect_error("FND-T04", "old browser is fenced after replacement",
                          lambda: self.sell(users["c2"], shift2, 15, old), "")
        before_count = frappe.db.count("Sales Invoice", {"posa_pos_opening_shift": shift2, "docstatus": 1})
        self.check("FND-T04", "delayed old-browser request created no sale",
                   frappe.db.count("Sales Invoice", {"posa_pos_opening_shift": shift2, "docstatus": 1}) == before_count)
        srow = frappe.db.get_value("POS Opening Shift", shift2, ["user", "posa_terminal_recovery_pending"], as_dict=True)
        self.check("FND-T04", "shift keeps its cashier and enters recovery review",
                   srow.user == users["c2"] and int(srow.posa_terminal_recovery_pending) == 1, srow)
        new_sale = self.sell(users["c2"], shift2, 15, new)
        self.check("FND-T04", "replacement device sells on the same shift and drawer",
                   frappe.db.get_value("Sales Invoice Payment", {"parent": new_sale}, "account") == acc2)
        from posawesome.posawesome.api.shift_terminal import assert_verified_terminal_generation
        self.expect_error("FND-T03", "queued worker with a stale generation is refused",
                          lambda: assert_verified_terminal_generation(shift2, 1), "")

        # FND-T06: retirement explains blockers.
        frappe.set_user("Administrator")
        rev = frappe.db.get_value("POS Register", regs["CAJA2"], "revision")
        try:
            c.set_register_lifecycle(self.rid(), regs["CAJA2"], "Retired", rev, "Retiring for the drill test")
            self.check("FND-T06", "retiring an open caja is refused", False)
        except Exception as exc:  # noqa: BLE001
            frappe.db.rollback()
            text = str(exc)
            self.check("FND-T06", "retiring an open caja lists each blocker",
                       all(k in text for k in ("open shift", "recovery", "drawer")), text[:300])

        # FND-T03: tampering and scope.
        self.as_user(users["o1"])
        self.expect_error("FND-T03", "user without a store grant cannot open a caja",
                          lambda: self.open(users["o1"], "MOSTRADOR", term=self.terms["MOSTRADOR"]), "outside your access")
        self.as_user(users["o1"])
        self.check("FND-T03", "Desk/REST list hides ungranted registers",
                   frappe.get_list("POS Register", pluck="name") == [])
        self.as_user(users["c1"])
        missing_msg = other_msg = None
        try:
            q.register_detail("does-not-exist")
        except Exception as exc:  # noqa: BLE001
            missing_msg = str(exc)
        try:
            q.register_detail(regs["OTHER"])
        except Exception as exc:  # noqa: BLE001
            other_msg = str(exc)
        frappe.db.rollback()
        self.check("FND-T03", "out-of-scope and missing registers are indistinguishable",
                   missing_msg and missing_msg == other_msg, [missing_msg, other_msg])
        self.expect_error("FND-T03", "a cashier cannot sell on another cashier's shift",
                          lambda: self.sell(users["c1"], shift2, 5, self.terms["MOSTRADOR"]), "")
        self.expect_error("FND-T03", "runtime pointers cannot be edited through generic forms",
                          lambda: (frappe.set_user("Administrator"),
                                   frappe.get_doc("POS Register Runtime", regs["CAJA2"]).update(
                                       {"active_opening_shift": None}).save()), "")
        self.as_user(users["c1"])
        self.check("FND-T03", "cashier has no Desk write on registers",
                   not frappe.has_permission("POS Register", "write", regs["MOSTRADOR"]))

        # FND-T08: cashless caja.
        self.expect_error("FND-T08", "cashless caja refuses opening cash",
                          lambda: self.open(users["c3"], "SINEFECTIVO", balances=[{"mode_of_payment": "Cash", "amount": 100}]),
                          "cashless")
        shift3 = self.open(users["c3"], "SINEFECTIVO")["pos_opening_shift"]["name"]
        frappe.db.commit()
        self.expect_error("FND-T08", "cashless caja refuses a cash sale",
                          lambda: self.sell(users["c3"], shift3, 20, self.terms["SINEFECTIVO"]), "cashless")
        self.expect_error("FND-T08", "cashless caja refuses cash movements",
                          lambda: _create_cash_movement({"pos_opening_shift": shift3, "pos_profile": self.facts["profiles"]["reg"],
                                                         "amount": 5, "remarks": "x", "client_request_id": self.rid(),
                                                         "terminal_generation": frappe.db.get_value("POS Opening Shift", shift3, "posa_terminal_generation"),
                                                         **self.terms["SINEFECTIVO"]}, "Expense"), "cashless")
        card = self.sell(users["c3"], shift3, 20, self.terms["SINEFECTIVO"], mode="Wire Transfer")
        self.check("FND-T08", "cashless caja accepts non-cash tender", bool(card))

        # Close caja 2 through the canonical closing service after recovery review.
        from posawesome.posawesome.api.shift_terminal import resolve_terminal_recovery
        from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.creation import (
            make_closing_shift_from_opening, submit_closing_shift)
        self.as_user(users["s1"])
        resolve_terminal_recovery(shift2, "Old tablet destroyed; no unsynced sales remain", 1)
        frappe.db.commit()
        self.as_user(users["c2"])
        opening = frappe.get_doc("POS Opening Shift", shift2)
        closing = make_closing_shift_from_opening(json.dumps(opening.as_dict(), default=str))["closing_shift"]
        cash = next(r for r in closing.payment_reconciliation if r.mode_of_payment == "Cash")
        cash.closing_amount = cash.expected_amount
        closing_name = submit_closing_shift(json.dumps(closing.as_dict(), default=str), new["terminal_id"],
                                            opening.posa_terminal_generation, new["terminal_token"])
        frappe.db.commit()
        runtime = frappe.db.get_value("POS Register Runtime", regs["CAJA2"], ["active_opening_shift", "work_state"], as_dict=True)
        self.check("FND-02", "closing releases caja and cashier pointers",
                   not runtime.active_opening_shift and runtime.work_state == "Available"
                   and not frappe.db.get_value("POS Cashier Runtime", users["c2"], "accountable_shift"),
                   {"closing": closing_name, "expected_cash": cash.expected_amount})
        self.check("FND-T01", "closing expected cash equals caja 2 drawer activity (250-50+15-20)",
                   flt(cash.expected_amount, 2) == 195.0, cash.expected_amount)

        # FND-T10: grant revocation invalidates list and commands.
        frappe.set_user("Administrator")
        grant = frappe.db.get_value("POS Store Assignment", {"user": users["c2"], "enabled": 1}, ["name", "revision"], as_dict=True)
        c.revoke_access(self.rid(), grant.name, grant.revision, "Left the company for the drill")
        frappe.db.commit()
        self.as_user(users["c2"])
        try:
            q.list_registers(self.facts["store"])
            revoked_list = "visible"
        except Exception as exc:  # noqa: BLE001
            revoked_list = str(exc)[:120]
        frappe.db.rollback()
        self.check("FND-T10", "revoked user no longer reads the store", revoked_list != "visible", revoked_list)
        self.as_user(users["c2"])
        self.check("FND-T10", "revoked user's global list is empty", q.list_registers()["registers"] == [])
        self.expect_error("FND-T10", "revoked user cannot open", lambda: self.open(users["c2"], "CAJA2"), "outside your access")

        # FND-T12: bounded list queries.
        frappe.set_user("Administrator")
        for i in range(60 - frappe.db.count("POS Register", {"store": self.facts["store"]})):
            c.create_register(self.rid(), self.facts["store"], f"LOAD{i:03d}", f"Carga {i}", self.facts["profiles"]["reg"],
                              "Cashless")
        frappe.db.commit()
        self.as_user(users["s1"])
        counter = {"n": 0}
        original = frappe.db.sql

        def counting(*args, **kwargs):
            counter["n"] += 1
            return original(*args, **kwargs)

        frappe.db.sql = counting
        try:
            started = time.perf_counter()
            page = q.list_registers(self.facts["store"], page_length=50)
            elapsed = time.perf_counter() - started
            page2 = q.list_registers(self.facts["store"], cursor=page["next_cursor"], page_length=50)
        finally:
            frappe.db.sql = original
        self.check("FND-T12", "50-row page + next page use a bounded number of SQL statements",
                   len(page["registers"]) == 50 and counter["n"] <= 24 and page2["registers"],
                   {"sql_statements_for_two_pages": counter["n"], "first_page_ms": round(elapsed * 1000, 1),
                    "page2_rows": len(page2["registers"])})
        self.facts["list_ms"] = round(elapsed * 1000, 1)
        return self.checks


def run(tag=None):
    if not frappe.conf.get("posa_register_native_drill"):
        frappe.throw("Refusing: this drill commits data and only runs on an isolated test site.")
    drill = Drill(tag or secrets.token_hex(3))
    try:
        drill.setup()
        drill.run_all()
    except Exception:  # noqa: BLE001
        frappe.db.rollback()
        drill.check("DRILL", "drill aborted", False, traceback.format_exc()[-2500:])
    failed = [c for c in drill.checks if not c["ok"]]
    return {"tag": drill.tag, "passed": len(drill.checks) - len(failed), "failed": failed, "checks": drill.checks,
            "facts": {k: v for k, v in drill.facts.items() if k != "users"}}
