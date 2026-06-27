'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import ModuleGuard from '@/components/ui/ModuleGuard'
import { supabase } from '@/lib/supabase'

interface Customer {
  id: number; name: string; phone?: string
  email?: string; address?: string; created_at: string
}

function CustomersPageInner() {
  const [customers, setCustomers]   = useState<Customer[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editItem, setEditItem]     = useState<Customer | null>(null)
  const [form, setForm]             = useState({ name:'', phone:'', email:'', address:'' })
  const [saving, setSaving]         = useState(false)
  const [contactSupported, setContactSupported] = useState(false)

  useEffect(() => {
    // Check if Contact Picker API is available (Android Chrome)
    setContactSupported('contacts' in navigator && 'ContactsManager' in window)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('customers').select('*').order('name')
    if (search) q = q.ilike('name', '%' + search + '%')
    const { data } = await q
    setCustomers(data ?? [])
    setLoading(false)
  }, [search])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setEditItem(null)
    setForm({ name:'', phone:'', email:'', address:'' })
    setShowForm(true)
  }

  const openEdit = (c: Customer) => {
    setEditItem(c)
    setForm({ name: c.name, phone: c.phone||'', email: c.email||'', address: c.address||'' })
    setShowForm(true)
  }

  // ── Pick from phone contacts (Contact Picker API) ─────────────────────────
  const pickFromContacts = async () => {
    try {
      const props = ['name','tel','email']
      const opts  = { multiple: false }
      // @ts-ignore — Contact Picker API
      const contacts = await navigator.contacts.select(props, opts)
      if (contacts && contacts.length > 0) {
        const c = contacts[0]
        setForm({
          name:    c.name?.[0]    ?? '',
          phone:   c.tel?.[0]     ?? '',
          email:   c.email?.[0]   ?? '',
          address: '',
        })
      }
    } catch (err) {
      console.error('Contact picker error:', err)
    }
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    if (editItem) {
      await supabase.from('customers').update(form).eq('id', editItem.id)
    } else {
      await supabase.from('customers').insert(form)
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  const del = async (c: Customer) => {
    if (!confirm('Delete customer ' + c.name + '?\nThis cannot be undone.')) return
    await supabase.from('customers').delete().eq('id', c.id)
    load()
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1 className="page-title">👥 Customers</h1>
          <div className="text-xs text-gray-400 mt-0.5">{customers.length} customers in base</div>
        </div>
        <button onClick={openNew} className="btn btn-primary">+ Add Customer</button>
      </div>

      {/* Search */}
      <div className="card mb-4 flex gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers by name..."
          className="form-input flex-1" />
        <button onClick={load} className="btn btn-secondary">🔍 Search</button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <colgroup>
              <col style={{width:'36px'}} />
              <col />
              <col style={{width:'130px'}} />
              <col style={{width:'160px'}} />
              <col style={{width:'170px'}} />
              <col style={{width:'120px'}} />
            </colgroup>
            <thead>
              <tr>
                <th className="center">#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
                : customers.length === 0
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                    No customers yet. Click "+ Add Customer" to get started.
                  </td></tr>
                : customers.map((c, i) => (
                  <tr key={c.id}>
                    <td className="muted center">{i + 1}</td>
                    <td className="font-medium">{c.name}</td>
                    <td className="text-xs text-gray-500">
                      {c.phone
                        ? <a href={'tel:' + c.phone} className="text-blue-600 hover:underline">{c.phone}</a>
                        : '—'}
                    </td>
                    <td className="muted">{c.email || '—'}</td>
                    <td className="muted">{c.address || '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)} className="btn btn-sm btn-secondary">Edit</button>
                        <button onClick={() => del(c)} className="btn btn-sm btn-danger">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="font-bold text-[#1F4E79]">
                {editItem ? 'Edit Customer' : '+ Add Customer'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-3">

              {/* Contact Picker button — shows on supported phones */}
              {!editItem && contactSupported && (
                <button onClick={pickFromContacts}
                  className="btn btn-secondary w-full justify-center py-2.5 text-sm">
                  📱 Pick from Phone Contacts
                </button>
              )}
              {!editItem && !contactSupported && (
                <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                  💡 <strong>Tip:</strong> On Android Chrome, you can pick customers directly
                  from your phone contacts. This browser does not support it — type manually below.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Customer Name *</label>
                <input value={form.name}
                  onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  className="form-input" placeholder="Full name or business name"
                  autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input type="tel" value={form.phone}
                  onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                  className="form-input" placeholder="e.g. 0241234567" />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({...f, email: e.target.value}))}
                  className="form-input" placeholder="optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Address / Location</label>
                <input value={form.address}
                  onChange={e => setForm(f => ({...f, address: e.target.value}))}
                  className="form-input" placeholder="e.g. Essikado, Sekondi" />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving || !form.name.trim()}
                className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

export default function CustomersPage() {
  return (
    <ModuleGuard moduleKey="customers" moduleLabel="Customers">
      <CustomersPageInner />
    </ModuleGuard>
  )
}
