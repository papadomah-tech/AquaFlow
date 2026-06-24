import AppLayout from '@/components/layout/AppLayout'

export default function AccessDenied({ message }: { message?: string }) {
  return (
    <AppLayout>
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold text-[#1F4E79] mb-2">Access Denied</h1>
          <p className="text-gray-500 mb-6">
            {message ?? 'You do not have permission to view this page.'}
          </p>
          <a href="/dashboard"
            className="btn btn-primary inline-flex">
            ← Back to Dashboard
          </a>
        </div>
      </div>
    </AppLayout>
  )
}
