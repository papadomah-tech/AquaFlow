'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, fmtDate, today } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD REPORT MODULE
// User picks a date range → system computes revenue summary from that period
// → User confirms to lock Expected Amount (= Net Cash Available)
// → User enters Actual Amount Paid → system flags Settled / Overpaid / Underpaid
// ─────────────────────────────────────────────────────────────────────────────

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

function PeriodReportInner() {
  const { isAdmin } = useRole()

  // ── Date range ──
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(today)

  // ── Generate state ──
  const [loading,   setLoading]   = useState(false)
  const [summary,   setSummary]   = useState<any>(null)   // computed summary
  const [confirmed, setConfirmed] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // ── Payment form ──
  const [actualAmt, setActualAmt] = useState('')
  const [payNotes,  setPayNotes]  = useState('')
  const [saving,    setSaving]    = useState(false)

  // ── History ──
  const [history,      setHistory]      = useState<any[]>([])
  const [histLoading,  setHistLoading]  = useState(true)

  // ── Active report (after Confirm) ──
  const [activeReport, setActiveReport] = useState<any>(null)

  // Load history
  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    const { data } = await supabase
      .from('period_payment_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setHistory(data ?? [])
    setHistLoading(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Generate summary from raw data
  const generate = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      alert('Please select a valid date range.'); return
    }
    setLoading(true)
    setSummary(null)
    setConfirmed(false)
    setActiveReport(null)

    const [
      { data: salesData },
      { data: imprestData },
      { data: batchData },
    ] = await Promise.all([
      supabase.from('sales')
        .select('sale_date,bags_sold,total_amount,amount_paid,is_overtime,is_giveaway,protocol_bags,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .eq('sale_type', 'bulk')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('sale_date', dateFrom).lte('sale_date', dateTo),
      supabase.from('imprest_entries')
        .select('entry_date,amount,description')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('entry_date', dateFrom).lte('entry_date', dateTo),
      supabase.from('production_batches')
        .select('batch_date,bags_produced')
        .gte('batch_date', dateFrom).lte('batch_date', dateTo),
    ])

    const sales    = salesData    ?? []
    const imprest  = imprestData  ?? []
    const batches  = batchData    ?? []

    const paidSales     = sales.filter(s => !s.is_giveaway)
    const giveawaySales = sales.filter(s => s.is_giveaway)

    // Est revenue
    const estRevenue = paidSales.reduce((a, s: any) => {
      const price = s.is_overtime ? PRICE_OT : (s.buyer?.full_name ? PRICE_RIDER : PRICE_EXTERNAL)
      return a + s.bags_sold * price
    }, 0)

    // Actual collected
    const collected = paidSales.reduce((a, s: any) => a + (s.amount_paid || 0), 0)

    // Protocol bags
    const protocolBags = paidSales.reduce((a, s: any) => a + (s.protocol_bags || 0), 0)

    // Giveaway bags
    const giveawayBags = giveawaySales.reduce((a, s: any) => a + s.bags_sold, 0)

    // Imprest
    const totalImprest = imprest.reduce((a, e: any) => a + (e.amount || 0), 0)

    // Operator fee
    const totalBagsProduced = batches.reduce((a, b: any) => a + b.bags_produced, 0)
    const opFee = Math.floor(totalBagsProduced / 100) * OP_FEE_PER_100

    // Net cash
    const netCash = Math.max(0, collected - totalImprest - opFee)

    setSummary({
      dateFrom, dateTo,
      estRevenue, collected, protocolBags, giveawayBags,
      totalImprest, opFee, netCash,
      salesCount:    paidSales.length,
      imprestEntries: imprest,
    })
    setLoading(false)
  }, [dateFrom, dateTo])

  // Confirm → lock expected amount and save to DB
  const confirmReport = useCallback(async () => {
    if (!summary) return
    setConfirming(true)
    const { data, error } = await supabase.from('period_payment_reports').insert({
      date_from:       summary.dateFrom,
      date_to:         summary.dateTo,
      expected_amount: summary.netCash,
      status:          'pending',
    }).select().single()
    if (error) { alert('Failed to save report: ' + error.message); setConfirming(false); return }
    setActiveReport(data)
    setConfirmed(true)
    setActualAmt(String(summary.netCash))
    setConfirming(false)
    loadHistory()
  }, [summary, loadHistory])

  // Record actual payment
  const recordPayment = useCallback(async () => {
    if (!activeReport) return
    const actual = parseFloat(actualAmt) || 0
    const expected = activeReport.expected_amount
    let status: ReportStatus = 'settled'
    if (actual > expected) status = 'overpaid'
    else if (actual < expected) status = 'underpaid'
    setSaving(true)
    const { error } = await supabase.from('period_payment_reports').update({
      actual_amount: actual,
      notes:         payNotes || null,
      status,
      settled_at:    new Date().toISOString(),
    }).eq('id', activeReport.id)
    if (error) { alert('Failed to record payment: ' + error.message); setSaving(false); return }
    setActiveReport((p: any) => ({ ...p, actual_amount: actual, status, notes: payNotes }))
    setSaving(false)
    loadHistory()
  }, [activeReport, actualAmt, payNotes, loadHistory])

  // Record payment for a history row
  const recordHistoryPayment = useCallback(async (row: any, actual: number, notes: string) => {
    const expected = row.expected_amount
    let status: ReportStatus = 'settled'
    if (actual > expected) status = 'overpaid'
    else if (actual < expected) status = 'underpaid'
    const { error } = await supabase.from('period_payment_reports').update({
      actual_amount: actual, notes: notes || null, status,
      settled_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) { alert('Failed: ' + error.message); return }
    loadHistory()
  }, [loadHistory])

  const gap = activeReport
    ? (parseFloat(actualAmt) || 0) - activeReport.expected_amount
    : 0

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🗓️ Period Report</h1>
          <p className="text-xs text-gray-400 mt-0.5">Set a date range, review the revenue summary, confirm the expected payment, then record the actual amount paid.</p>
        </div>
      </div>

      {/* ── Step 1 — Date range ──────────────────────────────────── */}
      <div className="card mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 1 — Select Date Range</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="form-label">Start Date *</label>
            <input type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="form-input" />
          </div>
          <div className="form-group mb-0">
            <label className="form-label">End Date *</label>
            <input type="date" value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="form-input" />
          </div>
          <button onClick={generate} disabled={loading}
            className="btn btn-primary">
            {loading ? 'Generating...' : '🔍 Generate Report'}
          </button>
        </div>
      </div>

      {/* ── Step 2 — Summary ─────────────────────────────────────── */}
      {summary && (
        <div className="card mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Step 2 — Period Summary
            </div>
            <div className="text-xs text-gray-400">
              {fmtDate(summary.dateFrom)} → {fmtDate(summary.dateTo)}
            </div>
          </div>

          {/* Summary grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Est. Revenue',    value: fmtGhc(summary.estRevenue),   color: '#5C6BC0' },
              { label: 'Actual Collected',value: fmtGhc(summary.collected),    color: '#1B5E20' },
              { label: 'Imprest / Expenses', value: `− ${fmtGhc(summary.totalImprest)}`, color: '#BF4D00' },
              { label: 'Operator Fee',    value: `− ${fmtGhc(summary.opFee)}`, color: '#BF4D00' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xs text-gray-400 mb-1">{label}</div>
                <div className="font-bold tabular-nums text-sm" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Protocol & Giveaway */}
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
            {!confirmed && (
              <button onClick={confirmReport} disabled={confirming}
                className="btn bg-white text-[#1F4E79] font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-50 transition-all">
                {confirming ? 'Saving...' : '✓ Confirm & Lock'}
              </button>
            )}
            {confirmed && (
              <span className="text-green-300 font-semibold text-sm">✅ Locked</span>
            )}
          </div>

          {/* Step 3 — Record payment */}
          {confirmed && activeReport && (
            <div className="border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Step 3 — Record Actual Payment
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div className="form-group mb-0">
                  <label className="form-label">Actual Amount Paid (GH₵)</label>
                  <input type="number" step="0.01" value={actualAmt}
                    onChange={e => setActualAmt(e.target.value)}
                    className="form-input" />
                  {actualAmt && (
                    <div className={`text-xs mt-1 font-medium ${
                      gap === 0 ? 'text-green-600'
                      : gap > 0 ? 'text-blue-600'
                      : 'text-red-600'
                    }`}>
                      {gap === 0 ? '✅ Exact — Settled'
                        : gap > 0 ? `⬆️ Overpaid by ${fmtGhc(Math.abs(gap))}`
                        : `⬇️ Underpaid by ${fmtGhc(Math.abs(gap))} — Settle`}
                    </div>
                  )}
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Notes (optional)</label>
                  <input type="text" value={payNotes}
                    onChange={e => setPayNotes(e.target.value)}
                    className="form-input" placeholder="e.g. Bank transfer ref..." />
                </div>
                <button onClick={recordPayment} disabled={saving || !actualAmt}
                  className="btn btn-primary">
                  {saving ? 'Saving...' : '💾 Record Payment'}
                </button>
              </div>
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

      {/* ── History ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Past Period Reports</div>
        {histLoading ? (
          <div className="text-center py-6 text-gray-400 text-sm">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">No reports yet. Generate one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-right px-3 py-2 font-medium">Expected</th>
                <th className="text-right px-3 py-2 font-medium">Actual Paid</th>
                <th className="text-right px-3 py-2 font-medium">Difference</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                <th className="text-center px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row: any) => {
                const diff = row.actual_amount != null ? row.actual_amount - row.expected_amount : null
                return (
                  <HistoryRow key={row.id} row={row} diff={diff}
                    onSettle={recordHistoryPayment} />
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}

// Inline editable row for pending history records
function HistoryRow({ row, diff, onSettle }: { row: any; diff: number | null; onSettle: any }) {
  const [editing, setEditing] = useState(false)
  const [amt, setAmt]         = useState(String(row.actual_amount ?? ''))
  const [notes, setNotes]     = useState(row.notes ?? '')
  const [saving, setSaving]   = useState(false)

  const save = async () => {
    setSaving(true)
    await onSettle(row, parseFloat(amt) || 0, notes)
    setSaving(false)
    setEditing(false)
  }

  const rowDiff = amt ? (parseFloat(amt) || 0) - row.expected_amount : diff

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="font-medium text-[#1F4E79]">{fmtDate(row.date_from)} → {fmtDate(row.date_to)}</div>
        <div className="text-xs text-gray-400">{new Date(row.created_at).toLocaleDateString('en-GB')}</div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1F4E79]">
        {fmtGhc(row.expected_amount)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {editing ? (
          <input type="number" step="0.01" value={amt}
            onChange={e => setAmt(e.target.value)}
            className="form-input text-right w-28 py-1 text-xs" />
        ) : row.actual_amount != null
          ? <span className="font-medium">{fmtGhc(row.actual_amount)}</span>
          : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs">
        {rowDiff != null ? (
          <span className={rowDiff === 0 ? 'text-green-600' : rowDiff > 0 ? 'text-blue-600' : 'text-red-600'}>
            {rowDiff === 0 ? '—' : rowDiff > 0 ? `+${fmtGhc(rowDiff)}` : fmtGhc(rowDiff)}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-2.5 text-gray-400 text-xs">
        {editing ? (
          <input type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            className="form-input py-1 text-xs w-32" />
        ) : row.notes || '—'}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`badge text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[row.status as ReportStatus] ?? ''}`}>
          {STATUS_LABELS[row.status as ReportStatus] ?? row.status}
        </span>
      </td>
      <td className="px-3 py-2.5 text-center">
        {row.status === 'pending' || row.status === 'underpaid' || row.status === 'overpaid' ? (
          editing ? (
            <div className="flex gap-1 justify-center">
              <button onClick={save} disabled={saving}
                className="btn btn-sm btn-primary" style={{fontSize:'11px',padding:'2px 8px'}}>
                {saving ? '...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)}
                className="btn btn-sm btn-secondary" style={{fontSize:'11px',padding:'2px 8px'}}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)}
              className="btn btn-sm btn-warning" style={{fontSize:'11px',padding:'2px 8px'}}>
              {row.status === 'pending' ? 'Pay' : 'Settle'}
            </button>
          )
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

export default function PeriodReportPage() {
  return (
    <ModuleGuard moduleKey="period-report" moduleLabel="Period Report">
      <PeriodReportInner />
    </ModuleGuard>
  )
}
