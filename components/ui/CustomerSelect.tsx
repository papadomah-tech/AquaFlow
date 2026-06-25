'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface Customer { id: number; name: string; phone?: string; address?: string }

interface Props {
  value:    string
  onChange: (id: string, customer?: Customer) => void
  disabled?: boolean
}

export default function CustomerSelect({ value, onChange, disabled }: Props) {
  const [customers, setCustomers]         = useState<Customer[]>([])
  const [search, setSearch]               = useState('')
  const [open, setOpen]                   = useState(false)
  const [showAddForm, setShowAddForm]     = useState(false)
  const [newCust, setNewCust]             = useState({ name:'', phone:'', address:'' })
  const [saving, setSaving]               = useState(false)
  const [contactSupported, setContactSupported] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setContactSupported('contacts' in navigator && 'ContactsManager' in window)
    loadCustomers()
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadCustomers = async (q?: string) => {
    let query = supabase.from('customers').select('id,name,phone,address').order('name')
    if (q) query = query.ilike('name', '%' + q + '%')
    const { data } = await query
    setCustomers(data ?? [])
  }

  const selected = customers.find(c => String(c.id) === value)

  const handleSearch = (q: string) => {
    setSearch(q)
    loadCustomers(q)
  }

  const pickContact = async () => {
    try {
      // @ts-ignore
      const contacts = await navigator.contacts.select(['name','tel'], { multiple: false })
      if (contacts?.length > 0) {
        const c = contacts[0]
        setNewCust(n => ({
          ...n,
          name:  c.name?.[0]  ?? n.name,
          phone: c.tel?.[0]   ?? n.phone,
        }))
      }
    } catch {}
  }

  const saveNewCustomer = async () => {
    if (!newCust.name.trim()) return
    setSaving(true)
    const { data } = await supabase
      .from('customers')
      .insert({ name: newCust.name.trim(), phone: newCust.phone, address: newCust.address })
      .select()
      .single()
    setSaving(false)
    if (data) {
      await loadCustomers()
      onChange(String(data.id), data)
      setShowAddForm(false)
      setOpen(false)
      setSearch('')
      setNewCust({ name:'', phone:'', address:'' })
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <div
        onClick={() => { if (!disabled) { setOpen(o => !o); setShowAddForm(false) } }}
        className={'form-input flex items-center justify-between cursor-pointer select-none '
          + (disabled ? 'opacity-50 cursor-not-allowed' : '')}>
        <span className={selected || value === 'walk-in' ? 'text-gray-800' : 'text-gray-400'}>
          {value === 'walk-in'
            ? 'Walk-in Customer'
            : selected
            ? selected.name
            : 'Select or add customer...'}
        </span>
        <span className="text-gray-400 text-xs ml-2">▼</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
          {/* Search bar */}
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Type to search..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
              onClick={e => e.stopPropagation()}
            />
          </div>

          {/* Customer list */}
          <div className="max-h-48 overflow-y-auto">
            {/* Walk-in Customer always pinned at top */}
            {(!search || 'walk-in'.includes(search.toLowerCase()) || 'random'.includes(search.toLowerCase()) || 'cash'.includes(search.toLowerCase())) && (
              <div
                onClick={() => { onChange('walk-in'); setOpen(false); setSearch('') }}
                className={'px-4 py-2.5 cursor-pointer hover:bg-orange-50 transition-colors border-b border-gray-100 '
                  + (value === 'walk-in' ? 'bg-orange-50 text-orange-700 font-semibold' : 'text-orange-600')}>
                <div className="text-sm font-medium">Walk-in Customer</div>
                <div className="text-xs text-orange-400">Random / Cash customer — no record needed</div>
              </div>
            )}
            {customers.length === 0 && search && !('walk-in'.includes(search.toLowerCase())) ? (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">
                No customers match "{search}"
              </div>
            ) : (
              customers.map(c => (
                <div key={c.id}
                  onClick={() => { onChange(String(c.id), c); setOpen(false); setSearch('') }}
                  className={'px-4 py-2.5 cursor-pointer hover:bg-blue-50 transition-colors '
                    + (String(c.id) === value ? 'bg-blue-50 text-[#1F4E79] font-semibold' : 'text-gray-700')}>
                  <div className="text-sm font-medium">{c.name}</div>
                  {c.phone && <div className="text-xs text-gray-400">{c.phone}</div>}
                </div>
              ))
            )}
          </div>

          {/* Add new section */}
          <div className="border-t border-gray-100">
            {!showAddForm ? (
              <button
                onClick={e => { e.stopPropagation(); setShowAddForm(true); setNewCust({ name: search, phone:'', address:'' }) }}
                className="w-full px-4 py-3 text-sm font-medium text-[#1F4E79] hover:bg-blue-50 text-left flex items-center gap-2">
                <span className="text-lg">+</span>
                Add "{search || 'new customer'}"
              </button>
            ) : (
              <div className="p-3 space-y-2" onClick={e => e.stopPropagation()}>
                <div className="text-xs font-semibold text-[#1F4E79] mb-2">New Customer</div>

                {contactSupported && (
                  <button onClick={pickContact}
                    className="w-full btn btn-secondary btn-sm justify-center mb-2">
                    📱 Pick from Phone Contacts
                  </button>
                )}

                <input value={newCust.name}
                  onChange={e => setNewCust(n => ({...n, name: e.target.value}))}
                  placeholder="Name *"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2E75B6]" />
                <input type="tel" value={newCust.phone}
                  onChange={e => setNewCust(n => ({...n, phone: e.target.value}))}
                  placeholder="Phone (optional)"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2E75B6]" />
                <input value={newCust.address}
                  onChange={e => setNewCust(n => ({...n, address: e.target.value}))}
                  placeholder="Area / Location (optional)"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#2E75B6]" />
                <div className="flex gap-2">
                  <button onClick={() => setShowAddForm(false)}
                    className="btn btn-secondary btn-sm flex-1">Cancel</button>
                  <button onClick={saveNewCustomer}
                    disabled={saving || !newCust.name.trim()}
                    className="btn btn-primary btn-sm flex-1">
                    {saving ? 'Saving...' : '💾 Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
