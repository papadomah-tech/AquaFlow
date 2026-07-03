import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

// Guard: createClient will be called at runtime when env vars are available
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnon || 'placeholder')

export const fmtGhc = (v: number | null | undefined) =>
  'GH₵ ' + (v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtNum = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('en-GH')

export const today = () => new Date().toISOString().split('T')[0]

export const monthStart = () => {
  const d = new Date(); d.setDate(1)
  return d.toISOString().split('T')[0]
}

export const countWorkingDays = (from: string, to: string): number => {
  let count = 0
  const cur = new Date(from), end = new Date(to)
  while (cur <= end) {
    if (cur.getDay() !== 0) count++
    cur.setDate(cur.getDate() + 1)
  }
  return Math.max(1, count)
}

// VeeBee Performance Pay Framework (proportional, no cap)
// Formula: (actualBags ÷ monthlyTarget) × basePay + feedingFee
// - basePay scales linearly — no tiers, no caps
// - feedingFee is always paid in full regardless of output
// - pct can exceed 100% for overperformance
export const calcPerfPay = (params: {
  basePay:       number   // proportional base (e.g. GHc 1,500 for rider)
  feedingFee:    number   // fixed top-up always paid (e.g. GHc 300)
  monthlyTarget: number   // total bags for the month (e.g. 6,500)
  actualBags:    number   // bags delivered/dispatched in the period
}) => {
  const { basePay, feedingFee, monthlyTarget, actualBags } = params
  const pct         = monthlyTarget > 0 ? actualBags / monthlyTarget : 0
  const earnedBase  = Math.round(pct * basePay * 100) / 100
  const total       = Math.round((earnedBase + feedingFee) * 100) / 100
  const ratePerBag  = monthlyTarget > 0 ? basePay / monthlyTarget : 0
  return { pct: pct * 100, earnedBase, feedingFee, total, ratePerBag }
}

// ── Revenue filter helper ──────────────────────────────────────────────────
// Company revenue = BULK SALES ONLY (to riders + external customers)
// ALL retail sales are excluded from revenue regardless of who made them.
// Retail is for tracking purposes only — visible in Sales module + rider accounts.
export const getRiderEmployeeIds = async (): Promise<number[]> => {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('employee_type', 'rider')
    .eq('status', 'active')
  return (data ?? []).map((e: any) => e.id)
}

// Returns true if this sale should be EXCLUDED from revenue
// Revenue = bulk sales only; ALL retail excluded
export const isNonRevenueSale = (sale: any) => sale.sale_type !== 'bulk'
