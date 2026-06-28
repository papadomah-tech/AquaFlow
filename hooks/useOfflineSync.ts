/**
 * useOfflineSync
 * --------------
 * React hook that:
 * 1. Tracks online/offline status
 * 2. Counts queued items
 * 3. Auto-syncs when connection is restored
 * 4. Exposes syncNow() for manual sync
 */
'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { pendingCount } from '@/lib/offlineQueue'
import { syncNow, type SyncResult } from '@/lib/syncEngine'

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline'

export function useOfflineSync(userId?: string) {
  const [isOnline, setIsOnline]       = useState(true)
  const [queued, setQueued]           = useState(0)
  const [status, setStatus]           = useState<SyncStatus>('idle')
  const [lastResult, setLastResult]   = useState<SyncResult | null>(null)
  const [lastSync, setLastSync]       = useState<Date | null>(null)
  const syncLock                      = useRef(false)

  // Poll pending count every 5 seconds
  const refreshCount = useCallback(async () => {
    const n = await pendingCount(userId)
    setQueued(n)
  }, [userId])

  const doSync = useCallback(async () => {
    if (syncLock.current) return
    syncLock.current = true
    setStatus('syncing')
    try {
      const result = await syncNow(userId)
      setLastResult(result)
      setLastSync(new Date())
      setStatus(result.failed > 0 ? 'error' : 'success')
      await refreshCount()
      // Reset to idle after 3s
      setTimeout(() => setStatus(q => q === 'success' || q === 'error' ? 'idle' : q), 3000)
    } catch {
      setStatus('error')
    } finally {
      syncLock.current = false
    }
  }, [userId, refreshCount])

  useEffect(() => {
    // Initial state
    setIsOnline(navigator.onLine)
    refreshCount()

    const onOnline = async () => {
      setIsOnline(true)
      setStatus('idle')
      const n = await pendingCount(userId)
      setQueued(n)
      if (n > 0) await doSync()
    }
    const onOffline = () => {
      setIsOnline(false)
      setStatus('offline')
    }

    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)

    // Poll every 10s
    const poll = setInterval(refreshCount, 10000)

    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      clearInterval(poll)
    }
  }, [userId, doSync, refreshCount])

  return { isOnline, queued, status, lastResult, lastSync, syncNow: doSync, refreshCount }
}
