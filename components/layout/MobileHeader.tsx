'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useRole } from '@/hooks/useRole'

const NAV_ALL = [
  { href: '/dashboard',      icon: '📊', label: 'Dashboard',    adminOnly: true  },
  { href: '/raw-materials',  icon: '🧱', label: 'Raw Materials', adminOnly: false },
  { href: '/production',     icon: '🏭', label: 'Production',    adminOnly: false },
  { href: '/stock',          icon: '📦', label: 'Stock',         adminOnly: false },
  { href: '/pricing',        icon: '💰', label: 'Pricing',       adminOnly: false },
  { href: '/sales',          icon: '💼', label: 'Sales',         adminOnly: false },
  { href: '/expenses',       icon: '💸', label: 'Expenses',      adminOnly: false },
  { href: '/reconciliation', icon: '🏦', label: 'Cash & Bank',   adminOnly: false },
  { href: '/personnel',      icon: '👥', label: 'Personnel',     adminOnly: false },
  { href: '/reports',        icon: '📈', label: 'Reports',       adminOnly: false },
  { href: '/settings',       icon: '⚙️', label: 'Settings',      adminOnly: true  },
]

export default function MobileHeader({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { isAdmin } = useRole()

  const NAV = NAV_ALL.filter(n => !n.adminOnly || isAdmin)
  const label = NAV.find(n => pathname.startsWith(n.href))?.label ?? 'AquaFlow'

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <>
      <header className="md:hidden fixed top-0 left-0 right-0 bg-[#1F4E79] text-white z-40
                         flex items-center justify-between px-4 h-14 shadow-lg">
        <button onClick={() => setOpen(true)} className="p-1 -ml-1 text-2xl">&#9776;</button>
        <div className="flex items-center gap-2">
          <span>💧</span>
          <span className="font-semibold text-sm">{label}</span>
        </div>
        <div className="text-xs text-blue-200 max-w-[80px] truncate">{userName}</div>
      </header>
      <div className="md:hidden h-14" />

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-[#1F4E79] flex flex-col"
               onClick={e => e.stopPropagation()}>
            <div className="px-4 py-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💧</span>
                <div>
                  <div className="text-white font-bold">AquaFlow</div>
                  <div className="text-blue-300 text-xs">{userName}</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 text-xl">✕</button>
            </div>
            <nav className="flex-1 overflow-y-auto py-3">
              {NAV.map(({ href, icon, label, adminOnly }) => (
                <Link key={href} href={href} onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-5 py-3 text-sm
                    ${pathname.startsWith(href)
                      ? 'bg-white/20 text-white font-semibold'
                      : 'text-blue-200 hover:bg-white/10 hover:text-white'}`}>
                  <span className="w-6">{icon}</span>
                  <span>{label}</span>
                  {adminOnly && (
                    <span className="ml-auto text-[9px] bg-white/20 text-white/70 px-1 rounded">
                      admin
                    </span>
                  )}
                </Link>
              ))}
            </nav>
            <div className="p-4 border-t border-white/10">
              <button onClick={signOut} className="text-blue-200 text-sm flex items-center gap-2">
                🚪 Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
