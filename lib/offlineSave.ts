/**
 * offlineSave — universal save that works online and offline
 *
 * Online  → writes directly to Supabase
 * Offline → queues in IndexedDB, returns a temp record for optimistic UI
 */
import { supabase } from '@/lib/supabase'
import { enqueue } from '@/lib/offlineQueue'

interface SaveOptions {
  table:     string
  payload:   Record<string, any>
  label:     string           // human-readable e.g. "Sale – Walk-in Customer"
  userId:    string
  operation?: 'insert' | 'update' | 'delete'
  recordId?:  number
}

export type SaveResult = {
  data:    any | null
  error:   string | null
  offline: boolean           // true = was queued, not yet synced
}

export async function offlineSave({
  table, payload, label, userId,
  operation = 'insert', recordId
}: SaveOptions): Promise<SaveResult> {

  const online = navigator.onLine

  if (online) {
    // ── Online: write directly ─────────────────────────────────────────────
    try {
      let result: any
      if (operation === 'insert') {
        result = await (supabase.from(table as any) as any).insert(payload).select().single()
      } else if (operation === 'update' && recordId) {
        result = await (supabase.from(table as any) as any).update(payload).eq('id', recordId).select().single()
      } else if (operation === 'delete' && recordId) {
        result = await (supabase.from(table as any) as any).delete().eq('id', recordId)
      }
      if (result?.error) return { data: null, error: result.error.message, offline: false }
      return { data: result?.data ?? null, error: null, offline: false }
    } catch (err: any) {
      // Network error mid-request — fall through to offline queue
    }
  }

  // ── Offline (or network error): queue it ───────────────────────────────────
  await enqueue({ table, operation, payload, recordId, label, userId })
  // Return an optimistic temp record so the UI can update immediately
  return {
    data:    operation === 'insert' ? { ...payload, _offline: true, _queued_at: Date.now() } : null,
    error:   null,
    offline: true,
  }
}
