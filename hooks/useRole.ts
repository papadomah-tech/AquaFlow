import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ALL_MODULES } from '@/lib/modules'

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer' | null

interface RoleState {
  role:        UserRole
  loading:     boolean
  isAdmin:     boolean
  permissions: string[]
  employeeId:  number | null   // linked employee record (if any)
  userId:      string | null   // auth user id
  canAccess:   (moduleKey: string) => boolean
}

export function useRole(): RoleState {
  const [role, setRole]               = useState<UserRole>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [employeeId, setEmployeeId]   = useState<number | null>(null)
  const [userId, setUserId]           = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setLoading(false); return }

        setUserId(session.user.id)

        // Fetch profile
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role, permissions')
          .eq('id', session.user.id)
          .single()

        if (error || !profile) {
          const name = session.user.email?.split('@')[0] ?? 'User'
          await supabase.from('profiles').upsert({
            id: session.user.id, full_name: name,
            role: 'operator', is_active: true, permissions: ['sales'],
          })
          setRole('operator')
          setPermissions(['sales'])
          setLoading(false)
          return
        }

        const r = (profile.role as UserRole) ?? 'operator'
        setRole(r)
        setPermissions(r === 'admin'
          ? ALL_MODULES.map(m => m.key)
          : (Array.isArray(profile.permissions) && profile.permissions.length > 0
              ? profile.permissions : ['sales']))

        // Fetch linked employee record (for sales filtering)
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('auth_user_id', session.user.id)
          .single()
        if (emp) setEmployeeId(emp.id)

      } catch (err) {
        console.error('useRole error:', err)
        setRole('operator')
        setPermissions(['sales'])
      } finally {
        setLoading(false)
      }
    }
    fetchRole()
  }, [])

  const isAdmin = !loading && role === 'admin'

  const canAccess = (moduleKey: string): boolean => {
    if (loading) return false
    if (role === 'admin') return true
    const mod = ALL_MODULES.find(m => m.key === moduleKey)
    if (mod?.adminOnly) return false
    return permissions.includes(moduleKey)
  }

  return { role, loading, isAdmin, permissions, employeeId, userId, canAccess }
}
