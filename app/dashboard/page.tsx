'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [recent, setRecent] = useState<any[]>([])
  const [period, setPeriod] = useState<'today'|'month'|'all'>('month')
  const [loading, setLoading] = useState(true)

  const dateFrom = period === 'today' ? today() : period === 'month' ? monthStart() : '2000-01-01'

  const loadData = useCallback(async () => {
    setLoading(true)
    const [{ data: sales }, { data: fi }, { data: exp }, { data: rm }] = await Promise.all([
      supabase.from('sales').select('total_amount,amount_paid,outstanding_balance,bags_sold').gte('sale_date', dateFrom),
      supabase.from('finished_inventory').select('bags_in,bags_out'),
      supabase.from('expenses').select('amount').gte('expense_date', dateFrom),
      supabase.from('raw_materials').select('current_stock,low_stock_threshold'),
    ])

    const totalRevenue  = (sales ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
    const cashCollected = (sales ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
    const outstanding   = (sales ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const bagsSold      = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalExpenses = (exp ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const bagsInStock   = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
    const lowStock      = (rm ?? []).filter((m: any) => m.current_stock <= m.low_stock_threshold).length

    const { data: todayProd } = await supabase.from('production_batches').select('bags_produced').eq('batch_date', today())
    const todayBags = (todayProd ?? []).reduce((a: number, r: any) => a + r.bags_produced, 0)

    setStats({ totalRevenue, cashCollected, outstanding, bagsSold, bagsInStock, todayBags, lowStock, totalExpenses })

    const { data: recSales } = await supabase
      .from('sales').select('id,sale_date,customers(name),bags_sold,total_amount,payment_status')
      .gte('sale_date', dateFrom).order('created_at', { ascending: false }).limit(10)
    setRecent((recSales ?? []).map((s: any) => ({
      ...s, customer_name: s.customers?.name ?? 'Unknown'
    })))
    setLoading(false)
  }, [period])

  useEffect(() => { loadData() }, [loadData])

  const CARDS = stats ? [
    { label: 'Revenue',      value: fmtGhc(stats.totalRevenue),  color: '#1F4E79' },
    { label: 'Bags Sold',    value: fmtNum(stats.bagsSold),       color: '#2E75B6' },
    { label: 'Collected',    value: fmtGhc(stats.cashCollected),  color: '#1B5E20' },
    { label: 'Outstanding',  value: fmtGhc(stats.outstanding),    color: '#C00000' },
    { label: 'Bags in Stock',value: fmtNum(stats.bagsInStock),    color: '#4A148C' },
    { label: "Today's Prod.",value: fmtNum(stats.todayBags),      color: '#00695C' },
    { label: 'Expenses',     value: fmtGhc(stats.totalExpenses),  color: '#BF4D00' },
    { label: 'Low Stock',    value: stats.lowStock + ' items',    color: stats.lowStock > 0 ? '#C00000' : '#1B5E20' },
  ] : []

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div className="flex gap-2">
          {(['today','month','all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={'btn btn-sm ' + (period === p ? 'btn-primary' : 'btn-secondary')}>
              {p === 'today' ? 'Today' : p === 'month' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>
      {loading ? <div className="text-center py-16 text-gray-400">Loading...</div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {CARDS.map(c => (
              <div key={c.label} className="stat-card" style={{ borderLeftColor: c.color }}>
                <div className="text-xs text-gray-500 font-medium">{c.label}</div>
                <div className="text-lg font-bold mt-0.5" style={{ color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Sales</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Customer</th><th className="text-right">Bags</th><th className="text-right">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {recent.length === 0
                    ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">No sales in this period</td></tr>
                    : recent.map((s: any) => (
                    <tr key={s.id}>
                      <td className="text-gray-500 text-xs">{s.sale_date}</td>
                      <td className="font-medium">{s.customer_name}</td>
                      <td className="text-right">{fmtNum(s.bags_sold)}</td>
                      <td className="text-right font-medium">{fmtGhc(s.total_amount)}</td>
                      <td>
                        <span className={'badge ' + (s.payment_status === 'paid' ? 'badge-green' : s.payment_status === 'partial' ? 'badge-yellow' : 'badge-red')}>
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
