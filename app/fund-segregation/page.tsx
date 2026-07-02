'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today, monthStart } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// FUND SEGREGATION MODULE
// ─────────────────────────────────────────────────────────────────────────────
// Breaks down every Ghana Cedi collected from sales into its cost buckets,
// showing which funds are ring-fenced (must not be touched) vs available.
//
// Ring-fenced (🔒):
//   • Roll Film cost
//   • Packaging Bags cost
//   • Water cost
//   • Operator Fee
//   • Performance Pay (base pay + feeding fee)
//   • Rider Fuel Allowance
//
// Remaining buckets shown for admin to decide:
//   • Labor / Overhead
//   • Profit / Surplus
// ─────────────────────────────────────────────────────────────────────────────

// Default cost rates — match pricing module defaults
const DEFAULTS = {
  roll_cost_per_kg:    45,
  bags_per_kg:         20,
  pkg_bulk_qty:        1000,
  pkg_bulk_cost:       640,
  water_cost_per_liter:0.0318,
  liters_per_bag:      15,     // 30 sachets × 0.5L
  operator_fee_per_100:30,     // GH₵30 per 100 bags
  labor_per_bag:       0.50,
  utility_per_bag:     0.20,
  machine_per_bag:     0.10,
  fuel_per_rider_day:  50,
  riders:              2,
  working_days:        26,
}

