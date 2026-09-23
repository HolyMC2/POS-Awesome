/** Routing context only. The server still authorizes every receivable and payment. */
export interface ClinicPaymentHandoff { customer: string; invoice: string | null; profile: string | null; returnTo: string }
export function clinicPaymentHandoff(search: string): ClinicPaymentHandoff | null {
  const params = new URLSearchParams(search)
  if (params.get('return_to') !== '/clinica/billing') return null
  const customer = params.get('customer') || ''
  const invoice = params.get('invoice')
  const profile = params.get('pos_profile')
  if (!customer.trim() || [customer, invoice, profile].some(value => value && (value.length > 140 || Array.from(value).some(character => character.charCodeAt(0) < 32)))) return null
  return { customer, invoice, profile, returnTo: '/clinica/billing' }
}
