/** Routing context only. The server still authorizes every receivable and payment. */
export interface ClinicPaymentHandoff { customer: string; invoice: string | null; profile: string | null; returnTo: string }
export function clinicPaymentHandoff(search: string): ClinicPaymentHandoff | null {
  const params = new URLSearchParams(search)
  if (params.get('return_to') !== '/clinica/billing') return null
  const customer = params.get('customer') || ''
  const invoice = params.get('invoice')
  const profile = params.get('pos_profile')
  if (!customer.trim() || [customer, invoice, profile].some(value => value && (value.length > 140 || /[\u0000-\u001f]/.test(value)))) return null
  return { customer, invoice, profile, returnTo: '/clinica/billing' }
}
