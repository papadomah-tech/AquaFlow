import AppLayout from '@/components/layout/AppLayout'
import Link from 'next/link'

export default function AccessDenied({ message, moduleLabel }: { message?: string; moduleLabel?: string }) {
  return (
    <AppLayout>
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-[#1F4E79] mb-2">Access Restricted</h1>
          <p className="text-gray-500 mb-2">
            {message ?? `You do not have access to ${moduleLabel ?? 'this module'}.`}
          </p>
          <p className="text-gray-400 text-sm mb-6">
            Contact your administrator to request access.
          </p>
          <Link href="/sales" className="btn btn-primary inline-flex">
            ← Go to Sales
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}
