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

  CREATE TABLE IF NOT EXISTS progress (
    id         INTEGER PRIMARY KEY,
    mode       TEXT NOT NULL,          -- 'order' | 'random'
    position   INTEGER NOT NULL DEFAULT 0,
    total      INTEGER NOT NULL DEFAULT 0,
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
