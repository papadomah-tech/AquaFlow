'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'
import Link from 'next/link'

// ─────────────────────────────────────────────────────────────────────────────
// Shared Performance Card — used on both Rider and Admin/Factory Manager views
// ─────────────────────────────────────────────────────────────────────────────
function PerformanceCard({ pct, bags, target, basePay, feedingFee, earnedBase, grossPay }: {
  pct: number; bags: number; target: number;
  basePay: number; feedingFee: number; earnedBase: number; grossPay: number;
}) {
  const color = pct >= 100 ? '#15803d' : pct >= 60 ? '#ea580c' : '#b91c1c'
  return (
    <div style={{
      borderRadius:'1rem', padding:'1.1rem', marginBottom:'1.25rem',
      background: color, color:'white', boxShadow:'0 4px 16px rgba(0,0,0,0.15)'
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'0.75rem'}}>
        <div>
          <div style={{fontSize:'0.7rem',fontWeight:600,textTransform:'uppercase',
            letterSpacing:'0.05em',opacity:0.75,marginBottom:'0.25rem'}}>
            Performance This Period
          </div>
          <div style={{fontSize:'3rem',fontWeight:'bold',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>
            {pct.toFixed(1)}%
          </div>
          <div style={{fontSize:'0.7rem',opacity:0.7,marginTop:'0.25rem'}}>
            {fmtNum(bags)} ÷ {fmtNum(target)} bags target
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.5rem',textAlign:'center'}}>
          {([
            ['Base Pay',    fmtGhc(earnedBase)],
            ['Feeding Fee', fmtGhc(feedingFee)],
            ['Gross Pay',   fmtGhc(grossPay)],
          ] as [string,string][]).map(([l, v]) => (
            <div key={l} style={{background:'rgba(255,255,255,0.15)',borderRadius:'0.75rem',padding:'0.5rem 0.75rem'}}>
              <div style={{fontSize:'0.65rem',opacity:0.8}}>{l}</div>
              <div style={{fontWeight:'bold',fontSize:'0.85rem',fontVariantNumeric:'tabular-nums',marginTop:'0.2rem'}}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{fontSize:'0.65rem',opacity:0.55,marginTop:'0.75rem'}}>
        ({fmtNum(bags)} ÷ {fmtNum(target)}) × {fmtGhc(basePay)} + {fmtGhc(feedingFee)} feeding fee = <strong>{fmtGhc(grossPay)}</strong>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Actions row — shortcuts to the most common tasks
// ─────────────────────────────────────────────────────────────────────────────
function QuickActions({ links }: { links: { href: string; icon: string; label: string }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {links.map(l => (
        <Link key={l.href} href={l.href}
          className="card flex items-center gap-3 hover:shadow-md hover:border-[#2E75B6]
                     transition-all border border-transparent">
          <span className="text-2xl">{l.icon}</span>
          <span className="text-sm font-medium text-gray-700">{l.label}</span>
        </Link>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RIDER DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function RiderDashboard({ employeeId, employeeName }: { employeeId: number; employeeName: string }) {
  const [riderData, setRiderData] = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState<'today'|'month'|'all'>('month')

  const dateFrom = period === 'today' ? today()
    : period === 'month' ? monthStart() : '2000-01-01'

  const load = useCallback(async () => {
    setLoading(true)

    const [
      { data: bulkIn }, { data: retailOut }, { data: bagReturns },
      { data: teammateBulk }, { data: empRec },
    ] = await Promise.all([
      supabase.from('sales')
        .select('bags_sold, sale_date, unit_price, amount_paid, outstanding_balance, payment_status')
        .eq('sale_type', 'bulk').eq('buyer_employee_id', employeeId)
        .order('sale_date', { ascending: false }),
      supabase.from('sales')
        .select('bags_sold, total_amount, amount_paid, outstanding_balance, sale_date, customers(name)')
        .eq('sale_type', 'retail').eq('salesperson_id', employeeId)
        .gte('sale_date', dateFrom)
        .order('sale_date', { ascending: false }),
      supabase.from('bulk_returns')
        .select('bags_returned, return_date, total_credit')
        .eq('employee_id', employeeId)
        .order('return_date', { ascending: false }),
      supabase.from('sales').select('bags_sold')
        .eq('sale_type', 'bulk').eq('teammate_employee_id', employeeId),
      supabase.from('employees')
        .select('base_pay, feeding_fee, monthly_target, salary')
        .eq('id', employeeId).single(),
    ])

    const primaryBags   = (bulkIn ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const mateBags       = (teammateBulk ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalReceived  = primaryBags + mateBags
    const totalSold       = (retailOut ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalReturned   = (bagReturns ?? []).reduce((a: number, r: any) => a + r.bags_returned, 0)
    const bagsOnHand      = Math.max(0, primaryBags - totalSold - totalReturned)

    const revenue       = (retailOut ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
    const collected     = (retailOut ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
    const outstanding   = (retailOut ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const owedToFactory = (bulkIn ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)

    const basePay    = empRec?.base_pay || empRec?.salary || 0
    const feedingFee = empRec?.feeding_fee ?? 300
    const monthlyTgt = empRec?.monthly_target || 6500
    const perfPct    = monthlyTgt > 0 ? (totalReceived / monthlyTgt) * 100 : 0
    const earnedBase = monthlyTgt > 0 ? Math.round((totalReceived / monthlyTgt) * basePay * 100) / 100 : 0
    const grossPay   = Math.round((earnedBase + feedingFee) * 100) / 100

    setRiderData({
      bulkIn: bulkIn ?? [], retailOut: retailOut ?? [], bagReturns: bagReturns ?? [],
      totalReceived, totalSold, bagsOnHand,
      revenue, collected, outstanding, owedToFactory,
      basePay, feedingFee, monthlyTgt, perfPct, earnedBase, grossPay,
    })
    setLoading(false)
  }, [employeeId, period])

  useEffect(() => { load() }, [load])

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <div className="text-xs text-gray-400 mt-0.5">{employeeName} · Rider / Sales Rep</div>
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
          {/* Bag balance hero */}
          <div className={'rounded-2xl p-5 mb-5 text-white shadow-lg '
            + (riderData.bagsOnHand > 0 ? 'bg-[#1F4E79]' : 'bg-red-700')}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="text-blue-200 text-sm font-medium">Bags Available to Sell</div>
                <div className="text-6xl font-bold mt-1 tabular-nums">{fmtNum(riderData.bagsOnHand)}</div>
                <div className="text-blue-200 text-xs mt-1">bags on hand</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <div className="text-blue-200 text-xs">Total Received</div>
                  <div className="text-white font-bold text-xl tabular-nums">{fmtNum(riderData.totalReceived)}</div>
                  <div className="text-blue-200 text-xs">from factory</div>
                </div>
                <div className="bg-white/10 rounded-xl px-4 py-3">
                  <div className="text-blue-200 text-xs">Total Sold</div>
                  <div className="text-white font-bold text-xl tabular-nums">{fmtNum(riderData.totalSold)}</div>
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

          {riderData.basePay > 0 && (
            <PerformanceCard
              pct={riderData.perfPct} bags={riderData.totalReceived} target={riderData.monthlyTgt}
              basePay={riderData.basePay} feedingFee={riderData.feedingFee}
              earnedBase={riderData.earnedBase} grossPay={riderData.grossPay}
            />
          )}

          <QuickActions links={[
            { href: '/sales', icon: '🛍️', label: 'Record Sale' },
            { href: '/sales-account', icon: '📋', label: 'My Account' },
            { href: '/customers', icon: '👤', label: 'Customers' },
            { href: '/change-password', icon: '🔑', label: 'Settings' },
          ]} />

          {/* Financial summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {([
              ['Sales Revenue',   fmtGhc(riderData.revenue),       '#1F4E79'],
              ['Collected',       fmtGhc(riderData.collected),     '#1B5E20'],
              ['Outstanding',     fmtGhc(riderData.outstanding),   '#C00000'],
              ['Owed to Factory', fmtGhc(riderData.owedToFactory), riderData.owedToFactory > 0 ? '#BF4D00' : '#1B5E20'],
            ] as [string,string,string][]).map(([l, v, c]) => (
              <div key={l} className="stat-card" style={{ borderLeftColor: c }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold text-sm mt-0.5" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Bulk receipts */}
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
                  <col style={{width:'85px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th className="right">Bags</th>
                    <th className="right">Amount Due</th><th className="right">Paid</th><th>Status</th>
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
                      <td className="num">{fmtGhc(s.amount_paid + s.outstanding_balance)}</td>
                      <td className="num-green">{fmtGhc(s.amount_paid)}</td>
                      <td><span className={'badge ' + (s.payment_status==='paid'?'badge-green':s.payment_status==='partial'?'badge-yellow':'badge-red')}>{s.payment_status}</span></td>
                    </tr>
                  ))}
                </tbody>
                {riderData.bulkIn.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#1F4E79]">
                      <td colSpan={5} className="py-2 px-3 text-white text-xs font-semibold">
                        Total Received: {fmtNum(riderData.totalReceived)} bags &nbsp;|&nbsp; Total Owed: {fmtGhc(riderData.owedToFactory)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Recent retail sales */}
          <div className="card">
            <div className="font-semibold text-[#1F4E79] mb-3 flex items-center justify-between">
              <span>🛍️ My Retail Sales</span>
              <Link href="/sales" className="text-xs text-blue-600 hover:underline">View all →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col />
                  <col style={{width:'70px'}} /><col style={{width:'100px'}} />
                  <col style={{width:'85px'}} />
                </colgroup>
                <thead>
                  <tr><th>Date</th><th>Customer</th><th className="right">Bags</th><th className="right">Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {riderData.retailOut.length === 0
                    ? <tr><td colSpan={5} className="text-center py-6 text-gray-400">No sales this period.</td></tr>
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

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / FACTORY MANAGER DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function AdminDashboard({ employeeId, isAdminUser }: { employeeId?: number; isAdminUser: boolean }) {
  const [stats, setStats]     = useState<any>(null)
  const [recent, setRecent]   = useState<any[]>([])
  const [period, setPeriod]   = useState<'today'|'month'|'all'>('month')
  const [loading, setLoading] = useState(true)

  const dateFrom = period === 'today' ? today()
    : period === 'month' ? monthStart() : '2000-01-01'

  const load = useCallback(async () => {
    setLoading(true)
    const [
      { data: sales }, { data: fi }, { data: exp }, { data: fiPeriod }, empResult,
    ] = await Promise.all([
      supabase.from('sales')
        .select('total_amount,amount_paid,outstanding_balance,bags_sold,sale_type')
        .gte('sale_date', dateFrom),
      supabase.from('finished_inventory').select('bags_in,bags_out'),
      supabase.from('expenses').select('amount').gte('expense_date', dateFrom),
      supabase.from('finished_inventory').select('bags_out').gte('transaction_date', dateFrom),
      employeeId
        ? supabase.from('employees').select('base_pay,feeding_fee,monthly_target,salary,employee_type').eq('id', employeeId).single()
        : Promise.resolve({ data: null }),
    ])

    const allSales = sales ?? []
    const retail    = allSales.filter((s: any) => s.sale_type !== 'bulk')
    const bulk      = allSales.filter((s: any) => s.sale_type === 'bulk')

    const retailRevenue  = retail.reduce((a: number, s: any) => a + s.total_amount, 0)
    const bulkRevenue    = bulk.reduce((a: number, s: any) => a + s.total_amount, 0)
    const totalRevenue   = retailRevenue + bulkRevenue   // both count as company revenue
    const cashCollected  = allSales.reduce((a: number, s: any) => a + s.amount_paid, 0)
    const outstanding    = allSales.reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const bagsSold        = retail.reduce((a: number, s: any) => a + s.bags_sold, 0)
    const bulkDispatched  = bulk.reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalExpenses  = (exp ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const bagsInStock     = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
    const netProfit       = totalRevenue - totalExpenses
    const collectionRate  = totalRevenue > 0 ? (cashCollected / totalRevenue) * 100 : 0

    const empRec    = (empResult as any)?.data ?? null
    const fmBasePay = empRec?.base_pay || empRec?.salary || 0
    const fmFeeding = empRec?.feeding_fee ?? 300
    const fmTarget  = empRec?.monthly_target || 6500
    const fmBagsOut = (fiPeriod ?? []).reduce((a: number, r: any) => a + r.bags_out, 0)
    const fmPerfPct = fmTarget > 0 ? (fmBagsOut / fmTarget) * 100 : 0
    const fmEarned  = fmTarget > 0 ? Math.round((fmBagsOut / fmTarget) * fmBasePay * 100) / 100 : 0
    const fmGross   = Math.round((fmEarned + fmFeeding) * 100) / 100

    setStats({
      retailRevenue, bulkRevenue, totalRevenue, cashCollected, outstanding,
      bagsSold, bagsInStock, bulkDispatched, totalExpenses, netProfit, collectionRate,
      fmBasePay, fmFeeding, fmTarget, fmBagsOut, fmPerfPct, fmEarned, fmGross,
    })

    const { data: recSales } = await supabase.from('sales')
      .select('id,sale_date,customers(name),bags_sold,total_amount,payment_status,sale_type,buyer:employees!buyer_employee_id(full_name),salespersonRep:employees!salesperson_id(full_name)')
      .gte('sale_date', dateFrom)
      .order('created_at', { ascending: false }).limit(10)
    setRecent(recSales ?? [])
    setLoading(false)
  }, [period, employeeId])

  useEffect(() => { load() }, [load])

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">📊 Dashboard</h1>
        <div className="flex gap-2 items-center">
          <span className="badge badge-blue">{isAdminUser ? 'Admin' : 'Factory Manager'}</span>
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
          {stats.fmBasePay > 0 && (
            <PerformanceCard
              pct={stats.fmPerfPct} bags={stats.fmBagsOut} target={stats.fmTarget}
              basePay={stats.fmBasePay} feedingFee={stats.fmFeeding}
              earnedBase={stats.fmEarned} grossPay={stats.fmGross}
            />
          )}

          <QuickActions links={[
            { href: '/sales',        icon: '💼', label: 'Sales' },
            { href: '/production',   icon: '🏭', label: 'Production' },
            { href: '/personnel',    icon: '👥', label: 'Personnel' },
            { href: '/reports',      icon: '📈', label: 'Reports' },
          ]} />

          {/* ── Headline figures — net profit + collection rate get priority ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="card border-l-4" style={{ borderLeftColor: stats.netProfit >= 0 ? '#1B5E20' : '#C00000' }}>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Net Profit</div>
              <div className="text-2xl font-bold mt-1 tabular-nums"
                style={{ color: stats.netProfit >= 0 ? '#1B5E20' : '#C00000' }}>
                {fmtGhc(stats.netProfit)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Revenue {fmtGhc(stats.totalRevenue)} − Expenses {fmtGhc(stats.totalExpenses)}
              </div>
            </div>
            <div className="card border-l-4" style={{ borderLeftColor: '#1F4E79' }}>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Total Revenue</div>
              <div className="text-2xl font-bold mt-1 tabular-nums text-[#1F4E79]">
                {fmtGhc(stats.totalRevenue)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Retail {fmtGhc(stats.retailRevenue)} + Bulk {fmtGhc(stats.bulkRevenue)}
              </div>
            </div>
            <div className="card border-l-4"
              style={{ borderLeftColor: stats.collectionRate >= 80 ? '#1B5E20' : '#BF4D00' }}>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Collection Rate</div>
              <div className="text-2xl font-bold mt-1 tabular-nums"
                style={{ color: stats.collectionRate >= 80 ? '#1B5E20' : '#BF4D00' }}>
                {stats.collectionRate.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Collected {fmtGhc(stats.cashCollected)} of {fmtGhc(stats.totalRevenue)}
              </div>
            </div>
          </div>

          {/* ── Secondary stat cards ───────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {([
              ['Bags Sold (Retail)', fmtNum(stats.bagsSold),       '#2E75B6'],
              ['Bulk Dispatched',    fmtNum(stats.bulkDispatched), '#BF4D00'],
              ['Bags in Stock',      fmtNum(stats.bagsInStock),    '#4A148C'],
              ['Outstanding',        fmtGhc(stats.outstanding),    '#C00000'],
              ['Expenses',           fmtGhc(stats.totalExpenses),  '#795548'],
            ] as [string,string,string][]).map(([l, v, c]) => (
              <div key={l} className="stat-card" style={{ borderLeftColor: c }}>
                <div className="text-xs text-gray-500">{l}</div>
                <div className="font-bold" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {stats.bagsInStock <= 50 && (
            <div className="card mb-4 border-l-4 border-orange-400 bg-orange-50">
              <div className="font-semibold text-orange-700">
                ⚠️ Low factory stock — only {fmtNum(stats.bagsInStock)} bags remaining
              </div>
              <div className="text-xs text-orange-500 mt-0.5">
                Consider scheduling a production run soon.
              </div>
            </div>
          )}

          <div className="card">
            <div className="font-semibold text-gray-500 text-sm uppercase tracking-wider mb-3">
              Recent Transactions
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <colgroup>
                  <col style={{width:'90px'}} /><col style={{width:'80px'}} />
                  <col /><col style={{width:'120px'}} />
                  <col style={{width:'70px'}} /><col style={{width:'105px'}} /><col style={{width:'75px'}} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Type</th><th>Customer / Rider</th><th>Rep</th>
                    <th className="right">Bags</th><th className="right">Total</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.length === 0
                    ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No transactions in this period</td></tr>
                    : recent.map((s: any) => (
                    <tr key={s.id}>
                      <td className="muted">{s.sale_date}</td>
                      <td>
                        <span className={'badge ' + (s.sale_type==='bulk' ? 'badge-yellow' : 'badge-blue')}>
                          {s.sale_type === 'bulk' ? '📦 Bulk' : '🛍️ Retail'}
                        </span>
                      </td>
                      <td className="font-medium">
                        {s.sale_type === 'bulk' ? (s.buyer?.full_name ?? '—') : (s.customers?.name ?? '—')}
                      </td>
                      <td className="muted">{s.salespersonRep?.full_name ?? '—'}</td>
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

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE — decide which dashboard to show
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { loading, isAdmin, isRider, isFactoryManager, canAccess, employeeId, employeeName } = useRole()

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Loading...</div>
      </div>
    </AppLayout>
  )

  if (isRider && employeeId) {
    return <RiderDashboard employeeId={employeeId} employeeName={employeeName} />
  }

  if (isAdmin || isFactoryManager || canAccess('dashboard')) {
    return <AdminDashboard employeeId={employeeId ?? undefined} isAdminUser={isAdmin} />
  }

  return <AccessDenied message="You do not have access to the Dashboard." />
}
