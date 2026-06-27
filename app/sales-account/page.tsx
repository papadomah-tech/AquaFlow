'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

function SalesAccountInner() {
  const { isAdmin, isRider, isFactoryManager, canAccess,
          employeeId, employeeName } = useRole()

  // Admin can view any employee; others see themselves
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null)
  const [employees, setEmployees]          = useState<any[]>([])
  const [data, setData]                    = useState<any>(null)
  const [loading, setLoading]              = useState(true)
  const [period, setPeriod]                = useState<'month'|'all'>('month')

  const dateFrom = period === 'month' ? monthStart() : '2000-01-01'

  // For admin — load all riders/reps
  useEffect(() => {
    if (isAdmin || isFactoryManager || (!isRider && canAccess('sales-account'))) {
      supabase.from('employees').select('id,full_name,role,employee_type')
        .eq('status','active').order('full_name')
        .then(({ data: emps }) => {
          setEmployees(emps ?? [])
          if (emps && emps.length > 0 && !selectedEmpId) {
            setSelectedEmpId(emps[0].id)
          }
        })
    } else if (employeeId) {
      setSelectedEmpId(employeeId)
    }
  }, [isAdmin, isFactoryManager, employeeId])

  const viewId = selectedEmpId ?? employeeId

  const load = useCallback(async () => {
    if (!viewId) return
    setLoading(true)

    const [
      { data: bulkIn },
      { data: retailPeriod },
      { data: retailAll },
      { data: riderPayments },
    ] = await Promise.all([
      // All bulk dispatches to this rider
      supabase.from('sales').select('id,sale_date,bags_sold,unit_price,total_amount,amount_paid,outstanding_balance,payment_status')
        .eq('sale_type','bulk').eq('buyer_employee_id', viewId)
        .order('sale_date', { ascending: false }),

      // Retail sales in period
      supabase.from('sales').select('id,sale_date,bags_sold,unit_price,total_amount,amount_paid,outstanding_balance,payment_status,customers(name)')
        .eq('sale_type','retail').eq('salesperson_id', viewId)
        .gte('sale_date', dateFrom)
        .order('sale_date', { ascending: false }),

      // All retail sales (for totals)
      supabase.from('sales').select('bags_sold,total_amount,amount_paid,outstanding_balance')
        .eq('sale_type','retail').eq('salesperson_id', viewId),

      // Payments made back to factory
      supabase.from('rider_payments').select('*')
        .eq('employee_id', viewId)
        .order('payment_date', { ascending: false }),

      // Bag returns
      supabase.from('bulk_returns').select('bags_returned,total_credit,return_date,notes')
        .eq('employee_id', viewId)
        .order('return_date', { ascending: false }),
    ])

    // ── Bag position ───────────────────────────────────────────────
    const bagsReceived  = (bulkIn ?? []).reduce((a:number,s:any) => a + s.bags_sold, 0)
    const bagsSoldAll   = (retailAll ?? []).reduce((a:number,s:any) => a + s.bags_sold, 0)
    const totalReturned = ((riderPayments as any[])?.[4] ?? []).reduce((a:number,r:any) => a + r.bags_returned, 0)
    const bagsOnHand    = bagsReceived - bagsSoldAll - totalReturned

    // ── Factory account ────────────────────────────────────────────
    const totalOwed     = (bulkIn ?? []).reduce((a:number,s:any) => a + s.total_amount, 0)
    const totalPaidBulk = (bulkIn ?? []).reduce((a:number,s:any) => a + s.amount_paid, 0)
    const extraPayments = (riderPayments ?? []).reduce((a:number,p:any) => a + p.amount, 0)
    const totalPaidFactory = totalPaidBulk + extraPayments
    const owedToFactory = Math.max(0, totalOwed - totalPaidFactory)

    // ── Retail earnings ────────────────────────────────────────────
    const retailRevenue  = (retailAll ?? []).reduce((a:number,s:any) => a + s.total_amount, 0)
    const retailCollected= (retailAll ?? []).reduce((a:number,s:any) => a + s.amount_paid, 0)
    const retailOutstanding = (retailAll ?? []).reduce((a:number,s:any) => a + s.outstanding_balance, 0)

    // Gross profit = retail revenue - cost of goods (amount owed to factory)
    const grossProfit = retailRevenue - totalOwed

    setData({
      bulkIn: bulkIn ?? [],
      retailPeriod: retailPeriod ?? [],
      riderPayments: riderPayments ?? [],
      bagsReceived, bagsSoldAll, bagsOnHand,
      totalOwed, totalPaidFactory, owedToFactory,
      retailRevenue, retailCollected, retailOutstanding,
      grossProfit,
    })
    setLoading(false)
  }, [viewId, period])

  useEffect(() => { load() }, [load])

  const bagColor = data?.bagsOnHand > 20 ? '#1B5E20'
    : data?.bagsOnHand > 0 ? '#BF4D00' : '#C00000'

  const empName = (isAdmin || isFactoryManager || (!isRider && canAccess('sales-account')))
    ? (employees.find((e:any) => e.id === viewId)?.full_name ?? '—')
    : employeeName

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">📋 Sales Account</h1>
          <div className="text-xs text-gray-400 mt-0.5">{empName}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPeriod('month')}
            className={'btn btn-sm ' + (period==='month'?'btn-primary':'btn-secondary')}>
            This Month
          </button>
          <button onClick={() => setPeriod('all')}
            className={'btn btn-sm ' + (period==='all'?'btn-primary':'btn-secondary')}>
            All Time
          </button>
        </div>
      </div>

      {/* Admin employee selector */}
      {(isAdmin || isFactoryManager || (!isRider && canAccess('sales-account'))) && employees.length > 0 && (
        <div className="card mb-4 flex items-center gap-3">
          <label className="form-label mb-0 whitespace-nowrap">View account for:</label>
          <select value={viewId ?? ''} onChange={e => setSelectedEmpId(parseInt(e.target.value))}
            className="form-select flex-1">
            {employees.map((e:any) => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {e.role}
                {e.employee_type === 'rider' ? ' 🛵' : e.employee_type === 'factory_manager' ? ' 🏭' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : data && (
        <>
          {/* ── Bag Position ─────────────────────────────────────── */}
          <div className="card mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Bag Position
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-blue-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">Total Received</div>
                <div className="text-2xl font-bold text-[#1F4E79] tabular-nums">
                  {fmtNum(data.bagsReceived)}
                </div>
                <div className="text-xs text-gray-400">from factory</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">Total Sold</div>
                <div className="text-2xl font-bold text-red-600 tabular-nums">
                  {fmtNum(data.bagsSoldAll)}
                </div>
                <div className="text-xs text-gray-400">to customers</div>
              </div>
              <div className="rounded-xl p-3" style={{background: data.bagsOnHand > 0 ? '#f0fdf4' : '#fef2f2'}}>
                <div className="text-xs text-gray-500 mb-1">On Hand</div>
                <div className="text-2xl font-bold tabular-nums" style={{color: bagColor}}>
                  {fmtNum(data.bagsOnHand)}
                </div>
                <div className="text-xs text-gray-400">available</div>
              </div>
            </div>
          </div>

          {/* ── Financial Summary ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

            {/* Factory Account — what rider owes */}
            <div className="card">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Factory Account (Debt to Factory)
              </div>
              <div className="space-y-2">
                {[
                  ['Total Bags Value (at bulk price)',  data.totalOwed,         'text-gray-700'],
                  ['Total Paid to Factory',             data.totalPaidFactory,  'text-green-700'],
                  ['Outstanding Balance Owed',          data.owedToFactory,     data.owedToFactory > 0 ? 'text-red-600 font-bold' : 'text-green-700 font-bold'],
                ].map(([l, v, cls]) => (
                  <div key={l as string} className="flex justify-between items-center py-1.5 border-b border-gray-100">
                    <span className="text-sm text-gray-600">{l}</span>
                    <span className={'text-sm tabular-nums ' + cls}>{fmtGhc(v as number)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Retail Earnings */}
            <div className="card">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Retail Earnings (All Time)
              </div>
              <div className="space-y-2">
                {[
                  ['Total Revenue (at retail price)',   data.retailRevenue,     'text-[#1F4E79]'],
                  ['Cash Collected from Customers',     data.retailCollected,   'text-green-700'],
                  ['Outstanding from Customers',        data.retailOutstanding, 'text-orange-600'],
                  ['Gross Profit (Revenue − Factory Cost)', data.grossProfit,   data.grossProfit >= 0 ? 'text-green-700 font-bold' : 'text-red-600 font-bold'],
                ].map(([l, v, cls]) => (
                  <div key={l as string} className="flex justify-between items-center py-1.5 border-b border-gray-100">
                    <span className="text-sm text-gray-600">{l}</span>
                    <span className={'text-sm tabular-nums ' + cls}>{fmtGhc(v as number)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Bulk Receipts ─────────────────────────────────────── */}
          <div className="card mb-4">
            <div className="text-sm font-semibold text-[#1F4E79] mb-3">
              📦 Bulk Dispatches Received
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col style={{width:'70px'}} />
                  <col style={{width:'100px'}} /><col style={{width:'110px'}} />
                  <col style={{width:'110px'}} /><col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="right">Bags</th>
                    <th className="right">Unit Price</th>
                    <th className="right">Total</th>
                    <th className="right">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bulkIn.length === 0
                    ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">No bulk dispatches yet</td></tr>
                    : data.bulkIn.map((s:any) => (
                    <tr key={s.id}>
                      <td className="muted">{s.sale_date}</td>
                      <td className="num text-green-700">+{fmtNum(s.bags_sold)}</td>
                      <td className="num">{fmtGhc(s.unit_price)}</td>
                      <td className="num">{fmtGhc(s.total_amount)}</td>
                      <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                      <td><span className={'badge '+(s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Retail Sales in Period ────────────────────────────── */}
          <div className="card">
            <div className="text-sm font-semibold text-[#1F4E79] mb-3">
              🛍️ Retail Sales — {period === 'month' ? 'This Month' : 'All Time'}
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col />
                  <col style={{width:'70px'}} /><col style={{width:'105px'}} />
                  <col style={{width:'105px'}} /><col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Customer</th>
                    <th className="right">Bags</th>
                    <th className="right">Total</th>
                    <th className="right">Collected</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.retailPeriod.length === 0
                    ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">No retail sales in this period</td></tr>
                    : data.retailPeriod.map((s:any) => (
                    <tr key={s.id}>
                      <td className="muted">{s.sale_date}</td>
                      <td className="font-medium">{s.customers?.name ?? '—'}</td>
                      <td className="num">{fmtNum(s.bags_sold)}</td>
                      <td className="num">{fmtGhc(s.total_amount)}</td>
                      <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                      <td><span className={'badge '+(s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
                {data.retailPeriod.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#1F4E79]">
                      <td colSpan={2} className="py-2 px-3 text-white text-xs font-semibold">PERIOD TOTAL</td>
                      <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                        {fmtNum(data.retailPeriod.reduce((a:number,s:any) => a + s.bags_sold, 0))}
                      </td>
                      <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                        {fmtGhc(data.retailPeriod.reduce((a:number,s:any) => a + s.total_amount, 0))}
                      </td>
                      <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                        {fmtGhc(data.retailPeriod.reduce((a:number,s:any) => a + s.amount_paid, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

export default function SalesAccountPage() {
  return (
    <ModuleGuard moduleKey="sales-account" moduleLabel="Sales Account">
      <SalesAccountInner />
    </ModuleGuard>
  )
}
