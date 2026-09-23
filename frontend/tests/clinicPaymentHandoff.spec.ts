import { describe, expect, it } from 'vitest'
import { clinicPaymentHandoff } from '../src/posapp/utils/clinicPaymentHandoff'
describe('clinic payment routing context', () => {
  it('carries the invoice, payer and register without any payment amount', () => {
    expect(clinicPaymentHandoff('?customer=Payer&invoice=SI-1&pos_profile=Clinic&return_to=%2Fclinica%2Fbilling&amount=0')).toEqual({ customer: 'Payer', invoice: 'SI-1', profile: 'Clinic', returnTo: '/clinica/billing' })
  })
  it('rejects external return targets, malformed identities and missing customers', () => {
    for (const query of ['?customer=A&return_to=https://evil.invalid', '?return_to=/clinica/billing', '?customer=%00A&return_to=/clinica/billing', '?customer=A&return_to=//evil.invalid']) expect(clinicPaymentHandoff(query)).toBeNull()
  })
})
