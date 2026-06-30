'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// VeeBee Performance Pay Formula
// Monthly Pay = (Actual Bags ÷ Monthly Target) × Base Pay + Feeding Fee
// No cap — overperformance earns proportionally above base.
// Feeding fee always paid in full regardless of output.
// ─────────────────────────────────────────────────────────────────────────────

const BAGS_PER_KG = 20

// Count Mon–Sat working days in a date range (excludes Sundays)
function countWorkingDays(from: string, to: string): number {
  let count = 0
  const cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    if (cur.getDay() !== 0) count++   // 0 = Sunday
    cur.setDate(cur.getDate() + 1)
  }
  return Math.max(1, count)
}

function calcPay(params: {
  basePay: number; feedingFee: number
  dailyTarget: number; workingDays: number; actualBags: number
}) {
  const { basePay, feedingFee, dailyTarget, workingDays, actualBags } = params
  // Period target = daily target × working days in period
  const periodTarget = dailyTarget * workingDays
  const pct          = periodTarget > 0 ? actualBags / periodTarget : 0
  const earnedBase   = Math.round(pct * basePay * 100) / 100
  const total        = Math.round((earnedBase + feedingFee) * 100) / 100
  return { pct: pct * 100, earnedBase, feedingFee, total, periodTarget }
}

