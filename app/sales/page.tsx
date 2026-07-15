'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import CustomerSelect from '@/components/ui/CustomerSelect'
import { supabase, fmtGhc, fmtNum, today, monthStart, fmtDate} from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'
import { offlineSave } from '@/lib/offlineSave'
import { useOfflineSync } from '@/hooks/useOfflineSync'

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
          employeeId, employeeName, userId, loading: roleLoading } = useRole()
  const { isOnline, queued, syncNow: doSync } = useOfflineSync(userId ?? undefined)

  const [sales, setSales]         = useState<any[]>([])
  const [riders, setRiders]       = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<'bulk'>('bulk')
  const [riderBags, setRiderBags]   = useState<number | null>(null)
  const [factoryStock, setFactoryStock] = useState<number | null>(null)
  const [returns, setReturns]         = useState<any[]>([])
  const [showReturnForm, setShowReturnForm] = useState(false)
  const [returnTarget, setReturnTarget]     = useState<any>(null)  // the bulk sale being returned
  const [returnForm, setReturnForm]         = useState({ return_date: '', bags_returned: '', notes: '' })
  const [savingReturn, setSavingReturn]     = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [formType, setFormType]   = useState<'bulk'>('bulk')
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
    teammate_employee_id: '',
    buyer_type: 'rider',          // 'rider' | 'external'
    external_customer_id: '',     // for external bulk customers
    bags_sold: '', unit_price: '', amount_paid: '', notes: '',
    is_overtime: false,
  })
  // retailForm removed — retail sales disabled
  const [bulkForm, setBulkForm]     = useState(blankBulk())

  // ── Load sales ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (roleLoading) return
    setLoading(true)

    const saleType = activeTab

    let q = supabase.from('sales')
      .select('*,customers(id,name),employees!salesperson_id(id,full_name),buyer:employees!buyer_employee_id(id,full_name)')
      .eq('sale_type', saleType)
      .or('is_archived.is.null,is_archived.eq.false')
      .gte('sale_date', filter.from)
      .lte('sale_date', filter.to)
      .order('sale_date', { ascending: false })

    // Riders: filter to their own sales only
    // If employeeId is null (not linked), return empty — admin must link employee in Settings
    if (isRider) {
      if (!employeeId) {
        setSales([]); setLoading(false); return
      }
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

    // Always fetch factory stock — visible to all roles as a dispatch alert
    supabase.from('finished_inventory').select('bags_in,bags_out')
      .or('is_archived.is.null,is_archived.eq.false')
      .then(({ data: fi }) => {
        const stock = (fi ?? []).reduce((a: number, r: any) => a + (r.bags_in||0) - (r.bags_out||0), 0)
        setFactoryStock(stock)
      })
  }, [filter, activeTab, isRider, employeeId, roleLoading])

  useEffect(() => { load() }, [load])

  // Fetch rider's own bag balance (bulk received minus retail sold minus returned)
  useEffect(() => {
    if (!isRider || !employeeId) return
    const fetchRiderBags = async () => {
      const [{ data: bulkIn }, { data: retailOut }, { data: riderRet }] = await Promise.all([
        supabase.from('sales').select('bags_sold')
          .eq('sale_type', 'bulk').or('is_archived.is.null,is_archived.eq.false').eq('buyer_employee_id', employeeId),
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

  // Retail sales removed

    // ── Save bulk sale (factory → rider) ──────────────────────────────────────
  const saveBulkSale = async () => {
    const bags  = parseInt(bulkForm.bags_sold) || 0
    const price = parseFloat(bulkForm.unit_price) || 0
    const paid  = parseFloat(bulkForm.amount_paid) || 0
    const total = bags * price
    const bal   = Math.max(0, total - paid)
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'

    // Stock check — always verify, even on edits (re-check against current stock)
    // Must exclude archived entries so we only count live post-archive stock
    const { data: fi } = await supabase.from('finished_inventory').select('bags_in,bags_out')
      .or('is_archived.is.null,is_archived.eq.false')
    const currentStock = (fi ?? []).reduce((a: number, r: any) => a + (r.bags_in||0) - (r.bags_out||0), 0)
    // For edits, add back the bags from the original dispatch so we compare fairly
    const stockAvailable = editSale ? currentStock + (parseInt(String(editSale.bags_sold)) || 0) : currentStock
    if (bags > stockAvailable) {
      alert(
        `🚫 Insufficient stock!\n\n` +
        `Available: ${stockAvailable} bags\n` +
        `Requested: ${bags} bags\n\n` +
        `Record a production batch first before dispatching.`
      )
      return
    }

    let custId: number
    let riderId: number | null = null

    if (bulkForm.buyer_type === 'external') {
      // Handle walk-in customer
      if (!bulkForm.external_customer_id || bulkForm.external_customer_id === 'walk-in') {
        const { data: wi } = await supabase.from('customers').select('id').eq('name','Walk-in Customer').single()
        if (wi) {
          custId = wi.id
        } else {
          const { data: newWi } = await supabase.from('customers')
            .insert({ name: 'Walk-in Customer' }).select().single()
          custId = newWi?.id ?? 1
        }
      } else {
        custId = parseInt(bulkForm.external_customer_id)
        if (!custId) { alert('Please select or add the external customer.'); return }
      }
    } else {
      // Internal rider/employee buyer
      riderId = parseInt(bulkForm.buyer_employee_id) || null
      const rider = riders.find((r: any) => r.id === riderId)
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
    }

    const payload: any = {
      sale_date: bulkForm.sale_date,
      customer_id: custId,
      buyer_employee_id: riderId || null,
      teammate_employee_id: bulkForm.buyer_type === 'rider' && bulkForm.teammate_employee_id
        ? parseInt(bulkForm.teammate_employee_id) : null,
      salesperson_id: employeeId,
      sale_type: 'bulk',
      bags_sold: bags, unit_price: price, total_amount: total,
      amount_paid: paid, outstanding_balance: bal,
      payment_status: status, notes: bulkForm.notes,
      is_overtime: bulkForm.is_overtime ?? false,
    }

    let saleId: number | undefined
    if (editSale) {
      await supabase.from('sales').update(payload).eq('id', editSale.id)
      await supabase.from('finished_inventory').delete().eq('sale_id', editSale.id)
      saleId = editSale.id
    } else {
      const { data: ns, error: nsErr } = await supabase.from('sales').insert(payload).select().single()
      if (nsErr || !ns) {
        alert(`Sale failed to save: ${nsErr?.message ?? 'Unknown error'}`)
        return
      }
      saleId = ns.id
    }
    if (!saleId) {
      alert('Sale saved but could not get sale ID — stock ledger not updated. Please contact admin.')
      return
    }
    const dispatchName = bulkForm.buyer_type === 'external'
      ? 'External Customer'
      : (riders.find((r:any) => r.id === riderId)?.full_name ?? 'Rider')
    const { error: fiErr } = await supabase.from('finished_inventory').insert({
      bags_in: 0, bags_out: bags,
      transaction_date: bulkForm.sale_date, reference_type: 'sale',
      sale_id: saleId,
      notes: `Bulk dispatch to ${dispatchName}`,
    })
    if (fiErr) {
      alert(`Sale saved but stock ledger failed to update: ${fiErr.message}\nPlease notify admin to fix manually.`)
    }
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
                           `Return: ${bagsBack} bags on ${fmtDate(returnForm.return_date)}`,
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
    const { error } = await supabase.from('bulk_returns').delete().eq('id', r.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  const deleteSale = async (s: any) => {
    if (!confirm('Delete Sale #' + s.id + '?')) return
    await supabase.from('payments').delete().eq('sale_id', s.id)
    await supabase.from('finished_inventory').delete().eq('sale_id', s.id)
    const { error } = await supabase.from('sales').delete().eq('id', s.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    load()
  }

  const totals = sales.reduce((a: any, s: any) => ({
    bags: a.bags + s.bags_sold, revenue: a.revenue + s.total_amount,
    collected: a.collected + s.amount_paid, outstanding: a.outstanding + s.outstanding_balance
  }), { bags: 0, revenue: 0, collected: 0, outstanding: 0 })

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
              ? 'Admin — all bulk dispatches visible'
              : isRider
              ? 'Bulk dispatches — your deliveries'
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

        </div>
      </div>

      {/* ── Unlinked employee warning ───────────────────────────────── */}
      {isRider && !employeeId && !roleLoading && (
        <div className="card mb-4 border-l-4 border-orange-400 bg-orange-50">
          <div className="font-semibold text-orange-700 mb-1">
            ⚠️ Account not linked to an employee record
          </div>
          <div className="text-sm text-gray-600">
            Your sales data cannot load because your user account is not linked
            to an employee record yet. Please contact your administrator.
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Admin: go to <strong>Settings → Users → Link Employee</strong> for this account.
          </div>
        </div>
      )}

      {/* ── Bulk Dispatch only — retail removed ─────────────────────── */}

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
            placeholder='Rider...'
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

      {/* ── Factory stock balance — visible to all roles ─────────────────── */}
      {factoryStock !== null && (
        <div className={
          'rounded-2xl mb-4 px-5 py-4 flex items-center justify-between gap-4 shadow-sm border '
          + (factoryStock > 100 ? 'bg-green-50 border-green-300'
           : factoryStock > 0   ? 'bg-amber-50 border-amber-400'
           : 'bg-red-50 border-red-400')
        }>
          <div className="flex items-center gap-4">
            <div className={
              'text-4xl font-black tabular-nums leading-none '
              + (factoryStock > 100 ? 'text-green-700'
               : factoryStock > 0   ? 'text-amber-700'
               : 'text-red-700')
            }>
              {fmtNum(factoryStock)}
            </div>
            <div>
              <div className={
                'text-sm font-bold uppercase tracking-wide '
                + (factoryStock > 100 ? 'text-green-700'
                 : factoryStock > 0   ? 'text-amber-700'
                 : 'text-red-700')
              }>
                {factoryStock > 100 ? '✅ Stock Available'
                 : factoryStock > 0  ? '⚠️ Low Stock — Dispatch with Caution'
                 : '🚫 No Stock — Dispatching is Blocked'}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {factoryStock > 0
                  ? `${fmtNum(factoryStock)} bag${factoryStock !== 1 ? 's' : ''} currently available for dispatch`
                  : 'Zero bags in stock — record a production batch before dispatching'}
              </div>
            </div>
          </div>
          <div className={
            'text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap '
            + (factoryStock > 100 ? 'bg-green-200 text-green-800'
             : factoryStock > 0   ? 'bg-amber-200 text-amber-800'
             : 'bg-red-200 text-red-800')
          }>
            {factoryStock > 100 ? 'GOOD' : factoryStock > 0 ? 'LOW' : 'EMPTY'}
          </div>
        </div>
      )}

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
            <table className="data-table">
              <colgroup>
                <col style={{width:'90px'}} /><col style={{width:'150px'}} />
                <col style={{width:'120px'}} /><col style={{width:'70px'}} />
                <col style={{width:'105px'}} /><col style={{width:'90px'}} />
                <col style={{width:'90px'}} /><col style={{width:'72px'}} />
                <col style={{width:'175px'}} />
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
                    <td className="muted">{fmtDate(s.sale_date)}</td>
                    <td className="font-medium">{s.buyer?.full_name ?? s.customers?.name ?? '—'}</td>
                    <td className="muted">{s.employees?.full_name ?? 'Factory'}</td>
                    <td className="num">
                      {fmtNum(s.bags_sold)}
                      {s.is_overtime && <span className="badge badge-yellow ml-1" style={{fontSize:'9px'}}>OT</span>}
                    </td>
                    <td className="num">{fmtGhc(s.total_amount)}</td>
                    <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                    <td className="num-red">{fmtGhc(s.outstanding_balance)}</td>
                    <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    <td>
                      <div className="flex gap-1 flex-nowrap">
                        <button onClick={() => {
                          setEditSale(s); setFormType('bulk')
                          setBulkForm({ sale_date:s.sale_date, buyer_employee_id:String(s.buyer_employee_id??''), teammate_employee_id:String(s.teammate_employee_id??''), buyer_type: s.buyer_employee_id ? 'rider' : 'external', external_customer_id: s.buyer_employee_id ? '' : String(s.customer_id??''), bags_sold:String(s.bags_sold), unit_price:String(s.unit_price), amount_paid:String(s.amount_paid), notes:s.notes??'', is_overtime: s.is_overtime ?? false })
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

        </div>
      </div>



      {/* ── BULK DISPATCH FORM ────────────────────────────────────────── */}
      {showForm && formType === 'bulk' && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-orange-700">
                  {editSale ? 'Edit Bulk Dispatch'
                    : bulkForm.buyer_type === 'external'
                    ? '🏪 Bulk Sale to External Customer'
                    : '📦 Bulk Dispatch to Rider'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {bulkForm.buyer_type === 'external'
                    ? 'Factory → Wholesale / External bulk customer'
                    : 'Factory → Rider / Sales Rep'}
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">
              {/* Buyer type toggle */}
              <div className="flex gap-2 mb-1">
                {[['rider','🛵 Rider / Sales Rep'],['external','🏪 External Bulk Customer']].map(([k,l]) => (
                  <button key={k} type="button"
                    onClick={() => setBulkForm(f => ({...f, buyer_type: k as 'rider'|'external'}))}
                    className={'flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-all '
                      + (bulkForm.buyer_type === k
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300')}>
                    {l}
                  </button>
                ))}
              </div>

              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" value={bulkForm.sale_date}
                  onChange={e => setBulkForm(f => ({...f, sale_date:e.target.value}))}
                  className="form-input" />
              </div>

              {/* Rider buyer fields */}
              {bulkForm.buyer_type === 'rider' && (
                <>
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
                  <div className="form-group">
                    <label className="form-label">Teammate / Rider's Mate
                      <span className="text-gray-400 font-normal ml-1">(optional)</span>
                    </label>
                    <select value={bulkForm.teammate_employee_id}
                      onChange={e => setBulkForm(f => ({...f, teammate_employee_id: e.target.value}))}
                      className="form-select">
                      <option value="">— No teammate —</option>
                      {(riders.length > 0 ? riders : employees)
                        .filter((e: any) => String(e.id) !== bulkForm.buyer_employee_id)
                        .map((e: any) => (
                          <option key={e.id} value={e.id}>{e.full_name} ({e.role})</option>
                        ))}
                    </select>
                    <div className="text-xs text-gray-400 mt-1">
                      Full bag count credits both for performance pay.
                    </div>
                  </div>
                </>
              )}

              {/* External bulk customer fields */}
              {bulkForm.buyer_type === 'external' && (
                <div className="form-group">
                  <label className="form-label">Bulk Customer *</label>
                  <CustomerSelect
                    value={bulkForm.external_customer_id}
                    onChange={(id) => setBulkForm(f => ({...f, external_customer_id: id}))}
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    Select an existing customer or add a new one.
                    Leave as <strong>Walk-in Customer</strong> for unregistered buyers.
                    External bulk sales are not linked to performance pay.
                  </div>
                </div>
              )}
              {/* Overtime toggle */}
              <div style={{
                background: bulkForm.is_overtime ? '#fff7ed' : '#f0fdf4',
                border: `1px solid ${bulkForm.is_overtime ? '#fed7aa' : '#bbf7d0'}`,
                borderRadius: '10px', padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{fontWeight:600, fontSize:'13px', color: bulkForm.is_overtime ? '#c2410c' : '#15803d'}}>
                    {bulkForm.is_overtime ? '🌙 Overtime Dispatch' : '☀️ Regular Dispatch'}
                  </div>
                  <div style={{fontSize:'11px', color:'#6b7280', marginTop:'2px'}}>
                    {bulkForm.is_overtime
                      ? 'Rate: GH₵5/bag · Excluded from performance pay'
                      : 'Rate: GH₵6/bag · Counts toward performance pay'}
                  </div>
                </div>
                <label style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer'}}>
                  <span style={{fontSize:'12px', color:'#6b7280'}}>Overtime</span>
                  <input type="checkbox" checked={bulkForm.is_overtime}
                    onChange={e => setBulkForm(f => ({
                      ...f,
                      is_overtime: e.target.checked,
                      unit_price: e.target.checked ? '5' : f.buyer_type === 'rider' ? '6' : f.unit_price
                    }))}
                    style={{width:'18px', height:'18px', cursor:'pointer'}} />
                </label>
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
                disabled={
                  !bulkForm.bags_sold || !bulkForm.unit_price ||
                  (bulkForm.buyer_type === 'rider' && !bulkForm.buyer_employee_id)
                }
                className="btn btn-warning">📦 Record Dispatch</button>
            </div>
          </div>
        </div>
      )}
      {/* RETURN MODAL — uses fixed positioning independently of CSS classes */}
      {showReturnForm && returnTarget && (
        <>
          {/* Backdrop */}
          <div
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowReturnForm(false)}
          />
          {/* Dialog */}
          <div style={{
            position:'fixed', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            width:'min(480px, 94vw)',
            maxHeight:'80vh',
            overflowY:'auto',
            background:'white',
            borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',
            zIndex:9999,
          }}>
            {/* Header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div>
                <div style={{fontWeight:'bold',color:'#c2410c',fontSize:'1rem'}}>Return Bags to Factory</div>
                <div style={{fontSize:'0.75rem',color:'#888',marginTop:'2px'}}>
                  {returnTarget.buyer?.full_name ?? 'Rider'} — dispatch on {fmtDate(returnTarget.sale_date)}
                </div>
              </div>
              <button onClick={() => setShowReturnForm(false)}
                style={{background:'none',border:'none',fontSize:'1.25rem',color:'#aaa',cursor:'pointer',lineHeight:1}}>
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'1rem'}}>

              {/* Summary */}
              <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:'0.75rem',padding:'0.75rem'}}>
                <div style={{fontSize:'0.7rem',fontWeight:'600',color:'#c2410c',marginBottom:'0.5rem',textTransform:'uppercase'}}>Original Dispatch</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.5rem',textAlign:'center'}}>
                  <div>
                    <div style={{fontSize:'0.7rem',color:'#666'}}>Bags Out</div>
                    <div style={{fontWeight:'bold',color:'#1F4E79'}}>{fmtNum(returnTarget.bags_sold)}</div>
                  </div>
                  <div>
                    <div style={{fontSize:'0.7rem',color:'#666'}}>Price/Bag</div>
                    <div style={{fontWeight:'bold'}}>{fmtGhc(returnTarget.unit_price)}</div>
                  </div>
                  <div>
                    <div style={{fontSize:'0.7rem',color:'#666'}}>Still Owed</div>
                    <div style={{fontWeight:'bold',color:'#dc2626'}}>{fmtGhc(returnTarget.outstanding_balance)}</div>
                  </div>
                </div>
              </div>

              {/* Inputs */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
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
                    className="form-input"
                    style={{textAlign:'center',fontSize:'1.25rem',fontWeight:'bold'}}
                    placeholder="0"
                    max={returnTarget.bags_sold} />
                </div>
              </div>

              {/* Credit preview */}
              {parseInt(returnForm.bags_returned || '0') > 0 && (() => {
                const bags   = parseInt(returnForm.bags_returned)
                const credit = bags * parseFloat(returnTarget.unit_price || '0')
                const newBal = Math.max(0, returnTarget.outstanding_balance - credit)
                return (
                  <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'0.75rem',padding:'0.75rem',textAlign:'center'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.5rem'}}>
                      <div>
                        <div style={{fontSize:'0.7rem',color:'#666'}}>Returning</div>
                        <div style={{fontWeight:'bold',color:'#c2410c'}}>{fmtNum(bags)} bags</div>
                      </div>
                      <div>
                        <div style={{fontSize:'0.7rem',color:'#666'}}>Credit</div>
                        <div style={{fontWeight:'bold',color:'#15803d'}}>{fmtGhc(credit)}</div>
                      </div>
                      <div>
                        <div style={{fontSize:'0.7rem',color:'#666'}}>New Balance</div>
                        <div style={{fontWeight:'bold',color:'#1F4E79'}}>{fmtGhc(newBal)}</div>
                      </div>
                    </div>
                    <div style={{fontSize:'0.7rem',color:'#16a34a',marginTop:'0.4rem'}}>
                      ✅ {fmtNum(bags)} bags returned to factory stock
                    </div>
                  </div>
                )
              })()}

              <div className="form-group">
                <label className="form-label">Notes (reason for return)</label>
                <textarea value={returnForm.notes} rows={2}
                  onChange={e => setReturnForm(f => ({...f, notes: e.target.value}))}
                  className="form-input"
                  placeholder="e.g. Unsold end of day, market closed..." />
              </div>
            </div>

            {/* Footer */}
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowReturnForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveReturn}
                disabled={savingReturn || !returnForm.bags_returned || parseInt(returnForm.bags_returned) <= 0}
                className="btn btn-warning">
                {savingReturn ? 'Saving...' : 'Record Return'}
              </button>
            </div>
          </div>
        </>
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
