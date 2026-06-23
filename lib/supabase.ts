import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnon)

export const fmtGhc = (v: number | null | undefined) =>
  'GH\u20b5 ' + (v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

export const calcPerfPay = (monthlySal: number, dailyTarget: number, periodWd: number, bagsSold: number) => {
  const dailySal     = monthlySal / 26
  const periodPay    = dailySal * periodWd
  const periodTarget = dailyTarget * periodWd
  const pct          = periodTarget > 0 ? Math.min(1, bagsSold / periodTarget) : 0
  const earned       = Math.round(periodPay * pct * 100) / 100
  return { dailySal, periodPay, periodTarget, pct: pct * 100, earned }
}
