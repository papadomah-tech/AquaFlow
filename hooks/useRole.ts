import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer' | null

export function useRole() {
  const [role, setRole]       = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { setLoading(false); return }
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .single()
        setRole((data?.role as UserRole) ?? 'operator')
      } catch {
        setRole('operator')
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [])

  return { role, loading, isAdmin: role === 'admin' }
}
