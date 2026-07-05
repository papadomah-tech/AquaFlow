'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, fmtDate} from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY DEPOSIT REPORT — Weekly Breakdown
// ─────────────────────────────────────────────────────────────────────────────
// Structure per week:
//   • Production (bags produced)
//   • Bulk Dispatches by rider (invoiced vs collected)
//   • Operational cash used (admin enters manually)
//   • Expected deposit = total collected − operational cash used
//   • Deposit button → writes to bank_deposits
// ─────────────────────────────────────────────────────────────────────────────

// Weeks always start from the 1st of the month.
// Week 1: 1st → first Saturday. Subsequent weeks: Monday → Saturday.
function getWeeks(year: number, month: number) {
  const weeks: { from: string; to: string; label: string }[] = []
  const lastDay = new Date(year, month, 0)   // last day of month
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  let cur = new Date(year, month - 1, 1)     // always start from 1st
  let weekNum = 1

  while (cur <= lastDay) {
    const from = new Date(cur)
    // Find end of this week: next Saturday or end of month
    const to = new Date(cur)
    while (to.getDay() !== 6 && to < lastDay) to.setDate(to.getDate() + 1)
    const toFinal = to > lastDay ? new Date(lastDay) : to

    weeks.push({ from: fmt(from), to: fmt(toFinal), label: `Week ${weekNum}` })
    weekNum++

    // Next week starts the Monday after this Saturday
    cur = new Date(toFinal)
    cur.setDate(cur.getDate() + 1)           // Sunday
    cur.setDate(cur.getDate() + 1)           // Monday
  }
  return weeks
}


// Price tiers (GHc per bag)
const PRICE_RIDER    = 6.0   // Bulk to riders / sales reps
const PRICE_EXTERNAL = 4.8   // Bulk to outside / wholesale customers
const PRICE_WALKIN   = 6.0   // Walk-in / direct retail

