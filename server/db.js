// 数据库连接与建表。
// 用 Node 内置的 node:sqlite —— 零原生编译，发布沙箱里不会有 node-gyp 失败的风险。
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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

export const db = new DatabaseSync(dbPath)

db.exec(`
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
{
  const cols = db.prepare('PRAGMA table_info(progress)').all().map((c) => c.name)
  if (!cols.includes('data')) {
    db.exec('DROP TABLE progress')
    db.exec(`
      CREATE TABLE progress (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
  }
}

/** 读取进度；没存过或数据坏了都返回 null，由调用方给默认值 */
export function readProgress() {
  const row = db.prepare('SELECT data, updated_at FROM progress WHERE id = 1').get()
  if (!row) return null
  try {
    const parsed = JSON.parse(row.data)
    if (!parsed || typeof parsed !== 'object') return null
    return { ...parsed, updatedAt: row.updated_at }
  } catch {
    return null
  }
}

export function writeProgress(state) {
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

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}
