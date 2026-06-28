'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import CustomerSelect from '@/components/ui/CustomerSelect'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS LOGIC
// ─────────────────────────────────────────────────────────────────────────────
// Admin / Factory Manager:
//   - Can record BULK sales to Riders/Sales Reps
//   - Can record RETAIL sales to Customers
//   - Sees ALL transactions across all reps
//
// Rider / Sales Rep:
//   - Can ONLY record RETAIL sales to Customers
//   - Sees ONLY their own retail transactions
//   - Cannot create bulk sales
//
// "Bulk" sale = sale_type:'bulk', buyer_employee_id = the rider buying
// "Retail" sale = sale_type:'retail', customer_id = the end customer
// ─────────────────────────────────────────────────────────────────────────────

function SalesPageInner() {
  const { isAdmin, isFactoryManager, isRider,
          employeeId, employeeName, loading: roleLoading } = useRole()

  const [sales, setSales]         = useState<any[]>([])
  const [riders, setRiders]       = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<'retail'|'bulk'>('retail')
  const [riderBags, setRiderBags]   = useState<number | null>(null)  // bags on hand for rider
  const [returns, setReturns]         = useState<any[]>([])
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnTarget, setReturnTarget]     = useState<any>(null)  // the bulk sale being returned
  const [returnForm, setReturnForm]         = useState({ return_date: '', bags_returned: '', notes: '' })
  const [savingReturn, setSavingReturn]     = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [formType, setFormType]   = useState<'retail'|'bulk'>('retail')
  const [editSale, setEditSale]   = useState<any>(null)

  const [filter, setFilter] = useState({
    from: monthStart(), to: today(), status: 'all', search: ''
  })

  // ── Form state ─────────────────────────────────────────────────────────────
  const blankRetail = () => ({
    sale_date: today(), customer_id: '',
    salesperson_id: employeeId ? String(employeeId) : '',
    bags_sold: '', unit_price: '6', amount_paid: '',
    protocol_bags: '0', notes: ''
  })
  const blankBulk = () => ({
    sale_date: today(), buyer_employee_id: '',
    bags_sold: '', unit_price: '', amount_paid: '', notes: ''
  })
  const [retailForm, setRetailForm] = useState(blankRetail())
  const [bulkForm, setBulkForm]     = useState(blankBulk())

  // ── Load sales ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (roleLoading) return
    setLoading(true)

    const saleType = activeTab

    let q = supabase.from('sales')
      .select('*,customers(id,name),employees!salesperson_id(id,full_name),buyer:employees!buyer_employee_id(id,full_name)')
      .eq('sale_type', saleType)
      .gte('sale_date', filter.from)
      .lte('sale_date', filter.to)
      .order('sale_date', { ascending: false })

    // Riders only see their own retail sales
    if (isRider && employeeId) {
      q = q.eq('salesperson_id', employeeId)
    }

    if (filter.status !== 'all') q = q.eq('payment_status', filter.status)
    const { data } = await q
    let rows = data ?? []
    if (filter.search) {
      const s = filter.search.toLowerCase()
      rows = rows.filter((r: any) =>
        r.customers?.name?.toLowerCase().includes(s) ||
        r.buyer?.full_name?.toLowerCase().includes(s) ||
        r.employees?.full_name?.toLowerCase().includes(s))
    }
    setSales(rows)

    // Load returns for bulk tab
    if (activeTab === 'bulk') {
      let rq = supabase.from('bulk_returns')
        .select('*,employees(id,full_name)')
        .order('return_date', { ascending: false })
      if (!isAdmin && employeeId) rq = rq.eq('employee_id', employeeId)
      const { data: ret } = await rq
      setReturns(ret ?? [])
    }

    setLoading(false)
  }, [filter, activeTab, isRider, employeeId, roleLoading])

  useEffect(() => { load() }, [load])

  // Fetch rider's available bags (bulk received minus retail sold)
  useEffect(() => {
    if (!isRider || !employeeId) return
    const fetchRiderBags = async () => {
      const [{ data: bulkIn }, { data: retailOut }, { data: riderRet }] = await Promise.all([
        supabase.from('sales').select('bags_sold')
          .eq('sale_type', 'bulk').eq('buyer_employee_id', employeeId),
        supabase.from('sales').select('bags_sold')
          .eq('sale_type', 'retail').eq('salesperson_id', employeeId),
        supabase.from('bulk_returns').select('bags_returned')
          .eq('employee_id', employeeId),
      ])
      const received = (bulkIn ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
      const sold     = (retailOut ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
      const returned = (riderRet ?? []).reduce((a: number, r: any) => a + r.bags_returned, 0)
      setRiderBags(received - sold - returned)
    }
    fetchRiderBags()
  }, [isRider, employeeId])

  useEffect(() => {
    // Riders (potential bulk buyers)
    supabase.from('employees').select('id,full_name,employee_type,team_role')
      .eq('status', 'active').order('full_name')
      .then(({ data }) => {
        const all = data ?? []
        setEmployees(all)
        setRiders(all.filter((e: any) =>
          e.employee_type === 'rider' ||
          e.team_role === 'rider' ||
          e.role?.toLowerCase().includes('rider') ||
          e.role?.toLowerCase().includes('sales')))
      })
  }, [])

  // ── Save retail sale ───────────────────────────────────────────────────────
  const saveRetailSale = async () => {
    const bags  = parseInt(retailForm.bags_sold) || 0
    const price = parseFloat(retailForm.unit_price) || 0
    const paid  = parseFloat(retailForm.amount_paid) || 0
    const proto = parseInt(retailForm.protocol_bags) || 0
    const total = bags * price
    const bal   = Math.max(0, total - paid)
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    if (!editSale) {
      // For riders: check their personal bag balance
      if (isRider && employeeId) {
        const [{ data: bulkIn }, { data: retailOut }, { data: riderRet2 }] = await Promise.all([
          supabase.from('sales').select('bags_sold')
            .eq('sale_type','bulk').eq('buyer_employee_id', employeeId),
          supabase.from('sales').select('bags_sold')
            .eq('sale_type','retail').eq('salesperson_id', employeeId),
          supabase.from('bulk_returns').select('bags_returned')
            .eq('employee_id', employeeId),
        ])
        const received = (bulkIn ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
        const sold     = (retailOut ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
        const returned2 = (riderRet2 ?? []).reduce((a: number, r: any) => a + r.bags_returned, 0)
        const available = received - sold - returned2
        setRiderBags(available)
        if (bags + proto > available) {
          alert(`Insufficient bags!\n\nYou have ${available} bag(s) available.\nYou are trying to sell ${bags + proto} bag(s).\n\nContact your manager for a bulk top-up.`)
          return
        }
      } else {
        // For admin/manager: check factory stock
        const { data: fi } = await supabase.from('finished_inventory').select('bags_in,bags_out')
        const stock = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
        if (bags + proto > stock) {
          alert('Insufficient stock! Available: ' + stock + ' bags'); return
        }
      }
    }

    // Resolve walk-in customer
    let customerId: number
    if (retailForm.customer_id === 'walk-in' || !retailForm.customer_id) {
      const { data: wi } = await supabase.from('customers').select('id').eq('name','Walk-in Customer').single()
      if (wi) { customerId = wi.id }
      else {
        const { data: wic } = await supabase.from('customers')
          .insert({ name: 'Walk-in Customer' }).select().single()
        customerId = wic?.id ?? 1
      }
    } else {
      customerId = parseInt(retailForm.customer_id)
    }

    // Non-rider: can assign any rep. Rider: always self
    const spId = isRider ? employeeId
      : (retailForm.salesperson_id ? parseInt(retailForm.salesperson_id) : null)

    const payload: any = {
      sale_date: retailForm.sale_date, customer_id: customerId,
      salesperson_id: spId, sale_type: 'retail',
      bags_sold: bags, unit_price: price, total_amount: total,
      amount_paid: paid, outstanding_balance: bal,
      payment_status: status,
      protocol_bags: proto, notes: retailForm.notes,
    }

    if (editSale) {
      await supabase.from('sales').update(payload).eq('id', editSale.id)
      await supabase.from('finished_inventory').delete().eq('sale_id', editSale.id)
    } else {
      const { data: ns } = await supabase.from('sales').insert(payload).select().single()
      if (ns) payload._id = ns.id
    }
    await supabase.from('finished_inventory').insert({
      bags_in: 0, bags_out: bags + proto,
      transaction_date: retailForm.sale_date,
      reference_type: 'sale',
      sale_id: editSale?.id ?? payload._id,
      notes: `Retail sale to ${customerId}`,
    })
    setShowForm(false); load()
  }

  // ── Save bulk sale (factory → rider) ──────────────────────────────────────
  const saveBulkSale = async () => {
    const bags  = parseInt(bulkForm.bags_sold) || 0
    const price = parseFloat(bulkForm.unit_price) || 0
    const paid  = parseFloat(bulkForm.amount_paid) || 0
    const total = bags * price
    const bal   = Math.max(0, total - paid)
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    if (!editSale) {
      const { data: fi } = await supabase.from('finished_inventory').select('bags_in,bags_out')
      const stock = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
      if (bags > stock) {
        alert('Insufficient stock! Available: ' + stock + ' bags'); return
      }
    }

    // For bulk: use a special "Riders/Sales Reps" customer bucket
    // OR use the rider's employee record as the "customer"
    const riderId = parseInt(bulkForm.buyer_employee_id)
    const rider   = riders.find((r: any) => r.id === riderId)

    // Get or create customer record for this rider
    let custId: number
    const riderCustName = rider ? `[Rider] ${rider.full_name}` : 'Bulk Sale'
    const { data: existCust } = await supabase.from('customers')
      .select('id').eq('name', riderCustName).single()
    if (existCust) {
      custId = existCust.id
    } else {
      const { data: newCust } = await supabase.from('customers')
        .insert({ name: riderCustName, address: 'Internal — Rider/Sales Rep' }).select().single()
      custId = newCust?.id ?? 1
    }

    const payload: any = {
      sale_date: bulkForm.sale_date,
      customer_id: custId,
      buyer_employee_id: riderId || null,
      salesperson_id: employeeId,
      sale_type: 'bulk',
      bags_sold: bags, unit_price: price, total_amount: total,
      amount_paid: paid, outstanding_balance: bal,
      payment_status: status, notes: bulkForm.notes,
    }

    if (editSale) {
      await supabase.from('sales').update(payload).eq('id', editSale.id)
      await supabase.from('finished_inventory').delete().eq('sale_id', editSale.id)
    } else {
      const { data: ns } = await supabase.from('sales').insert(payload).select().single()
      if (ns) payload._id = ns.id
    }
    await supabase.from('finished_inventory').insert({
      bags_in: 0, bags_out: bags,
      transaction_date: bulkForm.sale_date, reference_type: 'sale',
      sale_id: editSale?.id ?? payload._id,
      notes: `Bulk dispatch to ${rider?.full_name ?? 'Rider'}`,
    })
    setShowForm(false); load()
  }

  const saveReturn = async () => {
    if (!returnTarget) return
    setSavingReturn(true)

    const bagsBack   = parseInt(returnForm.bags_returned) || 0
    const unitPrice  = parseFloat(returnTarget.unit_price) || 0
    const credit     = bagsBack * unitPrice

    if (bagsBack <= 0) { alert('Enter a valid number of bags.'); setSavingReturn(false); return }
    if (bagsBack > returnTarget.bags_sold) {
      alert(`Cannot return more than dispatched. Max: ${returnTarget.bags_sold} bags.`)
      setSavingReturn(false); return
    }

    // 1. Record the return
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('bulk_returns').insert({
      return_date:       returnForm.return_date || returnTarget.sale_date,
      original_sale_id:  returnTarget.id,
      employee_id:       returnTarget.buyer_employee_id,
      bags_returned:     bagsBack,
      unit_price:        unitPrice,
      total_credit:      credit,
      notes:             returnForm.notes || null,
      recorded_by:       session?.user.id ?? null,
    })

    // 2. Update the original bulk sale — reduce outstanding by credit amount
    const newOutstanding = Math.max(0, returnTarget.outstanding_balance - credit)
    const newPaid        = returnTarget.amount_paid + credit
    const newStatus      = newOutstanding <= 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid'
    await supabase.from('sales').update({
      outstanding_balance: newOutstanding,
      amount_paid:         newPaid,
      payment_status:      newStatus,
      notes:               (returnTarget.notes ? returnTarget.notes + ' | ' : '') +
                           `Return: ${bagsBack} bags on ${returnForm.return_date}`,
    }).eq('id', returnTarget.id)

    // 3. Add bags back to factory finished stock
    await supabase.from('finished_inventory').insert({
      bags_in:          bagsBack,
      bags_out:         0,
      transaction_date: returnForm.return_date || returnTarget.sale_date,
      reference_type:   'adjustment',
      notes:            `Return from ${returnTarget.buyer?.full_name ?? 'rider'} — ${bagsBack} bags`,
    })

    setSavingReturn(false)
    setShowReturnForm(false)
    setReturnTarget(null)
    setReturnForm({ return_date: '', bags_returned: '', notes: '' })
    load()
  }

  const deleteReturn = async (r: any) => {
    if (!confirm('Delete this return record?\nNote: this will NOT reverse the stock or debt adjustments.')) return
    await supabase.from('bulk_returns').delete().eq('id', r.id)
    load()
  }

  const deleteSale = async (s: any) => {
    if (!confirm('Delete Sale #' + s.id + '?')) return
    await supabase.from('payments').delete().eq('sale_id', s.id)
    await supabase.from('finished_inventory').delete().eq('sale_id', s.id)
    await supabase.from('sales').delete().eq('id', s.id)
    load()
  }

  const totals = sales.reduce((a: any, s: any) => ({
    bags: a.bags + s.bags_sold, revenue: a.revenue + s.total_amount,
    collected: a.collected + s.amount_paid, outstanding: a.outstanding + s.outstanding_balance
  }), { bags: 0, revenue: 0, collected: 0, outstanding: 0 })

  const retailTotal = parseFloat(retailForm.bags_sold||'0') * parseFloat(retailForm.unit_price||'0')
  const retailBal   = Math.max(0, retailTotal - parseFloat(retailForm.amount_paid||'0'))
  const bulkTotal   = parseFloat(bulkForm.bags_sold||'0') * parseFloat(bulkForm.unit_price||'0')
  const bulkBal     = Math.max(0, bulkTotal - parseFloat(bulkForm.amount_paid||'0'))

  return (
    <AppLayout>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">💼 Sales</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            {isAdmin
              ? 'Admin — all transactions visible'
              : isRider
              ? 'Your retail sales only'
              : 'Factory manager view'}
          </div>
        </div>
        <div className="flex gap-2">
          {/* Riders can only do retail */}
          {!isRider && (isAdmin || isFactoryManager) && (
            <button onClick={() => {
              setFormType('bulk')
              setBulkForm(blankBulk())
              setEditSale(null)
              setShowForm(true)
            }} className="btn btn-warning">
              📦 Bulk Dispatch
            </button>
          )}
          <button onClick={() => {
            if (isRider && riderBags !== null && riderBags <= 0) {
              alert('You have no bags available to sell.\nContact your manager for a bulk dispatch first.')
              return
            }
            setFormType('retail')
            setRetailForm(blankRetail())
            setEditSale(null)
            setShowForm(true)
          }}
          disabled={isRider && riderBags !== null && riderBags <= 0}
          className="btn btn-primary">
            + Retail Sale
          </button>
        </div>
      </div>

      {/* ── Tab bar — hide bulk tab for riders ───────────────────────── */}
      <div className="flex border-b border-gray-200 mb-4">
        <button onClick={() => setActiveTab('retail')}
          className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
            + (activeTab === 'retail'
              ? 'border-[#1F4E79] text-[#1F4E79]'
              : 'border-transparent text-gray-500 hover:text-gray-700')}>
          🛍️ Retail Sales
          <span className="ml-2 text-xs text-gray-400">(to customers)</span>
        </button>
        {!isRider && (isAdmin || isFactoryManager) && (
          <button onClick={() => setActiveTab('bulk')}
            className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
              + (activeTab === 'bulk'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700')}>
            📦 Bulk Dispatches
            <span className="ml-2 text-xs text-gray-400">(to riders)</span>
          </button>
        )}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div><label className="form-label">From</label>
          <input type="date" value={filter.from}
            onChange={e => setFilter(f => ({...f, from: e.target.value}))}
            className="form-input w-36" /></div>
        <div><label className="form-label">To</label>
          <input type="date" value={filter.to}
            onChange={e => setFilter(f => ({...f, to: e.target.value}))}
            className="form-input w-36" /></div>
        <div><label className="form-label">Status</label>
          <select value={filter.status}
            onChange={e => setFilter(f => ({...f, status: e.target.value}))}
            className="form-select w-28">
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select></div>
        <div><label className="form-label">Search</label>
          <input value={filter.search}
            onChange={e => setFilter(f => ({...f, search: e.target.value}))}
            placeholder={activeTab === 'retail' ? 'Customer...' : 'Rider...'}
            className="form-input w-36" /></div>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ['Revenue',     fmtGhc(totals.revenue),     '#1F4E79'],
          ['Bags',        fmtNum(totals.bags),         '#2E75B6'],
          ['Collected',   fmtGhc(totals.collected),   '#1B5E20'],
          ['Outstanding', fmtGhc(totals.outstanding), '#C00000'],
        ].map(([l, v, c]) => (
          <div key={l as string} className="stat-card" style={{ borderLeftColor: c as string }}>
            <div className="text-xs text-gray-500">{l}</div>
            <div className="font-bold" style={{ color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── Rider bag balance warning ─────────────────────────────────── */}
      {isRider && riderBags !== null && (
        <div className={'card mb-4 border-l-4 flex items-center gap-4 '
          + (riderBags > 20 ? 'border-green-500 bg-green-50'
          : riderBags > 0  ? 'border-orange-400 bg-orange-50'
          : 'border-red-500 bg-red-50')}>
          <div className={'text-4xl font-bold tabular-nums '
            + (riderBags > 20 ? 'text-green-700' : riderBags > 0 ? 'text-orange-600' : 'text-red-700')}>
            {fmtNum(riderBags)}
          </div>
          <div>
            <div className={'font-semibold '
              + (riderBags > 20 ? 'text-green-700' : riderBags > 0 ? 'text-orange-600' : 'text-red-700')}>
              {riderBags > 20 ? '✅ Bags Available' : riderBags > 0 ? '⚠️ Running Low' : '❌ No Bags Available'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {riderBags > 0
                ? `You have ${riderBags} bag${riderBags !== 1 ? 's' : ''} on hand to sell`
                : 'Contact your manager for a bulk dispatch before recording sales'}
            </div>
          </div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          {activeTab === 'retail' ? (
            /* RETAIL TABLE */
            <table className="data-table">
              <colgroup>
                <col style={{width:'90px'}} /><col />
                {isAdmin && <col style={{width:'120px'}} />}
                <col style={{width:'70px'}} /><col style={{width:'105px'}} />
                <col style={{width:'100px'}} /><col style={{width:'100px'}} />
                <col style={{width:'72px'}} /><col style={{width:'120px'}} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th><th>Customer</th>
                  {isAdmin && <th>Rep</th>}
                  <th className="right">Bags</th>
                  <th className="right">Total</th>
                  <th className="right">Paid</th>
                  <th className="right">Balance</th>
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading || roleLoading
                  ? <tr><td colSpan={isAdmin ? 9 : 8} className="text-center py-8 text-gray-400">Loading...</td></tr>
                  : sales.length === 0
                  ? <tr><td colSpan={isAdmin ? 9 : 8} className="text-center py-8 text-gray-400">No retail sales found</td></tr>
                  : sales.map((s: any) => (
                  <tr key={s.id}>
                    <td className="muted">{s.sale_date}</td>
                    <td className="font-medium">{s.customers?.name}</td>
                    {isAdmin && <td className="muted">{s.employees?.full_name ?? '—'}</td>}
                    <td className="num">{fmtNum(s.bags_sold)}</td>
                    <td className="num">{fmtGhc(s.total_amount)}</td>
                    <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                    <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                    <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => {
                          setEditSale(s); setFormType('retail')
                          setRetailForm({ sale_date:s.sale_date, customer_id:String(s.customer_id), salesperson_id:String(s.salesperson_id??''), bags_sold:String(s.bags_sold), unit_price:String(s.unit_price), amount_paid:String(s.amount_paid), protocol_bags:String(s.protocol_bags??0), notes:s.notes??'' })
                          setShowForm(true)
                        }} className="btn btn-sm btn-secondary">Edit</button>
                        <button onClick={() => deleteSale(s)} className="btn btn-sm btn-danger">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* BULK TABLE */
            <table className="data-table">
              <colgroup>
                <col style={{width:'90px'}} /><col />
                <col style={{width:'120px'}} /><col style={{width:'70px'}} />
                <col style={{width:'105px'}} /><col style={{width:'100px'}} />
                <col style={{width:'100px'}} /><col style={{width:'72px'}} />
                <col style={{width:'120px'}} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th><th>Rider / Sales Rep</th>
                  <th>Dispatched By</th>
                  <th className="right">Bags</th>
                  <th className="right">Total</th>
                  <th className="right">Paid</th>
                  <th className="right">Balance</th>
                  <th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading || roleLoading
                  ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td></tr>
                  : sales.length === 0
                  ? <tr><td colSpan={9} className="text-center py-8 text-gray-400">No bulk dispatches found</td></tr>
                  : sales.map((s: any) => (
                  <tr key={s.id}>
                    <td className="muted">{s.sale_date}</td>
                    <td className="font-medium">{s.buyer?.full_name ?? s.customers?.name ?? '—'}</td>
                    <td className="muted">{s.employees?.full_name ?? 'Factory'}</td>
                    <td className="num">{fmtNum(s.bags_sold)}</td>
                    <td className="num">{fmtGhc(s.total_amount)}</td>
                    <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                    <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                    <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => {
                          setEditSale(s); setFormType('bulk')
                          setBulkForm({ sale_date:s.sale_date, buyer_employee_id:String(s.buyer_employee_id??''), bags_sold:String(s.bags_sold), unit_price:String(s.unit_price), amount_paid:String(s.amount_paid), notes:s.notes??'' })
                          setShowForm(true)
                        }} className="btn btn-sm btn-secondary">Edit</button>
                        <button onClick={() => {
                          setReturnTarget({ ...s, buyer: s.buyer })
                          setReturnForm({ return_date: today(), bags_returned: '', notes: '' })
                          setShowReturnForm(true)
                        }} className="btn btn-sm btn-warning">↩ Return</button>
                        <button onClick={() => deleteSale(s)} className="btn btn-sm btn-danger">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── RETAIL SALE FORM ──────────────────────────────────────────── */}
      {showForm && formType === 'retail' && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-[#1F4E79]">
                  {editSale ? 'Edit Retail Sale' : '🛍️ New Retail Sale'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Sale to end customer</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={retailForm.sale_date}
                    onChange={e => setRetailForm(f => ({...f, sale_date:e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit Price (GHc)</label>
                  <input type="number" step="0.01" value={retailForm.unit_price}
                    onChange={e => setRetailForm(f => ({...f, unit_price:e.target.value}))}
                    className="form-input" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Customer *</label>
                <CustomerSelect value={retailForm.customer_id}
                  onChange={id => setRetailForm(f => ({...f, customer_id:id}))} />
              </div>
              {/* Admin/Manager can assign a rep; riders always self */}
              {!isRider && (isAdmin || isFactoryManager) && (
                <div className="form-group">
                  <label className="form-label">Sales Rep</label>
                  <select value={retailForm.salesperson_id}
                    onChange={e => setRetailForm(f => ({...f, salesperson_id:e.target.value}))}
                    className="form-select">
                    <option value="">None / Direct</option>
                    {employees.map((e: any) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </div>
              )}
              {isRider && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                  Sales Rep: <strong>{employeeName}</strong> (you)
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Bags Sold *</label>
                  <input type="number" value={retailForm.bags_sold}
                    onChange={e => setRetailForm(f => ({...f, bags_sold:e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Protocol Bags</label>
                  <input type="number" value={retailForm.protocol_bags}
                    onChange={e => setRetailForm(f => ({...f, protocol_bags:e.target.value}))}
                    className="form-input" />
                </div>
              </div>
              {retailTotal > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-xs text-gray-500">Total</div><div className="font-bold text-[#1F4E79]">{fmtGhc(retailTotal)}</div></div>
                  <div><div className="text-xs text-gray-500">Balance</div><div className="font-bold text-red-600">{fmtGhc(retailBal)}</div></div>
                  <div><div className="text-xs text-gray-500">Status</div><div className="font-bold">{parseFloat(retailForm.amount_paid||'0')>=retailTotal?'Paid':parseFloat(retailForm.amount_paid||'0')>0?'Partial':'Unpaid'}</div></div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Amount Paid (GHc)</label>
                <input type="number" step="0.01" value={retailForm.amount_paid}
                  onChange={e => setRetailForm(f => ({...f, amount_paid:e.target.value}))}
                  className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={retailForm.notes} rows={2}
                  onChange={e => setRetailForm(f => ({...f, notes:e.target.value}))}
                  className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveRetailSale}
                disabled={!retailForm.bags_sold || !retailForm.unit_price}
                className="btn btn-primary">💾 Save Sale</button>
            </div>
          </div>
        </div>
      )}

      {/* ── BULK DISPATCH FORM ────────────────────────────────────────── */}
      {showForm && formType === 'bulk' && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-orange-700">
                  {editSale ? 'Edit Bulk Dispatch' : '📦 Bulk Dispatch to Rider'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Factory → Rider / Sales Rep</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-700">
                📦 This records bags dispatched from the factory to a Rider or Sales Rep in bulk.
                The rider will then sell individually to customers.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={bulkForm.sale_date}
                    onChange={e => setBulkForm(f => ({...f, sale_date:e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Rider / Sales Rep *</label>
                  <select value={bulkForm.buyer_employee_id}
                    onChange={e => setBulkForm(f => ({...f, buyer_employee_id:e.target.value}))}
                    className="form-select">
                    <option value="">Select rider...</option>
                    {(riders.length > 0 ? riders : employees).map((e: any) => (
                      <option key={e.id} value={e.id}>{e.full_name} ({e.role})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Bags Dispatched *</label>
                  <input type="number" value={bulkForm.bags_sold}
                    onChange={e => setBulkForm(f => ({...f, bags_sold:e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Price per Bag (GHc) *</label>
                  <input type="number" step="0.01" value={bulkForm.unit_price}
                    onChange={e => setBulkForm(f => ({...f, unit_price:e.target.value}))}
                    className="form-input" placeholder="Bulk/wholesale price" />
                </div>
              </div>
              {bulkTotal > 0 && (
                <div className="bg-orange-50 rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-xs text-gray-500">Total</div><div className="font-bold text-orange-700">{fmtGhc(bulkTotal)}</div></div>
                  <div><div className="text-xs text-gray-500">Balance</div><div className="font-bold text-red-600">{fmtGhc(bulkBal)}</div></div>
                  <div><div className="text-xs text-gray-500">Status</div><div className="font-bold">{parseFloat(bulkForm.amount_paid||'0')>=bulkTotal?'Paid':parseFloat(bulkForm.amount_paid||'0')>0?'Partial':'Unpaid'}</div></div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Amount Paid / Deposit (GHc)</label>
                <input type="number" step="0.01" value={bulkForm.amount_paid}
                  onChange={e => setBulkForm(f => ({...f, amount_paid:e.target.value}))}
                  className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={bulkForm.notes} rows={2}
                  onChange={e => setBulkForm(f => ({...f, notes:e.target.value}))}
                  className="form-input" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveBulkSale}
                disabled={!bulkForm.bags_sold || !bulkForm.unit_price || !bulkForm.buyer_employee_id}
                className="btn btn-warning">📦 Record Dispatch</button>
            </div>
          </div>
        </div>
      )}
      {/* RETURN MODAL */}
      {showReturnForm && returnTarget && (
        <div className="modal-overlay" onClick={() => { setShowReturnForm(false) }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-orange-700">Return Bags</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Rider returns unsold bags to factory
                </p>
              </div>
              <button onClick={() => setShowReturnForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="text-xs font-semibold text-orange-700 mb-2">Original Dispatch</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-gray-500">Dispatched</div>
                    <div className="font-bold text-[#1F4E79]">{fmtNum(returnTarget.bags_sold)} bags</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Unit Price</div>
                    <div className="font-bold">{fmtGhc(returnTarget.unit_price)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Still Owed</div>
                    <div className="font-bold text-red-600">{fmtGhc(returnTarget.outstanding_balance)}</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Return Date</label>
                  <input type="date" value={returnForm.return_date}
                    onChange={e => setReturnForm(f => ({...f, return_date: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Bags Returned *</label>
                  <input type="number" value={returnForm.bags_returned}
                    onChange={e => setReturnForm(f => ({...f, bags_returned: e.target.value}))}
                    className="form-input text-xl font-bold text-center"
                    placeholder="0" />
                </div>
              </div>
              {parseInt(returnForm.bags_returned || '0') > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <div className="text-sm font-medium text-green-700 mb-1">
                    Credit: {fmtGhc(parseInt(returnForm.bags_returned) * parseFloat(returnTarget.unit_price || '0'))}
                  </div>
                  <div className="text-xs text-gray-500">
                    New balance: {fmtGhc(Math.max(0, returnTarget.outstanding_balance -
                      (parseInt(returnForm.bags_returned) * parseFloat(returnTarget.unit_price || '0'))))}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    Bags will be added back to factory stock
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={returnForm.notes} rows={2}
                  onChange={e => setReturnForm(f => ({...f, notes: e.target.value}))}
                  className="form-input" placeholder="Reason for return..." />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowReturnForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveReturn}
                disabled={savingReturn || !returnForm.bags_returned || parseInt(returnForm.bags_returned) <= 0}
                className="btn btn-warning">
                {savingReturn ? 'Saving...' : 'Record Return'}
              </button>
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
