'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import MobileHeader from '@/components/layout/MobileHeader'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      const { data } = await supabase
        .from('profiles').select('full_name, role')
        .eq('id', session.user.id).single()
      if (data) { setUserName(data.full_name); setUserRole(data.role) }
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="text-4xl mb-3">💧</div>
        <div className="text-[#1F4E79] font-semibold">Loading AquaFlow...</div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <Sidebar userName={userName} userRole={userRole} />
      <MobileHeader userName={userName} />
      <main className="md:ml-[220px] pb-16 md:pb-0 min-h-screen">
        <div className="p-4 md:p-6 max-w-screen-2xl mx-auto">{children}</div>
      </main>
      <MobileNav />
    </div>
  )
}
