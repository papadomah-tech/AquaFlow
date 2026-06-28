'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtNum, today, monthStart } from '@/lib/supabase'

const OP_FEE = 30

function ProductionPageInner() {
  const [batches, setBatches] = useState<any[]>([])
  const [rolls, setRolls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editBatch, setEditBatch] = useState<any>(null)
  const [filter, setFilter] = useState({ from: monthStart(), to: today() })
  const [form, setForm] = useState({ batch_date: today(), roll_film_id: '', bags_produced: '', bags_consumed: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('production_batches')
      .select('*,roll_films(id,label,status,bags_expected,bags_produced)')
      .gte('batch_date', filter.from).lte('batch_date', filter.to)
      .order('batch_date', { ascending: false })
    setBatches(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('roll_films').select('*').in('status',['available','in_use']).order('label').then(({data}) => setRolls(data ?? []))
  }, [])

  const saveBatch = async () => {
    const bags = parseInt(form.bags_produced) || 0
    const consumed = parseInt(form.bags_consumed) || bags
    const roll = rolls.find((r: any) => r.id === parseInt(form.roll_film_id))
    const batchNum = editBatch?.batch_number ?? ('BATCH-' + form.batch_date.replace(/-/g,'') + '-' + String(Math.floor(Math.random()*900+100)))
    const payload = { batch_date: form.batch_date, batch_number: batchNum, roll_film_id: form.roll_film_id ? parseInt(form.roll_film_id) : null, roll_ref: roll?.label ?? '', bags_produced: bags, bags_consumed: consumed, notes: form.notes }
    if (editBatch) {
      await supabase.from('production_batches').update(payload).eq('id', editBatch.id)
      await supabase.from('finished_inventory').delete().eq('reference_type','production').like('notes','%' + editBatch.batch_number + '%')
      await supabase.from('expenses').delete().eq('category','Operator Fee').like('description','%' + editBatch.batch_number + '%')
    } else {
      await supabase.from('production_batches').insert(payload)
      if (roll) await supabase.from('roll_films').update({ bags_produced: (roll.bags_produced||0)+bags, status:'in_use' }).eq('id', roll.id)
    }
    await supabase.from('finished_inventory').insert({ bags_in: bags, bags_out: 0, transaction_date: form.batch_date, reference_type:'production', notes:'Batch ' + batchNum })
    await supabase.from('expenses').insert({ expense_date: form.batch_date, category:'Operator Fee', description:'Operator fee - ' + batchNum + ' (' + bags + ' bags)', amount: (bags/100)*OP_FEE })
    setShowForm(false); load()
  }

  const deleteBatch = async (b: any) => {
    if (!confirm('Delete ' + b.batch_number + '?')) return
    await supabase.from('production_batches').delete().eq('id', b.id)
    await supabase.from('finished_inventory').delete().eq('reference_type','production').like('notes','%' + b.batch_number + '%')
    await supabase.from('expenses').delete().eq('category','Operator Fee').like('description','%' + b.batch_number + '%')
    load()
  }

  const totals = batches.reduce((a: any, b: any) => ({ bags: a.bags+b.bags_produced, batches: a.batches+1, fee: a.fee+(b.bags_produced/100)*OP_FEE }), {bags:0,batches:0,fee:0})

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Production</h1>
        <button onClick={() => { setEditBatch(null); setForm({batch_date:today(),roll_film_id:'',bags_produced:'',bags_consumed:'',notes:''}); setShowForm(true) }} className="btn btn-primary">+ New Batch</button>
      </div>
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36" /></div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Batches',String(totals.batches),'#1F4E79'],['Total Bags',fmtNum(totals.bags),'#1B5E20'],['Op. Fees','GHc '+totals.fee.toFixed(2),'#BF4D00']].map(([l,v,c])=>(
          <div key={l} className="stat-card" style={{borderLeftColor:c as string}}><div className="text-xs text-gray-500">{l}</div><div className="font-bold" style={{color:c as string}}>{v}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'160px'}} />
              <col style={{width:'90px'}} />
              <col style={{width:'140px'}} />
              <col style={{width:'75px'}} />
              <col style={{width:'100px'}} />
              <col />
              <col style={{width:'120px'}} />
            </colgroup>
            <thead><tr><th>Batch #</th><th>Date</th><th>Roll Film</th><th className="right">Bags</th><th className="right">Op. Fee</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
              : batches.length===0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No batches found</td></tr>
              : batches.map((b:any) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">{b.batch_number}</td>
                  <td className="muted">{b.batch_date}</td>
                  <td className="muted">{b.roll_ref||'—'}</td>
                  <td className="num-green">{fmtNum(b.bags_produced)}</td>
                  <td className="num" style={{color:'#BF4D00'}}>GH₵ {((b.bags_produced/100)*OP_FEE).toFixed(2)}</td>
                  <td className="muted">{b.notes||'—'}</td>
                  <td><div className="flex gap-1">
                    <button onClick={()=>{setEditBatch(b);setForm({batch_date:b.batch_date,roll_film_id:String(b.roll_film_id??''),bags_produced:String(b.bags_produced),bags_consumed:String(b.bags_consumed),notes:b.notes??''});setShowForm(true)}} className="btn btn-sm btn-secondary">Edit</button>
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
              <button onClick={()=>setShowForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="form-group"><label className="form-label">Date</label><input type="date" value={form.batch_date} onChange={e=>setForm(f=>({...f,batch_date:e.target.value}))} className="form-input" /></div>
              <div className="form-group"><label className="form-label">Roll Film</label>
                <select value={form.roll_film_id} onChange={e=>setForm(f=>({...f,roll_film_id:e.target.value}))} className="form-select">
                  <option value="">Select roll...</option>
                  {rolls.map((r:any)=><option key={r.id} value={r.id}>{r.label} - {r.bags_expected - r.bags_produced} bags remaining</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group"><label className="form-label">Bags Produced</label><input type="number" value={form.bags_produced} onChange={e=>setForm(f=>({...f,bags_produced:e.target.value,bags_consumed:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Packaging Bags</label><input type="number" value={form.bags_consumed} onChange={e=>setForm(f=>({...f,bags_consumed:e.target.value}))} className="form-input" /></div>
              </div>
              {form.bags_produced && <div className="bg-orange-50 rounded-lg p-3 text-center"><div className="text-xs text-gray-500">Auto Operator Fee</div><div className="font-bold text-orange-600 text-lg">GHc {((parseInt(form.bags_produced)/100)*OP_FEE).toFixed(2)}</div></div>}
              <div className="form-group"><label className="form-label">Notes</label><textarea value={form.notes} rows={2} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="form-input" /></div>
            </div>
            <div className="modal-footer">
              <button onClick={()=>setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveBatch} disabled={!form.bags_produced} className="btn btn-primary">Save Batch</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function ProductionPage() {
  return (
    <ModuleGuard moduleKey="production" moduleLabel="Production">
      <ProductionPageInner />
    </ModuleGuard>
  )
}
