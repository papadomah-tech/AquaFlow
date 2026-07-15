'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart, fmtDate} from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// VeeBee Performance Pay Formula
// Monthly Pay = (Actual Bags ÷ Monthly Target) × Base Pay + Feeding Fee
// No cap — overperformance earns proportionally above base.
// Feeding fee always paid in full regardless of output.
// ─────────────────────────────────────────────────────────────────────────────

const BAGS_PER_KG = 25   // standard rate: 1 Kg roll film → 25 bags

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

// Standard working days in a full month (Mon–Sat)
const STANDARD_MONTH_DAYS = 26

function calcPay(params: {
  basePay: number; feedingFee: number
  dailyTarget: number; workingDays: number; actualBags: number
}) {
  const { basePay, feedingFee, dailyTarget, workingDays, actualBags } = params

  // Period target = daily target × working days in period
  const periodTarget = dailyTarget * workingDays

  // Pro-rate base pay to the period
  // e.g. 2 days out of 26 → period base pay = (2/26) × GH₵1,500 = GH₵115.38
  const dailyBasePay  = basePay / STANDARD_MONTH_DAYS
  const periodBasePay = Math.round(dailyBasePay * workingDays * 100) / 100

  // Performance % = actual ÷ period target (can exceed 100% for overperformance)
  const pct        = periodTarget > 0 ? actualBags / periodTarget : 0

  // Base pay earned = performance % × period base pay
  const earnedBase = Math.round(pct * periodBasePay * 100) / 100
  const total      = Math.round((earnedBase + feedingFee) * 100) / 100

  return { pct: pct * 100, earnedBase, feedingFee, total, periodTarget, periodBasePay, dailyBasePay }
}

