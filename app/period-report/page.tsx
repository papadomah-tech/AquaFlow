'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, fmtDate, today } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

const PRICE_RIDER    = 6
const PRICE_EXTERNAL = 4.8
const PRICE_OT       = 6
const OP_FEE_PER_100 = 30

type ReportStatus = 'pending' | 'settled' | 'overpaid' | 'underpaid'

const STATUS_STYLES: Record<ReportStatus, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  settled:   'bg-green-100 text-green-700',
  overpaid:  'bg-blue-100 text-blue-700',
  underpaid: 'bg-red-100 text-red-700',
}
const STATUS_LABELS: Record<ReportStatus, string> = {
  pending:   '⏳ Pending Payment',
  settled:   '✅ Settled',
  overpaid:  '⬆️ Overpaid',
  underpaid: '⬇️ Underpaid — Settle',
}

// ── Collapsible detail panel ──────────────────────────────────────────────────
function DetailPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="border-t border-gray-100 bg-white overflow-x-auto">
      {children}
    </div>
  )
}

function PeriodReportInner() {
  const { isAdmin } = useRole()

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [dateTo,   setDateTo]   = useState(today)

  const [loading,    setLoading]    = useState(false)
  const [summary,    setSummary]    = useState<any>(null)
  const [confirmed,  setConfirmed]  = useState(false)
  const [confirming, setConfirming] = useState(false)

  const [actualAmt, setActualAmt] = useState('')
  const [payNotes,  setPayNotes]  = useState('')
  const [saving,    setSaving]    = useState(false)

  const [history,     setHistory]     = useState<any[]>([])
  const [histLoading, setHistLoading] = useState(true)
  const [activeReport, setActiveReport] = useState<any>(null)

  // Which drill-down panels are open
  const [openPanel, setOpenPanel] = useState<string | null>(null)
  const togglePanel = (key: string) => setOpenPanel(p => p === key ? null : key)

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    const { data } = await supabase
      .from('period_payment_reports').select('*')
      .order('created_at', { ascending: false }).limit(50)
    setHistory(data ?? [])
    setHistLoading(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const generate = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      alert('Please select a valid date range.'); return
    }
    setLoading(true); setSummary(null); setConfirmed(false)
    setActiveReport(null); setOpenPanel(null)

    const [{ data: salesData }, { data: imprestData }, { data: batchData }] = await Promise.all([
      supabase.from('sales')
        .select('sale_date,bags_sold,total_amount,amount_paid,unit_price,is_overtime,is_giveaway,protocol_bags,recipient_category,recipient_name,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .eq('sale_type', 'bulk').or('is_archived.is.null,is_archived.eq.false')
        .gte('sale_date', dateFrom).lte('sale_date', dateTo),
      supabase.from('imprest_entries')
        .select('entry_date,amount,description,category')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('entry_date', dateFrom).lte('entry_date', dateTo),
      supabase.from('production_batches')
        .select('batch_date,bags_produced,batch_number').gte('batch_date', dateFrom).lte('batch_date', dateTo),
    ])

    const sales    = salesData   ?? []
    const imprest  = imprestData ?? []
    const batches  = batchData   ?? []
    const paidSales     = sales.filter((s: any) => !s.is_giveaway)
    const giveawaySales = sales.filter((s: any) => s.is_giveaway)

    const estRevenue   = paidSales.reduce((a: number, s: any) => {
      const price = s.is_overtime ? PRICE_OT : (s.buyer?.full_name ? PRICE_RIDER : PRICE_EXTERNAL)
      return a + s.bags_sold * price
    }, 0)
    const collected    = paidSales.reduce((a: number, s: any) => a + (s.amount_paid || 0), 0)
    const protocolBags = paidSales.reduce((a: number, s: any) => a + (s.protocol_bags || 0), 0)
    const giveawayBags = giveawaySales.reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalImprest = imprest.reduce((a: number, e: any) => a + (e.amount || 0), 0)
    const totalBagsProduced = batches.reduce((a: number, b: any) => a + b.bags_produced, 0)
    const opFee    = Math.floor(totalBagsProduced / 100) * OP_FEE_PER_100
    const netCash  = Math.max(0, collected - totalImprest - opFee)

    setSummary({
      dateFrom, dateTo,
      estRevenue, collected, protocolBags, giveawayBags,
      totalImprest, opFee, netCash,
      paidSales, giveawaySales, imprestEntries: imprest, batches,
    })
    setLoading(false)
  }, [dateFrom, dateTo])

  const confirmReport = useCallback(async () => {
    if (!summary) return
    setConfirming(true)
    const { data, error } = await supabase.from('period_payment_reports').insert({
      date_from: summary.dateFrom, date_to: summary.dateTo,
      expected_amount: summary.netCash, status: 'pending',
    }).select().single()
    if (error) { alert('Failed to save: ' + error.message); setConfirming(false); return }
    setActiveReport(data)
    setConfirmed(true)
    setActualAmt(String(summary.netCash))
    setConfirming(false)
    loadHistory()
  }, [summary, loadHistory])

  const recordPayment = useCallback(async () => {
    if (!activeReport) return
    const actual   = parseFloat(actualAmt) || 0
    const expected = activeReport.expected_amount
    let status: ReportStatus = actual > expected ? 'overpaid' : actual < expected ? 'underpaid' : 'settled'
    setSaving(true)
    const { error } = await supabase.from('period_payment_reports').update({
      actual_amount: actual, notes: payNotes || null,
      status, settled_at: new Date().toISOString(),
    }).eq('id', activeReport.id)
    if (error) { alert('Failed: ' + error.message); setSaving(false); return }
    setActiveReport((p: any) => ({ ...p, actual_amount: actual, status }))
    setSaving(false)
    loadHistory()
  }, [activeReport, actualAmt, payNotes, loadHistory])

  const recordHistoryPayment = useCallback(async (row: any, actual: number, notes: string) => {
    const expected = row.expected_amount
    const status: ReportStatus = actual > expected ? 'overpaid' : actual < expected ? 'underpaid' : 'settled'
    const { error } = await supabase.from('period_payment_reports').update({
      actual_amount: actual, notes: notes || null, status,
      settled_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { alert('Failed: ' + error.message); return }
    loadHistory()
  }, [loadHistory])

  const gap = activeReport ? (parseFloat(actualAmt) || 0) - activeReport.expected_amount : 0

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🗓️ Period Report</h1>
          <p className="text-xs text-gray-400 mt-0.5">Set a date range · review summary · confirm expected payment · record actual paid.</p>
        </div>
      </div>

      {/* Step 1 */}
      <div className="card mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 1 — Select Date Range</div>
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="form-group mb-0 flex-1">
            <label className="form-label">Start Date *</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="form-input" />
          </div>
          <div className="form-group mb-0 flex-1">
            <label className="form-label">End Date *</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="form-input" />
          </div>
          <button onClick={generate} disabled={loading} className="btn btn-primary flex-1">
            {loading ? 'Generating...' : '🔍 Generate Report'}
          </button>
        </div>
      </div>

      {/* Step 2 — Summary with drill-downs */}
      {summary && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Step 2 — Period Summary</div>
            <div className="text-xs text-gray-400">{fmtDate(summary.dateFrom)} → {fmtDate(summary.dateTo)}</div>
          </div>
          <p className="text-xs text-gray-400 mb-3">💡 Click any figure to see the details behind it.</p>

          {/* Est. Revenue card + drill-down */}
          <div className={`mb-2 rounded-xl border overflow-hidden ${openPanel === 'revenue' ? 'border-indigo-200' : 'border-gray-100'}`}>
            <button onClick={() => togglePanel('revenue')}
              className={`w-full text-left p-3 flex items-center justify-between transition-all ${openPanel === 'revenue' ? 'bg-indigo-50' : 'bg-gray-50 hover:bg-gray-100'}`}>
              <span className="text-xs text-gray-500">Est. Revenue</span>
              <span className="font-bold tabular-nums text-sm text-indigo-700">
                {fmtGhc(summary.estRevenue)} {openPanel === 'revenue' ? '▲' : '▼'}
              </span>
            </button>
            <DetailPanel open={openPanel === 'revenue'}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
                Dispatches — {summary.paidSales.length} records
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Rider / Customer</th>
                    <th className="text-right px-3 py-2">Bags</th>
                    <th className="text-right px-3 py-2">Price</th>
                    <th className="text-right px-3 py-2">Est. Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.paidSales.map((s: any, i: number) => {
                    const price = s.is_overtime ? PRICE_OT : (s.buyer?.full_name ? PRICE_RIDER : PRICE_EXTERNAL)
                    const name  = s.buyer?.full_name ?? s.customers?.name ?? 'Unknown'
                    return (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-500">{fmtDate(s.sale_date)}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-700">
                          {name}{s.is_overtime && <span className="ml-1 text-yellow-600 text-[10px]">OT</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(s.bags_sold)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">GH₵{price}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-indigo-700">{fmtGhc(s.bags_sold * price)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-bold">
                    <td colSpan={4} className="px-3 py-2 text-gray-700">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-indigo-700">{fmtGhc(summary.estRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </DetailPanel>
          </div>

          {/* Actual Collected card + drill-down */}
          <div className={`mb-2 rounded-xl border overflow-hidden ${openPanel === 'collected' ? 'border-green-200' : 'border-gray-100'}`}>
            <button onClick={() => togglePanel('collected')}
              className={`w-full text-left p-3 flex items-center justify-between transition-all ${openPanel === 'collected' ? 'bg-green-50' : 'bg-gray-50 hover:bg-gray-100'}`}>
              <span className="text-xs text-gray-500">Actual Collected</span>
              <span className="font-bold tabular-nums text-sm text-green-700">
                {fmtGhc(summary.collected)} {openPanel === 'collected' ? '▲' : '▼'}
              </span>
            </button>
            <DetailPanel open={openPanel === 'collected'}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">Payments received</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Rider / Customer</th>
                    <th className="text-right px-3 py-2">Invoiced</th>
                    <th className="text-right px-3 py-2">Collected</th>
                    <th className="text-right px-3 py-2">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.paidSales.map((s: any, i: number) => {
                    const name = s.buyer?.full_name ?? s.customers?.name ?? 'Unknown'
                    const bal  = (s.total_amount || 0) - (s.amount_paid || 0)
                    return (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="px-3 py-1.5 text-gray-500">{fmtDate(s.sale_date)}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-700">{name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{fmtGhc(s.total_amount)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-green-700">{fmtGhc(s.amount_paid)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: bal > 0 ? '#BF4D00' : '#1B5E20' }}>
                          {bal > 0 ? fmtGhc(bal) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-bold">
                    <td colSpan={3} className="px-3 py-2 text-gray-700">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700">{fmtGhc(summary.collected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: '#BF4D00' }}>
                      {fmtGhc(summary.paidSales.reduce((a: number, s: any) => a + Math.max(0, (s.total_amount || 0) - (s.amount_paid || 0)), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </DetailPanel>
          </div>

          {/* Imprest card + drill-down */}
          <div className={`mb-2 rounded-xl border overflow-hidden ${openPanel === 'imprest' ? 'border-red-200' : 'border-gray-100'}`}>
            <button onClick={() => togglePanel('imprest')}
              className={`w-full text-left p-3 flex items-center justify-between transition-all ${openPanel === 'imprest' ? 'bg-red-50' : 'bg-gray-50 hover:bg-gray-100'}`}>
              <span className="text-xs text-gray-500">Imprest / Expenses</span>
              <span className="font-bold tabular-nums text-sm text-red-700">
                − {fmtGhc(summary.totalImprest)} {openPanel === 'imprest' ? '▲' : '▼'}
              </span>
            </button>
            <DetailPanel open={openPanel === 'imprest'}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
                Imprest entries — {summary.imprestEntries.length} records
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.imprestEntries.map((e: any, i: number) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 text-gray-500">{fmtDate(e.entry_date)}</td>
                      <td className="px-3 py-1.5 text-gray-700">{e.description || e.category || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-red-600 font-medium">{fmtGhc(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-bold">
                    <td colSpan={2} className="px-3 py-2 text-gray-700">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{fmtGhc(summary.totalImprest)}</td>
                  </tr>
                </tfoot>
              </table>
            </DetailPanel>
          </div>

          {/* Operator Fee card + drill-down */}
          <div className={`mb-4 rounded-xl border overflow-hidden ${openPanel === 'opfee' ? 'border-orange-200' : 'border-gray-100'}`}>
            <button onClick={() => togglePanel('opfee')}
              className={`w-full text-left p-3 flex items-center justify-between transition-all ${openPanel === 'opfee' ? 'bg-orange-50' : 'bg-gray-50 hover:bg-gray-100'}`}>
              <span className="text-xs text-gray-500">Operator Fee</span>
              <span className="font-bold tabular-nums text-sm text-orange-700">
                − {fmtGhc(summary.opFee)} {openPanel === 'opfee' ? '▲' : '▼'}
              </span>
            </button>
            <DetailPanel open={openPanel === 'opfee'}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">
                Production batches — GH₵30 per 100 bags produced
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-400">
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Batch Ref</th>
                    <th className="text-right px-3 py-2">Bags Produced</th>
                    <th className="text-right px-3 py-2">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.batches.map((b: any, i: number) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 text-gray-500">{fmtDate(b.batch_date)}</td>
                      <td className="px-3 py-1.5 text-gray-500">{b.batch_number || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(b.bags_produced)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-orange-700 font-medium">
                        {fmtGhc(Math.floor(b.bags_produced / 100) * OP_FEE_PER_100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-bold">
                    <td colSpan={3} className="px-3 py-2 text-gray-700">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700">{fmtGhc(summary.opFee)}</td>
                  </tr>
                </tfoot>
              </table>
            </DetailPanel>
          </div>

          {/* Protocol & Giveaway tags */}
          {(summary.protocolBags > 0 || summary.giveawayBags > 0) && (
            <div className="flex gap-3 mb-4">
              {summary.protocolBags > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-xs text-orange-700 font-medium">
                  🎁 Protocol Bags: {fmtNum(summary.protocolBags)} bags (zero revenue)
                </div>
              )}
              {summary.giveawayBags > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 font-medium">
                  🎁 Free Giveaway: {fmtNum(summary.giveawayBags)} bags (zero revenue)
                </div>
              )}
            </div>
          )}

          {/* Net cash highlight */}
          <div className="rounded-2xl bg-[#1F4E79] text-white p-4 flex items-center justify-between mb-4">
            <div>
              <div className="text-blue-200 text-xs mb-1">Net Cash Available (Expected Payment)</div>
              <div className="text-2xl font-bold tabular-nums">{fmtGhc(summary.netCash)}</div>
              <div className="text-blue-300 text-xs mt-1">Collected − Imprest − Operator Fee</div>
            </div>
            {!confirmed
              ? <button onClick={confirmReport} disabled={confirming}
                  className="btn bg-white text-[#1F4E79] font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50">
                  {confirming ? 'Saving...' : '✓ Confirm & Lock'}
                </button>
              : <span className="text-green-300 font-semibold text-sm">✅ Locked</span>}
          </div>

          {/* Step 3 — Record payment */}
          {confirmed && activeReport && (
            <div className="border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 3 — Record Actual Payment</div>
              <div className="flex flex-col md:flex-row gap-3 items-end">
                <div className="form-group mb-0 flex-1">
                  <label className="form-label">Actual Amount Paid (GH₵)</label>
                  <input type="number" step="0.01" value={actualAmt}
                    onChange={e => setActualAmt(e.target.value)} className="form-input" />
                </div>
                <div className="form-group mb-0 flex-1">
                  <label className="form-label">Notes (optional)</label>
                  <input type="text" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                    className="form-input" placeholder="e.g. Bank transfer ref..." />
                </div>
                <button onClick={recordPayment} disabled={saving || !actualAmt} className="btn btn-primary flex-1">
                  {saving ? 'Saving...' : '💾 Record Payment'}
                </button>
              </div>
              {actualAmt && (
                <div className={`text-xs mt-2 font-medium ${gap === 0 ? 'text-green-600' : gap > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  {gap === 0 ? '✅ Exact — Settled'
                    : gap > 0 ? `⬆️ Overpaid by ${fmtGhc(Math.abs(gap))}`
                    : `⬇️ Underpaid by ${fmtGhc(Math.abs(gap))} — Settle`}
                </div>
              )}
              {activeReport.actual_amount != null && (
                <div className={`mt-3 rounded-xl px-4 py-3 text-sm font-semibold ${STATUS_STYLES[activeReport.status as ReportStatus]}`}>
                  {STATUS_LABELS[activeReport.status as ReportStatus]}
                  {activeReport.status !== 'settled' && (
                    <span className="ml-2 font-normal">
                      Difference: {fmtGhc(Math.abs(activeReport.actual_amount - activeReport.expected_amount))}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="card">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Past Period Reports</div>
        {histLoading ? (
          <div className="text-center py-6 text-gray-400 text-sm">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">No reports yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-right px-3 py-2 font-medium">Expected</th>
                <th className="text-right px-3 py-2 font-medium">Actual Paid</th>
                <th className="text-right px-3 py-2 font-medium">Difference</th>
                <th className="text-right px-3 py-2 font-medium">Carried Fwd</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Sort by date_from ascending to compute running balance
                const sorted = [...history].sort((a, b) => a.date_from.localeCompare(b.date_from))
                let runningBalance = 0
                const withBalance = sorted.map(row => {
                  const diff = row.actual_amount != null ? row.actual_amount - row.expected_amount : 0
                  runningBalance += diff
                  return { ...row, runningBalance, diff: row.actual_amount != null ? diff : null }
                })
                // Re-sort back to descending for display (most recent first)
                const displayed = [...withBalance].sort((a, b) => b.date_from.localeCompare(a.date_from))
                return displayed.map((row: any) => (
                  <HistoryRow key={row.id} row={row} diff={row.diff}
                    runningBalance={row.runningBalance} onSettle={recordHistoryPayment} />
                ))
              })()}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}

function HistoryRow({ row, diff, runningBalance, onSettle }: { row: any; diff: number | null; runningBalance: number; onSettle: any }) {
  const [editing, setEditing] = useState(false)
  const [amt,     setAmt]     = useState(String(row.actual_amount ?? row.expected_amount))
  const [notes,   setNotes]   = useState(row.notes ?? '')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    await onSettle(row, parseFloat(amt) || 0, notes)
    setSaving(false); setEditing(false)
  }

  const liveDiff = (parseFloat(amt) || 0) - row.expected_amount

  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="font-medium text-[#1F4E79]">{fmtDate(row.date_from)} → {fmtDate(row.date_to)}</div>
          <div className="text-xs text-gray-400">{new Date(row.created_at).toLocaleDateString('en-GB')}</div>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1F4E79]">
          {fmtGhc(row.expected_amount)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {editing
            ? <input type="number" step="0.01" value={amt} onChange={e => setAmt(e.target.value)}
                className="form-input text-right w-28 py-1 text-xs" />
            : row.actual_amount != null
              ? <span className="font-medium">{fmtGhc(row.actual_amount)}</span>
              : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {editing
            ? <span className={liveDiff === 0 ? 'text-green-600' : liveDiff > 0 ? 'text-blue-600' : 'text-red-600'}>
                {liveDiff === 0 ? 'Exact' : liveDiff > 0 ? `+${fmtGhc(liveDiff)}` : fmtGhc(liveDiff)}
              </span>
            : diff != null
              ? <span className={diff === 0 ? 'text-green-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}>
                  {diff === 0 ? '—' : diff > 0 ? `+${fmtGhc(diff)}` : fmtGhc(diff)}
                </span>
              : '—'}
        </td>
        {/* Carried Forward — running cumulative balance across all periods */}
        <td className="px-3 py-2.5 text-right tabular-nums text-xs font-semibold">
          {row.actual_amount != null ? (
            <span className={runningBalance === 0 ? 'text-green-600' : runningBalance > 0 ? 'text-blue-600' : 'text-red-600'}>
              {runningBalance === 0 ? '✅ Clear'
                : runningBalance > 0 ? `+${fmtGhc(runningBalance)}`
                : fmtGhc(runningBalance)}
            </span>
          ) : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2.5 text-gray-400 text-xs">
          {editing
            ? <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                className="form-input py-1 text-xs w-32" placeholder="Notes..." />
            : row.notes || '—'}
        </td>
        <td className="px-3 py-2.5 text-center">
          <span className={`badge text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[row.status as ReportStatus] ?? ''}`}>
            {STATUS_LABELS[row.status as ReportStatus] ?? row.status}
          </span>
        </td>
        <td className="px-3 py-2.5 text-center">
          {row.status !== 'settled' ? (
            editing
              ? <div className="flex gap-1 justify-center">
                  <button onClick={save} disabled={saving}
                    className="btn btn-sm btn-primary" style={{fontSize:'11px',padding:'2px 8px'}}>
                    {saving ? '...' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="btn btn-sm btn-secondary" style={{fontSize:'11px',padding:'2px 8px'}}>
                    Cancel
                  </button>
                </div>
              : <button onClick={() => setEditing(true)}
                  className="btn btn-sm btn-warning" style={{fontSize:'11px',padding:'2px 8px'}}>
                  {row.status === 'pending' ? '💰 Pay' : '⚖️ Settle'}
                </button>
          ) : <span className="text-gray-300 text-xs">—</span>}
        </td>
      </tr>
      {/* Inline payment hint when editing */}
      {editing && (
        <tr className="bg-yellow-50 border-t border-yellow-100">
          <td colSpan={8} className="px-4 py-2 text-xs text-yellow-700">
            Expected: <strong>{fmtGhc(row.expected_amount)}</strong>
            {liveDiff !== 0 && (
              <span className="ml-2">
                {liveDiff > 0
                  ? `⬆️ Overpaid by ${fmtGhc(Math.abs(liveDiff))}`
                  : `⬇️ Still owing ${fmtGhc(Math.abs(liveDiff))} after this payment`}
              </span>
            )}
            {liveDiff === 0 && <span className="ml-2 text-green-700">✅ Exact — will mark as Settled</span>}
          </td>
        </tr>
      )}
    </>
  )
}

export default function PeriodReportPage() {
  return (
    <ModuleGuard moduleKey="period-report" moduleLabel="Period Report">
      <PeriodReportInner />
    </ModuleGuard>
  )
}
