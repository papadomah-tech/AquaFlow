'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtDate, today } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// BANK RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────
// Compares the system's recorded bank deposits against the actual bank
// statement balance entered manually.
//
// Structure (week-by-week + period total):
//   Opening Bank Balance  (manually entered)
//   + Deposits This Week  (from bank_deposits — posted via Weekly Report)
//   = System Closing Balance
//   vs
//   Actual Bank Statement Balance  (manually entered)
//   = Variance (should be zero; flags timing differences if not)
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_START_OVERRIDES: Record<string, string> = {
  '2026-07': '2026-07-06',
}

function getWeeks(year: number, month: number) {
  const weeks: { from: string; to: string }[] = []
  const lastDay  = new Date(year, month, 0)
  const fmt      = (d: Date) => d.toISOString().slice(0, 10)
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const startStr = WEEK_START_OVERRIDES[monthKey]
    ?? `${year}-${String(month).padStart(2, '0')}-01`
  let cur = new Date(startStr + 'T00:00:00')
  while (cur <= lastDay) {
    const from = new Date(cur)
    const to   = new Date(cur)
    while (to.getDay() !== 0 && to < lastDay) to.setDate(to.getDate() + 1)
    const toFinal = to > lastDay ? new Date(lastDay) : to
    weeks.push({ from: fmt(from), to: fmt(toFinal) })
    cur = new Date(toFinal); cur.setDate(cur.getDate() + 1)
  }
  return weeks
}

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

