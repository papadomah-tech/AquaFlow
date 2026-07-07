'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

const today = () => new Date().toISOString().split('T')[0]
const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtGhc = (n: number) => `GH₵ ${(n || 0).toFixed(2)}`
const fmtNum = (n: number) => (n || 0).toLocaleString()

interface Sale {
  id: number; rider_id: number; sale_date: string
  customer_name: string; customer_id: number | null
  bags: number; price_per_bag: number; total_amount: number
  amount_collected: number; outstanding: number; notes: string | null
}
interface Customer { id: number; name: string }

const emptyForm = () => ({
  sale_date: today(), customer_name: '', customer_id: '' as string,
  bags: '', price_per_bag: '', amount_collected: '', notes: ''
})

function RiderSalesInner() {
  const { employeeId, employeeName, isAdmin, loading: roleLoading } = useRole()

  const [sales, setSales]           = useState<Sale[]>([])
  const [customers, setCustomers]   = useState<Customer[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [editItem, setEditItem]     = useState<Sale | null>(null)
  const [saving, setSaving]         = useState(false)
  const [form, setForm]             = useState(emptyForm())
  const [custSearch, setCustSearch] = useState('')
  const [showCustList, setShowCustList]       = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustName, setNewCustName]         = useState('')
  const [newCustPhone, setNewCustPhone]       = useState('')
  const [newCustAddr, setNewCustAddr]         = useState('')
  const [savingCust, setSavingCust]           = useState(false)
  const [filterRider, setFilterRider]   = useState<number | ''>('')
  const [riders, setRiders]             = useState<{id:number,full_name:string}[]>([])
  const [dateFrom, setDateFrom]         = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(today())

  const loadAll = useCallback(async () => {
    if (roleLoading) return
    setLoading(true)

    const riderId = isAdmin ? (filterRider || undefined) : (employeeId ?? undefined)

    let q = supabase.from('rider_sales').select('*')
      .gte('sale_date', dateFrom).lte('sale_date', dateTo)
      .order('sale_date', { ascending: false }).order('id', { ascending: false })
    if (riderId) q = q.eq('rider_id', riderId)

    // Riders see only customers they added (via rider_sales); admins see all
    let custQuery = supabase.from('customers').select('id, name').order('name')
    if (!isAdmin && employeeId) {
      // Get customer_ids this rider has used
      const { data: riderCustIds } = await supabase
        .from('rider_sales').select('customer_id').eq('rider_id', employeeId).not('customer_id', 'is', null)
      // Also include customers added directly by this rider
      const { data: riderOwnCusts } = await supabase
        .from('customers').select('id, name').eq('added_by_rider_id', employeeId).order('name')
      const usedIds = (riderCustIds ?? []).map((r: any) => r.customer_id).filter(Boolean)
      const ownIds  = (riderOwnCusts ?? []).map((r: any) => r.id)
      const allIds  = [...new Set([...usedIds, ...ownIds])]
      if (allIds.length > 0) {
        custQuery = supabase.from('customers').select('id, name').in('id', allIds).order('name')
      } else {
        custQuery = supabase.from('customers').select('id, name').eq('added_by_rider_id', employeeId).order('name')
      }
    }

    const [{ data: s }, { data: c }] = await Promise.all([q, custQuery])
    setSales(s ?? [])
    setCustomers(c ?? [])

    if (isAdmin) {
      const { data: r } = await supabase.from('employees')
        .select('id, full_name').eq('employee_type', 'rider').eq('status', 'active')
      setRiders(r ?? [])
    }
    setLoading(false)
  }, [roleLoading, isAdmin, employeeId, filterRider, dateFrom, dateTo])

  useEffect(() => { loadAll() }, [loadAll])

  const openNew = () => {
    setEditItem(null); setForm(emptyForm()); setCustSearch(''); setShowCustList(false); setShowForm(true)
  }
  const openEdit = (s: Sale) => {
    setEditItem(s)
    setForm({
      sale_date: s.sale_date, customer_name: s.customer_name,
      customer_id: s.customer_id ? String(s.customer_id) : '',
      bags: String(s.bags), price_per_bag: String(s.price_per_bag),
      amount_collected: String(s.amount_collected), notes: s.notes ?? ''
    })
    setCustSearch(s.customer_name); setShowCustList(false); setShowForm(true)
  }

  const save = async () => {
    if (!form.customer_name.trim()) { alert('Customer name is required.'); return }
    const bags = parseInt(form.bags) || 0
    if (bags <= 0) { alert('Enter number of bags.'); return }
    const ppb  = parseFloat(form.price_per_bag) || 0
    const coll = parseFloat(form.amount_collected) || 0
    const total = bags * ppb
    if (coll > total) { alert(`Amount collected (${fmtGhc(coll)}) cannot exceed total (${fmtGhc(total)}).`); return }
    if (!employeeId && !isAdmin) { alert('Your account is not linked to a rider employee. Contact admin.'); return }

    setSaving(true)
    const payload = {
      rider_id:         isAdmin && editItem ? editItem.rider_id : employeeId,
      sale_date:        form.sale_date,
      customer_name:    form.customer_name.trim(),
      customer_id:      form.customer_id ? parseInt(form.customer_id) : null,
      bags,
      price_per_bag:    ppb,
      amount_collected: coll,
      notes:            form.notes.trim() || null,
    }

    const { error } = editItem
      ? await supabase.from('rider_sales').update(payload).eq('id', editItem.id)
      : await supabase.from('rider_sales').insert(payload)

    setSaving(false)
    if (error) { alert(`Save failed: ${error.message}`); return }
    setShowForm(false); loadAll()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this sales record?')) return
    await supabase.from('rider_sales').delete().eq('id', id)
    loadAll()
  }

  const saveNewCustomer = async () => {
    if (!newCustName.trim()) { alert('Customer name is required.'); return }
    if (!newCustPhone.trim()) { alert('Phone number is required.'); return }
    if (!newCustAddr.trim()) { alert('Address / location is required.'); return }
    setSavingCust(true)
    const { data, error } = await supabase.from('customers')
      .insert({ name: newCustName.trim(), phone: newCustPhone.trim(), address: newCustAddr.trim(), added_by_rider_id: employeeId })
      .select().single()
    setSavingCust(false)
    if (error) { alert(`Failed to add customer: ${error.message}`); return }
    // Select the newly created customer
    setCustomers(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name)))
    setForm(f => ({...f, customer_name: data.name, customer_id: String(data.id)}))
    setCustSearch(data.name)
    setShowAddCustomer(false)
    setNewCustName(''); setNewCustPhone(''); setNewCustAddr('')
  }

  // summary stats
  const totalBags      = sales.reduce((a, s) => a + s.bags, 0)
  const totalInvoiced  = sales.reduce((a, s) => a + s.total_amount, 0)
  const totalCollected = sales.reduce((a, s) => a + s.amount_collected, 0)
  const totalOutstanding = sales.reduce((a, s) => a + s.outstanding, 0)

  const filteredCusts = customers.filter(c =>
    c.name.toLowerCase().includes(custSearch.toLowerCase())
  )

  if (roleLoading) return <AppLayout><div className="p-8 text-center text-gray-400">Loading...</div></AppLayout>

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🛵 My Sales</h1>
          <p className="page-subtitle">
            {isAdmin ? 'All rider sales diary records' : `Personal sales diary — ${employeeName || 'Rider'}`}
          </p>
        </div>
        <button onClick={openNew} className="btn btn-primary">+ Add Sale</button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs text-gray-400 mb-1">From</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="form-input" style={{width:'140px'}} />
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">To</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="form-input" style={{width:'140px'}} />
          </div>
          {isAdmin && riders.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-1">Rider</div>
              <select value={filterRider} onChange={e => setFilterRider(e.target.value ? parseInt(e.target.value) : '')} className="form-input" style={{width:'160px'}}>
                <option value="">All riders</option>
                {riders.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-4" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
        {[
          { label: 'Bags Sold',    value: fmtNum(totalBags),           color: 'text-[#1F4E79]' },
          { label: 'Invoiced',     value: fmtGhc(totalInvoiced),       color: 'text-[#1F4E79]' },
          { label: 'Collected',    value: fmtGhc(totalCollected),      color: 'text-green-700' },
          { label: 'Outstanding',  value: fmtGhc(totalOutstanding),    color: totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center py-4">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'90px'}} /><col style={{width:'160px'}} />
              <col style={{width:'60px'}} /><col style={{width:'100px'}} />
              <col style={{width:'105px'}} /><col style={{width:'100px'}} />
              <col style={{width:'170px'}} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th className="right">Bags</th>
                <th className="right">Total</th>
                <th className="right">Collected</th>
                <th className="right">Outstanding</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400 italic">No sales recorded in this period.</td></tr>
              ) : sales.map(s => (
                <tr key={s.id}>
                  <td className="muted text-xs">{fmtDate(s.sale_date)}</td>
                  <td>
                    <div className="font-medium">{s.customer_name}</div>
                    {s.notes && <div className="text-xs text-gray-400 truncate max-w-[140px]">{s.notes}</div>}
                  </td>
                  <td className="num">{fmtNum(s.bags)}</td>
                  <td className="num">{fmtGhc(s.total_amount)}</td>
                  <td className="num text-green-700">{fmtGhc(s.amount_collected)}</td>
                  <td className={`num font-medium ${s.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {fmtGhc(s.outstanding)}
                  </td>
                  <td className="right">
                    <button onClick={() => openEdit(s)} className="btn btn-sm btn-secondary mr-1">Edit</button>
                    <button onClick={() => del(s.id)} className="btn btn-sm btn-danger">Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {sales.length > 0 && (
              <tfoot>
                <tr className="bg-[#1F4E79] text-white font-semibold">
                  <td className="px-3 py-2 text-xs uppercase tracking-wide" colSpan={2}>Totals</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(totalBags)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtGhc(totalInvoiced)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtGhc(totalCollected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtGhc(totalOutstanding)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" style={{maxWidth:'480px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editItem ? 'Edit Sale' : 'Record a Sale'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-4">

              <div className="form-group">
                <label className="form-label">Date *</label>
                <input type="date" value={form.sale_date}
                  onChange={e => setForm(f => ({...f, sale_date: e.target.value}))}
                  className="form-input" max={today()} />
              </div>

              {/* Customer — pick or type */}
              <div className="form-group" style={{position:'relative'}}>
                <label className="form-label">Customer *</label>
                <input
                  value={custSearch}
                  onChange={e => {
                    setCustSearch(e.target.value)
                    setForm(f => ({...f, customer_name: e.target.value, customer_id: ''}))
                    setShowCustList(true)
                  }}
                  onFocus={() => setShowCustList(true)}
                  className="form-input"
                  placeholder="Type name or pick from list"
                  autoComplete="off"
                />
                {showCustList && filteredCusts.length > 0 && (
                  <div style={{
                    position:'absolute', top:'100%', left:0, right:0, zIndex:9999,
                    background:'#ffffff', border:'1px solid #d1d5db',
                    borderRadius:'8px', maxHeight:'200px', overflowY:'auto',
                    boxShadow:'0 8px 24px rgba(0,0,0,0.18)'
                  }}>
                    {/* + Add Customer option always at top */}
                    <div
                      style={{padding:'10px 12px', cursor:'pointer', fontSize:'13px',
                        fontWeight:500, color:'#1F4E79', borderBottom:'1px solid #e5e7eb',
                        display:'flex', alignItems:'center', gap:'6px', background:'#f0f7ff'}}
                      onMouseDown={() => {
                        setShowCustList(false)
                        setShowAddCustomer(true)
                        setNewCustName(custSearch)
                      }}
                    >
                      <span style={{fontSize:'16px'}}>+</span> Add Customer{custSearch ? ` "${custSearch}"` : ''}
                    </div>
                    {filteredCusts.slice(0,10).map(c => (
                      <div key={c.id}
                        style={{padding:'10px 12px', cursor:'pointer', fontSize:'13px',
                          borderBottom:'1px solid #f3f4f6', color:'#111827', background:'#ffffff'}}
                        onMouseDown={() => {
                          setForm(f => ({...f, customer_name: c.name, customer_id: String(c.id)}))
                          setCustSearch(c.name); setShowCustList(false)
                        }}
                      >{c.name}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Bags *</label>
                  <input type="number" min="1" value={form.bags}
                    onChange={e => setForm(f => ({...f, bags: e.target.value}))}
                    className="form-input" placeholder="0" />
                </div>
                <div className="form-group">
                  <label className="form-label">Price / Bag (GH₵) *</label>
                  <input type="number" min="0" step="0.01" value={form.price_per_bag}
                    onChange={e => setForm(f => ({...f, price_per_bag: e.target.value}))}
                    className="form-input" placeholder="0.00" />
                </div>
              </div>

              {/* Live total display */}
              {(parseInt(form.bags) > 0 && parseFloat(form.price_per_bag) > 0) && (
                <div className="bg-blue-50 rounded-xl px-4 py-2 text-sm text-[#1F4E79] font-medium">
                  Total: {fmtGhc(parseInt(form.bags) * parseFloat(form.price_per_bag))}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Amount Collected (GH₵)</label>
                <input type="number" min="0" step="0.01" value={form.amount_collected}
                  onChange={e => setForm(f => ({...f, amount_collected: e.target.value}))}
                  className="form-input" placeholder="0.00" />
                {/* Outstanding preview */}
                {parseFloat(form.bags) > 0 && parseFloat(form.price_per_bag) > 0 && (
                  <div className="text-xs mt-1" style={{color: (parseInt(form.bags)*parseFloat(form.price_per_bag) - parseFloat(form.amount_collected||'0')) > 0 ? 'var(--text-danger)' : 'var(--text-success)'}}>
                    Outstanding: {fmtGhc(parseInt(form.bags)*parseFloat(form.price_per_bag) - parseFloat(form.amount_collected||'0'))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={form.notes}
                  onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                  className="form-input" rows={2} placeholder="Optional — location, payment method, etc." />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving || !form.customer_name.trim() || !form.bags}
                className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer mini-modal */}
      {showAddCustomer && (
        <div className="modal-overlay" onClick={() => setShowAddCustomer(false)}>
          <div className="modal-box" style={{maxWidth:'380px', zIndex:10000}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Customer</h2>
              <button onClick={() => setShowAddCustomer(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input value={newCustName} onChange={e => setNewCustName(e.target.value)}
                  className="form-input" placeholder="Customer name" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Phone *</label>
                <input value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)}
                  className="form-input" placeholder="0241234567" type="tel" />
              </div>
              <div className="form-group">
                <label className="form-label">Address / Location *</label>
                <input value={newCustAddr} onChange={e => setNewCustAddr(e.target.value)}
                  className="form-input" placeholder="e.g. Pantang Village, Frafraha" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowAddCustomer(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveNewCustomer} disabled={savingCust || !newCustName.trim() || !newCustPhone.trim() || !newCustAddr.trim()} className="btn btn-primary">
                {savingCust ? 'Saving...' : '+ Add Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function RiderSalesPage() {
  return (
    <ModuleGuard moduleKey="rider-sales" moduleLabel="My Sales">
      <RiderSalesInner />
    </ModuleGuard>
  )
}
