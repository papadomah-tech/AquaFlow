'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, fmtNum, today, fmtDate } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// DEPOSITS ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
// Cash flow statement — week-by-week for the selected month:
//   Collected (bulk dispatches) = Banked + Ops Used (Imprest) [+ Pending/In Transit]
//
// Retail sales excluded. Archived records excluded.
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors Weekly Report week-building logic exactly
const WEEK_START_OVERRIDES: Record<string, string> = {
  '2026-07': '2026-07-06',
}
function getWeeks(year: number, month: number) {
  const weeks: { from: string; to: string; label: string }[] = []
  const lastDay = new Date(year, month, 0)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const startDateStr = WEEK_START_OVERRIDES[monthKey]
    ?? `${year}-${String(month).padStart(2, '0')}-01`
  let cur = new Date(startDateStr + 'T00:00:00')
  let weekNum = 1
  while (cur <= lastDay) {
    const from = new Date(cur)
    const to = new Date(cur)
    while (to.getDay() !== 0 && to < lastDay) to.setDate(to.getDate() + 1)
    const toFinal = to > lastDay ? new Date(lastDay) : to
    weeks.push({ from: fmt(from), to: fmt(toFinal), label: `Week ${weekNum}` })
    weekNum++
    cur = new Date(toFinal)
    cur.setDate(cur.getDate() + 1)
  }
  return weeks
}

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

