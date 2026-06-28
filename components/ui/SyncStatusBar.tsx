'use client'
import { useOfflineSync } from '@/hooks/useOfflineSync'

interface Props { userId?: string }

export default function SyncStatusBar({ userId }: Props) {
  const { isOnline, queued, status, lastResult, lastSync, syncNow } = useOfflineSync(userId)

  // Don't show bar when online with nothing pending and idle
  if (isOnline && queued === 0 && status === 'idle') return null

  const bg =
    !isOnline        ? 'bg-red-600'    :
    status === 'syncing' ? 'bg-blue-600'   :
    status === 'success' ? 'bg-green-600'  :
    status === 'error'   ? 'bg-orange-600' :
    queued > 0       ? 'bg-orange-500' : 'bg-gray-600'

  const icon =
    !isOnline        ? '📵' :
    status === 'syncing' ? '⏳' :
    status === 'success' ? '✅' :
    status === 'error'   ? '⚠️' :
    queued > 0       ? '🔄' : '✅'

  const msg =
    !isOnline        ? `Offline — ${queued} record${queued !== 1 ? 's' : ''} queued` :
    status === 'syncing' ? 'Syncing...' :
    status === 'success' ? `Synced ${lastResult?.synced ?? 0} record${(lastResult?.synced ?? 0) !== 1 ? 's' : ''}` :
    status === 'error'   ? `${lastResult?.failed ?? 0} failed — tap to retry` :
    queued > 0       ? `${queued} record${queued !== 1 ? 's' : ''} waiting to sync` : ''

  return (
    <div className={'md:ml-[220px] sticky top-14 md:top-0 z-40 ' + bg}>
      <div className="flex items-center justify-between px-4 py-2 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-2 text-white text-xs font-medium">
          <span>{icon}</span>
          <span>{msg}</span>
          {!isOnline && (
            <span className="opacity-70">· Data will sync when connection is restored</span>
          )}
          {status === 'error' && lastResult?.errors && lastResult.errors.length > 0 && (
            <span className="opacity-70 hidden md:inline">
              · {lastResult.errors[0]}
            </span>
          )}
        </div>
        {isOnline && queued > 0 && status !== 'syncing' && (
          <button onClick={syncNow}
            className="text-white text-xs font-bold bg-white/20 hover:bg-white/30
                       px-3 py-1 rounded-full transition-colors">
            Sync Now
          </button>
        )}
        {lastSync && status === 'idle' && queued === 0 && (
          <span className="text-white/60 text-xs">
            Last sync: {lastSync.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  )
}
