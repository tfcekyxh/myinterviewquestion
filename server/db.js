// 数据库连接与建表。
// 用 Node 内置的 node:sqlite —— 零原生编译，发布沙箱里不会有 node-gyp 失败的风险。
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const isTest = process.env.NODE_ENV === 'test'
const dataDir = path.resolve('data')
const dbPath = isTest ? path.join(dataDir, 'test.db') : path.join(dataDir, 'app.db')

fs.mkdirSync(dataDir, { recursive: true })

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
