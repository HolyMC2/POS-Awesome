"""Exercise real child isolation and failure propagation, not mocked success."""
import contextlib
import importlib.util
import io
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("backend_runner", Path(__file__).with_name("run_backend_tests.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class BackendRunnerTests(unittest.TestCase):
    def run_quietly(self, directory):
        real_run = subprocess.run
        def capture(*args, **kwargs):
            return real_run(*args, **kwargs, capture_output=True, text=True)
        with contextlib.redirect_stdout(io.StringIO()), patch.object(runner.subprocess, "run", side_effect=capture):
            return runner.run_tests(directory)

    def test_framework_stubs_do_not_cross_test_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "test_a.py").write_text('import sys,types,unittest\nsys.modules["frappe"]=types.ModuleType("frappe")\nclass T(unittest.TestCase):\n def test_stub(self):self.assertIn("frappe",sys.modules)\n')
            (root / "test_b.py").write_text('import sys,unittest\nclass T(unittest.TestCase):\n def test_clean(self):self.assertNotIn("frappe",sys.modules)\n')
            self.assertEqual(self.run_quietly(root), 0)

    def test_failure_is_nonzero_and_later_files_still_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "test_a.py").write_text('import unittest\nclass T(unittest.TestCase):\n def test_fail(self):self.fail("intentional failure")\n')
            (root / "test_b.py").write_text('from pathlib import Path\nimport unittest\nclass T(unittest.TestCase):\n def test_later(self):Path(__file__).with_suffix(".ran").touch()\n')
            self.assertEqual(self.run_quietly(root), 1)
            self.assertTrue((root / "test_b.ran").is_file())

    def test_empty_discovery_refuses_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "No backend test files"):
                runner.run_tests(Path(temporary))

    def test_native_guards_only_skip_a_missing_framework(self):
        import builtins
        real_import = builtins.__import__
        paths = ["payment_processing/test_request_ledger.py", "payment_processing/test_source_reconciliation.py",
                 "test_money_exceptions.py", "test_pricing_context.py", "test_shift_terminal_native.py"]
        for path in paths:
            for missing, exception in (("frappe", unittest.SkipTest), ("broken_dependency", ModuleNotFoundError)):
                def import_module(name, *args, **kwargs):
                    if name == "frappe":
                        raise ModuleNotFoundError("fixture missing module", name=missing)
                    return real_import(name, *args, **kwargs)
                with self.subTest(path=path, missing=missing), patch("builtins.__import__", side_effect=import_module):
                    with self.assertRaises(exception):
                        runpy.run_path(str(runner.API_TESTS / path))


if __name__ == "__main__":
    unittest.main()
