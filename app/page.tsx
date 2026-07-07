'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home() {
  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }

      const { data: profile } = await supabase
        .from('profiles').select('role, permissions').eq('id', session.user.id).single()

      if (!profile) { window.location.href = '/customers'; return }

      const r = profile.role || 'operator'
      const perms: string[] = Array.isArray(profile.permissions) && profile.permissions.length > 0
        ? profile.permissions : ['customers']

      if (r === 'admin') { window.location.href = '/dashboard'; return }
      if (perms.includes('rider-sales')) { window.location.href = '/rider-sales'; return }
      if (perms.includes('customers')) { window.location.href = '/customers'; return }
      if (perms.includes('sales')) { window.location.href = '/sales'; return }
      window.location.href = '/customers'
    })()
  }, [])

  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--text-muted)'}}>Loading...</div>
}
