'use client'
import { useRole } from '@/hooks/useRole'
import AccessDenied from '@/components/ui/AccessDenied'
import AppLayout from '@/components/layout/AppLayout'

interface Props {
  moduleKey: string
  moduleLabel: string
  children: React.ReactNode
}

export default function ModuleGuard({ moduleKey, moduleLabel, children }: Props) {
  const { canAccess, loading } = useRole()

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[60vh] text-gray-400">
        Checking permissions...
      </div>
    </AppLayout>
  )

  if (!canAccess(moduleKey)) {
    return <AccessDenied moduleLabel={moduleLabel} />
  }

  return <>{children}</>
}
