import importlib.util
import pathlib
import sys
import types


REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


def install_offline_sync_package_stubs():
    for package_name in (
        "posawesome",
        "posawesome.posawesome",
        "posawesome.posawesome.api",
        "posawesome.posawesome.api.offline_sync",
    ):
        package = types.ModuleType(package_name)
        package.__path__ = []
        sys.modules[package_name] = package

    # `_resolve_profile` now asserts the session user owns the requested
    # profile via api._scope.assert_profile. The existing standalone suites
    # exercise the delta/pagination logic, not authorization, so install a
    # permissive stub here to keep them scope-agnostic. The dedicated
    # test_offline_sync_scope suite installs its OWN strict stub.
    scope_module = types.ModuleType("posawesome.posawesome.api._scope")
    scope_module.assert_profile = lambda user, name: None
    scope_module.assert_company = lambda user, company: None
    sys.modules["posawesome.posawesome.api._scope"] = scope_module


def load_offline_sync_common():
    spec = importlib.util.spec_from_file_location(
        "posawesome.posawesome.api.offline_sync.common",
        REPO_ROOT / "posawesome" / "posawesome" / "api" / "offline_sync" / "common.py",
    )
    if spec is None:
        raise ImportError("Unable to load posawesome.posawesome.api.offline_sync.common")
    if spec.loader is None:
        raise ImportError("Missing loader for posawesome.posawesome.api.offline_sync.common")
    module = importlib.util.module_from_spec(spec)
    sys.modules["posawesome.posawesome.api.offline_sync.common"] = module
    spec.loader.exec_module(module)
    return module