export default function DepositsAccountPage() {
  const { isAdmin, canAccess, userId, employeeName, loading: roleLoading } = useRole()

  const now = new Date()
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)

  const [tab, setTab]         = useState<'summary'|'bulk'|'deposits'>('summary')
  const [weeks, setWeeks]     = useState<any[]>([])
  const [weekData, setWeekData] = useState<Record<string, any>>({})
  const [bulkSales, setBulkSales] = useState<any[]>([])
  const [deposits, setDeposits]   = useState<any[]>([])
  const [totals, setTotals]       = useState<any>(null)
  const [loading, setLoading]     = useState(true)

  // Deposit form
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [form, setForm] = useState({
    deposit_date: today(), bank_name: '', amount: '',
    reference: '', deposited_by: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  const monthStr = `${selYear}-${String(selMonth).padStart(2, '0')}`
  const monthFrom = `${monthStr}-01`
  const monthTo   = `${selYear}-${String(selMonth).padStart(2, '0')}-${new Date(selYear, selMonth, 0).getDate()}`

  const load = useCallback(async () => {
    if (roleLoading) return
    if (!canAccess('fund-account')) { setLoading(false); return }
    setLoading(true)

    const ws = getWeeks(selYear, selMonth)
    setWeeks(ws)

    const [
      { data: bulk },
      { data: deps },
      { data: imprest },
    ] = await Promise.all([
      supabase.from('sales')
        .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .eq('sale_type', 'bulk')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('sale_date', monthFrom)
        .lte('sale_date', monthTo)
        .order('sale_date', { ascending: false }),
      supabase.from('bank_deposits').select('*')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('deposit_date', monthFrom)
        .lte('deposit_date', monthTo)
        .order('deposit_date', { ascending: false }),
      supabase.from('imprest_entries').select('entry_date,amount,description')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('entry_date', monthFrom)
        .lte('entry_date', monthTo),
    ])

    const allBulk  = bulk  ?? []
    const allDeps  = deps  ?? []
    const allImp   = imprest ?? []

    setBulkSales(allBulk)
    setDeposits(allDeps)

    // Build per-week data
    const byWeek: Record<string, any> = {}
    ws.forEach(w => {
      const inRange = (d: string) => d >= w.from && d <= w.to

      const wBulk = allBulk.filter((s: any) => inRange(s.sale_date))
      const wDeps = allDeps.filter((d: any) => inRange(d.deposit_date))
      const wImp  = allImp.filter((e: any)  => inRange(e.entry_date))

      const collected = wBulk.reduce((a: number, s: any) => a + (s.amount_paid || 0), 0)
      const banked    = wDeps.reduce((a: number, d: any) => a + (d.amount || 0), 0)
      const opsUsed   = wImp.reduce((a: number,  e: any) => a + (e.amount || 0), 0)
      const accounted = banked + opsUsed
      const variance  = collected - accounted   // positive = pending/in-transit

      byWeek[w.from] = {
        collected, banked, opsUsed, accounted, variance,
        bulkRows: wBulk, depRows: wDeps, impRows: wImp,
      }
    })
    setWeekData(byWeek)

    // Period totals
    const tCollected = allBulk.reduce((a: number, s: any) => a + (s.amount_paid || 0), 0)
    const tInvoiced  = allBulk.reduce((a: number, s: any) => a + (s.total_amount || 0), 0)
    const tOutstanding = allBulk.reduce((a: number, s: any) => a + (s.outstanding_balance || 0), 0)
    const tBanked    = allDeps.reduce((a: number, d: any) => a + (d.amount || 0), 0)
    const tOpsUsed   = allImp.reduce((a: number,  e: any) => a + (e.amount || 0), 0)
    const tAccounted = tBanked + tOpsUsed
    const tVariance  = tCollected - tAccounted

    setTotals({
      tCollected, tInvoiced, tOutstanding,
      tBanked, tOpsUsed, tAccounted, tVariance,
      bulkCount: allBulk.length, depCount: allDeps.length,
    })
    setLoading(false)
  }, [selYear, selMonth, monthFrom, monthTo, isAdmin, userId, roleLoading, canAccess])

  useEffect(() => { load() }, [load])

  if (roleLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">Loading...</div>
    </AppLayout>
  )
  if (!canAccess('fund-account')) return (
    <AccessDenied message="You do not have access to the Deposits Account." />
  )

  const openForm = (item?: any) => {
    setEditItem(item ?? null)
    setForm(item ? {
      deposit_date: item.deposit_date, bank_name: item.bank_name,
      amount: String(item.amount), reference: item.reference ?? '',
      deposited_by: item.deposited_by ?? '', notes: item.notes ?? ''
    } : {
      deposit_date: today(), bank_name: '', amount: '',
      reference: '', deposited_by: employeeName ?? '', notes: ''
    })
    setShowForm(true)
  }

  const saveDeposit = async () => {
    setSaving(true)
    const payload = {
      deposit_date: form.deposit_date, bank_name: form.bank_name,
      amount: parseFloat(form.amount), reference: form.reference || null,
      deposited_by: form.deposited_by || null, notes: form.notes || null,
      created_by: userId,
    }
    if (editItem) await supabase.from('bank_deposits').update(payload).eq('id', editItem.id)
    else await supabase.from('bank_deposits').insert(payload)
    setSaving(false); setShowForm(false); load()
  }

  const delDeposit = async (d: any) => {
    if (!confirm('Delete deposit of ' + fmtGhc(d.amount) + '?')) return
    const { error } = await supabase.from('bank_deposits').delete().eq('id', d.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  const BADGE = (status: string) =>
    <span className={'badge ' + (status === 'paid' ? 'badge-green'
      : status === 'partial' ? 'badge-yellow' : 'badge-red')}>
      {status}
    </span>

  const TAB = (key: typeof tab, label: string, count?: number) => (
    <button onClick={() => setTab(key)}
      className={'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap '
        + (tab === key
          ? 'border-[#1F4E79] text-[#1F4E79]'
          : 'border-transparent text-gray-500 hover:text-gray-700')}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  )

  // Colour helper for variance pill
  const varianceStyle = (v: number) =>
    Math.abs(v) < 0.01
      ? { bg: 'bg-green-100', text: 'text-green-700', label: '✅ Fully Accounted' }
      : v > 0
      ? { bg: 'bg-amber-100', text: 'text-amber-700', label: '⏳ Pending / In Transit' }
      : { bg: 'bg-red-100',   text: 'text-red-700',   label: '⚠️ Over-accounted' }

  return (
    <AppLayout>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">💰 Deposits Account</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            Weekly cash flow statement — {MONTHS[selMonth - 1]} {selYear}
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={selMonth} onChange={e => setSelMonth(parseInt(e.target.value))}
            className="form-select w-36">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={selYear} onChange={e => setSelYear(parseInt(e.target.value))}
            className="form-select w-24">
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} className="btn btn-primary">Generate</button>
          <button onClick={() => openForm()} className="btn btn-secondary">
            + Bank Deposit
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Building statement...</div>
      ) : totals && (
        <>
          {/* ── Period Hero ──────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 mb-5 bg-[#1F4E79] text-white shadow-lg">
            <div className="text-blue-200 text-sm font-medium mb-1">
              {MONTHS[selMonth - 1]} {selYear} — Cash Flow Summary
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
              {[
                { label: 'Total Collected',  value: fmtGhc(totals.tCollected), sub: `${totals.bulkCount} dispatches` },
                { label: 'Banked',           value: fmtGhc(totals.tBanked),    sub: `${totals.depCount} deposits` },
                { label: 'Ops Used (Imprest)', value: fmtGhc(totals.tOpsUsed), sub: 'operational cash' },
                { label: 'Accounted For',    value: fmtGhc(totals.tAccounted), sub: 'banked + ops', highlight: true },
              ].map(({ label, value, sub, highlight }) => (
                <div key={label}
                  className={`rounded-xl p-3 text-center ${highlight ? 'bg-white/20 ring-1 ring-white/40' : 'bg-white/10'}`}>
                  <div className="text-blue-200 text-xs">{label}</div>
                  <div className="text-white font-bold tabular-nums mt-0.5">{value}</div>
                  <div className="text-blue-300 text-xs mt-0.5">{sub}</div>
                </div>
              ))}
            </div>
            {/* Period variance pill */}
            {Math.abs(totals.tVariance) >= 0.01 && (() => {
              const vs = varianceStyle(totals.tVariance)
              return (
                <div className={`mt-3 rounded-xl px-4 py-2 flex justify-between items-center ${vs.bg}`}>
                  <span className={`text-sm font-semibold ${vs.text}`}>{vs.label}</span>
                  <span className={`text-sm font-bold tabular-nums ${vs.text}`}>
                    {fmtGhc(Math.abs(totals.tVariance))}
                  </span>
                </div>
              )
            })()}
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
            {TAB('summary',  '📊 Weekly Statement')}
            {TAB('bulk',     '📦 Dispatches', totals.bulkCount)}
            {TAB('deposits', '🏦 Bank Deposits', totals.depCount)}
          </div>

          {/* ── WEEKLY STATEMENT TAB ─────────────────────────────────── */}
          {tab === 'summary' && (
            <div className="space-y-3">
              {weeks.map((w, wi) => {
                const wd = weekData[w.from] ?? {}
                const vs = varianceStyle(wd.variance ?? 0)
                const hasVariance = Math.abs(wd.variance ?? 0) >= 0.01

                return (
                  <div key={w.from} className="card overflow-hidden p-0">
                    {/* Week header bar */}
                    <div className="flex items-center justify-between px-4 py-3 bg-[#1F4E79] text-white">
                      <div>
                        <span className="font-bold text-sm">Week {wi + 1}</span>
                        <span className="text-blue-300 text-xs ml-2">
                          {fmtDate(w.from)} → {fmtDate(w.to)}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-blue-300">Collected</div>
                        <div className="font-bold tabular-nums">{fmtGhc(wd.collected ?? 0)}</div>
                      </div>
                    </div>

                    {/* Statement rows */}
                    <div className="divide-y divide-gray-100">

                      {/* Banked */}
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">A</span>
                          <div>
                            <div className="text-sm font-medium text-gray-700">Deposited to Bank</div>
                            <div className="text-xs text-gray-400">
                              {wd.depRows?.length === 0
                                ? 'No deposits this week'
                                : wd.depRows?.map((d: any) =>
                                    `${fmtDate(d.deposit_date)} · ${d.bank_name}`
                                  ).join(' | ')}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-green-700 tabular-nums">{fmtGhc(wd.banked ?? 0)}</div>
                      </div>

                      {/* Ops Used */}
                      <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-bold">B</span>
                          <div>
                            <div className="text-sm font-medium text-gray-700">Used for Operations (Imprest)</div>
                            <div className="text-xs text-gray-400">
                              {wd.impRows?.length === 0
                                ? 'No imprest entries this week'
                                : `${wd.impRows?.length} entr${wd.impRows?.length === 1 ? 'y' : 'ies'}`}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm font-bold text-orange-600 tabular-nums">{fmtGhc(wd.opsUsed ?? 0)}</div>
                      </div>

                      {/* Accounted total */}
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                        <div className="text-sm font-semibold text-gray-600 pl-8">Total Accounted (A + B)</div>
                        <div className="text-sm font-bold text-[#1F4E79] tabular-nums">{fmtGhc(wd.accounted ?? 0)}</div>
                      </div>

                      {/* Variance — only shown when non-zero */}
                      {hasVariance && (
                        <div className={`flex items-center justify-between px-4 py-2 ${vs.bg}`}>
                          <div className={`text-xs font-semibold pl-8 ${vs.text}`}>{vs.label}</div>
                          <div className={`text-sm font-bold tabular-nums ${vs.text}`}>
                            {fmtGhc(Math.abs(wd.variance))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* ── Period Total statement ──────────────────────────── */}
              <div className="card overflow-hidden p-0 mt-2 ring-2 ring-[#1F4E79]">
                <div className="px-4 py-3 bg-[#1F4E79] text-white">
                  <span className="font-bold">{MONTHS[selMonth - 1]} {selYear} — Period Total</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {[
                    { label: 'Total Invoiced',            value: totals.tInvoiced,    color: 'text-gray-700',    indent: false },
                    { label: 'Total Collected (Cash In)', value: totals.tCollected,   color: 'text-[#1F4E79] font-bold', indent: false },
                    { label: 'A. Deposited to Bank',      value: totals.tBanked,      color: 'text-green-700',   indent: true  },
                    { label: 'B. Used for Operations',    value: totals.tOpsUsed,     color: 'text-orange-600',  indent: true  },
                    { label: 'Total Accounted (A + B)',   value: totals.tAccounted,   color: 'text-[#1F4E79] font-bold', indent: false },
                  ].map(({ label, value, color, indent }) => (
                    <div key={label} className="flex justify-between items-center px-4 py-3 hover:bg-gray-50">
                      <span className={`text-sm text-gray-600 ${indent ? 'pl-6' : ''}`}>{label}</span>
                      <span className={`text-sm tabular-nums ${color}`}>{fmtGhc(value)}</span>
                    </div>
                  ))}
                  {/* Outstanding receivable */}
                  <div className="flex justify-between items-center px-4 py-3 bg-gray-50">
                    <span className="text-sm text-gray-500">Outstanding Receivable (not yet collected)</span>
                    <span className="text-sm font-medium text-red-600 tabular-nums">{fmtGhc(totals.tOutstanding)}</span>
                  </div>
                  {/* Variance row — only if needed */}
                  {Math.abs(totals.tVariance) >= 0.01 && (() => {
                    const vs = varianceStyle(totals.tVariance)
                    return (
                      <div className={`flex justify-between items-center px-4 py-3 ${vs.bg}`}>
                        <span className={`text-sm font-semibold ${vs.text}`}>{vs.label}</span>
                        <span className={`text-sm font-bold tabular-nums ${vs.text}`}>
                          {fmtGhc(Math.abs(totals.tVariance))}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ── BULK DISPATCHES TAB ───────────────────────────────────── */}
          {tab === 'bulk' && (
            <div className="card">
              <div className="text-sm font-semibold text-[#1F4E79] mb-3">
                📦 Bulk Dispatch Collections — {MONTHS[selMonth - 1]} {selYear}
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col />
                    <col style={{width:'105px'}} /><col style={{width:'100px'}} />
                    <col style={{width:'100px'}} /><col style={{width:'75px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Rider / Customer</th>
                      <th className="right">Invoiced</th>
                      <th className="right">Collected</th>
                      <th className="right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkSales.length === 0
                      ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                          No bulk dispatches this period
                        </td></tr>
                      : bulkSales.map((s: any) => (
                      <tr key={s.id}>
                        <td className="muted">{fmtDate(s.sale_date)}</td>
                        <td className="font-medium">{s.buyer?.full_name ?? s.customers?.name ?? '—'}</td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                        <td>{BADGE(s.payment_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {bulkSales.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={2} className="py-2 px-3 text-white text-xs font-semibold">TOTALS</td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(totals.tInvoiced)}</td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(totals.tCollected)}</td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(totals.tOutstanding)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── BANK DEPOSITS TAB ─────────────────────────────────────── */}
          {tab === 'deposits' && (
            <div className="card">
              <div className="text-sm font-semibold text-[#1F4E79] mb-3">
                🏦 Bank Deposits — {MONTHS[selMonth - 1]} {selYear}
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col />
                    <col style={{width:'110px'}} /><col style={{width:'120px'}} />
                    <col style={{width:'110px'}} /><col style={{width:'90px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Bank / Account</th>
                      <th>Reference</th><th>Deposited By</th>
                      <th className="right">Amount</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.length === 0
                      ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                          No deposits this period
                        </td></tr>
                      : deposits.map((d: any) => (
                      <tr key={d.id}>
                        <td className="muted">{fmtDate(d.deposit_date)}</td>
                        <td className="font-medium">{d.bank_name}</td>
                        <td className="muted">{d.reference || '—'}</td>
                        <td className="muted">{d.deposited_by || '—'}</td>
                        <td className="num-green">{fmtGhc(d.amount)}</td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => openForm(d)}
                              className="btn btn-sm btn-secondary">Edit</button>
                            <button onClick={() => delDeposit(d)}
                              className="btn btn-sm btn-danger">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {deposits.length > 0 && (
                    <tfoot>
                      <tr className="bg-green-700">
                        <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">TOTAL BANKED</td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(totals.tBanked)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ADD / EDIT DEPOSIT MODAL ───────────────────────────────────── */}
      {showForm && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowForm(false)} />
          <div style={{
            position:'fixed',top:'50%',left:'50%',
            transform:'translate(-50%,-50%)',
            width:'min(480px,94vw)',
            background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',
            zIndex:9999,overflow:'hidden'
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div style={{fontWeight:'bold',color:'#1F4E79'}}>
                {editItem ? 'Edit Bank Deposit' : '🏦 Record Bank Deposit'}
              </div>
              <button onClick={() => setShowForm(false)}
                style={{background:'none',border:'none',fontSize:'1.25rem',color:'#aaa',cursor:'pointer'}}>
                ✕
              </button>
            </div>
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={form.deposit_date}
                    onChange={e => setForm(f => ({...f, deposit_date: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (GHc) *</label>
                  <input type="number" step="0.01" value={form.amount}
                    onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                    className="form-input" placeholder="0.00" />
                </div>
                <div className="form-group col-span-2" style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Bank / Account *</label>
                  <input value={form.bank_name}
                    onChange={e => setForm(f => ({...f, bank_name: e.target.value}))}
                    className="form-input" placeholder="e.g. GCB, MoMo 0241649507" />
                </div>
                <div className="form-group">
                  <label className="form-label">Reference</label>
                  <input value={form.reference}
                    onChange={e => setForm(f => ({...f, reference: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Deposited By</label>
                  <input value={form.deposited_by}
                    onChange={e => setForm(f => ({...f, deposited_by: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Notes</label>
                  <input value={form.notes}
                    onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                    className="form-input" />
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',
              padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveDeposit}
                disabled={saving || !form.bank_name || !form.amount}
                className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save Deposit'}
              </button>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}
