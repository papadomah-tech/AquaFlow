'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, fmtDate } from '@/lib/supabase'

// ─── Constants ────────────────────────────────────────────────────────────────
const BAGS_PER_KG    = 20
const PRICE_PER_BAG  = 6

// ─── Types ────────────────────────────────────────────────────────────────────
interface Material  { id: number; name: string; unit: string; current_stock: number; low_stock_threshold: number; usage_per_bag: number }
interface Roll      { id: number; label: string; weight_kg: number; kg_remaining: number; purchase_date: string; supplier: string; cost: number; bags_expected: number; bags_produced: number; status: string }
interface Purchase  { id: number; purchase_date: string; material_id: number; supplier_name: string; quantity: number; unit_price: number; total_cost: number; notes: string; raw_materials?: { name: string; unit: string } }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const statusBadgeClass = (s: string) => ({ available: 'badge-green', in_use: 'badge-blue', finished: 'badge-gray' }[s] ?? 'badge-gray')

// ─── Empty form states ─────────────────────────────────────────────────────────
const emptyRoll     = () => ({ label: '', weight_kg: '', purchase_date: today(), supplier: '', cost_per_kg: '' })
const emptyMat      = () => ({ name: '', unit: 'kg', low_stock_threshold: '0', usage_per_bag: '0' })
const emptyPurchase = () => ({ material_id: '', material_name: '', purchase_date: today(), supplier_name: '', quantity: '', unit_price: '', notes: '' })

