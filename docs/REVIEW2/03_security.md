# REVIEW2 · 03 — Security architecture (multi-tenant SaaS rollout)

> Snapshot 2026-05-18 · branch `track/upstream-develop` (defendicon 15.29.0 + 23 perf commits + doco fork).
> Scope: posawesome as-shipped, audited as if tomorrow it backs thousands of tenant sites with payment data and PII flowing through.
> Verdict (1 line, executive): **NOT READY for a public multi-tenant rollout.** Auth fundamentals lean on Frappe's session, which is fine, but the app itself wallpapers `ignore_permissions=True` over almost every write path, has no tenant guard rails beyond what the operator passes in `company` / `pos_profile` parameters, leaks PII through unfiltered logs, has no rate limiting on payment endpoints, and ships a PIN scheme that fails 4 of 5 NIST checks. None of this is a fatal disease, but none of it is fixed by a weekend either. Plan on 4–6 weeks of focused work plus an outside pentest before any tenant other than your own is allowed to log in.

This is the security half of the REVIEW2 fork audit (companion docs: 01_arch.md, 02_perf.md). It maps the endpoint surface, flags every place a tenant boundary could be crossed, and groups fixes into upstream PRs + doco-only carve-outs.

---

## 1. Endpoint inventory

Total `@frappe.whitelist()` callsites: **168** across `posawesome/posawesome/api/**` + `posawesome/posawesome/doctype/**` (count from `grep -rn '@frappe.whitelist' posawesome/`).

I am not going to inline 168 rows — that's noise. The table below covers the **financially-critical and PII-touching surface** (~50 endpoints). Everything else is read-only catalog plumbing whose worst case is "leaks item list to a wrong tenant if scoping is missing" — which it is, see §2.

Legend: 🔴 must-fix-before-SaaS · 🟡 fix-before-GA · 🟢 acceptable.
Columns:
- `M` = HTTP method allowlist (`@frappe.whitelist(methods=[...])` or `*` if unrestricted).
- `Auth` = `S` (session required) · `G` (allow_guest).
- `CSRF` = Frappe global default of `X-Frappe-CSRF-Token` required for non-GET (`*` = enforced by Frappe, `-` = guest endpoint not gated).
- `Idem` = idempotent (✓) or not (✗).
- `RL` = rate-limited (✗ = no, ✓ = yes).
- `IV` = input validated server-side beyond JSON parsing.
- `PII` = output contains personally-identifiable data.

### 1.1 Payment + invoice (highest blast radius)

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | PII out | Flag |
|---|---|---|---|---|---|---|---|---|---|
| `api/invoice_processing/creation.py:712` | `update_invoice` | * | S | ✓ | ✗ | ✗ | partial (json.loads only) | ✓ customer, addr | 🔴 |
| `api/invoice_processing/creation.py:938` | `submit_invoice` | * | S | ✓ | ✓ (client_request_id) | ✗ | partial | ✓ | 🔴 |
| `api/invoice_processing/creation.py:1318` | `repair_invoice_submission` | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟡 |
| `api/invoice_processing/creation.py:1393` | `validate_cart_items` | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟢 |
| `api/invoices.py:45` | `get_draft_invoices` | * | S | ✓ | ✓ | ✗ | `is_supervisor` is a client-supplied integer, **never re-checked against roles** | ✓ customer name | 🔴 |
| `api/invoices.py:107` | `get_draft_invoice_doc` | * | S | ✓ | ✓ | ✗ | ✗ — accepts arbitrary `invoice_name` + `doctype`, returns full doc | ✓ full SI/POS Invoice | 🔴 |
| `api/invoices.py:121` | `delete_invoice` | * | S | ✓ | ✗ | ✗ | only checks `posa_is_printed` flag | ✗ | 🔴 |
| `api/invoices.py:142` | `fetch_exchange_rate_pair` | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟢 |
| `api/invoices.py:164` | `create_sales_invoice_from_order` | * | S | ✓ | ✗ | ✗ | calls `ignore_permissions=True` at L175 | ✓ | 🔴 |
| `api/invoices.py:181` | `delete_sales_invoice` | * | S | ✓ | ✗ | ✗ | force-deletes any SI name passed in | ✗ | 🔴 |
| `api/payments.py:23` | `create_payment_request` | * | S | ✓ | ✗ (existing PR reused) | ✗ | partial | ✓ contact_mobile | 🟡 |
| `api/payments.py:348` | `get_available_credit` | * | S | ✓ | ✓ | ✗ | accepts arbitrary `customer` + `company` strings | ✓ customer | 🔴 |
| `api/payments.py:535` | `repair_overpayment_change_allocations` | * | S | ✓ | ✓ (dry_run) | ✗ | partial (`limit`, `dry_run`) | ✗ | 🟡 |
| `api/payment_processing/processor.py:232` | `*post-submit payments*` | * | S | ✓ | ✗ | ✗ | partial | ✓ | 🔴 |
| `api/payment_processing/reconciliation.py:13` | `*reconcile*` | * | S | ✓ | ✗ | ✗ | partial | ✓ | 🟡 |
| `api/payment_processing/data.py:135,260,549,560` | payment helpers | * | S | ✓ | partial | ✗ | partial | ✓ | 🟡 |
| `api/invoice_processing/returns.py:15` | `search_invoices_for_return` | * | S | ✓ | ✓ | ✗ | partial | ✓ customer, invoices | 🔴 |
| `api/invoice_processing/returns.py:220` | `validate_return_items` | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟡 |
| `api/invoice_processing/returns.py:342` | `get_invoice_for_return` | * | S | ✓ | ✓ | ✗ | ✗ — name only, no tenant scope | ✓ full invoice | 🔴 |
| `api/invoice_processing/utils.py:142,147` | facade helpers | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟡 |
| `api/invoice_processing/data.py:5` | `get_last_invoice_rates` | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟢 |
| `api/invoice.py:163` | (doc_event, not whitelist) sets `ignore_account_permission` | — | — | — | — | — | — | — | 🟡 |

### 1.2 M-Pesa (only guest endpoints in the codebase)

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | PII out | Flag |
|---|---|---|---|---|---|---|---|---|---|
| `api/m_pesa.py:20` | `confirmation` | * | **G** | — | ✗ | ✗ | none — accepts any `**kwargs` and inserts | ✓ payer name, MSISDN | 🔴 |
| `api/m_pesa.py:48` | `validation` | * | **G** | — | n/a | ✗ | none | ✗ | 🟡 |
| `api/m_pesa.py:54` | `get_mpesa_mode_of_payment` | * | S | ✓ | ✓ | ✗ | partial (filters by company) | ✗ | 🟢 |
| `api/m_pesa.py:68` | `get_mpesa_draft_payments` | * | S | ✓ | ✓ | ✗ | filter by company but `mobile_no` / `full_name` are LIKE patterns from client | ✓ | 🟡 |
| `api/m_pesa.py:105` | `submit_mpesa_payment` | * | S | ✓ | ✗ | ✗ | partial | ✓ | 🟡 |

**`confirmation` is the worst endpoint in the codebase.** It's `allow_guest=True`, accepts arbitrary keyword args, inserts an "Mpesa Payment Register" doc with `ignore_permissions=True`, commits, and returns 200. No HMAC, no Safaricom callback IP allowlist, no signature, no rate limit. In a SaaS deployment with thousands of tenant subdomains, this is a free `INSERT` on any tenant's DB from anywhere on the internet. **Must require Safaricom IP allowlist + HMAC validation + per-tenant shared secret before SaaS.**

### 1.3 Cash movement (good — actually checks ownership)

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | Flag |
|---|---|---|---|---|---|---|---|---|
| `api/cash_movement/service.py:105` | `get_cash_movement_context` | * | S | ✓ | ✓ | ✗ | requires profile | 🟢 |
| `api/cash_movement/service.py:148` | `create_pos_expense` | * | S | ✓ | ✓ (`client_request_id`) | ✗ | full validation chain | 🟢 |
| `api/cash_movement/service.py:153` | `create_cash_deposit` | * | S | ✓ | ✓ | ✗ | full validation chain | 🟢 |
| `api/cash_movement/service.py:158` | `get_shift_cash_movements` | * | S | ✓ | ✓ | ✗ | `_enforce_shift_access` checks owner-or-manager | 🟢 |
| `api/cash_movement/service.py:178` | `get_submitted_expenses` | * | S | ✓ | ✓ | ✗ | same | 🟢 |
| `api/cash_movement/service.py:188` | `cancel_cash_movement` | * | S | ✓ | ✗ | ✗ | `ensure_owner_or_manager` | 🟢 |
| `api/cash_movement/service.py:204` | `delete_cash_movement` | * | S | ✓ | ✗ | ✗ | same | 🟢 |
| `api/cash_movement/service.py:219` | `duplicate_cash_movement` | * | S | ✓ | ✗ | ✗ | same | 🟢 |

