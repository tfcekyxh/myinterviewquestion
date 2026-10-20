// 数据库连接与建表。
// 用 Node 内置的 node:sqlite —— 零原生编译，发布沙箱里不会有 node-gyp 失败的风险。
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'

const isTest = process.env.NODE_ENV === 'test'
// DB_PATH 让冒烟脚本能自己开一个一次性的库，跑完就删。
// 没有它的话，scripts/smoke-*.mjs 只能打在 data/app.db 或 data/test.db 上，
// 会把里面原有的复习记录一起算进「记录数」断言 —— 这两条断言只有在全新库上才成立，
// 反复跑就必然失败（第一次跑明明是通过的）。这是脚本的坑，不是产品的 bug。
const dataDir = path.resolve('data')
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, isTest ? 'test.db' : 'app.db')
// 用 DB_PATH 时只建临时文件自己所在的目录，不顺手造一个空的 data/
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

/**
 * ⚠️ 这里是 `let` 而不是 `const`：整库还原（/api/restore）会换掉数据库文件，
 * 连接必须重新打开。ESM 的 live binding 保证所有 import 方（`routes/*`、`sessionStore`）
 * 下次访问 `db` 时拿到的就是新连接 —— 前提是别在模块顶层就把它展开成局部常量，
 * 所以各处的 `db.prepare(...)` 都写在处理函数里。
 */
export const DB_PATH = dbPath

// ── 行类型 ────────────────────────────────────────────────────────────
// node:sqlite 的 get()/all() 只返回 Record<string, SQLOutputValue>，
// 用下面的 row()/rows() 收敛成具体行类型。BLOB 列读出的是 Uint8Array。
export interface UserRow {
  id: number
  account: string
  pwd_hash: Uint8Array
  pwd_salt: Uint8Array
}
export interface QuestionRow {
  id: number
  seq: number
  question: string
  answer: string
  source_pdf: string | null
}
export interface CountRow {
  c: number
}
export interface ProgressRow {
  data: string
  updated_at: number
}
export interface MetaRow {
  value: string | null
}
export interface SessionRow {
  sid: string
  data: string
  expires: number
}
export interface KeyPointRow {
  seq: number
  points: string
  source: string
  updated_at: number
}

/** 「刚背完的一轮」：seqs 是这一轮涉及的题号 */
export interface ReviewRound {
  seqs: number[]
  count: number
}

/** progress 表里那一行 JSON 的结构。mode 库里可能存着任意值，由 normalize 收敛 */
export interface ProgressData {
  mode: string
  posOrder: number
  posRandom: number
  randOrder: number[]
  roundStart: number | null
  lastRound: ReviewRound | null
  total: number
}
export interface StoredProgress extends ProgressData {
  updatedAt: number
}

/** 单行查询并收敛成具体行类型。必须在调用时读 `db`（还原后会重赋值），不能缓存连接 */
export function row<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

/** 多行查询 */
export function rows<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}

/** 建表 + 老结构迁移。**每次打开连接都要跑一遍**：整库还原后的文件可能来自旧版本 */
function ensureSchema(conn: DatabaseSync) {
  conn.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY,
    account   TEXT NOT NULL UNIQUE,
    pwd_hash  BLOB NOT NULL,
    pwd_salt  BLOB NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id         INTEGER PRIMARY KEY,
    seq        INTEGER NOT NULL UNIQUE,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    source_pdf TEXT
  );

  -- 单用户场景，进度就是「一行 JSON」。
  -- 顺序与随机各记一个位置，这样两种模式来回切都不会丢进度（ued.md S4）。
  CREATE TABLE IF NOT EXISTS progress (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- audio_path 存的**不是服务端路径**，而是本机录音的键（IndexedDB key）：
  -- 按既定决策音频只存本机，不上云，录不上就是 NULL。
  CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY,
    question_id INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    audio_path  TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS keypoints (
    seq        INTEGER PRIMARY KEY,
    points     TEXT NOT NULL,
    source     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`)

  // P3 把 progress 从「一行三字段」改成了「一行 JSON」。老结构直接重建——
  // P3 之前根本没有写入过真实进度，重建不会丢任何东西。
  const cols = conn.prepare('PRAGMA table_info(progress)').all().map((c) => c.name)
  if (!cols.includes('data')) {
    conn.exec('DROP TABLE progress')
    conn.exec(`
      CREATE TABLE progress (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }
}

function open() {
  let conn
  try {
    conn = new DatabaseSync(dbPath)
  } catch (e) {
    // 部署环境未必保证磁盘可写（这是本项目最后一个没验过的风险点）。
    // 这里**不静默退到临时目录** —— 那样服务能起来、数据却随时会没，
    // 用户会以为存住了。宁可起不来，把问题暴露在日志里。
    throw new Error(
      `打不开数据库文件 ${dbPath}：${e instanceof Error ? e.message : String(e)}。\n` +
        `常见原因：部署环境的数据目录不可写。请确认运行目录下能创建 data/，` +
        `或用 DB_PATH 指向一个可写的路径。`,
    )
  }
  ensureSchema(conn)
  return conn
}

export let db = open()

/** 整库还原用：换文件前必须先关连接，否则 Windows/部分平台上无法替换文件 */
export function closeDb() {
  try {
    db.close()
  } catch {
    // 已经关了就算了
  }
}

export function reopenDb() {
  db = open()
}

/** 读取进度；没存过或数据坏了都返回 null，由调用方给默认值 */
export function readProgress(): StoredProgress | null {
  const r = row<ProgressRow>('SELECT data, updated_at FROM progress WHERE id = 1')
  if (!r) return null
  try {
    const parsed: unknown = JSON.parse(r.data)
    if (!parsed || typeof parsed !== 'object') return null
    return { ...(parsed as ProgressData), updatedAt: r.updated_at }
  } catch {
    return null
  }
}

export function writeProgress(state: ProgressData & { updatedAt?: number | null }) {
  const { updatedAt: _ignored, ...data } = state
  db.prepare('INSERT OR REPLACE INTO progress (id, data, updated_at) VALUES (1, ?, ?)').run(
    JSON.stringify(data),
    Date.now(),
  )
}

export function clearProgress() {
  db.exec('DELETE FROM progress')
}

export function resetDb() {
  db.exec(`
    DELETE FROM users;
    DELETE FROM questions;
    DELETE FROM progress;
    DELETE FROM reviews;
    DELETE FROM meta;
    DELETE FROM sessions;
  `)
}

export function getMeta(key: string): string | null {
  const r = row<MetaRow>('SELECT value FROM meta WHERE key = ?', key)
  return r ? r.value : null
}

export function setMeta(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}
