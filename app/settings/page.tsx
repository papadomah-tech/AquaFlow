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

interface Employee {
  id: number
  full_name: string
  role: string
  auth_user_id: string | null
}

export default function SettingsPage() {
  const { isAdmin, loading: roleLoading } = useRole()
  const [profiles, setProfiles]       = useState<ProfileRow[]>([])
  const [employees, setEmployees]     = useState<Employee[]>([])
  const [loading, setLoading]         = useState(true)
  const [editUser, setEditUser]       = useState<ProfileRow | null>(null)
  const [linkUser, setLinkUser]       = useState<ProfileRow | null>(null)
  const [linkEmpId, setLinkEmpId]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [linkSaving, setLinkSaving]   = useState(false)
  const [linkSaved, setLinkSaved]     = useState(false)

  const load = async () => {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('employees').select('id,full_name,role,auth_user_id')
        .eq('status', 'active').order('full_name'),
    ])
    setProfiles((p ?? []).map((x: any) => ({
      ...x, permissions: x.permissions ?? DEFAULT_PERMISSIONS
    })))
    setEmployees(e ?? [])
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

  const ROLES          = ['admin','manager','operator','viewer']
  const NON_ADMIN_MODS = ALL_MODULES.filter(m => !m.adminOnly)

  const updateRole = async (id: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', id)
    load()
  }

  const toggleActive = async (id: string, is_active: boolean) => {
    await supabase.from('profiles').update({ is_active: !is_active }).eq('id', id)
    load()
  }

  // ── Permissions ───────────────────────────────────────────────────────────
  const openPermissions = (p: ProfileRow) => {
    setEditUser({ ...p, permissions: p.permissions ?? DEFAULT_PERMISSIONS })
    setSaved(false)
  }

  const togglePerm = (key: string) => {
    if (!editUser) return
    const has = editUser.permissions.includes(key)
    setEditUser({
      ...editUser,
      permissions: has
        ? editUser.permissions.filter(k => k !== key)
        : [...editUser.permissions, key],
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

  // ── Employee linking ──────────────────────────────────────────────────────
  const openLink = (p: ProfileRow) => {
    setLinkUser(p)
    setLinkSaved(false)
    // Pre-select if already linked
    const existing = employees.find(e => e.auth_user_id === p.id)
    setLinkEmpId(existing ? String(existing.id) : '')
  }

  const saveLink = async () => {
    if (!linkUser) return
    setLinkSaving(true)
    // Unlink any previous link for this user
    await supabase.from('employees')
      .update({ auth_user_id: null })
      .eq('auth_user_id', linkUser.id)
    // Set new link
    if (linkEmpId) {
      await supabase.from('employees')
        .update({ auth_user_id: linkUser.id })
        .eq('id', parseInt(linkEmpId))
    }
    setLinkSaving(false)
    setLinkSaved(true)
    load()
  }

  // Find which employee is linked to a profile
  const linkedEmp = (profileId: string) =>
    employees.find(e => e.auth_user_id === profileId)

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">⚙️ Settings</h1>
        <span className="badge badge-blue">Admin Only</span>
      </div>

      {/* Users table */}
      <div className="card mb-4">
        <div className="font-semibold text-[#1F4E79] mb-1">Users, Permissions & Employee Linking</div>
        <div className="text-xs text-gray-400 mb-4">
          Use <strong>🔑 Permissions</strong> to control which modules a user can access.
          Use <strong>👤 Link Employee</strong> to connect a login account to an employee record
          (required so sales officers see only their own transactions).
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Linked Employee</th>
                  <th>Modules</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => {
                  const emp = linkedEmp(p.id)
                  return (
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
                          <span className="text-xs text-gray-400">N/A</span>
                        ) : emp ? (
                          <span className="badge badge-green text-[11px]">
                            👤 {emp.full_name}
                          </span>
                        ) : (
                          <span className="badge badge-red text-[11px]">⚠️ Not linked</span>
                        )}
                      </td>
                      <td>
                        {p.role === 'admin' ? (
                          <span className="badge badge-blue">All modules</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(p.permissions ?? []).length === 0 ? (
                              <span className="badge badge-red">No access</span>
                            ) : (
                              (p.permissions ?? []).slice(0, 3).map(k => {
                                const mod = ALL_MODULES.find(m => m.key === k)
                                return mod ? (
                                  <span key={k} className="badge badge-blue text-[10px]">
                                    {mod.icon} {mod.label}
                                  </span>
                                ) : null
                              })
                            )}
                            {(p.permissions ?? []).length > 3 && (
                              <span className="badge badge-gray text-[10px]">
                                +{(p.permissions ?? []).length - 3} more
                              </span>
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
                        <div className="flex gap-1 flex-wrap">
                          {p.role !== 'admin' && (
                            <>
                              <button onClick={() => openPermissions(p)}
                                className="btn btn-sm btn-primary">
                                🔑 Permissions
                              </button>
                              <button onClick={() => openLink(p)}
                                className="btn btn-sm btn-secondary">
                                👤 Link Employee
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => toggleActive(p.id, p.is_active)}
                            className={'btn btn-sm ' + (p.is_active ? 'btn-warning' : 'btn-success')}>
                            {p.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add user instructions */}
      <div className="card">
        <div className="font-semibold text-[#1F4E79] mb-2">Add New Users</div>
        <div className="text-sm text-gray-600">
          Go to <strong>Supabase Dashboard</strong> &rarr;
          <strong> Authentication</strong> &rarr; <strong>Users</strong> &rarr;
          <strong> Create new user</strong> &rarr; enter email and password &rarr;
          tick <strong>Auto Confirm</strong>. The user will appear here automatically.
          Then assign their module permissions and link them to their employee record.
        </div>
      </div>

      {/* ── PERMISSIONS MODAL ─────────────────────────────────────────────── */}
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
                  {editUser.permissions.length} of {NON_ADMIN_MODS.length} modules assigned
                </p>
              </div>
              <button onClick={() => setEditUser(null)}
                className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="modal-body">
              <div className="flex gap-2 mb-4">
                <button onClick={() => setEditUser(u => u ? { ...u, permissions: NON_ADMIN_MODS.map(m => m.key) } : u)}
                  className="btn btn-sm btn-secondary">✅ Select All</button>
                <button onClick={() => setEditUser(u => u ? { ...u, permissions: [] } : u)}
                  className="btn btn-sm btn-secondary">☐ Clear All</button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {NON_ADMIN_MODS.map(mod => {
                  const checked = editUser.permissions.includes(mod.key)
                  return (
                    <label key={mod.key}
                      className={'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all '
                        + (checked ? 'border-[#2E75B6] bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300')}>
                      <input type="checkbox" checked={checked}
                        onChange={() => togglePerm(mod.key)}
                        className="w-5 h-5 accent-[#1F4E79] cursor-pointer" />
                      <span className="text-xl">{mod.icon}</span>
                      <div className="flex-1">
                        <div className={'font-semibold text-sm ' + (checked ? 'text-[#1F4E79]' : 'text-gray-700')}>
                          {mod.label}
                        </div>
                        <div className="text-xs text-gray-400">{mod.description}</div>
                      </div>
                      {checked && <span className="badge badge-green text-[10px]">Access granted</span>}
                    </label>
                  )
                })}
              </div>
              {saved && (
                <div className="mt-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 text-center">
                  ✅ Permissions saved successfully!
                </div>
              )}
            </div>
            <div className="modal-footer">
              <div className="text-sm text-gray-500 mr-auto">
                {editUser.permissions.length} of {NON_ADMIN_MODS.length} modules selected
              </div>
              <button onClick={() => setEditUser(null)} className="btn btn-secondary">Close</button>
              <button onClick={savePermissions} disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : '💾 Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LINK EMPLOYEE MODAL ───────────────────────────────────────────── */}
      {linkUser && (
        <div className="modal-overlay" onClick={() => setLinkUser(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-[#1F4E79]">
                  👤 Link Employee — {linkUser.full_name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Connect this login account to an employee record so they only see their own sales.
                </p>
              </div>
              <button onClick={() => setLinkUser(null)}
                className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="modal-body space-y-4">
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                <strong>Why link?</strong> When a user is linked to an employee record,
                they can only see and create their own sales transactions.
                Admins always see everything.
              </div>

              <div className="form-group">
                <label className="form-label">Select Employee Record</label>
                <select value={linkEmpId}
                  onChange={e => setLinkEmpId(e.target.value)}
                  className="form-select">
                  <option value="">— No link (unlinked) —</option>
                  {employees.map(e => {
                    const alreadyLinked = e.auth_user_id && e.auth_user_id !== linkUser.id
                    return (
                      <option key={e.id} value={e.id} disabled={!!alreadyLinked}>
                        {e.full_name} ({e.role}){alreadyLinked ? ' — already linked to another account' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {linkEmpId && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                  ✅ <strong>{linkUser.full_name}</strong> will be linked to employee record:
                  <strong> {employees.find(e => e.id === parseInt(linkEmpId))?.full_name}</strong>
                </div>
              )}

              {!linkEmpId && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-700">
                  ⚠️ Without a link, this user will see a warning in Sales
                  and cannot record transactions under their name.
                </div>
              )}

              {linkSaved && (
                <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 text-center">
                  ✅ Employee link saved successfully!
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setLinkUser(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveLink} disabled={linkSaving} className="btn btn-primary">
                {linkSaving ? 'Saving...' : '💾 Save Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
