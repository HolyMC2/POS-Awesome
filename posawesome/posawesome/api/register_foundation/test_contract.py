"""Static spec-01 contract: schema constraints, hooks and command protocol."""
import ast
import json
import pathlib
import re
import unittest

APP = pathlib.Path(__file__).resolve().parents[3]
DOCTYPES = APP / "posawesome" / "doctype"
HERE = pathlib.Path(__file__).parent


def meta(name):
    folder = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return json.loads((DOCTYPES / folder / f"{folder}.json").read_text())


def field(doc, fieldname):
    return next(f for f in doc["fields"] if f["fieldname"] == fieldname)


class SchemaContract(unittest.TestCase):
    def test_uniqueness_is_enforced_by_the_database(self):
        expectations = {
            "POS Store": ["store_key"], "POS Register": ["register_key", "drawer_route_key"],
            "POS Register Runtime": ["register"], "POS Cashier Runtime": ["user"],
            "POS Device": ["terminal_id"], "POS Device Binding": ["active_register_key", "active_device_key"],
            "POS Enrollment Challenge": ["code_hash"], "POS Store Assignment": ["assignment_key"],
            "POS Register Command Receipt": ["receipt_key"],
        }
        for doctype, fields in expectations.items():
            doc = meta(doctype)
            for name in fields:
                self.assertEqual(field(doc, name).get("unique"), 1, f"{doctype}.{name} must be unique")

    def test_runtime_rows_are_keyed_one_per_register_and_user(self):
        self.assertEqual(meta("POS Register Runtime")["autoname"], "field:register")
        self.assertEqual(meta("POS Cashier Runtime")["autoname"], "field:user")

    def test_service_records_grant_no_generic_writes(self):
        for doctype in ("POS Register Runtime", "POS Cashier Runtime", "POS Device", "POS Device Binding",
                        "POS Enrollment Challenge", "POS Register Command Receipt", "POS Register Event"):
            for perm in meta(doctype)["permissions"]:
                self.assertFalse(perm.get("write") or perm.get("create") or perm.get("delete"), doctype)
            controller = (DOCTYPES / re.sub(r"[^a-z0-9]+", "_", doctype.lower()) /
                          (re.sub(r"[^a-z0-9]+", "_", doctype.lower()) + ".py")).read_text()
            self.assertIn("ServiceRecord", controller, doctype)

    def test_secrets_are_permlevel_protected(self):
        self.assertEqual(field(meta("POS Device"), "verifier_hash")["permlevel"], 1)
        self.assertEqual(field(meta("POS Enrollment Challenge"), "code_hash")["permlevel"], 1)

    def test_opening_shift_stamps_are_read_only_and_not_copied(self):
        doc = meta("POS Opening Shift")
        for name in ("posa_store", "posa_register", "posa_business_date", "posa_drawer_account",
                     "posa_register_contract_version", "posa_binding_generation", "posa_register_snapshot"):
            self.assertEqual(field(doc, name).get("read_only"), 1, name)
            self.assertEqual(field(doc, name).get("no_copy"), 1, name)


class HookContract(unittest.TestCase):
    hooks = (APP / "hooks.py").read_text()

    def test_every_money_boundary_is_routed(self):
        for doctype, hook in (("Sales Invoice", "apply_invoice_route"), ("POS Invoice", "apply_invoice_route"),
                              ("Payment Entry", "apply_payment_entry_route")):
            self.assertRegex(self.hooks, rf'_append_hook\("{doctype}", "validate", f"{{_REGISTERS}}\.routing\.{hook}"\)')
        validation = (HERE.parent / "cash_movement" / "validation.py").read_text()
        self.assertIn("movement_drawer(payload)", validation)
        # Profile-only cash routes go through the acting user's caja drawer.
        self.assertIn("session_drawer(", (HERE.parent / "gift_cards.py").read_text())
        self.assertIn("session_drawer(pos_profile, mode)", (HERE.parent / "purchase_orders.py").read_text())

    def test_runtime_pointers_follow_close_and_cancel(self):
        for doctype, event in (("POS Closing Shift", "on_submit"), ("POS Closing Shift", "on_cancel"),
                               ("POS Opening Shift", "on_cancel")):
            self.assertIn(f'_append_hook("{doctype}", "{event}"', self.hooks)

    def test_all_new_records_have_scoped_desk_reads(self):
        for doctype in ("POS Store", "POS Register", "POS Register Runtime", "POS Cashier Runtime", "POS Device",
                        "POS Device Binding", "POS Enrollment Challenge", "POS Store Assignment",
                        "POS Register Command Receipt", "POS Register Event"):
            self.assertIn(f'"{doctype}": f"{{_REGISTERS}}.scope.query_', self.hooks)
            self.assertIn(f'"{doctype}"', self.hooks.split("has_permission = has_permission |")[1])


class CommandProtocol(unittest.TestCase):
    tree = ast.parse((HERE / "commands.py").read_text())

    def functions(self):
        return {n.name: n for n in self.tree.body if isinstance(n, ast.FunctionDef)}

    def decorators(self, node):
        return [ast.unparse(d) for d in node.decorator_list]

    def test_every_mutating_command_is_post_only_and_retried(self):
        mutating = [name for name, node in self.functions().items()
                    if any("methods=['POST']" in d for d in self.decorators(node))]
        self.assertGreaterEqual(len(mutating), 13)
        for name in mutating:
            if name in ("preview_device_challenge", "heartbeat"):
                continue
            self.assertIn("_retrying", self.decorators(self.functions()[name]), name)

    def test_financial_commands_take_request_ids(self):
        for name in ("open_register", "enroll_device", "revoke_device", "create_register", "configure_register",
                     "set_register_lifecycle", "create_store", "grant_access", "revoke_access"):
            args = [a.arg for a in self.functions()[name].args.args]
            self.assertEqual(args[0], "request_id", name)

    def test_opening_follows_the_lock_order(self):
        source = ast.get_source_segment((HERE / "commands.py").read_text(), self.functions()["open_register"])
        order = [source.index(token) for token in ("receipt.begin()", "lock_cashier(user)",
                                                   "lock_register(row.name", "shift.insert(")]
        self.assertEqual(order, sorted(order))

    def test_reads_never_call_the_closing_builder(self):
        for module in ("queries.py", "commands.py", "migration.py"):
            self.assertNotIn("make_closing_shift_from_opening", (HERE / module).read_text(), module)


if __name__ == "__main__":
    unittest.main()
