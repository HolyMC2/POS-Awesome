"""Standalone activation guards: unsafe profiles fail before the first shift."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


class TestCustodyConfiguration(unittest.TestCase):
    def setUp(self):
        self.frappe = types.ModuleType('frappe')
        self.frappe._ = lambda value: value
        self.frappe.db = types.SimpleNamespace(get_value=Mock(return_value='Drawer'))
        self.frappe.throw = Mock(side_effect=lambda message: self.refuse(message))
        document = types.ModuleType('frappe.model.document')
        document.Document = object
        package = types.ModuleType('_custody_config_test')
        package.__path__ = [str(Path(__file__).parent)]
        model = types.ModuleType('_custody_config_test.model')
        model.minor = Mock()
        with patch.dict(sys.modules, {'frappe': self.frappe,
                'frappe.model.document': document, '_custody_config_test': package,
                '_custody_config_test.model': model}):
            spec = importlib.util.spec_from_file_location('_custody_config_test.documents',
                Path(__file__).with_name('documents.py'))
            self.module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.module)
        self.profile = dict(posa_enable_cash_movement=1, posa_allow_cash_deposit=1,
            posa_cash_movement_max_amount=0, posa_cash_mode_of_payment='Cash')

    @staticmethod
    def refuse(message):
        raise ValueError(message)

    def validate(self):
        self.module.validate_custody_routing(self.profile, 'Company', 'Drawer')

    def test_accepts_enabled_uncapped_matching_drawer(self):
        self.validate()
        self.frappe.db.get_value.assert_called_once_with('Mode of Payment Account',
            {'parent': 'Cash', 'company': 'Company'}, 'default_account')

    def test_rejects_disabled_movement_features(self):
        for field in ('posa_enable_cash_movement', 'posa_allow_cash_deposit'):
            with self.subTest(field=field), patch.dict(self.profile, {field: 0}):
                with self.assertRaisesRegex(ValueError, 'Enable cash movements and cash deposits'):
                    self.validate()

    def test_rejects_caps_that_can_block_closing(self):
        self.profile['posa_cash_movement_max_amount'] = 5000
        with self.assertRaisesRegex(ValueError, 'complete drawer count'):
            self.validate()

    def test_rejects_different_or_missing_payment_account(self):
        for account in ('Other drawer', None):
            self.frappe.db.get_value.return_value = account
            with self.subTest(account=account), self.assertRaisesRegex(ValueError, 'must match'):
                self.validate()


if __name__ == '__main__':
    unittest.main()