This module is the only one in the app that has its act together. Use it as the template (`api/cash_movement/permissions.py`, `validation.py`) for the rest of the codebase.

### 1.4 Customer + PII

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | PII out | Flag |
|---|---|---|---|---|---|---|---|---|---|
| `api/customers.py:56` | `get_customer_balance` | * | S | ✓ | ✓ | ✗ | none — accepts any customer name | ✓ name | 🔴 |
| `api/customers.py:84` | `get_customer_names` | * | S | ✓ | ✓ | ✗ | filtered via POS-profile customer-groups (good) | ✓ mobile, email, tax_id, address | 🔴 cache by user-shared key |
| `api/customers.py:137` | `get_customers_count` | * | S | ✓ | ✓ | ✗ | same filter | ✗ | 🟢 |
| `api/customers.py:147` | `search_customers` | * | S | ✓ | ✓ | ✗ | filter scoped by profile; uses `LIKE %term%` (slow but safe) | ✓ same | 🟡 |
| `api/customers.py:203` | `get_customer_info` | * | S | ✓ | ✓ | ✗ | takes raw customer name, returns email/phone/tax_id/address/loyalty | ✓ full PII | 🔴 |
| `api/customers.py:292` | `create_customer` | * | S | ✓ | ✗ | ✗ | partial; calls `ignore_mandatory`/`ignore_permissions` indirectly | n/a | 🟡 |
| `api/customers.py:428` | `set_customer_info` | * | S | ✓ | ✗ | ✗ | accepts arbitrary `fieldname` + `value` | n/a | 🔴 — mass-assignment by field-name passthrough on `frappe.db.set_value` for `loyalty_program` |
| `api/customers.py:463` | `get_customer_addresses` | * | S | ✓ | ✓ | ✗ | name only, no scope | ✓ address | 🔴 |
| `api/customers.py:489` | `make_address` | * | S | ✓ | ✗ | ✗ | accepts arbitrary doctype/customer | n/a | 🟡 |
| `api/customers.py:510` | `get_sales_person_names` | * | S | ✓ | ✓ | ✗ | filtered by profile | ✗ | 🟢 |
| `api/customer.py:63,68` | tax-template helpers | * | S | ✓ | ✓ | ✗ | partial | ✗ | 🟢 |

### 1.5 Employees + PIN (cashier authentication)

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | Flag |
|---|---|---|---|---|---|---|---|---|
| `api/employees.py:109` | `get_terminal_employees` | * | S | ✓ | ✓ | ✗ | profile-bound, `ignore_permissions=True` on User read | 🟡 leaks usernames cross-profile if profile name guessable |
| `api/employees.py:151` | `verify_terminal_employee_pin` | * | S | ✓ | ✓ | ✗ **🔴 NO RATE LIMIT** | `stored_pin != pin` non-constant-time comparison | 🔴 |
| `api/employees.py:177` | `get_cashier_pin_status` | * | S | ✓ | ✓ | ✗ | discloses whether a cashier has a PIN | 🟡 |
| `api/employees.py:199` | `save_cashier_pin` | * | S | ✓ | ✗ | ✗ | `current_pin` check vulnerable to timing; cashier-A can reset cashier-B's PIN if they know cashier-B's current one (`_ensure_terminal_user` is the only gate) | 🔴 |

Already flagged in `POSAWESOME-ROADMAP.md` S5, still unfixed.

### 1.6 QZ Tray (silent printing)

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | Flag |
|---|---|---|---|---|---|---|---|---|
| `api/qz.py:56` | `get_certificate` | * | S | ✓ | ✓ | ✗ | reads private/qz/digital-certificate.crt | 🟢 (public cert) |
| `api/qz.py:69` | `get_certificate_download` | * | S | ✓ | ✓ | ✗ | same + default company | 🟢 |
| `api/qz.py:85` | `sign_message` | * | S | ✓ | ✗ | ✗ **🔴** | **signs ARBITRARY caller-supplied string with the site's private key** | 🔴 |
| `api/qz.py:105` | `setup_qz_certificate` | * | S | ✓ | ✗ | ✗ | gated by `frappe.only_for("System Manager")` ✓ | 🟢 |

`sign_message` is the **second worst endpoint** after `m_pesa.confirmation`. Any logged-in user with a session — including a cashier on a sibling tenant on the same Frappe bench — calls it, hands it any message they want, and gets back an RSA-PKCS1v15-SHA512 signature over that message using the per-site private key. The site's private signing identity is now a callable oracle. Mitigations: scope to "POS Awesome Manager" role + add a per-tenant `posa_pos_pin`-style "this message is from this terminal" envelope so the server only signs payloads that look like print jobs (start with `{"call":"`, etc.).

### 1.7 Telemetry

| Path:Line | Endpoint | M | Auth | CSRF | Idem | RL | IV | Flag |
|---|---|---|---|---|---|---|---|---|
| `api/telemetry.py:110` | `ingest` | POST | S | ✓ | ✗ | ✗ — docstring claims `frappe.rate_limiter` but **none is wired**; just length cap (`MAX_EVENTS_PER_BATCH=200`) | length + event-prefix allowlist ✓ | 🟡 |
| `api/telemetry.py:179` | `get_pos_telemetry_summary` | * | S | ✓ | ✓ | ✗ | role-gated to `System Manager` / `POS Manager` ✓ | 🟢 |

The ingest docstring (`L21`) says: "Rate-limited per session via `frappe.rate_limiter` to prevent a runaway SPA from filling the table." There is no `@frappe.rate_limiter` decorator in the file. **Comment lies; fix the comment OR add the limiter.** Either is fine; both are not.

### 1.8 Dashboards / utilities / sundries (sample of the remaining ~80)

| Path:Line | Endpoint | Flag | Notes |
|---|---|---|---|
| `api/dashboard.py:4789,5472,5518,5531…5712` | per-section dashboard endpoints | 🟡 | `_check_profile_permission` is called at top of `get_dashboard_data` (L4604) + `get_dashboard_envelope` (L4830) — but the **section endpoints below `5472` are not consistently gated**; sample reads show they take `profile` and `company` as raw strings without re-checking permission. Need to call `_check_profile_permission(profile)` at the top of every `5472..5712` endpoint. |
| `api/utilities.py:227..938` | build/git/db/server stats | 🔴 | `get_remote_update_info` (L362), `get_database_usage` (L488), `get_server_usage` (L575), `log_client_error` (L903) all whitelisted with no role gate. **Any cashier can read the server's CPU, DB size, git log, slow-query count, run `git fetch` server-side.** Must gate to `System Manager`. |
| `api/utilities.py:741` | `get_available_languages` | 🟢 | safe |
| `api/utilities.py:793,827` | get/set user language | 🟢 | scoped to `frappe.session.user` |
| `api/pricing_rules.py:107` | `flush_pricing_rules_cache` | 🟢 | `frappe.has_permission("Pricing Rule", "write")` gate ✓ |
| `api/commercial_flow.py:243,288,376` | Quote→SO→SI conversion | 🟡 | mixes `is_supervisor` client flag + `frappe.has_permission("Delivery Note", "create")` (L413) — inconsistent |
| `api/sales_orders.py:20,86,139` | SO CRUD | 🔴 | `ignore_permissions=True` on SO + PE inserts; SO `name` accepted from client without scope check |
| `api/purchase_orders.py:*` | PO CRUD (8 endpoints) | 🔴 | `ignore_account_permission=True` everywhere; supplier creation behind `posa_allow_create_purchase_suppliers` flag only |
| `api/gift_cards.py:435,488,523` | gift-card CRUD | 🔴 | `ignore_account_permission=True` (L120); financial primitive with no role gate beyond `posa_allow_supervisor_manage_gift_cards` POS-Profile flag |
| `api/stored_value.py:17,27` | redeem / summary | 🟡 | partial validation; financial primitive |
| `api/offers.py:15..105` | promotional schemes | 🟢 | read-only with profile scope |
| `api/item_processing/search.py:564,667,676` | catalog search | 🟡 | profile-scoped but `pos_profile` JSON is trusted as filter |
| `api/offline_sync/*.py` | snapshot endpoints | 🟡 | session-bound; bulk download path — needs RL |
| `doctype/pos_closing_shift/closing_processing/creation.py:81,246` | open/close shift | 🟡 | shift owner check exists in `closing_processing/creation.py:250` via `ignore_permissions=True` after manual ownership match |

