'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase, fmtGhc, fmtNum, today } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { key: 'stock',       icon: '📦', title: 'Opening Stock',              desc: 'Bags on hand before going live' },
  { key: 'rawmat',      icon: '🧱', title: 'Raw Material Stock',          desc: 'Current stock levels for each material' },
  { key: 'employees',   icon: '👥', title: 'Employees & Salary Balances', desc: 'Staff records and any outstanding salary' },
  { key: 'customers',   icon: '👤', title: 'Customer Opening Balances',   desc: 'Amounts customers already owe' },
  { key: 'riders',      icon: '🛵', title: 'Rider Opening Balances',      desc: 'Bags on hand and debt to factory per rider' },
  { key: 'bank',        icon: '🏦', title: 'Bank & Cash Balance',         desc: 'Opening cash and bank balance' },
  { key: 'expenses',    icon: '💸', title: 'Expense Opening Balance',     desc: 'Any expenses already incurred' },
  { key: 'done',        icon: '✅', title: 'Setup Complete',              desc: 'Review and confirm' },
]

export default function SetupPage() {
  const { isAdmin, loading: roleLoading } = useRole()
  const [step, setStep]           = useState(0)
  const [mode, setMode]           = useState<'wizard'|'page'>('wizard')

  // ── Data states ────────────────────────────────────────────────────────────
  // Stock
  const [openingBags, setOpeningBags]   = useState('')
  const [stockDate, setStockDate]       = useState(today())

  // Raw materials
  const [rawMats, setRawMats]           = useState<any[]>([])
  const [rawEdits, setRawEdits]         = useState<Record<number, string>>({})

  // Employees
  const [employees, setEmployees]       = useState<any[]>([])
  const [empEdits, setEmpEdits]         = useState<Record<number, {salary: string; opening_balance: string}>>({})

  // Customers
  const [customers, setCustomers]       = useState<any[]>([])
  const [custEdits, setCustEdits]       = useState<Record<number, string>>({})

  // Riders
  const [riders, setRiders]             = useState<any[]>([])
  const [riderEdits, setRiderEdits]     = useState<Record<number, {bags: string; debt: string}>>({})

  // Bank
  const [bankBalance, setBankBalance]   = useState('')
  const [cashBalance, setCashBalance]   = useState('')
  const [bankName, setBankName]         = useState('')
  const [balanceDate, setBalanceDate]   = useState(today())

  // Expenses
  const [expBalance, setExpBalance]     = useState('')
  const [expNotes, setExpNotes]         = useState('')
  const [expDate, setExpDate]           = useState(today())

  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState<Record<string,boolean>>({})

  useEffect(() => {
    if (!isAdmin) return
    supabase.from('raw_materials').select('*').order('name')
      .then(({ data }) => setRawMats(data ?? []))
    supabase.from('employees').select('*').eq('status','active').order('full_name')
      .then(({ data }) => {
        setEmployees(data ?? [])
        setRiders((data ?? []).filter((e:any) =>
          e.employee_type === 'rider' || e.role?.toLowerCase().includes('rider') || e.role?.toLowerCase().includes('sales')))
      })
    supabase.from('customers').select('*').order('name')
      .then(({ data }) => setCustomers(data ?? []))
  }, [isAdmin])

  if (roleLoading) return (
    <AppLayout><div className="flex items-center justify-center min-h-[60vh] text-gray-400">Loading...</div></AppLayout>
  )
  if (!isAdmin) return <AccessDenied message="Only administrators can set up opening balances." />

  // ── Save functions ──────────────────────────────────────────────────────────
  const saveStock = async () => {
    setSaving(true)
    const bags = parseInt(openingBags) || 0
    if (bags > 0) {
      await supabase.from('finished_inventory').insert({
        bags_in: bags, bags_out: 0,
        transaction_date: stockDate,
        reference_type: 'adjustment',
        notes: 'Opening balance — bags on hand before go-live',
      })
    }
    await supabase.from('opening_balances').upsert({ key: 'stock_bags', value: bags, updated_at: new Date().toISOString() })
    setSaving(false); setSaved(s => ({...s, stock: true}))
  }

  const saveRawMats = async () => {
    setSaving(true)
    for (const mat of rawMats) {
      const stock = parseFloat(rawEdits[mat.id] ?? String(mat.current_stock)) || 0
      await supabase.from('raw_materials').update({ current_stock: stock }).eq('id', mat.id)
    }
    setSaving(false); setSaved(s => ({...s, rawmat: true}))
  }

  const saveEmployees = async () => {
    setSaving(true)
    for (const emp of employees) {
      const edit = empEdits[emp.id]
      if (!edit) continue
      const salary = parseFloat(edit.salary) || emp.salary || 0
      await supabase.from('employees').update({ salary }).eq('id', emp.id)
      const opening = parseFloat(edit.opening_balance) || 0
      if (opening > 0) {
        await supabase.from('salary_payments').insert({
          employee_id: emp.id, payment_date: today(), amount: -opening,
          payment_type: 'opening_balance',
          notes: 'Opening balance — accrued salary before go-live',
        })
      }
    }
    setSaving(false); setSaved(s => ({...s, employees: true}))
  }

  const saveCustomers = async () => {
    setSaving(true)
    for (const cust of customers) {
      const bal = parseFloat(custEdits[cust.id] || '0') || 0
      if (bal > 0) {
        // Create an opening balance sale record
        await supabase.from('sales').insert({
          sale_date: today(), customer_id: cust.id,
          bags_sold: 0, unit_price: 0, total_amount: bal,
          amount_paid: 0, outstanding_balance: bal,
          payment_status: 'unpaid', sale_type: 'retail',
          notes: 'Opening balance — amount owed before go-live',
        })
      }
    }
    setSaving(false); setSaved(s => ({...s, customers: true}))
  }

  const saveRiders = async () => {
    setSaving(true)
    for (const rider of riders) {
      const edit = riderEdits[rider.id]
      if (!edit) continue
      const bags = parseInt(edit.bags) || 0
      const debt = parseFloat(edit.debt) || 0
      if (bags > 0 || debt > 0) {
        // Get or create internal customer for rider
        const riderCustName = '[Rider] ' + rider.full_name
        let custId: number
        const { data: ex } = await supabase.from('customers').select('id').eq('name', riderCustName).single()
        if (ex) { custId = ex.id }
        else {
          const { data: nc } = await supabase.from('customers')
            .insert({ name: riderCustName, address: 'Internal — Rider/Sales Rep' }).select().single()
          custId = nc?.id ?? 1
        }
        // Record opening bulk dispatch
        await supabase.from('sales').insert({
          sale_date: today(), customer_id: custId,
          buyer_employee_id: rider.id, sale_type: 'bulk',
          bags_sold: bags, unit_price: debt > 0 && bags > 0 ? debt / bags : 0,
          total_amount: debt, amount_paid: 0,
          outstanding_balance: debt, payment_status: 'unpaid',
          notes: 'Opening balance — bags on hand and debt before go-live',
        })
      }
    }
    setSaving(false); setSaved(s => ({...s, riders: true}))
  }

  const saveBank = async () => {
    setSaving(true)
    const bank = parseFloat(bankBalance) || 0
    const cash = parseFloat(cashBalance) || 0
    if (bank > 0) {
      await supabase.from('bank_deposits').insert({
        deposit_date: balanceDate,
        bank_name: bankName || 'Opening Balance',
        amount: bank, reference: 'OPENING-BAL',
        deposited_by: 'System',
        notes: 'Opening bank balance before go-live',
      })
    }
    await supabase.from('opening_balances').upsert(
      [{ key: 'cash_balance', value: cash + bank, updated_at: new Date().toISOString() }]
    )
    setSaving(false); setSaved(s => ({...s, bank: true}))
  }

  const saveExpenses = async () => {
    setSaving(true)
    const amt = parseFloat(expBalance) || 0
    if (amt > 0) {
      await supabase.from('expenses').insert({
        expense_date: expDate, category: 'Opening Balance',
        description: expNotes || 'Expenses incurred before go-live',
        amount: amt,
      })
    }
    await supabase.from('opening_balances').upsert(
      [{ key: 'total_payables', value: amt, updated_at: new Date().toISOString() }]
    )
    setSaving(false); setSaved(s => ({...s, expenses: true}))
  }

  const SAVERS: Record<string, () => Promise<void>> = {
    stock: saveStock, rawmat: saveRawMats, employees: saveEmployees,
    customers: saveCustomers, riders: saveRiders, bank: saveBank, expenses: saveExpenses,
  }

  const currentStep = STEPS[step]
  const totalSteps  = STEPS.length

  // ── Render step content ────────────────────────────────────────────────────
  const renderStep = (key: string) => {
    switch (key) {
      case 'stock': return (
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
            Enter the number of finished sachet water bags you have on hand right now, before you start recording new production.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-group">
              <label className="form-label">As of Date</label>
              <input type="date" value={stockDate} onChange={e => setStockDate(e.target.value)} className="form-input"/>
            </div>
            <div className="form-group">
              <label className="form-label">Bags On Hand *</label>
              <input type="number" value={openingBags}
                onChange={e => setOpeningBags(e.target.value)}
                className="form-input text-2xl font-bold text-center py-3"
                placeholder="0" autoFocus/>
            </div>
          </div>
        </div>
      )

      case 'rawmat': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            Set the current stock quantity for each raw material. Leave unchanged if already correct.
          </div>
          {rawMats.length === 0
            ? <div className="text-center py-6 text-gray-400">No raw materials found. Add them in the Raw Materials module first.</div>
            : rawMats.map((m:any) => (
            <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="flex-1">
                <div className="font-medium text-sm">{m.name}</div>
                <div className="text-xs text-gray-400">{m.unit}</div>
              </div>
              <input type="number" step="0.01"
                value={rawEdits[m.id] ?? String(m.current_stock)}
                onChange={e => setRawEdits(r => ({...r, [m.id]: e.target.value}))}
                className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-right text-sm focus:ring-2 focus:ring-[#2E75B6] focus:outline-none"/>
              <span className="text-xs text-gray-400 w-12">{m.unit}</span>
            </div>
          ))}
        </div>
      )

      case 'employees': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            Set each employee's monthly salary and any outstanding salary owed to them before go-live.
          </div>
          {employees.length === 0
            ? <div className="text-center py-6 text-gray-400">No employees found. Add them in the Personnel module first.</div>
            : employees.map((e:any) => (
            <div key={e.id} className="p-3 bg-gray-50 rounded-xl">
              <div className="font-medium text-sm mb-2">{e.full_name} <span className="text-xs text-gray-400">({e.role})</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Monthly Salary (GHc)</label>
                  <input type="number" step="0.01"
                    value={empEdits[e.id]?.salary ?? String(e.salary || '')}
                    onChange={ev => setEmpEdits(x => ({...x, [e.id]: {...(x[e.id]||{salary:'',opening_balance:''}), salary: ev.target.value}}))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mt-1"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Opening Balance Owed (GHc)</label>
                  <input type="number" step="0.01"
                    value={empEdits[e.id]?.opening_balance ?? '0'}
                    onChange={ev => setEmpEdits(x => ({...x, [e.id]: {...(x[e.id]||{salary:'',opening_balance:''}), opening_balance: ev.target.value}}))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mt-1"
                    placeholder="0.00"/>
                </div>
              </div>
            </div>
          ))}
        </div>
      )

      case 'customers': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            Enter how much each customer already owes before you start using the app.
            Leave as 0 if they have no outstanding balance.
          </div>
          {customers.length === 0
            ? <div className="text-center py-6 text-gray-400">No customers found. Add them in the Customers module first.</div>
            : customers.map((c:any) => (
            <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="flex-1">
                <div className="font-medium text-sm">{c.name}</div>
                {c.phone && <div className="text-xs text-gray-400">{c.phone}</div>}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400">GHc</span>
                <input type="number" step="0.01"
                  value={custEdits[c.id] ?? '0'}
                  onChange={e => setCustEdits(x => ({...x, [c.id]: e.target.value}))}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-right text-sm focus:ring-2 focus:ring-[#2E75B6] focus:outline-none"
                  placeholder="0.00"/>
              </div>
            </div>
          ))}
        </div>
      )

      case 'riders': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            For each rider/sales rep, enter how many bags they currently have on hand and how much they owe the factory.
          </div>
          {riders.length === 0
            ? <div className="text-center py-6 text-gray-400">No riders found. Set employee type to "Rider" in Personnel first.</div>
            : riders.map((r:any) => (
            <div key={r.id} className="p-3 bg-gray-50 rounded-xl">
              <div className="font-medium text-sm mb-2">{r.full_name} <span className="text-xs text-gray-400">({r.role})</span></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Bags On Hand</label>
                  <input type="number"
                    value={riderEdits[r.id]?.bags ?? '0'}
                    onChange={e => setRiderEdits(x => ({...x, [r.id]: {...(x[r.id]||{bags:'0',debt:'0'}), bags: e.target.value}}))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mt-1"/>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Debt to Factory (GHc)</label>
                  <input type="number" step="0.01"
                    value={riderEdits[r.id]?.debt ?? '0'}
                    onChange={e => setRiderEdits(x => ({...x, [r.id]: {...(x[r.id]||{bags:'0',debt:'0'}), debt: e.target.value}}))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm mt-1"/>
                </div>
              </div>
            </div>
          ))}
        </div>
      )

      case 'bank': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            Enter your bank and cash balances as of the date you start using this app.
          </div>
          <div className="form-group">
            <label className="form-label">As of Date</label>
            <input type="date" value={balanceDate} onChange={e => setBalanceDate(e.target.value)} className="form-input"/>
          </div>
          <div className="form-group">
            <label className="form-label">Bank Name / Account</label>
            <input value={bankName} onChange={e => setBankName(e.target.value)}
              className="form-input" placeholder="e.g. GCB, MoMo 0241649507"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-group">
              <label className="form-label">Bank Balance (GHc)</label>
              <input type="number" step="0.01" value={bankBalance}
                onChange={e => setBankBalance(e.target.value)}
                className="form-input" placeholder="0.00"/>
            </div>
            <div className="form-group">
              <label className="form-label">Cash on Hand (GHc)</label>
              <input type="number" step="0.01" value={cashBalance}
                onChange={e => setCashBalance(e.target.value)}
                className="form-input" placeholder="0.00"/>
            </div>
          </div>
          {(bankBalance || cashBalance) && (
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <div className="text-xs text-gray-500">Total Opening Balance</div>
              <div className="text-2xl font-bold text-green-700 tabular-nums">
                GH₵ {((parseFloat(bankBalance||'0') + parseFloat(cashBalance||'0'))).toLocaleString('en-GH', {minimumFractionDigits:2})}
              </div>
            </div>
          )}
        </div>
      )

      case 'expenses': return (
        <div className="space-y-3">
          <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
            If there are any expenses already incurred before going live (e.g. setup costs, previous month bills),
            enter the total here as an opening balance.
          </div>
          <div className="form-group">
            <label className="form-label">As of Date</label>
            <input type="date" value={expDate} onChange={e => setExpDate(e.target.value)} className="form-input"/>
          </div>
          <div className="form-group">
            <label className="form-label">Total Opening Expenses (GHc)</label>
            <input type="number" step="0.01" value={expBalance}
              onChange={e => setExpBalance(e.target.value)}
              className="form-input text-2xl font-bold text-center py-3" placeholder="0.00"/>
          </div>
          <div className="form-group">
            <label className="form-label">Description / Notes</label>
            <textarea value={expNotes} rows={2}
              onChange={e => setExpNotes(e.target.value)}
              className="form-input" placeholder="e.g. Electricity, rent, supplies paid before go-live"/>
          </div>
        </div>
      )

      case 'done': return (
        <div className="space-y-3">
          <div className="text-center py-4">
            <div className="text-5xl mb-3">🎉</div>
            <div className="font-bold text-[#1F4E79] text-xl mb-2">Setup Complete!</div>
            <div className="text-gray-500 text-sm">
              Your opening balances have been recorded. The app is ready to use.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STEPS.slice(0,-1).map(s => (
              <div key={s.key} className={'flex items-center gap-2 p-2.5 rounded-lg '
                + (saved[s.key] ? 'bg-green-50' : 'bg-gray-50')}>
                <span className="text-lg">{saved[s.key] ? '✅' : '⏭️'}</span>
                <span className={'text-sm ' + (saved[s.key] ? 'text-green-700 font-medium' : 'text-gray-400')}>
                  {s.title}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <a href="/dashboard" className="btn btn-primary flex-1 justify-center">
              Go to Dashboard →
            </a>
            <a href="/setup" onClick={() => { setStep(0); setSaved({}) }}
              className="btn btn-secondary flex-1 justify-center">
              Run Setup Again
            </a>
          </div>
        </div>
      )

      default: return null
    }
  }

  // ── WIZARD MODE ────────────────────────────────────────────────────────────
  if (mode === 'wizard') {
    return (
      <AppLayout>
        <div className="page-header">
          <div>
            <h1 className="page-title">🚀 Setup Wizard</h1>
            <div className="text-xs text-gray-400 mt-0.5">Opening Balances — Step {step + 1} of {totalSteps}</div>
          </div>
          <button onClick={() => setMode('page')} className="btn btn-secondary btn-sm">
            Switch to Full Page View
          </button>
        </div>

        {/* Progress bar */}
        <div className="card mb-4 p-3">
          <div className="flex gap-1 mb-2">
            {STEPS.map((s, i) => (
              <button key={s.key} onClick={() => setStep(i)}
                className={'flex-1 h-2 rounded-full transition-all '
                  + (i < step ? 'bg-green-500' : i === step ? 'bg-[#1F4E79]' : 'bg-gray-200')}>
              </button>
            ))}
          </div>
          <div className="flex overflow-x-auto gap-1 pb-1 hide-scrollbar">
            {STEPS.map((s, i) => (
              <button key={s.key} onClick={() => setStep(i)}
                className={'flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors '
                  + (i === step ? 'bg-[#1F4E79] text-white font-semibold'
                  : saved[s.key] ? 'bg-green-50 text-green-700'
                  : 'text-gray-400 hover:text-gray-600')}>
                <span>{s.icon}</span>
                <span className="hidden sm:inline">{s.title}</span>
                {saved[s.key] && <span>✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="card mb-4">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
            <span className="text-3xl">{currentStep.icon}</span>
            <div>
              <div className="font-bold text-[#1F4E79]">{currentStep.title}</div>
              <div className="text-xs text-gray-400">{currentStep.desc}</div>
            </div>
          </div>
          <div className="overflow-y-auto" style={{maxHeight:'55vh'}}>
            {renderStep(currentStep.key)}
          </div>
        </div>

        {/* Navigation */}
        {currentStep.key !== 'done' && (
          <div className="flex gap-3">
            <button onClick={() => setStep(s => Math.max(0, s - 1))}
              disabled={step === 0}
              className="btn btn-secondary flex-1 justify-center">
              ← Back
            </button>
            <button onClick={async () => {
              const saver = SAVERS[currentStep.key]
              if (saver) await saver()
              setStep(s => Math.min(totalSteps - 1, s + 1))
            }} disabled={saving}
              className="btn btn-primary flex-1 justify-center">
              {saving ? 'Saving...' : step === totalSteps - 2 ? '✅ Save & Finish' : 'Save & Continue →'}
            </button>
          </div>
        )}
      </AppLayout>
    )
  }

  // ── FULL PAGE MODE ─────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🚀 Opening Balances</h1>
          <div className="text-xs text-gray-400 mt-0.5">Set up initial data before going live</div>
        </div>
        <button onClick={() => setMode('wizard')} className="btn btn-secondary btn-sm">
          Switch to Wizard
        </button>
      </div>

      <div className="space-y-4">
        {STEPS.slice(0,-1).map(s => (
          <div key={s.key} className="card">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{s.icon}</span>
                <div>
                  <div className="font-bold text-[#1F4E79]">{s.title}</div>
                  <div className="text-xs text-gray-400">{s.desc}</div>
                </div>
              </div>
              {saved[s.key] && <span className="badge badge-green">✅ Saved</span>}
            </div>
            {renderStep(s.key)}
            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
              <button onClick={async () => { await SAVERS[s.key]() }}
                disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save ' + s.title}
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}