function PerformancePageInner() {
  const { isAdmin, isFactoryManager, employeeId: myEmpId } = useRole()
  const canPay = isAdmin

  const [tab, setTab]         = useState<'calc'|'history'>('calc')
  const [period, setPeriod]   = useState({ from: monthStart(), to: today() })
  const [perfData, setPerfData] = useState<any[]>([])
  const [history, setHistory]   = useState<any[]>([])
  const [loading, setLoading]     = useState(false)
  const [loadingHist, setLoadingHist] = useState(false)
  const [paying, setPaying]       = useState<number | null>(null)
  const [payingFeeding, setPayingFeeding] = useState<number | null>(null)
  // Track which employees have had feeding fee paid this month
  const [feedingPaid, setFeedingPaid] = useState<Record<number, any>>({})

  // ── Calculate performance for all employees (or just current user) ──────────
  const calculate = useCallback(async () => {
    setLoading(true)

    // Only admin sees all employees; everyone else sees only themselves
    let empQuery = supabase.from('employees').select('*').eq('status', 'active').order('full_name')
    if (!isAdmin && myEmpId) empQuery = empQuery.eq('id', myEmpId)
    const { data: employees } = await empQuery

    // Fixed: count Mon–Sat working days in the selected period
    const workingDays = countWorkingDays(period.from, period.to)

    // Fetch feeding fee payments made this month for all employees
    const monthStart = period.from.slice(0, 7) + '-01'
    const { data: feedingPayments } = await supabase
      .from('salary_payments')
      .select('employee_id, amount, payment_date, id')
      .eq('payment_type', 'feeding')
      .gte('payment_date', monthStart)
    const feedingMap: Record<number, any> = {}
    ;(feedingPayments ?? []).forEach((p: any) => { feedingMap[p.employee_id] = p })
    setFeedingPaid(feedingMap)

    const results = await Promise.all((employees ?? []).map(async (emp: any) => {
      let bags = 0

      if (emp.employee_type === 'factory_manager' || emp.role?.toLowerCase().includes('manager')) {
        const { data: fi } = await supabase.from('finished_inventory')
          .select('bags_out').gte('transaction_date', period.from).lte('transaction_date', period.to)
        bags = (fi ?? []).reduce((a: number, r: any) => a + r.bags_out, 0)
      } else if (emp.employee_type === 'rider') {
        const [{ data: primary }, { data: teammate }] = await Promise.all([
          supabase.from('sales').select('bags_sold, is_overtime')
            .eq('sale_type', 'bulk').eq('buyer_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
          supabase.from('sales').select('bags_sold, is_overtime')
            .eq('sale_type', 'bulk').eq('teammate_employee_id', emp.id)
            .gte('sale_date', period.from).lte('sale_date', period.to),
        ])
        // Exclude overtime dispatches from performance pay bag count
        bags = [...(primary ?? []), ...(teammate ?? [])]
          .filter((s: any) => !s.is_overtime)
          .reduce((a: number, s: any) => a + s.bags_sold, 0)
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

      const feedingAlreadyPaid = !!feedingMap[emp.id]
      // If feeding already paid — subtract it from net pay so it's not double-counted
      const adjustedNetPay = feedingAlreadyPaid
        ? Math.max(0, netPay - perf.feedingFee)
        : netPay

      return {
        ...emp, bags, basePay, dailyTarget, workingDays,
        ...perf, totalLosses, netPay: adjustedNetPay,
        feedingAlreadyPaid,
        feedingPaymentInfo: feedingMap[emp.id] ?? null,
        locked, lockInfo: lockRow?.[0]
      }
    }))

    setPerfData(results)
    setLoading(false)
  }, [period, canPay, myEmpId])

  // ── Load payment history ───────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    setLoadingHist(true)
    let q = supabase.from('salary_payments')
      .select('*,employees(full_name,role),expenses(id,category,description,amount,expense_date)')
      .in('payment_type', ['performance', 'feeding'])
      .order('payment_date', { ascending: false })
    if (!isAdmin && myEmpId) q = q.eq('employee_id', myEmpId)
    const { data } = await q
    const payments = data ?? []

    // Auto-sync: back-fill expense records for any unlinked historical payments
    const unlinked = payments.filter((p: any) => !p.expense_id)
    if (unlinked.length > 0) {
      await Promise.all(unlinked.map(async (p: any) => {
        const empName   = p.employees?.full_name ?? 'Unknown'
        const category  = p.payment_type === 'feeding' ? 'Feeding Fee' : 'Performance Pay'
        const description = p.payment_type === 'feeding'
          ? `Feeding fee — ${empName} (${p.payment_date?.slice(0,7)})`
          : `Performance pay — ${empName} (${fmtDate(p.period_start)} → ${fmtDate(p.period_end)})`
        // Create the missing expense
        const { data: newExp } = await supabase.from('expenses').insert({
          expense_date: p.payment_date,
          category, description,
          amount: p.amount,
          paid_to: empName,
        }).select().single()
        // Link it back to the salary_payment
        if (newExp?.id) {
          await supabase.from('salary_payments')
            .update({ expense_id: newExp.id }).eq('id', p.id)
        }
      }))
      // Re-fetch with updated expense links
      const { data: refreshed } = await supabase.from('salary_payments')
        .select('*,employees(full_name,role),expenses(id,category,description,amount,expense_date)')
        .in('payment_type', ['performance', 'feeding'])
        .order('payment_date', { ascending: false })
      setHistory(refreshed ?? [])
      setLoadingHist(false)
      return
    }

    setHistory(payments)
    setLoadingHist(false)
  }, [canPay, myEmpId])

  useEffect(() => { if (tab === 'calc') calculate() }, [tab, calculate])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  // ── Pay feeding fee separately ────────────────────────────────────────────
  const payFeeding = async (d: any) => {
    if (!confirm(
      `Pay feeding fee to ${d.full_name}?

` +
      `Amount: ${fmtGhc(d.feedingFee)}
` +
      `This will be recorded separately from performance pay.`
    )) return
    setPayingFeeding(d.id)
    const payDate = today()
    // Create expense first to get its ID, then link it to salary_payment
    const { data: feedingExp } = await supabase.from('expenses').insert({
      expense_date: payDate,
      category: 'Feeding Fee',
      description: `Feeding fee — ${d.full_name} (${period.from.slice(0,7)})`,
      amount: d.feedingFee,
      paid_to: d.full_name,
    }).select().single()
    await supabase.from('salary_payments').insert({
      employee_id: d.id, payment_date: payDate,
      amount: d.feedingFee, payment_type: 'feeding',
      period_start: period.from, period_end: period.to,
      notes: `Feeding fee for ${period.from.slice(0,7)}`,
      expense_id: feedingExp?.id ?? null,
    })
    setPayingFeeding(null)
    calculate()
  }

  // ── Pay performance base pay (feeding excluded if already paid) ────────────
  const pay = async (d: any) => {
    if (!confirm(
      `Pay ${d.full_name}?\n\n` +
      `Base Pay Earned: ${fmtGhc(d.earnedBase)}\n` +
      `Feeding Fee: ${d.feedingAlreadyPaid ? '✅ Already paid separately' : fmtGhc(d.feedingFee)}\n` +
      `Losses Deducted: ${fmtGhc(d.totalLosses)}\n` +
      `──────────────────\n` +
      `Net Pay: ${fmtGhc(d.netPay)}\n\n` +
      `Period: ${period.from} to ${period.to}`
    )) return
    setPaying(d.id)
    const payDate2 = today()
    const payNotes = `${period.from} → ${period.to} | Base: ${fmtGhc(d.earnedBase)}${d.feedingAlreadyPaid ? ' (feeding paid separately)' : ' + Feeding: ' + fmtGhc(d.feedingFee)} − Losses: ${fmtGhc(d.totalLosses)}`
    const expDesc  = d.feedingAlreadyPaid
      ? `Performance pay — ${d.full_name} (${period.from} → ${period.to})`
      : `Performance pay (incl. feeding) — ${d.full_name} (${period.from} → ${period.to})`
    // Create expense first, then link via expense_id
    const { data: perfExp } = await supabase.from('expenses').insert({
      expense_date: payDate2,
      category: 'Performance Pay',
      description: expDesc,
      amount: d.netPay,
      paid_to: d.full_name,
    }).select().single()
    await supabase.from('salary_payments').insert({
      employee_id: d.id, payment_date: payDate2, amount: d.netPay,
      payment_type: 'performance',
      period_start: period.from, period_end: period.to,
      notes: payNotes,
      expense_id: perfExp?.id ?? null,
    })
    setPaying(null)
    calculate()
  }

  // ── Delete payment + linked expense ──────────────────────────────────────
  const deletePayment = async (p: any) => {
    const typeName  = p.payment_type === 'feeding' ? 'Feeding Fee' : 'Performance Pay'
    const expInfo   = p.expenses
      ? `\n\nLinked expense will also be deleted:\n  ${p.expenses.category} — ${fmtGhc(p.expenses.amount)} on ${p.expenses.expense_date}`
      : '\n\n(No linked expense found)'
    const confirmed = confirm(
      `Delete this payment record?\n\n` +
      `Type: ${typeName}\n` +
      `Employee: ${p.employees?.full_name ?? '—'}\n` +
      `Amount: ${fmtGhc(p.amount)}\n` +
      `Date: ${fmtDate(p.payment_date)}` +
      expInfo
    )
    if (!confirmed) return
    // Delete expense first (linked), then salary_payment
    if (p.expense_id) {
      await supabase.from('expenses').delete().eq('id', p.expense_id)
    }
    const { error } = await supabase.from('salary_payments').delete().eq('id', p.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    loadHistory()
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
                      [d.feedingAlreadyPaid ? 'Feeding ✅ Paid' : 'Feeding Fee', fmtGhc(d.feedingFee), d.feedingAlreadyPaid ? '#15803d' : '#1d4ed8'],
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
                    Period base pay: {fmtGhc(d.basePay)} ÷ {STANDARD_MONTH_DAYS} days × {d.workingDays} days = <strong>{fmtGhc(d.periodBasePay)}</strong>
                    <br/>
                    ({fmtNum(d.bags)} ÷ {fmtNum(d.periodTarget)}) × {fmtGhc(d.periodBasePay)}
                    {d.feedingAlreadyPaid
                      ? <span className="text-green-600"> + feeding ✅ paid</span>
                      : <span> + {fmtGhc(d.feedingFee)} feeding</span>}
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
                    <div className="flex gap-2 flex-wrap">
                      {/* Feeding fee button */}
                      {canPay && (
                        d.feedingAlreadyPaid ? (
                          <div className="text-center">
                            <span className="badge badge-green px-3 py-1.5 text-xs">
                              🍽️ Feeding paid {d.feedingPaymentInfo?.payment_date}
                            </span>
                          </div>
                        ) : (
                          <button onClick={() => payFeeding(d)}
                            disabled={payingFeeding === d.id}
                            className="btn btn-secondary">
                            {payingFeeding === d.id ? '⏳...' : `🍽️ Pay Feeding ${fmtGhc(d.feedingFee)}`}
                          </button>
                        )
                      )}
                      {/* Performance base pay button */}
                      {canPay && (
                        d.locked ? (
                          <span className="badge badge-green px-3 py-1.5 text-xs">✅ Base Pay Paid</span>
                        ) : (
                          <button onClick={() => pay(d)}
                            disabled={paying === d.id || d.netPay <= 0}
                            className="btn btn-primary">
                            {paying === d.id ? '⏳ Processing...' : `💳 Pay Base ${fmtGhc(d.netPay)}`}
                          </button>
                        )
                      )}
                    </div>
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
                    <col style={{width:'90px'}} /><col style={{width:'130px'}} />
                    <col style={{width:'100px'}} /><col style={{width:'105px'}} />
                    <col style={{width:'90px'}} /><col style={{width:'85px'}} />
                    <col /><col style={{width:'65px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Employee</th>
                      <th>Type</th><th>Period</th>
                      <th className="right">Amount</th><th>Role</th>
                      <th>Notes</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0
                      ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">
                          No payments recorded yet.
                        </td></tr>
                      : history.map((p: any) => (
                      <tr key={p.id}>
                        <td className="muted">{fmtDate(p.payment_date)}</td>
                        <td className="font-medium">{p.employees?.full_name ?? '—'}</td>
                        <td>
                          <span className={'badge ' + (p.payment_type === 'feeding' ? 'badge-blue' : 'badge-green')}>
                            {p.payment_type === 'feeding' ? '🍽️ Feeding' : '💳 Base Pay'}
                          </span>
                        </td>
                        <td className="text-xs text-gray-500">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                        <td className="num-green">{fmtGhc(p.amount)}</td>
                        <td className="muted">{p.employees?.role ?? '—'}</td>
                        <td className="text-xs text-gray-400">{p.notes ?? '—'}</td>
                        <td>
                          {isAdmin && (
                            <button onClick={() => deletePayment(p)}
                              className="btn btn-sm btn-danger">Del</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {history.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL PAID ({history.length} payments)
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(history.reduce((a: number, p: any) => a + p.amount, 0))}
                        </td>
                        <td colSpan={3} />
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
