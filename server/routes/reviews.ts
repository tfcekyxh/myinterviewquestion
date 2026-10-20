// 复习记录。
//
// 只记「这一题复习过、讲了多久」，**音频不上云**（按既定决策，录音只存本机 IndexedDB）。
// 所以 audio_path 存的不是服务端路径，而是**本机录音的键**；没录上就是 null。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireAuth } from './auth.ts'
import { db, row } from '../db.ts'

export const reviewsRouter = Router()

reviewsRouter.use(requireAuth)

reviewsRouter.post('/', (req: Request, res: Response) => {
  const { seq, durationMs, clipKey } = req.body ?? {}

  if (!Number.isInteger(seq)) {
    return res.status(400).json({ error: '缺少题号' })
  }
  const question = row<{ id: number }>('SELECT id FROM questions WHERE seq = ?', seq)
  if (!question) {
    return res.status(404).json({ error: `第 ${seq} 题不在题库里` })
  }

  const duration = Number.isInteger(durationMs) && durationMs > 0 ? Math.min(durationMs, 3600_000) : 0
  db.prepare('INSERT INTO reviews (question_id, duration_ms, audio_path, created_at) VALUES (?, ?, ?, ?)').run(
    question.id,
    duration,
    typeof clipKey === 'string' && clipKey ? clipKey : null,
    Date.now(),
  )

  res.json({ ok: true })
})

/** 复习概况。「我的」页以后用得上，现在先给个能验证的读数。 */
reviewsRouter.get('/', (_req: Request, res: Response) => {
  const r = row<{ total: number; lastAt: number | null }>(
    'SELECT COUNT(*) AS total, MAX(created_at) AS lastAt FROM reviews',
  )
  res.json({ total: r?.total ?? 0, lastAt: r?.lastAt ?? null })
})
