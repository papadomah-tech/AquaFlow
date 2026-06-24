import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ALL_MODULES, ADMIN_ALWAYS } from '@/lib/modules'

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer' | null

export function useRole() {
  const [role, setRole]               = useState<UserRole>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setLoading(false); return }

        const { data } = await supabase
          .from('profiles')
          .select('role, permissions')
          .eq('id', session.user.id)
          .single()

        const r = (data?.role as UserRole) ?? 'operator'
        setRole(r)

        if (r === 'admin') {
          // Admin gets all modules
          setPermissions(ALL_MODULES.map(m => m.key))
        } else {
          // Use stored permissions, fallback to sales
          const stored: string[] = data?.permissions ?? ['sales']
          setPermissions(stored)
        }
      } catch {
        setRole('operator')
        setPermissions(['sales'])
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

  const isAdmin = role === 'admin'

  const canAccess = (moduleKey: string) => {
    if (isAdmin) return true
    // Admin-only modules are never accessible to non-admins
    const mod = ALL_MODULES.find(m => m.key === moduleKey)
    if (mod?.adminOnly) return false
    return permissions.includes(moduleKey)
  }

  return { role, loading, isAdmin, permissions, canAccess }
}
