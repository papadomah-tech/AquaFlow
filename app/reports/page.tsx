'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, monthStart, today, fmtDate} from '@/lib/supabase'
import { exportToCSV, exportSalesToCSV, exportExpensesToCSV } from '@/lib/exportExcel'

function ReportsPageInner() {
  const [tab, setTab]     = useState<'pl'|'salesperson'|'expenses'>('pl')
  const [filter, setFilter] = useState({ from: monthStart(), to: today() })
  const [plData, setPlData] = useState<any>(null)
  const [spData, setSpData] = useState<any[]>([])
  const [expData, setExpData] = useState<any[]>([])
  const [rawSales, setRawSales] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const loadPL = useCallback(async () => {
    setLoading(true)
    const [{ data: sales }, { data: exp }, { data: rm_cost }] = await Promise.all([
      supabase.from('sales').select('total_amount,amount_paid,outstanding_balance,bags_sold,sale_type,customers(name),employees!salesperson_id(full_name),buyer:employees!buyer_employee_id(full_name),unit_price,notes,sale_date,payment_status').gte('sale_date', filter.from).lte('sale_date', filter.to),
      supabase.from('expenses').select('amount,category,expense_date,description,paid_to').gte('expense_date', filter.from).lte('expense_date', filter.to),
      supabase.from('raw_material_purchases').select('total_cost').gte('purchase_date', filter.from).lte('purchase_date', filter.to),
    ])
    const allSales  = sales ?? []
    const retail    = allSales.filter((s:any) => s.sale_type !== 'bulk')
    const bulk      = allSales.filter((s:any) => s.sale_type === 'bulk')
    setRawSales(allSales)

    const totalRevenue  = retail.reduce((a:number,s:any) => a + s.total_amount, 0)
    const cashCollected = retail.reduce((a:number,s:any) => a + s.amount_paid, 0)
    const outstanding   = retail.reduce((a:number,s:any) => a + s.outstanding_balance, 0)
    const bagsSold      = retail.reduce((a:number,s:any) => a + s.bags_sold, 0)
    const bulkRev       = bulk.reduce((a:number,s:any) => a + s.total_amount, 0)
    const totalExpenses = (exp ?? []).reduce((a:number,e:any) => a + e.amount, 0)
    const rmCost        = (rm_cost ?? []).reduce((a:number,r:any) => a + r.total_cost, 0)
    const salaries      = (exp ?? []).filter((e:any) => e.category==='Salary').reduce((a:number,e:any) => a + e.amount, 0)
    const opFee         = (exp ?? []).filter((e:any) => e.category==='Operator Fee').reduce((a:number,e:any) => a + e.amount, 0)
    const otherExp      = totalExpenses - salaries - opFee
    const grossProfit   = totalRevenue - totalExpenses

    setPlData({ totalRevenue, cashCollected, outstanding, bagsSold, bulkRev, totalExpenses, rmCost, salaries, opFee, otherExp, grossProfit })
    setExpData(exp ?? [])
    setLoading(false)
  }, [filter])

  const loadSalesperson = useCallback(async () => {
    setLoading(true)
    const { data: emp } = await supabase.from('employees').select('id,full_name,role').eq('status','active').order('full_name')
    const results = await Promise.all((emp ?? []).map(async (e:any) => {
      const { data: sales } = await supabase.from('sales').select('bags_sold,total_amount,amount_paid,outstanding_balance').eq('salesperson_id', e.id).eq('sale_type','retail').gte('sale_date', filter.from).lte('sale_date', filter.to)
      const revenue    = (sales ?? []).reduce((a:number,s:any) => a + s.total_amount, 0)
      const collected  = (sales ?? []).reduce((a:number,s:any) => a + s.amount_paid, 0)
      const outstanding= (sales ?? []).reduce((a:number,s:any) => a + s.outstanding_balance, 0)
      const bags       = (sales ?? []).reduce((a:number,s:any) => a + s.bags_sold, 0)
      return { ...e, revenue, collected, outstanding, bags, invoices: (sales ?? []).length, collRate: revenue > 0 ? (collected/revenue*100).toFixed(1) : '0.0' }
    }))
    setSpData(results.filter(r => r.invoices > 0).sort((a,b) => b.revenue - a.revenue))
    setLoading(false)
  }, [filter])

  useEffect(() => { if (tab === 'pl' || tab === 'expenses') loadPL(); else loadSalesperson() }, [tab, loadPL, loadSalesperson])

  // ── Export functions ──────────────────────────────────────────────────────
  const downloadPL = () => {
    if (!plData) return
    exportToCSV('profit_and_loss', [
      { Section:'REVENUE', Item:'Total Retail Revenue', 'Amount (GHc)': plData.totalRevenue },
      { Section:'REVENUE', Item:'Cash Collected', 'Amount (GHc)': plData.cashCollected },
      { Section:'REVENUE', Item:'Outstanding', 'Amount (GHc)': plData.outstanding },
      { Section:'REVENUE', Item:'Retail Bags Sold', 'Amount (GHc)': plData.bagsSold },
      { Section:'REVENUE', Item:'Bulk Dispatch Revenue', 'Amount (GHc)': plData.bulkRev },
      { Section:'EXPENSES', Item:'Raw Materials', 'Amount (GHc)': plData.rmCost },
      { Section:'EXPENSES', Item:'Operator Fees', 'Amount (GHc)': plData.opFee },
      { Section:'EXPENSES', Item:'Salaries', 'Amount (GHc)': plData.salaries },
      { Section:'EXPENSES', Item:'Other Expenses', 'Amount (GHc)': plData.otherExp },
      { Section:'EXPENSES', Item:'TOTAL EXPENSES', 'Amount (GHc)': plData.totalExpenses },
      { Section:'PROFIT', Item:'GROSS PROFIT', 'Amount (GHc)': plData.grossProfit },
    ])
  }

  const downloadSales = () => exportSalesToCSV(rawSales, 'all_sales')

  const downloadSalesperson = () => {
    exportToCSV('salesperson_report', spData.map(s => ({
      Name: s.full_name, Role: s.role,
      Invoices: s.invoices, 'Bags Sold': s.bags,
      'Revenue (GHc)': s.revenue, 'Collected (GHc)': s.collected,
      'Outstanding (GHc)': s.outstanding, 'Collection %': s.collRate + '%',
    })))
  }

  const downloadExpenses = () => exportExpensesToCSV(expData, 'expenses_report')

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">📈 Reports</h1>
      </div>

      {/* Filter bar */}
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label>
          <input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36"/></div>
        <div><label className="form-label">To</label>
          <input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36"/></div>
        <button onClick={()=>setFilter({from:monthStart(),to:today()})} className="btn btn-secondary">This Month</button>
        <button onClick={()=>setFilter({from:'2000-01-01',to:today()})} className="btn btn-secondary">All Time</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {([['pl','Profit & Loss'],['salesperson','Salesperson'],['expenses','Expenses']] as const).map(([t,l]) => (
          <button key={t} onClick={()=>setTab(t)}
            className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
              + (tab===t ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {l}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : (
        <>
          {/* P&L TAB */}
          {tab === 'pl' && plData && (
            <>
              <div className="flex gap-2 mb-4 flex-wrap">
                <button onClick={downloadPL} className="btn btn-secondary btn-sm">⬇ Download P&L (Excel)</button>
                <button onClick={downloadSales} className="btn btn-secondary btn-sm">⬇ Download All Sales (Excel)</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  ['Retail Revenue',   fmtGhc(plData.totalRevenue),  '#1F4E79'],
                  ['Cash Collected',   fmtGhc(plData.cashCollected), '#1B5E20'],
                  ['Outstanding',      fmtGhc(plData.outstanding),   '#C00000'],
                  ['Bags Sold',        fmtNum(plData.bagsSold),      '#2E75B6'],
                  ['Bulk Revenue',     fmtGhc(plData.bulkRev),       '#4A148C'],
                  ['Total Expenses',   fmtGhc(plData.totalExpenses), '#BF4D00'],
                  ['Gross Profit',     fmtGhc(plData.grossProfit),   plData.grossProfit>=0?'#1B5E20':'#C00000'],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="stat-card" style={{borderLeftColor: c as string}}>
                    <div className="text-xs text-gray-500">{l}</div>
                    <div className="font-bold" style={{color: c as string}}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Expense Breakdown</div>
                <table className="data-table">
                  <colgroup><col/><col style={{width:'120px'}}/><col style={{width:'100px'}}/></colgroup>
                  <thead><tr><th>Category</th><th className="right">Amount</th><th className="right">% of Revenue</th></tr></thead>
                  <tbody>
                    {[['Raw Materials',plData.rmCost],['Operator Fees',plData.opFee],['Salaries',plData.salaries],['Other',plData.otherExp]].map(([l,v]) => (
                      <tr key={l as string}>
                        <td>{l}</td>
                        <td className="num">{fmtGhc(v as number)}</td>
                        <td className="num">{plData.totalRevenue > 0 ? ((v as number)/plData.totalRevenue*100).toFixed(1)+'%' : '—'}</td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-gray-50">
                      <td>TOTAL EXPENSES</td>
                      <td className="num">{fmtGhc(plData.totalExpenses)}</td>
                      <td className="num">{plData.totalRevenue > 0 ? (plData.totalExpenses/plData.totalRevenue*100).toFixed(1)+'%' : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* SALESPERSON TAB */}
          {tab === 'salesperson' && (
            <>
              <div className="flex gap-2 mb-4">
                <button onClick={downloadSalesperson} className="btn btn-secondary btn-sm">⬇ Download Salesperson Report (Excel)</button>
              </div>
              <div className="card">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <colgroup><col/><col style={{width:'90px'}}/><col style={{width:'55px'}}/><col style={{width:'75px'}}/><col style={{width:'105px'}}/><col style={{width:'105px'}}/><col style={{width:'105px'}}/><col style={{width:'80px'}}/></colgroup>
                    <thead><tr><th>Salesperson</th><th>Role</th><th className="right">Inv.</th><th className="right">Bags</th><th className="right">Revenue</th><th className="right">Collected</th><th className="right">Outstanding</th><th className="right">Coll.%</th></tr></thead>
                    <tbody>
                      {spData.length === 0
                        ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No data</td></tr>
                        : spData.map((s:any) => (
                        <tr key={s.id}>
                          <td className="font-medium">{s.full_name}</td>
                          <td className="muted">{s.role}</td>
                          <td className="num">{s.invoices}</td>
                          <td className="num">{fmtNum(s.bags)}</td>
                          <td className="num">{fmtGhc(s.revenue)}</td>
                          <td className="num-green">{fmtGhc(s.collected)}</td>
                          <td className="num-red">{fmtGhc(s.outstanding)}</td>
                          <td><span className={'badge '+(parseFloat(s.collRate)>=90?'badge-green':parseFloat(s.collRate)>=70?'badge-yellow':'badge-red')}>{s.collRate}%</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* EXPENSES TAB */}
          {tab === 'expenses' && (
            <>
              <div className="flex gap-2 mb-4">
                <button onClick={downloadExpenses} className="btn btn-secondary btn-sm">⬇ Download Expenses (Excel)</button>
              </div>
              <div className="card">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <colgroup><col style={{width:'90px'}}/><col style={{width:'120px'}}/><col/><col style={{width:'110px'}}/><col style={{width:'110px'}}/></colgroup>
                    <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid To</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {expData.length === 0
                        ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">No expenses in this period</td></tr>
                        : expData.map((e:any,i:number) => (
                        <tr key={i}>
                          <td className="muted">{fmtDate(e.expense_date)}</td>
                          <td><span className="badge badge-gray">{e.category}</span></td>
                          <td className="text-sm">{e.description}</td>
                          <td className="muted">{e.paid_to||'—'}</td>
                          <td className="num-red">{fmtGhc(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {expData.length > 0 && (
                      <tfoot><tr className="bg-red-700">
                        <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">TOTAL</td>
                        <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                          {fmtGhc(expData.reduce((a:number,e:any)=>a+e.amount,0))}
                        </td>
                      </tr></tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </AppLayout>
  )
}

export default function ReportsPage() {
  return <ModuleGuard moduleKey="reports" moduleLabel="Reports"><ReportsPageInner /></ModuleGuard>
}
