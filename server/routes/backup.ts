// 整库导出 / 还原（「数据库源文件」）。
//
// 和 P2.5 的「导出题库 JSON」是两回事：JSON 只带题目，整库文件连**背诵进度、复习记录、
// 账号、登录态**一起带走。所以「重新发布后 SQLite 文件没了」这个最后的风险点，
// 靠它才能真正复原，而不是只把题目救回来。
//
// 还原是本项目里唯一一个「会把所有数据换掉」的操作，所以这里的顺序很讲究：
//   校验（先确认上传的文件真的是一个能用的库）→ 关连接 → 旧文件改名留后路 →
//   落新文件 → 重开连接；任何一步失败都把后路文件换回去。
import { Router } from 'express'
import type { Request, Response } from 'express'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { requireAuth } from './auth.ts'
import { DB_PATH, closeDb, db, reopenDb, row } from '../db.ts'
import type { SessionRow } from '../db.ts'

export const backupRouter = Router()

const REQUIRED_TABLES = ['users', 'questions', 'progress', 'reviews', 'meta', 'sessions']
const MAX_BYTES = 200 * 1024 * 1024

backupRouter.use(requireAuth)

/**
 * 导出。用 `VACUUM INTO` 先做一份一致性快照再发送 ——
 * 直接 copy 正在被写入的 .db 文件，理论上可能拿到写了一半的状态；
 * VACUUM INTO 会在数据库自己的事务语义下产出完整可用的快照，且顺手把碎片压掉。
 */
backupRouter.get('/', (_req: Request, res: Response) => {
  const snap = `${DB_PATH}.snapshot-${process.pid}`
  fs.rmSync(snap, { force: true })

  let file = snap
  try {
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`)
  } catch (e) {
    console.warn('[备份] VACUUM INTO 不可用，退回直接读文件：', e instanceof Error ? e.message : e)
    file = DB_PATH
  }

  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `面试题背诵-备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.db`

  res.download(file, name, (err) => {
    // 发完就删快照，别在磁盘上堆垃圾
    if (file !== DB_PATH) fs.rmSync(file, { force: true })
    if (err) console.error('[备份] 下载失败：', err.message)
  })
})

/** 还原。body 是整个 .db 文件的原始字节 */
backupRouter.post('/', (req: Request, res: Response) => {
  const body: unknown = req.body
  const buf = Buffer.isBuffer(body) ? body : null
  if (!buf || buf.length === 0) {
    return res.status(400).json({ error: '没有收到文件，请选择导出的 .db 文件' })
  }
  if (buf.length > MAX_BYTES) {
    return res.status(400).json({ error: '文件太大了，不像是本应用的数据库' })
  }
  if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
    return res.status(400).json({ error: '这不是一个 SQLite 数据库文件' })
  }

  // ── 1. 先用独立的连接把上传的文件验一遍。不通过就到此为止，线上的库一个字节都不动 ──
  const incoming = `${DB_PATH}.incoming-${process.pid}`
  fs.writeFileSync(incoming, buf)
  let total = 0
  try {
    const probe = new DatabaseSync(incoming)
    const tables = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => String(r.name))
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t))
    if (missing.length > 0) {
      probe.close()
      fs.rmSync(incoming, { force: true })
      return res.status(400).json({ error: `这个文件缺表（${missing.join('、')}），不像是本应用的备份` })
    }
    // 真正读一次，确认页没坏
    const count = probe.prepare('SELECT COUNT(*) AS c FROM questions').get()
    total = Number(count?.c ?? 0)
    probe.close()
  } catch (e) {
    fs.rmSync(incoming, { force: true })
    console.error('[还原] 文件打不开：', e instanceof Error ? e.message : e)
    return res.status(400).json({ error: '这个文件打不开，可能已经损坏' })
  }

  // ── 2. 换文件。顺序不能颠倒，且每一步都要能退回去 ──
  // 还原前的登录态：库被换掉后 sessions 表也换成了备份里的，
  // 不把它写回去的话用户会被莫名其妙踢下线，看起来像「还原弄坏了」。
  const keep = row<SessionRow>('SELECT sid, data, expires FROM sessions WHERE sid = ?', req.sessionID)

  const backupOld = `${DB_PATH}.bak`
  try {
    closeDb()
    fs.rmSync(backupOld, { force: true })
    fs.renameSync(DB_PATH, backupOld)
    fs.renameSync(incoming, DB_PATH)
    // 旧库留下的 -journal / -wal 已经和新文件无关了，留着反而会让 SQLite 读到脏数据
    for (const suffix of ['-journal', '-wal', '-shm']) fs.rmSync(DB_PATH + suffix, { force: true })

    reopenDb()
  } catch (e) {
    console.error('[还原] 替换失败，正在回滚：', e instanceof Error ? e.message : e)
    try {
      if (fs.existsSync(backupOld) && !fs.existsSync(DB_PATH)) fs.renameSync(backupOld, DB_PATH)
      reopenDb()
    } catch (e2) {
      console.error('[还原] 回滚也失败了：', e2 instanceof Error ? e2.message : e2)
    }
    fs.rmSync(incoming, { force: true })
    return res.status(500).json({ error: '还原失败，数据未被修改' })
  }

  // ── 3. 把登录态写回新库 ──
  try {
    const userId = req.session?.userId
    if (keep && typeof userId === 'number' && Number.isInteger(userId) && db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)').run(
        keep.sid,
        keep.data,
        keep.expires,
      )
    }
  } catch (e) {
    // 写不回去只是会掉线，不影响还原本身，不把它当失败
    console.warn('[还原] 保留登录态失败：', e instanceof Error ? e.message : e)
  }

  res.json({ ok: true, total })
})
