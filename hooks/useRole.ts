import { useEffect, useState } from 'react'
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
          const name = session.user.email?.split('@')[0] ?? 'User'
          await supabase.from('profiles').upsert({
            id: session.user.id, full_name: name,
            role: 'operator', is_active: true, permissions: ['sales'],
          })
          setRole('operator'); setPermissions(['sales'])
          setLoading(false); return
        }

        const r = (profile.role as UserRole) ?? 'operator'
        setRole(r)
        setPermissions(r === 'admin'
          ? ALL_MODULES.map(m => m.key)
          : (Array.isArray(profile.permissions) && profile.permissions.length > 0
              ? profile.permissions : ['sales']))

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
        setRole('operator'); setPermissions(['sales'])
      } finally {
        setLoading(false)
      }
    }
    fetchRole()
  }, [])

  const isAdmin          = !loading && role === 'admin'
  const isRider          = !loading && employeeType === 'rider'
  const isFactoryManager = !loading && (role === 'admin' || employeeType === 'factory_manager')

  const canAccess = (moduleKey: string): boolean => {
    if (loading) return false
    if (role === 'admin') return true
    // settings and import are system-only — never grantable
    if (['settings', 'import'].includes(moduleKey)) return false
    // all other modules (including fund-account, sales-account, dashboard)
    // are accessible if explicitly in permissions
    return permissions.includes(moduleKey)
  }

  return {
    role, loading, isAdmin,
    isRider, isFactoryManager,
    permissions, employeeId, employeeName, employeeType,
    userId, canAccess,
  }
}
