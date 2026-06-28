/**
 * AquaFlow Sync Engine
 * --------------------
 * Flushes the IndexedDB queue to Supabase.
 * Called automatically on reconnect and manually via syncNow().
 */
import { supabase } from '@/lib/supabase'
import {
  getPending, dequeue, incrementRetry,
  type QueuedOperation
} from '@/lib/offlineQueue'

export type SyncResult = {
  synced:  number
  failed:  number
  errors:  string[]
}

const MAX_RETRIES = 3

export async function syncNow(userId?: string): Promise<SyncResult> {
  const pending = await getPending(userId)
  const result: SyncResult = { synced: 0, failed: 0, errors: [] }

  for (const op of pending) {
    if (op.retries >= MAX_RETRIES) {
      result.failed++
      result.errors.push(`[ABANDONED] ${op.label} — too many retries`)
      await dequeue(op.id)   // remove stuck items after max retries
      continue
    }

    try {
      let error: any = null

      if (op.operation === 'insert') {
        const res = await (supabase.from(op.table as any) as any).insert(op.payload)
        error = res.error
      } else if (op.operation === 'update' && op.recordId) {
        const res = await (supabase.from(op.table as any) as any)
          .update(op.payload).eq('id', op.recordId)
        error = res.error
      } else if (op.operation === 'delete' && op.recordId) {
        const res = await (supabase.from(op.table as any) as any)
          .delete().eq('id', op.recordId)
        error = res.error
      }

      if (error) {
        await incrementRetry(op.id)
        result.failed++
        result.errors.push(`${op.label}: ${error.message}`)
      } else {
        await dequeue(op.id)
        result.synced++
      }
    } catch (err: any) {
      await incrementRetry(op.id)
      result.failed++
      result.errors.push(`${op.label}: ${err.message ?? 'Network error'}`)
    }
  }

  return result
}
