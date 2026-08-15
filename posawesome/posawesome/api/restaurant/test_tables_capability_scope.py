"""Standalone authorization tests for the `tables` capability gate.

Run without bench:
    python3 posawesome/posawesome/api/restaurant/test_tables_capability_scope.py

Audit r2 P1: assert_tables_capability checked only the base token
(split(":")[0]) and ignored a `:Role` suffix, so any cashier on a
`tables:Restaurant Manager` register could open/settle tables and fire
KOTs. These pin the role-suffix enforcement, mirroring charge_requests.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
TICKETS_PATH = (
    REPO_ROOT / "posawesome" / "posawesome" / "api" / "restaurant" / "_tickets.py"
)

_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))


class _PermissionError(Exception):
    pass


def _load_tickets(capabilities, user_roles):
    state = types.SimpleNamespace(roles=set(user_roles or []))

    frappe_mod = types.ModuleType("frappe")
    frappe_mod._ = lambda s: s
    frappe_mod.PermissionError = _PermissionError
    frappe_mod.session = types.SimpleNamespace(user="cashier@test")
    frappe_mod.get_roles = lambda user=None: list(state.roles)

    def _throw(msg, exc=None):
        raise (exc or Exception)(msg)

    frappe_mod.throw = _throw

    frappe_utils = types.ModuleType("frappe.utils")
    frappe_utils.add_days = lambda *a, **k: None
    frappe_utils.cint = lambda v: int(v or 0)
    frappe_utils.now_datetime = lambda: None
    frappe_utils.nowdate = lambda: ""

    vertical = types.ModuleType("posawesome.posawesome.api.vertical")
    vertical.resolve_capability_json = lambda profile: {"capabilities": list(capabilities)}

    for pkg in ("posawesome", "posawesome.posawesome", "posawesome.posawesome.api",
                "posawesome.posawesome.api.restaurant"):
        if pkg not in sys.modules or not isinstance(sys.modules[pkg], types.ModuleType):
            stub = types.ModuleType(pkg)
            stub.__path__ = []
            sys.modules[pkg] = stub
    sys.modules["frappe"] = frappe_mod
    sys.modules["frappe.utils"] = frappe_utils
    sys.modules["posawesome.posawesome.api.vertical"] = vertical

    spec = importlib.util.spec_from_file_location("tickets_under_test", TICKETS_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class TestTablesCapabilityScope(unittest.TestCase):
    def test_unqualified_token_grants(self):
        mod = _load_tickets(["tables"], user_roles=[])
        mod.assert_tables_capability("P")  # no raise

    def test_role_qualified_token_grants_with_role(self):
        mod = _load_tickets(["tables:Restaurant Manager"], ["Restaurant Manager"])
        mod.assert_tables_capability("P")  # no raise

    def test_role_qualified_token_denies_without_role(self):
        mod = _load_tickets(["tables:Restaurant Manager"], ["Sales User"])
        with self.assertRaises(_PermissionError):
            mod.assert_tables_capability("P")

    def test_missing_token_denies(self):
        mod = _load_tickets(["tips"], user_roles=["Restaurant Manager"])
        with self.assertRaises(_PermissionError):
            mod.assert_tables_capability("P")

    def test_missing_profile_denies(self):
        mod = _load_tickets(["tables"], user_roles=[])
        with self.assertRaises(_PermissionError):
            mod.assert_tables_capability("")

    def test_second_entry_satisfies_when_first_role_absent(self):
        # Both an unqualified and a role-qualified tables entry: the
        # unqualified one grants regardless of role.
        mod = _load_tickets(["tables:Restaurant Manager", "tables"], ["Sales User"])
        mod.assert_tables_capability("P")  # no raise


if __name__ == "__main__":
    unittest.main()