function PerformancePageInner() {
  const { isAdmin, isFactoryManager, employeeId: myEmpId } = useRole()
  const canPay = isAdmin

  const [tab, setTab]         = useState<'calc'|'history'>('calc')
  const [period, setPeriod]   = useState({ from: monthStart(), to: today() })
  const [perfData, setPerfData] = useState<any[]>([])
  const [history, setHistory]   = useState<any[]>([])
  const [loading, setLoading]   = useState(false)
  const [loadingHist, setLoadingHist] = useState(false)
  const [paying, setPaying]     = useState<number | null>(null)

  // ── Calculate performance for all employees (or just current user) ──────────
  const calculate = useCallback(async () => {
    setLoading(true)

    // Only admin sees all employees; everyone else sees only themselves
    let empQuery = supabase.from('employees').select('*').eq('status', 'active').order('full_name')
    if (!isAdmin && myEmpId) empQuery = empQuery.eq('id', myEmpId)
    const { data: employees } = await empQuery

    // Fixed: count Mon–Sat working days in the selected period
    const workingDays = countWorkingDays(period.from, period.to)

    const results = await Promise.all((employees ?? []).map(async (emp: any) => {
      let bags = 0

      if (emp.employee_type === 'factory_manager' || emp.role?.toLowerCase().includes('manager')) {
        const { data: fi } = await supabase.from('finished_inventory')
          .select('bags_out').gte('transaction_date', period.from).lte('transaction_date', period.to)
        bags = (fi ?? []).reduce((a: number, r: any) => a + r.bags_out, 0)
      } else if (emp.employee_type === 'rider') {
        const [{ data: primary }, { data: teammate }] = await Promise.all([
          supabase.from('sales').select('bags_sold')
            .eq('sale_type', 'bulk').eq('buyer_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
          supabase.from('sales').select('bags_sold')
            .eq('sale_type', 'bulk').eq('teammate_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
        ])
        bags = [...(primary ?? []), ...(teammate ?? [])].reduce((a: number, s: any) => a + s.bags_sold, 0)
      } else {
        const { data: sales } = await supabase.from('sales').select('bags_sold')
          .eq('salesperson_id', emp.id)
          .gte('sale_date', period.from).lte('sale_date', period.to)
        bags = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
      }

      const { data: losses } = await supabase.from('employee_losses')
        .select('loss_amount').eq('employee_id', emp.id).eq('posted', false)
      const totalLosses = (losses ?? []).reduce((a: number, l: any) => a + l.loss_amount, 0)

      const { data: lockRow } = await supabase.from('salary_payments')
        .select('id,amount,payment_date')
        .eq('employee_id', emp.id).eq('payment_type', 'performance')
        .eq('period_start', period.from).eq('period_end', period.to).limit(1)
      const locked = lockRow && lockRow.length > 0

      const basePay    = emp.base_pay || emp.salary || 0
      const feedingFee = emp.feeding_fee ?? 300
      const dailyTarget = emp.sales_target_daily || Math.round((emp.monthly_target || 6500) / 26)
      const perf       = calcPay({ basePay, feedingFee, dailyTarget, workingDays, actualBags: bags })
      const netPay     = Math.max(0, perf.total - totalLosses)

      return { ...emp, bags, basePay, dailyTarget, workingDays, ...perf, totalLosses, netPay, locked, lockInfo: lockRow?.[0] }
    }))

    setPerfData(results)
    setLoading(false)
  }, [period, canPay, myEmpId])

  // ── Load payment history ───────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoadingHist(true)
    let q = supabase.from('salary_payments')
      .select('*,employees(full_name,role)')
      .eq('payment_type', 'performance')
      .order('payment_date', { ascending: false })
    if (!isAdmin && myEmpId) q = q.eq('employee_id', myEmpId)
    const { data } = await q
    setHistory(data ?? [])
    setLoadingHist(false)
  }, [canPay, myEmpId])

  useEffect(() => { if (tab === 'calc') calculate() }, [tab, calculate])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  // ── Pay an employee ────────────────────────────────────────────────────────
  const pay = async (d: any) => {
    if (!confirm(
      `Pay ${d.full_name}?\n\n` +
      `Base Pay: ${fmtGhc(d.earnedBase)}\n` +
      `Feeding Fee: ${fmtGhc(d.feedingFee)}\n` +
      `Gross Pay: ${fmtGhc(d.total)}\n` +
      `Losses Deducted: ${fmtGhc(d.totalLosses)}\n` +
      `──────────────────\n` +
      `Net Pay: ${fmtGhc(d.netPay)}\n\n` +
      `Period: ${period.from} to ${period.to}`
    )) return
    setPaying(d.id)
    await supabase.from('salary_payments').insert({
      employee_id: d.id, payment_date: today(), amount: d.netPay,
      payment_type: 'performance',
      period_start: period.from, period_end: period.to,
      notes: `${period.from} → ${period.to} | Base: ${fmtGhc(d.earnedBase)} + Feeding: ${fmtGhc(d.feedingFee)} − Losses: ${fmtGhc(d.totalLosses)}`,
    })
    setPaying(null)
    calculate()
  }

  const typeLabel = (emp: any) =>
    emp.employee_type === 'rider' ? '🛵 Rider'
    : emp.employee_type === 'factory_manager' ? '🏭 Factory Mgr'
    : '👤 Staff'

  const borderColor = (pct: number) =>
    pct >= 100 ? '#15803d' : pct >= 60 ? '#ea580c' : '#b91c1c'

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">📊 Performance Pay</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {([['calc','📊 Calculate'], ['history','📋 Payment History']] as const).map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
              + (tab === k ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {l}
          </button>
        ))}
      </div>

      {/* ── CALCULATE TAB ─────────────────────────────────────────────────── */}
      {tab === 'calc' && (
        <>
          {/* Formula info */}
          <div className="card mb-4 bg-blue-50 border border-blue-200">
            <div className="text-xs font-semibold text-blue-800 mb-1">VeeBee Proportional Formula</div>
            <div className="text-xs text-blue-700">
              Monthly Pay = (Actual Bags ÷ Monthly Target) × Base Pay + Feeding Fee
              &nbsp;·&nbsp; No cap — overperformance earns above base.
              &nbsp;·&nbsp; Feeding fee always paid in full.
            </div>
          </div>

          {/* Period selector */}
          <div className="card mb-4 flex gap-3 items-end flex-wrap">
            <div><label className="form-label">From</label>
              <input type="date" value={period.from}
                onChange={e => setPeriod(p => ({...p, from: e.target.value}))}
                className="form-input w-36" /></div>
            <div><label className="form-label">To</label>
              <input type="date" value={period.to}
                onChange={e => setPeriod(p => ({...p, to: e.target.value}))}
                className="form-input w-36" /></div>
            <button onClick={calculate} className="btn btn-primary">Calculate</button>
            <button onClick={() => setPeriod({ from: monthStart(), to: today() })}
              className="btn btn-secondary">This Month</button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">Calculating...</div>
          ) : (
            <div className="space-y-4">
              {perfData.length === 0 ? (
                <div className="card text-center py-8 text-gray-400">No employee data found.</div>
              ) : perfData.map((d: any) => (
                <div key={d.id} className="card border-l-4"
                  style={{ borderLeftColor: d.locked ? '#9ca3af' : borderColor(d.pct) }}>

                  {/* Header */}
                  <div className="flex items-start justify-between flex-wrap gap-3 mb-3 pb-3 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#1F4E79]">{d.locked ? '🔒 ' : ''}{d.full_name}</span>
                        <span className="text-xs text-gray-400">({d.role})</span>
                        <span className={'text-xs font-medium '
                          + (d.employee_type === 'rider' ? 'text-orange-600'
                          : d.employee_type === 'factory_manager' ? 'text-purple-600'
                          : 'text-gray-500')}>
                          {typeLabel(d)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {d.employee_type === 'rider' ? `Bulk bags: ${fmtNum(d.bags)}`
                          : d.employee_type === 'factory_manager' ? `Bags out: ${fmtNum(d.bags)}`
                          : `Bags sold: ${fmtNum(d.bags)}`}
                        {' / Period target: '}{fmtNum(d.periodTarget)}
                        {' ('}{d.dailyTarget}/day × {d.workingDays} days{')'}
                      </div>
                    </div>

                    {/* % badge */}
                    <div className="text-center px-4 py-2 rounded-xl"
                      style={{ background: d.locked ? '#f3f4f6'
                        : d.pct >= 100 ? '#dcfce7' : d.pct >= 60 ? '#ffedd5' : '#fee2e2' }}>
                      <div className="text-xs font-medium text-gray-500">Performance</div>
                      <div className="text-2xl font-bold tabular-nums"
                        style={{ color: d.locked ? '#9ca3af' : borderColor(d.pct) }}>
                        {d.pct.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Pay breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {([
                      ['Base Pay Earned', fmtGhc(d.earnedBase), d.pct >= 100 ? '#15803d' : '#ea580c'],
                      ['Feeding Fee',     fmtGhc(d.feedingFee), '#1d4ed8'],
                      ['Gross Pay',       fmtGhc(d.total),      '#1F4E79'],
                      ['Losses',          fmtGhc(d.totalLosses), '#dc2626'],
                    ] as [string,string,string][]).map(([l,v,c]) => (
                      <div key={l} className="bg-gray-50 rounded-lg p-2.5 text-center">
                        <div className="text-xs text-gray-500">{l}</div>
                        <div className="font-semibold text-sm mt-0.5 tabular-nums" style={{color:c}}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Formula line */}
                  <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 mb-3">
                    <span className="text-blue-600 font-medium">
                      Target: {d.dailyTarget}/day × {d.workingDays} days = {fmtNum(d.periodTarget)} bags
                    </span>
                    <br/>
                    ({fmtNum(d.bags)} ÷ {fmtNum(d.periodTarget)}) × {fmtGhc(d.basePay)} + {fmtGhc(d.feedingFee)} feeding
                    = {fmtGhc(d.earnedBase)} + {fmtGhc(d.feedingFee)}
                    {d.totalLosses > 0 ? ` − ${fmtGhc(d.totalLosses)} losses` : ''}
                    {' = '}<strong>{fmtGhc(d.netPay)} net</strong>
                  </div>

                  {/* Net pay + action */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="text-xs text-gray-500">NET PAY</div>
                      <div className="text-2xl font-bold tabular-nums"
                        style={{ color: d.netPay > 0 ? '#1F4E79' : '#9ca3af' }}>
                        {fmtGhc(d.netPay)}
                      </div>
                      {d.locked && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          Paid {d.lockInfo?.payment_date} · {fmtGhc(d.lockInfo?.amount)}
                        </div>
                      )}
                    </div>
                    {canPay && (
                      <div className="flex gap-2">
                        {d.locked ? (
                          <span className="badge badge-green px-3 py-1.5 text-xs">✅ Paid</span>
                        ) : (
                          <button onClick={() => pay(d)}
                            disabled={paying === d.id || d.netPay <= 0}
                            className="btn btn-primary">
                            {paying === d.id ? '⏳ Processing...' : `💳 Pay ${fmtGhc(d.netPay)}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <>
          {loadingHist ? (
            <div className="text-center py-12 text-gray-400">Loading...</div>
          ) : (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'95px'}} /><col style={{width:'140px'}} />
                    <col style={{width:'110px'}} /><col style={{width:'100px'}} />
                    <col style={{width:'100px'}} /><col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Employee</th>
                      <th>Period</th><th className="right">Amount</th>
                      <th>Role</th><th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0
                      ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                          No performance payments recorded yet.
                        </td></tr>
                      : history.map((p: any) => (
                      <tr key={p.id}>
                        <td className="muted">{p.payment_date}</td>
                        <td className="font-medium">{p.employees?.full_name ?? '—'}</td>
                        <td className="text-xs text-gray-500">{p.period_start} → {p.period_end}</td>
                        <td className="num-green">{fmtGhc(p.amount)}</td>
                        <td className="muted">{p.employees?.role ?? '—'}</td>
                        <td className="text-xs text-gray-400">{p.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {history.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={3} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL PAID ({history.length} payments)
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(history.reduce((a: number, p: any) => a + p.amount, 0))}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AppLayout>
  )
}

export default function PerformancePage() {
  return (
    <ModuleGuard moduleKey="performance" moduleLabel="Performance Pay">
      <PerformancePageInner />
    </ModuleGuard>
  )
}
