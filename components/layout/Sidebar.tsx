'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard',      icon: '📊', label: 'Dashboard' },
  { href: '/raw-materials',  icon: '🧱', label: 'Raw Materials' },
  { href: '/production',     icon: '🏭', label: 'Production' },
  { href: '/stock',          icon: '📦', label: 'Stock' },
  { href: '/pricing',        icon: '💰', label: 'Pricing' },
  { href: '/sales',          icon: '💼', label: 'Sales' },
  { href: '/expenses',       icon: '💸', label: 'Expenses' },
  { href: '/reconciliation', icon: '🏦', label: 'Cash & Bank' },
  { href: '/personnel',      icon: '👥', label: 'Personnel' },
  { href: '/reports',        icon: '📈', label: 'Reports' },
  { href: '/settings',       icon: '⚙️',  label: 'Settings' },
]

export default function Sidebar({ userName, userRole }: { userName: string; userRole: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const signOut = async () => { await supabase.auth.signOut(); router.push('/login') }

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] bg-[#1F4E79] flex-col z-40 hidden md:flex shadow-xl">
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💧</span>
          <div>
            <div className="text-white font-bold text-sm">AquaFlow</div>
            <div className="text-blue-300 text-xs">VeeBee Ventures</div>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-white/70 text-xs">Signed in as</div>
        <div className="text-white text-sm font-medium truncate">{userName}</div>
        <span className="inline-block mt-1 text-xs bg-white/20 text-white/90 px-2 py-0.5 rounded-full capitalize">{userRole}</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                ${active ? 'bg-white/20 text-white font-semibold border-r-4 border-white' : 'text-blue-200 hover:bg-white/10 hover:text-white'}`}>
              <span className="w-5">{icon}</span>{label}
            </Link>
          )
        })}
      </nav>
      <div className="p-4 border-t border-white/10">
        <button onClick={signOut} className="text-blue-200 hover:text-white text-sm flex items-center gap-2">
          🚪 Sign Out
        </button>
      </div>
    </aside>
  )
}
