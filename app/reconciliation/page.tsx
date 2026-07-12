'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, fmtDate, today, monthStart } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// CASH BOOK — Complete Casebook
// ─────────────────────────────────────────────────────────────────────────────
// Entries (Dr = cash in, Cr = cash out):
//   Dr: Bulk dispatch collections ONLY (to riders + external customers)
//   Cr: Bank deposits, all expenses (incl. performance pay, operational)
//
// Running balance = Opening + Σ Dr − Σ Cr
// ─────────────────────────────────────────────────────────────────────────────

type Entry = {
  id:       string
  date:     string
  type:     'bulk_collection' | 'bank_deposit' | 'expense' | 'opening'
  particulars: string
  dr:       number   // cash in
  cr:       number   // cash out
  ref?:     string
  balance?: number
}

function ReconciliationPageInner() {
  const [filter, setFilter]       = useState({ from: monthStart(), to: today() })
  const [openingBal, setOpeningBal] = useState('')
  const [savedOpening, setSavedOpening] = useState<number>(0)
  const [editingOpening, setEditingOpening] = useState(false)
  const [entries, setEntries]     = useState<Entry[]>([])
  const [summary, setSummary]     = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState<'book'|'outstanding'>('book')
  const [outstanding, setOutstanding] = useState<any[]>([])

  // Deposit form
  const [showDepForm, setShowDepForm] = useState(false)
  const [depForm, setDepForm] = useState({
    deposit_date: today(), bank_name: '', amount: '',
    reference: '', deposited_by: '', notes: ''
  })

  const load = useCallback(async () => {
    setLoading(true)

    const [
      { data: bulkSales },
      { data: bankDeps },
      { data: expenses },
      { data: salPayments },
      { data: allOutstanding },
    ] = await Promise.all([
      // Dr: Bulk collections
      supabase.from('sales').select('id,sale_date,amount_paid,bags_sold,buyer:employees!buyer_employee_id(full_name),customers(name)').or('is_archived.is.null,is_archived.eq.false')
        .eq('sale_type', 'bulk').gt('amount_paid', 0)
        .gte('sale_date', filter.from).lte('sale_date', filter.to)
        .order('sale_date'),

      // Cr: Bank deposits
      supabase.from('bank_deposits').select('*').or('is_archived.is.null,is_archived.eq.false')
        .gte('deposit_date', filter.from).lte('deposit_date', filter.to)
        .order('deposit_date'),

      // Cr: All expenses
      supabase.from('expenses').select('*').or('is_archived.is.null,is_archived.eq.false')
        .gte('expense_date', filter.from).lte('expense_date', filter.to)
        .order('expense_date'),

      // Cr: Performance / feeding payments (avoid double-count with expenses)
      supabase.from('salary_payments').select('*,employees(full_name)')
        .in('payment_type', ['performance', 'feeding'])
        .gte('payment_date', filter.from).lte('payment_date', filter.to)
        .is('expense_id', null)   // only those NOT already in expenses
        .order('payment_date'),

      // Outstanding invoices — bulk only (revenue = bulk dispatches only)
      supabase.from('sales').select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,sale_type,buyer:employees!buyer_employee_id(full_name),customers(name)').or('is_archived.is.null,is_archived.eq.false')
        .eq('sale_type', 'bulk')
        .gt('outstanding_balance', 0)
        .order('sale_date'),
    ])

    // Build ledger entries
    const rows: Entry[] = []

    // Opening balance entry
    if (savedOpening !== 0) {
      rows.push({
        id: 'opening', date: filter.from, type: 'opening',
        particulars: 'Opening Balance',
        dr: savedOpening > 0 ? savedOpening : 0,
        cr: savedOpening < 0 ? Math.abs(savedOpening) : 0,
      })
    }

    // Dr: Bulk collections
    ;(bulkSales ?? []).forEach((s: any) => {
      const who = s.buyer?.full_name ?? s.customers?.name ?? 'Customer'
      rows.push({
        id: `bulk-${s.id}`, date: s.sale_date, type: 'bulk_collection',
        particulars: `Bulk collection — ${who} (${fmtNum(s.bags_sold)} bags)`,
        dr: s.amount_paid, cr: 0,
      })
    })

    // Cr: Bank deposits
    ;(bankDeps ?? []).forEach((d: any) => {
      rows.push({
        id: `dep-${d.id}`, date: d.deposit_date, type: 'bank_deposit',
        particulars: `Bank deposit — ${d.bank_name}${d.reference ? ' | ' + d.reference : ''}`,
        dr: 0, cr: d.amount, ref: d.reference,
      })
    })

    // Cr: Expenses
    ;(expenses ?? []).forEach((e: any) => {
      rows.push({
        id: `exp-${e.id}`, date: e.expense_date, type: 'expense',
        particulars: `${e.category} — ${e.description || ''}${e.paid_to ? ' | ' + e.paid_to : ''}`,
        dr: 0, cr: e.amount,
      })
    })

    // Cr: Salary payments not linked to expenses
    ;(salPayments ?? []).forEach((p: any) => {
      const type = p.payment_type === 'feeding' ? 'Feeding Fee' : 'Performance Pay'
      rows.push({
        id: `sal-${p.id}`, date: p.payment_date, type: 'expense',
        particulars: `${type} — ${p.employees?.full_name ?? ''}`,
        dr: 0, cr: p.amount,
      })
    })

    // Sort by date, then opening first
    rows.sort((a, b) => {
      if (a.type === 'opening') return -1
      if (b.type === 'opening') return 1
      return a.date.localeCompare(b.date)
    })

    // Add running balance
    let running = 0
    rows.forEach(r => {
      running += r.dr - r.cr
      r.balance = running
    })

    setEntries(rows)

    // Summary
    const totalDr  = rows.reduce((a, r) => a + r.dr, 0)
    const totalCr  = rows.reduce((a, r) => a + r.cr, 0)
    const closing  = totalDr - totalCr
    const bulkColl = (bulkSales ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
    const banked   = (bankDeps ?? []).reduce((a: number, d: any) => a + d.amount, 0)
    const expTotal = (expenses ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const outstanding = (allOutstanding ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const overdueCount = (allOutstanding ?? []).filter((s: any) => {
      const d = new Date(s.sale_date); d.setDate(d.getDate() + 30)
      return new Date() > d
    }).length

    setSummary({ totalDr, totalCr, closing, bulkColl, banked, expTotal, outstanding, overdueCount })

    // Outstanding for tab
    const today30 = new Date(); today30.setDate(today30.getDate() - 30)
    setOutstanding((allOutstanding ?? []).map((s: any) => ({
      ...s,
      overdue: new Date(s.sale_date) < today30,
      daysPast: Math.floor((Date.now() - new Date(s.sale_date).getTime()) / 86400000),
    })))

    setLoading(false)
  }, [filter, savedOpening])

  useEffect(() => { load() }, [load])

  const saveDeposit = async () => {
    await supabase.from('bank_deposits').insert({
      ...depForm, amount: parseFloat(depForm.amount)
    })
    setShowDepForm(false)
    load()
  }

  const delDeposit = async (id: string) => {
    const depId = id.replace('dep-', '')
    if (!confirm('Delete this deposit?')) return
    await supabase.from('bank_deposits').delete().eq('id', depId)
    load()
  }

  const saveOpening = () => {
    setSavedOpening(parseFloat(openingBal) || 0)
    setEditingOpening(false)
  }

  const TYPE_STYLE: Record<string, { badge: string; drCr: string }> = {
    opening:        { badge: 'badge-blue',   drCr: 'text-blue-700' },
    bulk_collection:{ badge: 'badge-green',  drCr: 'text-green-700' },
    bank_deposit:   { badge: 'badge-yellow', drCr: 'text-orange-600' },
    expense:        { badge: 'badge-red',    drCr: 'text-red-600' },
  }

  const TAB = (key: typeof tab, label: string) => (
    <button onClick={() => setTab(key)}
      className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
        + (tab === key ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-gray-500 hover:text-gray-700')}>
      {label}
    </button>
  )

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">📒 Cash Book</h1>
          <div className="text-xs text-gray-400 mt-0.5">Complete cash ledger — all inflows and outflows</div>
        </div>
        <button onClick={() => setShowDepForm(true)} className="btn btn-primary">+ Bank Deposit</button>
      </div>

      {/* Period filter + opening balance */}
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label>
          <input type="date" value={filter.from} onChange={e => setFilter(f => ({...f, from: e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label>
          <input type="date" value={filter.to} onChange={e => setFilter(f => ({...f, to: e.target.value}))} className="form-input w-36" /></div>
        <button onClick={load} className="btn btn-primary">Generate</button>
        <button onClick={() => setFilter({ from: monthStart(), to: today() })} className="btn btn-secondary">This Month</button>
        <div className="border-l border-gray-200 pl-3">
          {editingOpening ? (
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" value={openingBal}
                onChange={e => setOpeningBal(e.target.value)}
                className="form-input w-32" placeholder="Opening bal." />
              <button onClick={saveOpening} className="btn btn-primary btn-sm">Set</button>
              <button onClick={() => setEditingOpening(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Opening: <strong>{fmtGhc(savedOpening)}</strong></span>
              <button onClick={() => { setOpeningBal(String(savedOpening)); setEditingOpening(true) }}
                className="btn btn-secondary btn-sm">Edit</button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {([
              ['Total Cash In (Dr)',  fmtGhc(summary.totalDr),    '#1B5E20'],
              ['Total Cash Out (Cr)', fmtGhc(summary.totalCr),    '#C00000'],
              ['Closing Balance',     fmtGhc(summary.closing),    summary.closing >= 0 ? '#1F4E79' : '#C00000'],
              ['Outstanding (all)',   fmtGhc(summary.outstanding), '#BF4D00'],
            ] as [string,string,string][]).map(([l,v,c]) => (
              <div key={l} className="stat-card" style={{ borderLeftColor: c }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold tabular-nums" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Reconciliation summary */}
          <div className="card mb-4 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Reconciliation</div>
            <div className="space-y-1.5">
              {[
                ['Opening Balance',        fmtGhc(savedOpening),       savedOpening >= 0 ? 'text-green-700' : 'text-red-600'],
                ['+ Bulk Collections',     fmtGhc(summary.bulkColl),   'text-green-700'],
                ['− Bank Deposits',        fmtGhc(summary.banked),     'text-orange-600'],
                ['− Expenses Paid',        fmtGhc(summary.expTotal),   'text-red-600'],
              ].map(([l,v,c]) => (
                <div key={l as string} className="flex justify-between items-center py-1.5 border-b border-gray-200 last:border-0">
                  <span className="text-sm text-gray-600">{l}</span>
                  <span className={'text-sm font-medium tabular-nums ' + c}>{v}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 bg-[#1F4E79] rounded-xl px-3 mt-2">
                <span className="text-sm font-bold text-white">Closing Balance (Cash on Hand)</span>
                <span className={'text-sm font-bold tabular-nums '
                  + (summary.closing >= 0 ? 'text-white' : 'text-red-300')}>
                  {fmtGhc(summary.closing)}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-4">
            {TAB('book', '📒 Cash Book Ledger')}
            {TAB('outstanding', `📌 Outstanding${summary.overdueCount > 0 ? ` (${summary.overdueCount} overdue)` : ''}`)}
          </div>

          {/* Cash Book Ledger */}
          {tab === 'book' && (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} />
                    <col style={{width:'95px'}} />
                    <col />
                    <col style={{width:'110px'}} />
                    <col style={{width:'110px'}} />
                    <col style={{width:'110px'}} />
                    <col style={{width:'65px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Particulars</th>
                      <th className="right">Dr (In)</th>
                      <th className="right">Cr (Out)</th>
                      <th className="right">Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0
                      ? <tr><td colSpan={7} className="text-center py-10 text-gray-400">No entries in this period.</td></tr>
                      : entries.map(r => {
                        const st = TYPE_STYLE[r.type] ?? { badge:'badge-gray', drCr:'text-gray-600' }
                        return (
                          <tr key={r.id} className={r.type === 'opening' ? 'bg-blue-50' : ''}>
                            <td className="muted">{fmtDate(r.date)}</td>
                            <td>
                              <span className={'badge text-xs ' + st.badge}>
                                {r.type === 'opening' ? 'Opening'
                                  : r.type === 'bulk_collection' ? 'Receipt'
                                  : r.type === 'bank_deposit' ? 'Deposit'
                                  : 'Expense'}
                              </span>
                            </td>
                            <td className="text-sm text-gray-700">{r.particulars}</td>
                            <td className="num text-green-700 font-medium">
                              {r.dr > 0 ? fmtGhc(r.dr) : '—'}
                            </td>
                            <td className="num text-red-600 font-medium">
                              {r.cr > 0 ? fmtGhc(r.cr) : '—'}
                            </td>
                            <td className={'num font-bold '
                              + ((r.balance ?? 0) >= 0 ? 'text-[#1F4E79]' : 'text-red-700')}>
                              {fmtGhc(r.balance ?? 0)}
                            </td>
                            <td>
                              {r.type === 'bank_deposit' && (
                                <button onClick={() => delDeposit(r.id)}
                                  className="btn btn-sm btn-danger">Del</button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                  {entries.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={3} className="py-2 px-3 text-white text-xs font-semibold">TOTALS</td>
                        <td className="py-2 px-3 text-green-300 text-xs font-bold text-right tabular-nums">
                          {fmtGhc(summary.totalDr)}
                        </td>
                        <td className="py-2 px-3 text-red-300 text-xs font-bold text-right tabular-nums">
                          {fmtGhc(summary.totalCr)}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(summary.closing)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* Outstanding */}
          {tab === 'outstanding' && (
            <div className="card">
              <div className="text-xs text-gray-400 mb-3">
                All unpaid or partially paid bulk invoices — all time.
                <span className="ml-2 text-red-500 font-medium">Red = overdue (30+ days)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col style={{width:'72px'}} />
                    <col /><col style={{width:'72px'}} />
                    <col style={{width:'105px'}} /><col style={{width:'105px'}} />
                    <col style={{width:'105px'}} /><col style={{width:'75px'}} />
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
                      ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">✅ No outstanding invoices</td></tr>
                      : outstanding.map((s: any) => (
                      <tr key={s.id} className={s.overdue ? 'bg-red-50' : ''}>
                        <td className={'muted ' + (s.overdue ? 'text-red-400' : '')}>{fmtDate(s.sale_date)}</td>
                        <td><span className={'badge ' + (s.sale_type==='bulk'?'badge-yellow':'badge-blue')}>
                          {s.sale_type==='bulk'?'Bulk':'Retail'}
                        </span></td>
                        <td className={'font-medium ' + (s.overdue ? 'text-red-700' : '')}>
                          {s.sale_type==='bulk' ? (s.buyer?.full_name??'—') : (s.customers?.name??'—')}
                        </td>
                        <td className={'num ' + (s.overdue?'text-red-600 font-bold':'text-gray-500')}>{s.daysPast}</td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className={'num font-bold ' + (s.overdue?'text-red-700':'text-orange-600')}>
                          {fmtGhc(s.outstanding_balance)}
                        </td>
                        <td><span className={'badge '+(s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                        <td>{s.overdue
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
                          TOTAL OUTSTANDING {summary.overdueCount > 0 && `(${summary.overdueCount} overdue)`}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(outstanding.reduce((a: number, s: any) => a + s.outstanding_balance, 0))}
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

      {/* Deposit Modal */}
      {showDepForm && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowDepForm(false)} />
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
            width:'min(480px,94vw)',background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',zIndex:9999,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div className="font-bold text-[#1F4E79]">🏦 Record Bank Deposit</div>
              <button onClick={() => setShowDepForm(false)}
                style={{background:'none',border:'none',fontSize:'1.25rem',color:'#aaa',cursor:'pointer'}}>✕</button>
            </div>
            <div style={{padding:'1.25rem',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" value={depForm.deposit_date}
                  onChange={e => setDepForm(f => ({...f,deposit_date:e.target.value}))} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (GHc) *</label>
                <input type="number" step="0.01" value={depForm.amount}
                  onChange={e => setDepForm(f => ({...f,amount:e.target.value}))} className="form-input" />
              </div>
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Bank / Account *</label>
                <input value={depForm.bank_name}
                  onChange={e => setDepForm(f => ({...f,bank_name:e.target.value}))}
                  className="form-input" placeholder="e.g. GCB, MoMo..." />
              </div>
              <div className="form-group">
                <label className="form-label">Reference</label>
                <input value={depForm.reference}
                  onChange={e => setDepForm(f => ({...f,reference:e.target.value}))} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Deposited By</label>
                <input value={depForm.deposited_by}
                  onChange={e => setDepForm(f => ({...f,deposited_by:e.target.value}))} className="form-input" />
              </div>
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Notes</label>
                <input value={depForm.notes}
                  onChange={e => setDepForm(f => ({...f,notes:e.target.value}))} className="form-input" />
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',
              padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowDepForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveDeposit}
                disabled={!depForm.bank_name || !depForm.amount} className="btn btn-primary">
                💾 Save Deposit
              </button>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

export default function ReconciliationPage() {
  return (
    <ModuleGuard moduleKey="reconciliation" moduleLabel="Cash Book">
      <ReconciliationPageInner />
    </ModuleGuard>
  )
}
