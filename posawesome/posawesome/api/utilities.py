# -*- coding: utf-8 -*-
# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe.utils import cstr, add_to_date, get_datetime
from typing import List, Dict, Any
from datetime import datetime, timezone
import hashlib
import logging
import time
import os
import re
import json
import subprocess

from posawesome import __version__ as POS_AWESOME_APP_VERSION

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency
    psutil = None

_PSUTIL_MISSING_LOGGED = False
import functools

from .utils import get_item_groups, fetch_sales_person_names
from posawesome.utils import get_build_version

POS_AWESOME_REPO_URL = "https://github.com/defendicon/POS-Awesome-V15"


# ----------------------------------------------------------------------
# Structured warnings (boat/docs/LOGGING_MAP.md section 6 conventions)
#
# `frappe.logger("posawesome")` writes one line to the ROTATING files
# logs/posawesome.log AND sites/<site>/logs/posawesome.log. That is the right
# home for a best-effort path that missed: a breadcrumb, never a `tabError Log`
# row, so reporting a miss can never itself become an unbounded row producer.
# Body shape follows muelle-storefront/src/lib/errlog.ts
# (app / scope / site / rid / msg / err), timestamps UTC, one line one event.
# ----------------------------------------------------------------------

_POSA_LOGGER_NAME = "posawesome"


def _posa_site_logger():
    """`frappe.logger("posawesome")` for the CURRENT site, guaranteed to pass INFO.

    Resolved per call and never captured at import time. Two Frappe behaviours
    make the obvious `frappe.logger(...)` at module scope silently useless
    (both verified on the lab backend container, 2026-09-12):

    * Frappe caches one logger AND its file handlers per `<module>-<site>`
      pair (`frappe/utils/logger.py`: `logger_name = "{module}-{site}"`, cached
      in `frappe.loggers`) and writes into `sites/<site>/logs/`. A logger
      captured once at import pins every later line to whichever tenant's
      context imported this module first on the shared bench, so one tenant's
      breadcrumbs land in another tenant's log file. Resolving per call is a
      dict hit.
    * `default_log_level = logging.WARNING if frappe._dev_server else
      logging.ERROR`, and the logger is created with
      `setLevel(frappe.log_level or default_log_level)`. On the lab AND on
      cell-0 `DEV_SERVER` is unset and `log_level` is absent from
      common_site_config.json, so the logger arrives at level 40 (ERROR) and a
      `.warning()` writes ZERO bytes (measured: 0 bytes before and after, 75
      bytes once the level was raised). This whole breadcrumb stream is
      warn-level, so raise the level to INFO on first sight of each site's
      logger. The estate-wide alternative is `log_level` in
      common_site_config.json, which is Marco's call, not this module's.

    Returns None when Frappe cannot hand out a logger at all (no site context,
    unwritable log dir); callers then simply skip the breadcrumb.
    """
    try:
        logger = frappe.logger(_POSA_LOGGER_NAME)
    except Exception:
        return None
    level = getattr(logger, "level", None)
    set_level = getattr(logger, "setLevel", None)
    if isinstance(level, int) and level > logging.INFO and callable(set_level):
        set_level(logging.INFO)
    return logger


def _posa_request_id():
    """Correlation id for this request when one exists (LOGGING_MAP D6).

    `frappe.local.request_id` is being introduced by the doco side of the
    same audit; read it defensively so this works before and after it lands.
    """
    return getattr(frappe.local, "request_id", None)


def _posa_site() -> str:
    return cstr(getattr(frappe.local, "site", "") or "") or "unknown-site"


