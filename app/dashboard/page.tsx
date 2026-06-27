'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'
import Link from 'next/link'

// ── Rider dashboard ─────────────────────────────────────────────────────────
function RiderDashboard({ employeeId, employeeName }: { employeeId: number; employeeName: string }) {
  const [riderData, setRiderData] = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState<'today'|'month'|'all'>('month')

  const dateFrom = period === 'today' ? today()
    : period === 'month' ? monthStart() : '2000-01-01'

  const load = useCallback(async () => {
    setLoading(true)

    // Bags received via bulk purchases
    const { data: bulkIn } = await supabase
      .from('sales')
      .select('bags_sold, sale_date, amount_paid, outstanding_balance, payment_status')
      .eq('sale_type', 'bulk')
      .eq('buyer_employee_id', employeeId)
      .order('sale_date', { ascending: false })

    // Bags sold at retail
    const { data: retailOut } = await supabase
      .from('sales')
      .select('bags_sold, total_amount, amount_paid, outstanding_balance, sale_date, customers(name)')
      .eq('sale_type', 'retail')
      .eq('salesperson_id', employeeId)
      .gte('sale_date', dateFrom)
      .order('sale_date', { ascending: false })

    // Bags returned to factory
    const { data: bagReturns } = await supabase
      .from('bulk_returns')
      .select('bags_returned, return_date, total_credit')
      .eq('employee_id', employeeId)
      .order('return_date', { ascending: false })

    const totalReceived = (bulkIn ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalSold     = (retailOut ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalReturned = (bagReturns ?? []).reduce((a: number, r: any) => a + r.bags_returned, 0)
    const bagsOnHand    = totalReceived - totalSold - totalReturned

    const revenue       = (retailOut ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
    const collected     = (retailOut ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
    const outstanding   = (retailOut ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    // Unpaid bulk balance (what rider owes factory)
    const owedToFactory = (bulkIn ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    setRiderData({
      bulkIn: bulkIn ?? [],
      retailOut: retailOut ?? [],
      bagReturns: bagReturns ?? [],
      totalReceived, totalSold, bagsOnHand,
      revenue, collected, outstanding, owedToFactory,
    })
    setLoading(false)
  }, [employeeId, period])

  useEffect(() => { load() }, [load])

  const stockColor = riderData?.bagsOnHand > 20
    ? '#1B5E20' : riderData?.bagsOnHand > 0 ? '#BF4D00' : '#C00000'

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <div className="text-xs text-gray-400 mt-0.5">{employeeName}</div>
        </div>
        <div className="flex gap-2">
          {(['today','month','all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={'btn btn-sm ' + (period === p ? 'btn-primary' : 'btn-secondary')}>
              {p === 'today' ? 'Today' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : riderData && (
        <>
          {/* ── Bag balance hero card ──────────────────────────────────── */}
          <div className={'rounded-2xl p-5 mb-5 text-white shadow-lg '
            + (riderData.bagsOnHand > 0 ? 'bg-[#1F4E79]' : 'bg-red-700')}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-blue-200 text-sm font-medium">Bags Available to Sell</div>
                <div className="text-6xl font-bold mt-1 tabular-nums">
                  {fmtNum(riderData.bagsOnHand)}
                </div>
                <div className="text-blue-200 text-xs mt-1">bags on hand</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <div className="text-blue-200 text-xs">Total Received</div>
                  <div className="text-white font-bold text-xl tabular-nums">
                    {fmtNum(riderData.totalReceived)}
                  </div>
                  <div className="text-blue-200 text-xs">from factory</div>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <div className="text-blue-200 text-xs">Total Sold</div>
                  <div className="text-white font-bold text-xl tabular-nums">
                    {fmtNum(riderData.totalSold)}
                  </div>
                  <div className="text-blue-200 text-xs">to customers</div>
                </div>
              </div>
            </div>
            {riderData.bagsOnHand === 0 && (
              <div className="mt-3 bg-white/20 rounded-xl p-3 text-sm">
                ⚠️ You have no bags. Contact your manager to request a bulk dispatch.
              </div>
            )}
            {riderData.bagsOnHand > 0 && riderData.bagsOnHand <= 20 && (
              <div className="mt-3 bg-orange-400/30 rounded-xl p-3 text-sm">
                ⚠️ Running low — only {riderData.bagsOnHand} bags left. Request a top-up soon.
              </div>
            )}
          </div>

          {/* ── Financial cards ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              ['Sales Revenue', fmtGhc(riderData.revenue),     '#1F4E79'],
              ['Collected',     fmtGhc(riderData.collected),   '#1B5E20'],
              ['Outstanding',   fmtGhc(riderData.outstanding), '#C00000'],
              ['Owed to Factory', fmtGhc(riderData.owedToFactory), riderData.owedToFactory > 0 ? '#BF4D00' : '#1B5E20'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="stat-card" style={{ borderLeftColor: c as string }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold text-sm mt-0.5" style={{ color: c as string }}>{v}</div>
              </div>
            ))}
          </div>

          {/* ── Bulk receipts ──────────────────────────────────────────── */}
          <div className="card mb-4">
            <div className="font-semibold text-[#1F4E79] mb-3 flex items-center justify-between">
              <span>📦 Bulk Receipts from Factory</span>
              <span className="text-xs text-gray-400 font-normal">All time</span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col style={{width:'80px'}} />
                  <col style={{width:'100px'}} /><col style={{width:'100px'}} />
                  <col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="right">Bags</th>
                    <th className="right">Amount Due</th>
                    <th className="right">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {riderData.bulkIn.length === 0
                    ? <tr><td colSpan={5} className="text-center py-6 text-gray-400">
                        No bulk receipts yet — contact your manager.
                      </td></tr>
                    : riderData.bulkIn.slice(0, 10).map((s: any, i: number) => (
                    <tr key={i}>
                      <td className="muted">{s.sale_date}</td>
                      <td className="num text-green-700">+{fmtNum(s.bags_sold)}</td>
                      <td className="num">{fmtGhc(s.bags_sold * (s.amount_paid + s.outstanding_balance) / s.bags_sold || 0)}</td>
                      <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                      <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
                {riderData.bulkIn.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#1F4E79]">
                      <td colSpan={5} className="py-2 px-3 text-white text-xs font-semibold">
                        Total Received: {fmtNum(riderData.totalReceived)} bags
                        &nbsp;|&nbsp;
                        Total Owed: {fmtGhc(riderData.owedToFactory)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Recent retail sales ────────────────────────────────────── */}
          <div className="card">
            <div className="font-semibold text-[#1F4E79] mb-3 flex items-center justify-between">
              <span>🛍️ My Retail Sales</span>
              <Link href="/sales" className="text-xs text-blue-600 hover:underline">
                View all →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col />
                  <col style={{width:'70px'}} /><col style={{width:'100px'}} />
                  <col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Customer</th>
                    <th className="right">Bags</th>
                    <th className="right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {riderData.retailOut.length === 0
                    ? <tr><td colSpan={5} className="text-center py-6 text-gray-400">
                        No sales this period.
                      </td></tr>
                    : riderData.retailOut.slice(0, 10).map((s: any, i: number) => (
                    <tr key={i}>
                      <td className="muted">{s.sale_date}</td>
                      <td className="font-medium">{s.customers?.name}</td>
                      <td className="num">{fmtNum(s.bags_sold)}</td>
                      <td className="num">{fmtGhc(s.total_amount)}</td>
                      <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

// ── Admin dashboard ──────────────────────────────────────────────────────────
function AdminDashboard() {
  const [stats, setStats]   = useState<any>(null)
  const [recent, setRecent] = useState<any[]>([])
  const [period, setPeriod] = useState<'today'|'month'|'all'>('month')
  const [loading, setLoading] = useState(true)

  const dateFrom = period === 'today' ? today()
    : period === 'month' ? monthStart() : '2000-01-01'

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: sales }, { data: fi }, { data: exp }] = await Promise.all([
      supabase.from('sales').select('total_amount,amount_paid,outstanding_balance,bags_sold,sale_type')
        .gte('sale_date', dateFrom),
      supabase.from('finished_inventory').select('bags_in,bags_out'),
      supabase.from('expenses').select('amount').gte('expense_date', dateFrom),
    ])

    const allSales   = sales ?? []
    const retail     = allSales.filter((s: any) => s.sale_type !== 'bulk')
    const bulk       = allSales.filter((s: any) => s.sale_type === 'bulk')

    const totalRevenue  = retail.reduce((a: number, s: any) => a + s.total_amount, 0)
    const cashCollected = retail.reduce((a: number, s: any) => a + s.amount_paid, 0)
    const outstanding   = retail.reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const bagsSold      = retail.reduce((a: number, s: any) => a + s.bags_sold, 0)
    const bulkDispatched = bulk.reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalExpenses = (exp ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const bagsInStock   = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)

    setStats({ totalRevenue, cashCollected, outstanding, bagsSold, bagsInStock, bulkDispatched, totalExpenses })

    const { data: recSales } = await supabase.from('sales')
      .select('id,sale_date,customers(name),bags_sold,total_amount,payment_status,sale_type,buyer:employees!buyer_employee_id(full_name)')
      .gte('sale_date', dateFrom)
      .order('created_at', { ascending: false }).limit(10)
    setRecent(recSales ?? [])
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">📊 Dashboard</h1>
        <div className="flex gap-2 items-center">
          <span className="badge badge-blue">Admin</span>
          {(['today','month','all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={'btn btn-sm ' + (period === p ? 'btn-primary' : 'btn-secondary')}>
              {p === 'today' ? 'Today' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="text-center py-16 text-gray-400">Loading...</div> : stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              ['Retail Revenue',    fmtGhc(stats.totalRevenue),    '#1F4E79'],
              ['Bags Sold (Retail)',fmtNum(stats.bagsSold),        '#2E75B6'],
              ['Bulk Dispatched',  fmtNum(stats.bulkDispatched),  '#BF4D00'],
              ['Bags in Stock',    fmtNum(stats.bagsInStock),     '#4A148C'],
              ['Collected',        fmtGhc(stats.cashCollected),   '#1B5E20'],
              ['Outstanding',      fmtGhc(stats.outstanding),     '#C00000'],
              ['Expenses',         fmtGhc(stats.totalExpenses),   '#795548'],
              ['Net Profit',       fmtGhc(stats.totalRevenue - stats.totalExpenses),
                stats.totalRevenue - stats.totalExpenses >= 0 ? '#1B5E20' : '#C00000'],
            ].map(([l, v, c]) => (
              <div key={l as string} className="stat-card" style={{ borderLeftColor: c as string }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold" style={{ color: c as string }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="font-semibold text-gray-500 text-sm uppercase tracking-wider mb-3">
              Recent Transactions
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col style={{width:'80px'}} />
                  <col /><col style={{width:'70px'}} />
                  <col style={{width:'105px'}} /><col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Type</th><th>Customer / Rider</th>
                    <th className="right">Bags</th>
                    <th className="right">Total</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0
                    ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">No transactions in this period</td></tr>
                    : recent.map((s: any) => (
                    <tr key={s.id}>
                      <td className="muted">{s.sale_date}</td>
                      <td>
                        <span className={'badge ' + (s.sale_type==='bulk' ? 'badge-yellow' : 'badge-blue')}>
                          {s.sale_type === 'bulk' ? '📦 Bulk' : '🛍️ Retail'}
                        </span>
                      </td>
                      <td className="font-medium">
                        {s.sale_type === 'bulk'
                          ? (s.buyer?.full_name ?? '—')
                          : (s.customers?.name ?? '—')}
                      </td>
                      <td className="num">{fmtNum(s.bags_sold)}</td>
                      <td className="num">{fmtGhc(s.total_amount)}</td>
                      <td>
                        <span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>
                          {s.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

// ── Route: show rider or admin dashboard ─────────────────────────────────────
export default function DashboardPage() {
  const { role, loading, isAdmin, isRider, isFactoryManager, canAccess, employeeId, employeeName } = useRole()

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading...</div>
      </div>
    </AppLayout>
  )

  // Riders always get their personal dashboard
  if (isRider && employeeId) {
    return <RiderDashboard employeeId={employeeId} employeeName={employeeName} />
  }

  // Admin / Factory Manager / anyone with dashboard permission
  if (isAdmin || isFactoryManager || canAccess('dashboard')) {
    // If also a rider, show rider dashboard
    if (isRider && employeeId) return <RiderDashboard employeeId={employeeId} employeeName={employeeName} />
    return <AdminDashboard />
  }

  return <AccessDenied message="You do not have access to the Dashboard." />
}