### 1.9 Method-allowlist coverage

Out of 168 whitelisted endpoints, exactly **one** has `methods=["POST"]` (`telemetry.ingest`). Every other write endpoint accepts `GET` too. Frappe will happily route a `submit_invoice` over `GET`, which means: (a) it shows up in browser history and proxy logs with the full JSON body in the query string, (b) preflight / SameSite cookie protections for state-changing GETs are non-trivial. **Add `methods=["POST"]` to every write endpoint.**

---

## 2. Multi-tenant isolation gaps

Frappe's multi-tenancy is per-site (separate DB per tenant). That means tenant isolation is achieved at the *connection* layer, not the *query* layer. So in theory a query inside site A's process can never see site B's data. In practice the worry is different:

1. **One DB site, many cashiers in many shops/companies in one tenant.** This is the *current* doco prod model. `company` and `pos_profile` are taken from client input and never re-validated server-side against the caller's allowed companies/profiles. A cashier authenticated for `Company A` can pass `company=Company B` in any payment query and get back data they shouldn't see.
2. **Cross-tenant via shared SaaS bench (boat plan).** Frappe sites are isolated by HTTP host header. As long as the host header routing is solid and you don't share Redis namespaces (you can — see §10) you're OK. But the surface is small and load-bearing — any whitelisted endpoint that reads `frappe.flags` set by a previous request, or that runs in a background queue with `frappe.set_user`, can leak.

### 2.1 File:line list of unscoped queries

| File:Line | Query | What's missing |
|---|---|---|
| `api/customers.py:56-82` | `get_customer_balance(customer)` → raw SQL on `tabGL Entry` | no `company` filter, no role check, no scope verification that this customer belongs to caller's profile |
| `api/customers.py:204-289` | `get_customer_info(customer, company)` → returns email/mobile/tax_id/address/loyalty | no scope: any customer name returns full PII |
| `api/customers.py:256-280` | raw SQL JOIN `tabAddress`/`tabDynamic Link` | no company filter |
| `api/customers.py:463-487` | `get_customer_addresses(customer)` | same — no scope |
| `api/customers.py:489` | `make_address` accepts arbitrary `doctype`/`customer` | no scope; can create an address linked to anyone |
| `api/customers.py:428-461` | `set_customer_info(customer, fieldname, value)` writes via `frappe.db.set_value("Customer", customer, ...)` | mass-assignment; any cashier can rewrite mobile/email/loyalty_program of any customer name they can guess |
| `api/payments.py:348-455` | `get_available_credit(customer, company)` | accepts both as raw strings, never checks that caller can see them |
| `api/payments.py:367-382` | raw SQL on `tabPayment Entry Reference` / `tabPayment Entry` | filter is by `reference_name in (…)`, derived from `outstanding_invoices` filter that does include `company` — but caller chose `company`, no role guard |
| `api/invoices.py:45-104` | `get_draft_invoices(... is_supervisor=0)` | `is_supervisor` is a **client-supplied integer**. If `1`, scope expands to `company`+`pos_profile`+`cashier` filters that aren't double-checked against caller roles. Cashier sends `is_supervisor=1` → sees all drafts in the company. |
| `api/invoices.py:107-118` | `get_draft_invoice_doc(invoice_name, doctype)` | no scope at all — any invoice name returns full doc |
| `api/invoices.py:121-139` | `delete_invoice(invoice)` | only checks `posa_is_printed`; any logged-in user can delete any draft |
| `api/invoices.py:164-178` | `create_sales_invoice_from_order(sales_order)` | `make_sales_invoice` then `ignore_permissions=True` |
| `api/invoices.py:181-190` | `delete_sales_invoice(sales_invoice)` | `frappe.delete_doc(..., force=1)` — destroys any SI name passed |
| `api/invoice_processing/creation.py:712-935` | `update_invoice(data)` | accepts entire invoice payload from client, `flags.ignore_permissions = True` + `frappe.flags.ignore_account_permission = True` at L925-926 |
| `api/invoice_processing/creation.py:938-1211` | `submit_invoice(invoice, data)` | same. Client controls `pos_profile`; that's the only "scope". |
| `api/invoice_processing/returns.py:15,342` | search + fetch invoice for return | `invoice_name` only; no caller-can-see check |
| `api/sales_orders.py:20-152` | SO + payment-entry creation | three `ignore_permissions=True` + `ignore_account_permission=True` |
| `api/purchase_orders.py:705,846,236` | PO ops | three `ignore_account_permission=True` |
| `api/gift_cards.py:120` | gift-card issue/redeem | `ignore_account_permission=True` for the JE/PE underlying entries |
| `api/m_pesa.py:20-45` | `confirmation` guest insert | no company scope — could insert into any tenant's MPesa Payment Register if the host header lands on it; that's the routing layer's job, but the *app* doesn't validate the BusinessShortCode against this tenant's configured shortcodes either |
| `api/payment_processing/data.py:135,260,549,560` | payment helpers | partial company filter; sample at L549 accepts `pos_profile` from client without re-checking |
| `api/utilities.py:227-275` | `get_remote_update_info` runs `git fetch` / `git log` server-side | not tenant-scoped, but also not role-gated — any cashier can issue a `git fetch` |

### 2.2 The pattern

Compare to `taller`'s `laboratorio` scope and `mercado`'s `shop` scope — those apps wrap every query through a `scope_filter()` helper that re-derives the tenant key from `frappe.session.user`'s role profile and intersects with whatever the client requested. **posawesome has no such helper.** Closest equivalent is `get_customer_groups(pos_profile)` in `api/customers.py:18-28`, but that only scopes customers, not invoices, payments, or addresses, and `pos_profile` itself is taken from client without re-checking it's one of the caller's assigned profiles.

### 2.3 Required pattern (mandatory before SaaS)

Add `posawesome/posawesome/api/_scope.py`:

```python
def get_allowed_companies(user=None):
    """Companies this user can act on. Cached per-request."""

def get_allowed_pos_profiles(user=None):
    """POS Profiles this user is assigned to via POS Profile User."""

def assert_company(user, company):
    if company not in get_allowed_companies(user):
        frappe.throw(_("Not permitted for company {0}").format(company),
                     frappe.PermissionError)

def assert_profile(user, pos_profile):
    if pos_profile not in get_allowed_pos_profiles(user):
        frappe.throw(_("Not permitted for POS profile {0}").format(pos_profile),
                     frappe.PermissionError)

def assert_customer_in_profile(user, customer, pos_profile):
    """Customer must be in one of the profile's customer_groups."""
```

Then call `assert_company` / `assert_profile` at the top of every write endpoint, and `assert_customer_in_profile` everywhere the caller passes a `customer` name. This is ~50 call-site additions. Estimated 1 week.

### 2.4 `permission_query_conditions`

`hooks.py:95-101` keeps `permission_query_conditions` and `has_permission` **commented out**. Frappe's built-in list-permission gating relies on these hooks for app-defined doctypes. POSAwesome ships several DocTypes (POS Coupon, POS Gift Card, POS Cash Movement, POS Closing Shift, POS Telemetry Event, etc.) that have no list-permission filter. **For every POS Awesome doctype that holds tenant-relevant data**, define a `permission_query_conditions` callable in `hooks.py` so Frappe's standard `frappe.get_list` calls (including from non-POSA UI) cannot cross profile/company boundaries.

---

## 3. Payment surface — tampering window

**Bottom line: the server does not independently re-compute the total. The client tells the server what the total is, and the server saves it.**

### 3.1 The flow

1. Client builds an invoice JSON in `frontend/src/posapp/composables/pos/payments/usePaymentSubmission.ts` (and friends), with `items[]`, `payments[]`, `discount`, `taxes`, `grand_total`, `paid_amount`, etc.
2. SPA calls `update_invoice(data)` (`creation.py:712`). Server:
   - `json.loads` the payload (L715)
   - `invoice_doc.set_missing_values()` (L817) — recalculates taxes & rates **using the rates from the items in the payload**. If the client sent `rate=1` for a $1000 item, set_missing_values will multiply by qty and that's the new line total. ERPNext's `set_missing_values` does NOT re-fetch rates from the Item Price master unless `ignore_pricing_rule` is unset — and **L811-812 explicitly sets `ignore_pricing_rule = 1` and `flags.ignore_pricing_rule = True`**.
   - `calculate_taxes_and_totals()` is implied through `set_missing_values` (or via L834 in the locked-items branch). This DOES re-sum line totals — but only after the client's per-line rates have been blessed.
   - Save with `flags.ignore_permissions = True` (L925), `frappe.flags.ignore_account_permission = True` (L926).
