'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MOBILE_NAV = [
  { href: '/dashboard',  icon: '📊', label: 'Home' },
  { href: '/sales',      icon: '💼', label: 'Sales' },
  { href: '/production', icon: '🏭', label: 'Prod.' },
  { href: '/stock',      icon: '📦', label: 'Stock' },
  { href: '/personnel',  icon: '👥', label: 'People' },
]

export default function MobileNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 md:hidden shadow-lg">
      <div className="flex">
        {MOBILE_NAV.map(({ href, icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors
                ${active ? 'text-[#1F4E79] font-semibold' : 'text-gray-500'}`}>
              <span className="text-xl mb-0.5">{icon}</span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
