'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import { offlineSave } from '@/lib/offlineSave'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useRole } from '@/hooks/useRole'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, today, monthStart, fmtDate} from '@/lib/supabase'

const CATS = ['Operator Fee','Salary','Raw Materials','Transport','Utilities','Maintenance','Equipment','Stock Loss','Other']

function ExpensesPageInner() {
  const [expenses, setExpenses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [filter, setFilter] = useState({ from: monthStart(), to: today(), cat: 'all' })
  const [form, setForm] = useState({ expense_date: today(), category: 'Other', description: '', amount: '', paid_to: '' })

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('expenses').select('*').gte('expense_date', filter.from).lte('expense_date', filter.to).or('is_archived.is.null,is_archived.eq.false').order('expense_date', { ascending: false })
    if (filter.cat !== 'all') q = q.eq('category', filter.cat)
    const { data } = await q
    setExpenses(data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const save = async () => {
    const payload = { ...form, amount: parseFloat(form.amount) }
    if (editItem) await supabase.from('expenses').update(payload).eq('id', editItem.id)
    else await supabase.from('expenses').insert(payload)
    setShowForm(false); load()
  }

  const del = async (e: any) => {
    if (!confirm('Delete expense: ' + e.description + '?')) return
    await supabase.from('expenses').delete().eq('id', e.id)
    load()
  }

  const total = expenses.reduce((a: number, e: any) => a + e.amount, 0)

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Expenses</h1>
        <button onClick={() => { setEditItem(null); setForm({expense_date:today(),category:'Other',description:'',amount:'',paid_to:''}); setShowForm(true) }} className="btn btn-primary">+ Add Expense</button>
      </div>
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">Category</label>
          <select value={filter.cat} onChange={e=>setFilter(f=>({...f,cat:e.target.value}))} className="form-select w-40">
            <option value="all">All</option>
            {CATS.map(c=><option key={c}>{c}</option>)}
          </select></div>
      </div>
      <div className="stat-card mb-4" style={{borderLeftColor:'#C00000'}}>
        <div className="text-xs text-gray-500">Total Expenses</div>
        <div className="font-bold text-red-700 text-lg">{fmtGhc(total)}</div>
      </div>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'90px'}} />
              <col style={{width:'120px'}} />
              <col />
              <col style={{width:'105px'}} />
              <col style={{width:'120px'}} />
              <col style={{width:'90px'}} />
            </colgroup>
            <thead><tr>
              <th>Date</th><th>Category</th><th>Description</th>
              <th className="right">Amount</th><th>Paid To</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
              : expenses.length===0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">No expenses found</td></tr>
              : expenses.map((e:any) => (
                <tr key={e.id}>
                  <td className="muted">{fmtDate(e.expense_date)}</td>
                  <td><span className="badge badge-blue">{e.category}</span></td>
                  <td>{e.description}</td>
                  <td className="num-red">{fmtGhc(e.amount)}</td>
                  <td className="muted">{e.paid_to||'—'}</td>
                  <td><div className="flex gap-1">
                    <button onClick={()=>{setEditItem(e);setForm({expense_date:e.expense_date,category:e.category,description:e.description,amount:String(e.amount),paid_to:e.paid_to??''});setShowForm(true)}} className="btn btn-sm btn-secondary">Edit</button>
                    <button onClick={()=>del(e)} className="btn btn-sm btn-danger">Del</button>
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
              <h2 className="font-bold text-[#1F4E79]">{editItem?'Edit Expense':'Add Expense'}</h2>
              <button onClick={()=>setShowForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group"><label className="form-label">Date</label><input type="date" value={form.expense_date} onChange={e=>setForm(f=>({...f,expense_date:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Category</label>
                  <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} className="form-select">
                    {CATS.map(c=><option key={c}>{c}</option>)}
                  </select></div>
                <div className="form-group col-span-2"><label className="form-label">Description</label><input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Amount (GHc)</label><input type="number" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Paid To</label><input value={form.paid_to} onChange={e=>setForm(f=>({...f,paid_to:e.target.value}))} className="form-input" /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={()=>setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={save} disabled={!form.description||!form.amount} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function ExpensesPage() {
  const { userId } = useRole()
  const { isOnline } = useOfflineSync(userId ?? undefined)
  return (
    <ModuleGuard moduleKey="expenses" moduleLabel="Expenses">
      <ExpensesPageInner />
    </ModuleGuard>
  )
}