3. SPA calls `submit_invoice(invoice, data)` (`creation.py:938`):
   - Looks up by `client_request_id` for idempotency (good).
   - Re-runs validations, calls `invoice_doc.submit()`.
4. Background `submit_in_background_job` may run; same trust model.

**The server never independently re-prices items.** The client's `rate` is the truth. Combined with `ignore_pricing_rule = 1`, a malicious cashier who can call `update_invoice` (which is every cashier) can submit any invoice for any amount.

### 3.2 Where the tampering windows live

| Field | Tamper-able? | Where re-checked? |
|---|---|---|
| `items[i].rate` | ✓ | nowhere. `set_missing_values` keeps it. |
| `items[i].qty` | ✓ | stock validation `_validate_stock_on_invoice` only checks availability |
| `items[i].discount_percentage` / `discount_amount` | ✓ | `_resolve_write_off_limit` clamps write-off only |
| `grand_total` / `rounded_total` | recomputed by `calculate_taxes_and_totals` from items | so changing this alone doesn't help; you have to change line rates |
| `payments[i].amount` | ✓ | `_resolve_payment_amounts(payment, conversion_rate)` only re-derives from `payment.amount` itself + conversion rate; doesn't re-check against grand_total |
| `paid_amount` / `base_paid_amount` | ✓ but recomputed at L708-709 as `sum(p.amount for p in payments)` | so this is OK if individual `payment.amount` was OK, but those aren't checked |
| `conversion_rate` | partial — `get_latest_rate` at L848 if missing; but client-supplied value at L791-794 wins if it's there | partial |
| `selling_price_list` | ✓ — server resolves via `_resolve_effective_price_list` (L784) | partial |
| `pos_profile` | ✓ | never checked against caller's allowed profiles |
| `customer` | ✓ — auto-creates if missing (L756-772) with `ignore_permissions=True` | 🔴 cashier can auto-create a customer by passing any string |
| `is_return` + `return_against` | partial — `validate_return_items` only checks item match | doesn't verify the return-against invoice belongs to caller's scope |

### 3.3 The fix

```python
# Inside update_invoice, before set_missing_values:
from posawesome.posawesome.api._scope import assert_profile, assert_customer_in_profile
from posawesome.posawesome.api._reprice import reprice_invoice_items

assert_profile(frappe.session.user, invoice_doc.pos_profile)
assert_customer_in_profile(frappe.session.user, invoice_doc.customer, invoice_doc.pos_profile)

# Re-price every line against the price list, ignoring the client's `rate`.
# Apply pricing rules SERVER-SIDE (with `ignore_pricing_rule = 0`).
reprice_invoice_items(invoice_doc)

# Cap discount per POS profile setting (already exists for write-off; need same for discount).
enforce_discount_limit(invoice_doc, profile_doc)

# Re-validate payment totals match grand_total.
assert_payments_match_grand_total(invoice_doc)
```

The "cashier may edit rate" flag (`posa_allow_user_to_edit_rate`) is OK as a UX gate but must be honored server-side too: only re-allow client `rate` if the caller's profile permits it, and even then within a configurable band of the Item Price master (e.g. ±20%).

### 3.4 Double-submit prevention

`client_request_id` mechanism in `idempotency.py` + `POS Invoice Submission Ledger` is **good**. This is the one part of the payment flow that's actually solid. Two windows still bother me:

1. **`update_invoice` is NOT idempotent.** Only `submit_invoice` is. A client doing `update → submit → retry submit` is safe; a client doing `update → update → submit` can produce different drafts if the first network blip is interpreted as a failure.
2. **`repair_invoice_submission`** (L1318) — useful for recovering ledger state, but accepts `client_request_id` from client. If the attacker knows a `client_request_id` they can call `repair` to (according to the docstring) "reconcile an incomplete durable submission ledger row without creating a new invoice." Need to verify this can't escalate; suspicion: low risk, but flagged.

### 3.5 Change calculation

`_create_change_payment_entries` (imported from `invoice_processing.payment`) handles change. `repair_overpayment_change_allocations` (`payments.py:535`) exists specifically to fix historical bugs where Pay entries were left unallocated. **The very existence of this endpoint tells you the change flow has had real bugs.** Add a regression test that exercises overpay → change → cancel → re-allocation, and run it as part of CI.

---

## 4. AuthN / AuthZ

### 4.1 What authenticates

