"""Standalone tests for the repair-preset dock migration.

Run directly with ``python3 test_move_repair_preset_floor_tab_to_service_order.py``.
Follows the harness in ``api/test_charge_requests_scope.py``: ``frappe`` is
stubbed and the module is loaded by path, so this exercises the patch's DECISION
without a bench site and cannot poison the integration suite's real ``frappe``.

Worth testing without a site precisely because this patch REWRITES tenant
configuration. Its match is a rule rather than a preset name, and the whole
safety of that rule is "a preset showing a tab it cannot open" — so the cases
that matter are the ones it must leave alone.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

MODULE_NAME = "posawesome_patch_move_repair_preset"
MODULE_PATH = pathlib.Path(__file__).resolve().with_name(
    "move_repair_preset_floor_tab_to_service_order.py"
)


class _FakeDB:
    def __init__(self, presets):
        self.presets = presets
        self.writes = []
        self.profile_table_exists = True

    def table_exists(self, doctype):
        if doctype != "POS Capability Profile":
            raise AssertionError(f"Unexpected table: {doctype}")
        return self.profile_table_exists

    def get_value(self, doctype, name, field):
        return self.presets[name].get(field)

    def set_value(self, doctype, name, field, value):
        self.presets[name][field] = value
        self.writes.append((name, field, value))


class _FakeFrappe(types.SimpleNamespace):
    def __init__(self, presets):
        super().__init__()
        self.db = _FakeDB(presets)

    def get_all(self, doctype, pluck=None):
        if not self.db.table_exists(doctype):
            raise AssertionError("Cannot query a missing profile table")
        return list(self.db.presets.keys())

    def logger(self):
        return types.SimpleNamespace(info=lambda *_a, **_k: None)


def _load(presets):
    """Load the patch against a stubbed frappe and a stubbed doctype module."""
    fake = _FakeFrappe(presets)

    doctype_pkg = "posawesome.posawesome.doctype.pos_capability_profile.pos_capability_profile"
    stub = types.ModuleType(doctype_pkg)
    stub._split_csv = lambda value: [
        part.strip() for part in (value or "").split(",") if part.strip()
    ]

    saved = {k: sys.modules.get(k) for k in ("frappe", doctype_pkg)}
    sys.modules["frappe"] = fake
    sys.modules[doctype_pkg] = stub
    # The intermediate packages must exist for the dotted import to resolve.
    for parent in (
        "posawesome",
        "posawesome.posawesome",
        "posawesome.posawesome.doctype",
        "posawesome.posawesome.doctype.pos_capability_profile",
    ):
        saved.setdefault(parent, sys.modules.get(parent))
        sys.modules.setdefault(parent, types.ModuleType(parent))
    try:
        spec = importlib.util.spec_from_file_location(MODULE_NAME, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module, fake
    finally:
        for key, value in saved.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value


def _tabs(fake, name):
    return fake.db.presets[name]["dock_tabs"]


class RepairPresetDockMigrationTests(unittest.TestCase):
    def test_repair_preset_trades_floor_for_service_order_in_place(self):
        presets = {
            "reparacion-mostrador": {
                "dock_tabs": "browse, cart, floor, pay",
                "capabilities": "external_document_checkout",
            }
        }
        module, fake = _load(presets)
        module.execute()
        # In place, not appended: the CSV order IS the dock order, and moving
        # the tab to the end rearranges a dock under someone's thumbs.
        self.assertEqual(_tabs(fake, "reparacion-mostrador"), "browse, cart, serviceOrder, pay")

    def test_a_real_floor_is_left_alone(self):
        presets = {
            "restaurante-mesas": {
                "dock_tabs": "browse, cart, floor, pay",
                "capabilities": "tables, tips",
            }
        }
        module, fake = _load(presets)
        module.execute()
        self.assertEqual(_tabs(fake, "restaurante-mesas"), "browse, cart, floor, pay")
        self.assertEqual(fake.db.writes, [])

    def test_capability_with_a_role_suffix_still_counts_as_tables(self):
        # `KNOWN_CAPABILITIES` allows an `entry:Role` form; matching the raw
        # string would miss it and strip a genuine floor.
        presets = {
            "mesas-supervisor": {
                "dock_tabs": "browse, floor",
                "capabilities": "tables:Restaurant Manager",
            }
        }
        module, fake = _load(presets)
        module.execute()
        self.assertEqual(_tabs(fake, "mesas-supervisor"), "browse, floor")

    def test_retail_preset_without_floor_is_untouched(self):
        presets = {"retail": {"dock_tabs": "browse, offers, cart, pay", "capabilities": ""}}
        module, fake = _load(presets)
        module.execute()
        self.assertEqual(fake.db.writes, [])

    def test_blank_dock_tabs_is_a_no_op(self):
        # A preset that names no tabs falls back to DEFAULT_DOCK_TABS at
        # payload time; writing an explicit list here would pin it forever.
        presets = {"sparse": {"dock_tabs": None, "capabilities": None}}
        module, fake = _load(presets)
        module.execute()
        self.assertEqual(fake.db.writes, [])

    def test_no_presets_at_all_does_not_raise(self):
        module, fake = _load({})
        module.execute()
        self.assertEqual(fake.db.writes, [])

    def test_missing_profile_table_is_skipped_before_model_sync(self):
        module, fake = _load({})
        fake.db.profile_table_exists = False
        module.execute()
        self.assertEqual(fake.db.writes, [])

    def test_is_idempotent(self):
        presets = {
            "reparacion": {"dock_tabs": "browse, floor", "capabilities": ""}
        }
        module, fake = _load(presets)
        module.execute()
        first = _tabs(fake, "reparacion")
        module.execute()
        self.assertEqual(_tabs(fake, "reparacion"), first)
        self.assertEqual(len(fake.db.writes), 1)

    def test_a_preset_carrying_both_does_not_end_up_with_a_duplicate(self):
        presets = {
            "half-migrated": {
                "dock_tabs": "browse, floor, serviceOrder",
                "capabilities": "",
            }
        }
        module, fake = _load(presets)
        module.execute()
        self.assertEqual(_tabs(fake, "half-migrated"), "browse, serviceOrder")


if __name__ == "__main__":
    unittest.main()
