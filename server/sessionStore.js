// 自写 SqliteStore：把 session 存进同一个 SQLite 文件，不用额外维护任何东西。
// 不用 connect-sqlite3 —— 它源码里 require('sqlite3')（原生模块），却没在 package.json 声明。
import session from 'express-session'
import { db } from './db.js'

const DEFAULT_TTL = 7 * 864e5 // 7 天

export class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid)
      if (!row) return cb(null, null)
      if (row.expires < Date.now()) {
        return this.destroy(sid, () => cb(null, null))
      }
      cb(null, JSON.parse(row.data))
    } catch (e) {
      cb(e)
    }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess?.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + DEFAULT_TTL
      db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)').run(
        sid,
        JSON.stringify(sess),
        expires,
      )
      cb(null)
    } catch (e) {
      cb(e)
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      cb(null)
    } catch (e) {
      cb(e)
    }
  }
}

/** 清掉已过期的 session，启动时跑一次 */
export function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now())
}