function FundSegregationInner() {
  const [period, setPeriod]   = useState({ from: monthStart(), to: today() })
  const [rates, setRates]     = useState(DEFAULTS)
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const [tab, setTab] = useState<'summary'|'dispatches'>('summary')
  const [dispatches, setDispatches] = useState<any[]>([])
  const [loadingDisp, setLoadingDisp] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    // ── Actual sales in period ───────────────────────────────────────────────
    const { data: sales } = await supabase.from('sales')
      .select('bags_sold, total_amount, unit_price, sale_type')
      .gte('sale_date', period.from).lte('sale_date', period.to)

    const totalBagsSold   = (sales ?? []).reduce((a: number, s: any) => a + s.bags_sold, 0)
    const totalRevenue    = (sales ?? []).reduce((a: number, s: any) => a + s.total_amount, 0)
    const avgUnitPrice    = totalBagsSold > 0 ? totalRevenue / totalBagsSold : 0

    // ── Actual production in period ──────────────────────────────────────────
    const { data: batches } = await supabase.from('production_batches')
      .select('bags_produced, roll_kg_used')
      .gte('batch_date', period.from).lte('batch_date', period.to)

    const totalBagsProd = (batches ?? []).reduce((a: number, b: any) => a + b.bags_produced, 0)
    const totalKgUsed   = (batches ?? []).reduce((a: number, b: any) => a + (b.roll_kg_used ?? 0), 0)

    // ── Actual expenses in period ────────────────────────────────────────────
    const { data: expenses } = await supabase.from('expenses')
      .select('amount, category')
      .gte('expense_date', period.from).lte('expense_date', period.to)

    const actualOpFee   = (expenses ?? []).filter((e: any) => e.category === 'Operator Fee')
      .reduce((a: number, e: any) => a + e.amount, 0)
    const actualPerfPay = (expenses ?? []).filter((e: any) =>
      ['Performance Pay', 'Feeding Fee'].includes(e.category))
      .reduce((a: number, e: any) => a + e.amount, 0)
    const actualOther   = (expenses ?? []).filter((e: any) =>
      !['Operator Fee','Performance Pay','Feeding Fee','Imprest Advance','Imprest Refund'].includes(e.category))
      .reduce((a: number, e: any) => a + e.amount, 0)

    // ── Actual salary payments in period ─────────────────────────────────────
    const { data: salPayments } = await supabase.from('salary_payments')
      .select('amount, payment_type')
      .gte('payment_date', period.from).lte('payment_date', period.to)
      .in('payment_type', ['performance', 'feeding'])
    const actualSalary = (salPayments ?? []).reduce((a: number, p: any) => a + p.amount, 0)

    // ── Cash position cross-check ─────────────────────────────────────────────
    // Total cash collected from ALL sales (retail + bulk)
    const { data: allSales } = await supabase.from('sales')
      .select('amount_paid, sale_type')
      .gte('sale_date', period.from).lte('sale_date', period.to)
    const cashCollected = (allSales ?? []).reduce((a: number, s: any) => a + s.amount_paid, 0)

    // Total banked in period
    const { data: bankDeps } = await supabase.from('bank_deposits')
      .select('amount')
      .gte('deposit_date', period.from).lte('deposit_date', period.to)
    const totalBanked = (bankDeps ?? []).reduce((a: number, d: any) => a + d.amount, 0)

    // Total ALL expenses in period (everything paid out)
    const { data: allExp } = await supabase.from('expenses')
      .select('amount, category')
      .gte('expense_date', period.from).lte('expense_date', period.to)
    const totalAllExpenses = (allExp ?? []).reduce((a: number, e: any) => a + e.amount, 0)

    // Unaccounted expenses = all expenses minus the ones the module already tracks
    const trackedExpCategories = ['Operator Fee','Performance Pay','Feeding Fee']
    const trackedExpenses = (allExp ?? [])
      .filter((e: any) => trackedExpCategories.includes(e.category))
      .reduce((a: number, e: any) => a + e.amount, 0)
    const unaccountedExp = totalAllExpenses - trackedExpenses

    const cashOnHand     = cashCollected - totalBanked
    const cashExpected   = 0  // computed below after surplus calc

    // ── Per-bag cost calculations ────────────────────────────────────────────
    const roll_pb    = rates.roll_cost_per_kg / rates.bags_per_kg
    const pkg_pb     = rates.pkg_bulk_cost / rates.pkg_bulk_qty
    const water_pb   = rates.water_cost_per_liter * rates.liters_per_bag
    const op_pb      = rates.operator_fee_per_100 / 100
    const labor_pb   = rates.labor_per_bag
    const utility_pb = rates.utility_per_bag
    const machine_pb = rates.machine_per_bag

    // Fuel removed from ring-fenced calculations
    const totalFuel  = 0
    const fuel_pb    = 0

    // Performance pay per bag (based on actual paid in period)
    const perf_pb    = totalBagsSold > 0 ? actualSalary / totalBagsSold : 0

    const rawMat_pb  = roll_pb + pkg_pb + water_pb
    const ringFenced_pb = rawMat_pb + op_pb + perf_pb + fuel_pb
    const overhead_pb   = labor_pb + utility_pb + machine_pb
    const profit_pb     = avgUnitPrice - ringFenced_pb - overhead_pb

    // ── Aggregate (period totals) ────────────────────────────────────────────
    const bags = totalBagsSold || 1  // avoid division by zero

    // Ring-fenced aggregates
    const agg_roll    = roll_pb   * totalBagsSold
    const agg_pkg     = pkg_pb    * totalBagsSold
    const agg_water   = water_pb  * totalBagsSold
    const agg_opFee   = actualOpFee   // actual from expenses
    const agg_perf    = actualSalary  // actual paid
    const agg_fuel    = 0  // fuel removed
    const agg_ringFenced = agg_roll + agg_pkg + agg_water + agg_opFee + agg_perf + agg_fuel

    // Non-ring-fenced
    const agg_labor   = labor_pb   * totalBagsSold
    const agg_utility = utility_pb * totalBagsSold
    const agg_machine = machine_pb * totalBagsSold
    const agg_overhead = agg_labor + agg_utility + agg_machine
    const agg_profit  = totalRevenue - agg_ringFenced - agg_overhead

    setData({
      // Summary
      totalBagsSold, totalBagsProd, totalRevenue, avgUnitPrice, totalKgUsed,
      // Cash cross-check
      cashCollected, totalBanked, cashOnHand,
      totalAllExpenses, trackedExpenses, unaccountedExp,
      // Per bag
      roll_pb, pkg_pb, water_pb, op_pb, perf_pb, fuel_pb,
      rawMat_pb, ringFenced_pb, overhead_pb, profit_pb,
      labor_pb, utility_pb, machine_pb,
      // Aggregates
      agg_roll, agg_pkg, agg_water, agg_opFee, agg_perf, agg_fuel,
      agg_ringFenced, agg_labor, agg_utility, agg_machine, agg_overhead,
      agg_profit, agg_other: actualOther,
      // Rates
      totalFuel,
    })
    setLoading(false)
  }, [period, rates])

  useEffect(() => { load() }, [load])

  const loadDispatches = useCallback(async () => {
    setLoadingDisp(true)
    const { data: bulkSales } = await supabase.from('sales')
      .select('id,sale_date,bags_sold,total_amount,amount_paid,outstanding_balance,payment_status,buyer:employees!buyer_employee_id(full_name)')
      .eq('sale_type', 'bulk')
      .gte('sale_date', period.from).lte('sale_date', period.to)
      .order('sale_date', { ascending: false })

    // Per-bag cost rates (ring-fenced components, fuel removed)
    const roll_pb  = rates.roll_cost_per_kg / rates.bags_per_kg
    const pkg_pb   = rates.pkg_bulk_cost / rates.pkg_bulk_qty
    const water_pb = rates.water_cost_per_liter * rates.liters_per_bag
    const op_pb    = rates.operator_fee_per_100 / 100
    const perf_pb_est = 0  // actual perf pay not available per-dispatch; show 0
    const oh_pb    = rates.labor_per_bag + rates.utility_per_bag + rates.machine_per_bag

    const enriched = (bulkSales ?? []).map((s: any) => {
      const bags        = s.bags_sold
      const ringFenced  = (roll_pb + pkg_pb + water_pb + op_pb) * bags
      const overhead    = oh_pb * bags
      const totalCost   = ringFenced + overhead
      const surplus     = s.total_amount - totalCost
      const collected   = s.amount_paid
      const ringFencedFromCollected = collected > 0
        ? Math.min(collected, ringFenced) : 0
      const surplusFromCollected = Math.max(0, collected - ringFenced - overhead)
      return {
        ...s, bags, ringFenced, overhead, surplus,
        collected, ringFencedFromCollected, surplusFromCollected,
        roll: roll_pb * bags, pkg: pkg_pb * bags,
        water: water_pb * bags, op: op_pb * bags,
      }
    })
    setDispatches(enriched)
    setLoadingDisp(false)
  }, [period, rates])

  useEffect(() => {
    if (tab === 'dispatches') loadDispatches()
  }, [tab, loadDispatches])

  const pct = (n: number, total: number) =>
    total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%'

  const Bar = ({ value, total, color }: { value: number; total: number; color: string }) => (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div className="h-2 rounded-full transition-all"
        style={{ width: pct(value, total), background: color }} />
    </div>
  )

  const setRate = (k: string, v: number) => setRates(r => ({...r, [k]: v}))

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">💰 Fund Segregation</h1>
          <div className="text-xs text-gray-400 mt-0.5">
            Breakdown of every cedi collected — ring-fenced vs available
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRates(r => !r)}
            className="btn btn-secondary btn-sm">
            {showRates ? 'Hide' : '⚙️'} Rates
          </button>
          <button onClick={load} className="btn btn-primary">Generate</button>
        </div>
      </div>

      {/* Period filter */}
      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label>
          <input type="date" value={period.from}
            onChange={e => setPeriod(p => ({...p, from: e.target.value}))}
            className="form-input w-36" /></div>
        <div><label className="form-label">To</label>
          <input type="date" value={period.to}
            onChange={e => setPeriod(p => ({...p, to: e.target.value}))}
            className="form-input w-36" /></div>
        <button onClick={() => setPeriod({ from: monthStart(), to: today() })}
          className="btn btn-secondary">This Month</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {([['summary','📊 Period Summary'],['dispatches','📦 By Bulk Dispatch']] as const).map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors '
              + (tab === k ? 'border-[#1F4E79] text-[#1F4E79]' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {l}
          </button>
        ))}
      </div>

      {/* Rate overrides */}
      {showRates && (
        <div className="card mb-4">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            ⚙️ Cost Rates (editable)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Roll Film (GHc/Kg)',       'roll_cost_per_kg'],
              ['Bags per Kg',              'bags_per_kg'],
              ['Pkg Bags bulk qty',        'pkg_bulk_qty'],
              ['Pkg Bags bulk cost (GHc)', 'pkg_bulk_cost'],
              ['Water (GHc/litre)',        'water_cost_per_liter'],
              ['Litres per bag',           'liters_per_bag'],
              ['Operator fee per 100 bags','operator_fee_per_100'],
              ['Fuel per rider per day',   'fuel_per_rider_day'],
              ['No. of riders',            'riders'],
              ['Working days/month',       'working_days'],
              ['Labor per bag (GHc)',      'labor_per_bag'],
              ['Electricity per bag',      'utility_per_bag'],
              ['Machine per bag',          'machine_per_bag'],
            ].map(([l, k]) => (
              <div key={k} className="form-group">
                <label className="form-label text-xs">{l}</label>
                <input type="number" step="0.0001"
                  value={(rates as any)[k]}
                  onChange={e => setRate(k, parseFloat(e.target.value)||0)}
                  className="form-input" />
              </div>
            ))}
          </div>
          <button onClick={load} className="btn btn-primary mt-3">Recalculate</button>
        </div>
      )}

      {tab === 'summary' && (loading ? (
        <div className="text-center py-12 text-gray-400">Calculating...</div>
      ) : data && (
        <>
          {/* ── Revenue summary ─────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 mb-5 bg-[#1F4E79] text-white shadow-lg">
            <div className="text-blue-200 text-sm font-medium mb-1">
              Total Revenue — {period.from} to {period.to}
            </div>
            <div className="text-5xl font-bold tabular-nums">{fmtGhc(data.totalRevenue)}</div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                ['Bags Sold',    fmtNum(data.totalBagsSold)],
                ['Avg Price',    fmtGhc(data.avgUnitPrice)],
                ['Bags Produced',fmtNum(data.totalBagsProd)],
              ].map(([l,v]) => (
                <div key={l as string} className="bg-white/10 rounded-xl p-3 text-center">
                  <div className="text-blue-200 text-xs">{l}</div>
                  <div className="text-white font-bold tabular-nums mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Two-column layout: Per Bag | Aggregate ───────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

            {/* Per Bag */}
            <div className="card">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Per Bag — {fmtGhc(data.avgUnitPrice)} collected
              </div>

              {/* Ring-fenced section */}
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🔒</span>
                  <span className="text-sm font-bold text-red-700">Ring-fenced — DO NOT TOUCH</span>
                  <span className="ml-auto text-sm font-bold text-red-700">{fmtGhc(data.ringFenced_pb)}</span>
                </div>
                {[
                  ['Roll Film',        data.roll_pb,  '#b91c1c'],
                  ['Packaging Bags',   data.pkg_pb,   '#b91c1c'],
                  ['Water',            data.water_pb, '#b91c1c'],
                  ['Operator Fee',     data.op_pb,    '#9a3412'],
                  ['Performance Pay',  data.perf_pb,  '#7c2d12'],
                  ['Rider Fuel',       data.fuel_pb,  '#7c2d12'],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="flex justify-between items-center py-1">
                    <span className="text-xs text-gray-600 pl-2">↳ {l}</span>
                    <div className="flex items-center gap-3">
                      <Bar value={v as number} total={data.avgUnitPrice} color={c as string} />
                      <span className="text-xs font-medium tabular-nums w-16 text-right" style={{color:c as string}}>
                        {fmtGhc(v as number)}
                      </span>
                      <span className="text-xs text-gray-400 w-10 text-right">
                        {pct(v as number, data.avgUnitPrice)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Overhead section */}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">⚙️</span>
                  <span className="text-sm font-bold text-orange-700">Overhead (variable)</span>
                  <span className="ml-auto text-sm font-bold text-orange-700">{fmtGhc(data.overhead_pb)}</span>
                </div>
                {[
                  ['Direct Labor',      data.labor_pb,   '#c2410c'],
                  ['Electricity/Fuel',  data.utility_pb, '#c2410c'],
                  ['Machine/Deprec.',   data.machine_pb, '#c2410c'],
                ].map(([l,v,c]) => (
                  <div key={l as string} className="flex justify-between items-center py-1">
                    <span className="text-xs text-gray-600 pl-2">↳ {l}</span>
                    <div className="flex items-center gap-3">
                      <Bar value={v as number} total={data.avgUnitPrice} color={c as string} />
                      <span className="text-xs font-medium tabular-nums w-16 text-right" style={{color:c as string}}>
                        {fmtGhc(v as number)}
                      </span>
                      <span className="text-xs text-gray-400 w-10 text-right">
                        {pct(v as number, data.avgUnitPrice)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Profit / Surplus */}
              <div className={'rounded-xl p-3 border '
                + (data.profit_pb >= 0
                  ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{data.profit_pb >= 0 ? '✅' : '❌'}</span>
                    <span className={'text-sm font-bold '
                      + (data.profit_pb >= 0 ? 'text-green-700' : 'text-red-700')}>
                      Surplus / Profit
                    </span>
                  </div>
                  <div className="text-right">
                    <span className={'text-sm font-bold tabular-nums '
                      + (data.profit_pb >= 0 ? 'text-green-700' : 'text-red-700')}>
                      {fmtGhc(data.profit_pb)}
                    </span>
                    <span className="text-xs text-gray-400 ml-2">
                      {pct(Math.abs(data.profit_pb), data.avgUnitPrice)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Aggregate */}
            <div className="card">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Period Total — {fmtNum(data.totalBagsSold)} bags
              </div>

              {/* Ring-fenced section */}
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🔒</span>
                  <span className="text-sm font-bold text-red-700">Ring-fenced — DO NOT TOUCH</span>
                  <span className="ml-auto text-sm font-bold text-red-700">{fmtGhc(data.agg_ringFenced)}</span>
                </div>
                {[
                  ['Roll Film',       data.agg_roll,   'Estimated from pricing rates', '#b91c1c'],
                  ['Packaging Bags',  data.agg_pkg,    'Estimated from pricing rates', '#b91c1c'],
                  ['Water',           data.agg_water,  'Estimated from pricing rates', '#b91c1c'],
                  ['Operator Fee',    data.agg_opFee,  'Actual from expenses',         '#9a3412'],
                  ['Performance Pay', data.agg_perf,   'Actual from salary payments',  '#7c2d12'],
                  ['Rider Fuel',      data.agg_fuel,   'Estimated (rate × riders × days)', '#7c2d12'],
                ].map(([l,v,note,c]) => (
                  <div key={l as string} className="flex justify-between items-start py-1.5">
                    <div className="pl-2">
                      <div className="text-xs text-gray-600">↳ {l}</div>
                      <div className="text-xs text-gray-400">{note}</div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums" style={{color:c as string}}>
                      {fmtGhc(v as number)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Overhead */}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">⚙️</span>
                  <span className="text-sm font-bold text-orange-700">Overhead (estimated)</span>
                  <span className="ml-auto text-sm font-bold text-orange-700">{fmtGhc(data.agg_overhead)}</span>
                </div>
                {[
                  ['Direct Labor',     data.agg_labor],
                  ['Electricity/Fuel', data.agg_utility],
                  ['Machine/Deprec.',  data.agg_machine],
                ].map(([l,v]) => (
                  <div key={l as string} className="flex justify-between items-center py-1">
                    <span className="text-xs text-gray-600 pl-2">↳ {l}</span>
                    <span className="text-xs font-medium text-orange-700 tabular-nums">{fmtGhc(v as number)}</span>
                  </div>
                ))}
              </div>

              {/* Surplus */}
              <div className={'rounded-xl p-3 border '
                + (data.agg_profit >= 0
                  ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{data.agg_profit >= 0 ? '✅' : '❌'}</span>
                    <span className={'text-sm font-bold '
                      + (data.agg_profit >= 0 ? 'text-green-700' : 'text-red-700')}>
                      Surplus / Profit
                    </span>
                  </div>
                  <span className={'text-lg font-bold tabular-nums '
                    + (data.agg_profit >= 0 ? 'text-green-700' : 'text-red-700')}>
                    {fmtGhc(data.agg_profit)}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1 pl-7">
                  Revenue {fmtGhc(data.totalRevenue)}
                  − Ring-fenced {fmtGhc(data.agg_ringFenced)}
                  − Overhead {fmtGhc(data.agg_overhead)}
                </div>
              </div>

              {/* Full stacked bar */}
              <div className="mt-4">
                <div className="text-xs text-gray-400 mb-1">Revenue composition</div>
                <div className="w-full h-4 rounded-full overflow-hidden flex">
                  {[
                    [data.agg_roll,    '#dc2626'],
                    [data.agg_pkg,     '#ef4444'],
                    [data.agg_water,   '#f87171'],
                    [data.agg_opFee,   '#ea580c'],
                    [data.agg_perf,    '#c2410c'],
                    [data.agg_fuel,    '#9a3412'],
                    [data.agg_overhead,'#f59e0b'],
                    [Math.max(0, data.agg_profit),'#16a34a'],
                  ].map(([v, c], i) => (
                    <div key={i} style={{
                      width: pct(v as number, data.totalRevenue),
                      background: c as string,
                      transition: 'width 0.5s'
                    }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    ['Roll Film', '#dc2626'],
                    ['Pkg Bags',  '#ef4444'],
                    ['Water',     '#f87171'],
                    ['Op. Fee',   '#ea580c'],
                    ['Perf Pay',  '#c2410c'],
                    ['Fuel',      '#9a3412'],
                    ['Overhead',  '#f59e0b'],
                    ['Profit',    '#16a34a'],
                  ].map(([l,c]) => (
                    <div key={l as string} className="flex items-center gap-1">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{background:c as string}} />
                      <span className="text-xs text-gray-500">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Summary decision card ────────────────────────────────────── */}
          <div className="card border-l-4 border-green-500">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              💡 Summary — What can you safely use?
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-red-50 rounded-xl p-4 text-center">
                <div className="text-xs font-semibold text-red-600 uppercase mb-1">🔒 Ring-fenced</div>
                <div className="text-2xl font-bold text-red-700 tabular-nums">{fmtGhc(data.agg_ringFenced)}</div>
                <div className="text-xs text-red-500 mt-1">Reserve for raw materials + payroll + fuel</div>
              </div>
              <div className="bg-orange-50 rounded-xl p-4 text-center">
                <div className="text-xs font-semibold text-orange-600 uppercase mb-1">⚙️ Overhead</div>
                <div className="text-2xl font-bold text-orange-700 tabular-nums">{fmtGhc(data.agg_overhead)}</div>
                <div className="text-xs text-orange-500 mt-1">Labor, electricity, machine — set aside</div>
              </div>
              <div className={'rounded-xl p-4 text-center '
                + (data.agg_profit >= 0 ? 'bg-green-50' : 'bg-red-50')}>
                <div className={'text-xs font-semibold uppercase mb-1 '
                  + (data.agg_profit >= 0 ? 'text-green-600' : 'text-red-600')}>
                  {data.agg_profit >= 0 ? '✅ Available' : '❌ Shortfall'}
                </div>
                <div className={'text-2xl font-bold tabular-nums '
                  + (data.agg_profit >= 0 ? 'text-green-700' : 'text-red-700')}>
                  {fmtGhc(Math.abs(data.agg_profit))}
                </div>
                <div className={'text-xs mt-1 '
                  + (data.agg_profit >= 0 ? 'text-green-500' : 'text-red-500')}>
                  {data.agg_profit >= 0 ? 'Surplus — admin discretion' : 'Running at a loss this period'}
                </div>
              </div>
            </div>
          </div>

          {/* ── Cash Position Cross-Check ───────────────────────────────── */}
          {(() => {
            const gap = data.agg_profit - data.cashOnHand
            const gapAbs = Math.abs(gap)
            const isAligned = Math.abs(gap) < data.agg_profit * 0.1  // within 10%
            return (
              <div className="card mt-4">
                <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  🔍 Reality Check — Calculated Surplus vs Actual Cash
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <div className="text-xs font-semibold text-green-600 uppercase mb-1">
                      Calculated Surplus
                    </div>
                    <div className="text-2xl font-bold text-green-700 tabular-nums">
                      {fmtGhc(data.agg_profit)}
                    </div>
                    <div className="text-xs text-green-500 mt-1">
                      What the model says you should have
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <div className="text-xs font-semibold text-blue-600 uppercase mb-1">
                      Cash Not Banked
                    </div>
                    <div className="text-2xl font-bold text-blue-700 tabular-nums">
                      {fmtGhc(data.cashOnHand)}
                    </div>
                    <div className="text-xs text-blue-500 mt-1">
                      Collected {fmtGhc(data.cashCollected)} − Banked {fmtGhc(data.totalBanked)}
                    </div>
                  </div>

                  <div className={'rounded-xl p-4 text-center '
                    + (isAligned ? 'bg-green-50' : gap > 0 ? 'bg-orange-50' : 'bg-red-50')}>
                    <div className={'text-xs font-semibold uppercase mb-1 '
                      + (isAligned ? 'text-green-600' : gap > 0 ? 'text-orange-600' : 'text-red-600')}>
                      {isAligned ? '✅ Aligned' : gap > 0 ? '⚠️ Unexplained Gap' : '❌ Cash Shortfall'}
                    </div>
                    <div className={'text-2xl font-bold tabular-nums '
                      + (isAligned ? 'text-green-700' : gap > 0 ? 'text-orange-700' : 'text-red-700')}>
                      {fmtGhc(gapAbs)}
                    </div>
                    <div className={'text-xs mt-1 '
                      + (isAligned ? 'text-green-500' : gap > 0 ? 'text-orange-500' : 'text-red-500')}>
                      {isAligned
                        ? 'Surplus matches cash on hand'
                        : gap > 0
                        ? 'Surplus exceeds cash — costs not captured by model'
                        : 'More cash than expected — uncollected costs still owed'}
                    </div>
                  </div>
                </div>

                {/* Expense breakdown */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Expense Breakdown — {period.from} to {period.to}
                  </div>
                  <div className="space-y-2">
                    {[
                      ['Total Cash Collected (all sales)',  data.cashCollected,    'text-green-700'],
                      ['Total Banked',                     -data.totalBanked,      'text-blue-700'],
                      ['Operator Fee (actual)',             -data.trackedExpenses,  'text-red-600'],
                      ['Unaccounted Expenses',              -data.unaccountedExp,  'text-orange-600'],
                      ['Total All Expenses',               -data.totalAllExpenses, 'text-red-700'],
                    ].map(([l, v, c]) => (
                      <div key={l as string} className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0">
                        <span className="text-sm text-gray-600">{l}</span>
                        <span className={'text-sm font-medium tabular-nums ' + c}>
                          {(v as number) < 0 ? `−${fmtGhc(Math.abs(v as number))}` : fmtGhc(v as number)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {data.unaccountedExp > 0 && (
                    <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-700">
                      <strong>⚠️ {fmtGhc(data.unaccountedExp)} in expenses</strong> are not captured
                      in the ring-fenced model (e.g. fuel, repairs, imprest, miscellaneous).
                      These reduce your real available surplus. Check the Expenses module for the full breakdown.
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </>
      ))}

      {/* ── BY BULK DISPATCH TAB ─────────────────────────────────────── */}
      {tab === 'dispatches' && (
        loadingDisp ? (
          <div className="text-center py-12 text-gray-400">Loading dispatches...</div>
        ) : dispatches.length === 0 ? (
          <div className="card text-center py-10 text-gray-400">No bulk dispatches in this period.</div>
        ) : (
          <>
            {/* Aggregate totals bar */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                ['🔒 Total Ring-fenced', dispatches.reduce((a,d)=>a+d.ringFenced,0), '#b91c1c', 'Cost to replenish raw materials + operator fee'],
                ['⚙️ Total Overhead',    dispatches.reduce((a,d)=>a+d.overhead,0),   '#c2410c', 'Labor, electricity, machine estimates'],
                ['✅ Total Surplus',     dispatches.reduce((a,d)=>a+d.surplus,0),    '#15803d', 'What remains after all costs'],
              ].map(([l,v,c,note]) => (
                <div key={l as string} className="card text-center border-l-4" style={{borderLeftColor: c as string}}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{color: c as string}}>{l}</div>
                  <div className="text-2xl font-bold tabular-nums" style={{color: c as string}}>{fmtGhc(v as number)}</div>
                  <div className="text-xs text-gray-400 mt-1">{note}</div>
                </div>
              ))}
            </div>

            {/* Per-dispatch table */}
            <div className="card">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col style={{width:'140px'}} />
                    <col style={{width:'65px'}} /><col style={{width:'90px'}} />
                    <col style={{width:'100px'}} /><col style={{width:'100px'}} />
                    <col style={{width:'100px'}} /><col style={{width:'105px'}} />
                    <col style={{width:'75px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Date</th><th>Rider</th><th className="right">Bags</th>
                      <th className="right">Invoiced</th>
                      <th className="right">🔒 Ring-fenced</th>
                      <th className="right">⚙️ Overhead</th>
                      <th className="right">✅ Surplus</th>
                      <th className="right">Collected</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatches.map((d: any) => (
                      <tr key={d.id}>
                        <td className="muted">{d.sale_date}</td>
                        <td className="font-medium">{d.buyer?.full_name ?? '—'}</td>
                        <td className="num">{fmtNum(d.bags)}</td>
                        <td className="num">{fmtGhc(d.total_amount)}</td>
                        <td className="num font-medium text-red-700">{fmtGhc(d.ringFenced)}</td>
                        <td className="num text-orange-600">{fmtGhc(d.overhead)}</td>
                        <td className={'num font-medium ' + (d.surplus >= 0 ? 'text-green-700' : 'text-red-600')}>
                          {fmtGhc(d.surplus)}
                        </td>
                        <td className="num-green">{fmtGhc(d.collected)}</td>
                        <td>
                          <span className={'badge ' + (d.payment_status==='paid'?'badge-green':d.payment_status==='partial'?'badge-yellow':'badge-red')}>
                            {d.payment_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#1F4E79]">
                      <td colSpan={3} className="py-2 px-3 text-white text-xs font-semibold">
                        TOTALS ({dispatches.length} dispatches)
                      </td>
                      <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                        {fmtGhc(dispatches.reduce((a,d)=>a+d.total_amount,0))}
                      </td>
                      <td className="py-2 px-3 text-xs font-bold text-right tabular-nums text-red-300">
                        {fmtGhc(dispatches.reduce((a,d)=>a+d.ringFenced,0))}
                      </td>
                      <td className="py-2 px-3 text-xs font-bold text-right tabular-nums text-orange-300">
                        {fmtGhc(dispatches.reduce((a,d)=>a+d.overhead,0))}
                      </td>
                      <td className="py-2 px-3 text-xs font-bold text-right tabular-nums text-green-300">
                        {fmtGhc(dispatches.reduce((a,d)=>a+d.surplus,0))}
                      </td>
                      <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">
                        {fmtGhc(dispatches.reduce((a,d)=>a+d.collected,0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Collected breakdown note */}
              <div className="mt-4 bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                <div className="font-semibold mb-1">📌 Note on Ring-fenced vs Collected:</div>
                <div>Ring-fenced is calculated from cost rates (bags × per-bag cost). Collected is actual cash received so far.
                When collected &lt; ring-fenced, you have not yet recovered your costs on that dispatch.
                When collected &gt; ring-fenced + overhead, the excess is available surplus.</div>
              </div>
            </div>
          </>
        )
      )}
    </AppLayout>
  )
}

export default function FundSegregationPage() {
  return (
    <ModuleGuard moduleKey="fund-segregation" moduleLabel="Fund Segregation">
      <FundSegregationInner />
    </ModuleGuard>
  )
}
