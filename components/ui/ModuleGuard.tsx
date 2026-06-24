'use client'
import { useRole } from '@/hooks/useRole'
import AccessDenied from '@/components/ui/AccessDenied'
import AppLayout from '@/components/layout/AppLayout'

interface Props {
  moduleKey:   string
  moduleLabel: string
  children:    React.ReactNode
}

export default function ModuleGuard({ moduleKey, moduleLabel, children }: Props) {
  const { canAccess, loading } = useRole()

  // While role is loading — show spinner (not access denied)
  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-3xl mb-3">💧</div>
          <div className="text-gray-400 text-sm">Loading...</div>
        </div>
      </div>
    </AppLayout>
  )

  if (!canAccess(moduleKey)) {
    return <AccessDenied moduleLabel={moduleLabel} />
  }

  return <>{children}</>
}
