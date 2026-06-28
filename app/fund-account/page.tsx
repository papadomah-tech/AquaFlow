'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

export default function FundAccountPage() {
  const { isAdmin, canAccess, userId, employeeName, loading: roleLoading } = useRole()

  const [data, setData]         = useState<any>(null)
  const [deposits, setDeposits] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)
  const [period, setPeriod]     = useState<'month'|'all'>('month')
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<'deposit'|'rider-payment'>('deposit')
  const [editItem, setEditItem] = useState<any>(null)
  const [form, setForm]         = useState({
    date: today(), amount: '', bank_name: '',
    reference: '', deposited_by: '', employee_id: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  const dateFrom = period === 'month' ? monthStart() : '2000-01-01'

  useEffect(() => {
    supabase.from('employees').select('id,full_name,role,employee_type')
      .eq('status','active').order('full_name')
      .then(({ data: e }) => setEmployees(e ?? []))
  }, [])

  const load = useCallback(async () => {
    // Wait for role to finish loading before checking access
    if (roleLoading) return
    if (!canAccess('fund-account')) { setLoading(false); return }
    setLoading(true)

    const buildDepQuery = () => {
      let q = supabase.from('bank_deposits').select('*')
        .gte('deposit_date', dateFrom).order('deposit_date', { ascending: false })
      if (!isAdmin && userId) q = q.eq('created_by', userId)
      return q
    }
    const buildPayQuery = () => {
      let q = supabase.from('rider_payments').select('*,employees(id,full_name,role)')
        .gte('payment_date', dateFrom).order('payment_date', { ascending: false })
      if (!isAdmin && userId) q = q.eq('recorded_by', userId)
      return q
    }
    const buildExpQuery = () => {
      let q = supabase.from('expenses').select('*')
        .gte('expense_date', dateFrom).order('expense_date', { ascending: false })
      if (!isAdmin && userId) q = q.eq('created_by', userId)
      return q
    }

    const [{ data: deps }, { data: riderPays }, { data: exps },
           { data: bulkSales }, { data: retailSales }] = await Promise.all([
      buildDepQuery(), buildPayQuery(), buildExpQuery(),
      isAdmin
        ? supabase.from('sales').select('total_amount,amount_paid,outstanding_balance').eq('sale_type','bulk')
        : supabase.from('sales').select('total_amount,amount_paid,outstanding_balance').eq('sale_type','bulk').eq('created_by', userId ?? ''),
      supabase.from('sales').select('total_amount,amount_paid,outstanding_balance')
        .eq('sale_type','retail').gte('sale_date', dateFrom),
    ])

    const totalDeposited     = (deps ?? []).reduce((a:number,d:any) => a + d.amount, 0)
    const totalRiderPayments = (riderPays ?? []).reduce((a:number,p:any) => a + p.amount, 0)
    const totalExpenses      = (exps ?? []).reduce((a:number,e:any) => a + e.amount, 0)
    const totalRetailRev     = (retailSales ?? []).reduce((a:number,s:any) => a + s.total_amount, 0)
    const totalRetailColl    = (retailSales ?? []).reduce((a:number,s:any) => a + s.amount_paid, 0)
    const totalBulkRev       = (bulkSales ?? []).reduce((a:number,s:any) => a + s.total_amount, 0)
    const totalBulkColl      = (bulkSales ?? []).reduce((a:number,s:any) => a + s.amount_paid, 0)
    const totalBulkOuts      = (bulkSales ?? []).reduce((a:number,s:any) => a + s.outstanding_balance, 0)
    const totalCashIn        = totalDeposited + totalRiderPayments
    const fundBalance        = totalCashIn - totalExpenses

    setDeposits(deps ?? [])
    setPayments(riderPays ?? [])
    setExpenses(exps ?? [])
    setData({ totalDeposited, totalRiderPayments, totalExpenses,
              totalCashIn, fundBalance, totalRetailRev, totalRetailColl,
              totalBulkRev, totalBulkColl, totalBulkOuts })
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, userId, period, dateFrom, roleLoading])

  useEffect(() => { load() }, [load])

  if (roleLoading) return (
    <AppLayout><div className="flex items-center justify-center min-h-[60vh] text-gray-400">Loading...</div></AppLayout>
  )
  if (!canAccess('fund-account')) return <AccessDenied message="You do not have access to the Fund Account." />

  // ── Open add/edit form ─────────────────────────────────────────────────────
  const openForm = (type: 'deposit'|'rider-payment', item?: any) => {
    setFormType(type); setEditItem(item ?? null)
    if (item) {
      setForm({
        date:         item.deposit_date ?? item.payment_date ?? today(),
        amount:       String(item.amount),
        bank_name:    item.bank_name ?? '',
        reference:    item.reference ?? '',
        deposited_by: item.deposited_by ?? '',
        employee_id:  String(item.employee_id ?? ''),
        notes:        item.notes ?? '',
      })
    } else {
      setForm({ date:today(), amount:'', bank_name:'', reference:'', deposited_by:'', employee_id:'', notes:'' })
    }
    setShowForm(true)
  }

  const save = async () => {
    setSaving(true)
    if (formType === 'deposit') {
      const payload = {
        deposit_date: form.date, bank_name: form.bank_name || 'Company Account',
        amount: parseFloat(form.amount), reference: form.reference || null,
        deposited_by: form.deposited_by || employeeName || null,
        notes: form.notes || null, created_by: userId,
      }
      if (editItem) await supabase.from('bank_deposits').update(payload).eq('id', editItem.id)
      else await supabase.from('bank_deposits').insert(payload)
    } else {
      const payload = {
        employee_id: parseInt(form.employee_id), payment_date: form.date,
        amount: parseFloat(form.amount), reference: form.reference || null,
        notes: form.notes || null, recorded_by: userId,
      }
      if (editItem) await supabase.from('rider_payments').update(payload).eq('id', editItem.id)
      else await supabase.from('rider_payments').insert(payload)
    }
    setSaving(false); setShowForm(false); load()
  }

  const del = async (table: string, id: number, label: string) => {
    if (!confirm('Delete this ' + label + '? This cannot be undone.')) return
    await (supabase.from(table as any) as any).delete().eq('id', id)
    load()
  }

  const ACTIONS = (type: 'deposit'|'rider-payment', item: any, table: string, label: string) => (
    <div className="flex gap-1">
      <button onClick={() => openForm(type, item)} className="btn btn-sm btn-secondary">Edit</button>
      <button onClick={() => del(table, item.id, label)} className="btn btn-sm btn-danger">Del</button>
    </div>
  )

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🏦 Fund Account</h1>
          {!isAdmin && <span className="badge badge-blue mt-1">Your records only</span>}
          {isAdmin && <span className="badge badge-blue mt-1">Admin — All Records</span>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => openForm('deposit')} className="btn btn-primary">+ Bank Deposit</button>
          <button onClick={() => openForm('rider-payment')} className="btn btn-secondary">+ Rider Payment</button>
          <button onClick={() => setPeriod(p => p === 'month' ? 'all' : 'month')} className="btn btn-secondary btn-sm">
            {period === 'month' ? 'This Month' : 'All Time'}
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="card mb-4 bg-blue-50 border border-blue-200">
          <div className="text-sm text-blue-700">
            📋 Showing your deposits and payments only. Contact the administrator to view all company records.
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : data && (
        <>
          {/* Fund Balance */}
          <div className={'rounded-2xl p-5 mb-5 text-white shadow-lg ' + (data.fundBalance >= 0 ? 'bg-[#1F4E79]' : 'bg-red-700')}>
            <div className="text-blue-200 text-sm font-medium">Fund Balance</div>
            <div className="text-5xl font-bold mt-1 tabular-nums">{fmtGhc(data.fundBalance)}</div>
            <div className="text-blue-200 text-xs mt-1">
              Cash In: {fmtGhc(data.totalCashIn)} — Expenses Paid: {fmtGhc(data.totalExpenses)}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              ['Bank Deposits',     fmtGhc(data.totalDeposited),     '#1F4E79'],
              ['Rider Payments In', fmtGhc(data.totalRiderPayments), '#1B5E20'],
              ['Expenses Paid Out', fmtGhc(data.totalExpenses),      '#C00000'],
              ['Bulk Outstanding',  fmtGhc(data.totalBulkOuts),      '#BF4D00'],
              ['Retail Revenue',    fmtGhc(data.totalRetailRev),     '#2E75B6'],
              ['Retail Collected',  fmtGhc(data.totalRetailColl),    '#1B5E20'],
              ['Bulk Revenue',      fmtGhc(data.totalBulkRev),       '#4A148C'],
              ['Bulk Collected',    fmtGhc(data.totalBulkColl),      '#00695C'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="stat-card" style={{ borderLeftColor: c as string }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold text-sm mt-0.5 tabular-nums" style={{ color: c as string }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Bank Deposits */}
          <div className="card mb-4">
            <div className="text-sm font-semibold text-[#1F4E79] mb-3">🏦 Bank Deposits</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}}/><col/><col style={{width:'110px'}}/>
                  <col style={{width:'120px'}}/><col style={{width:'110px'}}/><col style={{width:'90px'}}/>
                </colgroup>
                <thead><tr><th>Date</th><th>Bank / Account</th><th>Reference</th><th>Deposited By</th><th className="right">Amount</th><th>Actions</th></tr></thead>
                <tbody>
                  {deposits.length === 0
                    ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">No deposits</td></tr>
                    : deposits.map((d:any) => (
                    <tr key={d.id}>
                      <td className="muted">{d.deposit_date}</td>
                      <td className="font-medium">{d.bank_name}</td>
                      <td className="muted">{d.reference||'—'}</td>
                      <td className="muted">{d.deposited_by||'—'}</td>
                      <td className="num-blue">{fmtGhc(d.amount)}</td>
                      <td>{ACTIONS('deposit', d, 'bank_deposits', 'deposit')}</td>
                    </tr>
                  ))}
                </tbody>
                {deposits.length > 0 && (
                  <tfoot><tr className="bg-[#1F4E79]">
                    <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">TOTAL DEPOSITED</td>
                    <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(data.totalDeposited)}</td>
                    <td/>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Rider Payments */}
          <div className="card mb-4">
            <div className="text-sm font-semibold text-[#1F4E79] mb-3">🛵 Rider / Rep Payments Received</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}}/><col/><col style={{width:'110px'}}/>
                  <col style={{width:'110px'}}/><col style={{width:'90px'}}/>
                </colgroup>
                <thead><tr><th>Date</th><th>Rider / Rep</th><th>Reference</th><th className="right">Amount</th><th>Actions</th></tr></thead>
                <tbody>
                  {payments.length === 0
                    ? <tr><td colSpan={5} className="text-center py-6 text-gray-400">No rider payments</td></tr>
                    : payments.map((p:any) => (
                    <tr key={p.id}>
                      <td className="muted">{p.payment_date}</td>
                      <td className="font-medium">{p.employees?.full_name||'—'}</td>
                      <td className="muted">{p.reference||'—'}</td>
                      <td className="num-green">{fmtGhc(p.amount)}</td>
                      <td>{ACTIONS('rider-payment', p, 'rider_payments', 'payment')}</td>
                    </tr>
                  ))}
                </tbody>
                {payments.length > 0 && (
                  <tfoot><tr className="bg-[#1F4E79]">
                    <td colSpan={3} className="py-2 px-3 text-white text-xs font-semibold">TOTAL RECEIVED</td>
                    <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(data.totalRiderPayments)}</td>
                    <td/>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Expenses */}
          <div className="card">
            <div className="text-sm font-semibold text-[#1F4E79] mb-3">💸 Expenses Paid</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}}/><col style={{width:'120px'}}/><col/>
                  <col style={{width:'110px'}}/><col style={{width:'90px'}}/>
                </colgroup>
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="right">Amount</th><th>Actions</th></tr></thead>
                <tbody>
                  {expenses.length === 0
                    ? <tr><td colSpan={5} className="text-center py-6 text-gray-400">No expenses</td></tr>
                    : expenses.map((e:any) => (
                    <tr key={e.id}>
                      <td className="muted">{e.expense_date}</td>
                      <td><span className="badge badge-gray">{e.category}</span></td>
                      <td className="text-sm">{e.description}</td>
                      <td className="num-red">{fmtGhc(e.amount)}</td>
                      <td>
                        <button onClick={() => del('expenses', e.id, 'expense')} className="btn btn-sm btn-danger">Del</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot><tr className="bg-red-700">
                    <td colSpan={3} className="py-2 px-3 text-white text-xs font-semibold">TOTAL EXPENSES</td>
                    <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(data.totalExpenses)}</td>
                    <td/>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* ADD / EDIT MODAL */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">
                {editItem ? 'Edit ' : ''}
                {formType === 'deposit' ? '🏦 Bank Deposit' : '🛵 Rider Payment'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} className="form-input"/>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (GHc) *</label>
                  <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f=>({...f,amount:e.target.value}))} className="form-input" placeholder="0.00"/>
                </div>
                {formType === 'deposit' ? (<>
                  <div className="form-group col-span-2">
                    <label className="form-label">Bank / Account *</label>
                    <input value={form.bank_name} onChange={e => setForm(f=>({...f,bank_name:e.target.value}))} className="form-input" placeholder="e.g. GCB, MoMo 024..."/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reference</label>
                    <input value={form.reference} onChange={e => setForm(f=>({...f,reference:e.target.value}))} className="form-input"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Deposited By</label>
                    <input value={form.deposited_by} onChange={e => setForm(f=>({...f,deposited_by:e.target.value}))} className="form-input"/>
                  </div>
                </>) : (
                  <div className="form-group col-span-2">
                    <label className="form-label">Rider / Sales Rep *</label>
                    <select value={form.employee_id} onChange={e => setForm(f=>({...f,employee_id:e.target.value}))} className="form-select">
                      <option value="">Select rider...</option>
                      {employees.map((e:any) => <option key={e.id} value={e.id}>{e.full_name} — {e.role}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-group col-span-2">
                  <label className="form-label">Notes</label>
                  <input value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} className="form-input"/>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={save}
                disabled={saving || !form.amount || (formType==='deposit' && !form.bank_name) || (formType==='rider-payment' && !form.employee_id)}
                className="btn btn-primary">{saving ? 'Saving...' : '💾 Save'}</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
