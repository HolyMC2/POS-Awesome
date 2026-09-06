"""Read-only deployed candidate identity, including uncommitted application code."""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess
import urllib.parse
import urllib.request
import uuid


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def source_identity(root):
    root = pathlib.Path(root)
    if not (root / ".git").exists():
        # Image-baked ERPNext/Frappe intentionally omit .git. Fingerprint their
        # actual shipped tree rather than claiming an unavailable git revision.
        files = [(str(p.relative_to(root)), digest(p.read_bytes())) for p in sorted(root.rglob("*"))
            if p.is_file() and not {"__pycache__", "node_modules", ".git"}.intersection(p.relative_to(root).parts) and p.suffix not in (".pyc", ".pyo")]
        if not files:
            raise ValueError("Installed app tree is empty")
        tree = digest(files)
        return {"revision": "artifact:" + tree, "source_sha256": tree}
    def git(*args):
        # Host and container may have different global excludes or fsmonitor
        # hooks. Only repository ignores may define shipped source exclusions.
        return subprocess.run(["git", "-c", "core.excludesFile=/dev/null", "-c", "core.fsmonitor=false",
            "-C", str(root), *args], check=True, capture_output=True).stdout
    revision = git("rev-parse", "HEAD").decode().strip()
    # HEAD alone would certify a different candidate on this dirty workspace.
    changes = git("diff", "--binary", "HEAD", "--", ".")
    unknown = []
    for entry in sorted(git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0")):
        if entry:
            path = root / entry.decode()
            unknown.append((entry.decode(), digest(path.read_bytes()) if path.is_file() else "missing"))
    return {"revision": revision, "source_sha256": digest([revision, digest(changes), unknown])}


def _http_asset(url):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
    with urllib.request.urlopen(request, timeout=20) as response:
        expected, actual = urllib.parse.urlsplit(url), urllib.parse.urlsplit(response.geturl())
        if response.status != 200 or actual.scheme != "https" or actual.netloc != expected.netloc or actual.path != expected.path:
            raise ValueError("Public asset response changed origin/path or was not successful")
        return response.read()


def served_build_identity(build_root, served_root, site, fetch=None):
    """Tie app sources to materialized assets AND the site's public responses.

    Retained old hashed filenames support existing offline clients. They need
    not be deleted; every file in this candidate must match the served copy.
    """
    build_root, served_root = pathlib.Path(build_root), pathlib.Path(served_root)
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+\.lab\.xoloitzcuintles\.com", site):
        raise ValueError("Public asset verification is restricted to the named LAB tenant")
    fetch = fetch or _http_asset
    manifest_bytes = (build_root / "version.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    assets = []
    built_hashes = {}
    for path in sorted(build_root.rglob("*")):
        if not path.is_file():
            continue
        name = str(path.relative_to(build_root))
        built_hash = digest(path.read_bytes())
        target = served_root / name
        if not target.is_file() or digest(target.read_bytes()) != built_hash:
            raise ValueError("Built asset differs from materialized served asset: " + name)
        built_hashes[name] = built_hash
        assets.append((name, built_hash))
    if built_hashes.get("version.json") != digest(manifest_bytes):
        raise ValueError("Build changed during manifest capture")
    nonce = uuid.uuid4().hex
    base = "https://" + site
    prefix = "/assets/posawesome/dist/js/"
    if digest(fetch(base + prefix + "version.json?pos_certification=" + nonce)) != digest(manifest_bytes):
        raise ValueError("Public HTTP manifest differs from the built/materialized candidate")
    entry = manifest.get("assets", {}).get("web_entry")
    if not entry:
        raise ValueError("Candidate manifest does not identify its public web entry bundle")
    public_entries = {entry}
    if manifest.get("assets", {}).get("posawesome"):
        public_entries.add(manifest["assets"]["posawesome"])
    for entry in sorted(public_entries):
        parsed = urllib.parse.urlsplit(entry)
        decoded = urllib.parse.unquote(parsed.path)
        if parsed.scheme or parsed.netloc or parsed.fragment or not decoded.startswith(prefix):
            raise ValueError("Manifest entry must point to this site's POS asset directory")
        relative = decoded[len(prefix):]
        if relative not in built_hashes or ".." in pathlib.PurePosixPath(relative).parts:
            raise ValueError("Manifest entry is not part of the exact built candidate")
        separator = "&" if parsed.query else "?"
        if digest(fetch(base + entry + separator + "pos_certification=" + nonce)) != built_hashes[relative]:
            raise ValueError("Public HTTP entry bundle differs from the exact built candidate")
    return {"version": manifest.get("version") or manifest.get("buildId"),
        "manifest_sha256": digest(manifest_bytes), "assets_sha256": digest(assets)}


def probe(site, release_id):
    """Executed inside the existing bench, never mutates tenant data."""
    import os
    os.chdir("/home/frappe/frappe-bench/sites")
    import frappe
    frappe.init(site=site, sites_path=".")
    frappe.connect()
    try:
        apps = frappe.get_installed_apps()
        identities = {app: source_identity(pathlib.Path("../apps") / app) for app in sorted(apps)}
        versions = {app: str(getattr(__import__(app), "__version__", "unknown")) for app in sorted(apps)}
        build_root = pathlib.Path("../apps/posawesome/posawesome/public/dist/js")
        build = served_build_identity(build_root, pathlib.Path("assets/posawesome/dist/js"), site)
        db = frappe.conf.db_name
        columns = frappe.db.sql("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME,ORDINAL_POSITION", (db,))
        indexes = frappe.db.sql("SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX", (db,))
        metadata = {}
        for table in ("DocType", "DocField", "Custom Field", "Property Setter", "DocPerm", "Custom DocPerm", "Server Script", "Client Script", "Patch Log"):
            metadata[table] = frappe.db.sql(f"SELECT * FROM `tab{table}` ORDER BY name", as_dict=True)
        return {"release_id": release_id, "build": build,
            "apps": identities, "tenant": {"site": site, "database_sha256": digest([frappe.conf.db_host, db]), "installed_apps": versions, "schema_sha256": digest([columns, indexes, metadata])}}
    finally:
        frappe.db.rollback()
        frappe.destroy()


def capture(site, release_id, compose):
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+\.lab\.xoloitzcuintles\.com", site):
        raise ValueError("Only an explicitly named LAB tenant is accepted")
    code = pathlib.Path(__file__).read_text() + "\nprint('POS_CERT_IDENTITY=' + json.dumps(probe(" + repr(site) + "," + repr(release_id) + "),sort_keys=True))\n"
    command = ["docker", "compose", "-f", str(compose), "exec", "-T", "backend", "./env/bin/python", "-"]
    result = subprocess.run(command, input=code, text=True, capture_output=True, timeout=180)
    lines = [line[len("POS_CERT_IDENTITY="):] for line in result.stdout.splitlines() if line.startswith("POS_CERT_IDENTITY=")]
    if result.returncode or len(lines) != 1:
        raise ValueError("Deployed identity probe failed; candidate is unverified (private probe log required)")
    identity = json.loads(lines[0])
    validate_identity(identity)
    return identity


def validate_identity(identity):
    if not isinstance(identity, dict) or set(identity) != {"release_id", "build", "apps", "tenant"}:
        raise ValueError("Candidate identity fields are incomplete")
    if not isinstance(identity["release_id"], str) or not identity["release_id"].strip():
        raise ValueError("release_id is required")
    build, tenant, apps = identity["build"], identity["tenant"], identity["apps"]
    if set(build) != {"version", "manifest_sha256", "assets_sha256"} or not build["version"]:
        raise ValueError("Exact deployed build is required")
    if set(tenant) != {"site", "database_sha256", "installed_apps", "schema_sha256"} or not tenant["site"]:
        raise ValueError("Exact tenant and schema are required")
    if not {"frappe", "erpnext", "doco", "posawesome"}.issubset(apps) or set(apps) != set(tenant["installed_apps"]):
        raise ValueError("All installed apps and required POS apps must be identified")
    hashes = [build["manifest_sha256"], build["assets_sha256"], tenant["database_sha256"], tenant["schema_sha256"]]
    for app in apps.values():
        if set(app) != {"revision", "source_sha256"} or not re.fullmatch(r"(?:[0-9a-f]{40,64}|artifact:[0-9a-f]{64})", app["revision"]):
            raise ValueError("Every app needs an exact revision and dirty source fingerprint")
        hashes.append(app["source_sha256"])
    if any(not isinstance(h, str) or not re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes):
        raise ValueError("Invalid evidence SHA256 identity")
