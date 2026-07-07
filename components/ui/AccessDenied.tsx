'use client'
import { useEffect, useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { supabase } from '@/lib/supabase'

export default function AccessDenied({ message, moduleLabel }: { message?: string; moduleLabel?: string }) {
  const [home, setHome] = useState('/customers')

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setHome('/login'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role, permissions').eq('id', session.user.id).single()
      if (!profile) return
      const r = profile.role || 'operator'
      const perms: string[] = Array.isArray(profile.permissions) && profile.permissions.length > 0
        ? profile.permissions : ['customers']
      if (r === 'admin') { setHome('/dashboard'); return }
      if (perms.includes('rider-sales')) { setHome('/rider-sales'); return }
      if (perms.includes('customers'))   { setHome('/customers');   return }
      if (perms.includes('sales'))       { setHome('/sales');       return }
    })()
  }, [])

  // Auto-redirect after 1.5s so the user never has to click
  useEffect(() => {
    const t = setTimeout(() => { window.location.href = home }, 1500)
    return () => clearTimeout(t)
  }, [home])

  return (
    <AppLayout>
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-[#1F4E79] mb-2">Access Restricted</h1>
          <p className="text-gray-500 mb-2">
            {message ?? `You do not have access to ${moduleLabel ?? 'this module'}.`}
          </p>
          <p className="text-gray-400 text-sm mb-6">Redirecting you now...</p>
          <a href={home} className="btn btn-primary inline-flex">
            ← Go to my home page
          </a>
        </div>
      </div>
    </AppLayout>
  )
}
