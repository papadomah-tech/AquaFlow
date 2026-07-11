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

  // Create user form
  const [newUser, setNewUser]       = useState({ full_name:'', email:'', password:'', role:'operator' })
  const [creating, setCreating]     = useState(false)
  const [createError, setCreateError]   = useState('')
  const [createSuccess, setCreateSuccess] = useState('')
  const [showPwd, setShowPwd]         = useState(false)
  const [resetUser, setResetUser]     = useState<ProfileRow | null>(null)
  const [resetPwd, setResetPwd]       = useState('')
  const [resetShowPwd, setResetShowPwd] = useState(false)
  const [resetting, setResetting]     = useState(false)
  const [resetOk, setResetOk]         = useState('')
  const [resetErr, setResetErr]       = useState('')

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
  // Show all modules in permissions modal except pure system ones
  const SYSTEM_ONLY = ['settings', 'import']
  const NON_ADMIN_MODS = ALL_MODULES.filter(m => !SYSTEM_ONLY.includes(m.key))

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

  // ── Create user ───────────────────────────────────────────────────────────
  const resetPassword = async () => {
    if (!resetUser || !resetPwd) return
    if (resetPwd.length < 6) { setResetErr('Password must be at least 6 characters.'); return }
    setResetting(true); setResetErr(''); setResetOk('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (session?.access_token ?? '') },
        body: JSON.stringify({ userId: resetUser.id, newPassword: resetPwd }),
      })
      const json = await res.json()
      if (!res.ok) setResetErr(json.error ?? 'Failed to reset password.')
      else { setResetOk('Password reset for ' + resetUser.full_name); setResetPwd('') }
    } catch (e: any) {
      setResetErr(e.message ?? 'Network error')
    } finally {
      setResetting(false)
    }
  }

  const createUser = async () => {
    setCreating(true); setCreateError(''); setCreateSuccess('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      const res = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(newUser),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error ?? 'Failed to create user.')
      } else {
        setCreateSuccess(newUser.email)
        setNewUser({ full_name:'', email:'', password:'', role:'operator' })
        load()
      }
    } catch (e: any) {
      setCreateError(e.message ?? 'Network error')
    } finally {
      setCreating(false)
    }
  }

  // ── Employee linking ───────────────────────────────────────────────────────
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
                  <th className="w-28">Role</th>
                  <th className="w-36">Linked Employee</th>
                  <th>Modules</th>
                  <th className="w-20">Status</th>
                  <th className="w-48">Actions</th>
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

      {/* ── CREATE USER CARD ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="font-semibold text-[#1F4E79] mb-3">
          ➕ Create New User Account
        </div>
        {createSuccess && (
          <div className="mb-3 bg-green-50 border border-green-200 text-green-700
                          text-sm rounded-lg p-3 flex items-center gap-2">
            ✅ User <strong>{createSuccess}</strong> created successfully.
            They can now log in at aqua-flow-sable.vercel.app
          </div>
        )}
        {createError && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700
                          text-sm rounded-lg p-3">
            ❌ {createError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label">Full Name *</label>
            <input
              value={newUser.full_name}
              onChange={e => setNewUser(u => ({...u, full_name: e.target.value}))}
              className="form-input"
              placeholder="e.g. Kwame Asante" />
          </div>
          <div className="form-group">
            <label className="form-label">Email Address *</label>
            <input type="email"
              value={newUser.email}
              onChange={e => setNewUser(u => ({...u, email: e.target.value}))}
              className="form-input"
              placeholder="e.g. kwame@example.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Password *
              <span className="text-gray-400 font-normal ml-1">(min 6 characters)</span>
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={newUser.password}
                onChange={e => setNewUser(u => ({...u, password: e.target.value}))}
                className="form-input pr-16"
                placeholder="Set a strong password" />
              <button type="button"
                onClick={() => setShowPwd(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2
                           text-xs text-gray-400 hover:text-gray-700">
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Initial Role</label>
            <select
              value={newUser.role}
              onChange={e => setNewUser(u => ({...u, role: e.target.value}))}
              className="form-select">
              <option value="operator">Operator — data entry</option>
              <option value="viewer">Viewer — read only</option>
              <option value="manager">Manager — edit all</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={createUser}
            disabled={creating || !newUser.email || !newUser.password || !newUser.full_name}
            className="btn btn-primary">
            {creating ? '⏳ Creating...' : '➕ Create User'}
          </button>
          <div className="text-xs text-gray-400">
            The user can log in immediately after creation. Assign their module
            permissions and link them to an employee record using the buttons above.
          </div>
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

      {/* ── RESET PASSWORD MODAL ─────────────────────────────────────── */}
      {resetUser && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9998}}
            onClick={() => setResetUser(null)} />
          <div style={{
            position:'fixed',top:'50%',left:'50%',
            transform:'translate(-50%,-50%)',
            width:'min(420px,94vw)',
            background:'white',borderRadius:'1rem',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)',
            zIndex:9999,overflow:'hidden'
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'1.25rem',borderBottom:'1px solid #f0f0f0'}}>
              <div>
                <div style={{fontWeight:'bold',color:'#1F4E79'}}>🔒 Reset Password</div>
                <div style={{fontSize:'0.75rem',color:'#888',marginTop:'2px'}}>
                  {resetUser.full_name}
                </div>
              </div>
              <button onClick={() => setResetUser(null)}
                style={{background:'none',border:'none',fontSize:'1.25rem',color:'#aaa',cursor:'pointer'}}>
                ✕
              </button>
            </div>
            <div style={{padding:'1.25rem',display:'flex',flexDirection:'column',gap:'1rem'}}>
              {resetOk && (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 text-sm text-center">
                  ✅ {resetOk}
                </div>
              )}
              {resetErr && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                  ❌ {resetErr}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">New Password</label>
                <div className="relative">
                  <input
                    type={resetShowPwd ? 'text' : 'password'}
                    value={resetPwd}
                    onChange={e => setResetPwd(e.target.value)}
                    className="form-input pr-16"
                    placeholder="Min. 6 characters"
                    autoFocus />
                  <button type="button"
                    onClick={() => setResetShowPwd(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700">
                    {resetShowPwd ? 'Hide' : 'Show'}
                  </button>
                </div>
                {resetPwd && resetPwd.length < 6 && (
                  <div className="text-xs text-red-500 mt-1">Too short — minimum 6 characters</div>
                )}
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                The user will be able to log in immediately with this new password.
                Share it with them securely.
              </div>
            </div>
            <div style={{display:'flex',gap:'0.75rem',justifyContent:'flex-end',
              padding:'1rem 1.25rem',borderTop:'1px solid #f0f0f0'}}>
              <button onClick={() => setResetUser(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={resetPassword}
                disabled={resetting || !resetPwd || resetPwd.length < 6}
                className="btn btn-primary">
                {resetting ? 'Resetting...' : '🔒 Set New Password'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── DANGER ZONE ──────────────────────────────────────────────────── */}
      <DangerZone />

      {/* ── DATA BACKUP ───────────────────────────────────────────────────── */}
      <DataBackup />

    </AppLayout>
  )
}

// ── Danger Zone component with selective reset ───────────────────────────────
// ─── All tables to back up ───────────────────────────────────────────────────
const BACKUP_TABLES = [
  { key: 'profiles',               label: 'User Profiles' },
  { key: 'employees',              label: 'Employees' },
  { key: 'customers',              label: 'Customers' },
  { key: 'sales',                  label: 'Sales' },
  { key: 'payments',               label: 'Payments' },
  { key: 'bulk_returns',           label: 'Bulk Returns' },
  { key: 'production_batches',     label: 'Production Batches' },
  { key: 'finished_inventory',     label: 'Finished Inventory' },
  { key: 'stock_takes',            label: 'Stock Takes' },
  { key: 'stock_take_items',       label: 'Stock Take Items' },
  { key: 'stock_adjustments',      label: 'Stock Adjustments' },
  { key: 'raw_materials',          label: 'Raw Materials' },
  { key: 'raw_material_purchases', label: 'Raw Material Purchases' },
  { key: 'raw_material_usage',     label: 'Raw Material Usage' },
  { key: 'roll_films',             label: 'Roll Films' },
  { key: 'expenses',               label: 'Expenses' },
  { key: 'imprest_entries',        label: 'Imprest Entries' },
  { key: 'imprest_floats',         label: 'Imprest Floats' },
  { key: 'bank_deposits',          label: 'Bank Deposits' },
  { key: 'salary_payments',        label: 'Salary Payments' },
  { key: 'employee_losses',        label: 'Employee Losses' },
  { key: 'attendance',             label: 'Attendance' },
  { key: 'rider_sales',            label: 'Rider Sales' },
  { key: 'rider_payments',         label: 'Rider Payments' },
  { key: 'opening_balances',       label: 'Opening Balances' },
]

function toCSV(rows: any[]): string {
  if (!rows || rows.length === 0) return 'No data'
  const headers = Object.keys(rows[0])
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n')
}

function DataBackup() {
  const [backing, setBacking]   = useState(false)
  const [progress, setProgress] = useState<string[]>([])
  const [done, setDone]         = useState(false)
  const [fmt, setFmt]           = useState<'csv' | 'excel'>('csv')

  const runBackup = async () => {
    setBacking(true); setDone(false); setProgress([])
    const ts = new Date().toISOString().slice(0, 10)

    if (fmt === 'excel') {
      // ── Excel: one sheet per table in a single .xlsx ──────────────────
      setProgress(['Loading Excel library...'])
      const XLSX = (await import('xlsx')).default
      const wb = XLSX.utils.book_new()

      for (const t of BACKUP_TABLES) {
        setProgress(p => [...p.slice(0,-1), `Fetching ${t.label}...`])
        try {
          const { data, error } = await supabase.from(t.key).select('*').limit(100000)
          if (error) {
            const ws = XLSX.utils.aoa_to_sheet([[`Error: ${error.message}`]])
            XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0, 31))
            setProgress(p => [...p.slice(0,-1), `⚠️ ${t.label} — ${error.message}`])
          } else {
            const rows = data ?? []
            const ws = rows.length > 0
              ? XLSX.utils.json_to_sheet(rows)
              : XLSX.utils.aoa_to_sheet([['No data']])
            XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0, 31))
            setProgress(p => [...p.slice(0,-1), `✓ ${t.label} (${rows.length} rows)`])
          }
        } catch (e: any) {
          const ws = XLSX.utils.aoa_to_sheet([[`Error: ${e.message}`]])
          XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0, 31))
          setProgress(p => [...p.slice(0,-1), `⚠️ ${t.label} — skipped`])
        }
      }

      XLSX.writeFile(wb, `aquaflow-backup-${ts}.xlsx`)

    } else {
      // ── CSV: one file per table in a ZIP ──────────────────────────────
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const folder = zip.folder('aquaflow-backup')!

      for (const t of BACKUP_TABLES) {
        setProgress(p => [...p, `Fetching ${t.label}...`])
        try {
          const { data, error } = await supabase.from(t.key).select('*').limit(100000)
          if (error) {
            folder.file(`${t.key}.csv`, `Error: ${error.message}`)
            setProgress(p => [...p.slice(0,-1), `⚠️ ${t.label} — ${error.message}`])
          } else {
            folder.file(`${t.key}.csv`, toCSV(data ?? []))
            setProgress(p => [...p.slice(0,-1), `✓ ${t.label} (${(data ?? []).length} rows)`])
          }
        } catch (e: any) {
          folder.file(`${t.key}.csv`, `Error: ${e.message}`)
          setProgress(p => [...p.slice(0,-1), `⚠️ ${t.label} — skipped`])
        }
      }

      folder.file('_manifest.txt', [
        'AquaFlow Manager — Data Backup',
        `Date: ${new Date().toLocaleString()}`,
        `Tables: ${BACKUP_TABLES.length}`,
        '',
        ...BACKUP_TABLES.map(t => `- ${t.key}.csv`),
      ].join('\n'))

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `aquaflow-backup-${ts}.zip`
      a.click(); URL.revokeObjectURL(url)
    }

    setBacking(false); setDone(true)
  }

  return (
    <div className="card mt-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-[#1F4E79]">💾 Data Backup</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Downloads all {BACKUP_TABLES.length} tables. Choose your preferred format.
          </p>
        </div>
      </div>

      {/* Format selector */}
      <div className="flex gap-3 mb-4">
        {([
          { key: 'csv',   label: '📄 CSV (ZIP)',      sub: 'One file per table' },
          { key: 'excel', label: '📊 Excel (.xlsx)',  sub: 'One sheet per table' },
        ] as const).map(({ key, label, sub }) => (
          <button
            key={key}
            onClick={() => setFmt(key)}
            disabled={backing}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '10px', textAlign: 'left',
              border: fmt === key ? '2px solid #1F4E79' : '2px solid #e5e7eb',
              background: fmt === key ? '#eff6ff' : '#f9fafb',
              cursor: backing ? 'not-allowed' : 'pointer',
            }}
          >
            <div style={{fontSize: '13px', fontWeight: 600, color: fmt === key ? '#1F4E79' : '#374151'}}>{label}</div>
            <div style={{fontSize: '11px', color: '#9ca3af', marginTop: '2px'}}>{sub}</div>
          </button>
        ))}
      </div>

      <button
        onClick={runBackup}
        disabled={backing}
        className="btn btn-primary w-full"
      >
        {backing ? '⏳ Backing up...' : `⬇️ Download ${fmt === 'excel' ? 'Excel Backup' : 'CSV Backup (ZIP)'}`}
      </button>

      {progress.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-3 text-xs font-mono space-y-0.5 max-h-48 overflow-y-auto mt-3">
          {progress.map((p, i) => (
            <div key={i} className={p.startsWith('✓') ? 'text-green-700' : p.startsWith('⚠') ? 'text-orange-600' : 'text-gray-500'}>
              {p}
            </div>
          ))}
          {done && (
            <div className="text-blue-700 font-semibold pt-1 border-t border-gray-200">
              ✅ Backup complete — check your Downloads folder.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DangerZone() {
  const [showReset, setShowReset]     = useState(false)
  const [selected, setSelected]       = useState<Record<string,boolean>>({})
  const [resetting, setResetting]     = useState(false)
  const [resetDone, setResetDone]     = useState<string[]>([])
  const [resetErrors, setResetErrors] = useState<string[]>([])

  // Module definitions — each with the tables to delete (in safe order)
  const RESET_MODULES = [
    {
      key: 'sales',
      label: 'Sales & Payments',
      icon: '💼',
      desc: 'All sales records, payments, bulk dispatches',
      tables: ['payments', 'sales'],
      warn: 'This will remove all revenue records.',
    },
    {
      key: 'stock',
      label: 'Stock & Inventory',
      icon: '📦',
      desc: 'Finished goods ledger, stock takes, adjustments',
      tables: ['stock_adjustments','stock_take_items','stock_takes','finished_inventory'],
      warn: 'Stock balance will reset to zero.',
    },
    {
      key: 'production',
      label: 'Production',
      icon: '🏭',
      desc: 'All production batches and roll film records',
      tables: ['production_batches','roll_films'],
      warn: null,
    },
    {
      key: 'rawmaterials',
      label: 'Raw Materials',
      icon: '🧱',
      desc: 'Purchases, usage records (material names kept)',
      tables: ['raw_material_usage','raw_material_purchases'],
      warn: null,
    },
    {
      key: 'expenses',
      label: 'Expenses & Deposits',
      icon: '💸',
      desc: 'All expenses, bank deposits, rider payments',
      tables: ['bank_deposits','rider_payments','expenses'],
      warn: null,
    },
    {
      key: 'personnel',
      label: 'Personnel Records',
      icon: '👥',
      desc: 'Attendance, salary payments, employee losses',
      tables: ['employee_losses','salary_payments','attendance'],
      warn: 'Employee records (names/salaries) are kept.',
    },
    {
      key: 'customers',
      label: 'Customers',
      icon: '👤',
      desc: 'All customer records',
      tables: ['customers'],
      warn: 'Sales linked to these customers will error if sales not reset first.',
    },
    {
      key: 'employees',
      label: 'Employees',
      icon: '🧑‍💼',
      desc: 'All employee records',
      tables: ['employees'],
      warn: 'Reset Personnel Records first. User login accounts are kept.',
    },
    {
      key: 'everything',
      label: 'EVERYTHING (Full Reset)',
      icon: '🗑️',
      desc: 'Clears all data across all modules',
      tables: [
        'stock_adjustments','stock_take_items','stock_takes',
        'finished_inventory','employee_losses','salary_payments',
        'attendance','payments','sales','bank_deposits',
        'rider_payments','expenses','raw_material_usage',
        'raw_material_purchases','production_batches','roll_films',
        'customers','employees','raw_materials','opening_balances',
      ],
      warn: 'All data will be permanently deleted. User accounts are kept.',
    },
  ]

  const toggle = (key: string) => {
    if (key === 'everything') {
      // Select/deselect all
      const anySelected = Object.values(selected).some(Boolean)
      if (anySelected) {
        setSelected({})
      } else {
        const all: Record<string,boolean> = {}
        RESET_MODULES.forEach(m => { all[m.key] = true })
        setSelected(all)
      }
      return
    }
    setSelected(s => ({...s, [key]: !s[key]}))
  }

  const selectedModules = RESET_MODULES.filter(m => selected[m.key] && m.key !== 'everything')

  const doReset = async () => {
    if (selectedModules.length === 0) {
      alert('Select at least one module to reset.')
      return
    }
    const moduleNames = selectedModules.map(m => '• ' + m.label).join('\n')
    const confirm1 = window.confirm(
      '⚠️ SELECTIVE RESET\n\n' +
      'You are about to permanently delete data from:\n' +
      moduleNames + '\n\n' +
      'This cannot be undone. Are you sure?'
    )
    if (!confirm1) return
    const input = window.prompt('Type RESET to confirm:')
    if (input?.trim().toUpperCase() !== 'RESET') {
      alert('Reset cancelled.')
      return
    }

    setResetting(true)
    setResetDone([])
    setResetErrors([])

    // Collect all tables in order (use a Set to avoid duplicates)
    const allTables: string[] = []
    const seen = new Set<string>()
    // Full reset order
    const ORDER = [
      'opening_balances','stock_adjustments','stock_take_items','stock_takes',
      'finished_inventory','employee_losses','salary_payments',
      'attendance','payments','sales','bank_deposits',
      'rider_payments','expenses','raw_material_usage',
      'raw_material_purchases','production_batches','roll_films',
      'customers','employees','raw_materials',
    ]
    // Add tables in dependency-safe order
    for (const t of ORDER) {
      for (const mod of selectedModules) {
        if (mod.tables.includes(t) && !seen.has(t)) {
          allTables.push(t)
          seen.add(t)
        }
      }
    }

    const done: string[]   = []
    const errors: string[] = []

    for (const t of allTables) {
      const { error } = await (supabase.from(t as any) as any).delete().gte('id', 0)
      if (error) errors.push(t + ': ' + error.message)
      else done.push(t)
    }

    setResetDone(done)
    setResetErrors(errors)
    setResetting(false)
    setSelected({})

    if (errors.length === 0) {
      alert('✅ Reset complete. ' + done.length + ' table(s) cleared.')
    }
  }

  return (
    <div className="card border-2 border-red-200 mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-red-700">⚠️ Danger Zone</div>
        <button onClick={() => { setShowReset(r => !r); setResetDone([]); setResetErrors([]) }}
          className={'btn btn-sm ' + (showReset ? 'btn-danger' : 'border border-red-300 text-red-600 bg-white hover:bg-red-50')}>
          {showReset ? '✕ Cancel' : '🗑️ Factory Reset'}
        </button>
      </div>
      <div className="text-sm text-gray-500">
        Selectively clear data from specific modules. User accounts are never deleted.
      </div>

      {showReset && (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Select modules to reset:
          </div>

          {RESET_MODULES.map(mod => (
            <label key={mod.key}
              className={'flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all '
                + (selected[mod.key]
                  ? mod.key === 'everything'
                    ? 'border-red-500 bg-red-50'
                    : 'border-orange-400 bg-orange-50'
                  : 'border-gray-200 bg-white hover:border-gray-300')
                + (mod.key === 'everything' ? ' mt-3 border-dashed' : '')}>
              <input type="checkbox"
                checked={!!selected[mod.key]}
                onChange={() => toggle(mod.key)}
                className="w-5 h-5 mt-0.5 accent-red-600 cursor-pointer flex-shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{mod.icon}</span>
                  <span className={'font-semibold text-sm '
                    + (selected[mod.key] ? mod.key === 'everything' ? 'text-red-700' : 'text-orange-700' : 'text-gray-700')}>
                    {mod.label}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{mod.desc}</div>
                {mod.warn && selected[mod.key] && (
                  <div className="text-xs text-red-600 mt-1 font-medium">⚠️ {mod.warn}</div>
                )}
              </div>
            </label>
          ))}

          {/* Summary */}
          {selectedModules.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-2">
              <div className="text-xs font-semibold text-red-700 mb-1">
                Will reset {selectedModules.length} module(s):
              </div>
              <div className="text-xs text-red-600">
                {selectedModules.map(m => m.icon + ' ' + m.label).join(' · ')}
              </div>
            </div>
          )}

          <button onClick={doReset}
            disabled={resetting || selectedModules.length === 0}
            className="btn btn-danger w-full justify-center mt-3 py-3">
            {resetting
              ? '⏳ Resetting...'
              : selectedModules.length === 0
              ? 'Select at least one module'
              : '🗑️ Reset ' + selectedModules.length + ' Module' + (selectedModules.length > 1 ? 's' : '')}
          </button>

          {/* Results */}
          {resetDone.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-2">
              <div className="text-xs font-semibold text-green-700 mb-1">✅ Cleared {resetDone.length} table(s):</div>
              <div className="text-xs text-green-600">{resetDone.join(', ')}</div>
            </div>
          )}
          {resetErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-2">
              <div className="text-xs font-semibold text-red-700 mb-1">❌ Errors:</div>
              {resetErrors.map((e,i) => <div key={i} className="text-xs text-red-600">{e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
