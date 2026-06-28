/**
 * AquaFlow Offline Queue
 * ---------------------
 * Stores pending writes in IndexedDB when offline.
 * Auto-syncs to Supabase when internet is restored.
 * Manual sync via syncNow().
 */

export type QueuedOperation = {
  id:        string          // uuid
  table:     string          // supabase table name
  operation: 'insert' | 'update' | 'delete'
  payload:   Record<string, any>
  recordId?: number          // for update/delete
  createdAt: number          // timestamp
  userId:    string          // who queued it
  label:     string          // human readable e.g. "Sale – Walk-in Customer"
  retries:   number
}

const DB_NAME    = 'aquaflow_offline'
const DB_VERSION = 1
const STORE      = 'queue'

// ── Open / init IndexedDB ─────────────────────────────────────────────────────
let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
        store.createIndex('userId', 'userId')
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror   = () => reject(req.error)
  })
}

// ── Queue a write ─────────────────────────────────────────────────────────────
export async function enqueue(op: Omit<QueuedOperation, 'id' | 'createdAt' | 'retries'>): Promise<string> {
  const db  = await openDB()
  const id  = crypto.randomUUID()
  const item: QueuedOperation = { ...op, id, createdAt: Date.now(), retries: 0 }
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req   = store.add(item)
    req.onsuccess = () => resolve(id)
    req.onerror   = () => reject(req.error)
  })
}

// ── Get all pending items ─────────────────────────────────────────────────────
export async function getPending(userId?: string): Promise<QueuedOperation[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req   = store.index('createdAt').getAll()
    req.onsuccess = () => {
      let items = req.result as QueuedOperation[]
      if (userId) items = items.filter(i => i.userId === userId)
      resolve(items.sort((a, b) => a.createdAt - b.createdAt))
    }
    req.onerror = () => reject(req.error)
  })
}

// ── Count pending ──────────────────────────────────────────────────────────────
export async function pendingCount(userId?: string): Promise<number> {
  const items = await getPending(userId)
  return items.length
}

// ── Delete a synced item ───────────────────────────────────────────────────────
export async function dequeue(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req   = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ── Increment retry count ─────────────────────────────────────────────────────
export async function incrementRetry(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const get   = store.get(id)
    get.onsuccess = () => {
      const item = get.result as QueuedOperation
      if (!item) { resolve(); return }
      item.retries += 1
      const put = store.put(item)
      put.onsuccess = () => resolve()
      put.onerror   = () => reject(put.error)
    }
    get.onerror = () => reject(get.error)
  })
}

// ── Clear all (e.g. after full sync or logout) ────────────────────────────────
export async function clearAll(userId?: string): Promise<void> {
  if (!userId) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req   = store.clear()
      req.onsuccess = () => resolve()
      req.onerror   = () => reject(req.error)
    })
  }
  const items = await getPending(userId)
  for (const item of items) await dequeue(item.id)
}
