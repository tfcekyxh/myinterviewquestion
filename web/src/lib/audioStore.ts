// 录音落盘（本机 IndexedDB）。
//
// 按既定决策：音频体积大、又没必要占服务端配额，所以**只存本机**，不上云。
// 服务端只记一条「这一题复习过」的元数据（见 server/routes/reviews.js）。
//
// 全程 fail-soft：IndexedDB 打不开（Safari 无痕模式会直接抛）也不能影响录音本身，
// 大不了这次录音只活在内存里。
import type { Recording } from './recorder'

const DB_NAME = 'interview-recorder'
const STORE = 'clips'
const VERSION = 1

export interface StoredClip extends Recording {
  key: string
  createdAt: number
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

function tx<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const t = db.transaction(STORE, 'readwrite')
          const req = fn(t.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          t.oncomplete = () => db.close()
        } catch {
          db.close()
          resolve(null)
        }
      }),
  )
}

/** 存一段录音。返回存储键；失败返回 null（调用方据此决定要不要提示「未保存到本机」）。 */
export async function saveClip(key: string, rec: Recording): Promise<string | null> {
  const row: StoredClip = { ...rec, key, createdAt: Date.now() }
  const res = await tx((store) => store.put(row))
  return res === null ? null : key
}

export async function loadClip(key: string): Promise<StoredClip | null> {
  return (await tx<StoredClip>((store) => store.get(key))) ?? null
}

export async function deleteClip(key: string): Promise<void> {
  await tx((store) => store.delete(key))
}

/** 统计本机存了多少段录音 / 占多大（「我的」页以后用得上） */
export async function clipStats(): Promise<{ count: number; bytes: number }> {
  const rows = (await tx<StoredClip[]>((store) => store.getAll())) ?? []
  return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.blob?.size ?? 0), 0) }
}
