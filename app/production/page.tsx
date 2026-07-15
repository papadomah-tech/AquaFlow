'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { offlineSave } from '@/lib/offlineSave'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useRole } from '@/hooks/useRole'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart, fmtDate} from '@/lib/supabase'

const OP_FEE = 30
const BAGS_PER_KG = 25   // standard rate: 1 Kg roll film → 25 bags

function ProductionPageInner() {
  const { userId } = useRole()
  const [batches, setBatches]   = useState<any[]>([])
  const [rolls, setRolls]       = useState<any[]>([])
  const [materials, setMaterials] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editBatch, setEditBatch] = useState<any>(null)
  const [filter, setFilter]     = useState({ from: monthStart(), to: today() })
  const [form, setForm] = useState({
    batch_date: today(), roll_film_id: '', bags_produced: '', notes: ''
  })
  const [saving, setSaving]       = useState(false)
  const [warnings, setWarnings]   = useState<string[]>([])
  const [payingFee, setPayingFee] = useState<string|null>(null)
  const [paidFees, setPaidFees]   = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: opFeeExps }] = await Promise.all([
      supabase.from('production_batches')
        .select('*,roll_films(id,label,status,bags_expected,bags_produced,weight_kg,kg_remaining)')
        .or('is_archived.is.null,is_archived.eq.false')
        .gte('batch_date', filter.from).lte('batch_date', filter.to)
        .order('batch_date', { ascending: false }),
      supabase.from('expenses')
        .select('description')
        .eq('category', 'Operator Fee'),
    ])
    setBatches(data ?? [])
    // Build set of batch numbers that have had operator fee paid
    const paid = new Set<string>()
    ;(opFeeExps ?? []).forEach((e: any) => {
      const desc = e.description ?? ''
      const start = desc.indexOf('BATCH-')
      if (start >= 0) {
        const end = desc.indexOf(' ', start)
        paid.add(end > 0 ? desc.slice(start, end) : desc.slice(start))
      }
    })
    setPaidFees(paid)
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    // Load the active roll; if none in_use, auto-activate the oldest available one
    ;(async () => {
      let { data: inUse } = await supabase.from('roll_films').select('*')
        .eq('status', 'in_use').order('purchase_date', { ascending: true })

      if (!inUse || inUse.length === 0) {
        // No active roll — promote the oldest available one
        const { data: nextAvail } = await supabase.from('roll_films').select('*')
          .eq('status', 'available').order('purchase_date', { ascending: true }).limit(1)
        if (nextAvail && nextAvail.length > 0) {
          await supabase.from('roll_films').update({ status: 'in_use' }).eq('id', nextAvail[0].id)
          inUse = nextAvail.map((r: any) => ({ ...r, status: 'in_use' }))
        }
      } else if (inUse.length > 1) {
        // Data integrity issue: multiple rolls in_use — surface it, pick the oldest only
        console.warn(`[AquaFlow] ${inUse.length} rolls are marked in_use simultaneously. Only the oldest will be used for production. Please audit Roll Film inventory.`)
        inUse = [inUse[0]]  // oldest by purchase_date — already sorted asc
      }

      setRolls(inUse ?? [])
      if (inUse && inUse.length === 1) {
        setForm(f => ({ ...f, roll_film_id: String(inUse![0].id) }))
      }
    })()
    supabase.from('raw_materials').select('*')
      .gt('usage_per_bag', 0).order('name')
      .then(({data}) => setMaterials(data ?? []))
  }, [])

  const bags = parseInt(form.bags_produced) || 0
  const selectedRoll = rolls.find((r:any) => r.id === parseInt(form.roll_film_id))
  const kgNeeded = bags / BAGS_PER_KG
  const kgAvailable = selectedRoll ? (selectedRoll.kg_remaining ?? selectedRoll.weight_kg) : 0

  // Live preview of material consumption for this batch
  const materialPreview = materials.map((m:any) => ({
    ...m,
    needed: bags * m.usage_per_bag,
    afterStock: m.current_stock - (bags * m.usage_per_bag),
    willGoNegative: (m.current_stock - (bags * m.usage_per_bag)) < 0,
  }))

  const saveBatch = async () => {
    if (!form.roll_film_id) { alert('You must select a Roll Film before saving a production batch.'); return }
    if (bags <= 0) { alert('Enter the number of bags produced.'); return }

    // Roll film production cap: cumulative total must not exceed 115% of expected
    const checkRoll = rolls.find((r: any) => r.id === parseInt(form.roll_film_id))
    if (checkRoll) {
      const prevBags  = editBatch
        ? (checkRoll.bags_produced - editBatch.bags_produced)
        : (checkRoll.bags_produced || 0)
      const newTotal  = prevBags + bags
      const hardCap   = Math.floor(checkRoll.bags_expected * 1.15)   // 115% — hard block
      const softWarn  = checkRoll.bags_expected                       // 100% — soft warning

      if (newTotal > hardCap) {
        // HARD BLOCK — refuse save
        alert(
          `🚫 Production Limit Reached\n\n` +
          `Roll ${checkRoll.label} cannot exceed 115% of its expected yield.\n\n` +
          `Expected:    ${checkRoll.bags_expected} bags\n` +
          `Hard cap:    ${hardCap} bags (115%)\n` +
          `Current:     ${prevBags} bags produced\n` +
          `This batch:  ${bags} bags\n` +
          `New total:   ${newTotal} bags — exceeds cap by ${newTotal - hardCap}\n\n` +
          `Close this roll first (click "Done" in Raw Materials → Roll Film), ` +
          `then the next available roll will become active.`
        )
        return   // hard stop — do not save
      }

      if (newTotal > softWarn) {
        // SOFT WARNING — allow user to confirm between 100%–115%
        const over    = newTotal - checkRoll.bags_expected
        const pct     = ((newTotal / checkRoll.bags_expected) * 100).toFixed(1)
        const capLeft = hardCap - newTotal
        const proceed = confirm(
          `⚠️ Over-Expected Warning (${pct}% of expected)\n\n` +
          `Roll ${checkRoll.label} expected yield: ${checkRoll.bags_expected} bags.\n` +
          `With this batch, total will be ${newTotal} bags (+${over} over expected).\n` +
          `Hard cap remaining: ${capLeft} more bags before this roll is locked.\n\n` +
          `Are you sure these batches are correctly assigned to this roll?\n\n` +
          `• OK — save and continue using this roll.\n` +
          `• Cancel — go back and review.`
        )
        if (!proceed) return
      }
    }

    setSaving(true)
    const newWarnings: string[] = []

    const roll = rolls.find((r: any) => r.id === parseInt(form.roll_film_id))
    const batchNum = editBatch?.batch_number
      ?? ('BATCH-' + form.batch_date.replace(/-/g,'') + '-' + String(Math.floor(Math.random()*900+100)))

    const kgUsed = bags / BAGS_PER_KG

    const payload = {
      batch_date: form.batch_date, batch_number: batchNum,
      roll_film_id: parseInt(form.roll_film_id), roll_ref: roll?.label ?? '',
      bags_produced: bags, bags_consumed: bags,
      roll_kg_used: kgUsed, notes: form.notes,
    }

    if (editBatch) {
      // Reverse previous deductions first
      const prevRoll = rolls.find((r:any) => r.id === editBatch.roll_film_id) ?? editBatch.roll_films
      if (prevRoll) {
        await supabase.from('roll_films').update({
          bags_produced: Math.max(0, (prevRoll.bags_produced||0) - editBatch.bags_produced),
          kg_remaining: (prevRoll.kg_remaining ?? prevRoll.weight_kg) + (editBatch.roll_kg_used || 0),
        }).eq('id', prevRoll.id)
        // Reverse aggregate Roll Film stock too
        const { data: rfm } = await supabase.from('raw_materials').select('id,current_stock').ilike('name','Roll Film').single()
        if (rfm) await supabase.from('raw_materials').update({ current_stock: rfm.current_stock + (editBatch.roll_kg_used || 0) }).eq('id', rfm.id)
      }
      // Reverse previous material deductions — read fresh to avoid stale state
      const { data: freshForReversal } = await supabase
        .from('raw_materials').select('id,current_stock,usage_per_bag').gt('usage_per_bag', 0)
      for (const m of (freshForReversal ?? []).filter((m: any) => !m.name.toLowerCase().includes('water'))) {
        const prevUsed = editBatch.bags_produced * m.usage_per_bag
        if (prevUsed > 0) {
          await supabase.from('raw_materials')
            .update({ current_stock: m.current_stock + prevUsed }).eq('id', m.id)
        }
      }
      await supabase.from('production_batches').update(payload).eq('id', editBatch.id)
      await supabase.from('finished_inventory').delete().eq('reference_type','production').like('notes','%' + editBatch.batch_number + '%')
      await supabase.from('expenses').delete().eq('category','Operator Fee').like('description','%' + editBatch.batch_number + '%')
    } else {
      await supabase.from('production_batches').insert(payload)
    }

    // ── Deduct roll film Kg (per-roll tracking) ───────────────────────────
    if (roll) {
      const newKgRemaining = (roll.kg_remaining ?? roll.weight_kg) - kgUsed
      if (newKgRemaining < 0) newWarnings.push(`Roll ${roll.label}: Kg went negative (${newKgRemaining.toFixed(2)} Kg)`)
      await supabase.from('roll_films').update({
        bags_produced: (roll.bags_produced||0) + bags,
        kg_remaining: newKgRemaining,
        status: newKgRemaining <= 0 ? 'finished' : 'in_use',
      }).eq('id', roll.id)
    }

    // ── Also deduct from the aggregate "Roll Film" stock in Raw Materials ──
    const { data: rollFilmMat } = await supabase
      .from('raw_materials').select('id,current_stock')
      .ilike('name', 'Roll Film').single()
    if (rollFilmMat) {
      const newAggStock = rollFilmMat.current_stock - kgUsed
      if (newAggStock < 0) newWarnings.push(`Roll Film stock went negative (${newAggStock.toFixed(2)} Kg)`)
      await supabase.from('raw_materials')
        .update({ current_stock: newAggStock }).eq('id', rollFilmMat.id)
    }

    // ── Deduct all raw materials by recipe ratio ────────────────────────────
    // Re-read current stock values fresh from the DB immediately before deducting.
    // Using the `materials` state variable here would deduct from stale values
    // if multiple batches are saved in the same session without a page reload.
    const { data: freshMaterials } = await supabase
      .from('raw_materials').select('*').gt('usage_per_bag', 0)
    for (const m of (freshMaterials ?? []).filter((m: any) => !m.name.toLowerCase().includes('water'))) {
      const used = bags * m.usage_per_bag
      if (used <= 0) continue
      const newStock = m.current_stock - used
      if (newStock < 0) newWarnings.push(`${m.name}: stock went negative (${newStock.toFixed(2)} ${m.unit})`)
      await supabase.from('raw_materials').update({ current_stock: newStock }).eq('id', m.id)
      await supabase.from('raw_material_usage').insert({
        material_id: m.id, usage_date: form.batch_date,
        quantity_used: used,
        notes: `Batch ${batchNum} — ${bags} bags`,
      })
    }

    // ── Stock in + operator fee ─────────────────────────────────────────────
    await offlineSave({
      table: 'finished_inventory', operation: 'insert',
      payload: { bags_in: bags, bags_out: 0, transaction_date: form.batch_date,
        reference_type:'production', notes:'Batch ' + batchNum },
      label: `Stock in — ${bags} bags`, userId: userId ?? '',
    })
    // Operator fee is NOT auto-posted — admin must click Pay on the batch row

    setWarnings(newWarnings)
    setSaving(false)
    if (newWarnings.length === 0) {
      setShowForm(false)
    }
    load()
    // Refresh rolls + materials
    supabase.from('roll_films').select('*').in('status',['available','in_use']).order('label')
      .then(({data}) => setRolls(data ?? []))
    supabase.from('raw_materials').select('*').gt('usage_per_bag', 0).order('name')
      .then(({data}) => setMaterials(data ?? []))
  }

  // ── Pay operator fee for a batch ──────────────────────────────────────────
  const payOperatorFee = async (b: any) => {
    const fee = (b.bags_produced / 100) * OP_FEE
    // Check if already paid
    const { data: existing } = await supabase.from('expenses')
      .select('id').eq('category', 'Operator Fee')
      .like('description', '%' + b.batch_number + '%').maybeSingle()
    if (existing) {
      alert('Operator fee for this batch has already been posted to Expenses.')
      return
    }
    if (!confirm(
      `Post operator fee to Expenses?\n\n` +
      `Batch: ${b.batch_number}\n` +
      `Bags: ${b.bags_produced}\n` +
      `Fee: GH₵ ${fee.toFixed(2)}\n\n` +
      `This will record GH₵ ${fee.toFixed(2)} as an Operator Fee expense.`
    )) return
    setPayingFee(b.batch_number)
    await supabase.from('expenses').insert({
      expense_date: b.batch_date, category: 'Operator Fee',
      description: `Operator fee - ${b.batch_number} (${b.bags_produced} bags)`,
      amount: fee,
    })
    setPayingFee(null)
    load()
  }

  const deleteBatch = async (b: any) => {
    if (!confirm('Delete ' + b.batch_number + '? This will reverse stock deductions.')) return

    // Reverse roll Kg
    const roll = b.roll_films
    if (roll) {
      await supabase.from('roll_films').update({
        bags_produced: Math.max(0, (roll.bags_produced||0) - b.bags_produced),
        kg_remaining: (roll.kg_remaining ?? roll.weight_kg) + (b.roll_kg_used || 0),
        status: 'in_use',
      }).eq('id', roll.id)
      const { data: rfm2 } = await supabase.from('raw_materials').select('id,current_stock').ilike('name','Roll Film').single()
      if (rfm2) await supabase.from('raw_materials').update({ current_stock: rfm2.current_stock + (b.roll_kg_used || 0) }).eq('id', rfm2.id)
    }
    // Reverse material deductions
    const { data: mats } = await supabase.from('raw_materials').select('*').gt('usage_per_bag', 0)
    for (const m of mats ?? []) {
      const used = b.bags_produced * m.usage_per_bag
      if (used > 0) {
        await supabase.from('raw_materials')
          .update({ current_stock: m.current_stock + used }).eq('id', m.id)
      }
    }
    await supabase.from('raw_material_usage').delete().like('notes', '%' + b.batch_number + '%')
    const { error: bErr } = await supabase.from('production_batches').delete().eq('id', b.id)
    if (bErr) { alert('Delete failed: ' + bErr.message); return }
    await supabase.from('finished_inventory').delete().eq('reference_type','production').like('notes','%' + b.batch_number + '%')
    await supabase.from('expenses').delete().eq('category','Operator Fee').like('description','%' + b.batch_number + '%')
    load()
  }

  const totals = batches.reduce((a: any, b: any) => ({
    bags: a.bags+b.bags_produced, batches: a.batches+1, fee: a.fee+(b.bags_produced/100)*OP_FEE
  }), {bags:0,batches:0,fee:0})

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Production</h1>
        <button onClick={() => {
          setEditBatch(null); setWarnings([])
          const activeRoll = rolls.find((r: any) => r.status === 'in_use') ?? rolls[0]
          setForm({batch_date:today(),roll_film_id:activeRoll ? String(activeRoll.id) : '',bags_produced:'',notes:''})
          setShowForm(true)
        }} className="btn btn-primary">+ New Batch</button>
      </div>

      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36" /></div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Batches',String(totals.batches),'#1F4E79'],['Total Bags',fmtNum(totals.bags),'#1B5E20'],['Op. Fees',fmtGhc(totals.fee),'#BF4D00']].map(([l,v,c])=>(
          <div key={l} className="stat-card" style={{borderLeftColor:c as string}}>
            <div className="text-xs text-gray-500">{l}</div>
            <div className="font-bold" style={{color:c as string}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Low stock warning banner */}
      {materials.some((m:any) => m.current_stock <= m.low_stock_threshold) && (
        <div className="card mb-4 border-l-4 border-orange-400 bg-orange-50">
          <div className="font-semibold text-orange-700">⚠️ Low raw material stock</div>
          <div className="text-xs text-orange-600 mt-1">
            {materials.filter((m:any) => m.current_stock <= m.low_stock_threshold)
              .map((m:any) => `${m.name} (${fmtNum(m.current_stock)} ${m.unit})`).join(', ')}
          </div>
        </div>
      )}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'160px'}} />
              <col style={{width:'95px'}} />
              <col style={{width:'150px'}} />
              <col style={{width:'65px'}} />
              <col style={{width:'80px'}} />
              <col style={{width:'95px'}} />
              <col style={{width:'80px'}} />
              <col style={{width:'200px'}} />
            </colgroup>
            <thead><tr>
              <th>Batch #</th><th>Date</th><th>Roll Film</th>
              <th className="right">Bags</th><th className="right">Kg Used</th>
              <th className="right">Op. Fee</th><th>Notes</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Loading...</td></tr>
              : batches.length===0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No batches found</td></tr>
              : batches.map((b:any) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">{b.batch_number}</td>
                  <td className="muted">{fmtDate(b.batch_date)}</td>
                  <td className="muted">{b.roll_ref||'—'}</td>
                  <td className="num-green">{fmtNum(b.bags_produced)}</td>
                  <td className="num">{(b.roll_kg_used ?? 0).toFixed(2)}</td>
                  <td className="num" style={{color:'#BF4D00'}}>{fmtGhc((b.bags_produced/100)*OP_FEE)}</td>
                  <td className="muted">{b.notes||'—'}</td>
                  <td><div className="flex gap-1 items-center flex-nowrap">
                    {paidFees.has(b.batch_number)
                      ? <span className="badge badge-green text-xs">✅ Fee Paid</span>
                      : <button onClick={() => payOperatorFee(b)}
                          disabled={payingFee === b.batch_number}
                          className="btn btn-sm btn-warning">
                          {payingFee === b.batch_number ? '⏳' : '💳 Pay Fee'}
                        </button>
                    }
                    <button onClick={()=>{
                      setEditBatch(b); setWarnings([])
                      setForm({batch_date:b.batch_date,roll_film_id:String(b.roll_film_id??''),bags_produced:String(b.bags_produced),notes:b.notes??''})
                      setShowForm(true)
                    }} className="btn btn-sm btn-secondary">Edit</button>
                    <button onClick={()=>deleteBatch(b)} className="btn btn-sm btn-danger">Del</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={()=>setShowForm(false)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editBatch?'Edit Batch':'New Production Batch'}</h2>
              <button onClick={()=>setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">

              {warnings.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-xs font-semibold text-red-700 mb-1">⚠️ Stock warnings from last save:</div>
                  {warnings.map((w,i) => <div key={i} className="text-xs text-red-600">{w}</div>)}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" value={form.batch_date} onChange={e=>setForm(f=>({...f,batch_date:e.target.value}))} className="form-input" />
              </div>

              <div className="form-group">
                <label className="form-label">Active Roll Film
                  <span className="text-red-500 ml-1">(auto-selected)</span>
                </label>
                {rolls.length === 0 ? (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                    ⚠️ No active roll. Go to <strong>Raw Materials → Roll Film</strong> and
                    register a new roll or mark one as active before recording production.
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                    <div className="font-medium text-[#1F4E79]">
                      🎬 {rolls[0]?.label}
                    </div>
                    <div className="text-xs text-blue-600 mt-0.5">
                      {(rolls[0]?.kg_remaining ?? rolls[0]?.weight_kg ?? 0).toFixed(2)} Kg remaining
                      · {rolls[0]?.bags_expected ?? 0} bags expected
                    </div>
                    <input type="hidden" value={form.roll_film_id} />
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Bags Produced *</label>
                <input type="number" value={form.bags_produced}
                  onChange={e=>setForm(f=>({...f,bags_produced:e.target.value}))}
                  className="form-input text-xl font-bold text-center" placeholder="0" />
              </div>

              {bags > 0 && selectedRoll && (
                <div className={'rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-sm '
                  + (kgNeeded > kgAvailable ? 'bg-red-50 border border-red-200' : 'bg-blue-50')}>
                  <div>
                    <div className="text-xs text-gray-500">Film Needed</div>
                    <div className="font-bold text-[#1F4E79]">{kgNeeded.toFixed(2)} Kg</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Film Available</div>
                    <div className={'font-bold ' + (kgAvailable < kgNeeded ? 'text-red-600' : 'text-green-700')}>
                      {kgAvailable.toFixed(2)} Kg
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Op. Fee</div>
                    <div className="font-bold text-orange-600">{fmtGhc((bags/100)*OP_FEE)}</div>
                  </div>
                  {kgNeeded > kgAvailable && (
                    <div className="col-span-3 text-xs text-red-600 mt-1">
                      ⚠️ This will use more film than remains on the roll — stock will go negative.
                    </div>
                  )}
                </div>
              )}

              {/* Material consumption preview */}
              {bags > 0 && materialPreview.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Raw Materials to be Deducted
                  </div>
                  <div className="space-y-1">
                    {materialPreview.map((m:any) => (
                      <div key={m.id} className="flex justify-between items-center text-xs">
                        <span className="text-gray-600">{m.name}</span>
                        <span className={m.willGoNegative ? 'text-red-600 font-bold' : 'text-gray-700'}>
                          -{m.needed.toFixed(2)} {m.unit}
                          {' '}→ {m.afterStock.toFixed(2)} {m.unit} left
                          {m.willGoNegative && ' ⚠️'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={form.notes} rows={2} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={()=>setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveBatch}
                disabled={saving || !form.bags_produced || !form.roll_film_id || rolls.length === 0}
                className="btn btn-primary">
                {saving ? 'Saving...' : 'Save Batch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function ProductionPage() {
  const { userId } = useRole()
  const { isOnline } = useOfflineSync(userId ?? undefined)
  return (
    <ModuleGuard moduleKey="production" moduleLabel="Production">
      <ProductionPageInner />
    </ModuleGuard>
  )
}