// Resolve which week a deposit belongs to (Weekly Report deposits encode
// the week start date in their notes; manual deposits use deposit_date)
function getDepositWeekFrom(d: any, weeks: { from: string; to: string }[]): string | null {
  if (d.notes) {
    const m = d.notes.match(/Weekly Report — (\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
  }
  // Manual deposit — find which week its deposit_date falls in
  const w = weeks.find(w => d.deposit_date >= w.from && d.deposit_date <= w.to)
  return w ? w.from : null
}

function BankRecPageInner() {
  const now = new Date()
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)

  const [weeks,     setWeeks]     = useState<any[]>([])
  const [weekDeps,  setWeekDeps]  = useState<Record<string, any[]>>({})
  const [deposits,  setDeposits]  = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)

  // Per-week manual inputs
  const [openingBal,     setOpeningBal]     = useState<Record<string, string>>({})
  const [stmtBalance,    setStmtBalance]    = useState<Record<string, string>>({})
  const [savedOpenings,  setSavedOpenings]  = useState<Record<string, number>>({})
  const [savedStmt,      setSavedStmt]      = useState<Record<string, number>>({})

  // Period-level manual inputs
  const [periodOpening,     setPeriodOpening]     = useState('')
  const [periodStmt,        setPeriodStmt]         = useState('')
  const [savedPeriodOpening, setSavedPeriodOpening] = useState(0)
  const [savedPeriodStmt,    setSavedPeriodStmt]    = useState(0)

  const monthStr  = `${selYear}-${String(selMonth).padStart(2, '0')}`
  const monthFrom = `${monthStr}-01`
  const monthTo   = `${selYear}-${String(selMonth).padStart(2, '0')}-${new Date(selYear, selMonth, 0).getDate()}`

  const load = useCallback(async () => {
    setLoading(true)
    const ws = getWeeks(selYear, selMonth)
    setWeeks(ws)

    // Fetch all deposits for the month — include a window before month start
    // to catch deposits posted after the week ended (e.g. 13/07 for week 06–12 Jul)
    const { data: deps } = await supabase
      .from('bank_deposits').select('*')
      .or('is_archived.is.null,is_archived.eq.false')
      .gte('deposit_date', monthFrom)
      .lte('deposit_date', monthTo)
      .order('deposit_date')

    // Also fetch deposits whose notes encode a week in this month
    // (covers deposits made on days just outside the month window)
    const { data: noteDeps } = await supabase
      .from('bank_deposits').select('*')
      .or('is_archived.is.null,is_archived.eq.false')
      .like('notes', `Weekly Report — ${monthStr}%`)

    const allDeps = [...(deps ?? []), ...(noteDeps ?? [])].filter(
      (d, i, arr) => arr.findIndex(x => x.id === d.id) === i  // deduplicate
    )
    setDeposits(allDeps)

    // Assign each deposit to its week
    const byWeek: Record<string, any[]> = {}
    ws.forEach(w => { byWeek[w.from] = [] })
    allDeps.forEach(d => {
      const key = getDepositWeekFrom(d, ws)
      if (key && byWeek[key]) byWeek[key].push(d)
    })
    setWeekDeps(byWeek)
    setLoading(false)
  }, [selYear, selMonth, monthFrom, monthTo, monthStr])

  useEffect(() => { load() }, [load])

  const setOpen  = (wFrom: string, val: string) =>
    setOpeningBal(p => ({ ...p, [wFrom]: val }))
  const setStmt  = (wFrom: string, val: string) =>
    setStmtBalance(p => ({ ...p, [wFrom]: val }))
  const saveOpen = (wFrom: string) =>
    setSavedOpenings(p => ({ ...p, [wFrom]: parseFloat(openingBal[wFrom] || '0') || 0 }))
  const saveStmt = (wFrom: string) =>
    setSavedStmt(p => ({ ...p, [wFrom]: parseFloat(stmtBalance[wFrom] || '0') || 0 }))

  const periodTotalDeposited = deposits.reduce((a, d) => a + d.amount, 0)
  const periodSystemClosing  = savedPeriodOpening + periodTotalDeposited
  const periodVariance       = savedPeriodStmt - periodSystemClosing

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🏦 Bank Reconciliation</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            Reconcile system deposits against your bank statement — {MONTHS[selMonth - 1]} {selYear}
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
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Building reconciliation...</div>
      ) : (
        <div className="space-y-4">

          {/* ── WEEK-BY-WEEK ──────────────────────────────────────────── */}
          {weeks.map((w, wi) => {
            const wdeps      = weekDeps[w.from] ?? []
            const deposited  = wdeps.reduce((a, d) => a + d.amount, 0)
            const openingAmt = savedOpenings[w.from] ?? 0
            const sysClos    = openingAmt + deposited
            const stmtAmt    = savedStmt[w.from] ?? 0
            const variance   = stmtAmt > 0 ? stmtAmt - sysClos : null
            const hasStmt    = stmtAmt > 0

            return (
              <div key={w.from} className="card overflow-hidden p-0">
                {/* Week header */}
                <div className="flex items-center justify-between px-4 py-3 bg-[#1F4E79] text-white">
                  <div>
                    <span className="font-bold text-sm">Week {wi + 1}</span>
                    <span className="text-blue-300 text-xs ml-2">
                      {fmtDate(w.from)} → {fmtDate(w.to)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-blue-300">Total Deposited</div>
                    <div className="font-bold tabular-nums">{fmtGhc(deposited)}</div>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">

                  {/* Opening balance row */}
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                    <span className="text-sm text-gray-600 font-medium">Opening Bank Balance</span>
                    <div className="flex items-center gap-2">
                      {openingBal[w.from] !== undefined ? (
                        <>
                          <input type="number" step="0.01"
                            value={openingBal[w.from]}
                            onChange={e => setOpen(w.from, e.target.value)}
                            className="form-input w-32 text-right text-sm" />
                          <button onClick={() => saveOpen(w.from)} className="btn btn-sm btn-primary">Set</button>
                          <button onClick={() => setOpeningBal(p => { const n = {...p}; delete n[w.from]; return n })}
                            className="btn btn-sm btn-secondary">✕</button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-[#1F4E79] tabular-nums">
                            {fmtGhc(openingAmt)}
                          </span>
                          <button onClick={() => setOpen(w.from, String(openingAmt))}
                            className="btn btn-sm btn-secondary">Edit</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Deposit listing */}
                  {wdeps.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400 italic">
                      No deposits recorded for this week
                    </div>
                  ) : wdeps.map((d, di) => (
                    <div key={d.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center
                          justify-center text-[10px] font-bold">{di + 1}</span>
                        <div>
                          <div className="text-sm text-gray-700">
                            {d.bank_name}
                            {d.reference ? <span className="text-gray-400 ml-1">· {d.reference}</span> : null}
                          </div>
                          <div className="text-xs text-gray-400">
                            Deposited: {fmtDate(d.deposit_date)}
                            {d.deposited_by ? ` · by ${d.deposited_by}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-green-700 tabular-nums">
                        {fmtGhc(d.amount)}
                      </span>
                    </div>
                  ))}

                  {/* System closing balance */}
                  <div className="flex justify-between items-center px-4 py-3 bg-blue-50">
                    <span className="text-sm font-semibold text-[#1F4E79]">
                      System Closing Balance (Opening + Deposits)
                    </span>
                    <span className="text-sm font-bold text-[#1F4E79] tabular-nums">
                      {fmtGhc(sysClos)}
                    </span>
                  </div>

                  {/* Bank statement entry */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-600 font-medium">Actual Bank Statement Balance</span>
                    <div className="flex items-center gap-2">
                      {stmtBalance[w.from] !== undefined ? (
                        <>
                          <input type="number" step="0.01"
                            value={stmtBalance[w.from]}
                            onChange={e => setStmt(w.from, e.target.value)}
                            className="form-input w-32 text-right text-sm" />
                          <button onClick={() => saveStmt(w.from)} className="btn btn-sm btn-primary">Set</button>
                          <button onClick={() => setStmtBalance(p => { const n = {...p}; delete n[w.from]; return n })}
                            className="btn btn-sm btn-secondary">✕</button>
                        </>
                      ) : (
                        <>
                          <span className={'text-sm font-medium tabular-nums '
                            + (hasStmt ? 'text-gray-700' : 'text-gray-400 italic')}>
                            {hasStmt ? fmtGhc(stmtAmt) : 'Not entered'}
                          </span>
                          <button onClick={() => setStmt(w.from, hasStmt ? String(stmtAmt) : '')}
                            className="btn btn-sm btn-secondary">
                            {hasStmt ? 'Edit' : 'Enter'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Variance row — only when statement is entered */}
                  {hasStmt && (() => {
                    const isMatch   = Math.abs(variance!) < 0.01
                    const isOver    = (variance ?? 0) > 0
                    const bg        = isMatch ? 'bg-green-50' : isOver ? 'bg-amber-50' : 'bg-red-50'
                    const textCl    = isMatch ? 'text-green-700' : isOver ? 'text-amber-700' : 'text-red-700'
                    const label     = isMatch
                      ? '✅ Reconciled — Books agree with bank statement'
                      : isOver
                      ? '⏳ Bank shows more — deposit not yet reflected in system'
                      : '⚠️ System shows more — check for unrecorded withdrawal'
                    return (
                      <div className={`flex justify-between items-center px-4 py-3 ${bg}`}>
                        <span className={`text-sm font-semibold ${textCl}`}>{label}</span>
                        {!isMatch && (
                          <span className={`text-sm font-bold tabular-nums ${textCl}`}>
                            {fmtGhc(Math.abs(variance!))}
                          </span>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}

          {/* ── PERIOD TOTAL ──────────────────────────────────────────── */}
          <div className="card overflow-hidden p-0 ring-2 ring-[#1F4E79]">
            <div className="px-4 py-3 bg-[#1F4E79] text-white font-bold">
              {MONTHS[selMonth - 1]} {selYear} — Period Reconciliation
            </div>

            <div className="divide-y divide-gray-100">

              {/* Period opening */}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Opening Bank Balance (Period)</span>
                <div className="flex items-center gap-2">
                  {periodOpening !== '' ? (
                    <>
                      <input type="number" step="0.01" value={periodOpening}
                        onChange={e => setPeriodOpening(e.target.value)}
                        className="form-input w-36 text-right text-sm" />
                      <button onClick={() => { setSavedPeriodOpening(parseFloat(periodOpening) || 0); setPeriodOpening('') }}
                        className="btn btn-sm btn-primary">Set</button>
                      <button onClick={() => setPeriodOpening('')}
                        className="btn btn-sm btn-secondary">✕</button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-[#1F4E79] tabular-nums">
                        {fmtGhc(savedPeriodOpening)}
                      </span>
                      <button onClick={() => setPeriodOpening(String(savedPeriodOpening))}
                        className="btn btn-sm btn-secondary">Edit</button>
                    </>
                  )}
                </div>
              </div>

              {/* All deposits summary */}
              <div className="px-4 py-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600">+ Total Deposits This Period</span>
                  <span className="text-sm font-bold text-green-700 tabular-nums">
                    {fmtGhc(periodTotalDeposited)}
                  </span>
                </div>
                <div className="text-xs text-gray-400 pl-2 space-y-0.5">
                  {deposits.map(d => (
                    <div key={d.id} className="flex justify-between">
                      <span>{fmtDate(d.deposit_date)} · {d.bank_name}{d.reference ? ' · ' + d.reference : ''}</span>
                      <span className="tabular-nums">{fmtGhc(d.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* System closing */}
              <div className="flex justify-between items-center px-4 py-3 bg-blue-50">
                <span className="text-sm font-semibold text-[#1F4E79]">
                  System Closing Balance (Opening + All Deposits)
                </span>
                <span className="text-sm font-bold text-[#1F4E79] tabular-nums">
                  {fmtGhc(periodSystemClosing)}
                </span>
              </div>

              {/* Actual statement */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-700">Actual Bank Statement Balance (Period)</span>
                <div className="flex items-center gap-2">
                  {periodStmt !== '' ? (
                    <>
                      <input type="number" step="0.01" value={periodStmt}
                        onChange={e => setPeriodStmt(e.target.value)}
                        className="form-input w-36 text-right text-sm" />
                      <button onClick={() => { setSavedPeriodStmt(parseFloat(periodStmt) || 0); setPeriodStmt('') }}
                        className="btn btn-sm btn-primary">Set</button>
                      <button onClick={() => setPeriodStmt('')}
                        className="btn btn-sm btn-secondary">✕</button>
                    </>
                  ) : (
                    <>
                      <span className={'text-sm font-medium tabular-nums '
                        + (savedPeriodStmt > 0 ? 'text-gray-700' : 'text-gray-400 italic')}>
                        {savedPeriodStmt > 0 ? fmtGhc(savedPeriodStmt) : 'Not entered'}
                      </span>
                      <button onClick={() => setPeriodStmt(savedPeriodStmt > 0 ? String(savedPeriodStmt) : '')}
                        className="btn btn-sm btn-secondary">
                        {savedPeriodStmt > 0 ? 'Edit' : 'Enter'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Period variance */}
              {savedPeriodStmt > 0 && (() => {
                const isMatch = Math.abs(periodVariance) < 0.01
                const isOver  = periodVariance > 0
                const bg      = isMatch ? 'bg-green-100' : isOver ? 'bg-amber-100' : 'bg-red-100'
                const textCl  = isMatch ? 'text-green-800' : isOver ? 'text-amber-800' : 'text-red-800'
                const label   = isMatch
                  ? '✅ Period Reconciled — System agrees with bank statement'
                  : isOver
                  ? '⏳ Bank shows more than system — check for unrecorded deposits'
                  : '⚠️ System shows more than bank — check for unrecorded charges'
                return (
                  <div className={`flex justify-between items-center px-4 py-3 ${bg}`}>
                    <span className={`text-sm font-bold ${textCl}`}>{label}</span>
                    {!isMatch && (
                      <span className={`text-sm font-bold tabular-nums ${textCl}`}>
                        {fmtGhc(Math.abs(periodVariance))}
                      </span>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>

          <p className="text-xs text-gray-400 pb-4">
            Deposit entries are recorded via the{' '}
            <a href="/weekly-report" className="text-blue-500 underline">Weekly Deposit Report</a>.
            Cash flow details are in the{' '}
            <a href="/reconciliation" className="text-blue-500 underline">Cash Book</a>.
          </p>
        </div>
      )}
    </AppLayout>
  )
}

export default function BankRecPage() {
  return (
    <ModuleGuard moduleKey="bank-rec" moduleLabel="Bank Reconciliation">
      <BankRecPageInner />
    </ModuleGuard>
  )
}