def _posa_now_iso() -> str:
    """UTC. Convert at the edge (Desk, Telegram), never inside a log line."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _posa_traceback() -> str:
    try:
        return cstr(frappe.get_traceback())
    except Exception:
        return ""


def _posa_warn(scope: str, msg: str, exc=None, **fields) -> None:
    """Emit one JSON warning line on the app logger. Never raises.

    Used by every best-effort path in this module that used to `except: pass`
    (LOGGING_MAP G9: a swallowed exception must still name scope, site and
    the exception class).
    """
    logger = _posa_site_logger()
    if logger is None:
        # No logger available (boot-time context, unwritable log dir). A
        # breadcrumb is never worth failing the caller that was only reporting
        # a miss.
        return
    entry = {
        "app": "posawesome",
        "scope": scope,
        "site": _posa_site(),
        "msg": _clip_text(msg, 500),
    }
    request_id = _posa_request_id()
    if request_id:
        entry["rid"] = cstr(request_id)
    if exc is not None:
        entry["err"] = type(exc).__name__
        entry["err_msg"] = _clip_text(exc, 300)
    for key, value in fields.items():
        if value is not None:
            entry[key] = _clip_text(value, 200)
    try:
        logger.warning(json.dumps(entry, ensure_ascii=True, default=str, sort_keys=True))
    except Exception:
        # The logger itself failed (handler swapped, disk full). Nothing left
        # to report with, and the caller's own path must still return.
        return


def _normalize_release_tag(version):
    tag = cstr(version).strip()
    if tag.startswith("v") and len(tag) > 1 and tag[1].isdigit():
        tag = tag[1:]
    return tag or None


def _build_release_url(version):
    tag = _normalize_release_tag(version)
    return f"{POS_AWESOME_REPO_URL}/releases/tag/{tag}" if tag else None


def _get_update_metadata() -> Dict[str, Any]:
    return {
        "app_version": POS_AWESOME_APP_VERSION,
        "repo_url": POS_AWESOME_REPO_URL,
        "release_url": _build_release_url(POS_AWESOME_APP_VERSION),
    }


def get_version():
    branch_name = get_app_branch("erpnext")
    if "12" in branch_name:
        return 12
    elif "13" in branch_name:
        return 13
    else:
        return 13


def get_app_branch(app):
    """Returns branch of an app"""
    import subprocess

    try:
        branch = subprocess.check_output(
            "cd ../apps/{0} && git rev-parse --abbrev-ref HEAD".format(app), shell=True
        )
        branch = branch.decode("utf-8")
        branch = branch.strip()
        return branch
    except Exception:
        return ""


def get_root_of(doctype):
    """Get root element of a DocType with a tree structure"""
    # Security: Validate doctype to prevent SQL injection since it's used in FROM clause
    if not re.match(r"^[a-zA-Z0-9 _-]+$", doctype):
        return None

    result = frappe.db.sql(
        """select t1.name from `tab{0}` t1 where
		(select count(*) from `tab{1}` t2 where
			t2.lft < t1.lft and t2.rgt > t1.rgt) = 0
		and t1.rgt > t1.lft""".format(
            doctype, doctype
        )
    )
    return result[0][0] if result else None


def get_child_nodes(group_type, root):
    lft, rgt = frappe.db.get_value(group_type, root, ["lft", "rgt"])
    return frappe.get_all(
        group_type,
        filters={"lft": [">=", lft], "rgt": ["<=", rgt]},
        fields=["name", "lft", "rgt"],
        order_by="lft",
    )


def get_item_group_condition(pos_profile, item_groups=None):
    cond = " and 1=1"
    item_groups = item_groups or get_item_groups(pos_profile)
    if item_groups:
        # Security: Escape values to prevent SQL injection
        escaped_groups = [frappe.db.escape(g) for g in item_groups]
        cond = " and item_group in ({0})".format(", ".join(escaped_groups))

    return cond


def add_taxes_from_tax_template(item, parent_doc):
    accounts_settings = frappe.get_cached_doc("Accounts Settings")
    add_taxes_from_item_tax_template = accounts_settings.add_taxes_from_item_tax_template
    if item.get("item_tax_template") and add_taxes_from_item_tax_template:
        item_tax_template = item.get("item_tax_template")
        taxes_template_details = frappe.get_all(
            "Item Tax Template Detail",
            filters={"parent": item_tax_template},
            fields=["tax_type"],
        )

        for tax_detail in taxes_template_details:
            tax_type = tax_detail.get("tax_type")

            found = any(tax.account_head == tax_type for tax in parent_doc.taxes)
            if not found:
                tax_row = parent_doc.append("taxes", {})
                tax_row.update(
                    {
                        "description": str(tax_type).split(" - ")[0],
                        "charge_type": "On Net Total",
                        "account_head": tax_type,
                    }
                )

                if parent_doc.doctype == "Purchase Order":
                    tax_row.update({"category": "Total", "add_deduct_tax": "Add"})
                tax_row.db_insert()


def set_batch_nos_for_bundels(doc, warehouse_field, throw=False):
    """Automatically select `batch_no` for outgoing items in item table"""
    for d in doc.packed_items:
        qty = d.get("stock_qty") or d.get("transfer_qty") or d.get("qty") or 0
        has_batch_no = frappe.db.get_value("Item", d.item_code, "has_batch_no")
        warehouse = d.get(warehouse_field, None)
        if has_batch_no and warehouse and qty > 0:
            if not d.batch_no:
                d.batch_no = get_batch_no(d.item_code, warehouse, qty, throw, d.serial_no)
            else:
                batch_qty = get_batch_qty(batch_no=d.batch_no, warehouse=warehouse)
                if flt(batch_qty, d.precision("qty")) < flt(qty, d.precision("qty")):
                    frappe.throw(
                        _(
                            "Row #{0}: The batch {1} has only {2} qty. Please select another batch which has {3} qty available or split the row into multiple rows, to deliver/issue from multiple batches"
                        ).format(d.idx, d.batch_no, batch_qty, qty)
                    )


def get_company_domain(company):
    return frappe.get_cached_value("Company", cstr(company), "domain")


@frappe.whitelist(methods=["GET", "POST"])
def get_selling_price_lists():
    """Return all selling price lists"""
    return frappe.get_all(
        "Price List",
        filters={"selling": 1},
        fields=["name"],
        order_by="name",
    )


@frappe.whitelist(methods=["GET", "POST"])
def get_app_info() -> Dict[str, List[Dict[str, str]]]:
    """
    Return a list of installed apps and their versions.
    """
    # Get installed apps using Frappe's built-in function
    installed_apps = frappe.get_installed_apps()

    # Get app versions
    apps_info = []
    for app_name in installed_apps:
        try:
            # Get app version from hooks or __init__.py
            app_version = frappe.get_attr(f"{app_name}.__version__") or "Unknown"
        except (AttributeError, ImportError):
            app_version = "Unknown"

        apps_info.append({"app_name": app_name, "installed_version": app_version})

    return {"apps": apps_info, "build_version": get_build_version(), **_get_update_metadata()}


def _get_git_commit_info(app_name: str = "posawesome") -> Dict[str, Any]:
    """Best-effort git commit details for the given app."""
    try:
        app_path = frappe.get_app_path(app_name)
    except Exception:
        return {}

    if not app_path or not os.path.exists(app_path):
        return {}

    def _run(cmd: List[str]) -> str:
        return subprocess.check_output(cmd, cwd=app_path, stderr=subprocess.DEVNULL).decode("utf-8").strip()

    try:
        commit_hash = _run(["git", "rev-parse", "HEAD"])
        commit_message = _run(["git", "log", "-1", "--pretty=%B"])
        commit_date = _run(["git", "log", "-1", "--pretty=%cI"])
        return {
            "commit_hash": commit_hash,
            "commit_message": commit_message,
            "commit_date": commit_date,
        }
    except Exception:
        return {}


@frappe.whitelist(methods=["GET", "POST"])
def get_build_info() -> Dict[str, Any]:
    """Return build version + latest git commit info for update prompts."""
    data: Dict[str, Any] = {"build_version": get_build_version(), **_get_update_metadata()}
    data.update(_get_git_commit_info("posawesome"))
    return data


def _fetch_remote(app_path: str) -> None:
    try:
        subprocess.check_output(
            ["git", "fetch", "origin", "--prune", "--quiet"],
            cwd=app_path,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return


def _is_ancestor(app_path: str, maybe_ancestor: str, of: str) -> bool:
    """True when ``maybe_ancestor`` is already contained in ``of``. On any git
    failure answer True — the safe reading is «no update», never a false
    prompt on every register."""
    try:
        rc = subprocess.run(
            ["git", "merge-base", "--is-ancestor", maybe_ancestor, of],
            cwd=app_path,
            stderr=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
        ).returncode
    except Exception:
        return True
    if rc == 1:  # the one answer git gives for a genuine "not contained"
        return False
    return True  # 0 = ancestor; anything else = git error = no prompt


def _get_remote_heads(app_path: str) -> Dict[str, str]:
    try:
        output = (
            subprocess.check_output(
                ["git", "for-each-ref", "refs/remotes/origin", "--format=%(refname:short) %(objectname)"],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        heads = {}
        for line in output.splitlines():
            parts = line.strip().split(" ")
            if len(parts) != 2:
                continue
            ref, sha = parts
            if ref == "origin/HEAD":
                continue
            branch = ref.replace("origin/", "", 1)
            heads[branch] = sha
        return heads
    except Exception:
        return {}


def _get_commit_details(app_path: str, ref: str) -> Dict[str, str]:
    try:
        commit_message = (
            subprocess.check_output(
                ["git", "log", "-1", "--pretty=%B", ref],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        commit_date = (
            subprocess.check_output(
                ["git", "log", "-1", "--pretty=%cI", ref],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        commit_hash = (
            subprocess.check_output(
                ["git", "rev-parse", ref],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        return {
            "commit_hash": commit_hash,
            "commit_message": commit_message,
            "commit_date": commit_date,
        }
    except Exception:
        return {}


def _get_commit_list(app_path: str, range_ref: str, limit: int = 20) -> List[Dict[str, str]]:
    try:
        output = (
            subprocess.check_output(
                [
                    "git",
                    "log",
                    range_ref,
                    f"--max-count={limit}",
                    "--pretty=%H%x1f%h%x1f%s%x1f%cI",
                ],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        commits: List[Dict[str, str]] = []
        for line in output.splitlines():
            parts = line.split("\x1f")
            if len(parts) != 4:
                continue
            full_hash, short_hash, subject, commit_date = parts
            commits.append(
                {
                    "commit_hash": full_hash,
                    "commit_short": short_hash,
                    "commit_message": subject,
                    "commit_date": commit_date,
                }
            )
        return commits
    except Exception:
        return []


def _get_current_branch(app_path: str) -> str:
    try:
        branch = (
            subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=app_path,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
        )
        return branch
    except Exception:
        return ""


@frappe.whitelist(methods=["GET", "POST"])
def get_remote_update_info() -> Dict[str, Any]:
    data: Dict[str, Any] = {"build_version": get_build_version(), **_get_update_metadata()}
    base = _get_git_commit_info("posawesome")
    if base:
        data.update(base)

    try:
        app_path = frappe.get_app_path("posawesome")
    except Exception:
        return data

    if not app_path or not os.path.exists(app_path):
        return data

    _fetch_remote(app_path)
    heads = _get_remote_heads(app_path)
    data["remote_heads"] = heads
    current_branch = _get_current_branch(app_path)
    if current_branch:
        data["current_branch"] = current_branch

    current_hash = base.get("commit_hash") if base else None
    if heads and current_hash and current_branch:
        remote_head = heads.get(current_branch)
        # Inequality is NOT "remote ahead": a checkout with unpushed commits
        # (every lab build before Marco's sweep) differs from origin while
        # being NEWER, and reporting that as an update made every register
        # prompt «Actualización disponible» for a commit it already contains.
        # Remote is ahead only when it is NOT an ancestor of the local head.
        if remote_head and remote_head != current_hash and not _is_ancestor(
            app_path, remote_head, current_hash
        ):
            different = {current_branch: remote_head}
            data["remote_ahead"] = different
            ref = f"origin/{current_branch}"
            details = _get_commit_details(app_path, ref)
            if details:
                data["remote_sample_branch"] = current_branch
                data["remote_sample"] = details
            data["remote_commits"] = _get_commit_list(app_path, f"{current_hash}..{ref}")

    return data


def ensure_child_doctype(doc, table_field, child_doctype):
    """Ensure child rows have the correct doctype set."""
    for row in doc.get(table_field, []):
        if not row.get("doctype"):
            row.doctype = child_doctype


@frappe.whitelist(methods=["GET", "POST"])
def get_sales_person_names(pos_profile=None):
    return fetch_sales_person_names(pos_profile=pos_profile)


@frappe.whitelist(methods=["GET", "POST"])
def get_language_options():
    """Return newline separated language codes from translations directories of all apps.

    Always include English (``en``) in the list so that users can explicitly
    select it in the POS profile.
    """
    import os

    languages = {"en"}

    def normalize(code: str) -> str:
        """Return language code normalized for comparison."""
        return code.strip().lower().replace("_", "-")

    # Collect languages from translation CSV files
    for app in frappe.get_installed_apps():
        translations_path = frappe.get_app_path(app, "translations")
        if os.path.exists(translations_path):
            for filename in os.listdir(translations_path):
                if filename.endswith(".csv"):
                    languages.add(normalize(os.path.splitext(filename)[0]))

    # Also include languages from the Translation doctype, if available
    if frappe.db.table_exists("Translation"):
        rows = frappe.db.sql("SELECT DISTINCT language FROM `tabTranslation` WHERE language IS NOT NULL")
        for (language,) in rows:
            languages.add(normalize(language))

    # Normalize to lowercase and deduplicate, then sort for consistent order
    return "\n".join(sorted(languages))


@frappe.whitelist(methods=["GET", "POST"])
def get_translation_dict(lang: str) -> dict:
    """Return translations for the given language from all installed apps."""
    from frappe.translate import get_translations_from_csv

    if lang == "en":
        # English is the base language and does not have a separate
        # translation file. Return an empty dict to avoid file lookups.
        return {}

    translations = {}

    for app in frappe.get_installed_apps():
        try:
            messages = get_translations_from_csv(lang, app) or {}
            translations.update(messages)
        except Exception as exc:
            # Best effort per app: one app's missing or corrupt CSV must not
            # cost the POS every other app's strings. Stays broad because the
            # callee reads arbitrary installed apps' files (OSError,
            # UnicodeDecodeError, frappe.DoesNotExistError have all been seen),
            # but it no longer disappears (LOGGING_MAP G9).
            _posa_warn("get_translation_dict", "translation csv unreadable", exc, app=app, lang=lang)

    # Include translations stored in the Translation doctype, if present
    if frappe.db.table_exists("Translation"):
        rows = frappe.db.sql(
            """
	        SELECT source_text, translated_text
	        FROM `tabTranslation`
	        WHERE language = %s
	    """,
            (lang,),
        )
        for source, target in rows:
            translations[source] = target

    return translations


@frappe.whitelist(methods=["GET", "POST"])
def get_pos_profile_tax_inclusive(pos_profile: str):
    """Return the 'posa_tax_inclusive' setting for the given POS Profile."""
    if not pos_profile:
        return None
    return frappe.get_cached_value("POS Profile", pos_profile, "posa_tax_inclusive")


# Both navbar gadgets (ServerUsageGadget / DatabaseUsageGadget) poll their
# endpoint every 10 s from EVERY open POS tab. Uncached, N terminals × the
# whole-system queries (information_schema scans, a 0.5 s psutil block)
# saturated the worker pool under sales load — prod RUM showed
# get_database_usage max 49 s and get_server_usage.err p95 31 s (gateway
# timeouts), pure queueing not query cost (warm, the 4 IS scans run in
# ~0.28 s). A short site-shared cache collapses all concurrent tabs to one
# real computation per window, so the cost no longer scales with tab count.
_DB_USAGE_CACHE_TTL = 60  # DB size/rows barely move minute-to-minute
_SERVER_USAGE_CACHE_TTL = 10  # matches the gadget poll cadence


def _get_cached_usage(key, generator, ttl):
    """Read a site-shared, TTL'd cache value; compute + store on miss.

    frappe.cache().get_value's own generator path can't carry a TTL in this
    Frappe version (``expires`` is a bool and skips the generator), so do it
    explicitly: read redis (bypassing the per-request local cache so a None
    miss isn't memoised), and on miss compute then set_value with
    ``expires_in_sec``. Never let a cache failure break the endpoint.
    """
    cache = frappe.cache()
    try:
        cached = cache.get_value(key, use_local_cache=False)
        if cached is not None:
            return cached
    except Exception as exc:
        # Redis down / unpickleable value: recompute, never fail the gadget.
        # A warning per poll is bounded by the rotating bench log; it is also
        # the only trace that the collapse-to-one-computation is not working.
        _posa_warn("usage_cache.read", "usage cache read failed", exc, key=key)
    value = generator()
    try:
        cache.set_value(key, value, expires_in_sec=ttl)
    except Exception as exc:
        _posa_warn("usage_cache.write", "usage cache write failed", exc, key=key)
    return value


def _compute_database_usage():
    db_size = None
    db_connections = None
    db_slow_queries = None
    db_engine = None
    db_version = None
    db_table_count = None
    db_total_rows = None
    db_top_tables = []
    try:
        db_type = frappe.conf.get("db_type") or frappe.db.db_type
        db_engine = db_type
        db_version = frappe.db.sql("SELECT VERSION();")[0][0]
        if db_type == "postgres":
            db_name = frappe.conf.get("db_name") or frappe.db.get_database_name()
            db_size = frappe.db.sql("SELECT pg_database_size(%s)", (db_name,))[0][0]
            db_size = int(db_size)
            db_connections = frappe.db.sql("SELECT count(*) FROM pg_stat_activity;")[0][0]
            db_slow_queries = frappe.db.sql(
                "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '1 second';"
            )[0][0]
            db_table_count = frappe.db.sql(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
            )[0][0]
            db_total_rows = frappe.db.sql("SELECT sum(reltuples)::bigint FROM pg_class WHERE relkind='r';")[
                0
            ][0]
            db_top_tables = frappe.db.sql(
                """
                SELECT relname, pg_total_relation_size(relid) AS size
                FROM pg_catalog.pg_statio_user_tables
                ORDER BY size DESC LIMIT 3
            """
            )
            db_top_tables = [{"name": t[0], "size": int(t[1])} for t in db_top_tables]
        elif db_type == "mariadb" or db_type == "mysql":
            db_name = frappe.conf.get("db_name") or frappe.db.get_database_name()
            # Single information_schema.tables pass — size, table count, row
            # total and the top-3 tables all derive from these rows. Was 4
            # separate scans; collapsing shrinks the table-open / lock
            # footprint that contends with sales traffic under load.
            rows = frappe.db.sql(
                """
                SELECT table_name, (data_length + index_length) AS size, TABLE_ROWS
                FROM information_schema.tables
                WHERE table_schema = %s
                """,
                (db_name,),
            )
            db_table_count = len(rows)
            db_size = int(sum((r[1] or 0) for r in rows))
            db_total_rows = int(sum((r[2] or 0) for r in rows))
            db_top_tables = [
                {"name": r[0], "size": int(r[1] or 0)}
                for r in sorted(rows, key=lambda r: (r[1] or 0), reverse=True)[:3]
            ]
            db_connections = frappe.db.sql("SHOW STATUS WHERE variable_name = 'Threads_connected';")[0][1]
            db_connections = int(db_connections)
            db_slow_queries = frappe.db.sql("SHOW GLOBAL STATUS WHERE variable_name = 'Slow_queries';")[0][1]
            db_slow_queries = int(db_slow_queries)
    except Exception as db_exc:
        frappe.log_error(f"DB stats error: {db_exc}")
        db_size = None
        db_connections = None
        db_slow_queries = None
        db_engine = None
        db_version = None
        db_table_count = None
        db_total_rows = None
        db_top_tables = []
    return {
        "db_size": db_size,
        "db_connections": db_connections,
        "db_slow_queries": db_slow_queries,
        "db_engine": db_engine,
        "db_version": db_version,
        "db_table_count": db_table_count,
        "db_total_rows": db_total_rows,
        "db_top_tables": db_top_tables,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_database_usage():
    # Site-shared cache: one computation per _DB_USAGE_CACHE_TTL regardless
    # of how many tabs poll. frappe.cache is per-site, so tenants don't mix.
    return _get_cached_usage(
        "posa_database_usage", _compute_database_usage, _DB_USAGE_CACHE_TTL
    )


def _compute_server_usage():
    global _PSUTIL_MISSING_LOGGED

    cpu_percent = None
    memory_percent = None
    memory_total = None
    memory_used = None
    memory_available = None
    load_avg = (None, None, None)
    uptime = None

    if psutil is None:
        if not _PSUTIL_MISSING_LOGGED:
            frappe.log_error("psutil is not installed; server usage metrics unavailable.")
            _PSUTIL_MISSING_LOGGED = True
    else:
        try:
            # interval=None is non-blocking — it returns CPU% since this
            # worker last called cpu_percent, instead of pinning the worker
            # for 0.5 s (which, multiplied across every tab's 10 s poll, was
            # a top contributor to the worker-pool saturation). load_avg is
            # the more meaningful CPU signal anyway; cpu_percent is best
            # effort and reads 0.0 on a worker's very first sample.
            cpu_percent = psutil.cpu_percent(interval=None)
            mem = psutil.virtual_memory()
            memory_percent = mem.percent
            memory_total = mem.total
            memory_used = mem.used
            memory_available = mem.available
            load_avg = os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0)
            uptime = time.time() - psutil.boot_time()
        except Exception as e:
            frappe.log_error(f"Server usage error: {e}")
    return {
        "cpu_percent": cpu_percent,
        "memory_percent": memory_percent,
        "memory_total": memory_total,
        "memory_used": memory_used,
        "memory_available": memory_available,
        "load_avg": load_avg,
        "uptime": uptime,
    }


@frappe.whitelist(methods=["GET", "POST"])
def get_server_usage():
    # Site-shared cache (see _DB_USAGE_CACHE_TTL note): collapses every
    # tab's 10 s poll to one real sample per window across all workers.
    return _get_cached_usage(
        "posa_server_usage", _compute_server_usage, _SERVER_USAGE_CACHE_TTL
    )


# Cache for language data
_LANGUAGE_CACHE = {
    "languages": None,
    "last_updated": None,
    "cache_duration": 300,  # 5 minutes
}


def _set_active_session_language(lang_code: str) -> None:
    """Ensure the current request session reflects the selected language."""

    # Update thread-local language used by Frappe during the request
    try:
        frappe.local.lang = lang_code
    except (AttributeError, TypeError) as exc:
        # No request-local (job/CLI context) or a read-only proxy. The DB write
        # in set_user_language already succeeded; only this request's rendering
        # language is at stake, so report and continue (LOGGING_MAP G9).
        _posa_warn("set_language.local", "could not set frappe.local.lang", exc, lang=lang_code)

    # Update session dictionaries so subsequent requests use the new language
    for session_obj in (
        getattr(frappe.local, "session", None),
        getattr(frappe.session, "data", None),
    ):
        if not session_obj:
            continue
        try:
            session_obj["lang"] = lang_code
            session_obj["language"] = lang_code
        except (AttributeError, TypeError, KeyError) as exc:
            _posa_warn("set_language.session", "could not set session lang", exc, lang=lang_code)

    # Some code paths read frappe.session.lang directly
    try:
        frappe.session.lang = lang_code
    except (AttributeError, TypeError) as exc:
        _posa_warn("set_language.session_attr", "could not set frappe.session.lang", exc, lang=lang_code)

    # Keep boot info in sync so the UI gets the updated language immediately
    boot = getattr(frappe.local, "boot", None)
    if boot:
        boot.lang = lang_code
        sysdefaults = boot.get("sysdefaults")
        if isinstance(sysdefaults, dict):
            sysdefaults["language"] = lang_code

    # Update preferred language cookie when available
    cookie_manager = getattr(frappe.local, "cookie_manager", None)
    if cookie_manager:
        try:
            cookie_manager.set_cookie("preferred_language", lang_code)
        except (AttributeError, TypeError, ValueError) as exc:
            _posa_warn("set_language.cookie", "could not set language cookie", exc, lang=lang_code)


# Language display names mapping (moved to module level for reuse)
LANGUAGE_NAMES = {
    "en": "English",
    "ar": "العربية",
    "es": "Español",
    "pt": "Português",
    "fr": "Français",
    "de": "Deutsch",
    "it": "Italiano",
    "nl": "Nederlands",
    "pl": "Polski",
    "ru": "Русский",
    "zh": "中文",
    "ja": "日本語",
    "ko": "한국어",
    "hi": "हिन्दी",
    "tr": "Türkçe",
    "sv": "Svenska",
    "da": "Dansk",
    "no": "Norsk",
    "fi": "Suomi",
    "cs": "Čeština",
    "sk": "Slovenčina",
    "hu": "Magyar",
    "ro": "Română",
    "bg": "Български",
    "hr": "Hrvatski",
    "sl": "Slovenščina",
    "et": "Eesti",
    "lv": "Latviešu",
    "lt": "Lietuvių",
}


def _clip_text(value: Any, max_length: int = 2000) -> str:
    text = cstr(value or "")
    if len(text) <= max_length:
        return text
    return text[:max_length] + "..."


def _sanitize_client_error_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "kind": _clip_text(payload.get("kind") or "unknown", 80),
        "message": _clip_text(payload.get("message") or "Unknown client error", 2000),
        "stack": _clip_text(payload.get("stack") or "", 8000),
        "filename": _clip_text(payload.get("filename") or "", 500),
        "lineno": payload.get("lineno"),
        "colno": payload.get("colno"),
        "info": _clip_text(payload.get("info") or "", 1000),
        "route": _clip_text(payload.get("route") or "", 500),
        "url": _clip_text(payload.get("url") or "", 1000),
        "user_agent": _clip_text(payload.get("userAgent") or "", 500),
        "timestamp": _clip_text(payload.get("timestamp") or "", 80),
    }


def _is_cache_valid():
    """Check if language cache is still valid."""
    if not _LANGUAGE_CACHE["last_updated"]:
        return False

    cache_time = _LANGUAGE_CACHE["last_updated"]
    expiry_time = add_to_date(cache_time, seconds=_LANGUAGE_CACHE["cache_duration"])
    return get_datetime() < expiry_time


def _update_language_cache(languages):
    """Update the language cache."""
    _LANGUAGE_CACHE["languages"] = languages
    _LANGUAGE_CACHE["last_updated"] = get_datetime()


@frappe.whitelist(methods=["GET", "POST"])
def get_available_languages():
    """Get list of available languages with caching."""
    # Return cached data if valid
    if _is_cache_valid() and _LANGUAGE_CACHE["languages"]:
        return _LANGUAGE_CACHE["languages"]

    languages = []

    try:
        translations_path = frappe.get_app_path("posawesome", "translations")
        if os.path.exists(translations_path):
            # Use os.scandir for better performance
            with os.scandir(translations_path) as entries:
                for entry in entries:
                    if entry.is_file() and entry.name.endswith(".csv"):
                        lang_code = os.path.splitext(entry.name)[0]
                        display_name = LANGUAGE_NAMES.get(lang_code, lang_code.upper())
                        languages.append(
                            {
                                "code": lang_code,
                                "name": display_name,
                                "native_name": display_name,
                            }
                        )

        # Always include English as fallback
        if not any(lang["code"] == "en" for lang in languages):
            languages.insert(0, {"code": "en", "name": "English", "native_name": "English"})

        # Sort and cache
        languages = sorted(languages, key=lambda x: x["code"])
        _update_language_cache(languages)

        return languages

    except Exception as e:
        frappe.log_error(f"Error getting available languages: {str(e)}")
        # Return minimal fallback
        fallback = [{"code": "en", "name": "English", "native_name": "English"}]
        _update_language_cache(fallback)
        return fallback


@functools.lru_cache(maxsize=128)
def _get_user_language_cached(user):
    """Get user language with LRU cache."""
    if user == "Guest":
        return "en"
    return frappe.get_cached_value("User", user, "language") or "en"


@frappe.whitelist(methods=["GET", "POST"])
def get_current_user_language():
    """Get current user's language with optimized caching."""
    try:
        user = frappe.session.user
        if user == "Guest":
            return {
                "success": False,
                "message": "Guest users cannot have language preferences",
            }

        user_language = _get_user_language_cached(user)
        _set_active_session_language(user_language)
        available_languages = get_available_languages()

        # Find current language details
        current_lang = next(
            (lang for lang in available_languages if lang["code"] == user_language),
            None,
        )

        return {
            "success": True,
            "user": user,
            "language_code": user_language,
            "language_name": (current_lang["name"] if current_lang else user_language.upper()),
            "available_languages": available_languages,
        }

    except Exception as e:
        frappe.log_error(f"Error getting current user language: {str(e)}")
        return {"success": False, "message": "Failed to get language"}


@frappe.whitelist(methods=["POST"])
def set_current_user_language(lang_code):
    """Set language with optimized database operations."""
    try:
        user = frappe.session.user
        if user == "Guest":
            return {
                "success": False,
                "message": "Guest users cannot set language preferences",
            }

        # Validate language code
        available_languages = get_available_languages()
        valid_codes = [lang["code"] for lang in available_languages]

        if lang_code not in valid_codes:
            return {
                "success": False,
                "message": f"Language '{lang_code}' is not supported",
            }

        # Batch database operations
        frappe.db.set_value("User", user, "language", lang_code, update_modified=False)
        frappe.db.commit()

        # Clear specific caches
        frappe.clear_cache(user=user)
        _get_user_language_cached.cache_clear()
        _set_active_session_language(lang_code)

        return {
            "success": True,
            "message": f"Language set to {lang_code}",
            "language": lang_code,
        }

    except Exception as e:
        frappe.log_error(f"Error setting language: {str(e)}")
        return {"success": False, "message": "Failed to set language"}


@frappe.whitelist(methods=["GET", "POST"])
def get_language_info(lang_code):
    """Get detailed information about a specific language."""
    try:
        is_valid, error_msg = _validate_language_code(lang_code)
        if not is_valid:
            return {"success": False, "message": error_msg}

        available_languages = get_available_languages()
        language = next((lang for lang in available_languages if lang["code"] == lang_code), None)

        # Check translation file
        translations_path = frappe.get_app_path("posawesome", "translations", f"{lang_code}.csv")
        has_translations = os.path.exists(translations_path)

        translation_count = 0
        if has_translations:
            try:
                with open(translations_path, "r", encoding="utf-8") as f:
                    translation_count = sum(1 for _ in f) - 1  # Exclude header
            except (OSError, UnicodeDecodeError) as exc:
                # Cosmetic count on a language-info panel; the file exists but
                # is unreadable. Report it and report 0 rather than 500 the
                # endpoint (LOGGING_MAP G9).
                _posa_warn(
                    "get_language_info.count",
                    "translation file unreadable",
                    exc,
                    lang=lang_code,
                    path=translations_path,
                )

        return {
            "success": True,
            "language": language,
            "has_translations": has_translations,
            "translation_count": translation_count,
        }

    except Exception as e:
        frappe.log_error(f"Error getting language info for {lang_code}: {str(e)}")
        return {"success": False, "message": "Failed to get language info"}


# ======================================================================
# POS client-error funnel guard (LOGGING_MAP gap G8)
#
# Until 2026-09-12 every browser `window_error` / `unhandled_rejection` /
# `vue_error` became its own `tabError Log` row, and the ONLY dedupe was
# client side: per tab, 10 s
# (frontend/src/posapp/utils/errorReporting.ts DEDUPE_WINDOW_MS). One JS
# regression on a busy sales day therefore wrote a row per tab per 10 s
# indefinitely, with the 14-day retention as the only bound — the shape of
# the fcrm 2.4M-bell incident. Three bounds now sit in front of the insert:
#
#   1. signature dedupe   one row per (kind, id-stripped message, file,
#                         line) per site per window; repeats bump a counter
#                         and roll `[xN]` into the row already written.
#   2. insert budget      inserts per site per minute; over it the latch
#                         trips.
#   3. storm latch        latched, every insert is dropped for an hour and
#                         exactly ONE row carries the running drop count.
#
# Numbers mirror the spirit of the control plane's own storm guard,
# boat/boat/muelle/incidents.py:33-36 (RATE_LIMIT_PER_MIN, STORM_GUARD_SEC,
# ESCALATE_LATCH_SEC, MAX_ALERTS, MAX_BODY_BYTES). Tune them HERE.
# ======================================================================

CLIENT_ERROR_MAX_BODY_BYTES = 64 * 1024  # raw body cap, applied before json.loads
CLIENT_ERROR_DEDUPE_SEC = 600  # one row per signature per site per 10 min
CLIENT_ERROR_ROLLUP_SEC = 30  # refresh that row's [xN] at most this often
CLIENT_ERROR_RATE_LIMIT_PER_MIN = 20  # inserts per site per minute before the latch
CLIENT_ERROR_STORM_LATCH_SEC = 3600  # latched: drop inserts for an hour
CLIENT_ERROR_GUARD_FAIL_LATCH_SEC = 3600  # the guard's own failure row, once per hour

_CLIENT_ERROR_KEY_PREFIX = "posa_client_error"
_CLIENT_ERROR_LOCAL_STATE: Dict[str, Any] = {}
_CLIENT_ERROR_LOCAL_MAX_KEYS = 512

_CLIENT_ERROR_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_CLIENT_ERROR_DIGITS_RE = re.compile(r"\d+")
_CLIENT_ERROR_HASH_RUN_RE = re.compile(r"#+")
_CLIENT_ERROR_WS_RE = re.compile(r"\s+")
# Vite content hash: web-entry-D0sMvJdf.js
_CLIENT_ERROR_ASSET_HASH_RE = re.compile(r"-[A-Za-z0-9_]{8,}(?=\.[A-Za-z0-9]{1,8}$)")

_ERROR_LOG_TITLE_FIELD = None  # resolved once per process


def _client_error_key(bucket: str, suffix=None) -> str:
    """Build a guard cache key.

    `frappe.cache().make_key` already namespaces every key with the site's
    `db_name`, so these budgets are per-site by construction; the site is
    spelled out anyway so an operator reading redis (or a test) sees the
    scope. NEVER reach for the wrapper's raw redis `incr`/`incrby` here:
    those skip `make_key`, so one tenant's storm would spend every tenant's
    budget on the shared bench.
    """
    key = f"{_CLIENT_ERROR_KEY_PREFIX}:{bucket}:{_posa_site()}"
    return f"{key}:{suffix}" if suffix else key


def _client_error_local_set(key: str, value: Any, ttl: int) -> None:
    now = time.time()
    for expired in [k for k, (expires_at, _v) in _CLIENT_ERROR_LOCAL_STATE.items() if expires_at <= now]:
        _CLIENT_ERROR_LOCAL_STATE.pop(expired, None)
    overflow = len(_CLIENT_ERROR_LOCAL_STATE) - _CLIENT_ERROR_LOCAL_MAX_KEYS
    if overflow > 0:
        for stale in sorted(_CLIENT_ERROR_LOCAL_STATE, key=lambda k: _CLIENT_ERROR_LOCAL_STATE[k][0])[:overflow]:
            _CLIENT_ERROR_LOCAL_STATE.pop(stale, None)
    _CLIENT_ERROR_LOCAL_STATE[key] = (now + ttl, value)


def _client_error_local_get(key: str) -> Any:
    entry = _CLIENT_ERROR_LOCAL_STATE.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at <= time.time():
        _CLIENT_ERROR_LOCAL_STATE.pop(key, None)
        return None
    return value


def _client_error_cache():
    try:
        return frappe.cache()
    except Exception as exc:
        _posa_warn("client_error_guard.cache", "frappe.cache() unavailable", exc)
        return None


def _client_error_state_get(cache, key: str) -> Any:
    """Redis first, process-local fallback second.

    With redis up the local copy is redundant. With redis DOWN the fallback
    still bounds the funnel per gunicorn worker, instead of silently
    degrading back to the old row-per-event path.
    """
    if cache is not None:
        try:
            value = cache.get_value(key, use_local_cache=False)
            if value is not None:
                return value
        except Exception as exc:
            _posa_warn("client_error_guard.cache_get", "guard cache read failed", exc, key=key)
    return _client_error_local_get(key)


def _client_error_state_set(cache, key: str, value: Any, ttl: int) -> None:
    if cache is not None:
        try:
            cache.set_value(key, value, expires_in_sec=ttl)
        except Exception as exc:
            _posa_warn("client_error_guard.cache_set", "guard cache write failed", exc, key=key)
    _client_error_local_set(key, value, ttl)


def _client_error_remaining_ttl(started_at: float, window: int) -> int:
    """Keep a window's ORIGINAL expiry across updates.

    Re-setting the key with a fresh TTL on every event would let a sustained
    storm renew its own window forever. The dedupe window must close so the
    next event opens a fresh row, and the latch must release after its hour.
    """
    remaining = int(float(started_at) + window - time.time())
    return remaining if remaining > 0 else 1


def _normalize_client_error_text(value: Any, max_length: int = 500) -> str:
    """Strip what differs between two reports of the SAME bug: ids, row
    numbers, amounts, timestamps. "… at row 412 of ACC-SINV-2026-03224" and
    the same line for row 9 collapse onto one signature."""
    text = _clip_text(value, max_length)
    text = _CLIENT_ERROR_UUID_RE.sub("#", text)
    text = _CLIENT_ERROR_DIGITS_RE.sub("#", text)
    text = _CLIENT_ERROR_HASH_RUN_RE.sub("#", text)
    text = _CLIENT_ERROR_WS_RE.sub(" ", text)
    return text.strip()


def _normalize_client_error_filename(value: Any) -> str:
    """Same, plus the bundle content hash: `web-entry-D0sMvJdf.js` and
    `web-entry-A1b2C3d4.js` are one module across two deploys, and a deploy
    must not reopen every signature."""
    text = _clip_text(value, 500).split("?")[0].split("#")[0]
    text = _CLIENT_ERROR_ASSET_HASH_RE.sub("-#", text)
    return _normalize_client_error_text(text, 500)


def _client_error_signature(payload: Dict[str, Any]):
    """Return (signature, human-readable source). sha256 as a grouping key,
    not a security primitive."""
    source = "|".join(
        (
            _clip_text(payload.get("kind") or "unknown", 80),
            _normalize_client_error_text(payload.get("message"), 500),
            _normalize_client_error_filename(payload.get("filename")),
            cstr(payload.get("lineno") or ""),
        )
    )
    digest = hashlib.sha256(source.encode("utf-8", "replace")).hexdigest()[:16]
    return digest, source


def _parse_client_error_body(payload):
    """Parse the posted body, capping it BEFORE json.loads.

    MAX_BODY_BYTES-style guard (boat incidents.py): a 30 MB `stack` from a
    loop-in-a-loop must not be parsed, sanitized and re-serialized only to be
    clipped at the end. Returns (dict, body_bytes, clipped).
    """
    if isinstance(payload, (str, bytes)):
        raw = payload
        body_bytes = len(raw if isinstance(raw, bytes) else raw.encode("utf-8", "replace"))
        if body_bytes > CLIENT_ERROR_MAX_BODY_BYTES:
            _posa_warn(
                "client_error_guard.body_cap",
                "client error body over cap, not parsed",
                body_bytes=body_bytes,
                cap=CLIENT_ERROR_MAX_BODY_BYTES,
            )
            return (
                {
                    "kind": "oversized_payload",
                    "message": (
                        f"client error payload dropped: {body_bytes} bytes over the "
                        f"{CLIENT_ERROR_MAX_BODY_BYTES} byte cap"
                    ),
                },
                body_bytes,
                True,
            )
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError) as exc:
            _posa_warn("client_error_guard.body_parse", "client error body is not JSON", exc)
            parsed = {"message": _clip_text(raw)}
        if not isinstance(parsed, dict):
            parsed = {"message": _clip_text(parsed)}
        return parsed, body_bytes, False
    if isinstance(payload, dict):
        # Already-decoded dicts are bounded by _sanitize_client_error_payload,
        # which whitelists keys and clips each one (~13 KB worst case).
        return payload, None, False
    return {"message": _clip_text(payload)}, None, False


