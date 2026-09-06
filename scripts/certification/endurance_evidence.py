"""Recompute endurance proof from the append-only raw journal, not summary claims."""
import hashlib
import json
import importlib.util
import pathlib


# Recompute from raw native invoice/GL using the same pure accounting contract;
# no database access and no acceptance based on the producer's boolean marker.
_spec = importlib.util.spec_from_file_location("pos_endurance_accounting",
    pathlib.Path(__file__).resolve().parents[1] / "benchmarks" / "endurance_accounting.py")
_accounting = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_accounting)


def verify_accounting(proof, fixture):
    try:
        expected = fixture["expected_financial"]
        accounts = [fixture["cash_account"], *(expected[k] for k in ("receivable_account", "income_account", "tax_account"))]
        if (fixture["currency"] != "MXN" or len(set(accounts)) != 4
            or any(not isinstance(name, str) or not name.strip() for name in accounts)
            or _accounting.money(expected["net_amount"]) != _accounting.money("8.62")
            or _accounting.money(expected["tax_amount"]) != _accounting.money("1.38")):
            return False
        doc, ledger = proof["invoice_snapshot"], proof["gl_entries"]
        if (doc["name"] != proof["invoice"] or doc["posa_client_request_id"] != proof["request_id"]
            or doc["docstatus"] != 1 or proof["gl_rows"] != len(ledger)
            or _accounting.money(proof["paid_amount"]) != 10
            or _accounting.money(proof["gl_debit"]) != sum(_accounting.money(r["debit"]) for r in ledger)
            or _accounting.money(proof["gl_credit"]) != sum(_accounting.money(r["credit"]) for r in ledger)):
            return False
        exact = _accounting.validate_cash_invoice(fixture, doc, ledger)
        return all(type(proof.get(k)) is type(value) and proof[k] == value
            if isinstance(value, bool) else proof.get(k) == value for k, value in exact.items())
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def drained_queue(sample):
    if not isinstance(sample, dict):
        return False
    values = [sample.get(key) for key in ("queue_pending", "write_queue_pending", "outbox_pending")]
    return (all(type(value) is int and value >= 0 for value in values)
        and values[0] == values[1] + values[2] == 0)


def verified_ack(cycle):
    proof, accounting = cycle.get("ack_recovery"), cycle.get("accounting", {})
    if not isinstance(proof, dict) or cycle.get("plan", {}).get("financial") is not True:
        return False
    kind, attempts = proof.get("kind"), proof.get("submit_attempts")
    return (proof.get("verified") is True and kind in ("direct_docstatus", "verified_outbox", "same_request_replay")
        and type(attempts) is int and attempts >= (2 if kind == "same_request_replay" else 1)
        and bool(accounting.get("invoice")) and proof.get("invoice") == accounting.get("invoice")
        and bool(accounting.get("request_id")) and proof.get("request_id") == accounting.get("request_id"))


def verify_journal(path, identity, metrics):
    previous, rows, pending = None, [], None
    for raw in path.read_text().splitlines():
        row = json.loads(raw)
        if row.get("sequence") != len(rows) or row.get("type") == "failed":
            return False
        if row.get("type") == "cycle_started":
            if pending is not None:
                return False
            pending = row.get("plan")
        if row.get("type") == "cycle_completed":
            if pending is None or pending != row.get("plan"):
                return False
            pending = None
        prefix, marker, tail = raw.rpartition(',"hash":')
        if not marker or row.get("hash") != hashlib.sha256((prefix + "}").encode()).hexdigest():
            return False
        if rows and row.get("previous") != previous:
            return False
        if not rows and row.get("previous") not in (None, ""):
            return False
        previous = row["hash"]
        rows.append(row)
    if not rows or rows[0].get("type") != "started" or rows[0].get("identity") != identity or rows[0].get("smoke") is not False:
        return False
    if rows[-1].get("type") != "completed" or pending is not None:
        return False
    cycles = [r for r in rows if r.get("type") == "cycle_completed"]
    if len(cycles) < 500 or [r["plan"]["index"] for r in cycles] != list(range(len(cycles))):
        return False
    if metrics.get("iterations") != len(cycles):
        return False
    final = rows[-1]
    if final.get("final_audit", {}).get("verified") is not True or final.get("final_audit", {}).get("duplicate_financial_documents") != 0 or final.get("cleanup", {}).get("verified") is not True or final.get("cleanup", {}).get("net_party_gl") != 0:
        return False
    baseline = next((r.get("metrics") for r in rows if r.get("type") == "baseline"), None)
    if not drained_queue(baseline):
        return False
    scopes = [r for r in rows if r.get("type") == "fixture_scope"]
    if len(scopes) != 1 or scopes[0]["sequence"] >= next(r["sequence"] for r in rows if r.get("type") == "baseline"):
        return False
    fixture = scopes[0].get("fixture")
    if not isinstance(fixture, dict):
        return False
    faults = {}
    cycle_proofs = {}
    invoices, requests = set(), set()
    active_milliseconds = 0
    for cycle in cycles:
        if cycle.get("build_version") != identity["build"]["version"] or cycle.get("page_errors") != 0 or cycle.get("metrics", {}).get("queue_pending") != 0:
            return False
        sample = cycle["metrics"]
        if not drained_queue(sample):
            return False
        if "ack_loss" in cycle.get("faults", []) and not verified_ack(cycle):
            return False
        if sample.get("heap_bytes", float("inf")) > baseline["heap_bytes"] * 2 + 32 * 1024 * 1024 or sample.get("listeners", float("inf")) > baseline["listeners"] + 40 or sample.get("realtime_scripts", float("inf")) > 1:
            return False
        for fault in cycle.get("faults", []):
            faults[fault] = faults.get(fault, 0) + 1
        active = cycle.get("active_ms")
        if type(active) not in (float, int) or active < 0:
            return False
        active_milliseconds += active
        if cycle["plan"].get("financial") is True:
            proof = cycle.get("accounting", {})
            if (proof.get("verified") is not True or proof.get("docstatus") != 1 or not proof.get("invoice") or not proof.get("request_id") or proof.get("outstanding_amount") != 0
                or type(proof.get("gl_rows")) is not int or proof["gl_rows"] < 2 or proof.get("gl_debit") != proof.get("gl_credit") or proof.get("paid_amount", 0) <= 0):
                return False
            if not verify_accounting(proof, fixture):
                return False
            cycle_proofs[proof["invoice"]] = proof
            if proof["invoice"] in invoices or proof["request_id"] in requests:
                return False
            invoices.add(proof["invoice"])
            requests.add(proof["request_id"])
    final_proofs = final["final_audit"].get("invoices", [])
    if (len(final_proofs) != len(cycle_proofs) or any(not isinstance(p, dict)
        or p != cycle_proofs.get(p.get("invoice")) or not verify_accounting(p, fixture) for p in final_proofs)
        or len({p["invoice"] for p in final_proofs}) != len(cycle_proofs)):
        return False
    active_seconds = active_milliseconds / 1000
    return (len(invoices) >= 20 and metrics.get("financial_cycles") == len(invoices) == final["final_audit"].get("submitted")
        and active_seconds >= 28800 and abs(metrics.get("duration_seconds", 0) - active_seconds) < 0.01
        and metrics.get("fault_counts") == faults and faults.get("ack_loss", 0) > 0
        and set(final["cleanup"].get("cancelled_invoices", [])) == invoices)
