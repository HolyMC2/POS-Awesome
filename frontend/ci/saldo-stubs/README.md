# CI stubs for the `@saldo` sibling alias

The `@saldo` vite/tsconfig alias resolves to `../../saldo/saldo/public/saldo_pos`
— a **sibling clone of the private HolyMC2/saldo repo** that exists on dev/prod
hosts but not on CI runners. Without it, `vue-tsc`, TypeDoc and `vite build`
fail with TS2307 on every branch (CI was red from ~2026-06-01 for this reason).

CI workflows copy this directory to the expected sibling path before running
checks. The stubs are behaviour-faithful no-ops: `requireSaldoCapture` resolves
`null`, which is exactly the real module's "not a saldo item" answer, so no
code path is silently altered — saldo capture is simply never triggered.

**Never** use these outside CI: production bundles must be built on a host with
the real sibling checkout, otherwise recarga capture would silently no-op.
The alias itself stays strict (no automatic fallback) precisely to keep a
missing sibling a hard error everywhere except these explicit CI steps.

Keep `useSaldoCapture.ts` export-compatible with the real module
(`saldoCaptureBus`, `saldoBus`, `requireSaldoCapture`) and the three dialog
SFCs prop-less.