def _dumps_capped(body: Dict[str, Any]) -> str:
    """Serialize, then keep the ROW bounded too: clip the stack (the only
    open-ended field) rather than store a megabyte in `tabError Log`."""
    text = json.dumps(body, ensure_ascii=True, default=str, sort_keys=True)
    if len(text) <= CLIENT_ERROR_MAX_BODY_BYTES:
        return text
    payload = body.get("payload")
    if isinstance(payload, dict) and payload.get("stack"):
        clipped_payload = dict(payload)
        clipped_payload["stack"] = _clip_text(clipped_payload.get("stack"), 500)
        clipped_payload["stack_clipped"] = True
        body = dict(body, payload=clipped_payload)
        text = json.dumps(body, ensure_ascii=True, default=str, sort_keys=True)
    return text[:CLIENT_ERROR_MAX_BODY_BYTES]


def _client_error_title(kind: Any, count: int = 1) -> str:
    title = f"POS Client Error [{_clip_text(kind or 'unknown', 60)}]"
    if count > 1:
        title = f"{title} [x{count}]"
    return _clip_text(title, 140)


def _client_error_storm_window_label() -> str:
    return "hour" if CLIENT_ERROR_STORM_LATCH_SEC == 3600 else f"{CLIENT_ERROR_STORM_LATCH_SEC}s window"


