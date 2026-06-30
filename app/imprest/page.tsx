'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtNum, today } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// IMPREST MODULE
// ─────────────────────────────────────────────────────────────────────────────
// One active float per officer at a time.
// Advance is recorded as an expense (category: 'Imprest Advance') AND tracked
// here as a float. Officer records petty expenses against the float — no
// approval step. At closing, admin reconciles: total spent vs advance,
// and decides what happens to any unspent balance (refund / roll over / write off).
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ['Fuel','Transport','Stationery','Refreshment','Repairs','Communication','Miscellaneous','Other']

function ImprestPageInner() {
  const { isAdmin, employeeId, employeeName, userId } = useRole()

  const [employees, setEmployees]     = useState<any[]>([])
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null)
  const [floats, setFloats]           = useState<any[]>([])
  const [activeFloat, setActiveFloat] = useState<any>(null)
  const [entries, setEntries]         = useState<any[]>([])
  const [loading, setLoading]         = useState(true)

  // New advance form
  const [showAdvanceForm, setShowAdvanceForm] = useState(false)
  const [advanceForm, setAdvanceForm] = useState({
    employee_id: '', advance_date: today(), amount: '', notes: ''
  })

  // New entry form
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [entryForm, setEntryForm] = useState({
    entry_date: today(), category: 'Transport', description: '', amount: '', receipt_ref: ''
  })

  // Reconcile form
  const [showReconcile, setShowReconcile] = useState(false)
  const [reconcileAction, setReconcileAction] = useState<'refunded'|'rolled_over'|'written_off'>('refunded')
  const [reconcileNotes, setReconcileNotes] = useState('')

  const viewId = isAdmin ? selectedEmpId : employeeId

  useEffect(() => {
    supabase.from('employees').select('id,full_name,role,employee_type')
      .eq('status','active').order('full_name')
      .then(({ data }) => {
        setEmployees(data ?? [])
        if (isAdmin && data && data.length > 0 && !selectedEmpId) {
          setSelectedEmpId(data[0].id)
        }
      })
  }, [isAdmin])

  const load = useCallback(async () => {
    if (!viewId) { setLoading(false); return }
    setLoading(true)

    const { data: allFloats } = await supabase
      .from('imprest_floats')
      .select('*')
      .eq('employee_id', viewId)
      .order('advance_date', { ascending: false })

    setFloats(allFloats ?? [])
    const active = (allFloats ?? []).find((f: any) => f.status === 'active')
    setActiveFloat(active ?? null)

    if (active) {
      const { data: ents } = await supabase
        .from('imprest_entries')
        .select('*')
        .eq('float_id', active.id)
        .order('entry_date', { ascending: false })
      setEntries(ents ?? [])
    } else {
      setEntries([])
    }
    setLoading(false)
  }, [viewId])

  useEffect(() => { load() }, [load])

  // ── Issue new advance ────────────────────────────────────────────────────
  const issueAdvance = async () => {
    const empId = parseInt(advanceForm.employee_id || String(viewId))
    if (!empId) { alert('Select an officer.'); return }

    // Check no active float already exists
    const { data: existing } = await supabase
      .from('imprest_floats').select('id')
      .eq('employee_id', empId).eq('status', 'active').limit(1)
    if (existing && existing.length > 0) {
      alert('This officer already has an active float. Reconcile it before issuing a new advance.')
      return
    }

    const amount = parseFloat(advanceForm.amount) || 0
    const empName = employees.find((e:any) => e.id === empId)?.full_name ?? 'Officer'

    // Record as an expense
    const { data: exp } = await supabase.from('expenses').insert({
      expense_date: advanceForm.advance_date,
      category: 'Imprest Advance',
      description: `Imprest advance to ${empName}`,
      amount, paid_to: empName,
    }).select().single()

    // Record the float
    await supabase.from('imprest_floats').insert({
      employee_id: empId, advance_date: advanceForm.advance_date,
      advance_amount: amount, expense_id: exp?.id ?? null,
      status: 'active', notes: advanceForm.notes || null,
      created_by: userId,
    })

    setShowAdvanceForm(false)
    setAdvanceForm({ employee_id:'', advance_date:today(), amount:'', notes:'' })
    if (isAdmin) setSelectedEmpId(empId)
    load()
  }

  // ── Record petty expense entry ───────────────────────────────────────────
  const saveEntry = async () => {
    if (!activeFloat) return
    const amount = parseFloat(entryForm.amount) || 0
    const spent  = entries.reduce((a:number,e:any) => a + e.amount, 0)
    const remaining = activeFloat.advance_amount - spent

    if (amount > remaining) {
      if (!confirm(`This entry (${fmtGhc(amount)}) exceeds the remaining float balance (${fmtGhc(remaining)}).\n\nRecord anyway?`)) return
    }

    await supabase.from('imprest_entries').insert({
      float_id: activeFloat.id, entry_date: entryForm.entry_date,
      category: entryForm.category, description: entryForm.description,
      amount, receipt_ref: entryForm.receipt_ref || null,
      recorded_by: userId,
    })

    setShowEntryForm(false)
    setEntryForm({ entry_date:today(), category:'Transport', description:'', amount:'', receipt_ref:'' })
    load()
  }

  const deleteEntry = async (e: any) => {
    if (!confirm('Delete this entry?')) return
    await supabase.from('imprest_entries').delete().eq('id', e.id)
    load()
  }

  // ── Reconcile / close float ──────────────────────────────────────────────
  const totalSpent     = entries.reduce((a:number,e:any) => a + e.amount, 0)
  const unspentBalance = activeFloat ? activeFloat.advance_amount - totalSpent : 0

  const reconcile = async () => {
    if (!activeFloat) return
    await supabase.from('imprest_floats').update({
      status: 'reconciled',
      reconciled_date: today(),
      unspent_action: unspentBalance > 0 ? reconcileAction : null,
      unspent_amount: Math.max(0, unspentBalance),
      notes: (activeFloat.notes ? activeFloat.notes + ' | ' : '') + reconcileNotes,
    }).eq('id', activeFloat.id)

    // If refunded — record as a negative expense / credit note
    if (unspentBalance > 0 && reconcileAction === 'refunded') {
      const empName = employees.find((e:any) => e.id === viewId)?.full_name
        ?? activeFloat.employee_id
      await supabase.from('expenses').insert({
        expense_date: today(), category: 'Imprest Refund',
        description: `Unspent imprest refunded by ${empName ?? 'officer'}`,
        amount: -unspentBalance, paid_to: empName,
      })
    }

    setShowReconcile(false)
    setReconcileNotes('')
    load()
  }

  const empName = isAdmin
    ? (employees.find((e:any) => e.id === viewId)?.full_name ?? '—')
    : employeeName

  const CAT_BADGE = (cat: string) => {
    const colors: Record<string,string> = {
      'Transport':'badge-blue','Stationery':'badge-gray','Refreshment':'badge-yellow',
      'Repairs':'badge-red','Communication':'badge-green','Miscellaneous':'badge-gray',
    }
    return <span className={'badge ' + (colors[cat] ?? 'badge-gray')}>{cat}</span>
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">🧾 Imprest</h1>
          <div className="text-xs text-gray-400 mt-0.5">{empName}</div>
        </div>
        <div className="flex gap-2">
          {!activeFloat && (
            <button onClick={() => {
              setAdvanceForm(f => ({...f, employee_id: String(viewId ?? '')}))
              setShowAdvanceForm(true)
            }} className="btn btn-primary">
              + Issue Advance
            </button>
          )}
          {activeFloat && (
            <>
              <button onClick={() => setShowEntryForm(true)} className="btn btn-secondary">
                + Record Expense
              </button>
              <button onClick={() => setShowReconcile(true)} className="btn btn-warning">
                ✅ Reconcile & Close
              </button>
            </>
          )}
        </div>
      </div>

      {/* Admin employee selector */}
      {isAdmin && employees.length > 0 && (
        <div className="card mb-4 flex items-center gap-3">
          <label className="form-label mb-0 whitespace-nowrap">View float for:</label>
          <select value={viewId ?? ''} onChange={e => setSelectedEmpId(parseInt(e.target.value))}
            className="form-select flex-1">
            {employees.map((e:any) => (
              <option key={e.id} value={e.id}>{e.full_name} — {e.role}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <>
          {/* ── Active float status ───────────────────────────────────── */}
          {activeFloat ? (
            <>
              <div className={'rounded-2xl p-5 mb-5 text-white shadow-lg '
                + (unspentBalance >= 0 ? 'bg-[#1F4E79]' : 'bg-red-700')}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="text-blue-200 text-sm font-medium">Active Float Balance</div>
                    <div className="text-5xl font-bold mt-1 tabular-nums">{fmtGhc(unspentBalance)}</div>
                    <div className="text-blue-200 text-xs mt-1">
                      Advanced on {activeFloat.advance_date}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-white/10 rounded-xl px-4 py-3">
                      <div className="text-blue-200 text-xs">Advanced</div>
                      <div className="text-white font-bold text-xl tabular-nums">{fmtGhc(activeFloat.advance_amount)}</div>
                    </div>
                    <div className="bg-white/10 rounded-xl px-4 py-3">
                      <div className="text-blue-200 text-xs">Spent</div>
                      <div className="text-white font-bold text-xl tabular-nums">{fmtGhc(totalSpent)}</div>
                    </div>
                  </div>
                </div>
                {unspentBalance < 0 && (
                  <div className="mt-3 bg-red-400/30 rounded-xl p-3 text-sm">
                    ⚠️ Expenses exceed the advance by {fmtGhc(Math.abs(unspentBalance))}
                  </div>
                )}
              </div>

              {/* Entries table */}
              <div className="card">
                <div className="text-sm font-semibold text-[#1F4E79] mb-3">
                  Petty Cash Entries
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <colgroup>
                      <col style={{width:'90px'}} /><col style={{width:'110px'}} />
                      <col /><col style={{width:'100px'}} />
                      <col style={{width:'105px'}} /><col style={{width:'72px'}} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Date</th><th>Category</th><th>Description</th>
                        <th>Receipt</th><th className="right">Amount</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.length === 0
                        ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                            No entries yet. Click + Record Expense to add one.
                          </td></tr>
                        : entries.map((e:any) => (
                        <tr key={e.id}>
                          <td className="muted">{e.entry_date}</td>
                          <td>{CAT_BADGE(e.category)}</td>
                          <td className="text-sm">{e.description}</td>
                          <td className="muted">{e.receipt_ref || '—'}</td>
                          <td className="num-red">{fmtGhc(e.amount)}</td>
                          <td>
                            <button onClick={() => deleteEntry(e)} className="btn btn-sm btn-danger">Del</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {entries.length > 0 && (
                      <tfoot>
                        <tr className="bg-[#1F4E79]">
                          <td colSpan={4} className="py-2 px-3 text-white text-xs font-semibold">TOTAL SPENT</td>
                          <td className="py-2 px-3 text-white text-xs font-bold text-right tabular-nums">{fmtGhc(totalSpent)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">🧾</div>
              <div className="font-semibold text-gray-600 mb-1">No Active Imprest Float</div>
              <div className="text-sm text-gray-400">
                {isAdmin ? 'Issue an advance to start tracking petty cash for this officer.'
                  : 'Contact your administrator to request an imprest advance.'}
              </div>
            </div>
          )}

          {/* ── Float history ─────────────────────────────────────────── */}
          {floats.length > 0 && (
            <div className="card mt-4">
              <div className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Float History
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <colgroup>
                    <col style={{width:'90px'}} /><col style={{width:'100px'}} />
                    <col style={{width:'90px'}} /><col style={{width:'85px'}} />
                    <col style={{width:'90px'}} /><col style={{width:'95px'}} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Advanced</th><th className="right">Amount</th>
                      <th>Status</th><th>Closed</th>
                      <th className="right">Unspent</th><th>Action Taken</th><th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {floats.map((f:any) => (
                      <tr key={f.id}>
                        <td className="muted">{f.advance_date}</td>
                        <td className="num">{fmtGhc(f.advance_amount)}</td>
                        <td>
                          <span className={'badge ' + (f.status==='active'?'badge-blue':f.status==='reconciled'?'badge-green':'badge-gray')}>
                            {f.status}
                          </span>
                        </td>
                        <td className="muted">{f.reconciled_date || '—'}</td>
                        <td className="num">{f.unspent_amount > 0 ? fmtGhc(f.unspent_amount) : '—'}</td>
                        <td className="muted text-xs">
                          {f.unspent_action === 'refunded' ? '💰 Refunded'
                            : f.unspent_action === 'rolled_over' ? '🔄 Rolled over'
                            : f.unspent_action === 'written_off' ? '✏️ Written off'
                            : '—'}
                        </td>
                        <td className="text-xs text-gray-400">{f.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ISSUE ADVANCE MODAL ──────────────────────────────────────────── */}
      {showAdvanceForm && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowAdvanceForm(false)} />
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
            width:'min(480px,94vw)',background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',zIndex:9999,overflow:'hidden'}}>
            <div style={{padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div style={{fontWeight:'bold',color:'#1F4E79'}}>💵 Issue Imprest Advance</div>
              <div style={{fontSize:'0.75rem',color:'#888',marginTop:'2px'}}>
                Recorded automatically as an expense
              </div>
            </div>
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
              {isAdmin && (
                <div className="form-group">
                  <label className="form-label">Officer *</label>
                  <select value={advanceForm.employee_id}
                    onChange={e => setAdvanceForm(f => ({...f, employee_id: e.target.value}))}
                    className="form-select">
                    <option value="">Select officer...</option>
                    {employees.map((e:any) => (
                      <option key={e.id} value={e.id}>{e.full_name} — {e.role}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={advanceForm.advance_date}
                    onChange={e => setAdvanceForm(f => ({...f, advance_date: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (GHc) *</label>
                  <input type="number" step="0.01" value={advanceForm.amount}
                    onChange={e => setAdvanceForm(f => ({...f, amount: e.target.value}))}
                    className="form-input" placeholder="0.00" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea value={advanceForm.notes} rows={2}
                  onChange={e => setAdvanceForm(f => ({...f, notes: e.target.value}))}
                  className="form-input" placeholder="Purpose of advance..." />
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowAdvanceForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={issueAdvance}
                disabled={!advanceForm.amount || (isAdmin && !advanceForm.employee_id)}
                className="btn btn-primary">💵 Issue Advance</button>
            </div>
          </div>
        </>
      )}

      {/* ── RECORD ENTRY MODAL ───────────────────────────────────────────── */}
      {showEntryForm && activeFloat && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowEntryForm(false)} />
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
            width:'min(480px,94vw)',background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',zIndex:9999,overflow:'hidden'}}>
            <div style={{padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div style={{fontWeight:'bold',color:'#1F4E79'}}>🧾 Record Petty Expense</div>
              <div style={{fontSize:'0.75rem',color:'#888',marginTop:'2px'}}>
                Remaining: {fmtGhc(activeFloat.advance_amount - totalSpent)}
              </div>
            </div>
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input type="date" value={entryForm.entry_date}
                    onChange={e => setEntryForm(f => ({...f, entry_date: e.target.value}))}
                    className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select value={entryForm.category}
                    onChange={e => setEntryForm(f => ({...f, category: e.target.value}))}
                    className="form-select">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Description *</label>
                <input value={entryForm.description}
                  onChange={e => setEntryForm(f => ({...f, description: e.target.value}))}
                  className="form-input" placeholder="e.g. Fuel for delivery bike" />
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.75rem'}}>
                <div className="form-group">
                  <label className="form-label">Amount (GHc) *</label>
                  <input type="number" step="0.01" value={entryForm.amount}
                    onChange={e => setEntryForm(f => ({...f, amount: e.target.value}))}
                    className="form-input" placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Receipt Ref.</label>
                  <input value={entryForm.receipt_ref}
                    onChange={e => setEntryForm(f => ({...f, receipt_ref: e.target.value}))}
                    className="form-input" placeholder="Optional" />
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowEntryForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveEntry}
                disabled={!entryForm.description || !entryForm.amount}
                className="btn btn-primary">💾 Save Entry</button>
            </div>
          </div>
        </>
      )}

      {/* ── RECONCILE MODAL ──────────────────────────────────────────────── */}
      {showReconcile && activeFloat && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setShowReconcile(false)} />
          <div style={{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
            width:'min(480px,94vw)',background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',zIndex:9999,overflow:'hidden'}}>
            <div style={{padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div style={{fontWeight:'bold',color:'#1F4E79'}}>✅ Reconcile & Close Float</div>
            </div>
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'1rem'}}>
              <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <div className="text-xs text-gray-500">Advanced</div>
                  <div className="font-bold text-[#1F4E79]">{fmtGhc(activeFloat.advance_amount)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Spent</div>
                  <div className="font-bold text-red-600">{fmtGhc(totalSpent)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Unspent</div>
                  <div className={'font-bold ' + (unspentBalance >= 0 ? 'text-green-700' : 'text-red-700')}>
                    {fmtGhc(unspentBalance)}
                  </div>
                </div>
              </div>

              {unspentBalance > 0 && (
                <div className="form-group">
                  <label className="form-label">What happens to the unspent balance?</label>
                  <select value={reconcileAction}
                    onChange={e => setReconcileAction(e.target.value as any)}
                    className="form-select">
                    <option value="refunded">💰 Refunded to company (officer returns cash)</option>
                    <option value="rolled_over">🔄 Rolled over to next float</option>
                    <option value="written_off">✏️ Written off</option>
                  </select>
                </div>
              )}
              {unspentBalance < 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  ⚠️ Expenses exceeded the advance by {fmtGhc(Math.abs(unspentBalance))}.
                  This shortfall will be noted in the float history.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Reconciliation Notes</label>
                <textarea value={reconcileNotes} rows={2}
                  onChange={e => setReconcileNotes(e.target.value)}
                  className="form-input" placeholder="Any remarks..." />
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setShowReconcile(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={reconcile} className="btn btn-warning">✅ Confirm & Close Float</button>
            </div>
          </div>
        </>
      )}
    </AppLayout>
  )
}

export default function ImprestPage() {
  return (
    <ModuleGuard moduleKey="imprest" moduleLabel="Imprest">
      <ImprestPageInner />
    </ModuleGuard>
  )
}
