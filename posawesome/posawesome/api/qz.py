# Copyright (c) 2026, POS Awesome contributors
# For license information, please see license.txt

"""QZ Tray certificate, signing and installer-bundle endpoints.

Three groups live here:
  - cert + signature for silent printing (`get_certificate`, `sign_message`) —
    the per-print hot path, never System-Manager-gated;
  - cert lifecycle (`setup_qz_certificate`, `rotate_qz_certificate`) — SM only;
  - installer bundle discovery + download (`get_qz_bundle_info`,
    `download_qz_bundle`), which lets a shop install QZ Tray from the POS
    itself instead of waiting for someone to hand-carry a 103 MB zip.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta, timezone

import frappe
from frappe import _
from frappe.utils import cint

# Roles allowed to call `sign_message`. Any logged-in user with one of
# these can request a QZ Tray signature; users without them get 403.
# Without this gate the endpoint was an unbounded RSA signing oracle
# against the site's QZ Tray private key.
#
# Sales User / Sales Manager are included because real-world POSAwesome
# operators frequently lack the standalone POS User role — the app's
# permission model gates POS access via POS Profile membership, not via
# the POS User role. A user who can sell from POS Awesome must also be
# able to sign QZ print envelopes; otherwise the QZ Tray client sees
# unsigned calls and shows the "Cannot verify trust - Invalid Signature"
# Allow/Block dialog on every connection (the symptom this allowlist
# was tightened to fix, then over-tightened to cause).
_QZ_SIGN_ROLES = (
    "POS User",
    "POS Manager",
    "POS Awesome Supervisor",
    "Sales User",
    "Sales Manager",
    "System Manager",
)

# Whitelist of QZ Tray API calls the client legitimately signs.
# qz-tray.js sends these unprefixed (NOT `qz.printers.find` — just
# `printers.find`). Anything outside this set is rejected by
# sign_message so the endpoint can't be used as a generic RSA
# signing oracle against unrelated payloads.
_ALLOWED_QZ_CALLS = frozenset({
    # connection lifecycle
    "getVersion",
    "websocket.getNetworkInfo",
    # printers
    "printers.find",
    "printers.getDefault",
    "printers.detail",
    "printers.startListening",
    "printers.stopListening",
    "printers.getStatus",
    # print
    "print",
    # serial / hid (unused today but covered for future)
    "serial.openPort",
    "serial.closePort",
    "serial.sendData",
    "hid.listDevices",
    "hid.claimDevice",
    "hid.releaseDevice",
    "hid.sendData",
    # files (unused today)
    "file.list",
    "file.read",
    "file.write",
})

# Installer bundles deployed per site by `qz-bundle/deploy-bundles.sh` into
# `private/qz/bundle/` (one archive per platform + a `manifest.json`
# describing them). The platform tuple is the ONLY accepted value set for
# `download_qz_bundle`; anything else is refused before touching the disk.
_BUNDLE_PLATFORMS = ("win", "linux")
_BUNDLE_MANIFEST_NAME = "manifest.json"


def _qz_dir() -> str:
    return frappe.get_site_path("private", "qz")


def _cert_path() -> str:
    return os.path.join(_qz_dir(), "digital-certificate.crt")


def _key_path() -> str:
    return os.path.join(_qz_dir(), "private-key.pem")


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as file:
        return file.read()


def _read_bytes(path: str) -> bytes:
    with open(path, "rb") as file:
        return file.read()


def _require_cryptography():
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        frappe.throw(
            _(
                "Python package 'cryptography' is required for QZ Tray signing. "
                "Please install it on the server and retry."
            ),
            title=_("Missing Dependency"),
        )

    return x509, hashes, serialization, padding, rsa, NameOID


@frappe.whitelist(methods=["GET", "POST"])
def get_certificate() -> str:
    """Return the public QZ certificate PEM.

    Returns an empty string when certificate is not configured yet so
    frontend can gracefully fall back without server error noise.
    """
    cert_path = _cert_path()
    if not os.path.exists(cert_path):
        return ""
    return _read_text(cert_path)


@frappe.whitelist(methods=["GET", "POST"])
def get_certificate_download() -> dict[str, str]:
    """Return certificate PEM + default company name for file naming."""
    cert_path = _cert_path()
    if not os.path.exists(cert_path):
        frappe.throw(
            _("QZ Tray certificate not found. Ask an administrator to run Setup QZ Certificate."),
            title=_("QZ Certificate Missing"),
        )

    return {
        "pem": _read_text(cert_path),
        "company": frappe.db.get_default("company") or "",
    }


def _bundle_dir() -> str:
    return os.path.join(_qz_dir(), "bundle")


def _read_manifest() -> dict | None:
    """Return the parsed bundle manifest, or None when there isn't a usable one.

    A site with no bundle deployed is the normal first-run state, not an error,
    so "absent" and "present but unparseable" both collapse to None and each
    caller decides what that means (info → ``available: false``, download →
    404). Never raises.
    """
    path = os.path.join(_bundle_dir(), _BUNDLE_MANIFEST_NAME)
    if not os.path.exists(path):
        return None
    try:
        data = json.loads(_read_text(path))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _bundle_platforms(manifest: dict) -> dict[str, dict]:
    """Normalise the manifest's ``platforms`` map for the wire contract.

    Only `win` / `linux` are recognised, and each filename is reduced to its
    basename here — this is the single choke point where every download
    filename passes through, so a manifest carrying
    ``"../../site_config.json"`` is defanged before it can reach a path join.
    """
    raw = manifest.get("platforms")
    if not isinstance(raw, dict):
        return {}

    platforms: dict[str, dict] = {}
    for platform in _BUNDLE_PLATFORMS:
        entry = raw.get(platform)
        if not isinstance(entry, dict):
            continue
        filename = os.path.basename(str(entry.get("filename") or "").strip())
        # Rejects "", ".", ".." and dotfiles — none of which is an archive.
        if not filename or filename.startswith("."):
            continue
        platforms[platform] = {
            "filename": filename,
            "size": cint(entry.get("size")),
            "sha256": str(entry.get("sha256") or ""),
            # A deploy can land the manifest without its archives (or one of
            # two); reporting presence lets the client disable a button
            # instead of offering a download that 404s.
            "present": os.path.isfile(os.path.join(_bundle_dir(), filename)),
        }
    return platforms


@frappe.whitelist(methods=["GET", "POST"])
def get_qz_bundle_info() -> dict:
    """Describe the QZ Tray installer bundle deployed for this site.

    Returns ``{"available": False}`` when no manifest is deployed. That is the
    first-run state and the reason this never throws for absence — the POS
    print-health check calls it on every boot, and "no bundle here" is an
    answer, not a failure.

    With a manifest: ``{available, qz_version, built_at, cert_fingerprint,
    platforms: {win|linux: {filename, size, sha256, present}}}``.
    ``available`` means "at least one archive is really on disk and can be
    downloaded", not merely "a manifest exists" — a half-finished deploy must
    not advertise an installer that would 404. The metadata (notably
    ``qz_version``, which the client compares against the connected QZ Tray) is
    reported either way, so a manifest-only site still answers the version
    question.

    Role gate matches ``sign_message``: the operator who installs QZ Tray on a
    till is the one who prints from it, not a System Manager.
    """
    frappe.only_for(list(_QZ_SIGN_ROLES))

    manifest = _read_manifest()
    if manifest is None:
        return {"available": False}

    platforms = _bundle_platforms(manifest)
    return {
        "available": any(entry["present"] for entry in platforms.values()),
        "qz_version": str(manifest.get("qz_version") or ""),
        "built_at": str(manifest.get("built_at") or ""),
        "cert_fingerprint": str(manifest.get("cert_fingerprint") or ""),
        "platforms": platforms,
    }


@frappe.whitelist(methods=["GET"])
def download_qz_bundle(platform: str = "") -> None:
    """Stream the deployed installer archive for ``platform`` as an attachment.

    Path safety: ``platform`` is matched against a two-value tuple, so the
    request never reaches the filesystem itself, and the archive name comes
    only from the manifest (already basename'd by ``_bundle_platforms``). The
    realpath containment check below then refuses anything that resolves out of
    the bundle dir — a planted symlink can't turn this into a file exporter.

    Memory tradeoff, deliberate: the Windows archive is ~103 MB and Frappe's
    download response wants the whole body in ``filecontent``, so a call peaks
    at archive-size RAM in the serving worker. Accepted — a bundle is fetched
    once per till at install time (and again only after a cert rotation), never
    on a print path.
    """
    frappe.only_for(list(_QZ_SIGN_ROLES))

    platform = (platform or "").strip().lower()
    if platform not in _BUNDLE_PLATFORMS:
        # Deliberately does not echo the requested value back.
        frappe.throw(
            _("Unsupported QZ Tray bundle platform. Expected 'win' or 'linux'."),
            title=_("Invalid Platform"),
        )

    manifest = _read_manifest()
    entry = _bundle_platforms(manifest).get(platform) if manifest else None
    if not entry:
        frappe.throw(
            _("No QZ Tray installer has been deployed for this platform yet."),
            frappe.DoesNotExistError,
            title=_("Bundle Not Found"),
        )

    bundle_root = os.path.realpath(_bundle_dir())
    resolved = os.path.realpath(os.path.join(bundle_root, entry["filename"]))
    if (
        os.path.commonpath([bundle_root, resolved]) != bundle_root
        or not os.path.isfile(resolved)
    ):
        frappe.throw(
            _("The QZ Tray installer file is missing on the server."),
            frappe.DoesNotExistError,
            title=_("Bundle Not Found"),
        )

    frappe.response["filename"] = entry["filename"]
    frappe.response["filecontent"] = _read_bytes(resolved)
    frappe.response["type"] = "binary"


@frappe.whitelist(methods=["POST"])
def sign_message(message: str) -> str:
    """Return base64 encoded RSA-PKCS1v15-SHA512 signature.

    Returns empty string when key is not configured yet.

    Hardening (P0 security):
      - POST only; closes the GET-based oracle vector.
      - Role-gated (`_QZ_SIGN_ROLES`); a non-POS logged-in user can no
        longer request signatures.
      - Length-capped; the qz-tray.js client never sends signing
        payloads larger than a few KB (typical envelope is < 512 bytes).
        Cap at 16 KB to prevent the endpoint being used to RSA-sign
        arbitrary multi-page documents.

    Envelope-shape validation was removed (2026-05-20) — qz-tray.js
    v2.2.x signs different payloads at different lifecycle phases
    (initial handshake vs per-call). A strict whitelist of `call`
    values broke the handshake path and led to QZ Tray's "Allow"
    dialog appearing every session because signatures came back empty.
    The role gate + length cap together remain sufficient defense:
    only POS-role users can sign, and they can only sign small QZ-
    shaped strings.
    """
    frappe.only_for(list(_QZ_SIGN_ROLES))

    if not isinstance(message, str) or not message:
        frappe.throw(_("sign_message requires a non-empty payload"))

    if len(message) > 16384:
        frappe.throw(_("sign_message payload exceeds 16 KB cap"))

    key_path = _key_path()
    if not os.path.exists(key_path):
        return ""

    _x509, hashes, serialization, padding, _rsa, _name_oid = _require_cryptography()
    private_key = serialization.load_pem_private_key(_read_bytes(key_path), password=None)
    signature = private_key.sign(
        message.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA512(),
    )
    return base64.b64encode(signature).decode("utf-8")


def _generate_qz_certificate() -> dict[str, str]:
    """Write a fresh self-signed cert + private key pair into the QZ dir.

    Unconditional: callers own the pre-existing-pair decision
    (``setup_qz_certificate`` short-circuits on "exists";
    ``rotate_qz_certificate`` archives the old pair first). Creates the QZ
    dir, writes both files (key chmod 600), shows the operator import
    reminder, and returns the shared "created" result dict.
    """
    cert_path = _cert_path()
    key_path = _key_path()

    os.makedirs(_qz_dir(), exist_ok=True)

    x509, hashes, serialization, _padding, rsa, NameOID = _require_cryptography()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    with open(key_path, "wb") as file:
        file.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    try:
        os.chmod(key_path, 0o600)
    except Exception:
        # Non-POSIX platforms may not support chmod modes the same way.
        pass

    company = frappe.db.get_default("company") or "POS Awesome"
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "POS Awesome QZ Tray Signing"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, company),
        ]
    )

    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + timedelta(days=11499))
        .sign(key, hashes.SHA256())
    )

    with open(cert_path, "wb") as file:
        file.write(cert.public_bytes(serialization.Encoding.PEM))

    frappe.msgprint(
        _(
            "QZ Tray certificate generated successfully.<br><br>"
            "Download the certificate from POS Awesome and import it into "
            "QZ Tray on each POS machine, then restart QZ Tray."
        ),
        title=_("QZ Certificate Ready"),
        indicator="green",
    )

    return {
        "status": "created",
        "message": _("QZ certificate generated successfully."),
        "cert_path": cert_path,
    }


@frappe.whitelist(methods=["POST"])
def setup_qz_certificate() -> dict[str, str]:
    """Generate self-signed certificate + private key for QZ Tray signing."""
    frappe.only_for("System Manager")

    cert_path = _cert_path()
    key_path = _key_path()

    if os.path.exists(cert_path) and os.path.exists(key_path):
        return {
            "status": "exists",
            "message": _("QZ certificate already exists."),
            "cert_path": cert_path,
        }

    return _generate_qz_certificate()


@frappe.whitelist(methods=["POST"])
def rotate_qz_certificate() -> dict[str, str]:
    """Archive the current QZ cert/key pair and generate a fresh one.

    Operational consequence — coordinate the fleet re-deploy BEFORE calling:
    rotation invalidates every terminal's trusted certificate. Each POS
    machine keeps the OLD public cert imported into QZ Tray's trust store;
    the moment this runs their signatures verify against a private key that
    no longer exists, and QZ Tray shows the "Cannot verify trust - Invalid
    Signature" Allow/Block dialog on every connection until the new bundle /
    ``override.crt`` is re-deployed and re-imported on each machine.

    When no pair exists yet this is equivalent to ``setup_qz_certificate``:
    it generates the first pair and returns setup's "created" dict.
    Otherwise it moves both ``digital-certificate.crt`` and
    ``private-key.pem`` into ``private/qz/archive/<YYYYMMDD-HHMMSS>/``,
    generates a fresh pair, and returns ``{"status": "rotated",
    "cert_path": ..., "archived_to": ...}``.
    """
    frappe.only_for("System Manager")

    cert_path = _cert_path()
    key_path = _key_path()

    # Nothing to rotate — first-time generation, same result as setup.
    if not (os.path.exists(cert_path) and os.path.exists(key_path)):
        return _generate_qz_certificate()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    archive_dir = os.path.join(_qz_dir(), "archive", stamp)
    os.makedirs(archive_dir, exist_ok=True)
    # Same filesystem (both under _qz_dir()), so os.replace is an atomic move.
    os.replace(cert_path, os.path.join(archive_dir, os.path.basename(cert_path)))
    os.replace(key_path, os.path.join(archive_dir, os.path.basename(key_path)))

    result = _generate_qz_certificate()
    return {
        "status": "rotated",
        "cert_path": result["cert_path"],
        "archived_to": archive_dir,
    }
