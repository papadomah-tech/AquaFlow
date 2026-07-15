'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtNum, fmtDate, today } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// LOSSES & PROTOCOL
// ─────────────────────────────────────────────────────────────────────────────
// Factory manager module for recording two types of stock reduction:
//
//   Destroyed  — bags that are damaged, burst, or unfit for sale
//                Fields: date, quantity, reason/description, rider (optional)
//                Rider who reported the damage is stored in the notes field as
//                "| Reported by: <name> [rider_id:<id>]" — informational only.
//                posted to finished_inventory with reference_type = 'loss'
//
//   Protocol   — bags given out for testing, sampling, or regulatory purposes
//                Fields: date, quantity, recipient (mandatory), purpose
//                posted to finished_inventory with reference_type = 'protocol'
//
// Both types:
//   • Block if quantity exceeds current available stock
//   • Deduct from stock immediately via bags_out on finished_inventory
//   • Appear in the Stock ledger with their respective badge colours
// ─────────────────────────────────────────────────────────────────────────────

type EntryType = 'loss' | 'protocol'

interface LossEntry {
  id:             number
  transaction_date: string
  reference_type: EntryType
  bags_out:       number
  notes:          string
  is_locked:      boolean
}

// Parse rider name from encoded notes string
function parseRider(notes: string): string | null {
  const m = notes.match(/Reported by: ([^|[]+)\[rider_id:/);
  return m ? m[1].trim() : null
}

function LossesPageInner() {
  const [tab, setTab]         = useState<'destroyed' | 'protocol' | 'history'>('destroyed')
  const [entries, setEntries] = useState<LossEntry[]>([])
  const [stock, setStock]     = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [riders, setRiders]   = useState<any[]>([])

  // Destroyed form — includes optional rider who reported it
  const [dForm, setDForm] = useState({
    date: today(), qty: '', reason: '', rider_id: '',
  })

  // Protocol form
  const [pForm, setPForm] = useState({
    date: today(), qty: '', recipient: '', purpose: '',
  })

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: fi }, { data: losses }] = await Promise.all([
      // Available stock — all non-archived finished_inventory
      supabase.from('finished_inventory')
        .select('bags_in,bags_out')
        .or('is_archived.is.null,is_archived.eq.false'),
      // Loss and protocol entries only
      supabase.from('finished_inventory')
        .select('id,transaction_date,reference_type,bags_out,notes,is_locked')
        .or('is_archived.is.null,is_archived.eq.false')
        .in('reference_type', ['loss', 'protocol'])
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false }),
    ])

    const availStock = (fi ?? []).reduce(
      (a: number, r: any) => a + (r.bags_in || 0) - (r.bags_out || 0), 0
    )
    setStock(availStock)
    setEntries(losses ?? [])

    // Fetch riders for the "reported by" dropdown
    const { data: emps } = await supabase.from('employees')
      .select('id,full_name,employee_type,team_role')
      .eq('status', 'active').order('full_name')
    setRiders((emps ?? []).filter((e: any) =>
      e.employee_type === 'rider' || e.team_role === 'rider' ||
      (e.role ?? '').toLowerCase().includes('rider') ||
      (e.role ?? '').toLowerCase().includes('sales')
    ))

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Save Destroyed ────────────────────────────────────────────────────────
  const saveDestroyed = async () => {
    const qty = parseInt(dForm.qty)
    if (!qty || qty <= 0) { alert('Enter a valid quantity.'); return }
    if (!dForm.reason.trim()) { alert('Reason is required.'); return }
    if (stock !== null && qty > stock) {
      alert(`Insufficient stock.\n\nAvailable: ${fmtNum(stock)} bags\nRequested: ${fmtNum(qty)} bags\n\nYou cannot destroy more bags than are in stock.`)
      return
    }
    if (!confirm(
      `Record ${fmtNum(qty)} destroyed bag${qty !== 1 ? 's' : ''}?\n\n` +
      `Reason: ${dForm.reason}\n` +
      `Date: ${dForm.date}\n\n` +
      `This will permanently deduct ${fmtNum(qty)} bags from available stock.`
    )) return

    setSaving(true)
    const riderName = dForm.rider_id
      ? riders.find(r => String(r.id) === dForm.rider_id)?.full_name ?? ''
      : ''
    const notesStr = dForm.rider_id
      ? `Destroyed — ${dForm.reason} | Reported by: ${riderName} [rider_id:${dForm.rider_id}]`
      : `Destroyed — ${dForm.reason}`

    const { error } = await supabase.from('finished_inventory').insert({
      transaction_date: dForm.date,
      reference_type:   'loss',
      bags_in:          0,
      bags_out:         qty,
      notes:            notesStr,
      is_locked:        false,
    })
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    setDForm({ date: today(), qty: '', reason: '', rider_id: '' })
    setSaving(false)
    load()
  }

  // ── Save Protocol ─────────────────────────────────────────────────────────
  const saveProtocol = async () => {
    const qty = parseInt(pForm.qty)
    if (!qty || qty <= 0) { alert('Enter a valid quantity.'); return }
    if (!pForm.recipient.trim()) { alert('Recipient name is required.'); return }
    if (!pForm.purpose.trim()) { alert('Purpose is required.'); return }
    if (stock !== null && qty > stock) {
      alert(`Insufficient stock.\n\nAvailable: ${fmtNum(stock)} bags\nRequested: ${fmtNum(qty)} bags\n\nYou cannot issue more protocol bags than are in stock.`)
      return
    }
    if (!confirm(
      `Issue ${fmtNum(qty)} protocol bag${qty !== 1 ? 's' : ''}?\n\n` +
      `Recipient: ${pForm.recipient}\n` +
      `Purpose: ${pForm.purpose}\n` +
      `Date: ${pForm.date}\n\n` +
      `This will deduct ${fmtNum(qty)} bags from available stock.`
    )) return

    setSaving(true)
    const { error } = await supabase.from('finished_inventory').insert({
      transaction_date: pForm.date,
      reference_type:   'protocol',
      bags_in:          0,
      bags_out:         qty,
      notes:            `Protocol — Recipient: ${pForm.recipient} | Purpose: ${pForm.purpose}`,
      is_locked:        false,
    })
    if (error) { alert('Save failed: ' + error.message); setSaving(false); return }
    setPForm({ date: today(), qty: '', recipient: '', purpose: '' })
    setSaving(false)
    load()
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteEntry = async (e: LossEntry) => {
    if (e.is_locked) { alert('This entry is locked and cannot be deleted.'); return }
    if (!confirm(
      `Delete this ${e.reference_type === 'loss' ? 'destroyed bags' : 'protocol'} entry?\n\n` +
      `${fmtNum(e.bags_out)} bags on ${fmtDate(e.transaction_date)}\n${e.notes}\n\n` +
      `The bags will be returned to available stock.`
    )) return
    const { error } = await supabase.from('finished_inventory').delete().eq('id', e.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const totalDestroyed = entries.filter(e => e.reference_type === 'loss')
    .reduce((a, e) => a + e.bags_out, 0)
  const totalProtocol  = entries.filter(e => e.reference_type === 'protocol')
    .reduce((a, e) => a + e.bags_out, 0)

  const TAB = (key: typeof tab, label: string, count?: number) => (
    <button onClick={() => setTab(key)}
      className={'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap '
        + (tab === key
          ? 'border-[#1F4E79] text-[#1F4E79]'
          : 'border-transparent text-gray-500 hover:text-gray-700')}>
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  )

  const stockColor = stock === null ? 'text-gray-400'
    : stock > 100 ? 'text-green-700'
    : stock > 0   ? 'text-amber-600'
    : 'text-red-700'

  return (
    <AppLayout>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🗑️ Losses & Protocol</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            Record destroyed bags and protocol (sample/test) bags — deducted from stock immediately
          </div>
        </div>
      </div>

      {/* ── Stock alert banner ─────────────────────────────────────────── */}
      {stock !== null && (
        <div className={
          'rounded-2xl mb-4 px-5 py-3 flex items-center justify-between gap-4 border '
          + (stock > 100 ? 'bg-green-50 border-green-300'
           : stock > 0   ? 'bg-amber-50 border-amber-400'
           : 'bg-red-50 border-red-400')
        }>
          <div className="flex items-center gap-3">
            <span className={'text-3xl font-black tabular-nums ' + stockColor}>
              {fmtNum(stock)}
            </span>
            <div>
              <div className={'text-sm font-bold ' + stockColor}>
                {stock > 100 ? '✅ Bags Available in Stock'
                 : stock > 0  ? '⚠️ Low Stock'
                 : '🚫 No Stock Available'}
              </div>
              <div className="text-xs text-gray-500">
                Available for deduction · Period totals: {fmtNum(totalDestroyed)} destroyed, {fmtNum(totalProtocol)} protocol
              </div>
            </div>
          </div>
          <div className="flex gap-3 text-xs text-gray-500">
            <div className="text-center">
              <div className="text-lg font-bold text-red-600">{fmtNum(totalDestroyed)}</div>
              <div>Destroyed</div>
            </div>
            <div className="w-px bg-gray-200" />
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-600">{fmtNum(totalProtocol)}</div>
              <div>Protocol</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 mb-4">
        {TAB('destroyed', '🗑️ Record Destroyed')}
        {TAB('protocol',  '🧪 Record Protocol')}
        {TAB('history',   '📋 History', entries.length)}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* ── DESTROYED TAB ────────────────────────────────────────── */}
          {tab === 'destroyed' && (
            <div className="card max-w-lg">
              <div className="text-sm font-semibold text-[#1F4E79] mb-4">
                🗑️ Record Destroyed Bags
              </div>
              <div className="text-xs text-gray-500 mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                Use this form for bags that are damaged, burst, contaminated, or otherwise unfit for sale.
                The quantity will be immediately deducted from available stock.
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Date *</label>
                    <input type="date" value={dForm.date}
                      onChange={e => setDForm(f => ({ ...f, date: e.target.value }))}
                      className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Number of Bags *</label>
                    <input type="number" min="1" value={dForm.qty}
                      onChange={e => setDForm(f => ({ ...f, qty: e.target.value }))}
                      className="form-input" placeholder="0"
                      max={stock ?? undefined} />
                    {stock !== null && (
                      <div className={'text-xs mt-1 ' + stockColor}>
                        Max: {fmtNum(stock)} bags available
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="form-label">Reason / Description *</label>
                  <textarea
                    value={dForm.reason}
                    onChange={e => setDForm(f => ({ ...f, reason: e.target.value }))}
                    className="form-input" rows={3}
                    placeholder="e.g. Burst during stacking, heat damage, packaging defect..." />
                </div>

                <div>
                  <label className="form-label">Reported by Rider <span className="text-gray-400 font-normal">(optional)</span></label>
                  <select value={dForm.rider_id}
                    onChange={e => setDForm(f => ({ ...f, rider_id: e.target.value }))}
                    className="form-select">
                    <option value="">— Select rider who reported damage —</option>
                    {riders.map(r => (
                      <option key={r.id} value={String(r.id)}>{r.full_name}</option>
                    ))}
                  </select>
                  <div className="text-xs text-gray-400 mt-1">
                    Link this damage report to the rider who reported it. For informational purposes only — does not affect their account.
                  </div>
                </div>

                {/* Live preview */}
                {dForm.qty && parseInt(dForm.qty) > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                    <div className="font-semibold text-red-700 mb-1">Preview</div>
                    <div className="text-red-600">
                      {fmtNum(parseInt(dForm.qty))} bags will be deducted from stock
                      {stock !== null && ` · Remaining after: ${fmtNum(stock - parseInt(dForm.qty))} bags`}
                    </div>
                  </div>
                )}

                <button onClick={saveDestroyed} disabled={saving || !dForm.qty || !dForm.reason}
                  className="btn btn-danger w-full">
                  {saving ? 'Saving...' : `🗑️ Record ${dForm.qty ? fmtNum(parseInt(dForm.qty)) : ''} Destroyed Bags`}
                </button>
              </div>
            </div>
          )}

          {/* ── PROTOCOL TAB ─────────────────────────────────────────── */}
          {tab === 'protocol' && (
            <div className="card max-w-lg">
              <div className="text-sm font-semibold text-[#1F4E79] mb-4">
                🧪 Record Protocol Bags
              </div>
              <div className="text-xs text-gray-500 mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                Use this form for bags issued for testing, quality sampling, regulatory inspection,
                or any official non-sales purpose. Recipient name is mandatory.
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Date *</label>
                    <input type="date" value={pForm.date}
                      onChange={e => setPForm(f => ({ ...f, date: e.target.value }))}
                      className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Number of Bags *</label>
                    <input type="number" min="1" value={pForm.qty}
                      onChange={e => setPForm(f => ({ ...f, qty: e.target.value }))}
                      className="form-input" placeholder="0"
                      max={stock ?? undefined} />
                    {stock !== null && (
                      <div className={'text-xs mt-1 ' + stockColor}>
                        Max: {fmtNum(stock)} bags available
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="form-label">Recipient Name *</label>
                  <input type="text" value={pForm.recipient}
                    onChange={e => setPForm(f => ({ ...f, recipient: e.target.value }))}
                    className="form-input"
                    placeholder="e.g. Ghana Standards Authority, Quality Inspector..." />
                </div>

                <div>
                  <label className="form-label">Purpose *</label>
                  <textarea
                    value={pForm.purpose}
                    onChange={e => setPForm(f => ({ ...f, purpose: e.target.value }))}
                    className="form-input" rows={3}
                    placeholder="e.g. Monthly quality test, regulatory inspection, customer sampling..." />
                </div>

                {/* Live preview */}
                {pForm.qty && parseInt(pForm.qty) > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
                    <div className="font-semibold text-yellow-700 mb-1">Preview</div>
                    <div className="text-yellow-700">
                      {fmtNum(parseInt(pForm.qty))} bags will be issued to {pForm.recipient || '(recipient)'}
                      {stock !== null && ` · Remaining after: ${fmtNum(stock - parseInt(pForm.qty))} bags`}
                    </div>
                  </div>
                )}

                <button onClick={saveProtocol}
                  disabled={saving || !pForm.qty || !pForm.recipient || !pForm.purpose}
                  className="btn btn-warning w-full">
                  {saving ? 'Saving...' : `🧪 Issue ${pForm.qty ? fmtNum(parseInt(pForm.qty)) : ''} Protocol Bags`}
                </button>
              </div>
            </div>
          )}

          {/* ── HISTORY TAB ──────────────────────────────────────────── */}
          {tab === 'history' && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="text-sm font-semibold text-[#1F4E79]">
                  📋 Losses & Protocol History
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="badge badge-gray">
                    {fmtNum(totalDestroyed)} destroyed
                  </span>
                  <span className="badge badge-yellow">
                    {fmtNum(totalProtocol)} protocol
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{ width: '95px' }} />
                    <col style={{ width: '95px' }} />
                    <col style={{ width: '80px' }} />
                    <col />
                    <col style={{ width: '130px' }} />
                    <col style={{ width: '70px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="right">Bags</th>
                      <th>Notes / Purpose</th>
                      <th>Reported By</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-400">
                          No entries yet — use the Destroyed or Protocol tabs to record.
                        </td>
                      </tr>
                    ) : entries.map(e => (
                      <tr key={e.id}>
                        <td className="muted">{fmtDate(e.transaction_date)}</td>
                        <td>
                          {e.reference_type === 'loss' ? (
                            <span className="badge badge-gray">🗑️ Destroyed</span>
                          ) : (
                            <span className="badge badge-yellow">🧪 Protocol</span>
                          )}
                        </td>
                        <td className="num font-bold text-red-600">
                          −{fmtNum(e.bags_out)}
                        </td>
                        <td className="text-sm text-gray-600 max-w-xs truncate"
                          title={e.notes.replace(/\s*\[rider_id:\d+\]/, '')}>
                          {e.notes.replace(/\s*\| Reported by: [^|[]+\[rider_id:\d+\]/, '')}
                        </td>
                        <td className="text-sm">
                          {e.reference_type === 'loss' && parseRider(e.notes) ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full font-medium">
                              🛵 {parseRider(e.notes)}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td>
                          {e.is_locked ? (
                            <span className="text-xs text-gray-400">🔒 locked</span>
                          ) : (
                            <button onClick={() => deleteEntry(e)}
                              className="btn btn-sm btn-danger">Del</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {entries.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-700">
                        <td colSpan={2} className="py-2 px-3 text-white text-xs font-semibold">
                          TOTAL DEDUCTED
                        </td>
                        <td className="py-2 px-3 text-red-300 text-xs font-bold text-right tabular-nums">
                          −{fmtNum(totalDestroyed + totalProtocol)}
                        </td>
                        <td colSpan={2} className="py-2 px-3 text-white text-xs">
                          {fmtNum(totalDestroyed)} destroyed · {fmtNum(totalProtocol)} protocol
                        </td>
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

export default function LossesPage() {
  return (
    <ModuleGuard moduleKey="losses" moduleLabel="Losses & Protocol">
      <LossesPageInner />
    </ModuleGuard>
  )
}
