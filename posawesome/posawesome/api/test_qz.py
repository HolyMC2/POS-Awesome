"""Unit tests for the QZ Tray installer-bundle endpoints in api/qz.py.

Same stub-frappe pattern as test_telemetry.py / test_web_route_default.py —
runs without bench so the suite stays green in CI containers with no Frappe
SDK. `frappe.get_site_path` is pointed at a throwaway temp dir per test, so
these exercise the real filesystem logic (manifest parse, basename choke
point, realpath containment) rather than a mock of it.

Focus: everything that decides whether a 103 MB archive leaves the server —
the role gate, the platform allowlist, and the two independent path-safety
layers. Plus the "no bundle deployed yet" path, which must answer
`{available: false}` instead of throwing (first-run sites are normal).
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import shutil
import sys
import tempfile
import types
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]

# @frappe.whitelist(...) kwargs per endpoint, recorded at import time so the
# HTTP-method contract is asserted instead of assumed.
WHITELIST_KWARGS: dict = {}
# Role lists handed to frappe.only_for(), newest last.
ONLY_FOR_CALLS: list = []


class _StubThrow(Exception):
    """What the stubbed frappe.throw raises.

    Carries the exception class frappe would have raised so a test can tell a
    404 (`DoesNotExistError`) from a plain validation error.
    """

    def __init__(self, message, exc=None):
        super().__init__(message)
        self.exc = exc


def _build_frappe_module() -> types.ModuleType:
    frappe_module = types.ModuleType("frappe")
    frappe_module._ = lambda text: text

    class _DoesNotExistError(Exception):
        http_status_code = 404

    frappe_module.DoesNotExistError = _DoesNotExistError
    frappe_module.PermissionError = type("PermissionError", (Exception,), {})

    def _throw(message, exc=None, title=None, **kw):
        raise _StubThrow(message, exc)

    frappe_module.throw = _throw

    def _whitelist(*a, **kw):
        def decorator(fn):
            WHITELIST_KWARGS[fn.__name__] = kw
            return fn

        return decorator

    frappe_module.whitelist = _whitelist

    def _only_for(roles):
        ONLY_FOR_CALLS.append(list(roles))
        if not (set(roles) & set(frappe_module.session.roles)):
            raise frappe_module.PermissionError("Not permitted")

    frappe_module.only_for = _only_for
    frappe_module.session = types.SimpleNamespace(
        user="cashier@doco", roles=["POS User"]
    )
    frappe_module.response = {}
    frappe_module.msgprint = lambda *a, **kw: None
    frappe_module.db = types.SimpleNamespace(get_default=lambda key: "Doco")

    # Rebound per test to a temp dir; the dict keeps the closure stable so
    # tests can move the site root without re-importing the module.
    site_root = {"path": ""}
    frappe_module.get_site_path = lambda *parts: os.path.join(
        site_root["path"], *parts
    )
    frappe_module.site_root = site_root

    def _cint(value=0, default=0):
        # Mirrors frappe.utils.cint: never raises, falls back to `default` for
        # anything non-numeric (a manifest is written by a shell script, so
        # "size": "big" has to degrade, not 500).
        if value is None:
            return default
        try:
            return int(value)
        except Exception:
            try:
                return int(float(value))
            except Exception:
                return default

    utils = types.ModuleType("frappe.utils")
    utils.cint = _cint
    frappe_module.utils = utils

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = utils
    return frappe_module


def _import_qz():
    _build_frappe_module()
    sys.modules.pop("posawesome.posawesome.api.qz", None)
    spec = importlib.util.spec_from_file_location(
        "posawesome_qz_under_test",
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "qz.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


# Standalone stub harness: this file fakes `frappe` in sys.modules, which would
# poison a real bench process for every test imported after it. Must be
# evaluated BEFORE _import_qz() swaps in the stub, and the import must be
# skipped entirely under bench. Run directly: python3 <this file>.
_UNDER_BENCH = callable(getattr(sys.modules.get("frappe"), "init", None))

# The tests reach the stub through `qz.frappe` (a module-attribute binding
# made when qz.py was exec'd), so nothing needs the fake left in sys.modules
# after the import — and leaving it there poisons every sibling module that
# `unittest discover` imports after this file (the thin frappe.utils lacks
# names the real modules import). Restore sys.modules immediately.
_PRE_STUB_MODULES = sys.modules.copy()
qz = None if _UNDER_BENCH else _import_qz()
for _name in [k for k in sys.modules if k not in _PRE_STUB_MODULES]:
    del sys.modules[_name]
for _name, _module in _PRE_STUB_MODULES.items():
    if sys.modules.get(_name) is not _module:
        sys.modules[_name] = _module
del _PRE_STUB_MODULES

_WIN_ARCHIVE = "qz-tray-doco.zip"
_LINUX_ARCHIVE = "qz-tray-doco-linux.tar.gz"


def _manifest(**overrides) -> dict:
    data = {
        "qz_version": "2.2.5",
        "built_at": "2026-07-29T18:00:00Z",
        "cert_fingerprint": "AB:CD:EF:01",
        "platforms": {
            "win": {"filename": _WIN_ARCHIVE, "size": 108003021, "sha256": "a" * 64},
            "linux": {
                "filename": _LINUX_ARCHIVE,
                "size": 128004096,
                "sha256": "b" * 64,
            },
        },
    }
    data.update(overrides)
    return data


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class _BundleCase(unittest.TestCase):
    """Shared temp-site scaffolding for both bundle endpoints."""

    def setUp(self):
        self.site = tempfile.mkdtemp(prefix="posa-qz-site-")
        self.addCleanup(shutil.rmtree, self.site, ignore_errors=True)
        qz.frappe.site_root["path"] = self.site
        qz.frappe.session.roles = ["POS User"]
        qz.frappe.response.clear()
        ONLY_FOR_CALLS.clear()
        self.qz_dir = os.path.join(self.site, "private", "qz")
        self.bundle_dir = os.path.join(self.qz_dir, "bundle")

    def _write_manifest(self, manifest) -> str:
        os.makedirs(self.bundle_dir, exist_ok=True)
        path = os.path.join(self.bundle_dir, "manifest.json")
        body = manifest if isinstance(manifest, str) else json.dumps(manifest)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(body)
        return path

    def _write_archive(self, filename, body=b"PK\x03\x04stub-archive") -> str:
        os.makedirs(self.bundle_dir, exist_ok=True)
        path = os.path.join(self.bundle_dir, filename)
        with open(path, "wb") as handle:
            handle.write(body)
        return path

    def _write_both_archives(self):
        self._write_archive(_WIN_ARCHIVE)
        self._write_archive(_LINUX_ARCHIVE, body=b"\x1f\x8bstub-tarball")


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class BundleInfoTests(_BundleCase):
    """get_qz_bundle_info: absent-manifest tolerance + manifest normalisation."""

    def test_no_bundle_dir_reports_unavailable_without_throwing(self):
        # The first-run state on every site. Must not raise.
        self.assertEqual(qz.get_qz_bundle_info(), {"available": False})

    def test_manifest_missing_but_archives_present_is_unavailable(self):
        self._write_both_archives()
        self.assertEqual(qz.get_qz_bundle_info(), {"available": False})

    def test_malformed_manifest_is_unavailable_not_an_error(self):
        self._write_manifest("{not valid json")
        self.assertEqual(qz.get_qz_bundle_info(), {"available": False})

    def test_non_object_manifest_is_unavailable(self):
        self._write_manifest(json.dumps(["qz", 2]))
        self.assertEqual(qz.get_qz_bundle_info(), {"available": False})

    def test_full_manifest_reports_both_platforms(self):
        self._write_manifest(_manifest())
        self._write_both_archives()

        info = qz.get_qz_bundle_info()

        self.assertTrue(info["available"])
        self.assertEqual(info["qz_version"], "2.2.5")
        self.assertEqual(info["built_at"], "2026-07-29T18:00:00Z")
        self.assertEqual(info["cert_fingerprint"], "AB:CD:EF:01")
        self.assertEqual(sorted(info["platforms"]), ["linux", "win"])
        win = info["platforms"]["win"]
        self.assertEqual(win["filename"], _WIN_ARCHIVE)
        self.assertEqual(win["size"], 108003021)
        self.assertEqual(win["sha256"], "a" * 64)
        self.assertTrue(win["present"])

    def test_available_false_when_manifest_lists_files_that_are_not_there(self):
        # Half-finished deploy: manifest copied, archives not. The version
        # metadata still answers, but nothing is offered for download.
        self._write_manifest(_manifest())

        info = qz.get_qz_bundle_info()

        self.assertFalse(info["available"])
        self.assertEqual(info["qz_version"], "2.2.5")
        self.assertFalse(info["platforms"]["win"]["present"])
        self.assertFalse(info["platforms"]["linux"]["present"])

    def test_one_platform_present_is_enough_for_available(self):
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE)

        info = qz.get_qz_bundle_info()

        self.assertTrue(info["available"])
        self.assertTrue(info["platforms"]["win"]["present"])
        self.assertFalse(info["platforms"]["linux"]["present"])

    def test_unknown_platform_keys_ignored(self):
        self._write_manifest(
            _manifest(
                platforms={
                    "mac": {"filename": "qz-tray-doco.pkg", "size": 1, "sha256": ""},
                    "win": {"filename": _WIN_ARCHIVE, "size": 1, "sha256": ""},
                }
            )
        )
        self._write_archive(_WIN_ARCHIVE)

        self.assertEqual(list(qz.get_qz_bundle_info()["platforms"]), ["win"])

    def test_missing_or_garbage_platforms_map_degrades_to_empty(self):
        for platforms in (None, "win", [], {"win": "qz.zip"}, {"win": {}}):
            self._write_manifest(_manifest(platforms=platforms))
            info = qz.get_qz_bundle_info()
            self.assertEqual(info["platforms"], {}, platforms)
            self.assertFalse(info["available"], platforms)

    def test_traversal_filename_is_reduced_to_basename(self):
        # A crafted manifest must not be able to name a file outside the
        # bundle dir; the basename choke point is what stops it.
        self._write_manifest(
            _manifest(
                platforms={
                    "win": {
                        "filename": "../../site_config.json",
                        "size": 1,
                        "sha256": "",
                    }
                }
            )
        )

        info = qz.get_qz_bundle_info()

        self.assertEqual(info["platforms"]["win"]["filename"], "site_config.json")
        self.assertFalse(info["platforms"]["win"]["present"])

    def test_dot_and_empty_filenames_dropped(self):
        for bad in ("", "   ", ".", "..", ".hidden"):
            self._write_manifest(
                _manifest(platforms={"win": {"filename": bad, "size": 1}})
            )
            self.assertEqual(qz.get_qz_bundle_info()["platforms"], {}, bad)

    def test_non_numeric_size_degrades_to_zero(self):
        self._write_manifest(
            _manifest(platforms={"win": {"filename": _WIN_ARCHIVE, "size": "big"}})
        )
        self._write_archive(_WIN_ARCHIVE)

        self.assertEqual(qz.get_qz_bundle_info()["platforms"]["win"]["size"], 0)

    def test_role_gate_is_the_sign_message_allowlist(self):
        self._write_manifest(_manifest())
        qz.get_qz_bundle_info()

        self.assertEqual(ONLY_FOR_CALLS[-1], list(qz._QZ_SIGN_ROLES))

    def test_role_gate_blocks_a_user_without_pos_roles(self):
        qz.frappe.session.roles = ["Employee"]
        with self.assertRaises(qz.frappe.PermissionError):
            qz.get_qz_bundle_info()

    def test_whitelisted_for_get_and_post(self):
        self.assertEqual(
            WHITELIST_KWARGS["get_qz_bundle_info"]["methods"], ["GET", "POST"]
        )


@unittest.skipIf(_UNDER_BENCH, "standalone stub test - run with python3 directly")
class BundleDownloadTests(_BundleCase):
    """download_qz_bundle: platform allowlist, path containment, 404 shape."""

    def test_streams_the_manifest_named_archive(self):
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE, body=b"PK\x03\x04payload")

        qz.download_qz_bundle("win")

        self.assertEqual(qz.frappe.response["filename"], _WIN_ARCHIVE)
        self.assertEqual(qz.frappe.response["filecontent"], b"PK\x03\x04payload")
        self.assertEqual(qz.frappe.response["type"], "binary")

    def test_linux_platform_streams_the_tarball(self):
        self._write_manifest(_manifest())
        self._write_both_archives()

        qz.download_qz_bundle("linux")

        self.assertEqual(qz.frappe.response["filename"], _LINUX_ARCHIVE)
        self.assertEqual(qz.frappe.response["filecontent"], b"\x1f\x8bstub-tarball")

    def test_platform_is_case_and_whitespace_tolerant(self):
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE)

        qz.download_qz_bundle(" WIN ")

        self.assertEqual(qz.frappe.response["filename"], _WIN_ARCHIVE)

    def test_unknown_platform_refused_before_touching_disk(self):
        self._write_manifest(_manifest())
        self._write_both_archives()

        for platform in ("mac", "", None, "win32", "../../site_config.json", "*"):
            qz.frappe.response.clear()
            with self.assertRaises(_StubThrow, msg=platform) as caught:
                qz.download_qz_bundle(platform)
            # A rejected platform is a bad request, not a missing file.
            self.assertIsNone(caught.exception.exc, platform)
            self.assertEqual(qz.frappe.response, {}, platform)

    def test_no_manifest_is_a_404(self):
        self._write_both_archives()  # archives without a manifest

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("win")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)
        self.assertEqual(qz.frappe.response, {})

    def test_platform_absent_from_manifest_is_a_404(self):
        self._write_manifest(
            _manifest(platforms={"win": {"filename": _WIN_ARCHIVE, "size": 1}})
        )
        self._write_archive(_WIN_ARCHIVE)

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("linux")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)

    def test_manifest_without_the_file_on_disk_is_a_404(self):
        self._write_manifest(_manifest())

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("win")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)
        self.assertEqual(qz.frappe.response, {})

    def test_manifest_traversal_filename_cannot_read_outside_the_bundle_dir(self):
        # The private key lives one level up; a manifest that names it must get
        # a 404 for "bundle/private-key.pem", never the real file.
        secret = os.path.join(self.qz_dir, "private-key.pem")
        os.makedirs(self.qz_dir, exist_ok=True)
        with open(secret, "wb") as handle:
            handle.write(b"-----BEGIN PRIVATE KEY-----")
        self._write_manifest(
            _manifest(
                platforms={"win": {"filename": "../private-key.pem", "size": 1}}
            )
        )

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("win")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)
        self.assertEqual(qz.frappe.response, {})

    def test_symlink_out_of_the_bundle_dir_is_refused(self):
        # Second safety layer: basename alone can't stop a symlink planted
        # inside the bundle dir, so the realpath containment check must.
        outside = os.path.join(self.site, "site_config.json")
        with open(outside, "wb") as handle:
            handle.write(b'{"db_password": "hunter2"}')
        os.makedirs(self.bundle_dir, exist_ok=True)
        link = os.path.join(self.bundle_dir, _WIN_ARCHIVE)
        try:
            os.symlink(outside, link)
        except (OSError, NotImplementedError):  # pragma: no cover - platform
            self.skipTest("symlinks unavailable on this platform")
        self._write_manifest(_manifest())

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("win")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)
        self.assertEqual(qz.frappe.response, {})

    def test_directory_named_as_the_archive_is_refused(self):
        os.makedirs(os.path.join(self.bundle_dir, _WIN_ARCHIVE), exist_ok=True)
        self._write_manifest(_manifest())

        with self.assertRaises(_StubThrow) as caught:
            qz.download_qz_bundle("win")

        self.assertIs(caught.exception.exc, qz.frappe.DoesNotExistError)

    def test_role_gate_is_the_sign_message_allowlist(self):
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE)

        qz.download_qz_bundle("win")

        self.assertEqual(ONLY_FOR_CALLS[-1], list(qz._QZ_SIGN_ROLES))

    def test_role_gate_blocks_a_user_without_pos_roles(self):
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE)
        qz.frappe.session.roles = ["Employee"]

        with self.assertRaises(qz.frappe.PermissionError):
            qz.download_qz_bundle("win")

        self.assertEqual(qz.frappe.response, {})

    def test_sales_user_is_allowed(self):
        # Real-world POSAwesome operators often only carry Sales User; the
        # allowlist comment in qz.py exists because tightening this broke
        # signing. The install path must not re-introduce that gap.
        self._write_manifest(_manifest())
        self._write_archive(_WIN_ARCHIVE)
        qz.frappe.session.roles = ["Sales User"]

        qz.download_qz_bundle("win")

        self.assertEqual(qz.frappe.response["filename"], _WIN_ARCHIVE)

    def test_whitelisted_for_get_only(self):
        # The client fetches this with a plain browser navigation.
        self.assertEqual(WHITELIST_KWARGS["download_qz_bundle"]["methods"], ["GET"])


if __name__ == "__main__":
    unittest.main()
