'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, fmtDate, today, monthStart } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// CASH BOOK
// ─────────────────────────────────────────────────────────────────────────────
// Records cash physically received and paid out.
// Bank deposits are NOT cash outflows — they are transfers to the bank account
// and belong in the Bank Reconciliation module (/bank-rec).
//
//   Dr (Cash In):  Bulk dispatch collections
//   Cr (Cash Out): Imprest/operational expenses, other expenses, performance pay
//
// Closing Balance = Opening + Σ Dr − Σ Cr = Cash physically on hand
// Any unbanked cash = Closing Balance − Bank Deposits for the period
// ─────────────────────────────────────────────────────────────────────────────

type EntryType = 'bulk_collection' | 'expense' | 'imprest' | 'opening'

type Entry = {
  id:          string
  date:        string
  type:        EntryType
  particulars: string
  dr:          number
  cr:          number
  balance?:    number
}

function ReconciliationPageInner() {
  const [filter, setFilter]         = useState({ from: monthStart(), to: today() })
  const [openingBal, setOpeningBal] = useState('')
  const [savedOpening, setSavedOpening] = useState<number>(0)
  const [editingOpening, setEditingOpening] = useState(false)
  const [entries, setEntries]       = useState<Entry[]>([])
  const [summary, setSummary]       = useState<any>(null)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'book' | 'outstanding'>('book')
  const [outstanding, setOutstanding] = useState<any[]>([])

  const load = useCallback(async () => {
    setLoading(true)

    const [
      { data: bulkSales },
      { data: expenses },
      { data: salPayments },
      { data: imprestData },
      { data: bankDeps },       // fetched for the "cash on hand vs banked" panel only
      { data: allOutstanding },
    ] = await Promise.all([

      // Dr: Bulk collections (cash received)
      supabase.from('sales')
        .select('id,sale_date,amount_paid,bags_sold,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .or('is_archived.is.null,is_archived.eq.false')
        .eq('sale_type', 'bulk').gt('amount_paid', 0)
        .gte('sale_date', filter.from).lte('sale_date', filter.to)
        .order('sale_date'),

      // Cr: Expenses — exclude Weekly Report's consolidated 'Operational Expense'
      // (those are the sum of imprest entries, which appear individually below)
      supabase.from('expenses')
        .select('*')
        .or('is_archived.is.null,is_archived.eq.false')
        .neq('category', 'Operational Expense')
        .gte('expense_date', filter.from).lte('expense_date', filter.to)
        .order('expense_date'),

      // Cr: Performance/feeding payments not already linked to an expense record
      supabase.from('salary_payments')
        .select('*,employees(full_name)')
        .in('payment_type', ['performance', 'feeding'])
        .gte('payment_date', filter.from).lte('payment_date', filter.to)
        .is('expense_id', null)
        .order('payment_date'),

      // Cr: Imprest entries (individual operational outflows)
      supabase.from('imprest_entries')
        .select('*')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('entry_date', filter.from).lte('entry_date', filter.to)
        .order('entry_date'),

      // For "Cash on Hand" panel only — NOT posted as CR entries in the ledger
      supabase.from('bank_deposits')
        .select('id,deposit_date,amount,bank_name,reference,notes')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('deposit_date', filter.from).lte('deposit_date', filter.to),

      // Outstanding bulk invoices (all time — not date-filtered)
      supabase.from('sales')
        .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,sale_type,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .or('is_archived.is.null,is_archived.eq.false')
        .eq('sale_type', 'bulk')
        .gt('outstanding_balance', 0)
        .order('sale_date'),
    ])

    // ── Build ledger ────────────────────────────────────────────────────────
    const rows: Entry[] = []

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

    // Cr: Expenses (operator fees, raw materials, etc. — not ops consolidated)
    ;(expenses ?? []).forEach((e: any) => {
      rows.push({
        id: `exp-${e.id}`, date: e.expense_date, type: 'expense',
        particulars: `${e.category} — ${e.description || ''}${e.paid_to ? ' | ' + e.paid_to : ''}`,
        dr: 0, cr: e.amount,
      })
    })

    // Cr: Performance / feeding pay
    ;(salPayments ?? []).forEach((p: any) => {
      const lbl = p.payment_type === 'feeding' ? 'Feeding Fee' : 'Performance Pay'
      rows.push({
        id: `sal-${p.id}`, date: p.payment_date, type: 'expense',
        particulars: `${lbl} — ${p.employees?.full_name ?? ''}`,
        dr: 0, cr: p.amount,
      })
    })

    // Cr: Imprest (individual operational outflows)
    ;(imprestData ?? []).forEach((e: any) => {
      rows.push({
        id: `imp-${e.id}`, date: e.entry_date, type: 'imprest',
        particulars: `Ops (Imprest) — ${e.description || 'Operational expense'}`,
        dr: 0, cr: e.amount,
      })
    })

    // Sort: opening first, then by date
    rows.sort((a, b) => {
      if (a.type === 'opening') return -1
      if (b.type === 'opening') return 1
      return a.date.localeCompare(b.date)
    })

    // Running balance
    let running = savedOpening
    rows.forEach(r => {
      if (r.type !== 'opening') running += r.dr - r.cr
      r.balance = running
    })

    setEntries(rows)

    // ── Summary ─────────────────────────────────────────────────────────────
    const totalDr    = rows.filter(r => r.type !== 'opening').reduce((a, r) => a + r.dr, 0)
    const totalCr    = rows.filter(r => r.type !== 'opening').reduce((a, r) => a + r.cr, 0)
    const closing    = savedOpening + totalDr - totalCr    // cash on hand
    const bulkColl   = (bulkSales ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
    const expTotal   = (expenses ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const impTotal   = (imprestData ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const salTotal   = (salPayments ?? []).reduce((a: number, p: any) => a + p.amount, 0)
    const bankedAmt  = (bankDeps ?? []).reduce((a: number, d: any) => a + d.amount, 0)
    const unbanked   = closing - bankedAmt   // should equal cash still in hand
    const outstandingAmt = (allOutstanding ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const overdueCount   = (allOutstanding ?? []).filter((s: any) => {
      const d = new Date(s.sale_date); d.setDate(d.getDate() + 30)
      return new Date() > d
    }).length

    setSummary({ totalDr, totalCr, closing, bulkColl, expTotal, impTotal, salTotal,
      bankedAmt, unbanked, outstandingAmt, overdueCount })

    const today30 = new Date(); today30.setDate(today30.getDate() - 30)
    setOutstanding((allOutstanding ?? []).map((s: any) => ({
      ...s,
      overdue: new Date(s.sale_date) < today30,
      daysPast: Math.floor((Date.now() - new Date(s.sale_date).getTime()) / 86400000),
    })))

    setLoading(false)
  }, [filter, savedOpening])

  useEffect(() => { load() }, [load])

  const TYPE_STYLE: Record<string, { badge: string }> = {
    opening:         { badge: 'badge-blue'   },
    bulk_collection: { badge: 'badge-green'  },
    expense:         { badge: 'badge-red'    },
    imprest:         { badge: 'badge-orange' },
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
          <div className="text-xs text-gray-400 mt-0.5">
            Cash receipts and payments — closing balance = cash on hand
          </div>
        </div>
      </div>

      {/* ── Filter + Opening Balance ──────────────────────────────────────── */}
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div>
          <label className="form-label">From</label>
          <input type="date" value={filter.from}
            onChange={e => setFilter(f => ({ ...f, from: e.target.value }))}
            className="form-input w-36" />
        </div>
        <div>
          <label className="form-label">To</label>
          <input type="date" value={filter.to}
            onChange={e => setFilter(f => ({ ...f, to: e.target.value }))}
            className="form-input w-36" />
        </div>
        <button onClick={load} className="btn btn-primary">Generate</button>
        <button onClick={() => setFilter({ from: monthStart(), to: today() })}
          className="btn btn-secondary">This Month</button>
        <div className="border-l border-gray-200 pl-3">
          {editingOpening ? (
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" value={openingBal}
                onChange={e => setOpeningBal(e.target.value)}
                className="form-input w-32" placeholder="Opening bal." />
              <button onClick={() => { setSavedOpening(parseFloat(openingBal) || 0); setEditingOpening(false) }}
                className="btn btn-primary btn-sm">Set</button>
              <button onClick={() => setEditingOpening(false)}
                className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">
                Opening: <strong>{fmtGhc(savedOpening)}</strong>
              </span>
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
          {/* ── Hero summary cards ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {([
              ['Total Cash In (Dr)',  fmtGhc(summary.totalDr),     '#1B5E20'],
              ['Total Cash Out (Cr)', fmtGhc(summary.totalCr),     '#C00000'],
              ['Cash on Hand',        fmtGhc(summary.closing),     summary.closing >= 0 ? '#1F4E79' : '#C00000'],
              ['Still Unbanked',      fmtGhc(Math.max(0, summary.unbanked)), '#BF4D00'],
            ] as [string, string, string][]).map(([l, v, c]) => (
              <div key={l} className="stat-card" style={{ borderLeftColor: c }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold tabular-nums" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* ── Cash Book Reconciliation panel ──────────────────────────── */}
          <div className="card mb-4 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Cash Position
            </div>
            <div className="space-y-1">
              {[
                ['Opening Balance',            fmtGhc(savedOpening),        savedOpening >= 0 ? 'text-green-700' : 'text-red-600'],
                ['+ Bulk Collections',         fmtGhc(summary.bulkColl),    'text-green-700'],
                ['− Operational (Imprest)',     fmtGhc(summary.impTotal),    'text-orange-600'],
                ['− Other Expenses',           fmtGhc(summary.expTotal),    'text-red-600'],
                ['− Performance / Feeding Pay', fmtGhc(summary.salTotal),   'text-red-600'],
              ].map(([l, v, c]) => (
                <div key={l as string}
                  className="flex justify-between items-center py-1.5 border-b border-gray-200 last:border-0">
                  <span className="text-sm text-gray-600">{l}</span>
                  <span className={'text-sm font-medium tabular-nums ' + c}>{v}</span>
                </div>
              ))}

              {/* Closing balance (cash on hand) */}
              <div className="flex justify-between items-center py-2.5 px-3 bg-[#1F4E79] rounded-xl mt-2">
                <span className="text-sm font-bold text-white">Cash on Hand (Closing Balance)</span>
                <span className={'text-sm font-bold tabular-nums '
                  + (summary.closing >= 0 ? 'text-white' : 'text-red-300')}>
                  {fmtGhc(summary.closing)}
                </span>
              </div>

              {/* Banked vs unbanked */}
              <div className="mt-3 rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex justify-between items-center px-3 py-2.5 bg-green-50">
                  <span className="text-sm text-gray-600">− Already Banked (transferred to bank)</span>
                  <span className="text-sm font-medium text-green-700 tabular-nums">
                    {fmtGhc(summary.bankedAmt)}
                  </span>
                </div>
                <div className={'flex justify-between items-center px-3 py-2.5 '
                  + (summary.unbanked > 0.01 ? 'bg-amber-50' : 'bg-green-50')}>
                  <span className={'text-sm font-semibold '
                    + (summary.unbanked > 0.01 ? 'text-amber-700' : 'text-green-700')}>
                    {summary.unbanked > 0.01 ? '⏳ Cash Still to Bank' : '✅ All Cash Banked'}
                  </span>
                  <span className={'text-sm font-bold tabular-nums '
                    + (summary.unbanked > 0.01 ? 'text-amber-700' : 'text-green-700')}>
                    {fmtGhc(Math.max(0, summary.unbanked))}
                  </span>
                </div>
              </div>

              <p className="text-xs text-gray-400 mt-2">
                Bank deposits are transfers — they do not appear as cash outflows here.
                See <a href="/bank-rec" className="text-blue-500 underline">Bank Reconciliation</a> for the full bank account statement.
              </p>
            </div>
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 mb-4">
            {TAB('book', '📒 Cash Book Ledger')}
            {TAB('outstanding', `📌 Outstanding${summary.overdueCount > 0 ? ` (${summary.overdueCount} overdue)` : ''}`)}
          </div>

          {/* ── CASH BOOK LEDGER TAB ─────────────────────────────────────── */}
          {tab === 'book' && (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '110px' }} />
                    <col />
                    <col style={{ width: '110px' }} />
                    <col style={{ width: '110px' }} />
                    <col style={{ width: '110px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Particulars</th>
                      <th className="right">Dr (Cash In)</th>
                      <th className="right">Cr (Cash Out)</th>
                      <th className="right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0
                      ? <tr><td colSpan={6} className="text-center py-10 text-gray-400">
                          No entries in this period.
                        </td></tr>
                      : entries.map(r => {
                        const st = TYPE_STYLE[r.type] ?? { badge: 'badge-gray' }
                        return (
                          <tr key={r.id} className={r.type === 'opening' ? 'bg-blue-50' : ''}>
                            <td className="muted">{fmtDate(r.date)}</td>
                            <td>
                              <span className={'badge text-xs ' + st.badge}>
                                {r.type === 'opening'         ? 'Opening'
                                  : r.type === 'bulk_collection' ? 'Receipt'
                                  : r.type === 'imprest'         ? 'Ops/Imprest'
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
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── OUTSTANDING TAB ──────────────────────────────────────────── */}
          {tab === 'outstanding' && (
            <div className="card">
              <div className="text-xs text-gray-400 mb-3">
                All unpaid or partially paid bulk invoices — all time.
                <span className="ml-2 text-red-500 font-medium">Red = overdue (30+ days)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{ width: '90px' }} /><col style={{ width: '72px' }} />
                    <col /><col style={{ width: '72px' }} />
                    <col style={{ width: '105px' }} /><col style={{ width: '105px' }} />
                    <col style={{ width: '105px' }} /><col style={{ width: '75px' }} />
                    <col style={{ width: '80px' }} />
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
                      <tr key={s.id} className={s.overdue ? 'bg-red-50' : ''}>
                        <td className={'muted ' + (s.overdue ? 'text-red-400' : '')}>{fmtDate(s.sale_date)}</td>
                        <td><span className="badge badge-yellow">Bulk</span></td>
                        <td className={'font-medium ' + (s.overdue ? 'text-red-700' : '')}>
                          {s.buyer?.full_name ?? s.customers?.name ?? '—'}
                        </td>
                        <td className={'num ' + (s.overdue ? 'text-red-600 font-bold' : 'text-gray-500')}>
                          {s.daysPast}
                        </td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className={'num font-bold ' + (s.overdue ? 'text-red-700' : 'text-orange-600')}>
                          {fmtGhc(s.outstanding_balance)}
                        </td>
                        <td>
                          <span className={'badge ' + (s.payment_status === 'partial' ? 'badge-yellow' : 'badge-red')}>
                            {s.payment_status}
                          </span>
                        </td>
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
