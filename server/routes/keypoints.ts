// 每题的「回答重点」：AI 生成后缓存，用户可改成自己的话。
// GET  /api/keypoints/:seq          命中缓存直接返回；未命中则调模型生成并落库（首题自动生成）
// PUT  /api/keypoints/:seq          保存用户修改后的重点（source='user'）
// POST /api/keypoints/:seq/regenerate 强制重新调模型生成（source='ai')
import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireAuth } from './auth.ts'
import { db, row } from '../db.ts'
import type { KeyPointRow } from '../db.ts'
import { isLlmConfigured, summarizeKeyPoints } from '../llm.ts'

export const keypointsRouter = Router()
keypointsRouter.use(requireAuth)

interface KeyPointsDto {
  seq: number
  points: string[]
  source: string
  updatedAt: number | null
}

function rowToDto(r: KeyPointRow): KeyPointsDto {
  let points: unknown[] = []
  try {
    const parsed: unknown = JSON.parse(r.points)
    if (Array.isArray(parsed)) points = parsed
  } catch {
    /* 落库的是合法 JSON，这里只是兜底 */
  }
  return {
    seq: r.seq,
    points: points.filter((p): p is string => typeof p === 'string'),
    source: r.source,
    updatedAt: Number(r.updated_at) || null,
  }
}

// 同一题并发请求时只生成一次：在途的 Promise 共享，避免重复调模型 + 重复 INSERT。
const inflight = new Map<number, Promise<KeyPointsDto>>()

async function generate(seq: number): Promise<KeyPointsDto> {
  const existing = inflight.get(seq)
  if (existing) return existing
  const p = (async (): Promise<KeyPointsDto> => {
    const q = row<{ question: string; answer: string }>(
      'SELECT question, answer FROM questions WHERE seq=?',
      seq,
    )
    if (!q) {
      const e: Error & { status?: number } = new Error('NOT_FOUND')
      e.status = 404
      throw e
    }
    const points = await summarizeKeyPoints(q.question, q.answer)
    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO keypoints (seq, points, source, updated_at) VALUES (?, ?, ?, ?)').run(
      seq,
      JSON.stringify(points),
      'ai',
      now,
    )
    return { seq, points, source: 'ai', updatedAt: now }
  })()
  inflight.set(seq, p)
  try {
    return await p
  } finally {
    inflight.delete(seq)
  }
}

function parseSeq(raw: unknown): number | null {
  const seq = Number(raw)
  return Number.isInteger(seq) && seq > 0 ? seq : null
}

keypointsRouter.get('/:seq', async (req: Request, res: Response) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })

  const r = row<KeyPointRow>('SELECT seq, points, source, updated_at FROM keypoints WHERE seq=?', seq)
  if (r) return res.json(rowToDto(r))

  if (!isLlmConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })

  try {
    const dto = await generate(seq)
    res.json(dto)
  } catch (e) {
    const status = e instanceof Error ? (e as Error & { status?: number }).status : undefined
    if (status === 404) return res.status(404).json({ error: '题目不存在' })
    console.error('[keypoints 生成失败]', e)
    res.status(502).json({ error: '生成失败，请重试' })
  }
})

keypointsRouter.put('/:seq', async (req: Request, res: Response) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })

  const { points } = req.body ?? {}
  if (!Array.isArray(points)) return res.status(400).json({ error: 'points 必须是数组' })
  const cleaned = points
    .map((p: unknown) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 12)
    .map((p: string) => p.slice(0, 300))
  if (cleaned.length === 0) return res.status(400).json({ error: '至少要有一条重点' })

  const now = Date.now()
  db.prepare('INSERT OR REPLACE INTO keypoints (seq, points, source, updated_at) VALUES (?, ?, ?, ?)').run(
    seq,
    JSON.stringify(cleaned),
    'user',
    now,
  )
  res.json({ seq, points: cleaned, source: 'user', updatedAt: now })
})

keypointsRouter.post('/:seq/regenerate', async (req: Request, res: Response) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })
  if (!isLlmConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })

  try {
    const dto = await generate(seq)
    res.json(dto)
  } catch (e) {
    const status = e instanceof Error ? (e as Error & { status?: number }).status : undefined
    if (status === 404) return res.status(404).json({ error: '题目不存在' })
    console.error('[keypoints 重新生成失败]', e)
    res.status(502).json({ error: '生成失败，请重试' })
  }
})
