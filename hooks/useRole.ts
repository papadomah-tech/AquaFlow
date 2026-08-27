import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { ALL_MODULES } from '@/lib/modules'

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer' | null
export type EmployeeType = 'rider' | 'staff' | 'factory_manager' | null

export function useRole() {
  const [role, setRole]                   = useState<UserRole>(null)
  const [permissions, setPermissions]     = useState<string[]>([])
  const [employeeId, setEmployeeId]       = useState<number | null>(null)
  const [employeeType, setEmployeeType]   = useState<EmployeeType>(null)
  const [employeeName, setEmployeeName]   = useState<string>('')
  const [userId, setUserId]               = useState<string | null>(null)
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setLoading(false); return }
        setUserId(session.user.id)

        const { data: profile, error } = await supabase
          .from('profiles').select('role, permissions')
          .eq('id', session.user.id).single()

        if (error || !profile) {
          // Only create a new profile if it genuinely doesn't exist (PGRST116 = no rows)
          if (!profile && error?.code === 'PGRST116') {
            const name = session.user.email?.split('@')[0] ?? 'User'
            await supabase.from('profiles').insert({
              id: session.user.id, full_name: name,
              role: 'operator', is_active: true, permissions: ['customers'],
            })
            setRole('operator'); setPermissions(['customers'])
          } else {
            // Transient fetch error — retry once before giving up
            const { data: retry2 } = await supabase
              .from('profiles').select('role, permissions')
              .eq('id', session.user.id).single()
            if (retry2) {
              const r2 = (retry2.role as UserRole) ?? 'operator'
              setRole(r2)
              setPermissions(r2 === 'admin'
                ? ALL_MODULES.map(m => m.key)
                : (Array.isArray(retry2.permissions) && retry2.permissions.length > 0
                    ? retry2.permissions : ['customers']))
            } else {
              // Both attempts failed — show minimal access; don't overwrite DB
              setRole('operator'); setPermissions(['customers'])
            }
          }
          setLoading(false); return
        }

        const r = (profile.role as UserRole) ?? 'operator'
        setRole(r)

        // For admins, grant all modules regardless of permissions column
        // For others, use the DB permissions — never fall back to a hardcoded minimal set
        // which would silently strip access on any transient fetch issue
        if (r === 'admin') {
          setPermissions(ALL_MODULES.map(m => m.key))
        } else if (Array.isArray(profile.permissions) && profile.permissions.length > 0) {
          setPermissions(profile.permissions)
        } else {
          // permissions column is empty — try fetching once more before giving up
          const { data: retry } = await supabase
            .from('profiles').select('permissions')
            .eq('id', session.user.id).single()
          if (retry && Array.isArray(retry.permissions) && retry.permissions.length > 0) {
            setPermissions(retry.permissions)
          } else {
            // Genuinely no permissions set — use minimal safe default
            setPermissions(['customers'])
          }
        }

        // Fetch linked employee + their type
        const { data: emp } = await supabase
          .from('employees')
          .select('id, full_name, employee_type')
          .eq('auth_user_id', session.user.id)
          .single()

        if (emp) {
          setEmployeeId(emp.id)
          setEmployeeName(emp.full_name)
          setEmployeeType((emp.employee_type as EmployeeType) ?? 'staff')
        }
      } catch (err) {
        console.error('useRole error:', err)
        setRole('operator'); setPermissions(['customers'])
      } finally {
        setLoading(false)
      }
    }
    fetchRole()
  }, [])

  const isAdmin          = !loading && role === 'admin'
  const isRider          = !loading && employeeType === 'rider'
  const isFactoryManager = !loading && (role === 'admin' || employeeType === 'factory_manager')

  // useCallback gives canAccess a stable reference so it doesn't
  // trigger infinite re-renders when used in useEffect dependency arrays
  const canAccess = useCallback((moduleKey: string): boolean => {
    if (loading) return false
    if (role === 'admin') return true
    if (['settings', 'import'].includes(moduleKey)) return false
    return permissions.includes(moduleKey)
  }, [loading, role, permissions])

  return {
    role, loading, isAdmin,
    isRider, isFactoryManager,
    permissions, employeeId, employeeName, employeeType,
    userId, canAccess,
  }
}
