'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'

function SalesPageInner() {
  const [sales, setSales] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editSale, setEditSale] = useState<any>(null)
  const [filter, setFilter] = useState({ from: monthStart(), to: today(), status: 'all', search: '' })
  const [form, setForm] = useState({ sale_date: today(), customer_id: '', salesperson_id: '', bags_sold: '', unit_price: '6', amount_paid: '', protocol_bags: '0', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('sales').select('*,customers(id,name),employees(id,full_name)')
      .gte('sale_date', filter.from).lte('sale_date', filter.to)
      .order('sale_date', { ascending: false })
    if (filter.status !== 'all') q = q.eq('payment_status', filter.status)
    const { data } = await q
    let rows = data ?? []
    if (filter.search) {
      const s = filter.search.toLowerCase()
      rows = rows.filter((r: any) => r.customers?.name?.toLowerCase().includes(s))
    }
    setSales(rows)
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('customers').select('*').order('name').then(({ data }) => setCustomers(data ?? []))
    supabase.from('employees').select('*').eq('status','active').order('full_name').then(({ data }) => setEmployees(data ?? []))
  }, [])

  const openNew = () => {
    setEditSale(null)
    setForm({ sale_date: today(), customer_id: '', salesperson_id: '', bags_sold: '', unit_price: '6', amount_paid: '', protocol_bags: '0', notes: '' })
    setShowForm(true)
  }

  const saveSale = async () => {
    const bags = parseInt(form.bags_sold) || 0
    const price = parseFloat(form.unit_price) || 0
    const paid = parseFloat(form.amount_paid) || 0
    const proto = parseInt(form.protocol_bags) || 0
    const total = bags * price
    const balance = Math.max(0, total - paid)
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    if (!editSale) {
      const { data: fi } = await supabase.from('finished_inventory').select('bags_in,bags_out')
      const stock = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
      if (bags + proto > stock) { alert('Insufficient stock! Available: ' + stock + ' bags'); return }
    }

    const payload: any = {
      sale_date: form.sale_date, customer_id: parseInt(form.customer_id),
      salesperson_id: form.salesperson_id ? parseInt(form.salesperson_id) : null,
      bags_sold: bags, unit_price: price, total_amount: total,
      amount_paid: paid, outstanding_balance: balance,
      payment_status: status, protocol_bags: proto, notes: form.notes
    }

    if (editSale) {
      await supabase.from('sales').update(payload).eq('id', editSale.id)
      await supabase.from('finished_inventory').delete().eq('sale_id', editSale.id)
      await supabase.from('finished_inventory').insert({ bags_in: 0, bags_out: bags + proto, transaction_date: form.sale_date, reference_type: 'sale', sale_id: editSale.id, notes: 'Sale #' + editSale.id })
    } else {
      const { data: ns } = await supabase.from('sales').insert(payload).select().single()
      if (ns) await supabase.from('finished_inventory').insert({ bags_in: 0, bags_out: bags + proto, transaction_date: form.sale_date, reference_type: 'sale', sale_id: ns.id, notes: 'Sale #' + ns.id })
    }
    setShowForm(false); load()
  }

  const deleteSale = async (s: any) => {
    if (!confirm('Delete Sale #' + s.id + '?')) return
    await supabase.from('payments').delete().eq('sale_id', s.id)
    await supabase.from('finished_inventory').delete().eq('sale_id', s.id)
    await supabase.from('sales').delete().eq('id', s.id)
    load()
  }

  const total = parseFloat(form.bags_sold||'0') * parseFloat(form.unit_price||'0')
  const balance = Math.max(0, total - parseFloat(form.amount_paid||'0'))
  const totals = sales.reduce((a: any, s: any) => ({ bags: a.bags + s.bags_sold, revenue: a.revenue + s.total_amount, collected: a.collected + s.amount_paid, outstanding: a.outstanding + s.outstanding_balance }), { bags:0, revenue:0, collected:0, outstanding:0 })

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Sales</h1>
        <button onClick={openNew} className="btn btn-primary">+ New Sale</button>
      </div>
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e => setFilter(f => ({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e => setFilter(f => ({...f,to:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">Status</label>
          <select value={filter.status} onChange={e => setFilter(f => ({...f,status:e.target.value}))} className="form-select w-32">
            <option value="all">All</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option>
          </select></div>
        <div><label className="form-label">Search</label><input value={filter.search} onChange={e => setFilter(f => ({...f,search:e.target.value}))} placeholder="Customer..." className="form-input w-40" /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[['Revenue',fmtGhc(totals.revenue),'#1F4E79'],['Bags',fmtNum(totals.bags),'#2E75B6'],['Collected',fmtGhc(totals.collected),'#1B5E20'],['Outstanding',fmtGhc(totals.outstanding),'#C00000']].map(([l,v,c]) => (
          <div key={l} className="stat-card" style={{borderLeftColor:c as string}}><div className="text-xs text-gray-500">{l}</div><div className="font-bold" style={{color:c as string}}>{v}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Customer</th><th>Rep</th><th className="text-right">Bags</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td></tr>
              : sales.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">No sales found</td></tr>
              : sales.map((s: any) => (
                <tr key={s.id}>
                  <td className="text-gray-500 text-xs">{s.sale_date}</td>
                  <td className="font-medium">{s.customers?.name}</td>
                  <td className="text-xs text-gray-500">{s.employees?.full_name ?? '-'}</td>
                  <td className="text-right">{fmtNum(s.bags_sold)}</td>
                  <td className="text-right font-medium">{fmtGhc(s.total_amount)}</td>
                  <td className="text-right text-green-700">{fmtGhc(s.amount_paid)}</td>
                  <td className="text-right text-red-600">{fmtGhc(s.outstanding_balance)}</td>
                  <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                  <td><div className="flex gap-1">
                    <button onClick={() => { setEditSale(s); setForm({sale_date:s.sale_date,customer_id:String(s.customer_id),salesperson_id:String(s.salesperson_id??''),bags_sold:String(s.bags_sold),unit_price:String(s.unit_price),amount_paid:String(s.amount_paid),protocol_bags:String(s.protocol_bags??0),notes:s.notes??''}); setShowForm(true) }} className="btn btn-sm btn-secondary">Edit</button>
                    <button onClick={() => deleteSale(s)} className="btn btn-sm btn-danger">Del</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editSale ? 'Edit Sale #' + editSale.id : 'New Sale'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group"><label className="form-label">Date</label><input type="date" value={form.sale_date} onChange={e => setForm(f=>({...f,sale_date:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Customer</label>
                  <select value={form.customer_id} onChange={e => setForm(f=>({...f,customer_id:e.target.value}))} className="form-select">
                    <option value="">Select...</option>
                    {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label">Sales Rep</label>
                  <select value={form.salesperson_id} onChange={e => setForm(f=>({...f,salesperson_id:e.target.value}))} className="form-select">
                    <option value="">None</option>
                    {employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label">Unit Price (GHc)</label><input type="number" step="0.01" value={form.unit_price} onChange={e => setForm(f=>({...f,unit_price:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Bags Sold</label><input type="number" value={form.bags_sold} onChange={e => setForm(f=>({...f,bags_sold:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Protocol Bags</label><input type="number" value={form.protocol_bags} onChange={e => setForm(f=>({...f,protocol_bags:e.target.value}))} className="form-input" /></div>
              </div>
              {total > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-xs text-gray-500">Total</div><div className="font-bold text-[#1F4E79]">{fmtGhc(total)}</div></div>
                  <div><div className="text-xs text-gray-500">Balance</div><div className="font-bold text-red-600">{fmtGhc(balance)}</div></div>
                  <div><div className="text-xs text-gray-500">Status</div><div className="font-bold">{parseFloat(form.amount_paid||'0')>=total?'Paid':parseFloat(form.amount_paid||'0')>0?'Partial':'Unpaid'}</div></div>
                </div>
              )}
              <div className="form-group"><label className="form-label">Amount Paid (GHc)</label><input type="number" step="0.01" value={form.amount_paid} onChange={e => setForm(f=>({...f,amount_paid:e.target.value}))} className="form-input" /></div>
              <div className="form-group"><label className="form-label">Notes</label><textarea value={form.notes} rows={2} onChange={e => setForm(f=>({...f,notes:e.target.value}))} className="form-input" /></div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveSale} disabled={!form.customer_id||!form.bags_sold} className="btn btn-primary">Save Sale</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function SalesPage() {
  return (
    <ModuleGuard moduleKey="sales" moduleLabel="Sales">
      <SalesPageInner />
    </ModuleGuard>
  )
}
