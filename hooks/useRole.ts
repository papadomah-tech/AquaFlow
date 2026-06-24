import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ALL_MODULES } from '@/lib/modules'

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer' | null

export function useRole() {
  const [role, setRole]               = useState<UserRole>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    const fetchRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setLoading(false); return }

        const { data, error } = await supabase
          .from('profiles')
          .select('role, permissions')
          .eq('id', session.user.id)
          .single()

        if (error || !data) {
          // Profile missing — auto-create and default to operator
          await supabase.from('profiles').upsert({
            id:          session.user.id,
            full_name:   session.user.email?.split('@')[0] ?? 'User',
            role:        'operator',
            is_active:   true,
            permissions: ['sales'],
          })
          setRole('operator')
          setPermissions(['sales'])
          setLoading(false)
          return
        }

        const r = (data.role as UserRole) ?? 'operator'
        setRole(r)

        if (r === 'admin') {
          setPermissions(ALL_MODULES.map(m => m.key))
        } else {
          const stored: string[] = Array.isArray(data.permissions) && data.permissions.length > 0
            ? data.permissions
            : ['sales']
          setPermissions(stored)
        }
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

  // isAdmin is only true once loading is complete AND role is confirmed admin
  const isAdmin = !loading && role === 'admin'

  const canAccess = (moduleKey: string): boolean => {
    // While loading, deny access to prevent flash of content
    if (loading) return false
    if (role === 'admin') return true
    const mod = ALL_MODULES.find(m => m.key === moduleKey)
    if (mod?.adminOnly) return false
    return permissions.includes(moduleKey)
  }

  return { role, loading, isAdmin, permissions, canAccess }
}
