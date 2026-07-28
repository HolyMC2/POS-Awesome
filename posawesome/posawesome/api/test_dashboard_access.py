import inspect
import unittest
from unittest.mock import MagicMock, patch

# Importing the real api package pulls frappe transitively (api/__init__).
# Skip the module when discovered by the standalone stub-suite runner
# (python3 -m unittest discover), where frappe is not importable; under
# bench the import succeeds and the tests run with mock.patch as usual.
try:
    from posawesome.posawesome.api import dashboard, telemetry
except ImportError:
    raise unittest.SkipTest("bench-only test module - requires frappe") from None


class PermissionDenied(Exception):
    pass


def _patch_session(mock_frappe, user, roles, legacy_flag=0):
    mock_frappe.session.user = user
    mock_frappe.get_roles.return_value = list(roles)
    user_doc = MagicMock()
    user_doc.name = user
    user_doc.posa_is_pos_supervisor = legacy_flag
    mock_frappe.get_cached_doc.return_value = user_doc
    mock_frappe.PermissionError = PermissionDenied
    mock_frappe.throw.side_effect = PermissionDenied("denied")
    return user_doc


class TestDashboardAccessGate(unittest.TestCase):
    """The dashboard is operator-level data; the SPA hiding it is not authz.
    Every endpoint funnels through _assert_dashboard_access."""

    @patch("posawesome.posawesome.api.dashboard.frappe")
    def test_plain_cashier_is_denied(self, mock_frappe):
        with patch("posawesome.posawesome.api.employees.frappe", mock_frappe):
            _patch_session(mock_frappe, "cajero@x.mx", ["POS User", "Sales User"])
            with self.assertRaises(PermissionDenied):
                dashboard._assert_dashboard_access()

    @patch("posawesome.posawesome.api.dashboard.frappe")
    def test_pos_awesome_supervisor_role_is_allowed(self, mock_frappe):
        _patch_session(mock_frappe, "dueno@x.mx", ["POS User", "POS Awesome Supervisor"])
        dashboard._assert_dashboard_access()
        mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.api.dashboard.frappe")
    def test_manager_roles_are_allowed(self, mock_frappe):
        for role in ("System Manager", "POS Manager", "Sales Manager"):
            mock_frappe.reset_mock()
            _patch_session(mock_frappe, "mgr@x.mx", [role])
            dashboard._assert_dashboard_access()
            mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.api.dashboard.frappe")
    def test_legacy_supervisor_field_still_grants_access(self, mock_frappe):
        with patch("posawesome.posawesome.api.employees.frappe", mock_frappe):
            _patch_session(mock_frappe, "old@x.mx", ["POS User"], legacy_flag=1)
            # employees._is_pos_supervisor reads roles via employees.frappe and
            # falls back to the legacy per-user flag set before the role era.
            mock_frappe.get_roles.return_value = ["POS User"]
            dashboard._assert_dashboard_access()
            mock_frappe.throw.assert_not_called()

    @patch("posawesome.posawesome.api.dashboard.frappe")
    def test_access_probe_returns_flag_instead_of_throwing(self, mock_frappe):
        with patch("posawesome.posawesome.api.employees.frappe", mock_frappe):
            _patch_session(mock_frappe, "cajero@x.mx", ["POS User"])
            self.assertEqual(dashboard.get_dashboard_access(), {"allowed": False})
            _patch_session(mock_frappe, "dueno@x.mx", ["POS Awesome Supervisor"])
            self.assertEqual(dashboard.get_dashboard_access(), {"allowed": True})


class TestStrayKwargsTolerance(unittest.TestCase):
    """frappe's HTTP layer forwards cmd + client correlation ids (request_id,
    injected by the SPA api layer on EVERY call) into **kwargs handlers; the
    shared context resolver must swallow them. This exact gap TypeError'd all
    per-section endpoints in prod (2026-07)."""

    def test_resolver_accepts_unknown_kwargs(self):
        params = inspect.signature(dashboard._resolve_dashboard_context).parameters
        self.assertTrue(
            any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()),
            "_resolve_dashboard_context must tolerate stray HTTP params (cmd, request_id)",
        )

    def test_access_probe_accepts_unknown_kwargs(self):
        params = inspect.signature(dashboard.get_dashboard_access).parameters
        self.assertTrue(any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()))


class TestTelemetryRoleGate(unittest.TestCase):
    @patch("posawesome.posawesome.api.telemetry.frappe")
    def test_supervisor_can_read_summary(self, mock_frappe):
        mock_frappe.session.user = "dueno@x.mx"
        mock_frappe.get_roles.return_value = ["POS Awesome Supervisor"]
        mock_frappe.throw.side_effect = PermissionDenied("denied")
        mock_frappe.get_all.return_value = []
        result = telemetry.get_pos_telemetry_summary()
        mock_frappe.throw.assert_not_called()
        self.assertIn("window", result)

    @patch("posawesome.posawesome.api.telemetry.frappe")
    def test_plain_cashier_still_denied(self, mock_frappe):
        mock_frappe.session.user = "cajero@x.mx"
        mock_frappe.get_roles.return_value = ["POS User"]
        mock_frappe.throw.side_effect = PermissionDenied("denied")
        with self.assertRaises(PermissionDenied):
            telemetry.get_pos_telemetry_summary()


if __name__ == "__main__":
    unittest.main()