- **Frappe session cookie** (`sid`) for the SPA. Set by `/login`. CSRF token issued via `frappe.sessions.get_csrf_token()` (`www/posapp.py:77`) and rendered into the SPA boot payload at `www/posapp.html:71`.
- **Cashier PIN** for in-shift cashier switching (`api/employees.py:152` `verify_terminal_employee_pin`). PIN is a 4-8 digit numeric string stored in `User.posa_pos_pin` via `set_password` (so it's hashed by Frappe).

### 4.2 What can go wrong

| Vector | Detail | File:Line |
|---|---|---|
| **PIN brute force** | No lockout, no rate-limit, non-constant-time `stored_pin != pin` compare | `api/employees.py:166` |
| **Cashier PIN reset** | A cashier who can call `save_cashier_pin` with `{user: <victim>, new_pin: <new>, current_pin: <victim's>}` resets the victim's PIN if they know the victim's current. They learn the current because **the lockout above doesn't exist**, so they can guess it. Roadmap S5 already flagged this. | `api/employees.py:199` |
| **Role profile misuse** | `is_supervisor` is sent as a *client integer* in `get_draft_invoices` (`api/invoices.py:53`) and `commercial_flow.py:252`. Never re-checked against `frappe.get_roles(frappe.session.user)` | |
| **`ignore_permissions=True` blanket** | Used on `pr.insert` (`payments.py:186`), `jv_doc` flags (`payments.py:275`), `payment_entry_doc.flags` (`payments.py:325`), every invoice flow (`creation.py:925`, `1121`, `1238`), telemetry (`telemetry.py:145`), every workspace patch | systemic |
| **`ignore_account_permission`** | Used 11 times in `api/*.py` + `cash_movement/posting.py:55,73`. This bypass exists in ERPNext to let pricing rules write GL entries; here it's used so a cashier can write Journal Entries directly. Acceptable for cash movement (because that code path runs its own permission gates first) but blanket in invoice/SO/PO/gift-card flows | systemic |
| **API key surface** | Frappe lets users issue `api_key`/`api_secret` per user. POSA doesn't restrict this. Anything reachable with a session is reachable with an API key. Need to disable API key issuance for the `POS Cashier` role profile, or scope by IP/CIDR. | n/a (Frappe layer) |
| **No re-authentication for high-impact actions** | Deleting a draft invoice, cancelling a submitted cash movement, resetting a PIN — none require re-entry of password/PIN. | systemic |
| **`frappe.only_for("System Manager")`** | Used exactly once in the entire API (`api/qz.py:108`). Server-stat / git endpoints that should require it (utilities.py:362, 488, 575, 903) do not. | `utilities.py:*` |

### 4.3 Role profile

Fork ships exactly one custom role: `POS Awesome Supervisor` (`hooks.py:374`). There is no `POS Cashier` role, no `POS Manager` role; existing usage assumes Frappe stock roles ("Sales User", "Sales Manager", "Accounts Manager", "System Manager"). The dashboard summary endpoint (`telemetry.py:198`) requires `System Manager` or `POS Manager` — the latter doesn't exist in fixtures. **The PII-readable side of the app is keyed off roles that aren't shipped.** Need a role profile fixture that defines: POS Cashier, POS Supervisor, POS Manager, with documented permission boundaries.

---

## 5. Frontend secrets / PII / payment data in storage

### 5.1 What's stored where

| Store | Key | Sensitive? | File:Line |
|---|---|---|---|
| `localStorage` | `posawesome_version`, `posawesome_update_dismissed`, `posawesome_update_last_check` | no | `loader.ts:287-289` |
| `localStorage` | `posa_<key>` for selected settings keys (CACHE_VERSION, MANUAL_OFFLINE, BOOTSTRAP_SNAPSHOT, BOOTSTRAP_LIMITED_MODE, …) | mixed — bootstrap_snapshot can hold POS Profile defaults | `offline/db.ts:111-121, 639` |
| `localStorage` | `qz_cert_ready`, `qz_manual_disconnect`, `qz_printer_name` | no | `posapp/services/qzTray.ts:186-331` |
| `localStorage` | `customer_scope_storage_key` | no — just last selected scope | `customersStore.ts:53` |
| `localStorage` | `customer_display_storage_key` (envelope JSON of last receipt — **includes line items + customer name**) | 🔴 PII | `posapp/utils/customerDisplay.ts:173` |
| `localStorage` | `use_western_numerals`, `posawesome_hide_non_essential_fields`, `posawesome_invoice_height`, `networkOnline`, `serverOnline`, theme key | no | various |
| `sessionStorage` | `chunkRecoveryTerminal`, `chunkRecoveryInProgress`, `chunkReload`, `chunkCacheRecovery` | no | `chunkLoadRecovery.ts:182-220` |
| `IndexedDB` (`posawesome_offline` via Dexie) | `items`, `item_prices`, `customers`, `pos_profiles`, `opening_shifts`, `local_stock`, `coupons`, `item_groups`, `translations`, `pricing_rules`, `settings`, `sync_state`, `invoice_outbox`, `write_queue`, `queue`, `cache`, `keyval` | 🔴 yes | `offline/db.ts:43-65` |

### 5.2 What that means

- **The `customers` IDB table** stores `&name,customer_name,mobile_no,email_id,tax_id` for **every customer in the caller's POS profile customer-groups**. That's full PII at rest, unencrypted, in the browser's IDB. A shared POS terminal at end of shift retains all that data until `clearAllCaches.ts` is invoked.
- **The `invoice_outbox` table** stores pending invoices including items + payments + customer. A pending invoice for a customer with full name + line items + amount is PII + financial data at rest, in the browser, unencrypted.
- **`customer_display_storage_key`** (`customerDisplay.ts:173`) writes the *current receipt payload* — customer name, line items, totals — into `localStorage` for the secondary customer-facing display to pick up via `storage` events. **This is PII in localStorage, and `localStorage` is readable by any same-origin script (XSS, extension).**
- **No credit-card data, no CVVs, no PANs** are anywhere in the codebase. Good. (M-Pesa MSISDN is in IDB cache via `customers` and in `Mpesa Payment Register` server-side — that's PII but not card data.)
- **CSRF token** is in `window.posawesome_csrf_token` only (not localStorage). OK.
- **No session token in JS** — it's the `sid` httpOnly cookie. OK.

### 5.3 Required fixes

1. **Encrypt IDB at rest.** Dexie supports an encryption add-on (`dexie-encrypted`), but the encryption key has to live somewhere. Options: (a) prompt cashier to enter a passphrase at shift open, derive key via PBKDF2/Argon2; (b) fetch a per-user key from the server at boot — defeats the offline goal; (c) use the `CryptoKey` API with a non-extractable key generated at first launch and persisted via IDB itself (XSS-resistant but useless against same-origin malware). For PCI-DSS-adjacent, (a) + an idle-timeout that clears IDB after N minutes of inactivity is the only one that auditors will accept.
2. **Stop putting receipt payloads in `localStorage`.** Use `BroadcastChannel` (the customer-display channel sessionStorage entry already implies this is the plan) or `postMessage` to a `window.opener`. Either is XSS-equivalent but doesn't *persist* PII.
3. **`clearAllCaches` on session-end.** Wire to `beforeunload` and on `sid` cookie expiry. Currently a manual user action.
4. **Set `Content-Security-Policy` to disable extension injection** of receipt-scraping scripts on the POS origin.

---

## 6. Supply chain

### 6.1 Dependency manifest

- `package.json` (repo root, Electron + tooling) — exact pins for `vuetify@^3.7.5` (semver caret), `vue@^3.3.4`, `dexie@^4.0.11`, `socket.io-client@^4.8.1`. **All caret ranges.**
- `frontend/package.json` — same situation, except `vuetify@^3.12.6`. Plus `qz-tray@2.2.5` (exact), `@vuepic/vue-datepicker@11.0.2` (exact).
- `yarn.lock` is present (both root and `frontend/`) — locks are committed.
- `package-lock.json` is **explicitly in `.gitignore` (line 14)**. Yarn-only. OK as long as everyone uses Yarn, but mixing npm/yarn on the same lockfile-less repo is asking for drift; **document yarn-only in README**.
- `pyproject.toml` — Python deps section is empty (`dependencies = [# Core dependencies]`). All Python is sourced via `frappe` + `erpnext`. Ranges in `[tool.bench.frappe-dependencies]`: `frappe>=15.0.0`, `erpnext>=15.0.0`. **Unbounded upper.**

### 6.2 What's missing

- **No `npm audit` / `yarn audit` step in CI.** `.github/workflows/ci-frontend.yml` runs `yarn install --frozen-lockfile` + type-check + lint + unit tests. No audit. **Add `yarn audit --severity high` (allowed to fail until clean, then promote to required).**
- **No Python `pip-audit` / `safety` in CI.** `ci-backend.yml` installs `ruff` + `frappe-bench` and runs syntax smoke + a couple of offline-sync unit tests. **Add `pip-audit -r requirements-dev.txt` plus an audit of the installed Frappe + ERPNext venv.**
- **No SBOM emission.** SaaS = SBOM. `syft` against the built docker image is the cheapest path. Add it to `release.yml`.
- **Vendored deps**: `frontend/src/libs/dexie.min.js` is a vendored copy of Dexie (`grep "Dexie SchemaDiff"` shows full minified bundle). Vendored to bypass the worker dynamic-import limitations (per `frontend/src/posapp/workers/itemWorker.js:34`). Pin version + record in a `THIRD_PARTY.md` + add a hash check at build time.
- **Subprocess git calls** (`api/utilities.py:201-360`) invoke the `git` binary. Path-injection-safe (uses argv array, not shell=True). But the `git fetch origin --prune --quiet` line will trigger `core.sshCommand` / `gpg` hooks if the operator's home dir has them; on a multi-tenant container this is a sandbox-escape primitive. **Confine `git fetch` to a `--git-dir=` + `GIT_CONFIG_NOSYSTEM=1` + `GIT_TERMINAL_PROMPT=0` env or rip out the git endpoints entirely.** Tenants do not need to read server-side git state from the SPA.

### 6.3 Outdated / EOL

- `frappe-bench` install in CI pins to `version-15` (`ci-backend.yml:69`). App targets `frappe>=15` and `>=16` per ARCHITECTURE.md §6. **Mismatch — CI tests on v15, prod runs v16.** Pick one.
- `electron-builder` not pinned at repo root.
- `nunjucks@^3.2.4` — known CVEs in <3.2.4, current pin is safe but caret allows new releases without review.
- Python target: `requires-python = ">=3.10"`, but ARCHITECTURE.md says prod is Python 3.14. The version range `>=3.10` won't *break* on 3.14, but downstream wheels (`cryptography` for QZ signing) need re-built for 3.14. Worth noting.

---

## 7. CSRF, CORS, security headers

### 7.1 Current state

- **CSRF**: Frappe's standard pattern. SPA gets a token from `frappe.sessions.get_csrf_token()` (server) and sends it back in `X-Frappe-CSRF-Token` (frontend at `frappe-shim.ts:113,288,390`). Token is the same per session — **rotates only on login**. Per-request rotation not implemented.
- **CORS**: not configured in this repo. Frappe defaults to "no CORS" — same-origin only. As long as the SPA is served from the same host as the API (which it is at `/posapp` and `/app/posapp`), CORS doesn't apply. If a future deployment exposes the API on a separate domain (e.g. `api.docomexico.com`), CORS will need explicit allowlist.
- **Security headers**: nothing in `posawesome/www/posapp.py` or `posawesome/www/posapp.html` sets any. Frappe's reverse proxy (`muelle/proxy/`) is where these would land. Sample `curl -I https://ventas.lab.xoloitzcuintles.com/posapp` would tell us; I can't run that from here. Assume **none of CSP / HSTS / X-Frame-Options / Referrer-Policy / X-Content-Type-Options / Permissions-Policy / COOP / COEP are set** unless ops added them at the proxy.

### 7.2 Helmet-equivalent header set required

```
Content-Security-Policy:
    default-src 'self';
    script-src 'self' 'sha256-<computed for inline boot tag>';
    style-src 'self' 'unsafe-inline';   # Vuetify injects style tags
    img-src 'self' data: blob: https://<cdn-if-any>;
    font-src 'self' data:;
    connect-src 'self' wss://<site>;    # socket.io
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    upgrade-insecure-requests;
    report-uri /api/method/posawesome.posawesome.api.telemetry.csp_report;
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Camera scanning (`@techstark/opencv-js`, `vue-qrcode-reader`) needs `camera=(self)` in `Permissions-Policy`. Service worker registration at `/sw.js` is same-origin and fine. **Inline boot script** in `posapp.html:71` (`window.posawesome_csrf_token = {{ csrf_token | tojson }}`) requires either `'unsafe-inline'` (bad) or a sha256 / nonce (good). Frappe doesn't currently set nonces; **add a nonce in the Jinja template and propagate to CSP** as part of the security PR.

### 7.3 Specific gaps

- **No `frame-ancestors`** = current default — POSAwesome is iframe-able. A clickjacking attack via a 3rd-party site hosting it as an iframe and overlaying a payment-confirm button is feasible. `X-Frame-Options: DENY` closes this.
- **No `Referer-Policy`** — outbound links to print-format previews / external print services leak full URL including any query-string args.
- **No COOP/COEP** — disables SharedArrayBuffer-based attacks on the OpenCV.js worker. Phase 3 of `3-SIGMA.md` plans SharedWorker for catalog; that requires COOP/COEP or it won't work in modern browsers.

### 7.4 CORS rules (for SaaS multi-tenant)

Per-tenant subdomain (`<tenant>.docomexico.com/posapp`). Same origin per tenant = no CORS configuration needed inside the app. **Required**: Frappe-level `host_name` allowlist + nginx-level `server_name` allowlist on the proxy (`muelle/proxy/`). If you ever expose POS endpoints on a tenant-shared API host, add `Access-Control-Allow-Origin: <exact tenant origin>` + `Access-Control-Allow-Credentials: true` + per-method allowlist; never `*`.

---

## 8. Logging + audit

### 8.1 What's logged

- **Frappe Error Log** — `frappe.log_error(title, message)` calls. 54 callsites in `api/` (excluding tests/`__pycache__`). Used for: telemetry ingest failures, customer balance fetch errors, language errors, M-Pesa confirmation failures (with full traceback at `m_pesa.py:43`), POS background submission failures (with `error_msg` at `creation.py:1310`).
- **POS Telemetry Event** doctype — operator-facing RUM events with caps:
  - `event_name` (≤64 chars, prefix allowlist)
  - `value` (float)
  - `terminal`, `pos_profile`, `build_version`, `user_agent` (length-capped)
  - `metadata` (≤4096 chars JSON)
  - `user = frappe.session.user`
- **POS Invoice Submission Ledger** — durable per-invoice state, holds `client_request_id`, payment_context (full payments JSON), invoice name. **Includes payment amounts but no card data.**
- **Logger.info** in `api/utils.py:190-194` dumps `json.dumps(sales_persons)` to stdout. Sales person names = PII-adjacent. Cap it.
- **Custom `frappe.log_error("[POSA_PERF] event=...")` lines** when `posa_perf_log_enabled` is set — bounded, structured, OK.

### 8.2 What leaks

| Leak | File:Line | Severity |
|---|---|---|
| Full M-Pesa callback traceback including `args` (MSISDN, name, amount) is logged via `frappe.log_error(frappe.get_traceback(), str(e)[:140])` whenever a callback hits | `api/m_pesa.py:43` | 🔴 PII + financial in Error Log |
| `log_client_error` writes user + site + arbitrary client payload into Error Log title/message | `api/utilities.py:903-929` | 🟡 — has `_sanitize_client_error_payload` (good), but title includes `kind` from client (`api/utilities.py:915`) |
| `frappe.log_error(f"Error fetching customer balance: {e}")` on exception in `get_customer_balance` — could include customer name in `e` | `api/customers.py:80` | 🟡 |
| `frappe.log_error(f"Failed to create customer {customer_name}: {e}")` | `api/invoice_processing/creation.py:772` | 🔴 logs customer name |
| `logger.info("Found %s sales persons: %s", len, json.dumps(sales_persons))` | `api/utils.py:190-194` | 🟡 |
| `frappe.log_error(f"DB stats error: {db_exc}")` and similar — may include connection strings | `api/utilities.py:554` | 🟡 |
| `frappe.log_error(f"POS Background Submission Failed for {invoice}: {error_msg}")` — invoice name + DB error (could include customer name) | `api/invoice_processing/creation.py:1310` | 🟡 |
| **POS Telemetry `metadata` field** is operator-controlled and could carry PII if the SPA misbehaves | `api/telemetry.py:67-78` (4 KB cap, no PII filter) | 🟡 |

### 8.3 What's NOT logged but should be (compliance must-haves)

- **Authentication events**: cashier PIN attempts (success + fail), PIN resets, session creation/destruction. Frappe logs login attempts via `Activity Log` — verify it's enabled and retained.
- **Authorization failures**: every `frappe.throw(PermissionError)` should write a row in a dedicated `POS Security Event` doctype (or at least to the Error Log with a stable title).
- **Data access**: every read of `get_customer_info` (PII), `get_customer_addresses`, `get_available_credit`. GDPR Article 30 requires a record of processing activities.
- **Privileged operations**: every `delete_invoice`, `delete_sales_invoice`, `cancel_cash_movement`, `delete_cash_movement`, `save_cashier_pin`, payment-entry write.
- **Configuration changes**: POS Profile mutation, role grants, payment-gateway-account mutation.

### 8.4 Retention

- `prune_old_events` at `api/telemetry.py:256` drops `POS Telemetry Event` after 30 days (default). Wired to `scheduler_events.daily`. ✓
- **No retention policy on Frappe Error Log** — Frappe's default is 90 days or unbounded depending on `delete_old_logs` job. Verify.
- **No retention policy on POS Invoice Submission Ledger.** This holds full payment-context JSON for every invoice ever submitted. PCI-DSS guidance is "no longer than business need". Set 1-year retention + GDPR right-to-erasure hook.
- **Backups** (DB + files) — handled outside the app. **Encrypted at rest is a deployment-layer concern.** See §9.

### 8.5 Fix list

1. Strip MSISDN / FirstName / etc. from `m_pesa.confirmation` error log; log only `TransID` + error class.
2. Replace `customer_name` in `creation.py:772` log with `len(customer_name)`/redacted.
3. Add a structured `POS Security Event` doctype + helper `log_security_event(action, target, outcome)`.
4. Wire to: every `assert_*` failure in the new `_scope.py`, every PIN miss, every privileged op.
5. Set retention via a daily job: `POS Telemetry Event` 30 days, `POS Security Event` 2 years (GDPR + SOC2), `POS Invoice Submission Ledger` 1 year.

---

## 9. GDPR / SOC2 readiness

### 9.1 Data inventory

PII categories the app touches:

| Category | Doctype / store | Where created |
|---|---|---|
| Identity (name, mobile, email, tax ID, address) | `Customer`, `Address`, `Contact`, `Customer Display localStorage`, IDB `customers` | `api/customers.py:292-425`, customer-display |
| Loyalty profile | `Customer.loyalty_program` | `api/customers.py:430-431` |
| Birthday | `Customer.posa_birthday` | `api/customers.py:312-329` |
| Mobile network (MSISDN) | `Mpesa Payment Register` | `api/m_pesa.py:35` |
| Financial — transactions | `Sales Invoice`, `POS Invoice`, `Payment Entry`, `Journal Entry`, `POS Cash Movement`, `POS Invoice Submission Ledger`, `POS Gift Card Transaction` | various |
| Financial — credit balances | `Sales Invoice.outstanding_amount`, `Payment Entry.unallocated_amount` | `api/payments.py:348-455` |
| Employee data | `User.posa_pos_pin` (hashed) | `api/employees.py:199-228` |
| Operational logs | `POS Telemetry Event` (includes `user` + `user_agent`), `Error Log` (free-text incl. PII per §8.2) | telemetry + frappe |
| Browser cache | IDB `posawesome_offline` — `customers`, `invoice_outbox`, `write_queue`, `pos_profiles` | `frontend/src/offline/db.ts:43` |

### 9.2 Data-subject rights (DSR)

GDPR Article 15-22 requires:

| Right | Endpoint exists? | Notes |
|---|---|---|
| Right of access (Art 15) | ✗ | No endpoint exports a customer's data on request. Need `gdpr_export_customer_data(customer)`. |
| Right to rectification (Art 16) | partial | `update_customer` (`api/customers.py:376`) exists, but for ANY field with no audit trail. |
| Right to erasure (Art 17) | ✗ | `delete_invoice` exists but only for drafts; no "anonymise this customer's history" flow. Hard problem: invoices are immutable for accounting. Industry standard: replace PII fields with `redacted_<id>` while keeping financial ledger intact. |
| Right to restrict processing (Art 18) | ✗ | No mechanism. |
| Right to data portability (Art 20) | ✗ | Frappe has a generic JSON export; not customer-scoped. |
| Right to object (Art 21) | n/a | not applicable to transactional POS |

### 9.3 Encryption at rest

| Layer | State | Required |
|---|---|---|
| **DB (MariaDB)** | depends on deployment. `muelle/compose.yaml` does not mention `--ssl-ca` or encrypted tablespaces. **Default = unencrypted.** | Enable InnoDB tablespace encryption + per-tenant keyring (HashiCorp Vault transit / KMS), or move to a managed DB with encryption-at-rest. |
| **Site files (`sites/<tenant>/private/`)** including `qz/private-key.pem` | unencrypted on disk | At minimum `chmod 600` (the app already does this at `api/qz.py:134`), at best fs-level encryption (LUKS / encrypted ZFS). |
| **Backups (DB dump + tar of site)** | depends on `bench backup --compress`. Default = unencrypted. | `--encrypt` flag for `bench backup` exists; wire it. Per-tenant encryption key. |
| **S3 / object store** (if used) | unset in this repo | SSE-KMS, per-tenant CMK. |
| **Redis** (`muelle/compose.yaml` mentions redis services) | unencrypted by default; **shared across tenants by default** | Per-tenant Redis databases (DB index) + `requirepass` + TLS. |
| **IndexedDB browser cache** | unencrypted | See §5.3. |

### 9.4 Encryption in transit

- Frappe is fronted by an nginx in `muelle/proxy/` (per `muelle/CLAUDE.md`). TLS handled there.
- Socket.IO upgrades to WSS — `frappe-shim.ts:188` configures `transports:["websocket"]` with `withCredentials:true`. As long as the page is HTTPS, the socket is WSS. ✓
- Mpesa callback HTTP is from Safaricom over TLS — but **the endpoint accepts plain HTTP if you let it**. Force `Strict-Transport-Security` at the proxy.
- QZ Tray local connection is `wss://localhost:8181` (handled by QZ client). That's localhost-only, not a tenant concern.

### 9.5 Key rotation

- `qz/private-key.pem` validity: **11,499 days** (~31.5 years) per `api/qz.py:155` `not_valid_after(now + timedelta(days=11499))`. **Wildly out of policy** for SOC2. Set to 1 year, add a rotation job, distribute the new public cert to clients via the SPA.
- CSRF token rotation: per-session, not per-request. Acceptable.
- Per-tenant API tokens: not implemented. Required for the M-Pesa shared secret + payment gateway secrets.
- DB/backup encryption keys: not in scope of this repo. Document the rotation policy in `muelle/`.

### 9.6 SOC2 control gaps (quick view)

| Control | Status |
|---|---|
| CC6.1 Logical access — least privilege | 🔴 `ignore_permissions=True` blanket |
| CC6.2 Authentication | 🟡 session OK, PIN weak |
| CC6.3 Authorization | 🔴 no permission_query_conditions for app DocTypes |
| CC6.6 Encrypt sensitive info | 🔴 IDB + private-key validity |
| CC6.7 Restrict portable media / removable storage | n/a |
| CC6.8 Detect + remediate malicious code | 🔴 no SBOM, no audit step in CI |
| CC7.1 Detect anomalies | 🟡 telemetry exists, no alerting |
| CC7.2 Monitor system components | 🟡 server stats endpoints exist but unauthenticated to cashiers |
| CC7.3 Incident response | ✗ no runbook |
| CC7.4 Recovery | ✗ no documented restore drill |

### 9.7 PCI-DSS-adjacent

POSAwesome doesn't store PANs/CVVs (verified §5.2). So strictly speaking it's not in PCI scope. **But** because it submits to payment gateways (`erpnext.accounts.doctype.payment_request.payment_request`) and integrates M-Pesa, it's "adjacent" — the cardholder data is handled by the gateway, but a compromise of the SPA can intercept the redirect URL and replace the merchant identifier. Treat it as PCI-DSS SAQ A-EP scope. Required: TLS everywhere, no card data ever touches the app's DB (verify by lint + regex CI gate: `grep -P 'pan|card_number|cvv'` returns nothing), MFA on the admin role.

---

## 10. PR-worthy security fixes for upstream

`defendicon/POS-Awesome-V15` accepts PRs against `stage-develop`. Group:

### PR 1 — "Tenant scope: add `_scope.py` helpers + apply to invoice/payment/customer endpoints"

- Add `posawesome/posawesome/api/_scope.py` with `assert_company`, `assert_profile`, `assert_customer_in_profile`, `get_allowed_companies`, `get_allowed_pos_profiles`.
- Wire to: `update_invoice`, `submit_invoice`, `delete_invoice`, `delete_sales_invoice`, `get_draft_invoice_doc`, `get_customer_info`, `get_customer_addresses`, `get_customer_balance`, `get_available_credit`, `create_sales_invoice_from_order`, `repair_invoice_submission`, `get_invoice_for_return`, `search_invoices_for_return`.
- Drop the client-supplied `is_supervisor` arg from `get_draft_invoices` and `commercial_flow.get_*` — re-derive from `frappe.get_roles(session.user)`.
- Add `permission_query_conditions` hooks in `hooks.py` for `POS Invoice Submission Ledger`, `POS Cash Movement`, `POS Closing Shift`, `POS Opening Shift`, `POS Coupon`, `POS Gift Card`, `POS Telemetry Event`.
- Replace inline `frappe.db.set_value("Customer", customer, fieldname, value)` (`api/customers.py:431-442`) with a field allowlist (`{"loyalty_program", "mobile_no", "email_id"}`).

~2 weeks. **Required before SaaS.**

### PR 2 — "Server-side reprice + discount cap + payment-vs-total assertion"

- Add `posawesome/posawesome/api/_reprice.py` that re-fetches line rates from `Item Price` master scoped to `selling_price_list` and re-applies pricing rules with `ignore_pricing_rule = 0`.
- Wire to `update_invoice` + `submit_invoice` before `set_missing_values`.
- Add `enforce_discount_limit(invoice_doc, profile_doc)` honoring `posa_max_discount_allowed` server-side.
- Add `assert_payments_match_grand_total(invoice_doc)` allowing a configurable rounding tolerance.
- Honor `posa_allow_user_to_edit_rate` server-side — if not set, drop client `rate` entirely and use master.
- Restrict customer auto-create at `creation.py:756-772` to a role allowlist; otherwise reject with `frappe.PermissionError`.

~1 week.

### PR 3 — "M-Pesa callback hardening + QZ sign envelope + PIN lockout + method allowlist"

- `api/m_pesa.confirmation`: require Safaricom IP allowlist (configurable per site in `Mpesa C2B Register URL`), require an HMAC of the body against a per-tenant shared secret stored in Site Config. Drop `**kwargs` blanket — accept explicit fields.
- Strip PII from error logs (MSISDN/name redaction) at `api/m_pesa.py:43`.
- `api/qz.sign_message`: gate to a new role `POS Awesome Print Authority` AND validate the message is a JSON envelope with required fields (`{"call":"qz.*", ...}`); reject anything else.
- Reduce QZ cert validity to 365 days at `api/qz.py:155` + add a setup re-run path.
- `api/employees.verify_terminal_employee_pin`: replace `stored_pin != pin` with `hmac.compare_digest`; add lockout counter (Redis-backed key `posa_pin_attempts:<user>` with 5 attempts / 15min window); reject PIN reset unless caller is supervisor OR is the same user re-authenticating with password.
- Add `methods=["POST"]` to every write endpoint (sweep `api/`).

~1 week.

### PR 4 — "Audit logging + retention + telemetry hardening"

- New doctype `POS Security Event` (action, target_doctype, target_name, outcome, user, terminal, timestamp).
- Helper `log_security_event(...)`; wire to all `assert_*` failures, PIN events, privileged ops.
- Wire **real** rate limiting to `telemetry.ingest` (`@frappe.rate_limiter(limit=10, seconds=1)` per session); fix the lying docstring at `telemetry.py:21`.
- Strip PII from log messages: `customer_name` → `customer_id[:6]+"…"` redact (`creation.py:772`, `customers.py:80`, `utils.py:190`).
- Daily retention job for `POS Security Event` (730 days), `POS Invoice Submission Ledger` (365 days), `Error Log` containing POSA titles (90 days).

~1 week.

### PR 5 — "Security headers + CSP nonce + CI audit"

- `posawesome/www/posapp.html` + `posapp.py`: emit a per-request nonce, propagate to CSP via response header.
- Add a hook to `set_security_headers` in `hooks.py` (Frappe has a place for it) injecting CSP/HSTS/X-Frame-Options/Referrer-Policy/Permissions-Policy.
- `.github/workflows/ci-frontend.yml`: add `yarn audit --severity high` step (allowed to fail until clean, then required).
- `.github/workflows/ci-backend.yml`: add `pip-audit` step against the bench venv.
- Add CI lint that greps for forbidden tokens in code: `pan`, `cvv`, `cc_num`, `card_number` (case-insensitive) — fails build.

~3 days.

Total upstream effort: ~5-6 weeks for one dev. PRs 1+2 are non-negotiable for SaaS; 3+4 unblock SOC2 prep; 5 is hygiene.

---

## 11. Doco-specific security carry-ons (stay in fork)

Things that don't belong upstream but that doco must run:

1. **Per-tenant configuration of M-Pesa shared secret + IP allowlist** — doco's Mexican market doesn't use M-Pesa; we still inherit the endpoint. Carry a fork patch that disables `allow_guest=True` entirely (raises `PermissionError`) until ops opt-in per site via `Mpesa C2B Register URL`. Upstream wants it on by default; we want it off by default.
2. **CFDI tax-ID format validation** at `api/customers.py:create_customer`. `tax_id` must match RFC pattern for ventas.docomexico. Carry as a fork-only `validate_rfc(tax_id)` call in `posawesome/posawesome/api/customer.py:validate`.
3. **doco-only role profile mapping**: doco runs a separate Frappe Role for cashier vs supervisor than the upstream `POS Awesome Supervisor`. Keep the doco role-profile fixture in `posawesome/posawesome/fixtures/role_profile.json` (currently not in repo — add for fork).
4. **Stricter discount cap** for doco (10% default) overriding upstream's "operator-set" model. POS Profile setting exists; carry the default value override via a `patches/set_doco_discount_default.py`.
5. **Telemetry endpoint disabled** for doco's `ventas` site by default. doco doesn't operate a dashboard yet; the table just fills. Carry `posa_telemetry_enabled` toggle in POS Profile.
6. **CSP nonce + header set** — upstream may push back on enforcing strict CSP because lots of POS deployments need third-party print extensions. For doco we want it strict; carry a fork patch that sets `CSP_MODE=strict` and reject the lenient default.

---

## 12. 6-sigma defect-rate implications — top 10 attack surfaces

Ranked by **likelihood × impact**. Likelihood = how easy is it for a random authenticated user to trigger; Impact = financial / PII / cross-tenant blast radius.

| # | Attack | File:Line | Likelihood | Impact | Score |
|---|---|---|---|---|---|
| 1 | **Invoice price tampering** — cashier sends `rate=0.01` for a $1000 item; server saves it. | `creation.py:712-935` (`update_invoice`) | high (any cashier) | high (direct revenue loss) | 🔴 9/10 |
| 2 | **`qz.sign_message` private-key oracle** — any session signs any message. | `api/qz.py:85-102` | high (any logged-in user) | critical (key compromise breaks signed-print non-repudiation; in a SaaS, breaks cross-tenant trust) | 🔴 9/10 |
| 3 | **M-Pesa `confirmation` guest insert** — unauthenticated HTTP creates `Mpesa Payment Register` rows. | `api/m_pesa.py:20` | medium (need to know the route) | high (financial-doc forgery, log poisoning) | 🔴 8/10 |
| 4 | **PIN brute force** — no lockout, non-constant-time compare. | `api/employees.py:166` | high (terminal kiosk reachable) | medium (supervisor escalation) | 🔴 8/10 |
| 5 | **Cross-customer PII read** — `get_customer_info(customer)` returns full PII for any customer name. | `api/customers.py:204` | high (any cashier) | high (GDPR breach) | 🔴 8/10 |
| 6 | **`is_supervisor` client-flag privilege escalation** — `get_draft_invoices(is_supervisor=1)` expands scope without role check. | `api/invoices.py:53-77` | high | medium (read all drafts in company) | 🟡 7/10 |
| 7 | **`set_customer_info(customer, fieldname, value)` mass-assignment** — passthrough to `frappe.db.set_value`. | `api/customers.py:428-461` | medium (need to know fieldnames) | high (loyalty rewrite, contact hijack) | 🟡 7/10 |
| 8 | **`delete_sales_invoice` / `delete_invoice` without scope** — any draft SI/POSI deletable. | `api/invoices.py:121,181` | medium | medium-high (operational sabotage, regulatory non-compliance if draft is a CFDI that should be cancelled not deleted) | 🟡 6/10 |
| 9 | **Server-side `git fetch` / DB stats from cashier session** | `api/utilities.py:362,488,575` | medium | medium (info disclosure, side-channel into bench process) | 🟡 6/10 |
| 10 | **IDB customer table at rest, unencrypted** — full PII at every POS terminal. | `frontend/src/offline/db.ts:55` (Dexie `customers` store) | high (any local actor / extension) | medium (GDPR breach scope = all customers in profile, but local-only) | 🟡 6/10 |

Honorable mentions that didn't make top-10:
- Customer auto-create at `creation.py:756-772` with `ignore_permissions=True` — silent customer-record pollution.
- `submit_in_background_job` re-impersonates via `frappe.set_user(user)` (need to verify) — if the queued kwargs are tamperable through Redis, that's a privesc path.
- `create_payment_request` (`payments.py:23`) submits a Payment Gateway-bound payment request without verifying that the gateway account belongs to the same company.
- `repair_overpayment_change_allocations` (`payments.py:535`) — operator can run a "best-effort" repair across historical invoices; combined with `delete_invoice`, could be used to laundry-list bad allocations.

### 12.1 Defect-rate math (6σ = 3.4 DPMO)

At ~150 whitelisted endpoints × an estimated 0.5 defect-class-per-endpoint (this audit found 1 in 3 reviewed) × ~1000 transactions/day/tenant × N tenants, the inherent surface is **far above 3.4 DPMO** until §10 PR 1+2 land. After PR 1+2, the surface is gated by **scope assertions + server-side reprice**; defect rate drops to ~"client-detectable", i.e. the system rejects the operator before any DB write. That's the only way 6σ is reachable in a SaaS POS — not by adding tests, but by removing trust in the client.

---

## 13. What I did not check (limitations / scope for REVIEW3)

- Did not run `yarn audit` / `pip-audit` (no network access on this audit host). Run them as part of CI before relying on §6.1 pin assertions.
- Did not inspect every one of the 168 whitelisted endpoints in detail; sampled the financially-critical ~50 and spot-checked the rest.
- Did not run dynamic tests against `/api/method/posawesome.posawesome.api.qz.sign_message` to confirm the signing oracle; the static read shows it.
- Did not audit `frappe_docker` or `muelle/proxy/` for header/TLS posture; that's the next-doc-up's job.
- Did not check Redis namespace isolation across tenants in `muelle/compose.yaml`; flag for ops.
- Did not pen-test the actual M-Pesa callback flow with a forged TransID; static analysis only.
- Did not validate that submitted invoices' GL impact is actually re-derived server-side — assumed ERPNext's `Sales Invoice.on_submit` is correct.
- Did not exhaustively map every place `ignore_permissions=True` is used in `frontend/`-triggered flows (counted 30+ in `api/`, more in `doctype/`).

---

## 14. TL;DR for the synth agent

1. **Not SaaS-ready.** Tenant scope is client-trusted everywhere.
2. **Two endpoints are individually exploitable today**: `qz.sign_message` (private-key oracle) and `m_pesa.confirmation` (guest insert).
3. **Payment surface trusts the client's prices.** Server-side reprice is the single highest-leverage fix.
4. **PIN auth is weak**, already on the roadmap (S5), still unfixed.
5. **No security headers** (CSP/HSTS/X-Frame-Options) shipped from the app; rely entirely on the reverse proxy.
6. **Logs leak PII** in several places, especially M-Pesa callback and customer-create.
7. **IDB caches full PII unencrypted at rest** on every terminal.
8. **No `permission_query_conditions`** for POSA doctypes; list-side cross-profile reads are unfiltered.
9. **CI runs no security audit** (`yarn audit`, `pip-audit`, SBOM).
10. **GDPR DSR endpoints don't exist.** SOC2 logging story is partial.

Five upstream PRs (§10) sequenced over 5-6 weeks, plus the doco carry-ons (§11), plus a third-party pentest, are the realistic path to "can on-board a non-doco tenant without an asterisk in the contract."

— security-architect, 2026-05-18.
