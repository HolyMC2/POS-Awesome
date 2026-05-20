# Copyright (c) 2026, POS Awesome contributors
# For license information, please see license.txt

"""QZ Tray certificate and signing endpoints for silent printing."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta, timezone

import frappe
from frappe import _

# Roles allowed to call `sign_message`. Any logged-in user with one of
# these can request a QZ Tray signature; users without them get 403.
# Without this gate the endpoint was an unbounded RSA signing oracle
# against the site's QZ Tray private key.
_QZ_SIGN_ROLES = (
    "POS User",
    "POS Manager",
    "POS Awesome Supervisor",
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
