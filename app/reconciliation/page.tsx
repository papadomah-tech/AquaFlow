'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, today, monthStart } from '@/lib/supabase'

function ReconciliationPageInner() {
  const [filter, setFilter] = useState({ from: monthStart(), to: today() })
  const [data, setData] = useState<any>(null)
  const [deposits, setDeposits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showDepForm, setShowDepForm] = useState(false)
  const [depForm, setDepForm] = useState({ deposit_date: today(), bank_name: '', amount: '', reference: '', deposited_by: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: payments }, { data: depositRows }, { data: expenses }] = await Promise.all([
      supabase.from('payments').select('amount').gte('payment_date', filter.from).lte('payment_date', filter.to),
      supabase.from('bank_deposits').select('*').gte('deposit_date', filter.from).lte('deposit_date', filter.to).order('deposit_date', { ascending: false }),
      supabase.from('expenses').select('amount,category').gte('expense_date', filter.from).lte('expense_date', filter.to),
    ])
    const cashCollected = (payments ?? []).reduce((a: number, p: any) => a + p.amount, 0)
    const totalDeposited = (depositRows ?? []).reduce((a: number, d: any) => a + d.amount, 0)
    const totalExpenses  = (expenses ?? []).reduce((a: number, e: any) => a + e.amount, 0)
    const bookBalance    = cashCollected - totalExpenses
    const bankBalance    = totalDeposited - totalExpenses
    const difference     = bookBalance - bankBalance
    setData({ cashCollected, totalDeposited, totalExpenses, bookBalance, bankBalance, difference })
    setDeposits(depositRows ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const saveDeposit = async () => {
    await supabase.from('bank_deposits').insert({ ...depForm, amount: parseFloat(depForm.amount) })
    setShowDepForm(false); load()
  }

  const delDeposit = async (d: any) => {
    if (!confirm('Delete deposit of ' + fmtGhc(d.amount) + '?')) return
    await supabase.from('bank_deposits').delete().eq('id', d.id)
    load()
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Cash & Bank</h1>
        <button onClick={() => setShowDepForm(true)} className="btn btn-primary">+ Record Deposit</button>
      </div>

      <div className="card mb-4 flex gap-3 items-end flex-wrap">
        <div><label className="form-label">From</label><input type="date" value={filter.from} onChange={e=>setFilter(f=>({...f,from:e.target.value}))} className="form-input w-36" /></div>
        <div><label className="form-label">To</label><input type="date" value={filter.to} onChange={e=>setFilter(f=>({...f,to:e.target.value}))} className="form-input w-36" /></div>
        <button onClick={load} className="btn btn-primary">Generate</button>
        <button onClick={() => setFilter({from:monthStart(),to:today()})} className="btn btn-secondary">This Month</button>
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Loading...</div> : data && (
        <>
          {/* Reconciliation Statement */}
          <div className="card mb-4">
            <div className="text-sm font-bold text-[#1F4E79] uppercase tracking-wider mb-4">Bank Reconciliation Statement</div>
            <div className="space-y-0">
              {[
                ['Cash Collected (Payments Received)', data.cashCollected, 'text-green-700'],
                ['Total Deposited at Bank', data.totalDeposited, 'text-blue-700'],
                ['Undeposited Cash', data.cashCollected - data.totalDeposited, data.cashCollected - data.totalDeposited > 0 ? 'text-orange-600' : 'text-gray-500'],
                null,
                ['Total Expenses Paid', data.totalExpenses, 'text-red-600'],
                null,
                ['BOOK BALANCE (Collected - Expenses)', data.bookBalance, 'text-[#1F4E79] font-bold'],
                ['BANK BALANCE (Deposited - Expenses)', data.bankBalance, 'text-[#1F4E79] font-bold'],
              ].map((row, i) => row === null ? (
                <div key={i} className="border-t border-gray-200 my-2" />
              ) : (
                <div key={i} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-gray-50">
                  <span className="text-sm text-gray-700">{row[0]}</span>
                  <span className={'text-sm font-medium ' + row[2]}>{fmtGhc(row[1] as number)}</span>
                </div>
              ))}
              <div className="border-t-2 border-[#1F4E79] mt-2 pt-3">
                <div className={'flex justify-between items-center px-3 py-2 rounded-lg ' + (Math.abs(data.difference) < 0.01 ? 'bg-green-50' : 'bg-red-50')}>
                  <span className="font-bold">DIFFERENCE (Book - Bank)</span>
                  <span className={'font-bold text-lg ' + (Math.abs(data.difference) < 0.01 ? 'text-green-700' : 'text-red-700')}>
                    {fmtGhc(data.difference)}
                  </span>
                </div>
                <div className={'text-center text-sm font-medium mt-2 ' + (Math.abs(data.difference) < 0.01 ? 'text-green-700' : 'text-red-700')}>
                  {Math.abs(data.difference) < 0.01 ? '✅ RECONCILED - Balances match' : '❌ OUT OF BALANCE - Check records'}
                </div>
              </div>
            </div>
          </div>

          {/* Deposits table */}
          <div className="card">
            <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bank Deposits in Period</div>
            <table className="data-table">
              <thead><tr><th className="w-24">Date</th><th>Bank / Account</th><th className="w-28">Reference</th><th className="w-28">Deposited By</th><th className="text-right w-28">Amount</th><th className="w-16">Actions</th></tr></thead>
              <tbody>
                {deposits.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">No deposits in this period</td></tr>
                : deposits.map((d: any) => (
                  <tr key={d.id}>
                    <td className="text-xs text-gray-500 whitespace-nowrap">{d.deposit_date}</td>
                    <td className="font-medium">{d.bank_name}</td>
                    <td className="text-xs text-gray-500">{d.reference||'-'}</td>
                    <td className="text-xs text-gray-500">{d.deposited_by||'-'}</td>
                    <td className="text-right font-bold text-blue-700 tabular-nums">{fmtGhc(d.amount)}</td>
                    <td><button onClick={()=>delDeposit(d)} className="btn btn-sm btn-danger">Del</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showDepForm && (
        <div className="modal-overlay" onClick={() => setShowDepForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">Record Bank Deposit</h2>
              <button onClick={() => setShowDepForm(false)} className="text-gray-400 text-xl">X</button>
            </div>
            <div className="modal-body space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group"><label className="form-label">Date</label><input type="date" value={depForm.deposit_date} onChange={e=>setDepForm(f=>({...f,deposit_date:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Bank / Account *</label><input value={depForm.bank_name} onChange={e=>setDepForm(f=>({...f,bank_name:e.target.value}))} className="form-input" placeholder="Momo 0241649507" /></div>
                <div className="form-group"><label className="form-label">Amount (GHc) *</label><input type="number" step="0.01" value={depForm.amount} onChange={e=>setDepForm(f=>({...f,amount:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Reference</label><input value={depForm.reference} onChange={e=>setDepForm(f=>({...f,reference:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Deposited By</label><input value={depForm.deposited_by} onChange={e=>setDepForm(f=>({...f,deposited_by:e.target.value}))} className="form-input" /></div>
                <div className="form-group"><label className="form-label">Notes</label><input value={depForm.notes} onChange={e=>setDepForm(f=>({...f,notes:e.target.value}))} className="form-input" /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowDepForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveDeposit} disabled={!depForm.bank_name||!depForm.amount} className="btn btn-primary">Save Deposit</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function ReconciliationPage() {
  return (
    <ModuleGuard moduleKey="reconciliation" moduleLabel="Cash & Bank">
      <ReconciliationPageInner />
    </ModuleGuard>
  )
}
