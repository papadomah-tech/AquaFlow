'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, fmtNum, today, monthStart, getRiderEmployeeIds } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// DEPOSITS ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
// Cash inflow sources tracked here:
//   A. Factory Direct Retail Sales  — amount_paid on retail sales where
//      salesperson is NOT a rider
//   B. Bulk Dispatch Collections    — amount_paid on bulk sales
//   C. Bank Deposits                — manually recorded deposits
//
// Each section shows:
//   • Full invoice list with status (paid / partial / unpaid)
//   • Subtotal of cash collected for that section
//   • Grand total cash in across all sections
//
// Non-admin: filtered to records they created
// ─────────────────────────────────────────────────────────────────────────────

export default function DepositsAccountPage() {
  const { isAdmin, canAccess, userId, employeeName, loading: roleLoading } = useRole()

  const [tab, setTab]           = useState<'summary'|'retail'|'bulk'|'deposits'>('summary')
  const [period, setPeriod]     = useState<'month'|'all'>('month')
  const [data, setData]         = useState<any>(null)
  const [retailSales, setRetailSales] = useState<any[]>([])
  const [bulkSales, setBulkSales]     = useState<any[]>([])
  const [deposits, setDeposits]       = useState<any[]>([])
  const [employees, setEmployees]     = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  // Deposit form
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [form, setForm]         = useState({
    deposit_date: today(), bank_name: '', amount: '',
    reference: '', deposited_by: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  const dateFrom = period === 'month' ? monthStart() : '2000-01-01'

  useEffect(() => {
    supabase.from('employees').select('id,full_name,role,employee_type')
      .eq('status', 'active').order('full_name')
      .then(({ data: e }) => setEmployees(e ?? []))
  }, [])

  const load = useCallback(async () => {
    if (roleLoading) return
    if (!canAccess('fund-account')) { setLoading(false); return }
    setLoading(true)

    // Exclude rider retail — not company revenue
    const riderIds = await getRiderEmployeeIds()

    // ── A. Factory Retail Sales ─────────────────────────────────────────
    const { data: retail } = await supabase
      .from('sales')
      .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,customers(name),employees!salesperson_id(full_name,id)')
      .eq('sale_type', 'retail')
      .gte('sale_date', dateFrom)
      .order('sale_date', { ascending: false })

    // Exclude rider retail
    const factoryRetail = (retail ?? []).filter((s: any) =>
      !s.salesperson_id || !riderIds.includes(s.salesperson_id)
    )
    // Non-admin: only show records linked to them (if salesperson or created by them)
    const filteredRetail = isAdmin ? factoryRetail
      : factoryRetail.filter((s: any) =>
          !s.employees?.id || s.employees?.id === userId)

    // ── B. Bulk Dispatch Sales ──────────────────────────────────────────
    const { data: bulk } = await supabase
      .from('sales')
      .select('id,sale_date,total_amount,amount_paid,outstanding_balance,payment_status,buyer:employees!buyer_employee_id(full_name),employees!salesperson_id(full_name)')
      .eq('sale_type', 'bulk')
      .gte('sale_date', dateFrom)
      .order('sale_date', { ascending: false })

    const filteredBulk = isAdmin ? (bulk ?? [])
      : (bulk ?? []).filter((s: any) => s.employees?.id === userId || !s.salesperson_id)

    // ── C. Bank Deposits ────────────────────────────────────────────────
    let depQ = supabase.from('bank_deposits').select('*')
      .gte('deposit_date', dateFrom).order('deposit_date', { ascending: false })
    if (!isAdmin && userId) depQ = depQ.eq('created_by', userId)
    const { data: deps } = await depQ

    setRetailSales(filteredRetail)
    setBulkSales(filteredBulk)
    setDeposits(deps ?? [])

    // ── Calculations ────────────────────────────────────────────────────
    const retailInvoiced   = filteredRetail.reduce((a: number, s: any) => a + s.total_amount, 0)
    const retailCollected  = filteredRetail.reduce((a: number, s: any) => a + s.amount_paid, 0)
    const retailOutstanding= filteredRetail.reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    const bulkInvoiced     = filteredBulk.reduce((a: number, s: any) => a + s.total_amount, 0)
    const bulkCollected    = filteredBulk.reduce((a: number, s: any) => a + s.amount_paid, 0)
    const bulkOutstanding  = filteredBulk.reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    const totalDeposited   = (deps ?? []).reduce((a: number, d: any) => a + d.amount, 0)

    const grandTotalCashIn = retailCollected + bulkCollected

    setData({
      retailInvoiced, retailCollected, retailOutstanding,
      bulkInvoiced, bulkCollected, bulkOutstanding,
      totalDeposited, grandTotalCashIn,
      retailCount: filteredRetail.length,
      bulkCount: filteredBulk.length,
      depCount: (deps ?? []).length,
    })
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, userId, period, dateFrom, roleLoading])

  useEffect(() => { load() }, [load])

  if (roleLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">Loading...</div>
    </AppLayout>
  )
  if (!canAccess('fund-account')) return (
    <AccessDenied message="You do not have access to the Deposits Account." />
  )

  // ── Deposit form handlers ───────────────────────────────────────────────────
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
    await supabase.from('bank_deposits').delete().eq('id', d.id)
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

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">💰 Deposits Account</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            {isAdmin ? 'All records' : 'Your records only'}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openForm()} className="btn btn-primary">
            + Bank Deposit
          </button>
          <button onClick={() => setPeriod(p => p === 'month' ? 'all' : 'month')}
            className="btn btn-secondary btn-sm">
            {period === 'month' ? 'This Month' : 'All Time'}
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="card mb-4 bg-blue-50 border border-blue-200">
          <div className="text-sm text-blue-700">
            📋 Showing your deposits and sales records only.
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : data && (
        <>
          {/* ── Grand Total Hero ──────────────────────────────────────── */}
          <div className="rounded-2xl p-5 mb-5 bg-[#1F4E79] text-white shadow-lg">
            <div className="text-blue-200 text-sm font-medium">
              Total Cash In — {period === 'month' ? 'This Month' : 'All Time'}
            </div>
            <div className="text-5xl font-bold mt-1 tabular-nums">
              {fmtGhc(data.grandTotalCashIn)}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              {[
                ['Retail Collected',  fmtGhc(data.retailCollected)],
                ['Bulk Collected',    fmtGhc(data.bulkCollected)],
                ['Banked',           fmtGhc(data.totalDeposited)],
                ['Not Banked',       fmtGhc(data.retailCollected + data.bulkCollected - data.totalDeposited)],
              ].map(([l, v], i) => (
                <div key={l as string}
                  className={'rounded-xl p-3 text-center '
                    + (i === 3 ? 'bg-orange-400/30' : 'bg-white/10')}>
                  <div className="text-blue-200 text-xs">{l}</div>
                  <div className={'font-bold tabular-nums mt-0.5 '
                    + (i === 3 ? 'text-orange-200' : 'text-white')}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section Summary Cards ─────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">

            {/* Retail */}
            <div className="card border-l-4 border-[#2E75B6]">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                A. Factory Retail Sales
              </div>
              {[
                ['Invoiced',    fmtGhc(data.retailInvoiced),    'text-[#1F4E79]'],
                ['Collected',   fmtGhc(data.retailCollected),   'text-green-700 font-bold'],
                ['Outstanding', fmtGhc(data.retailOutstanding), 'text-red-600'],
              ].map(([l, v, c]) => (
                <div key={l as string} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-600">{l}</span>
                  <span className={'text-sm tabular-nums ' + c}>{v}</span>
                </div>
              ))}
              <button onClick={() => setTab('retail')}
                className="text-xs text-blue-600 hover:underline mt-2">
                View {data.retailCount} records →
              </button>
            </div>

            {/* Bulk */}
            <div className="card border-l-4 border-orange-400">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                B. Bulk Dispatch Collections
              </div>
              {[
                ['Invoiced',    fmtGhc(data.bulkInvoiced),    'text-[#1F4E79]'],
                ['Collected',   fmtGhc(data.bulkCollected),   'text-green-700 font-bold'],
                ['Outstanding', fmtGhc(data.bulkOutstanding), 'text-red-600'],
              ].map(([l, v, c]) => (
                <div key={l as string} className="flex justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-600">{l}</span>
                  <span className={'text-sm tabular-nums ' + c}>{v}</span>
                </div>
              ))}
              <button onClick={() => setTab('bulk')}
                className="text-xs text-blue-600 hover:underline mt-2">
                View {data.bulkCount} records →
              </button>
            </div>

            {/* Deposits */}
            <div className="card border-l-4 border-green-500">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                C. Bank Deposits
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-sm text-gray-600">Total Banked</span>
                <span className="text-sm font-bold text-green-700 tabular-nums">
                  {fmtGhc(data.totalDeposited)}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-sm text-gray-600">Entries</span>
                <span className="text-sm text-gray-700">{data.depCount}</span>
              </div>
              <button onClick={() => setTab('deposits')}
                className="text-xs text-blue-600 hover:underline mt-2">
                View deposits →
              </button>
            </div>
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
            {TAB('summary',  '📊 Summary')}
            {TAB('retail',   '🛍️ Retail Sales',   data.retailCount)}
            {TAB('bulk',     '📦 Bulk Dispatches', data.bulkCount)}
            {TAB('deposits', '🏦 Bank Deposits',   data.depCount)}
          </div>

          {/* ── SUMMARY TAB ───────────────────────────────────────────── */}
          {tab === 'summary' && (
            <div className="card">
              <div className="text-sm font-bold text-[#1F4E79] uppercase tracking-wider mb-4">
                Cash Inflow Statement
              </div>
              <div className="space-y-1">

                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1">
                  A. Factory Direct Retail Sales
                </div>
                {[
                  ['Total Invoiced',   data.retailInvoiced,    'text-gray-700'],
                  ['Cash Collected',   data.retailCollected,   'text-green-700'],
                  ['Outstanding',      data.retailOutstanding, 'text-red-600'],
                ].map(([l, v, c]) => (
                  <div key={l as string}
                    className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600 pl-2">{l}</span>
                    <span className={'text-sm font-medium tabular-nums ' + c}>{fmtGhc(v as number)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2 px-3 bg-blue-50 rounded-lg">
                  <span className="text-sm font-bold text-[#1F4E79] pl-2">Subtotal Collected (A)</span>
                  <span className="text-sm font-bold text-[#1F4E79] tabular-nums">{fmtGhc(data.retailCollected)}</span>
                </div>

                <div className="border-t border-gray-200 my-3" />

                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1">
                  B. Bulk Dispatch Collections
                </div>
                {[
                  ['Total Invoiced',   data.bulkInvoiced,    'text-gray-700'],
                  ['Cash Collected',   data.bulkCollected,   'text-green-700'],
                  ['Outstanding',      data.bulkOutstanding, 'text-red-600'],
                ].map(([l, v, c]) => (
                  <div key={l as string}
                    className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                    <span className="text-sm text-gray-600 pl-2">{l}</span>
                    <span className={'text-sm font-medium tabular-nums ' + c}>{fmtGhc(v as number)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-2 px-3 bg-orange-50 rounded-lg">
                  <span className="text-sm font-bold text-orange-700 pl-2">Subtotal Collected (B)</span>
                  <span className="text-sm font-bold text-orange-700 tabular-nums">{fmtGhc(data.bulkCollected)}</span>
                </div>

                <div className="border-t border-gray-200 my-3" />

                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 pb-1">
                  C. Bank Deposits
                </div>
                <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                  <span className="text-sm text-gray-600 pl-2">Total Banked ({data.depCount} entries)</span>
                  <span className="text-sm font-medium text-green-700 tabular-nums">{fmtGhc(data.totalDeposited)}</span>
                </div>
                <div className="flex justify-between items-center py-2 px-3 bg-green-50 rounded-lg">
                  <span className="text-sm font-bold text-green-700 pl-2">Subtotal (C)</span>
                  <span className="text-sm font-bold text-green-700 tabular-nums">{fmtGhc(data.totalDeposited)}</span>
                </div>

                <div className="border-t-2 border-[#1F4E79] mt-4 pt-3 space-y-2">
                  <div className="flex justify-between items-center px-3 py-3 bg-[#1F4E79] rounded-xl">
                    <span className="font-bold text-white">GRAND TOTAL CASH IN (A + B)</span>
                    <span className="font-bold text-white text-xl tabular-nums">
                      {fmtGhc(data.retailCollected + data.bulkCollected)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-3 py-3 bg-green-700 rounded-xl">
                    <span className="font-bold text-white">TOTAL CASH NOT BANKED (A + B − C)</span>
                    <span className="font-bold text-white text-xl tabular-nums">
                      {fmtGhc(data.retailCollected + data.bulkCollected - data.totalDeposited)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── RETAIL SALES TAB ──────────────────────────────────────── */}
          {tab === 'retail' && (
            <div className="card">
              <div className="text-sm font-semibold text-[#1F4E79] mb-3">
                🛍️ Factory Direct Retail Sales
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
                      <th>Date</th><th>Customer</th>
                      <th className="right">Invoiced</th>
                      <th className="right">Collected</th>
                      <th className="right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retailSales.length === 0
                      ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                          No factory retail sales in this period
                        </td></tr>
                      : retailSales.map((s: any) => (
                      <tr key={s.id}>
                        <td className="muted">{s.sale_date}</td>
                        <td className="font-medium">{s.customers?.name ?? '—'}</td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                        <td>{BADGE(s.payment_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {retailSales.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={2} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTALS
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.retailInvoiced)}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.retailCollected)}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.retailOutstanding)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── BULK DISPATCHES TAB ───────────────────────────────────── */}
          {tab === 'bulk' && (
            <div className="card">
              <div className="text-sm font-semibold text-[#1F4E79] mb-3">
                📦 Bulk Dispatch Collections
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
                      <th>Date</th><th>Rider / Sales Rep</th>
                      <th className="right">Invoiced</th>
                      <th className="right">Collected</th>
                      <th className="right">Outstanding</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkSales.length === 0
                      ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                          No bulk dispatches in this period
                        </td></tr>
                      : bulkSales.map((s: any) => (
                      <tr key={s.id}>
                        <td className="muted">{s.sale_date}</td>
                        <td className="font-medium">{s.buyer?.full_name ?? '—'}</td>
                        <td className="num">{fmtGhc(s.total_amount)}</td>
                        <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                        <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                        <td>{BADGE(s.payment_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {bulkSales.length > 0 && (
                    <tfoot>
                      <tr className="bg-orange-600">
                        <td colSpan={2} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTALS
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.bulkInvoiced)}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.bulkCollected)}
                        </td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(data.bulkOutstanding)}
                        </td>
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
                🏦 Bank Deposits
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
                          No deposits in this period
                        </td></tr>
                      : deposits.map((d: any) => (
                      <tr key={d.id}>
                        <td className="muted">{d.deposit_date}</td>
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
                        <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL BANKED
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
