'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'
import { ALL_MODULES, DEFAULT_PERMISSIONS } from '@/lib/modules'

interface ProfileRow {
  id: string
  full_name: string
  role: string
  is_active: boolean
  permissions: string[]
}

export default function SettingsPage() {
  const { isAdmin, loading: roleLoading } = useRole()
  const [profiles, setProfiles]   = useState<ProfileRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [editUser, setEditUser]   = useState<ProfileRow | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('profiles').select('*').order('full_name')
    setProfiles((data ?? []).map((p: any) => ({
      ...p,
      permissions: p.permissions ?? DEFAULT_PERMISSIONS,
    })))
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  if (roleLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">
        Checking permissions...
      </div>
    </AppLayout>
  )

  if (!isAdmin) return <AccessDenied message="Only administrators can access Settings." />

  const ROLES = ['admin','manager','operator','viewer']
  const NON_ADMIN_MODULES = ALL_MODULES.filter(m => !m.adminOnly)

  const updateRole = async (id: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', id)
    load()
  }

  const toggleActive = async (id: string, is_active: boolean) => {
    await supabase.from('profiles').update({ is_active: !is_active }).eq('id', id)
    load()
  }

  const openPermissions = (p: ProfileRow) => {
    setEditUser({ ...p, permissions: p.permissions ?? DEFAULT_PERMISSIONS })
    setSaved(false)
  }

  const togglePermission = (key: string) => {
    if (!editUser) return
    const has = editUser.permissions.includes(key)
    setEditUser({
      ...editUser,
      permissions: has
        ? editUser.permissions.filter(k => k !== key)
        : [...editUser.permissions, key]
    })
  }

  const savePermissions = async () => {
    if (!editUser) return
    setSaving(true)
    await supabase.from('profiles')
      .update({ permissions: editUser.permissions })
      .eq('id', editUser.id)
    setSaving(false)
    setSaved(true)
    load()
  }

  const selectAll  = () => setEditUser(u => u ? { ...u, permissions: NON_ADMIN_MODULES.map(m => m.key) } : u)
  const selectNone = () => setEditUser(u => u ? { ...u, permissions: [] } : u)

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">⚙️ Settings</h1>
        <span className="badge badge-blue">Admin Only</span>
      </div>

      {/* Users & Permissions table */}
      <div className="card mb-4">
        <div className="font-semibold text-[#1F4E79] mb-1">Users & Module Access</div>
        <div className="text-xs text-gray-400 mb-4">
          Click <strong>Permissions</strong> on any user to control which modules they can access.
          Admin users always have access to everything.
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Modules Assigned</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.full_name}</td>
                  <td>
                    <select value={p.role}
                      onChange={e => updateRole(p.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white capitalize">
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    {p.role === 'admin' ? (
                      <span className="badge badge-blue">All modules</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {(p.permissions ?? []).length === 0 ? (
                          <span className="badge badge-red">No access</span>
                        ) : (
                          (p.permissions ?? []).map(k => {
                            const mod = ALL_MODULES.find(m => m.key === k)
                            return mod ? (
                              <span key={k} className="badge badge-blue text-[10px]">
                                {mod.icon} {mod.label}
                              </span>
                            ) : null
                          })
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={'badge ' + (p.is_active ? 'badge-green' : 'badge-gray')}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {p.role !== 'admin' && (
                        <button onClick={() => openPermissions(p)}
                          className="btn btn-sm btn-primary">
                          🔑 Permissions
                        </button>
                      )}
                      <button
                        onClick={() => toggleActive(p.id, p.is_active)}
                        className={'btn btn-sm ' + (p.is_active ? 'btn-warning' : 'btn-success')}>
                        {p.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* How to add users */}
      <div className="card">
        <div className="font-semibold text-[#1F4E79] mb-2">Add New Users</div>
        <div className="text-sm text-gray-600">
          Go to <strong>Supabase Dashboard</strong> &rarr; <strong>Authentication</strong>
          &rarr; <strong>Users</strong> &rarr; <strong>Create new user</strong>
          &rarr; enter email and password &rarr; tick <strong>Auto Confirm</strong>.
          The user will appear here automatically. Then assign their module permissions.
        </div>
      </div>

      {/* Permissions Modal */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal-box-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-[#1F4E79]">
                  🔑 Module Permissions — {editUser.full_name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5 capitalize">
                  Role: {editUser.role} &nbsp;|&nbsp;
                  {editUser.permissions.length} module{editUser.permissions.length !== 1 ? 's' : ''} assigned
                </p>
              </div>
              <button onClick={() => setEditUser(null)}
                className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="modal-body">
              {/* Quick actions */}
              <div className="flex gap-2 mb-4">
                <button onClick={selectAll}  className="btn btn-sm btn-secondary">✅ Select All</button>
                <button onClick={selectNone} className="btn btn-sm btn-secondary">☐ Clear All</button>
              </div>

              {/* Module checkboxes */}
              <div className="grid grid-cols-1 gap-2">
                {NON_ADMIN_MODULES.map(mod => {
                  const checked = editUser.permissions.includes(mod.key)
                  return (
                    <label key={mod.key}
                      className={'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all '
                        + (checked
                          ? 'border-[#2E75B6] bg-blue-50'
                          : 'border-gray-200 bg-white hover:border-gray-300')}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePermission(mod.key)}
                        className="w-5 h-5 accent-[#1F4E79] cursor-pointer"
                      />
                      <span className="text-xl">{mod.icon}</span>
                      <div className="flex-1">
                        <div className={'font-semibold text-sm '
                          + (checked ? 'text-[#1F4E79]' : 'text-gray-700')}>
                          {mod.label}
                        </div>
                        <div className="text-xs text-gray-400">{mod.description}</div>
                      </div>
                      {checked && (
                        <span className="badge badge-green text-[10px]">Access granted</span>
                      )}
                    </label>
                  )
                })}
              </div>

              {saved && (
                <div className="mt-4 bg-green-50 border border-green-200 text-green-700
                                text-sm rounded-lg p-3 text-center">
                  ✅ Permissions saved successfully!
                </div>
              )}
            </div>

            <div className="modal-footer">
              <div className="flex items-center gap-2 text-sm text-gray-500 mr-auto">
                <span className="text-lg">🔑</span>
                {editUser.permissions.length} of {NON_ADMIN_MODULES.length} modules selected
              </div>
              <button onClick={() => setEditUser(null)} className="btn btn-secondary">
                Close
              </button>
              <button onClick={savePermissions} disabled={saving}
                className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
