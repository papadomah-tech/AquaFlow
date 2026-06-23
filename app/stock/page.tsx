'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { supabase, fmtNum, fmtGhc, today } from '@/lib/supabase'

export default function StockPage() {
  const [tab, setTab] = useState<'ledger'|'stocktake'|'history'>('ledger')
  const [ledger, setLedger] = useState<any[]>([])
  const [stock, setStock] = useState(0)
  const [takes, setTakes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showTake, setShowTake] = useState(false)
  const [physical, setPhysical] = useState('')
  const [takeDate, setTakeDate] = useState(today())
  const [takeNotes, setTakeNotes] = useState('')
  const [employees, setEmployees] = useState<any[]>([])
  const [takenBy, setTakenBy] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: fi }, { data: st }] = await Promise.all([
      supabase.from('finished_inventory').select('*').order('transaction_date', { ascending: false }).limit(200),
      supabase.from('stock_takes').select('*,stock_take_items(*)').order('take_date', { ascending: false }),
    ])
    const rows = fi ?? []
    const currentStock = rows.reduce((a: number, r: any) => a + (r.bags_in || 0) - (r.bags_out || 0), 0)
    setLedger(rows); setStock(currentStock); setTakes(st ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    supabase.from('employees').select('id,full_name').eq('status','active').order('full_name').then(({ data }) => setEmployees(data ?? []))
  }, [])

  const variance = physical ? parseInt(physical) - stock : null
  const varColor = variance === null ? '' : variance < 0 ? 'text-red-600' : variance > 0 ? 'text-orange-600' : 'text-green-600'

  const saveStockTake = async () => {
    if (!physical) return
    const counted  = parseInt(physical)
    const variance = counted - stock
    if (!confirm(`Confirm stock take?\n\nSystem: ${stock.toLocaleString()} bags\nPhysical: ${counted.toLocaleString()} bags\nVariance: ${variance >= 0 ? '+' : ''}${variance.toLocaleString()} bags\n\nSystem stock will be adjusted to match physical count.`)) return

    const { data: st } = await supabase.from('stock_takes').insert({ take_date: takeDate, taken_by: takenBy ? parseInt(takenBy) : null, notes: takeNotes || `System ${stock} → Physical ${counted}`, status: 'draft' }).select().single()
    if (!st) return

    await supabase.from('stock_take_items').insert({ stock_take_id: st.id, item_type: 'finished', item_name: 'Sachet Water Bags', unit: 'bags', system_qty: stock, counted_qty: counted, variance })

    if (variance !== 0) {
      await supabase.from('finished_inventory').insert({ bags_in: Math.max(0, variance), bags_out: Math.max(0, -variance), transaction_date: takeDate, reference_type: 'adjustment', notes: `Stock Take #${st.id}: System ${stock} → Physical ${counted} (variance ${variance >= 0 ? '+' : ''}${variance})` })
    }

    setShowTake(false); setPhysical(''); setTakeNotes('')
    loadAll()
  }

  const refType = (t: string) => {
    const m: Record<string, [string, string]> = {
      production: ['badge-green', 'Production'], sale: ['badge-red', 'Sale'],
      adjustment: ['badge-blue', 'Adjustment'], protocol: ['badge-yellow', 'Protocol'],
      loss: ['badge-gray', 'Loss']
    }
    return m[t] ?? ['badge-gray', t]
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Stock</h1>
        <button onClick={() => setShowTake(true)} className="btn btn-primary">📋 Stock Take</button>
      </div>

      {/* Current stock banner */}
      <div className="card mb-4 flex items-center gap-6">
        <div>
          <div className="text-xs text-gray-500 font-medium">Current Bags in Stock</div>
          <div className="text-4xl font-bold text-[#1F4E79]">{fmtNum(stock)}</div>
          <div className="text-xs text-gray-400 mt-0.5">bags</div>
        </div>
        <div className="h-16 w-px bg-gray-200" />
        <div className="text-sm text-gray-500">
          Based on {ledger.length} ledger entries.<br/>
          Last entry: {ledger[0]?.transaction_date ?? '-'}
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {(['ledger','stocktake','history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={'btn btn-sm ' + (tab === t ? 'btn-primary' : 'btn-secondary')}>
            {t === 'ledger' ? 'Ledger' : t === 'stocktake' ? 'Stock Take History' : 'All Movements'}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {tab === 'ledger' && (
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Type</th><th className="text-right">Bags In</th><th className="text-right">Bags Out</th><th>Notes</th></tr></thead>
                  <tbody>
                    {ledger.map((r: any) => {
                      const [badge, label] = refType(r.reference_type)
                      return (
                        <tr key={r.id}>
                          <td className="text-gray-500 text-xs">{r.transaction_date}</td>
                          <td><span className={'badge ' + badge}>{label}</span></td>
                          <td className="text-right text-green-700 font-medium">{r.bags_in > 0 ? '+' + fmtNum(r.bags_in) : '-'}</td>
                          <td className="text-right text-red-600 font-medium">{r.bags_out > 0 ? '-' + fmtNum(r.bags_out) : '-'}</td>
                          <td className="text-xs text-gray-500 max-w-xs truncate">{r.notes ?? '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'stocktake' && (
            <div className="card">
              {takes.length === 0 ? <div className="text-center py-12 text-gray-400">No stock takes yet. Click "Stock Take" to start.</div> : (
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Status</th><th className="text-right">System</th><th className="text-right">Physical</th><th className="text-right">Variance</th><th>Notes</th></tr></thead>
                  <tbody>
                    {takes.map((t: any) => {
                      const item = t.stock_take_items?.[0]
                      return (
                        <tr key={t.id}>
                          <td className="text-xs text-gray-500">{t.take_date}</td>
                          <td><span className={'badge ' + (t.status === 'finalised' ? 'badge-green' : 'badge-yellow')}>{t.status}</span></td>
                          <td className="text-right">{fmtNum(item?.system_qty)}</td>
                          <td className="text-right font-medium">{fmtNum(item?.counted_qty)}</td>
                          <td className={'text-right font-medium ' + (item?.variance < 0 ? 'text-red-600' : item?.variance > 0 ? 'text-orange-600' : 'text-green-600')}>
                            {item?.variance >= 0 ? '+' : ''}{fmtNum(item?.variance)}
                          </td>
                          <td className="text-xs text-gray-500">{t.notes}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* Stock Take Modal */}
      {showTake && (
        <div className="modal-overlay" onClick={() => setShowTake(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">Physical Stock Take</h2>
              <button onClick={() => setShowTake(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-4">
              {/* System position */}
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-xs text-gray-500 mb-1">Current System Stock</div>
                <div className="text-4xl font-bold text-[#1F4E79]">{fmtNum(stock)}</div>
                <div className="text-xs text-gray-400">bags (system closing balance)</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={takeDate} onChange={e => setTakeDate(e.target.value)} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Counted By</label>
                  <select value={takenBy} onChange={e => setTakenBy(e.target.value)} className="form-select">
                    <option value="">Select...</option>
                    {employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label text-base">Physical Bags Counted *</label>
                <input type="number" value={physical} onChange={e => setPhysical(e.target.value)} autoFocus
                  className="form-input text-2xl font-bold text-center py-4" placeholder="Enter count..." />
              </div>

              {variance !== null && (
                <div className={'rounded-xl p-4 ' + (variance === 0 ? 'bg-green-50' : variance < 0 ? 'bg-red-50' : 'bg-orange-50')}>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div><div className="text-xs text-gray-500">System</div><div className="font-bold text-[#1F4E79]">{fmtNum(stock)}</div></div>
                    <div><div className="text-xs text-gray-500">Physical</div><div className="font-bold text-green-700">{fmtNum(parseInt(physical))}</div></div>
                    <div><div className="text-xs text-gray-500">Variance</div><div className={'font-bold ' + varColor}>{variance >= 0 ? '+' : ''}{fmtNum(variance)}</div></div>
                  </div>
                  <div className={'text-center text-sm font-medium mt-3 ' + varColor}>
                    {variance === 0 ? '✅ Balanced — counts match perfectly'
                     : variance < 0 ? `❌ Shortage of ${Math.abs(variance).toLocaleString()} bags`
                     : `⚠️ Surplus of ${variance.toLocaleString()} bags`}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={takeNotes} onChange={e => setTakeNotes(e.target.value)} rows={2} className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowTake(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveStockTake} disabled={!physical} className="btn btn-primary">Save & Adjust Stock</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
