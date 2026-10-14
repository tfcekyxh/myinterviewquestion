// 录音落盘（本机 IndexedDB）。
//
// 音频只存本机，服务端只记一条「这一题复习过」的元数据（见 server/routes/reviews.js）。
// 「持久化」不靠服务端，而靠**用户主动导出**：见 lib/clipExport.ts 与 pages/Clips.tsx。
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
  /** 题号。可选：老数据里没有，一律走 seqOfClip() 从 key 反解 */
  seq?: number
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

/**
 * 存一段录音。返回存储键；失败返回 null（调用方据此决定要不要提示「未保存到本机」）。
 *
 * ⚠️ key 必须是 `clip:${题号}:${时间戳}` 的固定格式 —— 下面是靠它反解题号的。
 */
export async function saveClip(key: string, rec: Recording): Promise<string | null> {
  const row: StoredClip = { ...rec, key, createdAt: Date.now() }
  const res = await tx((store) => store.put(row))
  return res === null ? null : key
}

/**
 * 这一段录音属于哪一题。
 *
 * 特意**不要求**存 seq 字段：线上已经有老录音了，那些行里没这个字段。
 * 统一从 key 反解（`clip:${seq}:${ts}`），新老数据走同一条路，不用做迁移。
 */
export function seqOfClip(clip: StoredClip): number {
  if (typeof clip.seq === 'number' && Number.isFinite(clip.seq) && clip.seq > 0) return clip.seq
  const m = /^clip:(\d+):/.exec(clip.key ?? '')
  return m ? Number(m[1]) : 0
}

/** 本机所有录音，最新的排在最前（「我的录音」页直接用） */
export async function listClips(): Promise<StoredClip[]> {
  const rows = (await tx<StoredClip[]>((store) => store.getAll())) ?? []
  return rows.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
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
