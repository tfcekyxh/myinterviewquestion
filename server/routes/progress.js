// 背诵进度：存服务端，跟账号走，所以换设备能接着背（决策 5）。
//
// 为什么顺序和随机要各存一个位置：
//   ued.md S4 要求「切到随机模式时记住当前题位置，切回顺序可继续」。
//   只存一个 position 的话，一切换模式就会把另一种模式的进度顶掉。
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { db, readProgress, writeProgress, clearProgress } from '../db.js'

export const progressRouter = Router()

progressRouter.use(requireAuth)

const DEFAULT_MODE = 'order'

function bankTotal() {
  return db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
}

/**
 * 位置的含义是「已背题数」，取值 0..total。
 * 取到 total 是合法状态 —— 表示这一轮背完了（ued.md S4 的完成提示），
 * 所以不能像下标那样夹到 total-1。
 */
function clamp(n, total) {
  if (!Number.isInteger(n) || n < 0) return 0
  return Math.min(n, Math.max(0, total))
}

/**
 * 把任何来源的进度都收敛成「一定能用」的状态。
 * 关键一条：题库规模变了就把位置归零 —— 换题库后旧位置指向的是别的题，比丢掉更糟。
 */
function normalize(state, total) {
  const s = state ?? {}
  if (s.total !== total) {
    return { mode: DEFAULT_MODE, posOrder: 0, posRandom: 0, randOrder: [], total }
  }
  const mode = s.mode === 'random' ? 'random' : DEFAULT_MODE
  // 随机序列必须是 1..total 的一个排列，否则一律作废（宁可从头发一组新的）
  const randOrder =
    Array.isArray(s.randOrder) && s.randOrder.length === total ? s.randOrder.map(Number) : []
  return {
    mode,
    posOrder: clamp(s.posOrder, total),
    posRandom: randOrder.length ? clamp(s.posRandom, total) : 0,
    randOrder,
    total,
  }
}

function payload() {
  const total = bankTotal()
  const stored = readProgress()
  const state = normalize(stored, total)
  return { ...state, total, updatedAt: stored?.updatedAt ?? null }
}

progressRouter.get('/', (_req, res) => {
  res.json(payload())
})

progressRouter.put('/', (req, res) => {
  const total = bankTotal()
  const current = normalize(readProgress(), total)
  const body = req.body ?? {}
  const next = { ...current }

  if (body.mode === 'order' || body.mode === 'random') next.mode = body.mode
  if (Number.isInteger(body.posOrder) && body.posOrder >= 0) next.posOrder = body.posOrder
  if (Number.isInteger(body.posRandom) && body.posRandom >= 0) next.posRandom = body.posRandom
  if (Array.isArray(body.randOrder)) next.randOrder = body.randOrder.filter(Number.isInteger)

  const fixed = normalize(next, total)
  writeProgress(fixed)
  res.json(payload())
})

/** 重置进度（「我的」页用） */
progressRouter.delete('/', (_req, res) => {
  clearProgress()
  res.json({ ok: true })
})