def _client_error_storm_summary(dropped: int) -> str:
    return f"client error storm: dropped {dropped} in the last {_client_error_storm_window_label()}"


def _client_error_message(sanitized, signature, count=1, first_seen=None, last_seen=None) -> str:
    return _dumps_capped(
        {
            "app": "posawesome",
            "scope": "pos_client_error",
            "site": _posa_site(),
            "rid": cstr(_posa_request_id() or ""),
            "user": cstr(getattr(frappe.session, "user", "") or ""),
            "signature": signature,
            "count": count,
            "first_seen": first_seen,
            "last_seen": last_seen,
            "dedupe_window_sec": CLIENT_ERROR_DEDUPE_SEC,
            "payload": sanitized,
        }
    )


def _error_log_title_field():
    """Error Log's title field is `method` on Frappe v16 (verified on the lab
    bench); probe once per process so a schema change can't break the
    rollup."""
    global _ERROR_LOG_TITLE_FIELD
    if _ERROR_LOG_TITLE_FIELD is None:
        field = ""
        try:
            for candidate in ("method", "title"):
                if frappe.db.has_column("Error Log", candidate):
                    field = candidate
                    break
        except Exception as exc:
            _posa_warn("client_error_guard.title_field", "Error Log title probe failed", exc)
        _ERROR_LOG_TITLE_FIELD = field
    return _ERROR_LOG_TITLE_FIELD or None


