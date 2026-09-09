# Backend test lanes

Run the complete standalone API suite from the repository root:

```sh
python -m unittest discover -s scripts -p 'test_run_backend_tests.py' -v
python scripts/run_backend_tests.py
```

The runner enumerates every `api/**/test_*.py`, with no exclusion list, and uses a fresh interpreter per file. Many unit fixtures install fake Frappe and POS packages in `sys.modules`; shared discovery leaks those fixtures across unrelated tests. Per-file discovery also avoids importing the broad API facade before each file installs its stubs. Import errors, failed assertions and nonzero child exits remain failures; later files still run so CI reports all failures. An empty suite refuses success.

A standalone pass is not a native ERPNext accounting pass. Native modules report explicit skips when Frappe is absent. The five native suites below only catch a missing `frappe` module itself; a missing dependency inside an installed framework still fails. Their accounting/security assertions remain unchanged. The FX return fixture explicitly enables returns only on its newly copied test profile, so an existing tenant's return policy cannot prevent that test from reaching its assertions.

## Native Frappe v16 proof

Use an initialized local test site with ERPNext, Doco and POS Awesome installed, an enabled POS Profile, company defaults, and the fixture's standard ERPNext UOM/group/territory records. The money-exception integration cases also require the real MercadoPago Connector, Saldo, Conekta Connector and ERPNext Mexico Compliance apps. Check installed apps before running; having their source mounted does not install their DocTypes. Use a non-demo site: `muelle_demo` deliberately bypasses the rate-band enforcement that the pricing suite tests. The manually refreshed Doco lab mirror has these prerequisites; verify them and its current posture each time. Do not use a production site or a tenant mirror while its refresh runs. `test_money_exceptions`, `test_source_reconciliation`, and `test_shift_terminal_native` reuse Doco's rollback-only `TestChargeDelivery` fixture. The ledger and pricing suites also use database savepoints.

Run these modules in separate `bench run-tests` invocations from the local Muelle stack, replacing the site with the verified test site:

```sh
for module in \
  posawesome.posawesome.api.payment_processing.test_request_ledger \
  posawesome.posawesome.api.payment_processing.test_source_reconciliation \
  posawesome.posawesome.api.test_money_exceptions \
  posawesome.posawesome.api.test_pricing_context \
  posawesome.posawesome.api.test_shift_terminal_native
do
  docker compose exec -T backend bench --site TEST_SITE run-tests --module "$module" || exit
done
```

Use transaction rollback and block provider calls, immediate background enqueue, and commits when running the native fixture proof directly in a connected interpreter. Reset deferred after-commit callbacks and destroy the connection afterward. Verify fixture counts and site configuration against the before snapshot. A native report must contain actual cases, no failures/errors/skips, and cleanup proof. The existing certification adapter in `scripts/certification/release_execution.py` also runs the durable ledger and source-reconciliation modules as part of its stricter money-integrity gate; this standalone runner does not replace that gate.

The hosted workflow currently creates Frappe/ERPNext **v15** and installs POS Awesome as a compatibility smoke. It runs unit fixtures with the host Python **3.10**, outside the bench environment. That installation is not native v16 transaction coverage. A hosted native lane requires the private Doco fixture dependency and an initialized v16 test site; neither should be approximated by silently selecting a different fixture or weakening the tests.

This harness change does not modify runtime modules, hooks, schema, dependencies or frontend assets. It requires no application migration, asset rebuild or production image rollout.
