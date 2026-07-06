'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import MobileHeader from '@/components/layout/MobileHeader'
import SyncStatusBar from '@/components/ui/SyncStatusBar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState('User')
  const [userRole, setUserRole] = useState('operator')
  const [userId, setUserId]     = useState<string | undefined>(undefined)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { window.location.href = '/login'; return }

        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role, permissions')
          .eq('id', session.user.id)
          .single()

        setUserId(session.user.id)
        if (profile) {
          setUserName(profile.full_name || session.user.email || 'User')
          const r = profile.role || 'operator'
          const perms: string[] = Array.isArray(profile.permissions) && profile.permissions.length > 0
            ? profile.permissions : ['customers']
          setUserRole(r)
          // Redirect root path to role-appropriate landing page
          if (window.location.pathname === '/' || window.location.pathname === '') {
            if (r === 'admin') window.location.href = '/dashboard'
            else if (perms.includes('customers')) window.location.href = '/customers'
            else if (perms.includes('sales')) window.location.href = '/sales'
            else window.location.href = '/customers'
          }
        } else {
          // Auto-create missing profile
          const name = session.user.email?.split('@')[0] || 'User'
          await supabase.from('profiles').upsert({
            id:          session.user.id,
            full_name:   name,
            role:        'operator',
            is_active:   true,
            permissions: ['customers'],
          })
          setUserName(name)
          setUserRole('operator')
        }
      } catch (err) {
        console.error('AppLayout error:', err)
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { window.location.href = '/login'; return }
        setUserName(session.user.email || 'User')
        setUserRole('operator')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-3">💧</div>
        <div className="text-[#1F4E79] font-semibold">Loading AquaFlow...</div>
        <div className="text-gray-400 text-sm mt-2">Please wait...</div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <Sidebar userName={userName} userRole={userRole} />
      <MobileHeader userName={userName} />
      <SyncStatusBar userId={userId} />
      <main className="md:ml-[220px] pb-16 md:pb-0 min-h-screen">
        <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">{children}</div>

      </main>
      <MobileNav />
    </div>
  )
}
