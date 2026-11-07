import {
  type CoverageState,
  cloneState,
  fromPersisted,
  isPersistedState,
  mergeStates,
  toPersisted,
} from '../engine/state'

export interface CoverageStore {
  readonly kind: 'indexeddb' | 'memory'
  /** Set when persistence degraded (e.g. IndexedDB unavailable or quota exceeded). */
  readonly warning: string | null
  load(): Promise<CoverageState | null>
  /** Persist and return the merged state (other tabs may have written meanwhile). */
  save(state: CoverageState): Promise<CoverageState>
  close(): void
}

export function memoryStore(warning: string | null = null): CoverageStore {
  let saved: CoverageState | null = null
  return {
    kind: 'memory',
    warning,
    load: async () => (saved ? cloneState(saved) : null),
    save: async state => {
      saved = saved ? mergeStates(saved, state) : cloneState(state)
      return cloneState(saved)
    },
    close: () => {},
  }
}

const DB_NAME = 'css-coverage-tracker'
const STORE = 'states'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, 1)
  open.onupgradeneeded = () => {
    if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE)
  }
  return request(open)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * IndexedDB store: read-merge-write inside one readwrite transaction, so
 * concurrent tabs never overwrite each other (plan B4). Any failure degrades to
 * an in-memory store with a warning instead of throwing into the scan.
 */
export async function openStore(
  factory: IDBFactory | undefined,
  key: string,
): Promise<CoverageStore> {
  if (!factory) return memoryStore('IndexedDB is not available; coverage is kept in memory only.')
  let db: IDBDatabase
  try {
    db = await openDatabase(factory)
  } catch (error) {
    return memoryStore(
      `IndexedDB failed (${errorMessage(error)}); coverage is kept in memory only.`,
    )
  }

  let fallback: CoverageStore | null = null
  const store: CoverageStore = {
    kind: 'indexeddb',
    get warning() {
      return fallback?.warning ?? null
    },
    load: async () => {
      if (fallback) return fallback.load()
      try {
        const value: unknown = await request(db.transaction(STORE).objectStore(STORE).get(key))
        return isPersistedState(value) ? fromPersisted(value) : null
      } catch {
        return null
      }
    },
    save: async state => {
      if (fallback) return fallback.save(state)
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const objects = tx.objectStore(STORE)
        const existing: unknown = await request(objects.get(key))
        const merged = isPersistedState(existing)
          ? mergeStates(fromPersisted(existing), state)
          : state
        objects.put(toPersisted(merged), key)
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
        return cloneState(merged)
      } catch (error) {
        fallback = memoryStore(
          `IndexedDB write failed (${errorMessage(error)}); coverage is kept in memory only.`,
        )
        return fallback.save(state)
      }
    },
    close: () => db.close(),
  }
  return store
}
