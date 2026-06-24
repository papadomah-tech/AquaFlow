'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import AccessDenied from '@/components/ui/AccessDenied'
import { supabase } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

export default function SettingsPage() {
  const { role, loading: roleLoading, isAdmin } = useRole()
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading]   = useState(true)

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name')
    setProfiles(data ?? [])
    setLoading(false)
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  // Wait for role to load
  if (roleLoading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-gray-400">Checking permissions...</div>
      </div>
    </AppLayout>
  )

  // Block non-admins
  if (!isAdmin) return (
    <AccessDenied message="Only administrators can access User Settings." />
  )

  const updateRole = async (id: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', id)
    load()
  }

  const toggleActive = async (id: string, is_active: boolean) => {
    await supabase.from('profiles').update({ is_active: !is_active }).eq('id', id)
    load()
  }

  const ROLES = ['admin','manager','operator','viewer']
  const ROLE_DESC: Record<string,string> = {
    admin:    'Full access - manage users, delete records, all modules',
    manager:  'View and edit all data except user management',
    operator: 'Enter data (sales, production, expenses)',
    viewer:   'Read-only access to all modules'
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">⚙️ Settings</h1>
        <span className="badge badge-blue">Admin Only</span>
      </div>

      <div className="card mb-4">
        <div className="font-semibold text-[#1F4E79] mb-3">User Roles</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {ROLES.map(r => (
            <div key={r} className="bg-gray-50 rounded-lg p-3">
              <div className="font-semibold capitalize text-[#1F4E79] mb-1">{r}</div>
              <div className="text-xs text-gray-500">{ROLE_DESC[r]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb-4">
        <div className="font-semibold text-[#1F4E79] mb-2">Add New Users</div>
        <div className="text-sm text-gray-600">
          To create accounts: <strong>Supabase Dashboard</strong> &rarr;
          <strong> Authentication</strong> &rarr; <strong>Users</strong> &rarr;
          <strong> Create new user</strong> &rarr; enter email and password &rarr;
          tick Auto Confirm &rarr; then set their role below.
        </div>
      </div>

      <div className="card">
        <div className="font-semibold text-[#1F4E79] mb-3">All Users</div>
        {loading ? (
          <div className="text-center py-6 text-gray-400">Loading...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {profiles.map((p: any) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.full_name}</td>
                  <td className="text-xs text-gray-500">{p.id.slice(0,8)}...</td>
                  <td>
                    <select value={p.role}
                      onChange={e => updateRole(p.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white capitalize">
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <span className={'badge ' + (p.is_active ? 'badge-green' : 'badge-gray')}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => toggleActive(p.id, p.is_active)}
                      className={'btn btn-sm ' + (p.is_active ? 'btn-warning' : 'btn-success')}>
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}
