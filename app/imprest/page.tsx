'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase, fmtGhc, fmtDate, today } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

// ─────────────────────────────────────────────────────────────────────────────
// IMPREST MODULE — Factory Manager's Petty Cash Log
// No advance. Manager spends from weekly revenue before depositing.
// Entries automatically feed into Weekly Deposit Report as "Cash used for operations".
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ['Transport','Fuel','Stationery','Refreshment','Repairs','Communication','Miscellaneous','Other']

const CAT_COLORS: Record<string,string> = {
  'Transport':'badge-blue','Stationery':'badge-gray','Refreshment':'badge-yellow',
  'Repairs':'badge-red','Communication':'badge-green','Miscellaneous':'badge-gray','Other':'badge-gray',
}

function ImprestPageInner() {
  const { isAdmin, userId } = useRole()

  const [entries, setEntries]   = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1) // Monday
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay() + 7) // Sunday
    return d.toISOString().split('T')[0]
  })

  // Entry form
  const [showForm, setShowForm]   = useState(false)
  const [editItem, setEditItem]   = useState<any>(null)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState({
    entry_date: today(), category: 'Transport', description: '', amount: '', receipt_ref: ''
  })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('imprest_entries')
      .select('*')
      .gte('entry_date', dateFrom)
      .lte('entry_date', dateTo)
      .or('is_archived.is.null,is_archived.eq.false').order('entry_date', { ascending: false })
      .order('id', { ascending: false })
    setEntries(data ?? [])
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditItem(null)
    setForm({ entry_date: today(), category: 'Transport', description: '', amount: '', receipt_ref: '' })
    setShowForm(true)
  }

  const openEdit = (e: any) => {
    setEditItem(e)
    setForm({ entry_date: e.entry_date, category: e.category, description: e.description, amount: String(e.amount), receipt_ref: e.receipt_ref ?? '' })
    setShowForm(true)
  }

  const save = async () => {
    if (!form.description.trim()) { alert('Description is required.'); return }
    const amount = parseFloat(form.amount) || 0
    if (!amount) { alert('Enter an amount.'); return }
    setSaving(true)

    const payload = {
      entry_date:   form.entry_date,
      category:     form.category,
      description:  form.description.trim(),
      amount,
      receipt_ref:  form.receipt_ref.trim() || null,
      recorded_by:  userId,
    }

    if (editItem) {
      await supabase.from('imprest_entries').update(payload).eq('id', editItem.id)
    } else {
      await supabase.from('imprest_entries').insert(payload)
    }

    setSaving(false)
    setShowForm(false)
    load()
  }

  const del = async (e: any) => {
    if (!confirm(`Delete "${e.description}"?`)) return
    await supabase.from('imprest_entries').delete().eq('id', e.id)
    load()
  }

  const totalSpent = entries.reduce((a, e) => a + e.amount, 0)

  return (
    <AppLayout>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🧾 Imprest</h1>
          <p className="page-subtitle">Factory Manager — Petty Cash Log</p>
        </div>
        <button onClick={openNew} className="btn btn-primary">+ Record Expense</button>
      </div>

      {/* ── Date filter ── */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs text-gray-400 mb-1">From</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="form-input" style={{width:'145px'}} />
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">To</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="form-input" style={{width:'145px'}} />
          </div>
          <div className="text-xs text-gray-400">
            Set to your week (Mon–Sun) to match the Deposit Report
          </div>
        </div>
      </div>

      {/* ── Summary banner ── */}
      {entries.length > 0 && (
        <div style={{background:'linear-gradient(135deg,#1F4E79,#2563eb)',borderRadius:'14px',padding:'16px 20px',marginBottom:'16px',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:'12px',opacity:0.75,marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.05em'}}>
              Total Cash used for Operations
            </div>
            <div style={{fontSize:'32px',fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmtGhc(totalSpent)}</div>
            <div style={{fontSize:'11px',opacity:0.6,marginTop:'4px'}}>
              {entries.length} expense{entries.length !== 1 ? 's' : ''} · {dateFrom} to {dateTo}
            </div>
          </div>
          <div style={{background:'rgba(255,255,255,0.12)',borderRadius:'10px',padding:'10px 16px',textAlign:'center'}}>
            <div style={{fontSize:'11px',opacity:0.75,marginBottom:'2px'}}>Auto-feeds into</div>
            <div style={{fontSize:'13px',fontWeight:600}}>Weekly Deposit Report</div>
            <div style={{fontSize:'11px',opacity:0.6,marginTop:'2px'}}>Cash used for operations</div>
          </div>
        </div>
      )}

      {/* ── Entries table ── */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'90px'}} /><col style={{width:'120px'}} />
              <col /><col style={{width:'100px'}} />
              <col style={{width:'110px'}} /><col style={{width:'130px'}} />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th><th>Category</th><th>Description</th>
                <th>Receipt</th><th className="right">Amount</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400 italic">
                  No expenses recorded for this period. Click + Record Expense to add one.
                </td></tr>
              ) : entries.map(e => (
                <tr key={e.id}>
                  <td className="muted text-xs">{fmtDate(e.entry_date)}</td>
                  <td><span className={'badge ' + (CAT_COLORS[e.category] ?? 'badge-gray')}>{e.category}</span></td>
                  <td className="text-sm">{e.description}</td>
                  <td className="muted text-xs">{e.receipt_ref || '—'}</td>
                  <td className="num text-red-600 font-medium">{fmtGhc(e.amount)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(e)} className="btn btn-sm btn-secondary">Edit</button>
                      <button onClick={() => del(e)} className="btn btn-sm btn-danger">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="bg-[#1F4E79] text-white font-semibold">
                  <td className="px-3 py-2 text-xs uppercase tracking-wide" colSpan={4}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtGhc(totalSpent)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Info note ── */}
      <div className="mt-3 text-xs text-gray-400 text-center">
        These expenses automatically populate <strong>Cash used for operations</strong> in the Weekly Deposit Report for the matching week.
      </div>

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" style={{maxWidth:'460px'}} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">{editItem ? 'Edit Expense' : '🧾 Record Petty Expense'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="form-group">
                  <label className="form-label">Date *</label>
                  <input type="date" value={form.entry_date}
                    onChange={e => setForm(f => ({...f, entry_date: e.target.value}))}
                    className="form-input" max={today()} />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select value={form.category}
                    onChange={e => setForm(f => ({...f, category: e.target.value}))}
                    className="form-select">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group col-span-2">
                  <label className="form-label">Description *</label>
                  <input value={form.description}
                    onChange={e => setForm(f => ({...f, description: e.target.value}))}
                    className="form-input" placeholder="e.g. Fuel for delivery bike" />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (GH₵) *</label>
                  <input type="number" step="0.01" min="0" value={form.amount}
                    onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                    className="form-input" placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Receipt Ref.</label>
                  <input value={form.receipt_ref}
                    onChange={e => setForm(f => ({...f, receipt_ref: e.target.value}))}
                    className="form-input" placeholder="Optional" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={save}
                disabled={saving || !form.description.trim() || !form.amount}
                className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
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