function WeeklyReportInner() {
  const now   = new Date()
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [weeks, setWeeks]       = useState<any[]>([])
  const [weekData, setWeekData] = useState<Record<string, any>>({})
  const [loading, setLoading]   = useState(false)

  // Per-week operational cash entered by admin
  const [opCash, setOpCash]     = useState<Record<string, string>>({})
  // Track which weeks are already deposited
  const [deposited, setDeposited] = useState<Record<string, any>>({})
  const [depositing, setDepositing] = useState<string | null>(null)
  const [depRef, setDepRef]     = useState<Record<string, string>>({})
  const [opDesc, setOpDesc]     = useState<Record<string, string>>({})
  const [physCount, setPhysCount] = useState<Record<string, string>>({})
  const [openingOpen, setOpeningOpen] = useState<Record<string, boolean>>({})
  const [prodOpen, setProdOpen]       = useState<Record<string, boolean>>({})
  const [dispOpen, setDispOpen]       = useState<Record<string, boolean>>({})
  const [actualStock, setActualStock] = useState<number>(0)

  const monthStr = `${selYear}-${String(selMonth).padStart(2,'0')}`

  const load = useCallback(async () => {
    setLoading(true)
    const ws = getWeeks(selYear, selMonth)
    setWeeks(ws)

    // Fetch all data for the month in one go
    const monthFrom = `${monthStr}-01`
    const monthTo   = `${selYear}-${String(selMonth).padStart(2,'0')}-${new Date(selYear, selMonth, 0).getDate()}`

    const [
      { data: batches },
      { data: bulkSales },
      { data: existingDeps },
      { data: allInventory },
      { data: allStockRaw },
    ] = await Promise.all([
      supabase.from('production_batches')
        .select('batch_date, bags_produced, roll_ref')
        .gte('batch_date', monthFrom).lte('batch_date', monthTo),
      supabase.from('sales')
        .select('sale_date,bags_sold,total_amount,amount_paid,outstanding_balance,payment_status,buyer:employees!buyer_employee_id(full_name),customers(name)')
        .eq('sale_type', 'bulk')
        .gte('sale_date', monthFrom).lte('sale_date', monthTo),
      supabase.from('bank_deposits')
        .select('*')
        .gte('deposit_date', monthFrom).lte('deposit_date', monthTo)
        .ilike('notes', '%Weekly Report%'),
      // All inventory up to end of month for running stock calc
      supabase.from('finished_inventory')
        .select('bags_in, bags_out, transaction_date, reference_type, notes')
        .lte('transaction_date', monthTo)
        .order('transaction_date'),
      // Current total stock (same as Stock module)
      supabase.from('finished_inventory')
        .select('bags_in, bags_out'),
    ])

    // Total current stock (matches Stock module exactly)
    const actualCurrentStock = (allStockRaw ?? [])
      .reduce((a: number, r: any) => a + (r.bags_in||0) - (r.bags_out||0), 0)
    setActualStock(actualCurrentStock)

    // Build per-week data
    const byWeek: Record<string, any> = {}
    ws.forEach(w => {
      const inRange = (d: string) => d >= w.from && d <= w.to

      // Production
      const wBatches = (batches ?? []).filter((b: any) => inRange(b.batch_date))
      const totalProduced = wBatches.reduce((a: number, b: any) => a + b.bags_produced, 0)

      // Bulk dispatches — group by rider
      const wBulk = (bulkSales ?? []).filter((s: any) => inRange(s.sale_date))
      const riderMap: Record<string, any> = {}
      wBulk.forEach((s: any) => {
        const name = s.buyer?.full_name ?? s.customers?.name ?? 'External'
        if (!riderMap[name]) riderMap[name] = { name, bags: 0, invoiced: 0, collected: 0, outstanding: 0 }
        riderMap[name].bags        += s.bags_sold
        riderMap[name].invoiced    += s.total_amount
        riderMap[name].collected   += s.amount_paid
        riderMap[name].outstanding += s.outstanding_balance
      })

      const totalInvoiced   = wBulk.reduce((a: number, s: any) => a + s.total_amount, 0)
      const totalCollected  = wBulk.reduce((a: number, s: any) => a + s.amount_paid, 0)
      const totalOutstanding= wBulk.reduce((a: number, s: any) => a + s.outstanding_balance, 0)

      // ── Stock reconciliation — MIRRORS Stock module exactly ──────────────
      // Stock module: bags_in - bags_out across ALL finished_inventory entries
      // We split that into: before-week (opening) + this-week (movement)

      // Opening stock = all inventory BEFORE this week
      const openingStock = (allInventory ?? [])
        .filter((r: any) => r.transaction_date < w.from)
        .reduce((a: number, r: any) => a + (r.bags_in||0) - (r.bags_out||0), 0)

      const openingEntries = (allInventory ?? [])
        .filter((r: any) => r.transaction_date < w.from)

      // This week's inventory entries — ALL of them (same as stock module)
      const weekEntries = (allInventory ?? [])
        .filter((r: any) => r.transaction_date >= w.from && r.transaction_date <= w.to)

      // Bags IN this week from inventory (production + adjustments)
      const weekAllBagsIn = weekEntries.reduce((a: number, r: any) => a + (r.bags_in||0), 0)

      // Bags IN from production_batches (for display — matches Production module)
      const weekProdIn = totalProduced  // shown in Produced label

      // Bags IN from adjustments (non-production)
      const weekAdjIn = weekEntries
        .filter((r: any) => r.bags_in > 0 && r.reference_type !== 'production')
        .reduce((a: number, r: any) => a + r.bags_in, 0)

      // Bags OUT this week — ALL (dispatches + write-offs etc)
      const weekDispOut = weekEntries.reduce((a: number, r: any) => a + (r.bags_out||0), 0)

      // Closing = opening + all bags_in this week − all bags_out this week
      // This EXACTLY matches the Stock module's current stock calculation
      const systemClosing = openingStock + weekAllBagsIn - weekDispOut

      // weekAdjOut kept for compat — already included in weekDispOut
      const weekAdjOut = 0

      // Reconciliation check: systemClosing should equal Stock module current stock
      // at the end of this week (for the last/current week, this IS current stock)

      // Revenue estimate per dispatch (per bag price tiers):
      // • Rider/rep (buyer_employee_id set)  → GHc 6.00
      // • Walk-in Customer (no employee, customer name = 'Walk-in Customer') → GHc 6.00
      // • Registered external/wholesale customer → GHc 4.80
      let estRevenue = 0
      let estRiderBags = 0, estWalkinBags = 0, estExternalBags = 0
      wBulk.forEach((s: any) => {
        const isRider   = !!s.buyer
        const isWalkin  = !s.buyer && (s.customers?.name === 'Walk-in Customer' || !s.customers?.name)
        const price     = (isRider || isWalkin) ? PRICE_RIDER : PRICE_EXTERNAL
        estRevenue     += s.bags_sold * price
        if (isRider)       estRiderBags    += s.bags_sold
        else if (isWalkin) estWalkinBags   += s.bags_sold
        else               estExternalBags += s.bags_sold
      })

      // Variance: expected dispatch from stock vs actual bulk records
      const stockVarianceBags = weekDispOut - wBulk.reduce((a: number, s: any) => a + s.bags_sold, 0)
      const collectionVariance = estRevenue - totalCollected

      // Check if already deposited this week
      const wDep = (existingDeps ?? []).find((d: any) =>
        d.notes?.includes(w.from)
      )

      byWeek[w.from] = {
        batches: wBatches, totalProduced,
        riders: Object.values(riderMap),
        totalInvoiced, totalCollected, totalOutstanding,
        deposit: wDep ?? null,
        // Stock reconciliation
        openingStock, openingEntries, weekAllBagsIn, weekProdIn, weekDispOut, weekAdjIn, weekAdjOut, systemClosing, estRiderBags, estWalkinBags, estExternalBags,
        estRevenue, stockVarianceBags, collectionVariance,
      }
    })

    setWeekData(byWeek)

    // Pre-fill deposited state
    const depMap: Record<string, any> = {}
    ws.forEach(w => { if (byWeek[w.from]?.deposit) depMap[w.from] = byWeek[w.from].deposit })
    setDeposited(depMap)

    setLoading(false)
  }, [selYear, selMonth, monthStr])

  useEffect(() => { load() }, [load])

  // ── Reverse a deposit ─────────────────────────────────────────────────────
  const reverseDeposit = async (week: any) => {
    const dep = deposited[week.from]
    if (!dep) return

    const confirmed = confirm(
      `Reverse this deposit?\n\n` +
      `Amount: ${fmtGhc(dep.amount)}\n` +
      `Date: ${fmtDate(dep.deposit_date)}\n\n` +
      `This will:\n` +
      `• Delete the bank deposit record\n` +
      `• Delete the linked operational expense (if any)\n` +
      `• Unlock this week for re-deposit`
    )
    if (!confirmed) return

    // Delete the deposit
    await supabase.from('bank_deposits').delete().eq('id', dep.id)

    // Delete matching operational expense from same day (if exists)
    const weekLabel = week.from
    await supabase.from('expenses')
      .delete()
      .eq('category', 'Operational Expense')
      .eq('expense_date', dep.deposit_date)
      .ilike('description', `%${weekLabel}%`)

    load()
  }

  const recordDeposit = async (week: any) => {
    const wd   = weekData[week.from]
    const op   = parseFloat(opCash[week.from] || '0') || 0
    const amt  = Math.max(0, (wd?.totalCollected ?? 0) - op)
    if (amt <= 0) { alert('No amount to deposit after operational cash deduction.'); return }

    const ref  = depRef[week.from] || ''
    setDepositing(week.from)

    const desc = opDesc[week.from] || `Operational cash — week ${fmtDate(week.from)} to ${fmtDate(week.to)}`

    // Record deposit + operational expense simultaneously
    await supabase.from('bank_deposits').insert({
      deposit_date:  today(),
      bank_name:     'Revenue Collection Account',
      amount:        amt,
      reference:     ref || null,
      deposited_by:  'Admin',
      notes:         `Weekly Report — ${week.from} | Collected: ${fmtGhc(wd.totalCollected)} − Ops: ${fmtGhc(op)} = ${fmtGhc(amt)}`,
    })

    // Record operational cash as expense if > 0
    if (op > 0) {
      await supabase.from('expenses').insert({
        expense_date: today(),
        category:     'Operational Expense',
        description:  desc,
        amount:       op,
        paid_to:      null,
      })
    }
    setDepositing(null)
    load()
  }

  const MONTHS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December']

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">📅 Monthly Deposit Report</h1>
          <div className="text-xs text-gray-400 mt-0.5">Weekly breakdown — bulk dispatches, production & deposits</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={selMonth} onChange={e => setSelMonth(parseInt(e.target.value))}
            className="form-select w-36">
            {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <select value={selYear} onChange={e => setSelYear(parseInt(e.target.value))}
            className="form-select w-24">
            {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} className="btn btn-primary">Generate</button>
        </div>
      </div>

      {/* Month summary hero */}
      {!loading && weeks.length > 0 && (() => {
        const totalProd = weeks.reduce((a,w) => a + (weekData[w.from]?.riders?.reduce((a2:number,r:any)=>a2+r.bags,0)||0), 0)
        const totalInv  = weeks.reduce((a,w) => a + (weekData[w.from]?.totalInvoiced||0), 0)
        const totalColl = weeks.reduce((a,w) => a + (weekData[w.from]?.totalCollected||0), 0)
        const totalDep  = weeks.reduce((a,w) => a + (weekData[w.from]?.deposit?.amount||0), 0)
        return (
          <div className="rounded-2xl p-5 mb-5 bg-[#1F4E79] text-white shadow-lg">
            <div className="text-blue-200 text-sm font-medium mb-1">
              {MONTHS[selMonth-1]} {selYear} — Monthly Summary
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
              {[
                ['Bags Dispatched',  fmtNum(totalProd)],
                ['Total Invoiced',   fmtGhc(totalInv)],
                ['Total Collected',  fmtGhc(totalColl)],
                ['Total Deposited',  fmtGhc(totalDep)],
              ].map(([l,v]) => (
                <div key={l} className="bg-white/10 rounded-xl p-3 text-center">
                  <div className="text-blue-200 text-xs">{l}</div>
                  <div className="text-white font-bold tabular-nums mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Building report...</div>
      ) : (
        <div className="space-y-6">
          {weeks.map((week, wi) => {
            const wd  = weekData[week.from] ?? {}
            const op  = parseFloat(opCash[week.from] || '0') || 0
            const exp = Math.max(0, (wd.totalCollected ?? 0) - op)
            const dep = deposited[week.from]
            const isDeposited = !!dep

            return (
              <div key={week.from} className={'card border-l-4 '
                + (isDeposited ? 'border-green-500' : 'border-[#1F4E79]')}>

                {/* Week header */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-4 pb-3 border-b border-gray-100">
                  <div>
                    <div className="font-bold text-[#1F4E79]">
                      {isDeposited && <span className="text-green-600 mr-1">✅</span>}
                      Week {wi + 1}
                    </div>
                    <div className="text-xs text-gray-400">{fmtDate(week.from)} → {fmtDate(week.to)}</div>
                  </div>
                  <div className="flex gap-2 flex-wrap text-center">
                    {[
                      ['Dispatched', fmtNum(wd.riders?.reduce((a:number,r:any)=>a+r.bags,0) ?? 0), '#1F4E79'],
                      ['Invoiced', fmtGhc(wd.totalInvoiced ?? 0), '#BF4D00'],
                      ['Collected', fmtGhc(wd.totalCollected ?? 0), '#1B5E20'],
                    ].map(([l,v,c]) => (
                      <div key={l} className="bg-gray-50 rounded-lg px-3 py-1.5 text-center">
                        <div className="text-xs text-gray-400">{l}</div>
                        <div className="font-bold text-sm tabular-nums" style={{color:c as string}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Production table */}
                {wd.batches?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      🏭 Production
                    </div>
                    <div className="overflow-x-auto">
                    <table className="data-table">
                      <colgroup>
                        <col style={{width:'100px'}} /><col />
                        <col style={{width:'100px'}} />
                      </colgroup>
                      <thead>
                        <tr><th>Date</th><th>Roll Film</th><th className="right">Bags Produced</th></tr>
                      </thead>
                      <tbody>
                        {wd.batches.map((b: any, i: number) => (
                          <tr key={i}>
                            <td className="muted">{fmtDate(b.batch_date)}</td>
                            <td className="muted">{b.roll_ref || '—'}</td>
                            <td className="num-green">+{fmtNum(b.bags_produced)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-green-700">
                          <td colSpan={2} className="py-1.5 px-3 text-white text-xs font-semibold">
                            TOTAL PRODUCED
                          </td>
                          <td className="py-1.5 px-3 text-white text-xs font-bold text-right tabular-nums">
                            {fmtNum(wd.totalProduced)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    </div>
                  </div>
                )}

                {/* Bulk dispatch table by rider */}
                {wd.riders?.length > 0 ? (
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      📦 Bulk Dispatches
                    </div>
                    <div className="overflow-x-auto">
                    <table className="data-table">
                      <colgroup>
                        <col /><col style={{width:'80px'}} />
                        <col style={{width:'105px'}} /><col style={{width:'105px'}} />
                        <col style={{width:'110px'}} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Rider / Customer</th><th className="right">Bags</th>
                          <th className="right">Invoiced</th><th className="right">Collected</th>
                          <th className="right">Outstanding</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wd.riders.map((r: any) => (
                          <tr key={r.name}>
                            <td className="font-medium">{r.name}</td>
                            <td className="num">{fmtNum(r.bags)}</td>
                            <td className="num">{fmtGhc(r.invoiced)}</td>
                            <td className="num-green">{fmtGhc(r.collected)}</td>
                            <td className={'num font-medium '
                              + (r.outstanding > 0 ? 'text-red-600' : 'text-gray-400')}>
                              {fmtGhc(r.outstanding)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#1F4E79]">
                          <td className="py-1.5 px-3 text-white text-xs font-semibold">TOTALS</td>
                          <td className="py-1.5 px-3 text-white text-xs font-bold text-right tabular-nums">
                            {fmtNum(wd.riders.reduce((a:number,r:any)=>a+r.bags,0))}
                          </td>
                          <td className="py-1.5 px-3 text-white text-xs font-bold text-right tabular-nums">
                            {fmtGhc(wd.totalInvoiced)}
                          </td>
                          <td className="py-1.5 px-3 text-white text-xs font-bold text-right tabular-nums">
                            {fmtGhc(wd.totalCollected)}
                          </td>
                          <td className="py-1.5 px-3 text-white text-xs font-bold text-right tabular-nums">
                            {fmtGhc(wd.totalOutstanding)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 mb-4 italic">No bulk dispatches this week.</div>
                )}


                {/* ── Stock & Revenue Reconciliation ─────────────────────── */}
                <div className="mb-4">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    📊 Stock &amp; Revenue Reconciliation
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                    {/* Stock movement */}
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                      <div className="text-xs font-semibold text-gray-500 mb-2">🧮 Bag Movement</div>
                      <div className="space-y-1.5">
                        {/* Opening stock — clickable drill-down */}
                        <div className="flex justify-between text-xs items-center">
                          <button
                            onClick={() => setOpeningOpen(p => ({...p, [week.from]: !p[week.from]}))}
                            className="text-blue-600 hover:underline text-left font-medium">
                            Opening Stock {openingOpen[week.from] ? '▲' : '▼'}
                          </button>
                          <span className="tabular-nums font-medium text-gray-600">
                            {fmtNum(wd.openingStock ?? 0)}
                          </span>
                        </div>
                        {openingOpen[week.from] && (
                          <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs space-y-1 max-h-48 overflow-y-auto mb-1">
                            {(wd.openingEntries ?? []).length === 0
                              ? <div className="text-gray-400 py-1">No entries before this week</div>
                              : (wd.openingEntries ?? []).map((e: any, i: number) => (
                                <div key={i} className="flex justify-between gap-2 py-0.5 border-b border-gray-50 last:border-0">
                                  <span className="text-gray-500">
                                    {fmtDate(e.transaction_date)}
                                    <span className="ml-1 text-gray-400 capitalize">{e.reference_type}</span>
                                  </span>
                                  <span className={e.bags_in > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                                    {e.bags_in > 0 ? `+${fmtNum(e.bags_in)}` : `-${fmtNum(e.bags_out)}`}
                                  </span>
                                </div>
                              ))}
                            <div className="flex justify-between pt-1 border-t border-gray-200 font-semibold">
                              <span className="text-gray-600">Total Opening</span>
                              <span className="text-[#1F4E79]">{fmtNum(wd.openingStock ?? 0)}</span>
                            </div>
                          </div>
                        )}
                        {/* Produced — clickable */}
                        <div>
                          <div className="flex justify-between text-xs items-center">
                            <button onClick={() => setProdOpen(p => ({...p, [week.from]: !p[week.from]}))}
                              className="text-green-700 hover:underline font-medium">
                              + Produced this week {prodOpen[week.from] ? '▲' : '▼'}
                            </button>
                            <span className="tabular-nums font-medium text-green-700">{fmtNum(wd.weekProdIn ?? 0)}</span>
                          </div>
                          {prodOpen[week.from] && (
                            <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs space-y-1 mt-1 mb-1">
                              {(wd.batches ?? []).length === 0
                                ? <div className="text-gray-400">No production this week</div>
                                : (wd.batches ?? []).map((b: any, i: number) => (
                                  <div key={i} className="flex justify-between">
                                    <span className="text-gray-500">{fmtDate(b.batch_date)} · {b.roll_ref || 'No roll'}</span>
                                    <span className="text-green-600 font-medium">+{fmtNum(b.bags_produced)}</span>
                                  </div>
                                ))}
                              <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                                <span>Total Produced</span>
                                <span className="text-green-700">{fmtNum(wd.totalProduced ?? 0)}</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Adjustments if any */}
                        {(wd.weekAdjIn ?? 0) > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-600">+ Adjustments In</span>
                            <span className="tabular-nums font-medium text-blue-600">{fmtNum(wd.weekAdjIn)}</span>
                          </div>
                        )}

                        {/* Dispatched — clickable */}
                        <div>
                          <div className="flex justify-between text-xs items-center">
                            <button onClick={() => setDispOpen(p => ({...p, [week.from]: !p[week.from]}))}
                              className="text-red-600 hover:underline font-medium">
                              − Dispatched (all out) {dispOpen[week.from] ? '▲' : '▼'}
                            </button>
                            <span className="tabular-nums font-medium text-red-600">{fmtNum(wd.weekDispOut ?? 0)}</span>
                          </div>
                          {dispOpen[week.from] && (
                            <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs space-y-1 mt-1 mb-1">
                              {(wd.riders ?? []).length === 0
                                ? <div className="text-gray-400">No dispatches this week</div>
                                : (wd.riders ?? []).map((r: any, i: number) => (
                                  <div key={i} className="flex justify-between">
                                    <span className="text-gray-500">{r.name}</span>
                                    <span className="text-red-600 font-medium">−{fmtNum(r.bags)}</span>
                                  </div>
                                ))}
                              <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                                <span>Total Dispatched</span>
                                <span className="text-red-700">{fmtNum(wd.weekDispOut ?? 0)}</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Closing stock + reconciliation check */}
                        <div className="flex justify-between text-xs items-center border-t border-gray-200 pt-1.5 mt-1">
                          <span className="font-bold text-[#1F4E79]">= System Closing Stock</span>
                          <span className="tabular-nums font-bold text-[#1F4E79]">{fmtNum(wd.systemClosing ?? 0)}</span>
                        </div>
                        {/* Stock reconciliation — shown on active/current week only */}
                        {(week.from <= today() && week.to >= today()) || wi === weeks.length - 1 ? (() => {
                          const gap = actualStock - (wd.systemClosing ?? 0)
                          const reconciled = Math.abs(gap) < 2
                          return (
                            <div className={'rounded-lg p-3 text-xs mt-3 border-2 '
                              + (reconciled
                                ? 'bg-green-50 border-green-400'
                                : 'bg-red-50 border-red-400')}>
                              <div className={'text-xs font-bold uppercase tracking-wide mb-2 '
                                + (reconciled ? 'text-green-700' : 'text-red-700')}>
                                🔍 Active Week Stock Verification
                              </div>
                              {/* Big comparison display */}
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                <div className={'rounded-lg p-2 text-center '
                                  + (reconciled ? 'bg-green-100' : 'bg-red-100')}>
                                  <div className="text-xs text-gray-500 mb-0.5">Weekly Closing Stock</div>
                                  <div className={'text-xl font-bold tabular-nums '
                                    + (reconciled ? 'text-green-700' : 'text-red-700')}>
                                    {fmtNum(wd.systemClosing ?? 0)}
                                  </div>
                                  <div className="text-xs text-gray-400">from reconciliation</div>
                                </div>
                                <div className={'rounded-lg p-2 text-center '
                                  + (reconciled ? 'bg-green-100' : 'bg-orange-100')}>
                                  <div className="text-xs text-gray-500 mb-0.5">Stock Module Total</div>
                                  <div className={'text-xl font-bold tabular-nums '
                                    + (reconciled ? 'text-green-700' : 'text-orange-700')}>
                                    {fmtNum(actualStock)}
                                  </div>
                                  <div className="text-xs text-gray-400">live from stock ledger</div>
                                </div>
                              </div>
                              {/* Verdict */}
                              <div className={'flex items-center justify-between rounded-lg p-2 '
                                + (reconciled ? 'bg-green-200' : 'bg-red-200')}>
                                <span className={'font-bold '
                                  + (reconciled ? 'text-green-800' : 'text-red-800')}>
                                  {reconciled ? '✅ All bags accounted for' : '⚠️ Unaccounted bags detected'}
                                </span>
                                <span className={'font-bold tabular-nums text-lg '
                                  + (reconciled ? 'text-green-800' : 'text-red-800')}>
                                  {gap === 0 ? '0' : (gap > 0 ? '+' : '')}{fmtNum(gap)} bags
                                </span>
                              </div>
                              {!reconciled && (
                                <div className="text-red-600 mt-2 text-xs">
                                  {gap > 0
                                    ? `${fmtNum(gap)} bags appear in the Stock module but are not captured in this week's production or dispatch records. Check for missing batch entries or unrecorded dispatches.`
                                    : `${fmtNum(Math.abs(gap))} bags are in this week's records but not in the Stock module. Check for duplicate entries or missing inventory postings.`}
                                </div>
                              )}
                            </div>
                          )
                        })() : null}
                        <div className="border-t border-gray-200 pt-1.5 mt-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-600">Physical Count (enter)</span>
                            <input
                              type="number" placeholder="0"
                              value={physCount[week.from] || ''}
                              onChange={e => setPhysCount(p => ({...p, [week.from]: e.target.value}))}
                              className="form-input w-24 text-right"
                              style={{padding:'0.2rem 0.4rem',fontSize:'0.75rem'}}
                            />
                          </div>
                          {physCount[week.from] && (() => {
                            const phys = parseInt(physCount[week.from]) || 0
                            const diff = phys - (wd.systemClosing ?? 0)
                            return (
                              <div className={'flex justify-between text-xs font-bold mt-1 '
                                + (Math.abs(diff) < 5 ? 'text-green-600' : 'text-red-600')}>
                                <span>Stock Variance</span>
                                <span>{diff >= 0 ? '+' : ''}{fmtNum(diff)} bags
                                  {Math.abs(diff) < 5 ? ' ✅' : ' ⚠️'}</span>
                              </div>
                            )
                          })()}
                          {Math.abs(wd.stockVarianceBags ?? 0) > 0 && (
                            <div className={'flex justify-between text-xs mt-1 '
                              + (Math.abs(wd.stockVarianceBags ?? 0) < 5 ? 'text-gray-500' : 'text-orange-600')}>
                              <span>Ledger vs Bulk Records</span>
                              <span className="font-medium">
                                {(wd.stockVarianceBags??0) >= 0 ? '+' : ''}{fmtNum(wd.stockVarianceBags ?? 0)} bags
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Revenue reconciliation */}
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                      <div className="text-xs font-semibold text-gray-500 mb-2">💰 Revenue Check</div>
                      <div className="space-y-1.5">
                        {/* Estimated revenue breakdown */}
                        <div className="bg-blue-50 rounded-lg p-2 text-xs space-y-1 mb-1">
                          <div className="font-semibold text-blue-700 mb-1">Estimated Revenue Breakdown</div>
                          {(wd.estRiderBags ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Riders/Reps ({fmtNum(wd.estRiderBags)} × GHc {PRICE_RIDER})</span>
                              <span className="tabular-nums text-[#1F4E79]">{fmtGhc((wd.estRiderBags ?? 0) * PRICE_RIDER)}</span>
                            </div>
                          )}
                          {(wd.estWalkinBags ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Walk-in ({fmtNum(wd.estWalkinBags)} × GHc {PRICE_RIDER})</span>
                              <span className="tabular-nums text-[#1F4E79]">{fmtGhc((wd.estWalkinBags ?? 0) * PRICE_RIDER)}</span>
                            </div>
                          )}
                          {(wd.estExternalBags ?? 0) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Wholesale/External ({fmtNum(wd.estExternalBags)} × GHc {PRICE_EXTERNAL})</span>
                              <span className="tabular-nums text-[#1F4E79]">{fmtGhc((wd.estExternalBags ?? 0) * PRICE_EXTERNAL)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold border-t border-blue-200 pt-1">
                            <span className="text-blue-800">Total Estimated</span>
                            <span className="tabular-nums text-[#1F4E79]">{fmtGhc(wd.estRevenue ?? 0)}</span>
                          </div>
                        </div>
                        {([
                          ['Actual Invoiced',    fmtGhc(wd.totalInvoiced ?? 0),   'text-gray-600'],
                          ['Actual Collected',   fmtGhc(wd.totalCollected ?? 0),  'text-green-700'],
                          ['Outstanding',        fmtGhc(wd.totalOutstanding ?? 0),'text-red-600'],
                        ] as [string,string,string][]).map(([l,v,c]) => (
                          <div key={l} className="flex justify-between text-xs">
                            <span className="text-gray-600">{l}</span>
                            <span className={'tabular-nums font-medium ' + c}>{v}</span>
                          </div>
                        ))}
                        <div className="border-t border-gray-200 pt-1.5 mt-1">
                          <div className={'flex justify-between text-xs font-bold '
                            + (Math.abs(wd.collectionVariance ?? 0) < 50 ? 'text-green-600' : 'text-orange-600')}>
                            <span>Est. vs Collected Gap</span>
                            <span>{(wd.collectionVariance??0) >= 0 ? '+' : ''}{fmtGhc(Math.abs(wd.collectionVariance ?? 0))}
                              {Math.abs(wd.collectionVariance ?? 0) < 50 ? ' ✅' : ' ⚠️'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Deposit section */}
                <div className={'rounded-xl p-4 overflow-hidden '
                  + (isDeposited ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200')}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    {isDeposited ? '✅ Deposit Recorded' : '💰 Deposit Calculation'}
                  </div>

                  {isDeposited ? (
                    <>
                    <div className="grid grid-cols-3 gap-3 text-center mb-3">
                      {[
                        ['Collected',   fmtGhc(wd.totalCollected),  '#1B5E20'],
                        ['Deposited',   fmtGhc(dep.amount),          '#1F4E79'],
                        ['Date',        fmtDate(dep.deposit_date),    '#374151'],
                      ].map(([l,v,c]) => (
                        <div key={l as string} className="bg-white rounded-lg p-2.5 text-center">
                          <div className="text-xs text-gray-500">{l}</div>
                          <div className="font-bold text-sm tabular-nums" style={{color:c as string}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => reverseDeposit(week)}
                      className="btn btn-danger btn-sm w-full">
                      🔄 Reverse / Correct this Deposit
                    </button>
                    <div className="text-xs text-red-400 mt-1 text-center">
                      This will delete the deposit and linked expense. You can then re-deposit correctly.
                    </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2 mb-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Total Cash Collected</span>
                          <span className="font-semibold text-green-700 tabular-nums">
                            {fmtGhc(wd.totalCollected ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">Cash used for operations</span>
                          <div className="flex items-center gap-2">
                            <span className="text-red-500">−</span>
                            <input
                              type="number" step="0.01" placeholder="0.00"
                              value={opCash[week.from] || ''}
                              onChange={e => setOpCash(p => ({...p, [week.from]: e.target.value}))}
                              className="form-input w-32 text-right"
                              style={{padding:'0.25rem 0.5rem',fontSize:'0.875rem'}}
                            />
                          </div>
                        </div>
                        <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-bold">
                          <span className="text-[#1F4E79]">Expected Deposit</span>
                          <span className={'tabular-nums '
                            + (exp >= 0 ? 'text-[#1F4E79]' : 'text-red-600')}>
                            {fmtGhc(exp)}
                          </span>
                        </div>
                      </div>

                      <div className="flex gap-2 items-center">
                        <input
                          type="text" placeholder="Reference (optional)"
                          value={depRef[week.from] || ''}
                          onChange={e => setDepRef(p => ({...p, [week.from]: e.target.value}))}
                          className="form-input flex-1"
                          style={{padding:'0.375rem 0.5rem',fontSize:'0.875rem'}}
                        />
                        <button
                          onClick={() => recordDeposit(week)}
                          disabled={depositing === week.from || exp <= 0 || !(wd.totalCollected > 0)}
                          className="btn btn-primary whitespace-nowrap">
                          {depositing === week.from
                            ? '⏳ Saving...'
                            : `🏦 Deposit ${fmtGhc(exp)}`}
                        </button>
                      </div>
                      <div className="text-xs text-gray-400 mt-1.5">
                        Will be recorded as a bank deposit to <strong>Revenue Collection Account</strong>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}

export default function WeeklyReportPage() {
  return (
    <ModuleGuard moduleKey="weekly-report" moduleLabel="Monthly Deposit Report">
      <WeeklyReportInner />
    </ModuleGuard>
  )
}
