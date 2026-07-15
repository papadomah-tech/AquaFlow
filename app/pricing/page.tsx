'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc } from '@/lib/supabase'

const DEFAULT = { roll_cost_per_kg: 45, pkg_bulk_qty: 1000, pkg_bulk_cost: 640, water_cost_per_liter: 0.0318, liters_per_bag: 0.5, labor_per_bag: 0.50, utility_per_bag: 0.20, machine_per_bag: 0.10, transport_per_bag: 0.10, other_per_bag: 0.05, margin_pct: 20, bags_per_kg: 25 }

function PricingPageInner() {
  const [inputs, setInputs] = useState(DEFAULT)
  const [laborEnabled, setLaborEnabled] = useState({ labor: true, utility: true, machine: true, transport: true, other: true })
  const [avgSalePrice, setAvgSalePrice] = useState(0)

  useEffect(() => {
    supabase.from('sales').select('unit_price').gte('sale_date', new Date(Date.now() - 30*24*3600*1000).toISOString().split('T')[0])
      .then(({ data }) => {
        if (data && data.length > 0) setAvgSalePrice(data.reduce((a: number, s: any) => a + s.unit_price, 0) / data.length)
      })
  }, [])

  const set = (k: string, v: number) => setInputs(p => ({...p, [k]: v}))

  const roll_pb    = inputs.roll_cost_per_kg / inputs.bags_per_kg
  const pkg_pb     = inputs.pkg_bulk_cost / inputs.pkg_bulk_qty
  const water_pb   = inputs.water_cost_per_liter * inputs.liters_per_bag
  const raw_total  = roll_pb + pkg_pb + water_pb
  const lab        = laborEnabled.labor    ? inputs.labor_per_bag    : 0
  const util       = laborEnabled.utility  ? inputs.utility_per_bag  : 0
  const mach       = laborEnabled.machine  ? inputs.machine_per_bag  : 0
  const trans      = laborEnabled.transport? inputs.transport_per_bag: 0
  const oth        = laborEnabled.other    ? inputs.other_per_bag    : 0
  const oh_total   = lab + util + mach + trans + oth
  const cost_pb    = raw_total + oh_total
  const price_pb   = cost_pb * (1 + inputs.margin_pct / 100)
  const profit_pb  = price_pb - cost_pb

  const Row = ({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) => (
    <div className={`flex justify-between py-2 px-3 rounded ${bold ? 'bg-blue-50' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold text-[#1F4E79]' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-bold text-[#1F4E79]' : 'text-gray-800'}`}>{value}</span>
    </div>
  )

  const Input = ({ label, k, step = '0.01', tip = '' }: { label: string; k: string; step?: string; tip?: string }) => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type="number" step={step} value={(inputs as any)[k]} onChange={e => set(k, parseFloat(e.target.value) || 0)} className="form-input" />
      {tip && <div className="text-xs text-gray-400 mt-1">{tip}</div>}
    </div>
  )

  const LaborRow = ({ label, k, ek }: { label: string; k: string; ek: keyof typeof laborEnabled }) => (
    <div className="flex items-center gap-3 py-2">
      <input type="checkbox" checked={laborEnabled[ek]} onChange={e => setLaborEnabled(p => ({...p, [ek]: e.target.checked}))} className="w-4 h-4 accent-[#1F4E79]" />
      <span className={'text-sm flex-1 ' + (!laborEnabled[ek] ? 'text-gray-300 line-through' : 'text-gray-700')}>{label}</span>
      <input type="number" step="0.01" value={(inputs as any)[k]} disabled={!laborEnabled[ek]}
        onChange={e => set(k, parseFloat(e.target.value) || 0)}
        className={'w-24 text-right border rounded px-2 py-1 text-sm ' + (!laborEnabled[ek] ? 'bg-gray-100 text-gray-300 border-gray-200' : 'border-gray-300')} />
      <span className="text-xs text-gray-400 w-12">GHc</span>
    </div>
  )

  return (
    <AppLayout>
      <div className="page-header"><h1 className="page-title">Pricing Calculator</h1></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* INPUTS */}
        <div className="space-y-4">
          <div className="card">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Raw Material Costs</div>
            <Input label="Roll Film — cost per Kg (GHc)" k="roll_cost_per_kg" tip="GHc 45 per Kg default" />
            <Input label="Bags per Kg (approx)" k="bags_per_kg" step="1" tip="Default: 25 bags/Kg" />
            <Input label="Packaging bags — bulk qty" k="pkg_bulk_qty" step="1" />
            <Input label="Packaging bags — bulk cost (GHc)" k="pkg_bulk_cost" />
            <Input label="Water — cost per litre (GHc)" k="water_cost_per_liter" tip="GHc 0.0318/litre" />
            <Input label="Litres per bag" k="liters_per_bag" tip="Approx 0.5 litres/bag" />
          </div>
          <div className="card">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Labor & Overhead (per bag)</div>
            <div className="text-xs text-gray-400 mb-3">Check to include in price calculation</div>
            <LaborRow label="Direct Labor" k="labor_per_bag" ek="labor" />
            <LaborRow label="Electricity / Fuel" k="utility_per_bag" ek="utility" />
            <LaborRow label="Machine / Depreciation" k="machine_per_bag" ek="machine" />
            <LaborRow label="Transportation" k="transport_per_bag" ek="transport" />
            <LaborRow label="Other Overhead" k="other_per_bag" ek="other" />
          </div>
          <div className="card">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Pricing</div>
            <Input label="Target Profit Margin (%)" k="margin_pct" step="1" />
          </div>
        </div>

        {/* RESULTS */}
        <div className="card h-fit">
          <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Cost Breakdown — per Bag</div>
          <div className="space-y-1 mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase px-3 mb-1">Raw Materials</div>
            <Row label="Roll Film" value={fmtGhc(roll_pb)} />
            <Row label="Packaging Bag" value={fmtGhc(pkg_pb)} />
            <Row label="Water" value={fmtGhc(water_pb)} />
            <Row label="Sub-total — Raw Materials" value={fmtGhc(raw_total)} bold />

            <div className="text-xs font-semibold text-gray-400 uppercase px-3 mt-3 mb-1">Labor & Overhead</div>
            {[['Direct Labor', lab, laborEnabled.labor],['Electricity/Fuel', util, laborEnabled.utility],['Machine', mach, laborEnabled.machine],['Transport', trans, laborEnabled.transport],['Other', oth, laborEnabled.other]].map(([l,v,en]) => (
              <div key={l as string} className={'flex justify-between py-1 px-3 rounded ' + (!en ? 'opacity-40' : '')}>
                <span className={'text-sm ' + (!en ? 'line-through text-gray-400' : 'text-gray-600')}>{!en ? '☐ ' : '✅ '}{l}</span>
                <span className="text-sm text-gray-800">{fmtGhc(v as number)}</span>
              </div>
            ))}
            <Row label="Sub-total — Overhead" value={fmtGhc(oh_total)} bold />

            <div className="border-t border-gray-200 my-3" />
            <Row label="TOTAL COST PER BAG" value={fmtGhc(cost_pb)} bold />
            <Row label={'Profit Margin (' + inputs.margin_pct + '%)'} value={fmtGhc(profit_pb)} bold />

            <div className="bg-[#1F4E79] rounded-xl p-4 mt-4 text-center">
              <div className="text-blue-200 text-sm">Recommended Selling Price</div>
              <div className="text-white text-4xl font-bold mt-1">{fmtGhc(price_pb)}</div>
              <div className="text-blue-200 text-xs mt-1">per bag</div>
            </div>

            {avgSalePrice > 0 && (
              <div className={'rounded-lg p-3 mt-3 text-center ' + (avgSalePrice >= price_pb ? 'bg-green-50' : 'bg-red-50')}>
                <div className="text-xs text-gray-500">Avg. Actual Sale Price (last 30 days)</div>
                <div className={'font-bold ' + (avgSalePrice >= price_pb ? 'text-green-700' : 'text-red-700')}>{fmtGhc(avgSalePrice)}</div>
                <div className={'text-xs ' + (avgSalePrice >= price_pb ? 'text-green-600' : 'text-red-600')}>
                  {avgSalePrice >= price_pb ? '✅ Above recommended price' : '⚠️ Below recommended price'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default function PricingPage() {
  return (
    <ModuleGuard moduleKey="pricing" moduleLabel="Pricing">
      <PricingPageInner />
    </ModuleGuard>
  )
}
