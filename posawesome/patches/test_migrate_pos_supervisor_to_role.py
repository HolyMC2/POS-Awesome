"""Standalone regression checks for the repeatable supervisor-role migration."""

import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch


def load_patch(frappe):
    path = pathlib.Path(__file__).with_name("migrate_pos_supervisor_to_role.py")
    spec = importlib.util.spec_from_file_location("supervisor_migration_test_subject", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"frappe": frappe}):
        spec.loader.exec_module(module)
    return module


class SupervisorMigrationTests(unittest.TestCase):
    def setUp(self):
        self.field_exists = True
        self.has_role = False
        self.user = Mock()
        self.user.save.side_effect = lambda **kwargs: setattr(self, "has_role", True)
        self.frappe = types.ModuleType("frappe")
        self.frappe.db = Mock()
        # Frappe retains this column after deleting the Custom Field.
        self.frappe.db.has_column.return_value = True
        self.frappe.db.exists.side_effect = self.exists
        self.frappe.get_all = Mock(side_effect=self.get_users)
        self.frappe.get_doc = Mock(return_value=self.user)
        self.frappe.delete_doc = Mock(
            side_effect=lambda *args, **kwargs: setattr(self, "field_exists", False)
        )
        self.frappe.clear_cache = Mock()
        self.subject = load_patch(self.frappe)

    def exists(self, doctype, name):
        if doctype == "Role":
            return True
        if doctype == "Custom Field":
            self.assertEqual(name, "User-posa_is_pos_supervisor")
            return self.field_exists
        if doctype == "Has Role":
            return self.has_role
        self.fail(f"Unexpected doctype: {doctype}")

    def get_users(self, doctype, **kwargs):
        if not self.field_exists:
            raise ValueError("Legacy supervisor filter is absent from User metadata")
        self.assertEqual(doctype, "User")
        self.assertEqual(kwargs["filters"], {"posa_is_pos_supervisor": 1})
        return ["cashier@example.test"]

    def test_second_migrate_skips_removed_field_despite_retained_column(self):
        self.subject.execute()
        self.subject.execute()
        self.user.append.assert_called_once_with("roles", {"role": "POS Awesome Supervisor"})
        self.frappe.get_all.assert_called_once()
        self.frappe.delete_doc.assert_called_once()
        self.frappe.clear_cache.assert_called_once_with(doctype="User")

    def test_already_migrated_site_never_queries_legacy_filter(self):
        self.field_exists = False
        self.subject.execute()
        self.frappe.get_all.assert_not_called()
        self.frappe.delete_doc.assert_not_called()

    def test_existing_role_is_not_assigned_twice(self):
        self.has_role = True
        self.subject.execute()
        self.user.append.assert_not_called()
        self.frappe.delete_doc.assert_called_once()


if __name__ == "__main__":
    unittest.main()
