'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, fmtDate} from '@/lib/supabase'

function RawMaterialsPageInner() {
  const [tab, setTab] = useState<'stock'|'rolls'|'purchases'>('stock')
  const [materials, setMaterials] = useState<any[]>([])
  const [rolls, setRolls] = useState<any[]>([])
  const [purchases, setPurchases] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<'material'|'roll'|'purchase'>('roll')
  const [editItem, setEditItem] = useState<any>(null)

  const [rollForm, setRollForm] = useState({ label: '', weight_kg: '', purchase_date: today(), supplier: '', cost_per_kg: '' })
  const [rollDetail, setRollDetail] = useState<any>(null)        // roll being inspected
  const [rollBatches, setRollBatches] = useState<any[]>([])      // production batches for that roll
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [matForm, setMatForm] = useState({ name: '', unit: 'kg', low_stock_threshold: '0', usage_per_bag: '0' })
  const [purchForm, setPurchForm] = useState({ material_id: '', material_name: '', purchase_date: today(), supplier_name: '', quantity: '', unit_price: '', notes: '' })

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: m }, { data: r }, { data: p }] = await Promise.all([
      supabase.from('raw_materials').select('*').order('name'),
      supabase.from('roll_films').select('*').order('purchase_date', { ascending: false }),
      supabase.from('raw_material_purchases').select('*,raw_materials(name,unit)').order('purchase_date', { ascending: false }).limit(100),
    ])
    setMaterials(m ?? [])
    setRolls(r ?? [])
    setPurchases(p ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const openMaterial = (item?: any) => {
    setFormType('material'); setEditItem(item ?? null)
    setMatForm(item ? {
      name: item.name, unit: item.unit,
      low_stock_threshold: String(item.low_stock_threshold ?? 0),
      usage_per_bag: String(item.usage_per_bag ?? 0),
    } : { name:'', unit:'kg', low_stock_threshold:'0', usage_per_bag:'0' })
    setShowForm(true)
  }

  const saveMaterial = async () => {
    const payload = {
      name: matForm.name, unit: matForm.unit,
      low_stock_threshold: parseFloat(matForm.low_stock_threshold) || 0,
      usage_per_bag: parseFloat(matForm.usage_per_bag) || 0,
    }
    if (editItem) await supabase.from('raw_materials').update(payload).eq('id', editItem.id)
    else await supabase.from('raw_materials').insert({ ...payload, current_stock: 0 })
    setShowForm(false); loadAll()
  }

  const deleteMaterial = async (m: any) => {
    if (!confirm('Delete material ' + m.name + '? This cannot be undone.')) return
    await supabase.from('raw_materials').delete().eq('id', m.id)
    loadAll()
  }

  const openRoll = (item?: any) => {
    setFormType('roll'); setEditItem(item ?? null)
    setRollForm(item ? { label: item.label, weight_kg: String(item.weight_kg), purchase_date: item.purchase_date ?? today(), supplier: item.supplier ?? '', cost_per_kg: item.cost ? String((item.cost / item.weight_kg).toFixed(2)) : '' }
      : { label: '', weight_kg: '', purchase_date: today(), supplier: '', cost_per_kg: '' })
    setShowForm(true)
  }

  const saveRoll = async () => {
    const wkg = parseFloat(rollForm.weight_kg) || 0
    const cpk  = parseFloat(rollForm.cost_per_kg) || 0
    const auto_label = rollForm.label || ('ROLL-' + rollForm.purchase_date.replace(/-/g,'') + '-' + String(rolls.length + 1).padStart(3,'0'))
    const payload = {
      label: auto_label, weight_kg: wkg, purchase_date: rollForm.purchase_date,
      supplier: rollForm.supplier, cost: wkg * cpk,
      bags_expected: Math.round(wkg * 20),
      bags_produced: editItem?.bags_produced ?? 0,
      kg_remaining: editItem?.kg_remaining ?? wkg,
      // New rolls go 'available' by default; only become in_use if no active roll exists
      status: editItem?.status ?? 'available',
    }

    // Find or create the "Roll Film" raw material row that tracks total Kg in stock
    let rollFilmMat = materials.find((m: any) => m.name.toLowerCase() === 'roll film')
    if (!rollFilmMat) {
      const { data: created } = await supabase.from('raw_materials')
        .insert({ name: 'Roll Film', unit: 'Kg', current_stock: 0, low_stock_threshold: 50, usage_per_bag: 0 })
        .select().single()
      rollFilmMat = created
    }

    if (editItem) {
      // Adjust stock by the DIFFERENCE in weight (in case weight was edited)
      const diff = wkg - editItem.weight_kg
      if (rollFilmMat && diff !== 0) {
        await supabase.from('raw_materials')
          .update({ current_stock: rollFilmMat.current_stock + diff }).eq('id', rollFilmMat.id)
      }
      await supabase.from('roll_films').update(payload).eq('id', editItem.id)
    } else {
      // Check if any roll is currently in_use
      const { data: activeRoll } = await supabase
        .from('roll_films').select('id').eq('status', 'in_use').limit(1)
      // If no active roll, this new roll becomes in_use immediately
      if (!activeRoll || activeRoll.length === 0) {
        payload.status = 'in_use'
      }
      // Add to Roll Film stock
      if (rollFilmMat) {
        await supabase.from('raw_materials')
          .update({ current_stock: rollFilmMat.current_stock + wkg }).eq('id', rollFilmMat.id)
      }
      await supabase.from('roll_films').insert(payload)
    }
    setShowForm(false); loadAll()
  }

  const markFinished = async (roll: any) => {
    if (!confirm(
      'Mark ' + roll.label + ' as Done (finished)?\n\n' +
      'This will close this roll and activate the next available roll for production.'
    )) return

    // 1. Mark current roll as finished
    await supabase.from('roll_films').update({ status: 'finished' }).eq('id', roll.id)

    // 2. Activate the next available roll (oldest by purchase_date)
    const { data: nextRoll } = await supabase
      .from('roll_films')
      .select('id, label')
      .eq('status', 'available')
      .order('purchase_date', { ascending: true })
      .limit(1)
      .single()

    if (nextRoll) {
      await supabase.from('roll_films')
        .update({ status: 'in_use' }).eq('id', nextRoll.id)
    }

    loadAll()
  }

  const activateNextRoll = async () => {
    // Safety check: only run if no roll is currently in_use
    const { data: active } = await supabase.from('roll_films')
      .select('id').eq('status', 'in_use').limit(1)
    if (active && active.length > 0) {
      alert('A roll is already active (in_use). No action needed.')
      return
    }
    const { data: next } = await supabase.from('roll_films')
      .select('id, label').eq('status', 'available')
      .order('purchase_date', { ascending: true }).limit(1).single()
    if (!next) { alert('No available rolls to activate.'); return }
    await supabase.from('roll_films').update({ status: 'in_use' }).eq('id', next.id)
    alert(`Roll ${next.label} is now active.`)
    loadAll()
  }

  const deleteRoll = async (roll: any) => {
    if (!confirm('Delete roll ' + roll.label + '? This will remove its Kg from Roll Film stock.')) return
    const rollFilmMat = materials.find((m: any) => m.name.toLowerCase() === 'roll film')
    if (rollFilmMat) {
      const kgToRemove = roll.kg_remaining ?? roll.weight_kg
      await supabase.from('raw_materials')
        .update({ current_stock: Math.max(0, rollFilmMat.current_stock - kgToRemove) }).eq('id', rollFilmMat.id)
    }
    await supabase.from('roll_films').delete().eq('id', roll.id)
    loadAll()
  }

  const savePurchase = async () => {
    const qty   = parseFloat(purchForm.quantity) || 0
    const price = parseFloat(purchForm.unit_price) || 0
    const payload = { material_id: parseInt(purchForm.material_id), purchase_date: purchForm.purchase_date, supplier_name: purchForm.supplier_name, quantity: qty, unit_price: price, total_cost: qty * price, notes: purchForm.notes }
    await supabase.from('raw_material_purchases').insert(payload)
    // Update current_stock
    const mat = materials.find((m: any) => m.id === parseInt(purchForm.material_id))
    if (mat) await supabase.from('raw_materials').update({ current_stock: (mat.current_stock || 0) + qty }).eq('id', mat.id)
    setShowForm(false); loadAll()
  }

  const openRollDetail = async (roll: any) => {
    setRollDetail(roll)
    setLoadingBatches(true)
    const { data } = await supabase
      .from('production_batches')
      .select('batch_number, batch_date, bags_produced, notes')
      .eq('roll_film_id', roll.id)
      .order('batch_date', { ascending: true })
    setRollBatches(data ?? [])
    setLoadingBatches(false)
  }

  const statusBadge = (s: string) => ({ available: 'badge-green', in_use: 'badge-blue', finished: 'badge-gray' }[s] ?? 'badge-gray')

  const TAB_BTN = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} className={'btn btn-sm ' + (tab === t ? 'btn-primary' : 'btn-secondary')}>{label}</button>
  )

  // Purchase form projections (computed before render)
  const purchQty        = parseFloat(purchForm.quantity) || 0
  const purchMatName    = materials.find((m: any) => m.id === parseInt(purchForm.material_id))?.name?.toLowerCase() || ''
  const isRollFilmPurch = purchMatName.includes('roll')
  const expBags         = isRollFilmPurch ? Math.floor(purchQty * 20) : 0
  const expRevenue      = expBags * 6

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Raw Materials</h1>
        <div className="flex gap-2">
          <button onClick={() => openRoll()} className="btn btn-primary">+ Register Roll</button>
          <button onClick={() => {
            setFormType('purchase'); setEditItem(null)
            // Auto-select Roll Film material if it exists
            const rfMat = materials.find((m: any) => m.name.toLowerCase().includes('roll'))
            setPurchForm({material_id: rfMat ? String(rfMat.id) : '', material_name: rfMat ? rfMat.name.toLowerCase() : '', purchase_date:today(), supplier_name:'', quantity:'', unit_price:'', notes:''})
            setShowForm(true)
          }} className="btn btn-secondary">+ Purchase</button>
          <button onClick={() => openMaterial()} className="btn btn-secondary">+ Add Material</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">{TAB_BTN('stock','Stock Overview')}{TAB_BTN('rolls','Roll Film Inventory')}{TAB_BTN('purchases','Purchase History')}</div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {/* STOCK TAB */}
          {tab === 'stock' && (
            <div className="card">
              <table className="data-table">
                <colgroup>
                <col /><col style={{width:'65px'}} />
                <col style={{width:'105px'}} /><col style={{width:'110px'}} />
                <col style={{width:'85px'}} /><col style={{width:'65px'}} />
                <col style={{width:'150px'}} />
              </colgroup>
              <thead><tr>
                <th>Material</th><th>Unit</th>
                <th className="right">Current Stock</th>
                <th className="right">Low Stock Alert</th>
                <th className="right">Usage / Bag</th>
                <th>Status</th>
                <th>Actions</th>
              </tr></thead>
                <tbody>
                  {materials.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No materials yet — click + Add Material</td></tr>
                  : materials.map((m: any) => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name}</td>
                      <td className="text-gray-500">{m.unit}</td>
                      <td className="num">{fmtNum(m.current_stock)}</td>
                      <td className="num muted">{fmtNum(m.low_stock_threshold)}</td>
                      <td className="num muted">{m.usage_per_bag > 0 ? `${m.usage_per_bag} ${m.unit}/bag` : '—'}</td>
                      <td><span className={'badge ' + (m.current_stock <= m.low_stock_threshold ? 'badge-red' : 'badge-green')}>{m.current_stock <= m.low_stock_threshold ? 'LOW' : 'OK'}</span></td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => openMaterial(m)} className="btn btn-sm btn-secondary">Edit</button>
                          <button onClick={() => deleteMaterial(m)} className="btn btn-sm btn-danger">Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ROLLS TAB */}
          {tab === 'rolls' && (
            <>
            {!rolls.some((r: any) => r.status === 'in_use') && rolls.some((r: any) => r.status === 'available') && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3 flex items-center justify-between">
                <div className="text-sm text-orange-800">
                  ⚠️ <strong>No active roll.</strong> Available rolls exist but none is active. Production is blocked.
                </div>
                <button onClick={activateNextRoll} className="btn btn-sm btn-warning ml-4 whitespace-nowrap">
                  Activate Next Roll
                </button>
              </div>
            )}
            <div className="card">
              <table className="data-table">
                <colgroup>
                <col style={{width:'145px'}} /><col style={{width:'80px'}} />
                <col style={{width:'90px'}} /><col style={{width:'65px'}} />
                <col style={{width:'70px'}} /><col style={{width:'78px'}} />
                <col style={{width:'70px'}} /><col style={{width:'70px'}} />
                <col style={{width:'72px'}} /><col style={{width:'55px'}} />
                <col style={{width:'78px'}} /><col style={{width:'150px'}} />
              </colgroup>
              <thead><tr>
                <th>Label</th><th>Date</th><th>Supplier</th>
                <th className="right">Wt(Kg)</th><th className="right">Kg Left</th><th className="right">Cost</th>
                <th className="right">Expected</th><th className="right">Produced</th>
                <th className="right">Remaining</th><th className="right">Util%</th>
                <th>Status</th><th>Actions</th>
              </tr></thead>
                <tbody>
                  {rolls.length === 0 ? <tr><td colSpan={12} className="text-center py-8 text-gray-400">No rolls registered</td></tr>
                  : rolls.map((r: any) => {
                    const remaining = r.bags_expected - r.bags_produced
                    const util = r.bags_expected > 0 ? (r.bags_produced / r.bags_expected * 100).toFixed(1) : '0.0'
                    return (
                      <tr key={r.id}>
                        <td className="font-mono text-xs font-medium whitespace-nowrap"><button onClick={() => openRollDetail(r)} className="text-blue-700 hover:underline text-left">{r.label}</button></td>
                        <td className="muted">{fmtDate(r.purchase_date)}</td>
                        <td className="muted">{r.supplier||'—'}</td>
                        <td className="num">{r.weight_kg}</td>
                        <td className={'num font-medium ' + ((r.kg_remaining ?? r.weight_kg) <= 0 ? 'text-red-600' : (r.kg_remaining ?? r.weight_kg) < r.weight_kg * 0.15 ? 'text-orange-600' : 'text-green-700')}>
                          {(r.kg_remaining ?? r.weight_kg).toFixed(2)}
                        </td>
                        <td className="num">{fmtGhc(r.cost)}</td>
                        <td className="num">{fmtNum(r.bags_expected)}</td>
                        <td className="num-green">{fmtNum(r.bags_produced)}</td>
                        <td className="num">{fmtNum(remaining)}</td>
                        <td className="num">{util}%</td>
                        <td><span className={'badge ' + statusBadge(r.status)}>{r.status}</span></td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => openRoll(r)} className="btn btn-sm btn-secondary">Edit</button>
                            {r.status !== 'finished' && <button onClick={() => markFinished(r)} className="btn btn-sm btn-warning">Done</button>}
                            <button onClick={() => deleteRoll(r)} className="btn btn-sm btn-danger">Del</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}

          {/* PURCHASES TAB */}
          {tab === 'purchases' && (
            <div className="card">
              <table className="data-table">
                <colgroup>
                <col style={{width:'90px'}} /><col style={{width:'130px'}} />
                <col style={{width:'120px'}} /><col style={{width:'90px'}} />
                <col style={{width:'95px'}} /><col style={{width:'105px'}} />
                <col /><col style={{width:'80px'}} />
              </colgroup>
                <thead><tr><th>Date</th><th>Material</th><th>Supplier</th><th className="right">Qty</th><th className="right">Unit Price</th><th className="right">Total Cost</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody>
                  {purchases.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No purchases</td></tr>
                  : purchases.map((p: any) => (
                    <tr key={p.id}>
                      <td className="text-xs text-gray-500">{fmtDate(p.purchase_date)}</td>
                      <td className="font-medium">{p.raw_materials?.name}</td>
                      <td className="text-xs text-gray-500">{p.supplier_name}</td>
                      <td className="text-right">{p.quantity} {p.raw_materials?.unit}</td>
                      <td className="text-right">{fmtGhc(p.unit_price)}</td>
                      <td className="text-right font-medium">{fmtGhc(p.total_cost)}</td>
                      <td className="muted">{p.notes || '—'}</td>
                      <td><button onClick={async()=>{if(confirm('Delete this purchase?')){{await supabase.from('raw_material_purchases').delete().eq('id',p.id);loadAll()}}}} className="btn btn-sm btn-danger">Del</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ROLL DETAIL MODAL */}
      {rollDetail && (
        <div className="modal-overlay" onClick={() => setRollDetail(null)}>
          <div className="modal-box" style={{maxWidth:'580px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-[#1F4E79] font-mono">{rollDetail.label}</h2>
                <div className="text-xs text-gray-400 mt-0.5">
                  {rollDetail.weight_kg} Kg · {rollDetail.supplier || 'No supplier'} · {fmtDate(rollDetail.purchase_date)}
                </div>
              </div>
              <button onClick={() => setRollDetail(null)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  ['Expected Bags', fmtNum(rollDetail.bags_expected), 'text-[#1F4E79]'],
                  ['Produced Bags', fmtNum(rollDetail.bags_produced), rollDetail.bags_produced > rollDetail.bags_expected ? 'text-orange-600 font-bold' : 'text-green-700'],
                  ['Remaining', fmtNum(rollDetail.bags_expected - rollDetail.bags_produced), rollDetail.bags_produced > rollDetail.bags_expected ? 'text-red-600' : 'text-gray-700'],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xs text-gray-400 mb-1">{l}</div>
                    <div className={'text-lg font-bold tabular-nums ' + c}>{v}</div>
                  </div>
                ))}
              </div>
              {rollDetail.bags_produced > rollDetail.bags_expected && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-xs text-orange-800">
                  ⚠️ <strong>Over-expected:</strong> This roll has produced {fmtNum(rollDetail.bags_produced - rollDetail.bags_expected)} bags more than expected.
                  If these production records are correct, you can close the roll below. If not, review the batches and remove any incorrectly assigned entries.
                  {rollDetail.status !== 'finished' && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Close roll ${rollDetail.label}?

This marks it as finished and allows the next available roll to become active.`)) return
                        await supabase.from('roll_films').update({ status: 'finished' }).eq('id', rollDetail.id)
                        setRollDetail(null)
                        loadAll()
                      }}
                      className="btn btn-sm btn-warning mt-2 w-full"
                    >
                      ✅ Records are correct — Close this Roll
                    </button>
                  )}
                </div>
              )}
              {/* Production batches table */}
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Production Batches</div>
              {loadingBatches ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading batches...</div>
              ) : rollBatches.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm italic">No production batches recorded for this roll.</div>
              ) : (
                <table className="data-table w-full table-fixed">
                  <colgroup>
                    <col style={{width:'45%'}} /><col style={{width:'25%'}} /><col style={{width:'20%'}} /><col style={{width:'10%'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Batch</th><th>Date</th><th className="right">Bags</th><th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollBatches.map((b: any) => (
                      <tr key={b.batch_number}>
                        <td className="font-mono text-xs">{b.batch_number}</td>
                        <td className="muted">{fmtDate(b.batch_date)}</td>
                        <td className="num font-medium">{fmtNum(b.bags_produced)}</td>
                        <td className="muted text-xs">{b.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100">
                      <td className="px-3 py-1.5 text-xs font-semibold text-gray-600" colSpan={2}>TOTAL</td>
                      <td className="px-3 py-1.5 text-xs font-bold text-right tabular-nums">
                        {fmtNum(rollBatches.reduce((a: number, b: any) => a + b.bags_produced, 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">
                {formType === 'roll' ? (editItem ? 'Edit Roll Film' : 'Register New Roll Film')
                 : formType === 'purchase' ? 'Record Purchase'
                 : (editItem ? 'Edit Material' : 'Add Raw Material')}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              {formType === 'roll' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="form-group col-span-2"><label className="form-label">Roll Label (auto-generated if blank)</label><input value={rollForm.label} onChange={e => setRollForm(f => ({...f,label:e.target.value}))} className="form-input" placeholder="e.g. ROLL-20260425-001" /></div>
                    <div className="form-group"><label className="form-label">Purchase Date</label><input type="date" value={rollForm.purchase_date} onChange={e => setRollForm(f => ({...f,purchase_date:e.target.value}))} className="form-input" /></div>
                    <div className="form-group"><label className="form-label">Supplier</label><input value={rollForm.supplier} onChange={e => setRollForm(f => ({...f,supplier:e.target.value}))} className="form-input" /></div>
                    <div className="form-group"><label className="form-label">Weight (Kg) *</label><input type="number" step="0.01" value={rollForm.weight_kg} onChange={e => setRollForm(f => ({...f,weight_kg:e.target.value}))} className="form-input" /></div>
                    <div className="form-group"><label className="form-label">Cost per Kg (GHc)</label><input type="number" step="0.01" value={rollForm.cost_per_kg} onChange={e => setRollForm(f => ({...f,cost_per_kg:e.target.value}))} className="form-input" /></div>
                  </div>
                  {rollForm.weight_kg && (
                    <div className="bg-blue-50 rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-sm">
                      <div><div className="text-xs text-gray-500">Expected Bags</div><div className="font-bold text-[#1F4E79]">{Math.round(parseFloat(rollForm.weight_kg||'0') * 20).toLocaleString()}</div></div>
                      <div><div className="text-xs text-gray-500">Total Cost</div><div className="font-bold">{fmtGhc(parseFloat(rollForm.weight_kg||'0') * parseFloat(rollForm.cost_per_kg||'0'))}</div></div>
                      <div><div className="text-xs text-gray-500">Rate</div><div className="font-bold">20 bags/Kg</div></div>
                    </div>
                  )}
                </>
              )}
              {formType === 'material' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-group col-span-2">
                    <label className="form-label">Material Name *</label>
                    <input value={matForm.name} onChange={e => setMatForm(f => ({...f,name:e.target.value}))}
                      className="form-input" placeholder="e.g. Sachet Bags, Preservative" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit *</label>
                    <select value={matForm.unit} onChange={e => setMatForm(f => ({...f,unit:e.target.value}))}
                      className="form-select">
                      <option value="kg">Kg</option>
                      <option value="pieces">Pieces</option>
                      <option value="litres">Litres</option>
                      <option value="rolls">Rolls</option>
                      <option value="units">Units</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Low Stock Alert Level</label>
                    <input type="number" step="0.01" value={matForm.low_stock_threshold}
                      onChange={e => setMatForm(f => ({...f,low_stock_threshold:e.target.value}))}
                      className="form-input" />
                  </div>
                  <div className="form-group col-span-2">
                    <label className="form-label">Usage per Bag Produced</label>
                    <input type="number" step="0.0001" value={matForm.usage_per_bag}
                      onChange={e => setMatForm(f => ({...f,usage_per_bag:e.target.value}))}
                      className="form-input" placeholder="e.g. 1 (one sachet bag per bag of water)" />
                    <div className="text-xs text-gray-400 mt-1">
                      This material will be automatically deducted from stock every time a production batch is recorded.
                      Set to 0 if this material is not consumed per bag (e.g. purchased in bulk for other uses).
                    </div>
                  </div>
                </div>
              )}
              {formType === 'purchase' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-group col-span-2"><label className="form-label">Material *</label>
                    <select value={purchForm.material_id}
                      onChange={e => {
                        const selText = e.target.options[e.target.selectedIndex].text.toLowerCase()
                        setPurchForm(f => ({...f, material_id: e.target.value, material_name: selText}))
                      }}
                      className="form-select">
                      <option value="">Select...</option>
                      {materials.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">Date</label><input type="date" value={purchForm.purchase_date} onChange={e => setPurchForm(f => ({...f,purchase_date:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Supplier *</label><input value={purchForm.supplier_name} onChange={e => setPurchForm(f => ({...f,supplier_name:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Quantity *</label><input type="number" step="0.01" value={purchForm.quantity} onChange={e => setPurchForm(f => ({...f,quantity:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Unit Price (GHc)</label><input type="number" step="0.01" value={purchForm.unit_price} onChange={e => setPurchForm(f => ({...f,unit_price:e.target.value}))} className="form-input" /></div>
                  {(() => {
                    const qty     = parseFloat(purchForm.quantity) || 0
                    const price   = parseFloat(purchForm.unit_price) || 0
                    const matName = (purchForm as any).material_name || ''
                    const isRoll  = matName.includes('roll')
                    const bags    = isRoll ? Math.floor(qty * 20) : 0
                    const rev     = bags * 6
                    if (!qty) return null
                    return (
                      <div className="col-span-2 space-y-2">
                        {price > 0 && (
                          <div className="bg-blue-50 rounded p-2 text-center text-sm">
                            <span className="text-gray-500">Total Cost: </span>
                            <span className="font-bold text-[#1F4E79]">{fmtGhc(qty * price)}</span>
                          </div>
                        )}
                        {isRoll && bags > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                              <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'2px'}}>Expected Bags</div>
                              <div style={{fontSize:'20px',fontWeight:700,color:'#15803d'}}>{bags.toLocaleString()}</div>
                              <div style={{fontSize:'11px',color:'#9ca3af'}}>@ 20 bags / Kg</div>
                            </div>
                            <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                              <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'2px'}}>Expected Revenue</div>
                              <div style={{fontSize:'20px',fontWeight:700,color:'#065f46'}}>{fmtGhc(rev)}</div>
                              <div style={{fontSize:'11px',color:'#9ca3af'}}>@ GH₵6 / bag</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <div className="form-group col-span-2"><label className="form-label">Notes</label><input value={purchForm.notes} onChange={e => setPurchForm(f => ({...f,notes:e.target.value}))} className="form-input" /></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={formType === 'roll' ? saveRoll : formType === 'material' ? saveMaterial : savePurchase}
                disabled={formType === 'roll' ? !rollForm.weight_kg
                  : formType === 'material' ? !matForm.name
                  : !purchForm.material_id || !purchForm.quantity}
                className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function RawMaterialsPage() {
  return (
    <ModuleGuard moduleKey="raw-materials" moduleLabel="Raw Materials">
      <RawMaterialsPageInner />
    </ModuleGuard>
  )
}
