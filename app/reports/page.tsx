'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, monthStart, today } from '@/lib/supabase'

function ReportsPageInner() {
  const [tab, setTab] = useState<'pl'|'salesperson'>('pl')
  const [filter, setFilter] = useState({ from: monthStart(), to: today() })
  const [plData, setPlData] = useState<any>(null)
  const [spData, setSpData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const loadPL = useCallback(async () => {
    setLoading(true)
    const [{ data: sales }, { data: payments }, { data: exp }, { data: rm_cost }, { data: fi }] = await Promise.all([
      supabase.from('sales').select('total_amount,amount_paid,outstanding_balance,bags_sold').gte('sale_date', filter.from).lte('sale_date', filter.to),
      supabase.from('payments').select('amount').gte('payment_date', filter.from).lte('payment_date', filter.to),
      supabase.from('expenses').select('amount,category').gte('expense_date', filter.from).lte('expense_date', filter.to),
      supabase.from('raw_material_purchases').select('total_cost').gte('purchase_date', filter.from).lte('purchase_date', filter.to),
      supabase.from('finished_inventory').select('bags_in,bags_out'),
    ])
    const totalRevenue   = (sales ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
    const cashCollected  = (payments ?? []).reduce((a: number, p: any) => a + p.amount, 0)
    const outstanding    = (sales ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
    const bagsSold       = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalExpenses  = (exp ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const rmCost         = (rm_cost ?? []).reduce((a: number, r: any) => a + r.total_cost, 0)
    const opFee          = (exp ?? []).filter((e: any) => e.category === 'Operator Fee').reduce((a: number, e: any) => a + e.amount, 0)
    const salaries       = (exp ?? []).filter((e: any) => e.category === 'Salary').reduce((a: number, e: any) => a + e.amount, 0)
    const otherExp       = totalExpenses - opFee - salaries
    const grossProfit    = totalRevenue - totalExpenses
    const grossMargin    = totalRevenue > 0 ? (grossProfit / totalRevenue * 100).toFixed(1) : '0.0'
    const bagsInStock    = (fi ?? []).reduce((a: number, r: any) => a + r.bags_in - r.bags_out, 0)
    const collRate       = totalRevenue > 0 ? (cashCollected / totalRevenue * 100).toFixed(1) : '0.0'
    setPlData({ totalRevenue, cashCollected, outstanding, bagsSold, totalExpenses, rmCost, opFee, salaries, otherExp, grossProfit, grossMargin, bagsInStock, collRate })
    setLoading(false)
  }, [filter])

  const loadSalesperson = useCallback(async () => {
    setLoading(true)
    const { data: emp } = await supabase.from('employees').select('id,full_name,role,salary,sales_target_daily,working_days').eq('status','active').order('full_name')
    const results = await Promise.all((emp ?? []).map(async (e: any) => {
      const { data: sales } = await supabase.from('sales').select('bags_sold,total_amount,amount_paid,outstanding_balance').eq('salesperson_id', e.id).gte('sale_date', filter.from).lte('sale_date', filter.to)
      const revenue     = (sales ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
      const collected   = (sales ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)
      const outstanding = (sales ?? []).reduce((a: number, s: any) => a + s.outstanding_balance, 0)
      const bags        = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
      const collRate    = revenue > 0 ? (collected / revenue * 100).toFixed(1) : '0.0'
      return { ...e, revenue, collected, outstanding, bags, collRate, invoices: (sales ?? []).length }
    }))
    setSpData(results.sort((a, b) => b.revenue - a.revenue))
    setLoading(false)
  }, [filter])

  useEffect(() => { if (tab === 'pl') loadPL(); else loadSalesperson() }, [tab, loadPL, loadSalesperson])

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36" /></div>
        <button onClick={() => setFilter({from:monthStart(),to:today()})} className="btn btn-secondary">This Month</button>
        <button onClick={() => setFilter({from:'2000-01-01',to:today()})} className="btn btn-secondary">All Time</button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['pl','salesperson'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={'btn btn-sm ' + (tab===t?'btn-primary':'btn-secondary')}>
            {t==='pl' ? 'Profit & Loss' : 'Salesperson Report'}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {/* P&L TAB */}
          {tab === 'pl' && plData && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  ['Total Revenue', fmtGhc(plData.totalRevenue), '#1F4E79'],
                  ['Cash Collected', fmtGhc(plData.cashCollected), '#1B5E20'],
                  ['Outstanding', fmtGhc(plData.outstanding), '#C00000'],
                  ['Collection Rate', plData.collRate + '%', plData.collRate >= 90 ? '#1B5E20' : '#BF4D00'],
                  ['Bags Sold', fmtNum(plData.bagsSold), '#2E75B6'],
                  ['Bags in Stock', fmtNum(plData.bagsInStock), '#4A148C'],
                  ['Total Expenses', fmtGhc(plData.totalExpenses), '#C00000'],
                  ['Gross Profit', fmtGhc(plData.grossProfit), plData.grossProfit >= 0 ? '#1B5E20' : '#C00000'],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="stat-card" style={{borderLeftColor:c as string}}>
                    <div className="text-xs text-gray-500">{l}</div>
                    <div className="font-bold" style={{color:c as string}}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Expense Breakdown</div>
                <table className="data-table">
                  <thead><tr><th>Category</th><th className="text-right">Amount</th><th className="text-right">% of Revenue</th></tr></thead>
                  <tbody>
                    {[
                      ['Raw Materials', plData.rmCost],
                      ['Operator Fees', plData.opFee],
                      ['Salaries', plData.salaries],
                      ['Other', plData.otherExp],
                    ].map(([l,v]) => (
                      <tr key={l as string}>
                        <td>{l}</td>
                        <td className="text-right">{fmtGhc(v as number)}</td>
                        <td className="text-right">{plData.totalRevenue > 0 ? ((v as number)/plData.totalRevenue*100).toFixed(1) + '%' : '-'}</td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-gray-50">
                      <td>TOTAL EXPENSES</td>
                      <td className="text-right">{fmtGhc(plData.totalExpenses)}</td>
                      <td className="text-right">{plData.totalRevenue > 0 ? (plData.totalExpenses/plData.totalRevenue*100).toFixed(1) + '%' : '-'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* SALESPERSON TAB */}
          {tab === 'salesperson' && (
            <div className="card">
              <table className="data-table">
                <colgroup>
                <col /><col style={{width:'90px'}} />
                <col style={{width:'55px'}} /><col style={{width:'75px'}} />
                <col style={{width:'105px'}} /><col style={{width:'105px'}} />
                <col style={{width:'105px'}} /><col style={{width:'80px'}} />
              </colgroup>
              <thead><tr>
                <th>Salesperson</th><th>Role</th>
                <th className="right">Inv.</th><th className="right">Bags</th>
                <th className="right">Revenue</th><th className="right">Collected</th>
                <th className="right">Outstanding</th><th className="right">Coll.%</th>
              </tr></thead>
                <tbody>
                  {spData.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No data</td></tr>
                  : spData.map((s: any) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.full_name}</td>
                      <td className="muted">{s.role}</td>
                      <td className="num">{s.invoices}</td>
                      <td className="num">{fmtNum(s.bags)}</td>
                      <td className="num">{fmtGhc(s.revenue)}</td>
                      <td className="num-green">{fmtGhc(s.collected)}</td>
                      <td className="num-red">{fmtGhc(s.outstanding)}</td>
                      <td className="text-right">
                        <span className={'badge ' + (parseFloat(s.collRate) >= 90 ? 'badge-green' : parseFloat(s.collRate) >= 70 ? 'badge-yellow' : 'badge-red')}>
                          {s.collRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppLayout>
  )
}

export default function ReportsPage() {
  return (
    <ModuleGuard moduleKey="reports" moduleLabel="Reports">
      <ReportsPageInner />
    </ModuleGuard>
  )
}