// ─── Component ────────────────────────────────────────────────────────────────
function RawMaterialsInner() {
  const [tab, setTab]           = useState<'stock' | 'rolls' | 'purchases'>('stock')
  const [materials, setMaterials] = useState<Material[]>([])
  const [rolls, setRolls]         = useState<Roll[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading]     = useState(true)

  // Modal state
  const [modal, setModal]     = useState<'none' | 'roll' | 'material' | 'purchase' | 'rollDetail'>('none')
  const [editItem, setEditItem] = useState<any>(null)

  // Form states
  const [rollForm,  setRollForm]  = useState(emptyRoll())
  const [matForm,   setMatForm]   = useState(emptyMat())
  const [purchForm, setPurchForm] = useState(emptyPurchase())

  // Roll detail
  const [rollDetail, setRollDetail]   = useState<Roll | null>(null)
  const [rollBatches, setRollBatches] = useState<any[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)

  const [saving, setSaving] = useState(false)

  // ── Load all data ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: m }, { data: r }, { data: p }] = await Promise.all([
      supabase.from('raw_materials').select('*').order('name'),
      supabase.from('roll_films').select('*').order('purchase_date', { ascending: false }),
      supabase.from('raw_material_purchases')
        .select('*, raw_materials(name, unit)')
        .order('purchase_date', { ascending: false })
        .limit(100),
    ])
    setMaterials(m ?? [])
    setRolls(r ?? [])
    setPurchases(p ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Roll Film stock banner (computed before render) ──────────────────────
  const rfMaterial  = materials.find(m => m.name.toLowerCase().includes('roll'))
  const rfBannerData = rfMaterial && rfMaterial.current_stock > 0 ? (() => {
    const kgOnHand  = rfMaterial.current_stock
    const expBags   = Math.floor(kgOnHand * BAGS_PER_KG)
    const expRev    = expBags * PRICE_PER_BAG
    const validRolls = rolls.filter(r => r.weight_kg > 0 && r.cost > 0)
    const avgCostPerKg = validRolls.length > 0
      ? validRolls.reduce((sum, r) => sum + (r.cost / r.weight_kg), 0) / validRolls.length
      : 0
    return { kgOnHand, expBags, expRev, totalCost: kgOnHand * avgCostPerKg }
  })() : null

  // ── Purchase projections (live, derived from form) ─────────────────────────
  const purchQty       = parseFloat(purchForm.quantity) || 0
  const purchPrice     = parseFloat(purchForm.unit_price) || 0
  const purchTotal     = purchQty * purchPrice
  const isRollFilm     = purchForm.material_name.toLowerCase().includes('roll')
  const projBags       = isRollFilm ? Math.floor(purchQty * BAGS_PER_KG) : 0
  const projRevenue    = projBags * PRICE_PER_BAG

  // ── Roll form projection ───────────────────────────────────────────────────
  const rollWkg        = parseFloat(rollForm.weight_kg) || 0
  const rollCpk        = parseFloat(rollForm.cost_per_kg) || 0
  const rollExpBags    = Math.round(rollWkg * BAGS_PER_KG)
  const rollTotalCost  = rollWkg * rollCpk

  // ── Open helpers ───────────────────────────────────────────────────────────
  const openRoll = (item?: Roll) => {
    setEditItem(item ?? null)
    setRollForm(item
      ? { label: item.label, weight_kg: String(item.weight_kg), purchase_date: item.purchase_date ?? today(), supplier: item.supplier ?? '', cost_per_kg: item.cost ? String((item.cost / item.weight_kg).toFixed(2)) : '' }
      : emptyRoll())
    setModal('roll')
  }

  const openMaterial = (item?: Material) => {
    setEditItem(item ?? null)
    setMatForm(item
      ? { name: item.name, unit: item.unit, low_stock_threshold: String(item.low_stock_threshold ?? 0), usage_per_bag: String(item.usage_per_bag ?? 0) }
      : emptyMat())
    setModal('material')
  }

  const openPurchase = () => {
    setEditItem(null)
    const rfMat = materials.find(m => m.name.toLowerCase().includes('roll'))
    setPurchForm({ ...emptyPurchase(), material_id: rfMat ? String(rfMat.id) : '', material_name: rfMat ? rfMat.name : '' })
    setModal('purchase')
  }

  const openRollDetail = async (roll: Roll) => {
    setRollDetail(roll)
    setModal('rollDetail')
    setLoadingBatches(true)
    const { data } = await supabase.from('production_batches')
      .select('batch_number, batch_date, bags_produced, notes')
      .eq('roll_film_id', roll.id)
      .order('batch_date', { ascending: true })
    setRollBatches(data ?? [])
    setLoadingBatches(false)
  }

  const closeModal = () => { setModal('none'); setEditItem(null) }

  // ── Save Roll ─────────────────────────────────────────────────────────────
  const saveRoll = async () => {
    if (!rollForm.weight_kg) { alert('Weight is required.'); return }
    setSaving(true)
    const wkg = parseFloat(rollForm.weight_kg)
    const cpk = parseFloat(rollForm.cost_per_kg) || 0
    const autoLabel = rollForm.label || ('ROLL-' + rollForm.purchase_date.replace(/-/g, '') + '-' + String(rolls.length + 1).padStart(3, '0'))

    const payload: any = {
      label: autoLabel, weight_kg: wkg, purchase_date: rollForm.purchase_date,
      supplier: rollForm.supplier, cost: wkg * cpk,
      bags_expected: Math.round(wkg * BAGS_PER_KG),
      bags_produced: editItem?.bags_produced ?? 0,
      kg_remaining:  editItem?.kg_remaining ?? wkg,
      status:        editItem?.status ?? 'available',
    }

    // Ensure Roll Film raw_material row exists for stock tracking
    let rfMat = materials.find(m => m.name.toLowerCase() === 'roll film')
    if (!rfMat) {
      const { data } = await supabase.from('raw_materials')
        .insert({ name: 'Roll Film', unit: 'Kg', current_stock: 0, low_stock_threshold: 50, usage_per_bag: 0 })
        .select().single()
      rfMat = data
    }

    if (editItem) {
      const diff = wkg - editItem.weight_kg
      if (rfMat && diff !== 0)
        await supabase.from('raw_materials').update({ current_stock: rfMat.current_stock + diff }).eq('id', rfMat.id)
      await supabase.from('roll_films').update(payload).eq('id', editItem.id)
    } else {
      const { data: active } = await supabase.from('roll_films').select('id').eq('status', 'in_use').limit(1)
      if (!active || active.length === 0) payload.status = 'in_use'
      if (rfMat) await supabase.from('raw_materials').update({ current_stock: rfMat.current_stock + wkg }).eq('id', rfMat.id)
      await supabase.from('roll_films').insert(payload)
    }
    setSaving(false); closeModal(); loadAll()
  }

  // ── Save Material ─────────────────────────────────────────────────────────
  const saveMaterial = async () => {
    if (!matForm.name) { alert('Material name is required.'); return }
    setSaving(true)
    const payload = { name: matForm.name, unit: matForm.unit, low_stock_threshold: parseFloat(matForm.low_stock_threshold) || 0, usage_per_bag: parseFloat(matForm.usage_per_bag) || 0 }
    if (editItem) await supabase.from('raw_materials').update(payload).eq('id', editItem.id)
    else await supabase.from('raw_materials').insert({ ...payload, current_stock: 0 })
    setSaving(false); closeModal(); loadAll()
  }

  // ── Save Purchase (+ auto-post to cashbook) ───────────────────────────────
  const savePurchase = async () => {
    if (!purchForm.material_id) { alert('Select a material.'); return }
    if (!purchQty) { alert('Enter quantity.'); return }
    if (!purchForm.supplier_name.trim()) { alert('Supplier is required.'); return }
    setSaving(true)

    const payload = {
      material_id:   parseInt(purchForm.material_id),
      purchase_date: purchForm.purchase_date,
      supplier_name: purchForm.supplier_name,
      quantity:      purchQty,
      unit_price:    purchPrice,
      total_cost:    purchTotal,
      notes:         purchForm.notes,
    }

    // 1. Record the purchase
    await supabase.from('raw_material_purchases').insert(payload)

    // 2. Update material stock
    const mat = materials.find(m => m.id === parseInt(purchForm.material_id))
    if (mat) await supabase.from('raw_materials').update({ current_stock: (mat.current_stock || 0) + purchQty }).eq('id', mat.id)

    // 3. Auto-post to cashbook (expenses) as Raw Materials / Purchases
    if (purchTotal > 0) {
      await supabase.from('expenses').insert({
        expense_date: purchForm.purchase_date,
        category:     'Raw Materials',
        description:  `${purchForm.material_name} purchase — ${purchQty} ${mat?.unit ?? 'units'} from ${purchForm.supplier_name}${isRollFilm ? ` (est. ${projBags.toLocaleString()} bags, rev. ${fmtGhc(projRevenue)})` : ''}`,
        amount:       purchTotal,
        paid_to:      purchForm.supplier_name,
      })
    }

    setSaving(false); closeModal(); loadAll()
  }

  // ── Roll actions ──────────────────────────────────────────────────────────
  const markFinished = async (roll: Roll) => {
    if (!confirm(`Mark ${roll.label} as Done?\n\nThis closes the roll and activates the next available roll.`)) return
    await supabase.from('roll_films').update({ status: 'finished' }).eq('id', roll.id)
    const { data: next } = await supabase.from('roll_films').select('id, label').eq('status', 'available').order('purchase_date', { ascending: true }).limit(1).single()
    if (next) await supabase.from('roll_films').update({ status: 'in_use' }).eq('id', next.id)
    loadAll()
  }

  const activateNextRoll = async () => {
    const { data: active } = await supabase.from('roll_films').select('id').eq('status', 'in_use').limit(1)
    if (active && active.length > 0) { alert('A roll is already active.'); return }
    const { data: next } = await supabase.from('roll_films').select('id, label').eq('status', 'available').order('purchase_date', { ascending: true }).limit(1).single()
    if (!next) { alert('No available rolls to activate.'); return }
    await supabase.from('roll_films').update({ status: 'in_use' }).eq('id', next.id)
    alert(`Roll ${next.label} is now active.`)
    loadAll()
  }

  const deleteRoll = async (roll: Roll) => {
    if (!confirm(`Delete roll ${roll.label}? This removes its Kg from stock.`)) return
    const rfMat = materials.find(m => m.name.toLowerCase() === 'roll film')
    if (rfMat) await supabase.from('raw_materials').update({ current_stock: Math.max(0, rfMat.current_stock - (roll.kg_remaining ?? roll.weight_kg)) }).eq('id', rfMat.id)
    await supabase.from('roll_films').delete().eq('id', roll.id)
    loadAll()
  }

  const deleteMaterial = async (m: Material) => {
    if (!confirm(`Delete ${m.name}? This cannot be undone.`)) return
    await supabase.from('raw_materials').delete().eq('id', m.id)
    loadAll()
  }

  const deletePurchase = async (id: number) => {
    if (!confirm('Delete this purchase record?')) return
    await supabase.from('raw_material_purchases').delete().eq('id', id)
    loadAll()
  }

  // ── Tab button ─────────────────────────────────────────────────────────────
  const TabBtn = ({ t, label }: { t: typeof tab; label: string }) => (
    <button onClick={() => setTab(t)} className={'btn btn-sm ' + (tab === t ? 'btn-primary' : 'btn-secondary')}>{label}</button>
  )

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {/* ── Page Header ── */}
      <div className="page-header">
        <h1 className="page-title">Raw Materials</h1>
        <div className="flex gap-2">
          <button onClick={() => openRoll()} className="btn btn-primary">+ Register Roll</button>
          <button onClick={openPurchase} className="btn btn-secondary">+ Purchase</button>
          <button onClick={() => openMaterial()} className="btn btn-secondary">+ Add Material</button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 mb-4">
        <TabBtn t="stock" label="Stock Overview" />
        <TabBtn t="rolls" label="Roll Film Inventory" />
        <TabBtn t="purchases" label="Purchase History" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* ── STOCK TAB ── */}
          {tab === 'stock' && (
            <>
            {/* Roll Film summary banner — computed before render, no IIFE */}
            {rfBannerData && (
              <div style={{background:'linear-gradient(135deg,#1F4E79 0%,#2563eb 100%)',borderRadius:'14px',padding:'16px 20px',marginBottom:'16px',color:'#fff'}}>
                <div style={{fontSize:'12px',fontWeight:600,letterSpacing:'0.08em',opacity:0.75,marginBottom:'10px',textTransform:'uppercase'}}>
                  🎞️ Roll Film — Stock Projection
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
                  {([
                    { label: 'Kg on Hand',      value: `${rfBannerData.kgOnHand.toLocaleString()} Kg`, sub: '@ 20 bags / Kg' },
                    { label: 'Expected Bags',    value: rfBannerData.expBags.toLocaleString(),           sub: 'from current stock' },
                    { label: 'Expected Revenue', value: fmtGhc(rfBannerData.expRev),                    sub: `@ GH₵${PRICE_PER_BAG} / bag` },
                    { label: 'Est. Stock Value', value: rfBannerData.totalCost > 0 ? fmtGhc(rfBannerData.totalCost) : '—', sub: 'avg cost / Kg' },
                  ] as const).map(({ label, value, sub }) => (
                    <div key={label} style={{background:'rgba(255,255,255,0.12)',borderRadius:'10px',padding:'10px 12px'}}>
                      <div style={{fontSize:'11px',opacity:0.75,marginBottom:'4px'}}>{label}</div>
                      <div style={{fontSize:'18px',fontWeight:700,lineHeight:1}}>{value}</div>
                      <div style={{fontSize:'10px',opacity:0.6,marginTop:'3px'}}>{sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card p-0 overflow-hidden">
              <table className="data-table">
                <colgroup>
                  <col /><col style={{width:'65px'}} /><col style={{width:'110px'}} />
                  <col style={{width:'115px'}} /><col style={{width:'90px'}} />
                  <col style={{width:'70px'}} /><col style={{width:'140px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Material</th><th>Unit</th><th className="right">Current Stock</th>
                    <th className="right">Low Stock Alert</th><th className="right">Usage / Bag</th>
                    <th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.length === 0
                    ? <tr><td colSpan={7} className="text-center py-8 text-gray-400 italic">No materials yet — click + Add Material</td></tr>
                    : materials.map(m => (
                      <tr key={m.id}>
                        <td className="font-medium">{m.name}</td>
                        <td className="muted">{m.unit}</td>
                        <td className="num">{fmtNum(m.current_stock)}</td>
                        <td className="num muted">{fmtNum(m.low_stock_threshold)}</td>
                        <td className="num muted">{m.usage_per_bag > 0 ? `${m.usage_per_bag} ${m.unit}/bag` : '—'}</td>
                        <td>
                          <span className={'badge ' + (m.current_stock <= m.low_stock_threshold ? 'badge-red' : 'badge-green')}>
                            {m.current_stock <= m.low_stock_threshold ? 'LOW' : 'OK'}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => openMaterial(m)} className="btn btn-sm btn-secondary">Edit</button>
                            <button onClick={() => deleteMaterial(m)} className="btn btn-sm btn-danger">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
            </>
          )}

          {/* ── ROLLS TAB ── */}
          {tab === 'rolls' && (
            <>
              {!rolls.some(r => r.status === 'in_use') && rolls.some(r => r.status === 'available') && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3 flex items-center justify-between">
                  <div className="text-sm text-orange-800">
                    ⚠️ <strong>No active roll.</strong> Production is blocked — no roll is currently in use.
                  </div>
                  <button onClick={activateNextRoll} className="btn btn-sm btn-warning ml-4 whitespace-nowrap">
                    Activate Next Roll
                  </button>
                </div>
              )}
              <div className="card p-0 overflow-hidden">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'145px'}} /><col style={{width:'80px'}} /><col style={{width:'90px'}} />
                    <col style={{width:'65px'}} /><col style={{width:'70px'}} /><col style={{width:'80px'}} />
                    <col style={{width:'72px'}} /><col style={{width:'72px'}} /><col style={{width:'72px'}} />
                    <col style={{width:'56px'}} /><col style={{width:'78px'}} /><col style={{width:'155px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Label</th><th>Date</th><th>Supplier</th>
                      <th className="right">Wt(Kg)</th><th className="right">Kg Left</th><th className="right">Cost</th>
                      <th className="right">Expected</th><th className="right">Produced</th><th className="right">Remaining</th>
                      <th className="right">Util%</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolls.length === 0
                      ? <tr><td colSpan={12} className="text-center py-8 text-gray-400 italic">No rolls registered</td></tr>
                      : rolls.map(r => {
                          const remaining = r.bags_expected - r.bags_produced
                          const util      = r.bags_expected > 0 ? (r.bags_produced / r.bags_expected * 100).toFixed(1) : '0.0'
                          const kgLeft    = r.kg_remaining ?? r.weight_kg
                          return (
                            <tr key={r.id}>
                              <td className="font-mono text-xs font-medium whitespace-nowrap">
                                <button onClick={() => openRollDetail(r)} className="text-blue-700 hover:underline text-left">{r.label}</button>
                              </td>
                              <td className="muted">{fmtDate(r.purchase_date)}</td>
                              <td className="muted">{r.supplier || '—'}</td>
                              <td className="num">{r.weight_kg}</td>
                              <td className={'num font-medium ' + (kgLeft <= 0 ? 'text-red-600' : kgLeft < r.weight_kg * 0.15 ? 'text-orange-600' : 'text-green-700')}>
                                {kgLeft.toFixed(2)}
                              </td>
                              <td className="num">{fmtGhc(r.cost)}</td>
                              <td className="num">{fmtNum(r.bags_expected)}</td>
                              <td className="num text-green-700">{fmtNum(r.bags_produced)}</td>
                              <td className="num">{fmtNum(remaining)}</td>
                              <td className="num">{util}%</td>
                              <td><span className={'badge ' + statusBadgeClass(r.status)}>{r.status}</span></td>
                              <td>
                                <div className="flex gap-1">
                                  <button onClick={() => openRoll(r)} className="btn btn-sm btn-secondary">Edit</button>
                                  {r.status !== 'finished' && (
                                    <button onClick={() => markFinished(r)} className="btn btn-sm btn-warning">Done</button>
                                  )}
                                  <button onClick={() => deleteRoll(r)} className="btn btn-sm btn-danger">Del</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── PURCHASES TAB ── */}
          {tab === 'purchases' && (
            <div className="card p-0 overflow-hidden">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col style={{width:'130px'}} /><col style={{width:'120px'}} />
                  <col style={{width:'90px'}} /><col style={{width:'95px'}} /><col style={{width:'105px'}} />
                  <col /><col style={{width:'60px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Material</th><th>Supplier</th>
                    <th className="right">Qty</th><th className="right">Unit Price</th><th className="right">Total Cost</th>
                    <th>Notes</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.length === 0
                    ? <tr><td colSpan={8} className="text-center py-8 text-gray-400 italic">No purchases recorded</td></tr>
                    : purchases.map(p => (
                      <tr key={p.id}>
                        <td className="muted text-xs">{fmtDate(p.purchase_date)}</td>
                        <td className="font-medium">{p.raw_materials?.name}</td>
                        <td className="muted text-xs">{p.supplier_name}</td>
                        <td className="num">{p.quantity} {p.raw_materials?.unit}</td>
                        <td className="num">{fmtGhc(p.unit_price)}</td>
                        <td className="num font-medium">{fmtGhc(p.total_cost)}</td>
                        <td className="muted text-xs">{p.notes || '—'}</td>
                        <td>
                          <button onClick={() => deletePurchase(p.id)} className="btn btn-sm btn-danger">Del</button>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════
          ROLL DETAIL MODAL
      ════════════════════════════════════════════════════════════════ */}
      {modal === 'rollDetail' && rollDetail && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" style={{maxWidth: '580px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-[#1F4E79] font-mono">{rollDetail.label}</h2>
                <div className="text-xs text-gray-400 mt-0.5">
                  {rollDetail.weight_kg} Kg · {rollDetail.supplier || 'No supplier'} · {fmtDate(rollDetail.purchase_date)}
                </div>
              </div>
              <button onClick={closeModal} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-3 gap-3 mb-4">
                {([
                  ['Expected', fmtNum(rollDetail.bags_expected), 'text-[#1F4E79]'],
                  ['Produced', fmtNum(rollDetail.bags_produced), rollDetail.bags_produced > rollDetail.bags_expected ? 'text-orange-600 font-bold' : 'text-green-700'],
                  ['Remaining', fmtNum(rollDetail.bags_expected - rollDetail.bags_produced), 'text-gray-700'],
                ] as const).map(([l, v, c]) => (
                  <div key={l} className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xs text-gray-400 mb-1">{l} Bags</div>
                    <div className={`text-xl font-bold tabular-nums ${c}`}>{v}</div>
                  </div>
                ))}
              </div>

              {rollDetail.bags_produced > rollDetail.bags_expected && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-xs text-orange-800">
                  ⚠️ <strong>Over-expected:</strong> This roll has produced {fmtNum(rollDetail.bags_produced - rollDetail.bags_expected)} bags more than expected.
                  {rollDetail.status !== 'finished' && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Close roll ${rollDetail.label}?\nThis marks it finished and activates the next available roll.`)) return
                        await supabase.from('roll_films').update({ status: 'finished' }).eq('id', rollDetail.id)
                        closeModal(); loadAll()
                      }}
                      className="btn btn-sm btn-warning mt-2 w-full"
                    >
                      ✅ Records are correct — Close this Roll
                    </button>
                  )}
                </div>
              )}

              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Production Batches</div>
              {loadingBatches ? (
                <div className="text-center py-6 text-gray-400 text-sm">Loading...</div>
              ) : rollBatches.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm italic">No batches recorded for this roll.</div>
              ) : (
                <table className="data-table w-full table-fixed">
                  <colgroup>
                    <col style={{width:'45%'}} /><col style={{width:'25%'}} /><col style={{width:'20%'}} /><col />
                  </colgroup>
                  <thead><tr><th>Batch</th><th>Date</th><th className="right">Bags</th><th>Notes</th></tr></thead>
                  <tbody>
                    {rollBatches.map(b => (
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
                        {fmtNum(rollBatches.reduce((a, b) => a + b.bags_produced, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          REGISTER / EDIT ROLL MODAL
      ════════════════════════════════════════════════════════════════ */}
      {modal === 'roll' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editItem ? 'Edit Roll Film' : 'Register New Roll Film'}</h2>
              <button onClick={closeModal} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group col-span-2">
                  <label className="form-label">Roll Label <span className="text-gray-400 font-normal">(auto-generated if blank)</span></label>
                  <input value={rollForm.label} onChange={e => setRollForm(f => ({...f, label: e.target.value}))}
                    className="form-input" placeholder="e.g. ROLL-20260425-001" />
                </div>
                <div className="form-group">
                  <label className="form-label">Purchase Date</label>
                  <input type="date" value={rollForm.purchase_date} onChange={e => setRollForm(f => ({...f, purchase_date: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Supplier</label>
                  <input value={rollForm.supplier} onChange={e => setRollForm(f => ({...f, supplier: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Weight (Kg) *</label>
                  <input type="number" step="0.01" value={rollForm.weight_kg}
                    onChange={e => setRollForm(f => ({...f, weight_kg: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Cost per Kg (GH₵)</label>
                  <input type="number" step="0.01" value={rollForm.cost_per_kg}
                    onChange={e => setRollForm(f => ({...f, cost_per_kg: e.target.value}))} className="form-input" />
                </div>
              </div>

              {rollWkg > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'4px'}}>Expected Bags</div>
                    <div style={{fontSize:'20px',fontWeight:700,color:'#15803d'}}>{rollExpBags.toLocaleString()}</div>
                    <div style={{fontSize:'11px',color:'#9ca3af'}}>@ 20 bags / Kg</div>
                  </div>
                  <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'4px'}}>Total Cost</div>
                    <div style={{fontSize:'20px',fontWeight:700,color:'#1d4ed8'}}>{fmtGhc(rollTotalCost)}</div>
                    <div style={{fontSize:'11px',color:'#9ca3af'}}>{rollWkg} Kg × GH₵{rollCpk}</div>
                  </div>
                  <div style={{background:'#fefce8',border:'1px solid #fde68a',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'4px'}}>Est. Revenue</div>
                    <div style={{fontSize:'20px',fontWeight:700,color:'#92400e'}}>{fmtGhc(rollExpBags * PRICE_PER_BAG)}</div>
                    <div style={{fontSize:'11px',color:'#9ca3af'}}>@ GH₵{PRICE_PER_BAG} / bag</div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={closeModal} className="btn btn-secondary">Cancel</button>
              <button onClick={saveRoll} disabled={saving || !rollForm.weight_kg} className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save Roll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          ADD / EDIT MATERIAL MODAL
      ════════════════════════════════════════════════════════════════ */}
      {modal === 'material' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editItem ? 'Edit Material' : 'Add Raw Material'}</h2>
              <button onClick={closeModal} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group col-span-2">
                  <label className="form-label">Material Name *</label>
                  <input value={matForm.name} onChange={e => setMatForm(f => ({...f, name: e.target.value}))}
                    className="form-input" placeholder="e.g. Sachet Bags, Preservative" />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit *</label>
                  <select value={matForm.unit} onChange={e => setMatForm(f => ({...f, unit: e.target.value}))} className="form-select">
                    {['kg','pieces','litres','rolls','units'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Low Stock Alert Level</label>
                  <input type="number" step="0.01" value={matForm.low_stock_threshold}
                    onChange={e => setMatForm(f => ({...f, low_stock_threshold: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group col-span-2">
                  <label className="form-label">Usage per Bag Produced</label>
                  <input type="number" step="0.0001" value={matForm.usage_per_bag}
                    onChange={e => setMatForm(f => ({...f, usage_per_bag: e.target.value}))}
                    className="form-input" placeholder="0 = not deducted per bag" />
                  <div className="text-xs text-gray-400 mt-1">
                    Set to 0 if this material is not consumed per bag produced.
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeModal} className="btn btn-secondary">Cancel</button>
              <button onClick={saveMaterial} disabled={saving || !matForm.name} className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════
          RECORD PURCHASE MODAL
      ════════════════════════════════════════════════════════════════ */}
      {modal === 'purchase' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">Record Purchase</h2>
              <button onClick={closeModal} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">

                {/* Material */}
                <div className="form-group col-span-2">
                  <label className="form-label">Material *</label>
                  <select
                    value={purchForm.material_id}
                    onChange={e => {
                      const opt  = e.target.options[e.target.selectedIndex]
                      const name = opt.text.replace(/\s*\(.*\)$/, '').trim()
                      setPurchForm(f => ({...f, material_id: e.target.value, material_name: name}))
                    }}
                    className="form-select"
                  >
                    <option value="">Select material...</option>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                  </select>
                </div>

                {/* Date & Supplier */}
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={purchForm.purchase_date}
                    onChange={e => setPurchForm(f => ({...f, purchase_date: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Supplier *</label>
                  <input value={purchForm.supplier_name}
                    onChange={e => setPurchForm(f => ({...f, supplier_name: e.target.value}))} className="form-input" />
                </div>

                {/* Quantity & Unit Price */}
                <div className="form-group">
                  <label className="form-label">Quantity *</label>
                  <input type="number" step="0.01" min="0" value={purchForm.quantity}
                    onChange={e => setPurchForm(f => ({...f, quantity: e.target.value}))} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit Price (GH₵)</label>
                  <input type="number" step="0.01" min="0" value={purchForm.unit_price}
                    onChange={e => setPurchForm(f => ({...f, unit_price: e.target.value}))} className="form-input" />
                </div>
              </div>

              {/* ── Live Projection Cards ── */}
              {purchQty > 0 && (
                <div className="mt-3 space-y-2">

                  {/* Total Cost */}
                  {purchTotal > 0 && (
                    <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'10px',padding:'12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <span style={{fontSize:'13px',color:'#374151'}}>Total Cost of Purchase</span>
                      <span style={{fontSize:'18px',fontWeight:700,color:'#1d4ed8'}}>{fmtGhc(purchTotal)}</span>
                    </div>
                  )}

                  {/* Roll Film projections */}
                  {isRollFilm && (
                    <div className="grid grid-cols-2 gap-2">
                      <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                        <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'4px'}}>Expected Bags</div>
                        <div style={{fontSize:'24px',fontWeight:700,color:'#15803d'}}>{projBags.toLocaleString()}</div>
                        <div style={{fontSize:'11px',color:'#9ca3af'}}>@ {BAGS_PER_KG} bags / Kg</div>
                      </div>
                      <div style={{background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:'10px',padding:'12px',textAlign:'center'}}>
                        <div style={{fontSize:'11px',color:'#6b7280',marginBottom:'4px'}}>Expected Revenue</div>
                        <div style={{fontSize:'24px',fontWeight:700,color:'#065f46'}}>{fmtGhc(projRevenue)}</div>
                        <div style={{fontSize:'11px',color:'#9ca3af'}}>@ GH₵{PRICE_PER_BAG} / bag</div>
                      </div>
                    </div>
                  )}

                  {/* Cashbook notice */}
                  {purchTotal > 0 && (
                    <div style={{background:'#fefce8',border:'1px solid #fde68a',borderRadius:'8px',padding:'8px 12px',fontSize:'12px',color:'#92400e'}}>
                      📒 <strong>{fmtGhc(purchTotal)}</strong> will be automatically posted to the Cashbook under <em>Raw Materials</em> on save.
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="form-group mt-3">
                <label className="form-label">Notes</label>
                <input value={purchForm.notes}
                  onChange={e => setPurchForm(f => ({...f, notes: e.target.value}))} className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeModal} className="btn btn-secondary">Cancel</button>
              <button
                onClick={savePurchase}
                disabled={saving || !purchForm.material_id || !purchQty || !purchForm.supplier_name.trim()}
                className="btn btn-primary"
              >
                {saving ? 'Saving...' : '💾 Save Purchase'}
              </button>
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
      <RawMaterialsInner />
    </ModuleGuard>
  )
}