def _insert_client_error_row(title: str, message: str):
    """Insert one Error Log row and return its name.

    `frappe.log_error` defers the insert in read-only mode, and the doc it
    hands back then has no name — return None so the caller skips rollups
    instead of writing to a row that does not exist.
    """
    row = frappe.log_error(message=message, title=title)
    return cstr(getattr(row, "name", "") or "") or None


def _refresh_error_log_row(row, title, message) -> bool:
    """Roll the repeat count into the row already written instead of
    inserting another one. Callers throttle this to CLIENT_ERROR_ROLLUP_SEC,
    so a storm costs at most two UPDATEs per minute per signature."""
    if not row:
        return False
    updates = {"error": message}
    title_field = _error_log_title_field()
    if title_field:
        updates[title_field] = _clip_text(title, 140)
    try:
        frappe.db.set_value("Error Log", row, updates, update_modified=False)
        return True
    except Exception as exc:
        _posa_warn("client_error_guard.row_refresh", "Error Log rollup update failed", exc, row=row)
        return False


def _bump_client_error_insert_budget(cache) -> int:
    """Count INSERTS per site per minute (deduped repeats are free).

    Read-modify-write rather than redis INCR — see `_client_error_key` for
    why the wrapper's incr is unusable here. Concurrent workers can
    undercount by a few, so the latch trips a beat later; for a guard that is
    fine, and the dedupe already absorbs the identical-error case.
    """
    key = _client_error_key("inserts", str(int(time.time() // 60)))
    used = int(_client_error_state_get(cache, key) or 0) + 1
    _client_error_state_set(cache, key, used, 120)
    return used


def _note_client_error_repeat(cache, sig_key, entry, sanitized, signature) -> int:
    """A repeat inside the window: bump the counter, never insert."""
    entry = dict(entry or {})
    now = time.time()
    stamp = _posa_now_iso()
    count = int(entry.get("count") or 1) + 1
    started_at = float(entry.get("started_at") or now)
    entry.update({"count": count, "last_seen": stamp, "started_at": started_at})
    if entry.get("row") and now - float(entry.get("updated") or 0) >= CLIENT_ERROR_ROLLUP_SEC:
        entry["updated"] = now
        _refresh_error_log_row(
            entry.get("row"),
            _client_error_title(entry.get("kind") or sanitized.get("kind"), count),
            _client_error_message(
                sanitized,
                signature,
                count=count,
                first_seen=entry.get("first_seen"),
                last_seen=stamp,
            ),
        )
    _client_error_state_set(
        cache, sig_key, entry, _client_error_remaining_ttl(started_at, CLIENT_ERROR_DEDUPE_SEC)
    )
    return count


def _trip_client_error_storm_latch(cache, signature, sanitized, inserts_last_minute) -> Dict[str, Any]:
    """Write the ONE row for this storm window and latch further inserts off.

    The row lands the moment the latch trips (an operator should see the
    storm while it is happening) and is then rolled up in place with the
    running drop count, so a whole hour of dropped client errors costs
    exactly one row.
    """
    now = time.time()
    dropped = 1  # the event that tripped the latch is the first one dropped
    latch = {
        "started_at": now,
        "since": _posa_now_iso(),
        "dropped": dropped,
        "signature": signature,
        "updated": now,
        "row": None,
    }
    latch["row"] = _insert_client_error_row(
        _client_error_storm_title(dropped),
        _client_error_storm_message(latch, sanitized, inserts_last_minute),
    )
    _client_error_state_set(cache, _client_error_key("latch"), latch, CLIENT_ERROR_STORM_LATCH_SEC)
    _posa_warn(
        "client_error_guard.storm",
        "client error storm latched, dropping inserts",
        inserts_last_minute=inserts_last_minute,
        limit_per_min=CLIENT_ERROR_RATE_LIMIT_PER_MIN,
        latch_sec=CLIENT_ERROR_STORM_LATCH_SEC,
    )
    return latch


def _client_error_storm_title(dropped: int) -> str:
    return _clip_text(f"POS Client Error Storm [dropped x{dropped}]", 140)


def _client_error_storm_message(latch, sanitized, inserts_last_minute=None) -> str:
    return _dumps_capped(
        {
            "app": "posawesome",
            "scope": "pos_client_error_storm",
            "site": _posa_site(),
            "rid": cstr(_posa_request_id() or ""),
            "summary": _client_error_storm_summary(int(latch.get("dropped") or 0)),
            "dropped": int(latch.get("dropped") or 0),
            "since": latch.get("since"),
            "window_sec": CLIENT_ERROR_STORM_LATCH_SEC,
            "limit_per_min": CLIENT_ERROR_RATE_LIMIT_PER_MIN,
            "inserts_last_minute": inserts_last_minute,
            "first_dropped_signature": latch.get("signature"),
            "payload": sanitized,
        }
    )


def _note_client_error_storm_drop(cache, latch, sanitized) -> int:
    """Account one dropped event against the open storm window."""
    latch = dict(latch or {})
    now = time.time()
    started_at = float(latch.get("started_at") or now)
    dropped = int(latch.get("dropped") or 0) + 1
    latch.update({"dropped": dropped, "started_at": started_at})
    if latch.get("row") and now - float(latch.get("updated") or 0) >= CLIENT_ERROR_ROLLUP_SEC:
        latch["updated"] = now
        _refresh_error_log_row(
            latch.get("row"),
            _client_error_storm_title(dropped),
            _client_error_storm_message(latch, sanitized),
        )
    _client_error_state_set(
        cache,
        _client_error_key("latch"),
        latch,
        _client_error_remaining_ttl(started_at, CLIENT_ERROR_STORM_LATCH_SEC),
    )
    return dropped


def _log_client_error_guarded(payload=None) -> Dict[str, Any]:
    parsed_payload, body_bytes, body_clipped = _parse_client_error_body(payload)
    sanitized_payload = _sanitize_client_error_payload(parsed_payload)
    # Correlation id and site travel WITH the payload (LOGGING_MAP D6 / G4):
    # once the tab is closed this row is the only artifact left.
    sanitized_payload["request_id"] = cstr(_posa_request_id() or "")
    sanitized_payload["site"] = _posa_site()
    if body_clipped:
        sanitized_payload["body_bytes"] = body_bytes
        sanitized_payload["body_clipped"] = True

    signature, signature_source = _client_error_signature(sanitized_payload)
    cache = _client_error_cache()

    latch = _client_error_state_get(cache, _client_error_key("latch"))
    if latch:
        return {
            "ok": True,
            "logged": False,
            "dropped": "storm",
            "signature": signature,
            "storm_dropped": _note_client_error_storm_drop(cache, latch, sanitized_payload),
        }

    sig_key = _client_error_key("sig", signature)
    entry = _client_error_state_get(cache, sig_key)
    if entry:
        return {
            "ok": True,
            "logged": False,
            "dropped": "duplicate",
            "signature": signature,
            "count": _note_client_error_repeat(cache, sig_key, entry, sanitized_payload, signature),
        }

    inserts_last_minute = _bump_client_error_insert_budget(cache)
    if inserts_last_minute > CLIENT_ERROR_RATE_LIMIT_PER_MIN:
        latch = _trip_client_error_storm_latch(
            cache, signature, sanitized_payload, inserts_last_minute
        )
        return {
            "ok": True,
            "logged": False,
            "dropped": "storm",
            "signature": signature,
            "storm_dropped": int(latch.get("dropped") or 1),
        }

    stamp = _posa_now_iso()
    row = _insert_client_error_row(
        _client_error_title(sanitized_payload.get("kind"), 1),
        _client_error_message(
            sanitized_payload, signature, count=1, first_seen=stamp, last_seen=stamp
        ),
    )
    _client_error_state_set(
        cache,
        sig_key,
        {
            "row": row,
            "count": 1,
            "first_seen": stamp,
            "last_seen": stamp,
            "started_at": time.time(),
            "updated": time.time(),
            "kind": sanitized_payload.get("kind"),
            "signature_source": _clip_text(signature_source, 500),
        },
        CLIENT_ERROR_DEDUPE_SEC,
    )
    return {"ok": True, "logged": True, "signature": signature, "count": 1}


def _report_client_error_guard_failure(exc) -> bool:
    """Report the guard's own failure WITHOUT opening a second funnel.

    The pre-guard code answered its own failure with an unconditional second
    `frappe.log_error`, so a broken funnel simply became a different
    unbounded funnel. Now: always a file-log warning, and at most one Error
    Log row per site per hour.
    """
    _posa_warn("client_error_guard.failure", "log_client_error guard failed", exc)
    cache = _client_error_cache()
    key = _client_error_key("guard_fail")
    state = _client_error_state_get(cache, key)
    if state:
        state = dict(state)
        started_at = float(state.get("started_at") or time.time())
        state.update({"count": int(state.get("count") or 1) + 1, "started_at": started_at})
        _client_error_state_set(
            cache, key, state, _client_error_remaining_ttl(started_at, CLIENT_ERROR_GUARD_FAIL_LATCH_SEC)
        )
        return False
    row = _insert_client_error_row(
        "POS Client Error Logging Failure",
        _dumps_capped(
            {
                "app": "posawesome",
                "scope": "pos_client_error_guard_failure",
                "site": _posa_site(),
                "rid": cstr(_posa_request_id() or ""),
                "err": type(exc).__name__,
                "msg": _clip_text(exc, 500),
                "trace": _clip_text(_posa_traceback(), 4000),
                "latch_sec": CLIENT_ERROR_GUARD_FAIL_LATCH_SEC,
            }
        ),
    )
    _client_error_state_set(
        cache,
        key,
        {"row": row, "count": 1, "started_at": time.time()},
        CLIENT_ERROR_GUARD_FAIL_LATCH_SEC,
    )
    return True


@frappe.whitelist(methods=["POST"])
def log_client_error(payload=None):
    """Capture frontend runtime errors in server logs for debugging.

    Guarded since 2026-09-12 (LOGGING_MAP G8) — see the block above for the
    three bounds and their constants. Never raises back to the browser: the
    caller is the SPA's own global error handler, so an exception here would
    be reported straight back to here.
    """
    try:
        return _log_client_error_guarded(payload)
    except Exception as exc:
        try:
            _report_client_error_guard_failure(exc)
        except Exception:
            # The reporter's own reporter failed (redis AND the database AND
            # the file logger). `ok: False` is all that is left; raising would
            # surface in the SPA, whose handler posts right back here.
            pass
        return {"ok": False}


@frappe.whitelist(methods=["GET", "POST"])
def posa_user_opted_into_web_route() -> bool:
    """Return True when the current user should get the /posapp SPA.

    2026-07-24 SEMANTICS FLIP — the SPA is the DEFAULT, `posa_use_web_route`
    is now an explicit per-profile OPT-OUT, not an opt-in:

    - no POS Profile rows for the user (or profiles that list no users, i.e.
      "applicable for all") → True. The old opt-in read of this returned
      False here, and `www/posapp.py` bounced those users to /app/posapp,
      whose Page controller bounces straight back to /posapp → an infinite
      client/server redirect ping-pong. Any profile created after the flag
      landed defaulted to 0 and fell into that loop.
    - user has profiles → True unless EVERY matching enabled profile has the
      flag explicitly 0 (a deliberate shop-level rollback to the Desk shell).
    - DB error → True. Fail OPEN to the canonical route; the legacy Desk boot
      path is the experimental one now.

    Administrator always True so smoke specs + ops land on /posapp without
    touching profile data. Kept tiny — polled on every POS visit.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        return False
    if user == "Administrator":
        return True
    try:
        rows = frappe.db.sql(
            """
            SELECT p.posa_use_web_route
            FROM `tabPOS Profile` p
            INNER JOIN `tabPOS Profile User` u ON u.parent = p.name
            WHERE p.disabled = 0 AND u.user = %s
            LIMIT 50
            """,
            (user,),
        )
    except Exception:
        return True
    if not rows:
        return True
    return any(int(row[0] or 0) for row in rows)


# ----------------------------------------------------------------------
# Backward-compat path aliases. Some POSAwesome frontend chunks call
# `posawesome.posawesome.api.<old_module>.<func>` whose impl moved into
# subpackages. Direct `from ... import` aliases fail Frappe's whitelist
# check because the function's `__module__` no longer matches the URL
# path → 404. Local wrappers below carry their own @whitelist and
# delegate, filtering Frappe-injected kwargs (e.g. `cmd`) so impls
# without **kwargs don't TypeError.
# ----------------------------------------------------------------------


@frappe.whitelist(methods=["GET", "POST"])
def get_active_pricing_rules(*args, **kwargs):
    """Backward-compat alias → posawesome.posawesome.api.pricing_rules.get_active_pricing_rules.
    Filters kwargs against the impl's signature so Frappe's `cmd` /
    other handler-injected fields don't trip TypeError on impls without
    **kwargs."""
    from posawesome.posawesome.api.pricing_rules import get_active_pricing_rules as _impl
    import inspect as _inspect
    _sig = _inspect.signature(_impl)
    if not any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in _sig.parameters.values()):
        kwargs = {k: v for k, v in kwargs.items() if k in _sig.parameters}
    return _impl(*args, **kwargs)
