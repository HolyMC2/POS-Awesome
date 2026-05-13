# POS Smoke Tests

This suite is a production-safety smoke gate for global runtime errors.

## Run

```bash
yarn test:smoke
```

## Local Secrets

Copy `frontend/.env.example` to `frontend/.env.local` and fill in local values.

`frontend/.env.local` is ignored by git and is auto-loaded by `frontend/playwright.config.ts`.

## Environment Variables

- `POSA_SMOKE_BASE_URL`: Frappe site URL (default: `http://127.0.0.1:8000`)
- `POSA_SMOKE_PATH`: POS route (default: `/app/posapp`; set to `/posapp` for web-route flow spec)
- `POSA_SMOKE_USER`: login username (optional)
- `POSA_SMOKE_PASSWORD`: login password (optional)
- `POSA_SMOKE_OPENING`: cash opening amount used by the flow spec (default: `1000`)

In CI, the POS app route smoke test is skipped unless `POSA_SMOKE_BASE_URL` is configured.
If credentials are set, the test logs in before opening POS.
If credentials are not set, test assumes an already authenticated session.

## Local .env.local example

Create `frontend/.env.local` with:

```
POSA_SMOKE_BASE_URL=https://ventas.lab.xoloitzcuintles.com
POSA_SMOKE_PATH=/posapp
POSA_SMOKE_USER=Administrator
POSA_SMOKE_PASSWORD=<your lab admin password>
POSA_SMOKE_OPENING=1000
```

Without a valid password the login step returns HTTP 401 and the suite
fails fast on the first test (intentional — silent skip would mask
config drift).

## Suites

- `posapp.global-errors.spec.ts` — boots the SPA inside Desk and asserts no
  uncaught console errors. Runs in CI when configured.
- `posapp.web-route.spec.ts` — exercises the `/posapp` web-route end-to-end:
  shift open, cash sale, credit sale, draft save + resume, complex
  multi-add+swap flow, customer-create API, and two regression checks
  (telemetry tz handling + null-supplier shim args). Run locally with
  `POSA_SMOKE_PATH=/posapp` against a dev/lab site.

The flow spec uses the same demo SKUs as the lab database (`IPN000001…
IPN000005`). If your dataset differs, override the `addItem(...)` codes
in the spec or seed equivalents before running.
