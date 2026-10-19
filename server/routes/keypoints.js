// 每题的「回答重点」：AI 生成后缓存，用户可改成自己的话。
// GET  /api/keypoints/:seq          命中缓存直接返回；未命中则调模型生成并落库（首题自动生成）
// PUT  /api/keypoints/:seq          保存用户修改后的重点（source='user'）
// POST /api/keypoints/:seq/regenerate 强制重新调模型生成（source='ai'）
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { db } from '../db.js'
import { isLlmConfigured, summarizeKeyPoints } from '../llm.js'

export const keypointsRouter = Router()
keypointsRouter.use(requireAuth)

function rowToDto(row) {
  let points = []
  try {
    points = JSON.parse(row.points)
  } catch {
    /* 落库的是合法 JSON，这里只是兜底 */
  }
  if (!Array.isArray(points)) points = []
  return { seq: row.seq, points, source: row.source, updatedAt: Number(row.updated_at) || null }
}

// 同一题并发请求时只生成一次：在途的 Promise 共享，避免重复调模型 + 重复 INSERT。
const inflight = new Map()

async function generate(seq) {
  if (inflight.has(seq)) return inflight.get(seq)
  const p = (async () => {
    const q = db.prepare('SELECT question, answer FROM questions WHERE seq=?').get(seq)
    if (!q) {
      const e = new Error('NOT_FOUND')
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

function parseSeq(raw) {
  const seq = Number(raw)
  return Number.isInteger(seq) && seq > 0 ? seq : null
}

keypointsRouter.get('/:seq', async (req, res) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })

  const row = db.prepare('SELECT seq, points, source, updated_at FROM keypoints WHERE seq=?').get(seq)
  if (row) return res.json(rowToDto(row))

  if (!isLlmConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })

  try {
    const dto = await generate(seq)
    res.json(dto)
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: '题目不存在' })
    console.error('[keypoints 生成失败]', e)
    res.status(502).json({ error: '生成失败，请重试' })
  }
})

keypointsRouter.put('/:seq', async (req, res) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })

  const { points } = req.body ?? {}
  if (!Array.isArray(points)) return res.status(400).json({ error: 'points 必须是数组' })
  const cleaned = points
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 12)
    .map((p) => p.slice(0, 300))
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

keypointsRouter.post('/:seq/regenerate', async (req, res) => {
  const seq = parseSeq(req.params.seq)
  if (seq === null) return res.status(400).json({ error: '题号无效' })
  if (!isLlmConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })

  try {
    const dto = await generate(seq)
    res.json(dto)
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: '题目不存在' })
    console.error('[keypoints 重新生成失败]', e)
    res.status(502).json({ error: '生成失败，请重试' })
  }
})
