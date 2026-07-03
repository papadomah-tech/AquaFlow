'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart, getRiderEmployeeIds, fmtDate} from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS LOGIC
// ─────────────────────────────────────────────────────────────────────────────
// REVENUE = Factory direct retail sales + Bulk dispatches to riders
//           (salesperson_id IS NULL or sale created by factory/admin)
//           EXCLUDES retail sales made BY riders (salesperson_id linked to a rider)
//
// OUTSTANDING = Invoiced but not yet collected (overdue flagged if > 30 days)
// EXPENSES    = All recorded expenses
// DEPOSITS    = Cash physically banked
// ─────────────────────────────────────────────────────────────────────────────

function ReconciliationPageInner() {
  const [filter, setFilter] = useState({ from: monthStart(), to: today() })
  const [data, setData]     = useState<any>(null)
  const [deposits, setDeposits]   = useState<any[]>([])
  const [outstanding, setOutstanding] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<'statement'|'deposits'|'outstanding'>('statement')
  const [showDepForm, setShowDepForm] = useState(false)
  const [depForm, setDepForm] = useState({
    deposit_date: today(), bank_name: '', amount: '',
    reference: '', deposited_by: '', notes: ''
  })

  const load = useCallback(async () => {
    setLoading(true)

    // Exclude rider retail — not company revenue
    const riderIds = await getRiderEmployeeIds()

    // ── Revenue: Bulk sales ONLY (to riders + external customers) ────────────
    // ALL retail is excluded — retail is for tracking only, not revenue
    const { data: bulkSales } = await supabase
      .from('sales')
      .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,buyer:employees!buyer_employee_id(full_name)')
      .eq('sale_type', 'bulk')
      .gte('sale_date', filter.from)
      .lte('sale_date', filter.to)

    const allRevenueSales = bulkSales ?? []
    const factoryRetail: any[] = []   // retail excluded from revenue

    // ── All outstanding (overdue if > 30 days past sale date) ─────────────
    const { data: allOutstanding } = await supabase
      .from('sales')
      .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,sale_type,customers(name),buyer:employees!buyer_employee_id(full_name)')
      .gt('outstanding_balance', 0)
      .order('sale_date', { ascending: true })

    // Flag overdue (> 30 days)
    const today30 = new Date()
    today30.setDate(today30.getDate() - 30)
    const outstandingRows = (allOutstanding ?? []).map((s: any) => ({
      ...s,
      overdue: new Date(s.sale_date) < today30,
      daysPast: Math.floor((Date.now() - new Date(s.sale_date).getTime()) / 86400000),
    }))
    setOutstanding(outstandingRows)

    // ── Expenses ──────────────────────────────────────────────────────────
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount,category')
      .gte('expense_date', filter.from)
      .lte('expense_date', filter.to)

    // ── Bank deposits ─────────────────────────────────────────────────────
    const { data: depositRows } = await supabase
      .from('bank_deposits')
      .select('*')
      .gte('deposit_date', filter.from)
      .lte('deposit_date', filter.to)
      .order('deposit_date', { ascending: false })

    setDeposits(depositRows ?? [])

    // ── Calculations ──────────────────────────────────────────────────────
    const totalInvoiced    = allRevenueSales.reduce((a: number, s: any) => a + s.total_amount, 0)
    const totalCollected   = allRevenueSales.reduce((a: number, s: any) => a + s.amount_paid, 0)
    const totalUncollected = allRevenueSales.reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const factoryRetailAmt = 0  // retail excluded from revenue
    const bulkAmt          = allRevenueSales.reduce((a: number, s: any) => a + s.total_amount, 0)
    const totalExpenses    = (expenses ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const totalDeposited   = (depositRows ?? []).reduce((a: number, d: any) => a + d.amount, 0)
    const undepositedCash  = totalCollected - totalDeposited
    const totalOverdue     = outstandingRows.filter(s => s.overdue)
      .reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    setData({
      totalInvoiced, totalCollected, totalUncollected,
      factoryRetailAmt, bulkAmt,
      totalExpenses, totalDeposited, undepositedCash,
      totalOverdue,
      overdueCount: outstandingRows.filter(s => s.overdue).length,
      collectionRate: totalInvoiced > 0
        ? (totalCollected / totalInvoiced * 100).toFixed(1) : '0.0',
    })
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const saveDeposit = async () => {
    await supabase.from('bank_deposits').insert({
      ...depForm, amount: parseFloat(depForm.amount)
    })
    setShowDepForm(false); load()
  }

  const delDeposit = async (d: any) => {
    if (!confirm('Delete deposit of ' + fmtGhc(d.amount) + '?')) return
    await supabase.from('bank_deposits').delete().eq('id', d.id)
    load()
  }

  const TAB = (key: typeof tab, label: string) => (
    <button onClick={() => setTab(key)}
      className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
        + (tab === key
          ? 'border-[#1F4E79] text-[#1F4E79]'
          : 'border-transparent text-gray-500 hover:text-gray-700')}>
      {label}
    </button>
  )

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">🏦 Cash & Bank</h1>
        <button onClick={() => setShowDepForm(true)} className="btn btn-primary">
          + Record Deposit
        </button>
      </div>

      {/* Filter */}
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label>
          <input type="date" value={filter.from}
            onChange={e => setFilter(f => ({...f, from: e.target.value}))}
            className="form-input w-36" /></div>
        <div><label className="form-label">To</label>
          <input type="date" value={filter.to}
            onChange={e => setFilter(f => ({...f, to: e.target.value}))}
            className="form-input w-36" /></div>
        <button onClick={load} className="btn btn-primary">Generate</button>
        <button onClick={() => setFilter({ from: monthStart(), to: today() })}
          className="btn btn-secondary">This Month</button>
        <button onClick={() => setFilter({ from: '2000-01-01', to: today() })}
          className="btn btn-secondary">All Time</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : data && (
        <>
          {/* ── Summary cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              ['Total Invoiced',      fmtGhc(data.totalInvoiced),    '#1F4E79'],
              ['Collected',           fmtGhc(data.totalCollected),   '#1B5E20'],
              ['Uncollected',         fmtGhc(data.totalUncollected), '#C00000'],
              ['Collection Rate',     data.collectionRate + '%',
                parseFloat(data.collectionRate) >= 80 ? '#1B5E20' : '#BF4D00'],
              ['Factory Retail Rev.', fmtGhc(data.factoryRetailAmt), '#2E75B6'],
              ['Bulk Dispatch Rev.',  fmtGhc(data.bulkAmt),          '#4A148C'],
              ['Total Expenses',      fmtGhc(data.totalExpenses),    '#C00000'],
              ['Banked',              fmtGhc(data.totalDeposited),   '#00695C'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="stat-card"
                style={{ borderLeftColor: c as string }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold tabular-nums" style={{ color: c as string }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Overdue alert */}
          {data.overdueCount > 0 && (
            <div className="card mb-4 border-l-4 border-red-500 bg-red-50 flex items-center gap-3 cursor-pointer"
              onClick={() => setTab('outstanding')}>
              <div className="text-2xl">⚠️</div>
              <div>
                <div className="font-semibold text-red-700">
                  {data.overdueCount} overdue invoice{data.overdueCount > 1 ? 's' : ''}
                  — {fmtGhc(data.totalOverdue)} outstanding for more than 30 days
                </div>
                <div className="text-xs text-red-500">
                  Click to view → Outstanding tab
                </div>
              </div>
            </div>
          )}

          {/* Undeposited cash alert */}
          {data.undepositedCash > 0 && (
            <div className="card mb-4 border-l-4 border-orange-400 bg-orange-50">
              <div className="font-semibold text-orange-700">
                💰 {fmtGhc(data.undepositedCash)} collected but not yet banked
              </div>
              <div className="text-xs text-orange-500 mt-0.5">
                Cash collected: {fmtGhc(data.totalCollected)} —
                Banked: {fmtGhc(data.totalDeposited)}
              </div>
            </div>
          )}

          {/* ── Tabs ──────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 mb-4">
            {TAB('statement',   '📋 Revenue Statement')}
            {TAB('deposits',    '🏦 Bank Deposits')}
            {TAB('outstanding', `📌 Outstanding${data.overdueCount > 0 ? ` (${data.overdueCount} overdue)` : ''}`)}
          </div>

          {/* ── REVENUE STATEMENT ─────────────────────────────────────── */}
          {tab === 'statement' && (
            <div className="card">
              <div className="text-sm font-bold text-[#1F4E79] uppercase tracking-wider mb-4">
                Revenue & Cash Statement — {filter.from} to {filter.to}
              </div>
              <div className="space-y-1">

                {/* Revenue section */}
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pt-2 pb-1">
                  A. Revenue (Factory Sales Only)
                </div>
                {[
                  ['Factory Direct Retail Sales',  data.factoryRetailAmt, 'text-gray-300'],  // excluded
                  ['Bulk Dispatches to Riders',    data.bulkAmt,          'text-[#1F4E79]'],
                ].map(([l, v, c]) => (
                  <div key={l as string}
                    className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-700">{l}</span>
                    <span className={'text-sm font-medium tabular-nums ' + c}>
                      {fmtGhc(v as number)}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2.5 px-3 rounded-lg bg-blue-50">
                  <span className="text-sm font-bold text-[#1F4E79]">TOTAL REVENUE INVOICED</span>
                  <span className="text-sm font-bold text-[#1F4E79] tabular-nums">
                    {fmtGhc(data.totalInvoiced)}
                  </span>
                </div>

                <div className="border-t border-gray-200 my-3" />

                {/* Collections */}
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pt-1 pb-1">
                  B. Collections
                </div>
                {[
                  ['Cash Collected from Customers',   data.totalCollected,   'text-green-700'],
                  ['Still Owed (Uncollected)',         data.totalUncollected, 'text-red-600'],
                ].map(([l, v, c]) => (
                  <div key={l as string}
                    className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-700">{l}</span>
                    <span className={'text-sm font-medium tabular-nums ' + c}>
                      {fmtGhc(v as number)}
                    </span>
                  </div>
                ))}

                <div className="border-t border-gray-200 my-3" />

                {/* Expenses & Banking */}
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pt-1 pb-1">
                  C. Expenses & Banking
                </div>
                {[
                  ['Total Expenses Paid',         data.totalExpenses,   'text-red-600'],
                  ['Cash Deposited at Bank',       data.totalDeposited,  'text-blue-700'],
                  ['Undeposited Cash on Hand',     data.undepositedCash,
                    data.undepositedCash > 0 ? 'text-orange-600' : 'text-gray-500'],
                ].map(([l, v, c]) => (
                  <div key={l as string}
                    className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-700">{l}</span>
                    <span className={'text-sm font-medium tabular-nums ' + c}>
                      {fmtGhc(v as number)}
                    </span>
                  </div>
                ))}

                <div className="border-t-2 border-gray-300 mt-3 pt-3 space-y-1.5">
                  <div className="flex justify-between items-center px-3 py-2 bg-green-50 rounded-lg">
                    <span className="font-semibold text-sm text-green-800">
                      Net Position (Revenue − Expenses)
                    </span>
                    <span className={'font-bold tabular-nums '
                      + (data.totalInvoiced - data.totalExpenses >= 0
                        ? 'text-green-700' : 'text-red-700')}>
                      {fmtGhc(data.totalInvoiced - data.totalExpenses)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-3 py-2 bg-blue-50 rounded-lg">
                    <span className="font-semibold text-sm text-blue-800">
                      Cash Net (Collected − Expenses)
                    </span>
                    <span className={'font-bold tabular-nums '
                      + (data.totalCollected - data.totalExpenses >= 0
                        ? 'text-blue-700' : 'text-red-700')}>
                      {fmtGhc(data.totalCollected - data.totalExpenses)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-gray-400 px-3 pt-3 pb-1">
                  Note: Rider retail sales to customers are excluded from company revenue
                  as riders operate independently. Their payments to the factory are tracked
                  in the Fund Account module.
                </div>
              </div>
            </div>
          )}

          {/* ── BANK DEPOSITS ─────────────────────────────────────────── */}
          {tab === 'deposits' && (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col />
                    <col style={{width:'110px'}} /><col style={{width:'120px'}} />
                    <col style={{width:'110px'}} /><col style={{width:'70px'}} />
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
                      ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">
                          No deposits in this period
                        </td></tr>
                      : deposits.map((d: any) => (
                      <tr key={d.id}>
                        <td className="muted">{fmtDate(d.deposit_date)}</td>
                        <td className="font-medium">{d.bank_name}</td>
                        <td className="muted">{d.reference||'—'}</td>
                        <td className="muted">{d.deposited_by||'—'}</td>
                        <td className="num-blue">{fmtGhc(d.amount)}</td>
                        <td>
                          <button onClick={() => delDeposit(d)}
                            className="btn btn-sm btn-danger">Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {deposits.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL DEPOSITED
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.totalDeposited)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── OUTSTANDING ───────────────────────────────────────────── */}
          {tab === 'outstanding' && (
            <div className="card">
              <div className="text-xs text-gray-400 mb-3">
                All unpaid or partially paid invoices — regardless of period filter.
                <span className="ml-2 text-red-500 font-medium">
                  Red = overdue (30+ days old)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col style={{width:'72px'}} />
                    <col /><col style={{width:'70px'}} />
                    <col style={{width:'105px'}} /><col style={{width:'105px'}} />
                    <col style={{width:'105px'}} /><col style={{width:'72px'}} />
                    <col style={{width:'80px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Customer / Rider</th>
                      <th className="right">Days</th>
                      <th className="right">Invoiced</th>
                      <th className="right">Paid</th>
                      <th className="right">Owed</th>
                      <th>Status</th><th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.length === 0
                      ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">
                          ✅ No outstanding invoices
                        </td></tr>
                      : outstanding.map((s: any) => (
                      <tr key={s.id}
                        className={s.overdue ? 'bg-red-50' : ''}>
                        <td className={'muted ' + (s.overdue ? 'text-red-400' : '')}>
                          {fmtDate(s.sale_date)}
                        </td>
                        <td>
                          <span className={'badge ' + (s.sale_type === 'bulk'
                            ? 'badge-yellow' : 'badge-blue')}>
                            {s.sale_type === 'bulk' ? 'Bulk' : 'Retail'}
                          </span>
                        </td>
                        <td className={'font-medium ' + (s.overdue ? 'text-red-700' : '')}>
                          {s.sale_type === 'bulk'
                            ? (s.buyer?.full_name ?? '—')
                            : (s.customers?.name ?? '—')}
                        </td>
                        <td className={'num ' + (s.overdue ? 'text-red-600 font-bold' : 'text-gray-500')}>
                          {s.daysPast}
                        </td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className={'num font-bold '
                          + (s.overdue ? 'text-red-700' : 'text-orange-600')}>
                          {fmtGhc(s.outstanding_balance)}
                        </td>
                        <td>
                          <span className={'badge '
                            + (s.payment_status === 'partial'
                              ? 'badge-yellow' : 'badge-red')}>
                            {s.payment_status}
                          </span>
                        </td>
                        <td>
                          {s.overdue
                            ? <span className="badge badge-red text-[10px]">OVERDUE</span>
                            : <span className="text-xs text-gray-400">current</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {outstanding.length > 0 && (
                    <tfoot>
                      <tr className="bg-red-700">
                        <td colSpan={6} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL OUTSTANDING
                          {data.overdueCount > 0 &&
                            ` (${data.overdueCount} overdue)`}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(outstanding.reduce((a: number, s: any) =>
                            a + s.outstanding_balance, 0))}
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

      {/* ── DEPOSIT MODAL ──────────────────────────────────────────────── */}
      {showDepForm && (
        <div className="modal-overlay" onClick={() => setShowDepForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">Record Bank Deposit</h2>
              <button onClick={() => setShowDepForm(false)}
                className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={fmtDate(depForm.deposit_date)}
                    onChange={e => setDepForm(f => ({...f, deposit_date: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Bank / Account *</label>
                  <input value={depForm.bank_name}
                    onChange={e => setDepForm(f => ({...f, bank_name: e.target.value}))}
                    className="form-input" placeholder="e.g. GCB, MoMo 0241..." />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (GHc) *</label>
                  <input type="number" step="0.01" value={depForm.amount}
                    onChange={e => setDepForm(f => ({...f, amount: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Reference</label>
                  <input value={depForm.reference}
                    onChange={e => setDepForm(f => ({...f, reference: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Deposited By</label>
                  <input value={depForm.deposited_by}
                    onChange={e => setDepForm(f => ({...f, deposited_by: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <input value={depForm.notes}
                    onChange={e => setDepForm(f => ({...f, notes: e.target.value}))}
                    className="form-input" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowDepForm(false)}
                className="btn btn-secondary">Cancel</button>
              <button onClick={saveDeposit}
                disabled={!depForm.bank_name || !depForm.amount}
                className="btn btn-primary">💾 Save Deposit</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function ReconciliationPage() {
  return (
    <ModuleGuard moduleKey="reconciliation" moduleLabel="Cash & Bank">
      <ReconciliationPageInner />
    </ModuleGuard>
  )
}
