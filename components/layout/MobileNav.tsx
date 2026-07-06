'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRole } from '@/hooks/useRole'
import { ALL_MODULES } from '@/lib/modules'

// Priority order for bottom nav (show first 5 the user has access to)
// customers first so operators land on their primary module
const PRIORITY = ['customers','rider-sales','sales','dashboard','production','stock','personnel','expenses','reports']

export default function MobileNav() {
  const pathname   = usePathname()
  const { canAccess } = useRole()

  const NAV = PRIORITY
    .map(key => ALL_MODULES.find(m => m.key === key)!)
    .filter(Boolean)
    .filter(m => canAccess(m.key))
    .slice(0, 5)

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200
                    z-50 md:hidden shadow-lg"
      style={{paddingBottom: "env(safe-area-inset-bottom, 0px)"}}>
      <div className="flex">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors
                ${active ? 'text-[#1F4E79] font-semibold' : 'text-gray-500'}`}>
              <span className="text-xl mb-0.5">{icon}</span>
              {label.length > 6 ? label.slice(0,5)+'.' : label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
