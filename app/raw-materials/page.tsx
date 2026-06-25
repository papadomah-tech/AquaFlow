'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today } from '@/lib/supabase'

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
  const [matForm, setMatForm] = useState({ name: '', unit: 'kg', low_stock_threshold: '0' })
  const [purchForm, setPurchForm] = useState({ material_id: '', purchase_date: today(), supplier_name: '', quantity: '', unit_price: '', notes: '' })

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
    const payload = { label: auto_label, weight_kg: wkg, purchase_date: rollForm.purchase_date, supplier: rollForm.supplier, cost: wkg * cpk, bags_expected: Math.round(wkg * 20), bags_produced: editItem?.bags_produced ?? 0, status: editItem?.status ?? 'available' }
    if (editItem) await supabase.from('roll_films').update(payload).eq('id', editItem.id)
    else await supabase.from('roll_films').insert(payload)
    setShowForm(false); loadAll()
  }

  const markFinished = async (roll: any) => {
    if (!confirm('Mark ' + roll.label + ' as Finished?')) return
    await supabase.from('roll_films').update({ status: 'finished' }).eq('id', roll.id)
    loadAll()
  }

  const deleteRoll = async (roll: any) => {
    if (!confirm('Delete roll ' + roll.label + '?')) return
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

  const statusBadge = (s: string) => ({ available: 'badge-green', in_use: 'badge-blue', finished: 'badge-gray' }[s] ?? 'badge-gray')

  const TAB_BTN = (t: typeof tab, label: string) => (
    <button onClick={() => setTab(t)} className={'btn btn-sm ' + (tab === t ? 'btn-primary' : 'btn-secondary')}>{label}</button>
  )

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Raw Materials</h1>
        <div className="flex gap-2">
          <button onClick={() => openRoll()} className="btn btn-primary">+ Register Roll</button>
          <button onClick={() => { setFormType('purchase'); setEditItem(null); setPurchForm({material_id:'',purchase_date:today(),supplier_name:'',quantity:'',unit_price:'',notes:''}); setShowForm(true) }} className="btn btn-secondary">+ Purchase</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">{TAB_BTN('stock','Stock Overview')}{TAB_BTN('rolls','Roll Film Inventory')}{TAB_BTN('purchases','Purchase History')}</div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {/* STOCK TAB */}
          {tab === 'stock' && (
            <div className="card">
              <table className="data-table">
                <thead><tr><th>Material</th><th className="w-20">Unit</th><th className="text-right w-32">Current Stock</th><th className="text-right w-32">Low Stock Alert</th><th className="w-20">Status</th></tr></thead>
                <tbody>
                  {materials.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">No materials yet</td></tr>
                  : materials.map((m: any) => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name}</td>
                      <td className="text-gray-500">{m.unit}</td>
                      <td className="text-right font-bold tabular-nums">{fmtNum(m.current_stock)}</td>
                      <td className="text-right text-gray-500 tabular-nums">{fmtNum(m.low_stock_threshold)}</td>
                      <td><span className={'badge ' + (m.current_stock <= m.low_stock_threshold ? 'badge-red' : 'badge-green')}>{m.current_stock <= m.low_stock_threshold ? 'LOW' : 'OK'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ROLLS TAB */}
          {tab === 'rolls' && (
            <div className="card">
              <table className="data-table">
                <thead><tr><th className="w-36">Label</th><th className="w-24">Date</th><th className="w-28">Supplier</th><th className="text-right w-24">Wt (Kg)</th><th className="text-right w-24">Cost</th><th className="text-right w-24">Expected</th><th className="text-right w-24">Produced</th><th className="text-right w-24">Remaining</th><th className="text-right w-16">Util%</th><th className="w-24">Status</th><th className="w-24">Actions</th></tr></thead>
                <tbody>
                  {rolls.length === 0 ? <tr><td colSpan={11} className="text-center py-8 text-gray-400">No rolls registered</td></tr>
                  : rolls.map((r: any) => {
                    const remaining = r.bags_expected - r.bags_produced
                    const util = r.bags_expected > 0 ? (r.bags_produced / r.bags_expected * 100).toFixed(1) : '0.0'
                    return (
                      <tr key={r.id}>
                        <td className="font-mono text-xs font-medium whitespace-nowrap">{r.label}</td>
                        <td className="text-xs text-gray-500">{r.purchase_date}</td>
                        <td className="text-xs text-gray-500">{r.supplier || '-'}</td>
                        <td className="text-right tabular-nums">{r.weight_kg}</td>
                        <td className="text-right tabular-nums">{fmtGhc(r.cost)}</td>
                        <td className="text-right tabular-nums">{fmtNum(r.bags_expected)}</td>
                        <td className="text-right text-green-700 font-medium tabular-nums">{fmtNum(r.bags_produced)}</td>
                        <td className="text-right tabular-nums">{fmtNum(remaining)}</td>
                        <td className="text-right">{util}%</td>
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
          )}

          {/* PURCHASES TAB */}
          {tab === 'purchases' && (
            <div className="card">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Material</th><th>Supplier</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Total Cost</th><th>Notes</th></tr></thead>
                <tbody>
                  {purchases.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No purchases</td></tr>
                  : purchases.map((p: any) => (
                    <tr key={p.id}>
                      <td className="text-xs text-gray-500">{p.purchase_date}</td>
                      <td className="font-medium">{p.raw_materials?.name}</td>
                      <td className="text-xs text-gray-500">{p.supplier_name}</td>
                      <td className="text-right">{p.quantity} {p.raw_materials?.unit}</td>
                      <td className="text-right">{fmtGhc(p.unit_price)}</td>
                      <td className="text-right font-medium">{fmtGhc(p.total_cost)}</td>
                      <td className="text-xs text-gray-500">{p.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">
                {formType === 'roll' ? (editItem ? 'Edit Roll Film' : 'Register New Roll Film')
                 : formType === 'purchase' ? 'Record Purchase' : 'Add Material'}
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
              {formType === 'purchase' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-group col-span-2"><label className="form-label">Material *</label>
                    <select value={purchForm.material_id} onChange={e => setPurchForm(f => ({...f,material_id:e.target.value}))} className="form-select">
                      <option value="">Select...</option>
                      {materials.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                    </select></div>
                  <div className="form-group"><label className="form-label">Date</label><input type="date" value={purchForm.purchase_date} onChange={e => setPurchForm(f => ({...f,purchase_date:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Supplier *</label><input value={purchForm.supplier_name} onChange={e => setPurchForm(f => ({...f,supplier_name:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Quantity *</label><input type="number" step="0.01" value={purchForm.quantity} onChange={e => setPurchForm(f => ({...f,quantity:e.target.value}))} className="form-input" /></div>
                  <div className="form-group"><label className="form-label">Unit Price (GHc)</label><input type="number" step="0.01" value={purchForm.unit_price} onChange={e => setPurchForm(f => ({...f,unit_price:e.target.value}))} className="form-input" /></div>
                  {purchForm.quantity && purchForm.unit_price && (
                    <div className="col-span-2 bg-blue-50 rounded p-2 text-center text-sm">
                      <span className="text-gray-500">Total Cost: </span>
                      <span className="font-bold text-[#1F4E79]">{fmtGhc(parseFloat(purchForm.quantity) * parseFloat(purchForm.unit_price))}</span>
                    </div>
                  )}
                  <div className="form-group col-span-2"><label className="form-label">Notes</label><input value={purchForm.notes} onChange={e => setPurchForm(f => ({...f,notes:e.target.value}))} className="form-input" /></div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={formType === 'roll' ? saveRoll : savePurchase}
                disabled={formType === 'roll' ? !rollForm.weight_kg : !purchForm.material_id || !purchForm.quantity}
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
