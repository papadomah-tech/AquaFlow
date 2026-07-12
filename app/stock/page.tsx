'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtNum, today, fmtDate} from '@/lib/supabase'

function StockPageInner() {
  const [tab, setTab]         = useState<'ledger'|'stocktake'>('ledger')
  const [ledger, setLedger]   = useState<any[]>([])
  const [stock, setStock]     = useState(0)
  const [takes, setTakes]     = useState<any[]>([])
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
      supabase.from('finished_inventory')
        .select('*').or('is_archived.is.null,is_archived.eq.false')
        // Exclude entries where reference_type='sale' AND notes contains 'Retail sale'
        // (rider retail was written with reference_type='sale', factory retail won't be written going forward)
        // Historical rider retail entries are cleaned up via SQL migration
        .order('transaction_date', { ascending: false }).order('id', { ascending: false }).limit(200),
      supabase.from('stock_takes')
        .select('*,stock_take_items(*)').order('take_date', { ascending: false }),
    ])
    const allRows = fi ?? []
    // Compute running balance from oldest to newest, then reverse for display
    const sorted = [...allRows].sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) return a.transaction_date < b.transaction_date ? -1 : 1
      // On same date: production (bags_in) before sales (bags_out) for correct running balance
      if ((b.bags_in||0) !== (a.bags_in||0)) return (b.bags_in||0) - (a.bags_in||0)
      return a.id - b.id
    })
    let running = 0
    const withBalance = sorted.map(r => {
      running += (r.bags_in||0) - (r.bags_out||0)
      return { ...r, _balance: running }
    })
    // Reverse for display (newest first)
    const rows = withBalance.reverse()
    setLedger(rows)
    setStock(running)
    setTakes(st ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    supabase.from('employees').select('id,full_name')
      .eq('status','active').order('full_name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [])

  const variance = physical !== '' ? parseInt(physical||'0') - stock : null
  const varColor = variance === null ? 'text-gray-500'
    : variance < 0 ? 'text-red-600'
    : variance > 0 ? 'text-green-600'
    : 'text-green-600'

  const saveStockTake = async () => {
    if (!physical) return
    const counted  = parseInt(physical)
    const diff     = counted - stock   // positive = surplus, negative = shortage

    // Build confirmation message based on variance direction
    let confirmMsg = `Confirm stock take?\n\n`
      + `System stock:    ${stock.toLocaleString()} bags\n`
      + `Physical count:  ${counted.toLocaleString()} bags\n`
      + `Variance:        ${diff >= 0 ? '+' : ''}${diff.toLocaleString()} bags\n\n`

    if (diff === 0) {
      confirmMsg += `✅ Stock is fully reconciled. No adjustment needed.`
    } else if (diff > 0) {
      confirmMsg += `📦 Surplus detected: ${diff} more bags physically present than system records.\n`
        + `Action: System stock will be increased by ${diff} bags.\n`
        + `An adjustment entry (reference: "adjustment") will be posted to the stock ledger.\n`
        + `No financial entry will be made.`
    } else {
      confirmMsg += `⚠️ Shortage detected: ${Math.abs(diff)} fewer bags than system records.\n`
        + `Action: System stock will be reduced by ${Math.abs(diff)} bags.\n`
        + `An adjustment entry will be posted to the stock ledger.\n`
        + `No financial entry will be made.`
    }

    if (!confirm(confirmMsg)) return

    const { data: st } = await supabase.from('stock_takes').insert({
      take_date: takeDate,
      taken_by:  takenBy ? parseInt(takenBy) : null,
      notes:     takeNotes || `System ${stock} → Physical ${counted} (${diff >= 0 ? '+' : ''}${diff} bags)`,
      status:    'finalised',
    }).select().single()
    if (!st) return

    await supabase.from('stock_take_items').insert({
      stock_take_id: st.id, item_type: 'finished',
      item_name: 'Sachet Water Bags', unit: 'bags',
      system_qty: stock, counted_qty: counted, variance: diff,
    })

    // Post adjustment to finished_inventory regardless of direction
    // surplus (diff > 0) → bags_in; shortage (diff < 0) → bags_out
    if (diff !== 0) {
      const adjNotes = diff > 0
        ? `Stock Take #${st.id}: Surplus +${diff} bags — physical (${counted}) > system (${stock}). Adjusted upward.`
        : `Stock Take #${st.id}: Shortage ${diff} bags — physical (${counted}) < system (${stock}). Adjusted downward.`

      await supabase.from('finished_inventory').insert({
        bags_in:          diff > 0 ? diff : 0,
        bags_out:         diff < 0 ? Math.abs(diff) : 0,
        transaction_date: takeDate,
        reference_type:   'adjustment',
        notes:            adjNotes,
      })
    }

    setShowTake(false); setPhysical(''); setTakeNotes(''); setTakenBy('')
    loadAll()
  }

  // ── Edit / Delete ledger entries ────────────────────────────────────────────
  const [editEntry, setEditEntry] = useState<any>(null)
  const [editForm, setEditForm]   = useState({
    transaction_date: '', bags_in: '', bags_out: '',
    reference_type: 'adjustment', notes: ''
  })

  const openEdit = (r: any) => {
    if (r.is_locked) { alert('🔒 This entry is locked — it belongs to a reconciled period and cannot be edited.'); return }
    setEditEntry(r)
    setEditForm({
      transaction_date: r.transaction_date,
      bags_in:          String(r.bags_in  || 0),
      bags_out:         String(r.bags_out || 0),
      reference_type:   r.reference_type || 'adjustment',
      notes:            r.notes || '',
    })
  }

  const saveEdit = async () => {
    if (!editEntry) return
    await supabase.from('finished_inventory').update({
      transaction_date: editForm.transaction_date,
      bags_in:          parseInt(editForm.bags_in)  || 0,
      bags_out:         parseInt(editForm.bags_out) || 0,
      reference_type:   editForm.reference_type,
      notes:            editForm.notes || null,
    }).eq('id', editEntry.id)
    setEditEntry(null)
    loadAll()
  }

  const deleteEntry = async (r: any) => {
    if (r.is_locked) { alert('🔒 This entry is locked — it belongs to a reconciled period and cannot be deleted.'); return }
    if (!confirm(
      `Delete this stock entry?\n\n` +
      `Date: ${fmtDate(r.transaction_date)}\n` +
      `Type: ${r.reference_type}\n` +
      `Bags In: ${r.bags_in || 0}  |  Bags Out: ${r.bags_out || 0}\n` +
      `Notes: ${r.notes || '—'}\n\n` +
      `This will adjust the stock balance.`
    )) return
    await supabase.from('finished_inventory').delete().eq('id', r.id)
    loadAll()
  }

  const deleteTake = async (t: any) => {
    if (!confirm(
      `Delete this stock take?\n\n` +
      `Date: ${fmtDate(t.take_date)}\n` +
      `Status: ${t.status}\n` +
      `Physical count: ${t.stock_take_items?.[0]?.counted_qty ?? '—'} bags\n\n` +
      `Note: any adjustment entry made when this was finalised will NOT be automatically reversed.`
    )) return
    await supabase.from('stock_takes').delete().eq('id', t.id)
    loadAll()
  }

  const BADGE: Record<string,[string,string]> = {
    production: ['badge-green',  'Production'],
    sale:       ['badge-red',    'Sale'      ],
    adjustment: ['badge-blue',   'Adjustment'],
    protocol:   ['badge-yellow', 'Protocol'  ],
    loss:       ['badge-gray',   'Loss'      ],
  }

  // ── Running balance for ledger — pre-computed in load() with correct ordering ──
  // Production entries sort before sales on the same date
  const withBalance = ledger.map(r => ({ ...r, balance: r._balance ?? 0 }))

  return (
    <AppLayout>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="page-header">
        <h1 className="page-title">📦 Stock</h1>
        <button onClick={() => setShowTake(true)} className="btn btn-primary">
          📋 Stock Take
        </button>
      </div>

      {/* ── Summary card ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="stat-card col-span-2 md:col-span-1" style={{ borderLeftColor: '#1F4E79' }}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
            Current Stock
          </div>
          <div className="text-3xl font-bold text-[#1F4E79] mt-1">{fmtNum(stock)}</div>
          <div className="text-xs text-gray-400 mt-0.5">bags on hand</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#1B5E20' }}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
            Total IN
          </div>
          <div className="text-xl font-bold text-green-700 mt-1">
            +{fmtNum(ledger.reduce((a,r) => a + (r.bags_in||0), 0))}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">bags produced</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#C00000' }}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
            Total OUT
          </div>
          <div className="text-xl font-bold text-red-600 mt-1">
            -{fmtNum(ledger.reduce((a,r) => a + (r.bags_out||0), 0))}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">bags dispatched</div>
        </div>
        <div className="stat-card" style={{ borderLeftColor: '#2E75B6' }}>
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">
            Ledger Entries
          </div>
          <div className="text-xl font-bold text-[#2E75B6] mt-1">{ledger.length}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            Last: {ledger[0]?.transaction_date ?? '—'}
          </div>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200 mb-4">
        {([
          ['ledger',    '📒 Ledger'            ],
          ['stocktake', '📋 Stock Take History' ],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${tab === key
                ? 'border-[#1F4E79] text-[#1F4E79]'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* LEDGER TAB */}
          {tab === 'ledger' && (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-28">Date</th>
                      <th className="w-32">Type</th>
                      <th className="text-right w-28">Bags In</th>
                      <th className="text-right w-28">Bags Out</th>
                      <th className="text-right w-28">Balance</th>
                      <th>Notes</th>
                      <th className="w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withBalance.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-gray-400">
                          No stock movements yet. Record a production batch to get started.
                        </td>
                      </tr>
                    ) : withBalance.map((r: any) => {
                      const [badge, label] = BADGE[r.reference_type] ?? ['badge-gray', r.reference_type || '—']
                      return (
                        <tr key={r.id}>
                          <td className="text-gray-500 text-xs whitespace-nowrap">
                            {fmtDate(r.transaction_date)}
                          </td>
                          <td>
                            <span className={'badge ' + badge}>{label}</span>
                          </td>
                          <td className="text-right font-medium text-green-700 tabular-nums">
                            {r.bags_in > 0 ? '+' + fmtNum(r.bags_in) : '—'}
                          </td>
                          <td className="text-right font-medium text-red-600 tabular-nums">
                            {r.bags_out > 0 ? '−' + fmtNum(r.bags_out) : '—'}
                          </td>
                          <td className="text-right font-bold text-[#1F4E79] tabular-nums">
                            {fmtNum(r.balance)}
                          </td>
                          <td className="text-xs text-gray-500 max-w-xs truncate">
                            {r.notes ?? '—'}
                          </td>
                          <td>
                            {r.is_locked
                              ? <span title="Locked — reconciled period" style={{fontSize:'18px',cursor:'default',display:'block',textAlign:'center'}}>🔒</span>
                              : <div className="flex gap-1">
                                  <button onClick={() => openEdit(r)} className="btn btn-sm btn-secondary">Edit</button>
                                  <button onClick={() => deleteEntry(r)} className="btn btn-sm btn-danger">Del</button>
                                </div>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {/* Footer total row */}
                  {withBalance.length > 0 && (
                    <tfoot>
                      <tr className="bg-[#1F4E79]">
                        <td colSpan={4} className="py-2.5 px-3 text-white text-xs font-semibold uppercase tracking-wide">
                          Closing Balance
                        </td>
                        <td className="text-right py-2.5 px-3 font-bold text-white tabular-nums text-sm">
                          {fmtNum(stock)} bags
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* STOCK TAKE HISTORY TAB */}
          {tab === 'stocktake' && (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th className="w-28">Date</th>
                      <th className="w-24">Status</th>
                      <th className="text-right w-28">System Qty</th>
                      <th className="text-right w-28">Physical Count</th>
                      <th className="text-right w-28">Variance</th>
                      <th>Notes</th>
                      <th className="w-16">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {takes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-12 text-gray-400">
                          No stock takes yet. Click "📋 Stock Take" to begin.
                        </td>
                      </tr>
                    ) : takes.map((t: any, i: number) => {
                      const item = t.stock_take_items?.[0]
                      const v    = item?.variance ?? 0
                      return (
                        <tr key={t.id}>
                          <td className="text-gray-400 text-xs">{takes.length - i}</td>
                          <td className="text-xs text-gray-500 whitespace-nowrap">{fmtDate(t.take_date)}</td>
                          <td>
                            <span className={'badge ' + (t.status === 'finalised' ? 'badge-green' : 'badge-yellow')}>
                              {t.status}
                            </span>
                          </td>
                          <td className="text-right tabular-nums">{fmtNum(item?.system_qty)}</td>
                          <td className="text-right font-medium tabular-nums">{fmtNum(item?.counted_qty)}</td>
                          <td className={`text-right font-bold tabular-nums ${v < 0 ? 'text-red-600' : v > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            {v >= 0 ? '+' : ''}{fmtNum(v)}
                          </td>
                          <td className="text-xs text-gray-500 max-w-xs truncate">{t.notes ?? '—'}</td>
                          <td>
                            <button onClick={() => deleteTake(t)}
                              className="btn btn-sm btn-danger">Del</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── STOCK TAKE MODAL ──────────────────────────────────────────────── */}
      {showTake && (
        <div className="modal-overlay" onClick={() => setShowTake(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">📋 Physical Stock Take</h2>
              <button onClick={() => setShowTake(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-4">

              {/* System stock banner */}
              <div className="bg-[#DEEAF1] rounded-xl p-4 flex items-center gap-4">
                <div>
                  <div className="text-xs text-gray-500 font-medium">System Stock</div>
                  <div className="text-3xl font-bold text-[#1F4E79]">{fmtNum(stock)}</div>
                  <div className="text-xs text-gray-400">bags (current system balance)</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={takeDate}
                    onChange={e => setTakeDate(e.target.value)}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Counted By</label>
                  <select value={takenBy}
                    onChange={e => setTakenBy(e.target.value)}
                    className="form-select">
                    <option value="">Select employee...</option>
                    {employees.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label text-base font-bold">
                  Physical Bags Counted *
                </label>
                <input type="number" value={physical}
                  onChange={e => setPhysical(e.target.value)}
                  autoFocus min="0"
                  className="form-input text-2xl font-bold text-center py-4"
                  placeholder="0" />
              </div>

              {variance !== null && (
                <div className={`rounded-xl p-4 border-2 ${
                  variance === 0 ? 'bg-green-50 border-green-300'
                  : variance < 0 ? 'bg-red-50 border-red-300'
                  : 'bg-orange-50 border-orange-300'}`}>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">System</div>
                      <div className="font-bold text-[#1F4E79]">{fmtNum(stock)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Physical</div>
                      <div className="font-bold text-green-700">{fmtNum(parseInt(physical||'0'))}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Variance</div>
                      <div className={'font-bold ' + varColor}>
                        {variance >= 0 ? '+' : ''}{fmtNum(variance)}
                      </div>
                    </div>
                  </div>
                  <div className={'text-center text-sm font-semibold mt-3 ' + varColor}>
                    {variance === 0 ? '✅ Balanced — counts match perfectly'
                     : variance < 0 ? `❌ Shortage of ${Math.abs(variance).toLocaleString()} bags`
                     : `⚠️ Surplus of ${variance.toLocaleString()} bags`}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={takeNotes} rows={2}
                  onChange={e => setTakeNotes(e.target.value)}
                  className="form-input" placeholder="Optional remarks..." />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowTake(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button onClick={saveStockTake} disabled={!physical}
                className="btn btn-primary">
                💾 Save & Adjust Stock
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── EDIT LEDGER ENTRY MODAL ────────────────────────────────────── */}
      {editEntry && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setEditEntry(null)} />
          <div style={{position:'fixed',top:'50%',left:'50%',
            transform:'translate(-50%,-50%)',width:'min(460px,94vw)',
            background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',zIndex:9999,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div className="font-bold text-[#1F4E79]">✏️ Edit Stock Entry</div>
              <button onClick={() => setEditEntry(null)}
                style={{background:'none',border:'none',fontSize:'1.25rem',
                  color:'#aaa',cursor:'pointer'}}>✕</button>
            </div>
            <div style={{padding:'1.25rem',display:'grid',
              gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
              <div className="form-group col-span-2" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Date</label>
                <input type="date" value={editForm.transaction_date}
                  onChange={e => setEditForm(f => ({...f,transaction_date:e.target.value}))}
                  className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Bags In</label>
                <input type="number" value={editForm.bags_in}
                  onChange={e => setEditForm(f => ({...f,bags_in:e.target.value}))}
                  className="form-input" placeholder="0" />
              </div>
              <div className="form-group">
                <label className="form-label">Bags Out</label>
                <input type="number" value={editForm.bags_out}
                  onChange={e => setEditForm(f => ({...f,bags_out:e.target.value}))}
                  className="form-input" placeholder="0" />
              </div>
              <div className="form-group col-span-2" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Type</label>
                <select value={editForm.reference_type}
                  onChange={e => setEditForm(f => ({...f,reference_type:e.target.value}))}
                  className="form-select">
                  <option value="production">Production</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="sale">Sale</option>
                  <option value="factory_retail">Factory Retail</option>
                  <option value="write-off">Write-off</option>
                  <option value="protocol">Protocol</option>
                  <option value="loss">Loss</option>
                </select>
              </div>
              <div className="form-group col-span-2" style={{gridColumn:'1/-1'}}>
                <label className="form-label">Notes</label>
                <textarea value={editForm.notes} rows={2}
                  onChange={e => setEditForm(f => ({...f,notes:e.target.value}))}
                  className="form-input" />
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',
              padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setEditEntry(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveEdit} className="btn btn-primary">💾 Save Changes</button>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

export default function StockPage() {
  return (
    <ModuleGuard moduleKey="stock" moduleLabel="Stock">
      <StockPageInner />
    </ModuleGuard>
  )
}
